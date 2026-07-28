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
  const peca = store.get().pecas[0];
  const item = cotacoes.montarItem(teste, 2, peca);

  const esperadoUnitario =
    (teste.horasSetup + teste.horasEnsaio + teste.horasReport) * teste.hourlyRate +
    teste.custoInsumos + teste.amostras * peca.custoAmostra;

  assert.equal(item.custoUnitario, esperadoUnitario);
  assert.equal(item.total, esperadoUnitario * 2);
  assert.equal(item.revisao, teste.revisao, 'a revisão vigente fica registrada');
});

test('mudar o catálogo depois não reescreve cotação arquivada', () => {
  store.restaurarPadrao();
  const teste = store.get().testes[0];
  const item = cotacoes.montarItem(teste, 1, null);
  const cotacao = store.salvarCotacao({ clienteId: 'CLI-VW', itens: [item] });
  const totalOriginal = cotacoes.totalDaCotacao(cotacao);

  store.salvarTeste(Object.assign({}, teste, { hourlyRate: teste.hourlyRate * 3 }));

  const arquivada = globalThis.TC.util.porId(store.get().cotacoes, cotacao.id);
  assert.equal(cotacoes.totalDaCotacao(arquivada), totalOriginal,
    'o orçamento entregue não muda quando o catálogo sobe de preço');
});

test('sem peça de referência, a cotação não cobra amostras', () => {
  store.restaurarPadrao();
  const teste = store.get().testes[0];
  const semPeca = cotacoes.montarItem(teste, 1, null);
  assert.equal(semPeca.custoAmostras, 0);
  assert.equal(semPeca.custoUnitario, semPeca.custoHoras + semPeca.custoInsumos);
});

test('total da cotação soma os itens', () => {
  store.restaurarPadrao();
  const testes = store.get().testes;
  const itens = [
    cotacoes.montarItem(testes[0], 2, null),
    cotacoes.montarItem(testes[1], 1, null)
  ];
  const total = cotacoes.totalDaCotacao({ itens: itens });
  assert.equal(total, itens[0].total + itens[1].total);
});
