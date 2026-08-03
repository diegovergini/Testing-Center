/* Testes dos documentos anexados: o que vale como link, o que a plataforma recusa e como
   o anexo entra na demanda, no instrumento e no fluxo. */
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

/* ---- Leitura do link ---- */

test('link do SharePoint, do OneDrive e da rede entram', () => {
  assert.deepEqual(documentos.interpretarLink(SHAREPOINT),
    { ok: true, link: SHAREPOINT, local: 'WEB' });

  const rede = '\\\\servidor\\calibracao\\2026\\RBC-2026-0481.pdf';
  assert.deepEqual(documentos.interpretarLink(rede), { ok: true, link: rede, local: 'REDE' });

  assert.equal(documentos.interpretarLink('file:///C:/testes/report.pdf').local, 'REDE');
});

test('endereço colado sem https ganha o esquema', () => {
  const lido = documentos.interpretarLink('empresa.sharepoint.com/sites/testes/a.pdf');
  assert.equal(lido.ok, true);
  assert.equal(lido.link, 'https://empresa.sharepoint.com/sites/testes/a.pdf');
});

test('o link colado do Outlook vem entre < > e é limpo', () => {
  assert.equal(documentos.interpretarLink('<' + SHAREPOINT + '>').link, SHAREPOINT);
});

/* O link vira href numa tela que outra pessoa abre: um "javascript:" gravado aqui
   executaria código no navegador dela em vez de abrir documento. */
test('esquema que executa código é recusado, não sanitizado', () => {
  ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox'].forEach((link) => {
    const lido = documentos.interpretarLink(link);
    assert.equal(lido.ok, false, link + ' deveria ser recusado');
    assert.equal(lido.motivo, 'ESQUEMA_RECUSADO');
  });
});

test('nome de arquivo solto não vira link', () => {
  assert.equal(documentos.interpretarLink('relatorio final.pdf').ok, false);
  /* Tem ponto e uma extensão, igualzinho a um domínio — e não leva a lugar nenhum. */
  assert.equal(documentos.interpretarLink('certificado.pdf').ok, false);
  assert.equal(documentos.interpretarLink('empresa.sharepoint.com').ok, false, 'sem caminho');
  assert.equal(documentos.interpretarLink('https://').ok, false);
  assert.equal(documentos.interpretarLink('   ').motivo, 'SEM_LINK');
});

test('o nome sai do fim do link quando ninguém digita um', () => {
  const criado = documentos.criar({ tipo: 'RELATORIO', link: SHAREPOINT }, 'TESTES', '2026-08-03');
  assert.equal(criado.ok, true);
  assert.equal(criado.documento.nome, 'LTI-482.pdf');
  assert.equal(criado.documento.perfil, 'TESTES');
  assert.equal(criado.documento.anexadoEm, '2026-08-03');
});

test('caminho de rede não abre por clique — a tela mostra para copiar', () => {
  const rede = documentos.criar({ link: '\\\\servidor\\pasta\\a.pdf' }, 'TESTES').documento;
  const web = documentos.criar({ link: SHAREPOINT }, 'TESTES').documento;
  assert.equal(documentos.abrePorClique(rede), false);
  assert.equal(documentos.abrePorClique(web), true);
});

test('cada janela oferece os tipos que fazem sentido nela', () => {
  const daDemanda = documentos.tipos('demanda').map((t) => t.id);
  assert.deepEqual(daDemanda, ['ENTRADA', 'RELATORIO', 'EVIDENCIA', 'OUTRO']);
  assert.deepEqual(documentos.tipos('instrumento').map((t) => t.id), ['CERTIFICADO', 'OUTRO']);

  assert.equal(documentos.tipoSugerido('demanda', 'PRODUTO'), 'ENTRADA',
    'quem pede o teste anexa test input');
  assert.equal(documentos.tipoSugerido('demanda', 'TESTES'), 'RELATORIO',
    'quem executa anexa o relatório');
});

/* ---- Anexar pelo store ---- */

function novaDemanda() {
  store.restaurarPadrao();
  const teste = store.get().testes[0];
  return store.criarDemanda({
    testeId: teste.id, pecaId: store.get().pecas[0].id, clienteId: 'CLI-GM',
    lti: 'LTI-482', tipoLti: 'PV', dataAmostras: '2026-08-03'
  });
}

