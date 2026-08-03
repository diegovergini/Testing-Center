/* State tests: migration of the old phases and integrity when removing register entries. */
const test = require('node:test');
const assert = require('node:assert');

require('../src/util.js');
const dados = require('../src/data.js');
require('../src/store.js');

const store = globalThis.TC.store;

/* State in the earlier format: part type with customer/end/date, procedure with phases,
   request with a phase. */
function comDadosAntigos() {
  const base = dados.seed();
  base.testes[0].fases = ['CONCEITO', 'DV'];
  base.testes[1].fases = ['PPAP', 'SERIE'];
  delete base.testes[0].revisao;
  base.pecas[0] = {
    id: 'PC-ANTIGA', nome: 'Silencioso traseiro', clienteId: 'CLI-VW', area: 'COLD',
    programa: 'VW MQB-A0', dataAmostras: '2026-09-15', quantidade: 8, custoAmostra: 1650
  };
  base.demandas = [
    { id: 'D1', testeId: base.testes[0].id, pecaId: 'PC-ANTIGA', clienteId: 'CLI-VW',
      fase: 'PPAP', prioridade: 'MEDIA', quantidade: 1, status: 'SOLICITADA', criadoEm: '2026-07-06' }
  ];
  return JSON.stringify(base);
}

test('importing migrates phases, LTI and the sample date onto the request', () => {
  store.init();
  store.importar(comDadosAntigos());
  const estado = store.get();

  assert.equal(estado.demandas[0].tipoLti, 'PV', 'the request\'s old phase becomes the LTI classification');
  assert.equal(estado.demandas[0].fase, undefined, 'the phase field no longer exists on the request');
  assert.equal(estado.demandas[0].lti, '', 'an LTI with no number is left blank to be filled in');
  assert.equal(estado.demandas[0].dataAmostras, '2026-09-15',
    'the date that was on the part type moves to the request, without losing the schedule');
});

test('importing clears customer, system end and stock from the part types', () => {
  store.importar(comDadosAntigos());
  store.get().pecas.forEach((p) => {
    assert.equal(p.clienteId, undefined);
    assert.equal(p.area, undefined);
    assert.equal(p.programa, undefined);
    assert.equal(p.dataAmostras, undefined);
    assert.equal(p.quantidade, undefined);
  });
});

test('importing strips the phase from the procedure and guarantees the revision field', () => {
  store.importar(comDadosAntigos());
  store.get().testes.forEach((t) => {
    assert.equal(t.fases, undefined, t.id + ' manteve fase amarrada');
    assert.equal(typeof t.revisao, 'string', t.id + ' was left without the revision field');
  });
});

test('an old request with no sample date receives a usable one', () => {
  const base = dados.seed();
  base.demandas = [
    { id: 'D9', testeId: base.testes[0].id, pecaId: base.pecas[0].id, clienteId: 'CLI-VW',
      tipoLti: 'DV', lti: 'LTI-9', prioridade: 'MEDIA', quantidade: 1, status: 'SOLICITADA' }
  ];
  store.importar(JSON.stringify(base));
  assert.equal(store.get().demandas[0].dataAmostras, globalThis.TC.util.hoje());
});

test('removing a customer also takes it off the procedures that require it', () => {
  store.restaurarPadrao();
  const alvo = 'CLI-GM';
  const antes = store.get().testes.filter((t) => (t.clientes || []).includes(alvo));
  assert.ok(antes.length > 0, 'the example catalogue has to have procedures for this customer');

  store.removerCliente(alvo);
  const estado = store.get();

  assert.equal(estado.clientes.filter((c) => c.id === alvo).length, 0);
  estado.testes.forEach((t) => {
    assert.ok(!(t.clientes || []).includes(alvo), t.id + ' ainda aponta para o cliente removido');
  });
});

test('saving a new customer generates a code and editing preserves the existing one', () => {
  store.restaurarPadrao();
  const total = store.get().clientes.length;

  const novo = store.salvarCliente({ nome: 'Marelli', segmento: 'Tier 1' });
  assert.ok(novo.id, 'a new customer needs a code');
  assert.equal(store.get().clientes.length, total + 1);

  store.salvarCliente({ id: novo.id, nome: 'Marelli Brasil', segmento: 'Tier 1' });
  assert.equal(store.get().clientes.length, total + 1, 'editing must not create another record');
  assert.equal(globalThis.TC.util.porId(store.get().clientes, novo.id).nome, 'Marelli Brasil');
});

