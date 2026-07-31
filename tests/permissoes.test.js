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

/* O catálogo de partida chega com horas e valores zerados — quem cadastra preenche
   depois. Cotação com preço zero não prova nada, então completamos um procedimento
   antes de cotar. */
function procedimentoPrecificado() {
  store.restaurarPadrao();
  const base = store.get().testes[0];
  return store.salvarTeste(Object.assign({}, base, {
    equipamentoGrupos: ['Burner'],
    horasSetup: 8, horasEnsaio: 240, horasReport: 16,
    hourlyRate: 610, custoInsumos: 12800
  }));
}

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
  const teste = procedimentoPrecificado();
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
  const teste = procedimentoPrecificado();
  assert.equal(cotacoes.montarItem(teste, 0).amostras, 1);
  assert.equal(cotacoes.montarItem(teste, '').amostras, 1);
  assert.equal(cotacoes.montarItem(teste, -3).amostras, 1);
  assert.equal(cotacoes.montarItem(teste, '4').amostras, 4, 'texto de input vira número');
});

test('mudar o catálogo depois não reescreve cotação arquivada', () => {
  const teste = procedimentoPrecificado();
  const item = cotacoes.montarItem(teste, 1);
  const cotacao = store.salvarCotacao({ clienteId: 'CLI-VW', itens: [item] });
  const totalOriginal = cotacoes.totalDaCotacao(cotacao);

  store.salvarTeste(Object.assign({}, teste, { hourlyRate: teste.hourlyRate * 3 }));

  const arquivada = globalThis.TC.util.porId(store.get().cotacoes, cotacao.id);
  assert.equal(cotacoes.totalDaCotacao(arquivada), totalOriginal,
    'o orçamento entregue não muda quando o catálogo sobe de preço');
});

test('o unitário é horas x rate + insumos, sem custo de amostra embutido', () => {
  const item = cotacoes.montarItem(procedimentoPrecificado(), 1);
  assert.ok(item.custoUnitario > 0, 'o teste precisa de um procedimento precificado');
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

/* ---- Cópia publicada para a equipe ---- */

/* O build embute um instantâneo em TC.PUBLICACAO. A aplicação passa a ler dele, não
   grava nada e ninguém edita — é o compartilhamento possível sem servidor. */
function comPublicacao(dados, fn) {
  globalThis.TC.PUBLICACAO = { atualizadoEm: '2026-07-31', dados: dados };
  try { return fn(); } finally { delete globalThis.TC.PUBLICACAO; }
}

test('a cópia publicada lê os dados embutidos, ignorando o navegador', () => {
  store.restaurarPadrao();
  const outro = dados.seed();
  outro.testes = outro.testes.slice(0, 3);

  comPublicacao(outro, () => {
    store.init();
    assert.equal(store.get().testes.length, 3, 'os dados vêm do instantâneo embutido');
  });
});

test('a cópia publicada não grava alterações', () => {
  const embutido = dados.seed();
  comPublicacao(embutido, () => {
    store.init();
    store.salvarCliente({ nome: 'Só nesta sessão', segmento: 'Teste' });
  });

  /* Fora da publicação, o estado do navegador continua o que era. */
  store.init();
  assert.equal(store.get().clientes.filter((c) => c.nome === 'Só nesta sessão').length, 0,
    'a cópia da equipe não pode escrever no navegador de quem abre');
});

test('na cópia publicada ninguém edita, mas todos consultam', () => {
  comPublicacao(dados.seed(), () => {
    store.init();
    const estado = store.get();
    assert.equal(permissoes.publicada(), true);
    ['catalogo', 'demandas', 'cotacoes', 'planejamento', 'equipamentos', 'permissoes']
      .forEach((rota) => {
        assert.equal(permissoes.podeEditar(estado, rota), false, rota + ' ficou editável');
      });
    assert.equal(permissoes.podeVer(estado, 'catalogo'), true, 'consulta continua liberada');
  });

  assert.equal(permissoes.publicada(), false, 'fora da publicação nada muda');
});
