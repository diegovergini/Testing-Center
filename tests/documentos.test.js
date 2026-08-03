/* Tests for attached documents: what counts as a link, what the platform refuses and how an
   attachment gets onto a request, an instrument and the workflow. */
const test = require('node:test');
const assert = require('node:assert');

require('../src/util.js');
const dados = require('../src/data.js');
const documentos = require('../src/documentos.js');
require('../src/fluxo.js');
require('../src/scheduler.js');
require('../src/permissoes.js');
require('../src/store.js');

const store = globalThis.TC.store;
const util = globalThis.TC.util;

const SHAREPOINT = 'https://empresa.sharepoint.com/sites/testes/Relatorios/LTI-482.pdf';

/* ---- Reading the link ---- */

test('SharePoint, OneDrive and network links get in', () => {
  assert.deepEqual(documentos.interpretarLink(SHAREPOINT),
    { ok: true, link: SHAREPOINT, local: 'WEB' });

  const rede = '\\\\servidor\\calibracao\\2026\\RBC-2026-0481.pdf';
  assert.deepEqual(documentos.interpretarLink(rede), { ok: true, link: rede, local: 'REDE' });

  assert.equal(documentos.interpretarLink('file:///C:/testes/report.pdf').local, 'REDE');
});

test('an address pasted without https gains the scheme', () => {
  const lido = documentos.interpretarLink('empresa.sharepoint.com/sites/testes/a.pdf');
  assert.equal(lido.ok, true);
  assert.equal(lido.link, 'https://empresa.sharepoint.com/sites/testes/a.pdf');
});

test('a link pasted from Outlook comes wrapped in < > and is cleaned up', () => {
  assert.equal(documentos.interpretarLink('<' + SHAREPOINT + '>').link, SHAREPOINT);
});

/* The link becomes an href on a screen someone else opens: a "javascript:" saved here would
   run code in their browser instead of opening a document. */
test('a scheme that runs code is refused, not sanitised', () => {
  ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox'].forEach((link) => {
    const lido = documentos.interpretarLink(link);
    assert.equal(lido.ok, false, link + ' should have been refused');
    assert.equal(lido.motivo, 'ESQUEMA_RECUSADO');
  });
});

test('a bare file name does not become a link', () => {
  assert.equal(documentos.interpretarLink('relatorio final.pdf').ok, false);
  /* It has a dot and an extension, exactly like a domain — and leads nowhere. */
  assert.equal(documentos.interpretarLink('certificado.pdf').ok, false);
  assert.equal(documentos.interpretarLink('empresa.sharepoint.com').ok, false, 'no path');
  assert.equal(documentos.interpretarLink('https://').ok, false);
  assert.equal(documentos.interpretarLink('   ').motivo, 'SEM_LINK');
});

test('the name comes from the end of the link when nobody types one', () => {
  const criado = documentos.criar({ tipo: 'RELATORIO', link: SHAREPOINT }, 'TESTES', '2026-08-03');
  assert.equal(criado.ok, true);
  assert.equal(criado.documento.nome, 'LTI-482.pdf');
  assert.equal(criado.documento.perfil, 'TESTES');
  assert.equal(criado.documento.anexadoEm, '2026-08-03');
});

test('a network path does not open on click — the screen shows it to be copied', () => {
  const rede = documentos.criar({ link: '\\\\servidor\\pasta\\a.pdf' }, 'TESTES').documento;
  const web = documentos.criar({ link: SHAREPOINT }, 'TESTES').documento;
  assert.equal(documentos.abrePorClique(rede), false);
  assert.equal(documentos.abrePorClique(web), true);
});

test('each screen offers the types that make sense on it', () => {
  const daDemanda = documentos.tipos('demanda').map((t) => t.id);
  assert.deepEqual(daDemanda, ['ENTRADA', 'RELATORIO', 'EVIDENCIA', 'OUTRO']);
  assert.deepEqual(documentos.tipos('instrumento').map((t) => t.id), ['CERTIFICADO', 'OUTRO']);

  assert.equal(documentos.tipoSugerido('demanda', 'PRODUTO'), 'ENTRADA',
    'whoever asks for the test attaches the test input');
  assert.equal(documentos.tipoSugerido('demanda', 'TESTES'), 'RELATORIO',
    'whoever runs it attaches the report');
});

/* ---- Attaching through the store ---- */

function novaDemanda() {
  store.restaurarPadrao();
  const teste = store.get().testes[0];
  return store.criarDemanda({
    testeId: teste.id, pecaId: store.get().pecas[0].id, clienteId: 'CLI-GM',
    lti: 'LTI-482', tipoLti: 'PV', dataAmostras: '2026-08-03'
  });
}

