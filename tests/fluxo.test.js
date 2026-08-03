/* Testes dos fluxos: quem pode mover o quê, o que cada passagem exige e o histórico. */
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

/* O relatório anexado é o que libera "Enviar relatório". Sai daqui para não repetir a
   colagem do link em cada teste que só quer chegar ao fim do fluxo. */
function anexarRelatorio(demandaId) {
  return store.anexarDocumento('demanda', demandaId, {
    tipo: 'RELATORIO', nome: 'Relatório LTI-1',
    link: 'https://empresa.sharepoint.com/testes/LTI-1.pdf'
  });
}

/* Uma demanda pronta para percorrer o fluxo. */
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

/* ---- Desenho do fluxo ---- */

test('a demanda nasce solicitada pelo cliente interno', () => {
  const d = novaDemanda();
  assert.equal(d.status, 'SOLICITADA');
  assert.deepEqual(d.historico, [], 'nenhuma passagem ainda');
});

test('o fluxo da demanda não tem estado sem saída além dos finais', () => {
  const finais = ['VALIDADA', 'CANCELADA'];
  fluxo.estados('demanda').forEach((e) => {
    const saidas = fluxo.transicoesDe('demanda', e.id);
    if (finais.includes(e.id)) {
      assert.equal(saidas.length, 0, e.id + ' é final e não deveria ter saída');
    } else {
      assert.ok(saidas.length > 0, e.id + ' ficou sem saída');
    }
  });
});

test('toda transição aponta para um estado que existe', () => {
  ['demanda', 'cotacao'].forEach((tipo) => {
    const ids = fluxo.estados(tipo).map((e) => e.id);
    fluxo.fluxo(tipo).transicoes.forEach((t) => {
      assert.ok(ids.includes(t.de), tipo + ': origem inexistente ' + t.de);
      assert.ok(ids.includes(t.para), tipo + ': destino inexistente ' + t.para);
    });
  });
});

test('só disputam bancada os estados anteriores à conclusão', () => {
  assert.deepEqual(fluxo.estadosAtivos(), ['SOLICITADA', 'ACEITA', 'EM_EXECUCAO']);
  assert.deepEqual(globalThis.TC.scheduler.STATUS_ATIVOS, fluxo.estadosAtivos(),
    'o planejamento usa exatamente a lista do fluxo');
});

/* ---- Quem pode o quê ---- */

test('aceitar a demanda é do centro de testes, validar o relatório é do cliente', () => {
  assert.ok(fluxo.podeTransicionar('demanda', 'SOLICITADA', 'ACEITA', 'TESTES'));
  assert.ok(!fluxo.podeTransicionar('demanda', 'SOLICITADA', 'ACEITA', 'PRODUTO'));

  assert.ok(fluxo.podeTransicionar('demanda', 'RELATORIO_ENVIADO', 'VALIDADA', 'PRODUTO'));
  assert.ok(!fluxo.podeTransicionar('demanda', 'RELATORIO_ENVIADO', 'VALIDADA', 'TESTES'),
    'quem executa o ensaio não valida o próprio relatório');
});

test('cancelar é de qualquer perfil, enquanto o ensaio não terminou', () => {
  assert.ok(fluxo.podeTransicionar('demanda', 'ACEITA', 'CANCELADA', 'PRODUTO'));
  assert.ok(fluxo.podeTransicionar('demanda', 'ACEITA', 'CANCELADA', 'TESTES'));
  assert.ok(!fluxo.podeTransicionar('demanda', 'CONCLUIDA', 'CANCELADA', 'TESTES'),
    'ensaio já executado não se cancela: ele custou bancada');
});

test('o centro de testes não aprova a própria cotação em nome do cliente', () => {
  assert.ok(fluxo.podeTransicionar('cotacao', 'EM_ANALISE', 'VALIDADA', 'TESTES'));
  assert.ok(!fluxo.podeTransicionar('cotacao', 'VALIDADA', 'APROVADA', 'TESTES'));
  assert.ok(fluxo.podeTransicionar('cotacao', 'VALIDADA', 'APROVADA', 'PRODUTO'));
});

/* ---- Passagens de verdade, pelo store ---- */

