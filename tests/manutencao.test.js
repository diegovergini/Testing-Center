/* Maintenance management tests: last carried out, next planned, overdue ones and the effect
   on the equipment calendar. */
const test = require('node:test');
const assert = require('node:assert');

const util = require('../src/util.js');
const dados = require('../src/data.js');
const scheduler = require('../src/scheduler.js');
const manutencao = require('../src/manutencao.js');
const kpi = require('../src/kpi.js');
require('../src/store.js');

const store = globalThis.TC.store;
const HOJE = '2026-08-10';

function equipamento(paradas) {
  return {
    id: 'EQ-01', nome: 'Bancada', grupo: 'EQ-01', posicoes: 1, continuo: false,
    horasDia: 8, diasUteis: [1, 2, 3, 4, 5], manutencao: paradas || []
  };
}

function parada(extra) {
  return Object.assign({
    id: 'MN-1', inicio: '2026-08-01', fim: '2026-08-03', tipo: 'PREVENTIVA',
    motivo: 'Calibration', situacao: 'PLANEJADA', oQueFoiFeito: '', responsavel: ''
  }, extra);
}

/* ---- Last carried out ---- */

test('the last maintenance is the carried-out one that ended latest', () => {
  const eq = equipamento([
    parada({ id: 'A', inicio: '2026-05-04', fim: '2026-05-06', situacao: 'REALIZADA',
      oQueFoiFeito: 'troca de termopares' }),
    parada({ id: 'B', inicio: '2026-07-06', fim: '2026-07-08', situacao: 'REALIZADA',
      oQueFoiFeito: 'load cell calibrated' }),
    parada({ id: 'C', inicio: '2026-06-01', fim: '2026-06-02', situacao: 'REALIZADA',
      oQueFoiFeito: 'ajuste do controlador' })
  ]);
  const s = manutencao.situacao(eq, HOJE);

  assert.equal(s.ultima.id, 'B');
  assert.equal(s.ultima.oQueFoiFeito, 'load cell calibrated');
  assert.equal(s.diasDesdeUltima, util.diffDias('2026-07-08', HOJE));
});

test('a merely planned downtime does not count as the last one carried out', () => {
  const eq = equipamento([parada({ inicio: '2026-06-01', fim: '2026-06-03' })]);
  const s = manutencao.situacao(eq, HOJE);

  assert.equal(s.ultima, null, 'planned and overdue is not maintenance carried out');
  assert.equal(s.diasDesdeUltima, null);
});

/* ---- Next planned ---- */

test('the next planned one is the planned downtime starting soonest from here on', () => {
  const eq = equipamento([
    parada({ id: 'A', inicio: '2026-11-03', fim: '2026-11-05' }),
    parada({ id: 'B', inicio: '2026-09-14', fim: '2026-09-16' }),
    parada({ id: 'C', inicio: '2026-12-01', fim: '2026-12-02' })
  ]);
  const s = manutencao.situacao(eq, HOJE);

  assert.equal(s.proxima.id, 'B');
  assert.equal(s.diasParaProxima, util.diffDias(HOJE, '2026-09-14'));
});

test('a downtime running today counts as the next one and is flagged', () => {
  const eq = equipamento([parada({ inicio: '2026-08-09', fim: '2026-08-12' })]);
  const s = manutencao.situacao(eq, HOJE);

  assert.equal(s.proxima.id, 'MN-1', 'it has not finished yet, so it is still the next one');
  assert.equal(s.emManutencaoHoje, true);
});

test('with no future downtime scheduled, the next one is null', () => {
  const eq = equipamento([
    parada({ inicio: '2026-05-04', fim: '2026-05-06', situacao: 'REALIZADA', oQueFoiFeito: 'x' })
  ]);
  assert.equal(manutencao.situacao(eq, HOJE).proxima, null);
});

/* ---- Vencidas ---- */

test('a planned downtime past its date becomes an outstanding item, not the next one', () => {
  const eq = equipamento([
    parada({ id: 'VENCIDA', inicio: '2026-07-06', fim: '2026-07-08' }),
    parada({ id: 'FUTURA', inicio: '2026-09-14', fim: '2026-09-16' })
  ]);
  const s = manutencao.situacao(eq, HOJE);

  assert.equal(s.proxima.id, 'FUTURA');
  assert.deepEqual(s.atrasadas.map((m) => m.id), ['VENCIDA']);
});

