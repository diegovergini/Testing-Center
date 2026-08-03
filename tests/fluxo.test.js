/* Workflow tests: who can move what, what each move requires and the history. */
const test = require('node:test');
const assert = require('node:assert');

require('../src/util.js');
const dados = require('../src/data.js');
const fluxo = require('../src/fluxo.js');
require('../src/documentos.js');
require('../src/scheduler.js');
require('../src/permissoes.js');
require('../src/store.js');

const store = globalThis.TC.store;

function comPerfil(perfil) {
  store.definirPerfil(perfil);
}

/* An attached report is what unlocks "Send report". It lives here so the link paste is not
   repeated in every test that only wants to reach the end of the workflow. */
function anexarRelatorio(demandaId) {
  return store.anexarDocumento('demanda', demandaId, {
    tipo: 'RELATORIO', nome: 'Report LTI-1',
    link: 'https://empresa.sharepoint.com/testes/LTI-1.pdf'
  });
}

/* A request ready to walk the workflow. */
function novaDemanda() {
  store.restaurarPadrao();
  const teste = store.get().testes[0];
  store.salvarTeste(Object.assign({}, teste, {
    equipamentoGrupos: ['Burner'], horasSetup: 2, horasEnsaio: 8, horasReport: 2
  }));
  return store.criarDemanda({
    testeId: teste.id, pecaId: store.get().pecas[0].id, clienteId: 'CLI-GM',
    projeto: 'Onix', partNumber: 'PN-1', lti: 'LTI-1', tipoLti: 'PV',
    prioridade: 'MEDIA', quantidade: 1, dataAmostras: '2026-08-03', prazo: '2026-12-01'
  });
}

/* ---- Shape of the workflow ---- */

test('a request is born requested by the internal customer', () => {
  const d = novaDemanda();
  assert.equal(d.status, 'SOLICITADA');
  assert.deepEqual(d.historico, [], 'no move yet');
});

test('the request workflow has no dead-end state other than the final ones', () => {
  const finais = ['VALIDADA', 'CANCELADA'];
  fluxo.estados('demanda').forEach((e) => {
    const saidas = fluxo.transicoesDe('demanda', e.id);
    if (finais.includes(e.id)) {
      assert.equal(saidas.length, 0, e.id + ' is final and should have no way out');
    } else {
      assert.ok(saidas.length > 0, e.id + ' was left with no way out');
    }
  });
});

test('every transition points at a state that exists', () => {
  ['demanda', 'cotacao'].forEach((tipo) => {
    const ids = fluxo.estados(tipo).map((e) => e.id);
    fluxo.fluxo(tipo).transicoes.forEach((t) => {
      assert.ok(ids.includes(t.de), tipo + ': origem inexistente ' + t.de);
      assert.ok(ids.includes(t.para), tipo + ': destino inexistente ' + t.para);
    });
  });
});

test('only the states before completion compete for a rig', () => {
  assert.deepEqual(fluxo.estadosAtivos(), ['SOLICITADA', 'ACEITA', 'EM_EXECUCAO']);
  assert.deepEqual(globalThis.TC.scheduler.STATUS_ATIVOS, fluxo.estadosAtivos(),
    'o planejamento usa exatamente a lista do fluxo');
});

/* ---- Who can do what ---- */

test('accepting the request belongs to the test centre, signing off the report to the customer', () => {
  assert.ok(fluxo.podeTransicionar('demanda', 'SOLICITADA', 'ACEITA', 'TESTES'));
  assert.ok(!fluxo.podeTransicionar('demanda', 'SOLICITADA', 'ACEITA', 'PRODUTO'));

  assert.ok(fluxo.podeTransicionar('demanda', 'RELATORIO_ENVIADO', 'VALIDADA', 'PRODUTO'));
  assert.ok(!fluxo.podeTransicionar('demanda', 'RELATORIO_ENVIADO', 'VALIDADA', 'TESTES'),
    'whoever runs the test does not sign off their own report');
});

test('cancelling belongs to any role, as long as the test has not finished', () => {
  assert.ok(fluxo.podeTransicionar('demanda', 'ACEITA', 'CANCELADA', 'PRODUTO'));
  assert.ok(fluxo.podeTransicionar('demanda', 'ACEITA', 'CANCELADA', 'TESTES'));
  assert.ok(!fluxo.podeTransicionar('demanda', 'CONCLUIDA', 'CANCELADA', 'TESTES'),
    'a test already run is not cancelled: it cost rig time');
});

test('the test centre does not approve its own quote on the customer\'s behalf', () => {
  assert.ok(fluxo.podeTransicionar('cotacao', 'EM_ANALISE', 'VALIDADA', 'TESTES'));
  assert.ok(!fluxo.podeTransicionar('cotacao', 'VALIDADA', 'APROVADA', 'TESTES'));
  assert.ok(fluxo.podeTransicionar('cotacao', 'VALIDADA', 'APROVADA', 'PRODUTO'));
});

/* ---- Real moves, through the store ---- */