test('removing a unit does not dismantle the procedures\' group', () => {
  store.restaurarPadrao();
  /* The seed catalogue arrives with no rig defined, so we point at the group here. */
  const primeiro = store.get().testes[0];
  store.salvarTeste(Object.assign({}, primeiro, { equipamentoGrupos: ['Burner'] }));

  const usaBurner = (t) => (t.equipamentoGrupos || []).includes('Burner');
  const dependentes = store.get().testes.filter(usaBurner).length;
  assert.ok(dependentes > 0);

  store.removerEquipamento('BURNER-1');
  const estado = store.get();
  assert.equal(estado.equipamentos.filter((e) => e.id === 'BURNER-1').length, 0);
  assert.equal(estado.testes.filter(usaBurner).length, dependentes,
    'os procedimentos seguem pedindo o grupo Burner, agora com 2 unidades');
  assert.equal(estado.equipamentos.filter((e) => e.grupo === 'Burner').length, 2);
});

test('importing swaps the procedure\'s unit for its group', () => {
  const base = dados.seed();
  base.testes[0] = Object.assign({}, base.testes[0], { equipamentoId: 'BURNER-2' });
  delete base.testes[0].equipamentoGrupos;

  store.importar(JSON.stringify(base));
  const t = store.get().testes[0];
  assert.deepEqual(t.equipamentoGrupos, ['Burner'], 'BURNER-2 pertence ao grupo Burner');
  assert.equal(t.equipamentoId, undefined, 'the old field is not left behind');
  assert.equal(t.equipamentoIds, undefined);
});

test('importing de-duplicates groups when the procedure listed sibling units', () => {
  const base = dados.seed();
  base.testes[0] = Object.assign({}, base.testes[0], { equipamentoIds: ['MTS-1', 'MTS-3', 'DYNO'] });
  delete base.testes[0].equipamentoGrupos;

  store.importar(JSON.stringify(base));
  assert.deepEqual(store.get().testes[0].equipamentoGrupos, ['MTS', 'Dynamometer']);
});

test('an old request gains empty project and part number fields', () => {
  const base = dados.seed();
  base.demandas = [
    { id: 'D7', testeId: base.testes[0].id, pecaId: base.pecas[0].id, clienteId: 'CLI-VW',
      tipoLti: 'DV', lti: 'LTI-7', prioridade: 'MEDIA', quantidade: 1, status: 'SOLICITADA',
      dataAmostras: '2026-08-01' }
  ];
  store.importar(JSON.stringify(base));
  const d = store.get().demandas[0];
  assert.equal(d.projeto, '');
  assert.equal(d.partNumber, '');
});

/* ---- Catalogue replacement ---- */

/* Data with no catalogue version mark predates the swap: the old catalogue goes out whole
   and the new one comes in. */
function comCatalogoAntigo() {
  const base = dados.seed();
  delete base.catalogoVersao;
  base.clientes = [{ id: 'CLI-VW', nome: 'Volkswagen', segmento: 'OEM' }];
  base.testes = [{
    id: 'TP-VELHO', nome: 'Test that left the catalogue', norma: 'X', revisao: 'Rev. 09',
    clientes: [], area: 'HOT', equipamentoGrupos: ['Burner'],
    horasSetup: 2, horasEnsaio: 10, horasReport: 1, amostras: 1,
    hourlyRate: 500, custoInsumos: 100, descricao: ''
  }];
  base.demandas = [{
    id: 'D-VELHA', testeId: 'TP-VELHO', pecaId: 'PC-HOT', clienteId: 'CLI-VW',
    tipoLti: 'DV', lti: 'LTI-1', prioridade: 'MEDIA', quantidade: 1,
    status: 'SOLICITADA', dataAmostras: '2026-08-01'
  }];
  return JSON.stringify(base);
}

test('data saved before the swap receives the new catalogue in place of the old one', () => {
  store.importar(comCatalogoAntigo());
  const estado = store.get();

  assert.equal(estado.testes.filter((t) => t.id === 'TP-VELHO').length, 0,
    'the old catalogue procedure is not left behind');
  assert.deepEqual(estado.testes.map((t) => t.id), dados.seed().testes.map((t) => t.id));
  assert.equal(estado.catalogoVersao, dados.CATALOGO_VERSAO);
});

test('the catalogue swap brings in the customer the new procedures require', () => {
  store.importar(comCatalogoAntigo());
  const estado = store.get();
  assert.ok(globalThis.TC.util.porId(estado.clientes, 'CLI-GM'), 'a GM entra no cadastro');
  assert.ok(globalThis.TC.util.porId(estado.clientes, 'CLI-VW'), 'customers already registered stay');
});

test('a request for a procedure that left the catalogue is discarded in the swap', () => {
  store.importar(comCatalogoAntigo());
  assert.equal(store.get().demandas.length, 0,
    'with no procedure the request would have neither cost nor rig');
});