test('the outstanding items point at what needs a decision from the manager', () => {
  const estado = {
    equipamentos: [
      equipamento([parada({ id: 'V', inicio: '2026-07-01', fim: '2026-07-02' })]),
      Object.assign(equipamento([]), { id: 'EQ-02', nome: 'Sem plano' }),
      Object.assign(equipamento([parada({ inicio: '2026-09-01', fim: '2026-09-02' })]),
        { id: 'EQ-03', nome: 'Em dia' })
    ]
  };
  const lista = manutencao.pendencias(estado, HOJE);

  assert.equal(lista.filter((p) => p.tipo === 'atrasada').length, 1);
  assert.deepEqual(lista.filter((p) => p.tipo === 'sem-proxima').map((p) => p.equipamento.id),
    ['EQ-01', 'EQ-02'], 'having only an overdue downtime also means no next one scheduled');
  assert.equal(lista.filter((p) => p.equipamento.id === 'EQ-03').length, 0);
});

/* ---- Efeito na agenda ---- */

test('planned downtime blocks the rig, one carried out in the past gets in the way of nothing', () => {
  const eq = equipamento([
    parada({ id: 'PASSADA', inicio: '2026-08-03', fim: '2026-08-05', situacao: 'REALIZADA',
      oQueFoiFeito: 'feita' }),
    parada({ id: 'FUTURA', inicio: '2026-08-12', fim: '2026-08-14' })
  ]);
  assert.equal(scheduler.emManutencao(eq, '2026-08-04'), true);
  assert.equal(scheduler.emManutencao(eq, '2026-08-13'), true);
  assert.equal(scheduler.emManutencao(eq, HOJE), false);
});

/* ---- Store ---- */

test('downtime is born planned and the record closes it with what was done', () => {
  store.restaurarPadrao();
  const criada = store.adicionarManutencao('SHAKER', {
    inicio: '2026-09-01', fim: '2026-09-03', tipo: 'CALIBRACAO', motivo: 'Annual calibration'
  });

  assert.equal(criada.situacao, 'PLANEJADA');
  assert.equal(criada.oQueFoiFeito, '');

  store.registrarManutencao('SHAKER', criada.id, {
    inicio: '2026-09-01', fim: '2026-09-05',
    oQueFoiFeito: 'load cell calibrated and amplifier replaced',
    responsavel: 'Metrologia'
  });

  const eq = globalThis.TC.util.porId(store.get().equipamentos, 'SHAKER');
  const parada = globalThis.TC.util.porId(eq.manutencao, criada.id);
  assert.equal(parada.situacao, 'REALIZADA');
  assert.equal(parada.fim, '2026-09-05', 'the work can extend beyond the planned period');
  assert.equal(parada.oQueFoiFeito, 'load cell calibrated and amplifier replaced');
  assert.equal(parada.responsavel, 'Metrologia');
  assert.equal(manutencao.situacao(eq, '2026-09-10').ultima.id, criada.id);
});

test('downtimes saved before this register go in with the right status', () => {
  const base = dados.seed();
  base.equipamentos = base.equipamentos.map((eq) => eq.id === 'SHAKER'
    ? Object.assign({}, eq, {
      manutencao: [
        { id: 'ANTIGA', inicio: '2020-01-06', fim: '2020-01-08', motivo: 'Calibration' },
        { id: 'FUTURA', inicio: '2099-01-06', fim: '2099-01-08', motivo: 'Overhaul' }
      ]
    })
    : eq);

  store.importar(JSON.stringify(base));
  const eq = globalThis.TC.util.porId(store.get().equipamentos, 'SHAKER');

  assert.equal(globalThis.TC.util.porId(eq.manutencao, 'ANTIGA').situacao, 'REALIZADA',
    'it already happened');
  assert.equal(globalThis.TC.util.porId(eq.manutencao, 'FUTURA').situacao, 'PLANEJADA');
  eq.manutencao.forEach((m) => {
    assert.equal(typeof m.tipo, 'string');
    assert.equal(typeof m.oQueFoiFeito, 'string');
  });
});

test('scheduled maintenance takes hours off the month\'s capacity', () => {
  store.restaurarPadrao();
  const antes = kpi.capacidadeNoMes(
    globalThis.TC.util.porId(store.get().equipamentos, 'SHAKER'), '2026-09');

  store.adicionarManutencao('SHAKER', {
    inicio: '2026-09-07', fim: '2026-09-11', tipo: 'PREVENTIVA', motivo: 'Overhaul'
  });
  const depois = kpi.capacidadeNoMes(
    globalThis.TC.util.porId(store.get().equipamentos, 'SHAKER'), '2026-09');

  assert.equal(antes.horas - depois.horas, 5 * 16, 'five working days of 16 h come off the month');
  assert.equal(depois.diasParados, 5);
});