test('the full path of a request, from the ask to the sign-off', () => {
  const d = novaDemanda();

  comPerfil('TESTES');
  assert.ok(store.moverDemanda(d.id, 'ACEITA').ok);
  assert.ok(store.moverDemanda(d.id, 'EM_EXECUCAO').ok);
  assert.ok(store.moverDemanda(d.id, 'CONCLUIDA', { dataConclusao: '2026-08-20' }).ok);
  assert.ok(anexarRelatorio(d.id).ok);
  assert.ok(store.moverDemanda(d.id, 'RELATORIO_ENVIADO').ok);

  comPerfil('PRODUTO');
  assert.ok(store.moverDemanda(d.id, 'VALIDADA', { dataRelatorio: '2026-08-28' }).ok);

  const final = globalThis.TC.util.porId(store.get().demandas, d.id);
  assert.equal(final.status, 'VALIDADA');
  assert.equal(final.dataConclusao, '2026-08-20');
  assert.equal(final.dataRelatorio, '2026-08-28');
  assert.equal(final.relatorioCorrecoes, 0, 'right first time');
  assert.equal(final.historico.length, 5, 'one line per move');
  assert.deepEqual(final.historico.map((h) => h.para),
    ['ACEITA', 'EM_EXECUCAO', 'CONCLUIDA', 'RELATORIO_ENVIADO', 'VALIDADA']);
});

test('the history records who made each move', () => {
  const d = novaDemanda();
  comPerfil('TESTES');
  store.moverDemanda(d.id, 'ACEITA', { nota: 'amostras confirmadas' });

  const h = globalThis.TC.util.porId(store.get().demandas, d.id).historico[0];
  assert.equal(h.de, 'SOLICITADA');
  assert.equal(h.para, 'ACEITA');
  assert.equal(h.perfil, 'TESTES');
  assert.equal(h.nota, 'amostras confirmadas');
  assert.equal(h.em, globalThis.TC.util.hoje());
});

test('requesting rework counts the round and sends it back to the test centre', () => {
  const d = novaDemanda();
  comPerfil('TESTES');
  store.moverDemanda(d.id, 'ACEITA');
  store.moverDemanda(d.id, 'EM_EXECUCAO');
  store.moverDemanda(d.id, 'CONCLUIDA', { dataConclusao: '2026-08-20' });
  anexarRelatorio(d.id);
  store.moverDemanda(d.id, 'RELATORIO_ENVIADO');

  comPerfil('PRODUTO');
  assert.ok(store.moverDemanda(d.id, 'EM_CORRECAO', { nota: 'faltou a curva de temperatura' }).ok);
  assert.equal(globalThis.TC.util.porId(store.get().demandas, d.id).relatorioCorrecoes, 1);

  comPerfil('TESTES');
  store.moverDemanda(d.id, 'RELATORIO_ENVIADO');
  comPerfil('PRODUTO');
  store.moverDemanda(d.id, 'EM_CORRECAO', { nota: 'ainda falta a foto do corpo de prova' });

  const final = globalThis.TC.util.porId(store.get().demandas, d.id);
  assert.equal(final.relatorioCorrecoes, 2, 'each return counts one round');
});

test('the move is refused when the role does not own it', () => {
  const d = novaDemanda();
  comPerfil('PRODUTO');
  const r = store.moverDemanda(d.id, 'ACEITA');

  assert.equal(r.ok, false);
  assert.match(r.motivo, /Test Engineer/);
  assert.equal(globalThis.TC.util.porId(store.get().demandas, d.id).status, 'SOLICITADA',
    'nothing changes when the move is refused');
});

test('no step is skipped: requested straight to completed does not exist', () => {
  const d = novaDemanda();
  comPerfil('TESTES');
  const r = store.moverDemanda(d.id, 'CONCLUIDA', { dataConclusao: '2026-08-20' });

  assert.equal(r.ok, false);
  assert.match(r.motivo, /no move from/);
});

test('completing without a completion date is refused', () => {
  const d = novaDemanda();
  comPerfil('TESTES');
  store.moverDemanda(d.id, 'ACEITA');
  store.moverDemanda(d.id, 'EM_EXECUCAO');

  const r = store.moverDemanda(d.id, 'CONCLUIDA', {});
  assert.equal(r.ok, false);
  assert.match(r.motivo, /dataConclusao/, 'the month indicator depends on this date');
  assert.equal(globalThis.TC.util.porId(store.get().demandas, d.id).status, 'EM_EXECUCAO');
});

test('returning and declining require a recorded justification', () => {
  const d = novaDemanda();
  comPerfil('TESTES');
  const r = store.moverDemanda(d.id, 'CANCELADA', {});
  assert.equal(r.ok, false);
  assert.match(r.motivo, /reason/i);

  assert.ok(store.moverDemanda(d.id, 'CANCELADA', { nota: 'programa cancelado' }).ok);
});

/* ---- Quote workflow ---- */

