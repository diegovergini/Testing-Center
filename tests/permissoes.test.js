/* Role, permission and quote tests. */
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

test('the defaults separate what each role sees', () => {
  const produto = comPerfil('PRODUTO');
  assert.equal(permissoes.podeVer(produto, 'catalogo'), true, 'product needs to see the catalogue to ask for a test');
  assert.equal(permissoes.podeVer(produto, 'cotacoes'), true);
  assert.equal(permissoes.podeVer(produto, 'demandas'), true);
  assert.equal(permissoes.podeVer(produto, 'planejamento'), true);
  assert.equal(permissoes.podeVer(produto, 'painel'), false, 'KPIs belong to the test centre');
  assert.equal(permissoes.podeVer(produto, 'equipamentos'), false);
  assert.equal(permissoes.podeVer(produto, 'pecas'), false);
  assert.equal(permissoes.podeVer(produto, 'clientes'), false);
  assert.equal(permissoes.podeVer(produto, 'permissoes'), false);

  const testes = comPerfil('TESTES');
  ['catalogo', 'cotacoes', 'demandas', 'planejamento', 'painel', 'clientes', 'equipamentos', 'pecas', 'permissoes']
    .forEach((rota) => assert.equal(permissoes.podeVer(testes, rota), true, rota));
});

test('product asks for tests and quotes but does not touch the catalogue or the schedule', () => {
  const produto = comPerfil('PRODUTO');
  assert.equal(permissoes.podeEditar(produto, 'cotacoes'), true);
  assert.equal(permissoes.podeEditar(produto, 'demandas'), true);
  assert.equal(permissoes.podeEditar(produto, 'catalogo'), false);
  assert.equal(permissoes.podeEditar(produto, 'planejamento'), false);
});

test('whoever cannot see the screen cannot edit it either, even if ticked', () => {
  const estado = comPerfil('PRODUTO');
  estado.permissoes.painel.editar.push('PRODUTO');
  assert.equal(permissoes.podeVer(estado, 'painel'), false);
  assert.equal(permissoes.podeEditar(estado, 'painel'), false, 'editing without viewing does not count');
});