test('o solicitante anexa o test input e ele fica na demanda', () => {
  const d = novaDemanda();
  store.definirPerfil('PRODUTO');
  const r = store.anexarDocumento('demanda', d.id, {
    tipo: 'ENTRADA', nome: 'Test input rev B', link: SHAREPOINT
  });

  assert.equal(r.ok, true);
  const salva = util.porId(store.get().demandas, d.id);
  assert.equal(salva.documentos.length, 1);
  assert.equal(salva.documentos[0].tipo, 'ENTRADA');
  assert.equal(salva.documentos[0].perfil, 'PRODUTO', 'fica registrado quem anexou');
});

test('link inválido não entra na demanda', () => {
  const d = novaDemanda();
  const r = store.anexarDocumento('demanda', d.id, { tipo: 'ENTRADA', link: 'javascript:alert(1)' });
  assert.equal(r.ok, false);
  assert.equal(util.porId(store.get().demandas, d.id).documentos.length, 0);
});

test('remover o anexo tira a referência, e só ela', () => {
  const d = novaDemanda();
  const doc = store.anexarDocumento('demanda', d.id, { tipo: 'ENTRADA', link: SHAREPOINT }).documento;
  store.removerDocumento('demanda', d.id, doc.id);
  assert.equal(util.porId(store.get().demandas, d.id).documentos.length, 0);
});

/* ---- O relatório e o fluxo ---- */

test('relatório só é enviado depois de anexado', () => {
  const d = novaDemanda();
  store.definirPerfil('TESTES');
  store.moverDemanda(d.id, 'ACEITA');
  store.moverDemanda(d.id, 'EM_EXECUCAO');
  store.moverDemanda(d.id, 'CONCLUIDA', { dataConclusao: '2026-08-20' });

  const semRelatorio = store.moverDemanda(d.id, 'RELATORIO_ENVIADO');
  assert.equal(semRelatorio.ok, false);
  assert.match(semRelatorio.motivo, /Relatório de teste/);
  assert.equal(util.porId(store.get().demandas, d.id).status, 'CONCLUIDA', 'não passou');

  /* Test input anexado não serve: o que a passagem exige é o relatório. */
  store.anexarDocumento('demanda', d.id, { tipo: 'ENTRADA', link: SHAREPOINT });
  assert.equal(store.moverDemanda(d.id, 'RELATORIO_ENVIADO').ok, false);

  store.anexarDocumento('demanda', d.id, { tipo: 'RELATORIO', link: SHAREPOINT });
  assert.equal(store.moverDemanda(d.id, 'RELATORIO_ENVIADO').ok, true);
});

/* ---- Certificado de calibração ---- */

test('o link do certificado vira documento amarrado à calibração', () => {
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
  assert.equal(i.documentos[0].nome, 'Certificado RBC-2026-0481');
  assert.equal(i.documentos[0].refId, r.registro.id, 'aponta para a calibração que comprova');
  assert.equal(r.registro.documentoId, i.documentos[0].id);
});

/* A calibração aconteceu — recusar o registro inteiro por causa de um link mal colado
   perderia o dado que importa. */
test('link ruim não derruba o registro da calibração', () => {
  store.restaurarPadrao();
  const r = store.registrarCalibracao('TCL-AC-012', {
    data: '2026-07-10', resultado: 'APROVADO', certificadoLink: 'certificado.pdf'
  });

  assert.equal(r.ok, true);
  const i = util.porId(store.get().instrumentos, 'TCL-AC-012');
  assert.equal(i.ultimaCalibracao, '2026-07-10');
  assert.equal(i.documentos.length, 0);
  assert.match(r.registro.observacao, /link do certificado não gravado/);
});

/* ---- Dados salvos antes dos documentos ---- */

test('dados salvos antes dos anexos recebem a lista vazia', () => {
  const base = dados.seed();
  base.demandas = [{ id: 'DM-1', testeId: 'TP-1', status: 'SOLICITADA', historico: [] }];
  base.instrumentos.forEach((i) => { delete i.documentos; });

  store.importar(JSON.stringify(base));
  const estado = store.get();

  assert.deepEqual(estado.demandas[0].documentos, []);
  assert.deepEqual(util.porId(estado.instrumentos, 'TCL-AC-012').documentos, []);
});
