/* Testes de perfil, permissões e cotações. */
const test = require('node:test');
const assert = require('node:assert');

require('../src/util.js');
const dados = require('../src/data.js');
require('../src/scheduler.js');
const permissoes = require('../src/permissoes.js');
require('../src/store.js');

const store = globalThis.TC.store;

function comPerfil(perfil) {
  store.restaurarPadrao();
  store.definirPerfil(perfil);
  return store.get();
}

test('o padrão separa o que cada perfil enxerga', () => {
  const produto = comPerfil('PRODUTO');
  assert.equal(permissoes.podeVer(produto, 'catalogo'), true, 'produto precisa ver o catálogo para pedir teste');
  assert.equal(permissoes.podeVer(produto, 'cotacoes'), true);
  assert.equal(permissoes.podeVer(produto, 'demandas'), true);
  assert.equal(permissoes.podeVer(produto, 'planejamento'), true);
  assert.equal(permissoes.podeVer(produto, 'painel'), false, 'KPI é do centro de testes');
  assert.equal(permissoes.podeVer(produto, 'equipamentos'), false);
  assert.equal(permissoes.podeVer(produto, 'pecas'), false);
  assert.equal(permissoes.podeVer(produto, 'clientes'), false);
  assert.equal(permissoes.podeVer(produto, 'permissoes'), false);

  const testes = comPerfil('TESTES');
  ['catalogo', 'cotacoes', 'demandas', 'planejamento', 'painel', 'clientes', 'equipamentos', 'pecas', 'permissoes']
    .forEach((rota) => assert.equal(permissoes.podeVer(testes, rota), true, rota));
});

test('produto pede teste e cotação, mas não mexe no catálogo nem no planejamento', () => {
  const produto = comPerfil('PRODUTO');
  assert.equal(permissoes.podeEditar(produto, 'cotacoes'), true);
  assert.equal(permissoes.podeEditar(produto, 'demandas'), true);
  assert.equal(permissoes.podeEditar(produto, 'catalogo'), false);
  assert.equal(permissoes.podeEditar(produto, 'planejamento'), false);
});

test('quem não vê a janela também não edita, mesmo se marcado', () => {
  const estado = comPerfil('PRODUTO');
  estado.permissoes.painel.editar.push('PRODUTO');
  assert.equal(permissoes.podeVer(estado, 'painel'), false);
  assert.equal(permissoes.podeEditar(estado, 'painel'), false, 'editar sem ver não vale');
});

test('marcar editar liga ver junto, e desmarcar ver desliga editar', () => {
  comPerfil('PRODUTO');
  store.definirPermissao('painel', 'editar', 'PRODUTO', true);
  let regra = store.get().permissoes.painel;
  assert.ok(regra.ver.includes('PRODUTO'), 'ver foi ligado junto');
  assert.ok(regra.editar.includes('PRODUTO'));

  store.definirPermissao('painel', 'ver', 'PRODUTO', false);
  regra = store.get().permissoes.painel;
  assert.ok(!regra.ver.includes('PRODUTO'));
  assert.ok(!regra.editar.includes('PRODUTO'), 'editar caiu junto');
});

test('restaurar permissões volta à matriz padrão', () => {
  comPerfil('TESTES');
  store.definirPermissao('equipamentos', 'ver', 'PRODUTO', true);
  assert.ok(store.get().permissoes.equipamentos.ver.includes('PRODUTO'));
  store.restaurarPermissoes();
  assert.ok(!store.get().permissoes.equipamentos.ver.includes('PRODUTO'));
});

test('estado antigo sem permissões nem cotações recebe o padrão', () => {
  const base = dados.seed();
  delete base.permissoes;
  delete base.cotacoes;
  delete base.perfilAtual;

  store.importar(JSON.stringify(base));
  const estado = store.get();
  assert.deepEqual(estado.cotacoes, []);
  assert.equal(estado.perfilAtual, 'TESTES');
  assert.deepEqual(estado.permissoes.painel.ver, ['TESTES']);
});

test('perfil inválido gravado volta para o de testes', () => {
  const base = dados.seed();
  base.perfilAtual = 'FANTASMA';
  store.importar(JSON.stringify(base));
  assert.equal(store.get().perfilAtual, 'TESTES');
});

/* ---- Cotações ---- */

/* A view não exporta módulo: carrega por efeito colateral e registra em TC.views. */
require('../src/views/cotacoes.js');
const cotacoes = globalThis.TC.views.cotacoes;