test('the requester attaches the test input and it stays on the request', () => {
  const d = novaDemanda();
  store.definirPerfil('PRODUTO');
  const r = store.anexarDocumento('demanda', d.id, {
    tipo: 'ENTRADA', nome: 'Test input rev B', link: SHAREPOINT
  });

  assert.equal(r.ok, true);
  const salva = util.porId(store.get().demandas, d.id);
  assert.equal(salva.documentos.length, 1);
  assert.equal(salva.documentos[0].tipo, 'ENTRADA');
  assert.equal(salva.documentos[0].perfil, 'PRODUTO', 'who attached it is recorded');
});

test('an invalid link does not get onto the request', () => {
  const d = novaDemanda();
  const r = store.anexarDocumento('demanda', d.id, { tipo: 'ENTRADA', link: 'javascript:alert(1)' });
  assert.equal(r.ok, false);
  assert.equal(util.porId(store.get().demandas, d.id).documentos.length, 0);
});

test('removing the attachment takes away the reference, and only that', () => {
  const d = novaDemanda();
  const doc = store.anexarDocumento('demanda', d.id, { tipo: 'ENTRADA', link: SHAREPOINT }).documento;
  store.removerDocumento('demanda', d.id, doc.id);
  assert.equal(util.porId(store.get().demandas, d.id).documentos.length, 0);
});

/* ---- The report and the workflow ---- */

test('the report is only sent once it is attached', () => {
  const d = novaDemanda();
  store.definirPerfil('TESTES');
  store.moverDemanda(d.id, 'ACEITA');
  store.moverDemanda(d.id, 'EM_EXECUCAO');
  store.moverDemanda(d.id, 'CONCLUIDA', { dataConclusao: '2026-08-20' });

  const semRelatorio = store.moverDemanda(d.id, 'RELATORIO_ENVIADO');
  assert.equal(semRelatorio.ok, false);
  assert.match(semRelatorio.motivo, /Test report/);
  assert.equal(util.porId(store.get().demandas, d.id).status, 'CONCLUIDA', 'it did not move');

  /* An attached test input is not enough: what the move requires is the report. */
  store.anexarDocumento('demanda', d.id, { tipo: 'ENTRADA', link: SHAREPOINT });
  assert.equal(store.moverDemanda(d.id, 'RELATORIO_ENVIADO').ok, false);

  store.anexarDocumento('demanda', d.id, { tipo: 'RELATORIO', link: SHAREPOINT });
  assert.equal(store.moverDemanda(d.id, 'RELATORIO_ENVIADO').ok, true);
});

/* ---- Calibration certificate ---- */

test('the certificate link becomes a document tied to the calibration', () => {
  store.restaurarPadrao();
  store.definirPerfil('TESTES');
  const r = store.registrarCalibracao('TCL-AC-012', {
    data: '2026-07-10', resultado: 'APROVADO', certificado: 'RBC-2026-0481',
    laboratorio: 'Metrologia XPTO',
    certificadoLink: 'https://empresa.sharepoint.com/calibracao/RBC-2026-0481.pdf'
  });

  assert.equal(r.ok, true);
  const i = util.porId(store.get().instrumentos, 'TCL-AC-012');
  assert.equal(i.documentos.length, 1);
  assert.equal(i.documentos[0].tipo, 'CERTIFICADO');
  assert.equal(i.documentos[0].nome, 'Certificate RBC-2026-0481');
  assert.equal(i.documentos[0].refId, r.registro.id, 'it points at the calibration it evidences');
  assert.equal(r.registro.documentoId, i.documentos[0].id);
});

/* The calibration happened — refusing the whole record because of a badly pasted link would
   lose the data that matters. */
test('a bad link does not bring down the calibration record', () => {
  store.restaurarPadrao();
  const r = store.registrarCalibracao('TCL-AC-012', {
    data: '2026-07-10', resultado: 'APROVADO', certificadoLink: 'certificado.pdf'
  });

  assert.equal(r.ok, true);
  const i = util.porId(store.get().instrumentos, 'TCL-AC-012');
  assert.equal(i.ultimaCalibracao, '2026-07-10');
  assert.equal(i.documentos.length, 0);
  assert.match(r.registro.observacao, /certificate link not saved/);
});

/* ---- Data saved before documents ---- */

test('data saved before attachments receives the empty list', () => {
  const base = dados.seed();
  base.demandas = [{ id: 'DM-1', testeId: 'TP-1', status: 'SOLICITADA', historico: [] }];
  base.instrumentos.forEach((i) => { delete i.documentos; });

  store.importar(JSON.stringify(base));
  const estado = store.get();

  assert.deepEqual(estado.demandas[0].documentos, []);
  assert.deepEqual(util.porId(estado.instrumentos, 'TCL-AC-012').documentos, []);
});