test('the full path of a quote, from the ask to approval', () => {
  store.restaurarPadrao();
  comPerfil('PRODUTO');
  const c = store.salvarCotacao({ clienteId: 'CLI-GM', projeto: 'Onix', itens: [] });
  assert.equal(c.status, 'RASCUNHO');

  assert.ok(store.moverCotacao(c.id, 'SOLICITADA').ok);
  comPerfil('TESTES');
  assert.ok(store.moverCotacao(c.id, 'EM_ANALISE').ok);
  assert.ok(store.moverCotacao(c.id, 'VALIDADA').ok);
  comPerfil('PRODUTO');
  assert.ok(store.moverCotacao(c.id, 'APROVADA').ok);

  const final = globalThis.TC.util.porId(store.get().cotacoes, c.id);
  assert.equal(final.status, 'APROVADA');
  assert.deepEqual(final.historico.map((h) => h.para),
    ['SOLICITADA', 'EM_ANALISE', 'VALIDADA', 'APROVADA']);
  assert.deepEqual(final.historico.map((h) => h.perfil),
    ['PRODUTO', 'TESTES', 'TESTES', 'PRODUTO']);
});

test('a returned quote goes back to the requester and can be resent', () => {
  store.restaurarPadrao();
  comPerfil('PRODUTO');
  const c = store.salvarCotacao({ clienteId: 'CLI-GM', itens: [] });
  store.moverCotacao(c.id, 'SOLICITADA');

  comPerfil('TESTES');
  store.moverCotacao(c.id, 'EM_ANALISE');
  const semNota = store.moverCotacao(c.id, 'DEVOLVIDA', {});
  assert.equal(semNota.ok, false, 'returning without saying what is missing helps nobody');

  assert.ok(store.moverCotacao(c.id, 'DEVOLVIDA', { nota: 'falta o part number' }).ok);

  comPerfil('PRODUTO');
  assert.ok(store.moverCotacao(c.id, 'SOLICITADA').ok);
  assert.equal(globalThis.TC.util.porId(store.get().cotacoes, c.id).status, 'SOLICITADA');
});

/* ---- Migration of the old statuses ---- */

test('old request statuses become workflow states', () => {
  const base = dados.seed();
  base.demandas = [
    { id: 'A', testeId: base.testes[0].id, pecaId: 'PC-HOT', clienteId: 'CLI-GM',
      tipoLti: 'DV', lti: 'L1', prioridade: 'MEDIA', quantidade: 1,
      status: 'PENDENTE', dataAmostras: '2026-08-01' },
    { id: 'B', testeId: base.testes[0].id, pecaId: 'PC-HOT', clienteId: 'CLI-GM',
      tipoLti: 'DV', lti: 'L2', prioridade: 'MEDIA', quantidade: 1,
      status: 'EM_ANDAMENTO', dataAmostras: '2026-08-01' },
    { id: 'C', testeId: base.testes[0].id, pecaId: 'PC-HOT', clienteId: 'CLI-GM',
      tipoLti: 'DV', lti: 'L3', prioridade: 'MEDIA', quantidade: 1,
      status: 'CONCLUIDO', dataAmostras: '2026-08-01',
      relatorioStatus: 'APROVADO', dataRelatorio: '2026-09-01', relatorioCorrecoes: 0 },
    { id: 'D', testeId: base.testes[0].id, pecaId: 'PC-HOT', clienteId: 'CLI-GM',
      tipoLti: 'DV', lti: 'L4', prioridade: 'MEDIA', quantidade: 1,
      status: 'CONCLUIDO', dataAmostras: '2026-08-01', relatorioStatus: 'CORRECAO' },
    { id: 'E', testeId: base.testes[0].id, pecaId: 'PC-HOT', clienteId: 'CLI-GM',
      tipoLti: 'DV', lti: 'L5', prioridade: 'MEDIA', quantidade: 1,
      status: 'CANCELADO', dataAmostras: '2026-08-01' }
  ];
  store.importar(JSON.stringify(base));
  const porId = (id) => globalThis.TC.util.porId(store.get().demandas, id);

  assert.equal(porId('A').status, 'SOLICITADA');
  assert.equal(porId('B').status, 'EM_EXECUCAO');
  assert.equal(porId('C').status, 'VALIDADA', 'completed with an approved report is already signed off');
  assert.equal(porId('D').status, 'EM_CORRECAO');
  assert.equal(porId('E').status, 'CANCELADA');
  store.get().demandas.forEach((d) => {
    assert.equal(d.relatorioStatus, undefined, 'o campo separado saiu do modelo');
    assert.ok(Array.isArray(d.historico));
  });
});

test('old quote statuses become workflow states', () => {
  const base = dados.seed();
  base.cotacoes = [
    { id: 'C1', numero: 'COT-2025-0001', clienteId: 'CLI-GM', status: 'ABERTA', itens: [] },
    { id: 'C2', numero: 'COT-2025-0002', clienteId: 'CLI-GM', status: 'ENVIADA', itens: [] },
    { id: 'C3', numero: 'COT-2025-0003', clienteId: 'CLI-GM', status: 'APROVADA', itens: [] }
  ];
  store.importar(JSON.stringify(base));
  const status = store.get().cotacoes.map((c) => c.status);
  assert.deepEqual(status, ['RASCUNHO', 'SOLICITADA', 'APROVADA']);
});