test('numeração de cotação é sequencial por ano', () => {
  store.restaurarPadrao();
  const primeira = store.proximoNumeroCotacao();
  assert.match(primeira, /^COT-\d{4}-0001$/);

  store.salvarCotacao({ clienteId: 'CLI-VW', itens: [] });
  assert.match(store.proximoNumeroCotacao(), /-0002$/);
  store.salvarCotacao({ clienteId: 'CLI-VW', itens: [] });
  assert.match(store.proximoNumeroCotacao(), /-0003$/);
});

test('o item da cotação congela o preço do procedimento', () => {
  store.restaurarPadrao();
  const teste = store.get().testes[0];
  const item = cotacoes.montarItem(teste, 2);

  const esperadoUnitario =
    (teste.horasSetup + teste.horasEnsaio + teste.horasReport) * teste.hourlyRate +
    teste.custoInsumos;

  assert.equal(item.custoUnitario, esperadoUnitario, 'o unitário é o custo do procedimento');
  assert.equal(item.amostras, 2);
  assert.equal(item.total, esperadoUnitario * 2, 'cada amostra é uma execução');
  assert.equal(item.revisao, teste.revisao, 'a revisão vigente fica registrada');
});

test('quantidade de amostras inválida vira uma', () => {
  store.restaurarPadrao();
  const teste = store.get().testes[0];
  assert.equal(cotacoes.montarItem(teste, 0).amostras, 1);
  assert.equal(cotacoes.montarItem(teste, '').amostras, 1);
  assert.equal(cotacoes.montarItem(teste, -3).amostras, 1);
  assert.equal(cotacoes.montarItem(teste, '4').amostras, 4, 'texto de input vira número');
});

test('mudar o catálogo depois não reescreve cotação arquivada', () => {
  store.restaurarPadrao();
  const teste = store.get().testes[0];
  const item = cotacoes.montarItem(teste, 1);
  const cotacao = store.salvarCotacao({ clienteId: 'CLI-VW', itens: [item] });
  const totalOriginal = cotacoes.totalDaCotacao(cotacao);

  store.salvarTeste(Object.assign({}, teste, { hourlyRate: teste.hourlyRate * 3 }));

  const arquivada = globalThis.TC.util.porId(store.get().cotacoes, cotacao.id);
  assert.equal(cotacoes.totalDaCotacao(arquivada), totalOriginal,
    'o orçamento entregue não muda quando o catálogo sobe de preço');
});

test('o unitário é horas x rate + insumos, sem custo de amostra embutido', () => {
  store.restaurarPadrao();
  const item = cotacoes.montarItem(store.get().testes[0], 1);
  assert.equal(item.custoUnitario, item.custoHoras + item.custoInsumos);
  assert.equal(item.custoAmostras, undefined, 'a peça de referência saiu do modelo');
});

test('cotação arquivada no formato antigo é migrada sem mudar o total', () => {
  const base = dados.seed();
  base.cotacoes = [{
    id: 'COT-velha', numero: 'COT-2025-0001', clienteId: 'CLI-VW', pecaId: 'PC-HOT',
    projeto: 'P1', partNumber: 'PN-1', solicitante: 'Alguém', status: 'ENVIADA',
    criadoEm: '2025-05-10',
    itens: [{
      testeId: 'TP-HOT-01', nome: 'Antigo', revisao: 'Rev. 01', norma: '',
      horasBancada: 10, horasReport: 2, horasFaturaveis: 12, hourlyRate: 100,
      custoHoras: 1200, custoInsumos: 300, amostras: 2, custoAmostras: 500,
      custoUnitario: 2000, quantidade: 3, total: 6000
    }]
  }];

  store.importar(JSON.stringify(base));
  const c = store.get().cotacoes[0];

  assert.equal(c.pecaId, undefined, 'a peça de referência sai do cabeçalho');
  assert.equal(c.lti, '');
  assert.equal(c.previsaoExecucao, '');
  assert.equal(c.itens[0].quantidade, undefined, 'quantidade virou amostras');
  assert.equal(c.itens[0].amostras, 3, 'a quantidade antiga passa a ser a de amostras');
  assert.equal(c.itens[0].custoAmostras, 500, 'o custo antigo fica, para o total reconciliar');
  assert.equal(cotacoes.totalDaCotacao(c), 6000, 'preço congelado não é recalculado');
});

test('total da cotação soma os itens', () => {
  store.restaurarPadrao();
  const testes = store.get().testes;
  const itens = [
    cotacoes.montarItem(testes[0], 2),
    cotacoes.montarItem(testes[1], 1)
  ];
  const total = cotacoes.totalDaCotacao({ itens: itens });
  assert.equal(total, itens[0].total + itens[1].total);
});