test('ticking edit turns view on with it, and unticking view turns edit off', () => {
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

test('restoring permissions goes back to the default matrix', () => {
  comPerfil('TESTES');
  store.definirPermissao('equipamentos', 'ver', 'PRODUTO', true);
  assert.ok(store.get().permissoes.equipamentos.ver.includes('PRODUTO'));
  store.restaurarPermissoes();
  assert.ok(!store.get().permissoes.equipamentos.ver.includes('PRODUTO'));
});

test('an old state with no permissions and no quotes receives the defaults', () => {
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

test('an invalid saved role falls back to the test one', () => {
  const base = dados.seed();
  base.perfilAtual = 'FANTASMA';
  store.importar(JSON.stringify(base));
  assert.equal(store.get().perfilAtual, 'TESTES');
});

/* ---- Quotes ---- */

/* The view exports no module: it loads by side effect and registers itself in TC.views. */
require('../src/views/cotacoes.js');
const cotacoes = globalThis.TC.views.cotacoes;

/* The seed catalogue arrives with hours and values at zero — whoever registers fills them
   in later. A quote priced at zero proves nothing, so we complete one procedure to give the
   arithmetic some numbers. */
function procedimentoPrecificado() {
  store.restaurarPadrao();
  const base = store.get().testes[0];
  return store.salvarTeste(Object.assign({}, base, {
    equipamentoGrupos: ['Burner'],
    horasSetup: 8, horasEnsaio: 240, horasReport: 16,
    custoInsumos: 12800
  }));
}

/* The hourly rate belongs to the test centre: whoever quotes passes the current rate. */
function rateVigente() {
  return store.get().hourlyRate;
}

test('quote numbering is sequential within the year', () => {
  store.restaurarPadrao();
  const primeira = store.proximoNumeroCotacao();
  assert.match(primeira, /^COT-\d{4}-0001$/);

  store.salvarCotacao({ clienteId: 'CLI-VW', itens: [] });
  assert.match(store.proximoNumeroCotacao(), /-0002$/);
  store.salvarCotacao({ clienteId: 'CLI-VW', itens: [] });
  assert.match(store.proximoNumeroCotacao(), /-0003$/);
});

test('the quote line item freezes the procedure price', () => {
  const teste = procedimentoPrecificado();
  const item = cotacoes.montarItem(teste, 2, rateVigente());

  const esperadoUnitario =
    (teste.horasSetup + teste.horasEnsaio + teste.horasReport) * rateVigente() +
    teste.custoInsumos;

  assert.equal(item.custoUnitario, esperadoUnitario, 'the unit price is the procedure cost');
  assert.equal(item.amostras, 2);
  assert.equal(item.total, esperadoUnitario * 2, 'each sample is one run');
  assert.equal(item.revisao, teste.revisao, 'the current revision is recorded');
});

test('an invalid sample quantity becomes one', () => {
  const teste = procedimentoPrecificado();
  const rate = rateVigente();
  assert.equal(cotacoes.montarItem(teste, 0, rate).amostras, 1);
  assert.equal(cotacoes.montarItem(teste, '', rate).amostras, 1);
  assert.equal(cotacoes.montarItem(teste, -3, rate).amostras, 1);
  assert.equal(cotacoes.montarItem(teste, '4', rate).amostras, 4, 'input text becomes a number');
});

test('changing the catalogue later does not rewrite an archived quote', () => {
  const teste = procedimentoPrecificado();
  const item = cotacoes.montarItem(teste, 1, rateVigente());
  const cotacao = store.salvarCotacao({ clienteId: 'CLI-VW', itens: [item] });
  const totalOriginal = cotacoes.totalDaCotacao(cotacao);

  store.salvarTeste(Object.assign({}, teste, { horasEnsaio: teste.horasEnsaio * 3 }));

  const arquivada = globalThis.TC.util.porId(store.get().cotacoes, cotacao.id);
  assert.equal(cotacoes.totalDaCotacao(arquivada), totalOriginal,
    'a delivered quote does not change when the catalogue goes up in price');
});

test('the annual hourly rate revision does not rewrite an archived quote', () => {
  const teste = procedimentoPrecificado();
  const cotacao = store.salvarCotacao({
    clienteId: 'CLI-VW', itens: [cotacoes.montarItem(teste, 2, rateVigente())]
  });
  const totalOriginal = cotacoes.totalDaCotacao(cotacao);
  const rateAntigo = cotacao.itens[0].hourlyRate;

  store.definirHourlyRate(500, '2027');

  const arquivada = globalThis.TC.util.porId(store.get().cotacoes, cotacao.id);
  assert.equal(cotacoes.totalDaCotacao(arquivada), totalOriginal);
  assert.equal(arquivada.itens[0].hourlyRate, rateAntigo,
    'o item guarda o rate do dia em que foi cotado');
  assert.equal(store.get().hourlyRate, 500, 'the new rate applies to the catalogue from here on');
});

test('the hourly rate is a single field, applied to every procedure', () => {
  store.restaurarPadrao();
  store.definirHourlyRate(400, '2027');
  const estado = store.get();

  assert.equal(estado.hourlyRate, 400);
  assert.equal(estado.hourlyRateVigencia, '2027');
  estado.testes.forEach((t) => {
    assert.equal(t.hourlyRate, undefined, t.id + ' cannot have a rate of its own');
  });
  const comHoras = estado.testes.filter((t) => globalThis.TC.scheduler.horasFaturaveis(t) > 0);
  assert.ok(comHoras.length > 0);
  comHoras.forEach((t) => {
    const c = globalThis.TC.scheduler.custoCatalogo(t, estado.hourlyRate);
    assert.equal(c.hourlyRate, 400, t.id + ' did not use the test centre rate');
  });
});

test('the unit price is hours x rate + consumables, with no sample cost baked in', () => {
  const item = cotacoes.montarItem(procedimentoPrecificado(), 1);
  assert.ok(item.custoUnitario > 0, 'o teste precisa de um procedimento precificado');
  assert.equal(item.custoUnitario, item.custoHoras + item.custoInsumos);
  assert.equal(item.custoAmostras, undefined, 'the reference part type left the model');
});

test('an archived quote in the old format is migrated without changing the total', () => {
  const base = dados.seed();
  base.cotacoes = [{
    id: 'COT-velha', numero: 'COT-2025-0001', clienteId: 'CLI-VW', pecaId: 'PC-HOT',
    projeto: 'P1', partNumber: 'PN-1', solicitante: 'Someone', status: 'ENVIADA',
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

  assert.equal(c.pecaId, undefined, 'the reference part type leaves the header');
  assert.equal(c.lti, '');
  assert.equal(c.previsaoExecucao, '');
  assert.equal(c.itens[0].quantidade, undefined, 'quantidade virou amostras');
  assert.equal(c.itens[0].amostras, 3, 'a quantidade antiga passa a ser a de amostras');
  assert.equal(c.itens[0].custoAmostras, 500, 'o custo antigo fica, para o total reconciliar');
  assert.equal(cotacoes.totalDaCotacao(c), 6000, 'a frozen price is not recalculated');
});

test('the quote total adds up the line items', () => {
  store.restaurarPadrao();
  const testes = store.get().testes;
  const itens = [
    cotacoes.montarItem(testes[0], 2),
    cotacoes.montarItem(testes[1], 1)
  ];
  const total = cotacoes.totalDaCotacao({ itens: itens });
  assert.equal(total, itens[0].total + itens[1].total);
});

/* ---- Copy published for the team ---- */

/* The build embeds a snapshot in TC.PUBLICACAO. The application reads from it, saves nothing
   and nobody edits — the sharing that is possible without a server. */
function comPublicacao(dados, fn) {
  globalThis.TC.PUBLICACAO = { atualizadoEm: '2026-07-31', dados: dados };
  try { return fn(); } finally { delete globalThis.TC.PUBLICACAO; }
}

test('the published copy reads the embedded data, ignoring the browser', () => {
  store.restaurarPadrao();
  const outro = dados.seed();
  outro.testes = outro.testes.slice(0, 3);

  comPublicacao(outro, () => {
    store.init();
    assert.equal(store.get().testes.length, 3, 'the data comes from the embedded snapshot');
  });
});

test('the published copy saves no changes', () => {
  const embutido = dados.seed();
  comPublicacao(embutido, () => {
    store.init();
    store.salvarCliente({ nome: 'Only in this session', segmento: 'Test' });
  });

  /* Outside the publication, the browser state stays what it was. */
  store.init();
  assert.equal(store.get().clientes.filter((c) => c.nome === 'Only in this session').length, 0,
    'the team copy must not write into the browser of whoever opens it');
});

test('in the published copy nobody edits, but everyone reads', () => {
  comPublicacao(dados.seed(), () => {
    store.init();
    const estado = store.get();
    assert.equal(permissoes.publicada(), true);
    ['catalogo', 'demandas', 'cotacoes', 'planejamento', 'equipamentos', 'permissoes']
      .forEach((rota) => {
        assert.equal(permissoes.podeEditar(estado, rota), false, rota + ' was left editable');
      });
    assert.equal(permissoes.podeVer(estado, 'catalogo'), true, 'consulta continua liberada');
  });

  assert.equal(permissoes.publicada(), false, 'outside the publication nothing changes');
});