test('new procedures go in without erasing what was already filled in', () => {
  /* The state of someone already on version 2 of the platform: only the GM procedures, one
     of them with hours, rig and rate already registered. */
  const base = dados.seed();
  base.catalogoVersao = 2;
  base.testes = base.testes
    .filter((t) => t.id.indexOf('TP-GM-') === 0)
    .map((t) => (t.id === 'TP-GM-06'
      ? Object.assign({}, t, {
        equipamentoGrupos: ['ColdFlow'], horasSetup: 2, horasEnsaio: 8,
        horasReport: 4, custoInsumos: 1800, area: 'AMBOS'
      })
      : t));
  base.demandas = [
    { id: 'D-GM', testeId: 'TP-GM-06', pecaId: base.pecas[0].id, clienteId: 'CLI-GM',
      projeto: 'Onix', partNumber: 'PN', lti: 'LTI-1', tipoLti: 'PV', prioridade: 'ALTA',
      quantidade: 1, status: 'SOLICITADA', dataAmostras: '2026-08-01', prazo: '2026-10-01' }
  ];

  store.importar(JSON.stringify(base));
  const estado = store.get();

  const completado = globalThis.TC.util.porId(estado.testes, 'TP-GM-06');
  assert.equal(completado.custoInsumos, 1800, 'a record already filled in must not be overwritten');
  assert.deepEqual(completado.equipamentoGrupos, ['ColdFlow']);
  assert.equal(estado.testes.filter((t) => t.id.indexOf('TP-STL-') === 0).length, 30,
    'the Stellantis procedures enter the catalogue');
  assert.equal(estado.demandas.length, 1, 'the existing request stays valid');
  assert.equal(estado.catalogoVersao, dados.CATALOGO_VERSAO);
});

test('a catalogue already on the new version is not replaced on load', () => {
  const base = dados.seed();
  base.testes[0] = Object.assign({}, base.testes[0], { custoInsumos: 777, horasEnsaio: 40 });
  store.importar(JSON.stringify(base));

  const t = store.get().testes[0];
  assert.equal(t.custoInsumos, 777, 'what the user filled into the catalogue is still there');
  assert.equal(t.horasEnsaio, 40);
});

test('importing converts custoBase into consumables cost and strips the rate from the procedure', () => {
  const base = dados.seed();
  base.testes[0] = {
    id: 'TP-ANTIGO', nome: 'Ensaio antigo', norma: '', revisao: 'Rev. 01', clientes: [],
    area: 'HOT', equipamentoId: 'BURNER-1', hourlyRate: 610,
    horasSetup: 2, horasEnsaio: 10, amostras: 1, custoBase: 5000, descricao: ''
  };
  /* o custo-hora saiu do cadastro de equipamento, mas backups antigos ainda o trazem */
  base.equipamentos = base.equipamentos.map((eq) =>
    eq.id === 'BURNER-1' ? Object.assign({}, eq, { custoHora: 610 }) : eq);

  store.importar(JSON.stringify(base));
  const estado = store.get();
  const t = estado.testes[0];

  assert.equal(t.custoInsumos, 5000, 'o custo antigo vira custo de insumos');
  assert.equal(t.custoBase, undefined);
  assert.equal(t.horasReport, 0);
  assert.equal(t.hourlyRate, undefined, 'o rate deixou de ser campo do procedimento');
  assert.equal(estado.hourlyRate, dados.HOURLY_RATE,
    'o backup antigo adota o rate vigente do centro de testes');
});

/* ---- Levantamento de horas ---- */

test('a procedure with no measured hours receives the seed catalogue\'s hours', () => {
  const base = dados.seed();
  base.catalogoVersao = 8;
  /* The state from before the survey: the same catalogue, hours still at zero. */
  base.testes = base.testes.map((t) =>
    Object.assign({}, t, { horasSetup: 0, horasEnsaio: 0, horasReport: 0 }));

  store.importar(JSON.stringify(base));
  const t = globalThis.TC.util.porId(store.get().testes, 'TP-STL-11');

  assert.equal(t.horasEnsaio, 1089);
  assert.equal(t.horasSetup, 24);
  assert.equal(t.horasReport, 38);
});

test('hours already filled in by the user are not overwritten by the survey', () => {
  const base = dados.seed();
  base.catalogoVersao = 8;
  base.testes = base.testes.map((t) =>
    t.id === 'TP-STL-11'
      ? Object.assign({}, t, { horasSetup: 1, horasEnsaio: 2, horasReport: 3 })
      : Object.assign({}, t, { horasSetup: 0, horasEnsaio: 0, horasReport: 0 }));

  store.importar(JSON.stringify(base));
  const estado = store.get();

  const meu = globalThis.TC.util.porId(estado.testes, 'TP-STL-11');
  assert.deepEqual([meu.horasEnsaio, meu.horasSetup, meu.horasReport], [2, 1, 3],
    'the record of whoever filled it in takes precedence');

  const outro = globalThis.TC.util.porId(estado.testes, 'TP-GM-05');
  assert.equal(outro.horasEnsaio, 700, 'os demais recebem o levantamento normalmente');
});
