/* Testes do estado: migração de fases antigas e integridade ao remover cadastros. */
const test = require('node:test');
const assert = require('node:assert');

require('../src/util.js');
const dados = require('../src/data.js');
require('../src/store.js');

const store = globalThis.TC.store;

function comDadosAntigos() {
  const base = dados.seed();
  base.testes[0].fases = ['CONCEITO', 'DV'];
  base.testes[1].fases = ['PPAP', 'SERIE'];
  base.testes[2].fases = ['CONCEITO'];
  base.demandas = [
    { id: 'D1', testeId: base.testes[0].id, pecaId: base.pecas[0].id, clienteId: base.clientes[0].id,
      fase: 'PPAP', prioridade: 'MEDIA', quantidade: 1, status: 'PENDENTE', criadoEm: '2026-07-06' }
  ];
  return JSON.stringify(base);
}

test('importar converte as fases antigas para DV, PV e VAVE', () => {
  store.init();
  store.importar(comDadosAntigos());
  const estado = store.get();

  assert.deepEqual(estado.testes[0].fases, ['DV'], 'CONCEITO vira DV e não duplica o DV existente');
  assert.deepEqual(estado.testes[1].fases, ['PV', 'VAVE']);
  assert.deepEqual(estado.testes[2].fases, ['DV']);
  assert.equal(estado.demandas[0].tipoLti, 'PV', 'a antiga fase da demanda vira a classificação da LTI');
  assert.equal(estado.demandas[0].fase, undefined, 'o campo fase não existe mais na demanda');
  assert.equal(estado.demandas[0].lti, '', 'LTI sem número fica em branco para ser preenchida');

  const validas = dados.FASES.map((f) => f.id);
  estado.testes.forEach((t) => {
    assert.ok(t.fases.length, t.id + ' ficou sem fase');
    t.fases.forEach((f) => assert.ok(validas.includes(f), t.id + ' manteve fase inválida ' + f));
  });
});

test('procedimento que só tinha fases desconhecidas não fica sem fase', () => {
  const base = dados.seed();
  base.testes[0].fases = ['FASE_QUE_NAO_EXISTE'];
  store.importar(JSON.stringify(base));
  assert.deepEqual(store.get().testes[0].fases, ['DV']);
});

test('remover cliente também o tira da exigência dos procedimentos', () => {
  store.restaurarPadrao();
  const alvo = 'CLI-VW';
  const antes = store.get().testes.filter((t) => (t.clientes || []).includes(alvo));
  assert.ok(antes.length > 0, 'o catálogo de exemplo precisa ter procedimentos deste cliente');

  store.removerCliente(alvo);
  const estado = store.get();

  assert.equal(estado.clientes.filter((c) => c.id === alvo).length, 0);
  estado.testes.forEach((t) => {
    assert.ok(!(t.clientes || []).includes(alvo), t.id + ' ainda aponta para o cliente removido');
  });
});

test('salvar cliente novo gera código e editar preserva o existente', () => {
  store.restaurarPadrao();
  const total = store.get().clientes.length;

  const novo = store.salvarCliente({ nome: 'Marelli', segmento: 'Tier 1' });
  assert.ok(novo.id, 'cliente novo precisa de código');
  assert.equal(store.get().clientes.length, total + 1);

  store.salvarCliente({ id: novo.id, nome: 'Marelli Brasil', segmento: 'Tier 1' });
  assert.equal(store.get().clientes.length, total + 1, 'editar não pode criar outro registro');
  assert.equal(globalThis.TC.util.porId(store.get().clientes, novo.id).nome, 'Marelli Brasil');
});

test('remover equipamento deixa os procedimentos visíveis, mas sem bancada', () => {
  store.restaurarPadrao();
  const dependentes = store.get().testes.filter((t) => t.equipamentoId === 'CCT-01').length;
  assert.ok(dependentes > 0);

  store.removerEquipamento('CCT-01');
  const estado = store.get();
  assert.equal(estado.equipamentos.filter((e) => e.id === 'CCT-01').length, 0);
  assert.equal(estado.testes.filter((t) => t.equipamentoId === 'CCT-01').length, dependentes,
    'os procedimentos continuam no catálogo para serem reapontados');
});