test('o caminho completo da demanda, do pedido à validação', () => {
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
  assert.equal(final.relatorioCorrecoes, 0, 'certo da primeira vez');
  assert.equal(final.historico.length, 5, 'uma linha por passagem');
  assert.deepEqual(final.historico.map((h) => h.para),
    ['ACEITA', 'EM_EXECUCAO', 'CONCLUIDA', 'RELATORIO_ENVIADO', 'VALIDADA']);
});

test('o histórico registra quem fez cada passagem', () => {
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

test('pedir correção conta a rodada e devolve ao centro de testes', () => {
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
  assert.equal(final.relatorioCorrecoes, 2, 'cada devolução conta uma rodada');
});

test('a passagem é recusada quando o perfil não é o dono dela', () => {
  const d = novaDemanda();
  comPerfil('PRODUTO');
  const r = store.moverDemanda(d.id, 'ACEITA');

  assert.equal(r.ok, false);
  assert.match(r.motivo, /Test Engineer/);
  assert.equal(globalThis.TC.util.porId(store.get().demandas, d.id).status, 'SOLICITADA',
    'nada muda quando a passagem é recusada');
});

test('não se pula etapa: da solicitação direto para concluída não existe', () => {
  const d = novaDemanda();
  comPerfil('TESTES');
  const r = store.moverDemanda(d.id, 'CONCLUIDA', { dataConclusao: '2026-08-20' });

  assert.equal(r.ok, false);
  assert.match(r.motivo, /no move from/);
});

test('concluir sem data de conclusão é recusado', () => {
  const d = novaDemanda();
  comPerfil('TESTES');
  store.moverDemanda(d.id, 'ACEITA');
  store.moverDemanda(d.id, 'EM_EXECUCAO');

  const r = store.moverDemanda(d.id, 'CONCLUIDA', {});
  assert.equal(r.ok, false);
  assert.match(r.motivo, /dataConclusao/, 'o indicador do mês depende dessa data');
  assert.equal(globalThis.TC.util.porId(store.get().demandas, d.id).status, 'EM_EXECUCAO');
});

test('devolver e recusar exigem justificativa registrada', () => {
  const d = novaDemanda();
  comPerfil('TESTES');
  const r = store.moverDemanda(d.id, 'CANCELADA', {});
  assert.equal(r.ok, false);
  assert.match(r.motivo, /reason/i);

  assert.ok(store.moverDemanda(d.id, 'CANCELADA', { nota: 'programa cancelado' }).ok);
});

/* ---- Fluxo da cotação ---- */

test('o caminho completo da cotação, do pedido à aprovação', () => {
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

test('cotação devolvida volta ao solicitante e pode ser reenviada', () => {
  store.restaurarPadrao();
  comPerfil('PRODUTO');
  const c = store.salvarCotacao({ clienteId: 'CLI-GM', itens: [] });
  store.moverCotacao(c.id, 'SOLICITADA');

  comPerfil('TESTES');
  store.moverCotacao(c.id, 'EM_ANALISE');
  const semNota = store.moverCotacao(c.id, 'DEVOLVIDA', {});
  assert.equal(semNota.ok, false, 'devolver sem dizer o que falta não ajuda ninguém');

  assert.ok(store.moverCotacao(c.id, 'DEVOLVIDA', { nota: 'falta o part number' }).ok);

  comPerfil('PRODUTO');
  assert.ok(store.moverCotacao(c.id, 'SOLICITADA').ok);
  assert.equal(globalThis.TC.util.porId(store.get().cotacoes, c.id).status, 'SOLICITADA');
});

/* ---- Migração dos status antigos ---- */

test('status antigos de demanda viram estados do fluxo', () => {
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
  assert.equal(porId('C').status, 'VALIDADA', 'concluído com relatório aprovado já está validado');
  assert.equal(porId('D').status, 'EM_CORRECAO');
  assert.equal(porId('E').status, 'CANCELADA');
  store.get().demandas.forEach((d) => {
    assert.equal(d.relatorioStatus, undefined, 'o campo separado saiu do modelo');
    assert.ok(Array.isArray(d.historico));
  });
});

test('status antigos de cotação viram estados do fluxo', () => {
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
