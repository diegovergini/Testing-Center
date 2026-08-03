/* Scheduling engine tests: node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');

const util = require('../src/util.js');
require('../src/data.js');
const scheduler = require('../src/scheduler.js');

/* 2026-07-06 is a Monday — it makes the weekend jumps easy to check. */
const SEGUNDA = '2026-07-06';

function equipamento(extra) {
  const base = {
    id: 'EQ-01', nome: 'Bancada', posicoes: 1, continuo: false, horasDia: 8,
    diasUteis: [1, 2, 3, 4, 5], custoHora: 100, manutencao: []
  };
  const eq = Object.assign(base, extra);
  /* with no explicit group, each unit is its own group, named by its id */
  if (!eq.grupo) eq.grupo = eq.id;
  return eq;
}

function teste(extra) {
  return Object.assign({
    id: 'TP-01', nome: 'Ensaio', area: 'COLD', equipamentoGrupos: ['EQ-01'], revisao: 'Rev. 01',
    clientes: [], horasSetup: 0, horasEnsaio: 8, horasReport: 0, amostras: 1,
    custoInsumos: 1000
  }, extra);
}

function peca(extra) {
  return Object.assign({
    id: 'PC-01', nome: 'Part type', custoAmostra: 500
  }, extra);
}

function demanda(extra) {
  return Object.assign({
    id: 'DM-01', testeId: 'TP-01', pecaId: 'PC-01', clienteId: 'CLI-01',
    lti: 'LTI-0001', tipoLti: 'DV', dataAmostras: SEGUNDA,
    prioridade: 'MEDIA', quantidade: 1, prazo: '', inicioFixo: '', status: 'SOLICITADA',
    criadoEm: SEGUNDA
  }, extra);
}

function estado(extra) {
  return Object.assign({
    /* The hourly rate belongs to the test centre, a single value for the whole catalogue. */
    hourlyRate: 100,
    clientes: [{ id: 'CLI-01', nome: 'Cliente' }],
    equipamentos: [equipamento()],
    testes: [teste()],
    pecas: [peca()],
    demandas: [demanda()]
  }, extra);
}

function alocacaoDe(plano, id) {
  return plano.alocacoes.find((a) => a.demandaId === id);
}

test('duration converts hours into days according to the equipment regime', () => {
  assert.equal(scheduler.diasDeOperacao(teste({ horasEnsaio: 8 }), [equipamento()]), 1);
  assert.equal(scheduler.diasDeOperacao(teste({ horasEnsaio: 24 }), [equipamento()]), 3);
  assert.equal(scheduler.diasDeOperacao(teste({ horasSetup: 4, horasEnsaio: 20 }), [equipamento()]), 3);
  assert.equal(scheduler.diasDeOperacao(teste({ horasEnsaio: 72 }), [equipamento({ continuo: true })]), 3);
  assert.equal(scheduler.diasDeOperacao(teste({ horasEnsaio: 1 }), [equipamento()]), 1, 'nunca menos de um dia');
});

test('no test starts before the samples arrive', () => {
  const s = estado({ demandas: [demanda({ dataAmostras: '2026-08-10' })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  const a = alocacaoDe(plano, 'DM-01');
  assert.equal(a.inicio, '2026-08-10');
  assert.equal(a.esperaAmostra, util.diffDias(SEGUNDA, '2026-08-10'));
});

test('a sample already available in the past does not pull the test backwards', () => {
  const s = estado({ demandas: [demanda({ dataAmostras: '2026-01-05' })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(alocacaoDe(plano, 'DM-01').inicio, SEGUNDA);
});

test('the slot spans the weekend when the machine only operates on working days', () => {
  /* 3 operating days starting on a Thursday -> Thu, Fri, Mon. */
  const s = estado({
    testes: [teste({ horasEnsaio: 24 })],
    demandas: [demanda({ dataAmostras: '2026-07-09' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const a = alocacaoDe(plano, 'DM-01');
  assert.equal(a.inicio, '2026-07-09');
  assert.equal(a.fim, '2026-07-13');
});

test('continuous equipment occupies calendar days, weekend included', () => {
  const s = estado({
    equipamentos: [equipamento({ continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] })],
    testes: [teste({ horasEnsaio: 120 })],
    demandas: [demanda({ dataAmostras: '2026-07-09' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const a = alocacaoDe(plano, 'DM-01');
  assert.equal(a.inicio, '2026-07-09');
  assert.equal(a.fim, '2026-07-13');
});

test('parallel positions are used before pushing the queue out', () => {
  const s = estado({
    equipamentos: [equipamento({ posicoes: 2, continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] })],
    testes: [teste({ horasEnsaio: 48 })],
    demandas: [demanda({ id: 'A' }), demanda({ id: 'B' }), demanda({ id: 'C' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const a = alocacaoDe(plano, 'A'), b = alocacaoDe(plano, 'B'), c = alocacaoDe(plano, 'C');
  assert.equal(a.inicio, SEGUNDA);
  assert.equal(b.inicio, SEGUNDA);
  assert.notEqual(a.posicoes['EQ-01'], b.posicoes['EQ-01'], 'each one on a different position');
  assert.equal(c.inicio, '2026-07-08', 'the third only gets in when the first position frees up');
});

test('two requests never share the same position on the same day', () => {
  const s = estado({
    equipamentos: [equipamento({ continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] })],
    testes: [teste({ horasEnsaio: 72 })],
    demandas: [demanda({ id: 'A' }), demanda({ id: 'B' }), demanda({ id: 'C' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const janelas = plano.agendadas.map((a) => [a.inicio, a.fim]).sort();
  for (let i = 1; i < janelas.length; i++) {
    assert.ok(util.diffDias(janelas[i - 1][1], janelas[i][0]) > 0,
      'janela ' + janelas[i] + ' invade ' + janelas[i - 1]);
  }
});

test('maintenance blocks the slot and pushes the test past the downtime', () => {
  const s = estado({
    equipamentos: [equipamento({
      continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6],
      manutencao: [{ id: 'MN-1', inicio: '2026-07-07', fim: '2026-07-10', motivo: 'Calibration' }]
    })],
    testes: [teste({ horasEnsaio: 48 })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const a = alocacaoDe(plano, 'DM-01');
  assert.equal(a.inicio, '2026-07-11', 'it does not fit before the downtime and does not cross it');
});

test('high priority takes the slot ahead of low, even when created later', () => {
  const s = estado({
    equipamentos: [equipamento({ continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] })],
    testes: [teste({ horasEnsaio: 72 })],
    demandas: [
      demanda({ id: 'BAIXA', prioridade: 'BAIXA', criadoEm: '2026-06-01' }),
      demanda({ id: 'ALTA', prioridade: 'ALTA', criadoEm: '2026-07-01' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(alocacaoDe(plano, 'ALTA').inicio, SEGUNDA);
  assert.ok(util.diffDias(alocacaoDe(plano, 'ALTA').fim, alocacaoDe(plano, 'BAIXA').inicio) > 0);
});

test('within the same priority, the shortest due date wins', () => {
  const s = estado({
    equipamentos: [equipamento({ continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] })],
    testes: [teste({ horasEnsaio: 72 })],
    demandas: [
      demanda({ id: 'FOLGADO', prazo: '2026-12-31' }),
      demanda({ id: 'APERTADO', prazo: '2026-08-01' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(alocacaoDe(plano, 'APERTADO').inicio, SEGUNDA);
});

test('spare time and lateness are computed against the customer due date', () => {
  const s = estado({
    testes: [teste({ horasEnsaio: 8 })],
    demandas: [demanda({ id: 'NO_PRAZO', prazo: '2026-07-20' })]
  });
  const noPrazo = alocacaoDe(scheduler.planejar(s, SEGUNDA), 'NO_PRAZO');
  assert.equal(noPrazo.folga, util.diffDias(noPrazo.fim, '2026-07-20'));
  assert.equal(noPrazo.atrasado, false);

  const s2 = estado({ demandas: [demanda({ id: 'ATRASADO', prazo: '2026-07-01' })] });
  const atrasado = alocacaoDe(scheduler.planejar(s2, SEGUNDA), 'ATRASADO');
  assert.equal(atrasado.atrasado, true);
  assert.ok(atrasado.folga < 0);
});

test('a forced start is respected even with the machine free earlier', () => {
  const s = estado({ demandas: [demanda({ inicioFixo: '2026-07-15' })] });
  const a = alocacaoDe(scheduler.planejar(s, SEGUNDA), 'DM-01');
  assert.equal(a.inicio, '2026-07-15');
});

test('a pinned request reserves the position ahead of the others', () => {
  const s = estado({
    equipamentos: [equipamento({ continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] })],
    testes: [teste({ horasEnsaio: 72 })],
    demandas: [
      demanda({ id: 'LIVRE', prioridade: 'ALTA' }),
      demanda({ id: 'FIXA', prioridade: 'BAIXA', inicioFixo: SEGUNDA })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(alocacaoDe(plano, 'FIXA').inicio, SEGUNDA);
  assert.equal(alocacaoDe(plano, 'LIVRE').inicio, '2026-07-09');
});

test('completed and cancelled requests occupy no rig', () => {
  const s = estado({
    equipamentos: [equipamento({ continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] })],
    testes: [teste({ horasEnsaio: 72 })],
    demandas: [
      demanda({ id: 'FEITA', status: 'CONCLUIDA' }),
      demanda({ id: 'CANCELADA', status: 'CANCELADA' }),
      demanda({ id: 'ATIVA' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(plano.agendadas.length, 1);
  assert.equal(alocacaoDe(plano, 'ATIVA').inicio, SEGUNDA);
  assert.equal(alocacaoDe(plano, 'FEITA'), undefined);
});

test('a request with no equipment registered comes out blocked, it does not vanish', () => {
  const s = estado({ testes: [teste({ equipamentoGrupos: ['GRUPO-INEXISTENTE'] })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(plano.bloqueadas.length, 1);
  assert.match(plano.bloqueadas[0].motivo, /has no unit registered/);
});

test('procedure cost is (setup + test + reporting) x rate + consumables', () => {
  const t = teste({ horasSetup: 2, horasEnsaio: 8, horasReport: 5, custoInsumos: 1000 });
  const c = scheduler.custoDemanda({ quantidade: 3 }, t, null, peca({ custoAmostra: 500 }), 200);

  assert.equal(c.horasBancada, 10, 'setup + ensaio');
  assert.equal(c.horasFaturaveis, 15, 'setup + ensaio + report');
  assert.equal(c.custoHoras, 15 * 200);
  assert.equal(c.custoInsumos, 1000);
  assert.equal(c.custoProcedimento, 3000 + 1000);
  assert.equal(c.custoAmostras, 1500);
  assert.equal(c.total, 4000 + 1500);
});

test('the equipment hour no longer enters the cost', () => {
  const t = teste({ horasSetup: 0, horasEnsaio: 10, horasReport: 0, custoInsumos: 0 });
  const semBancada = scheduler.custoDemanda({ quantidade: 1 }, t, null, null, 100);
  const comDuas = scheduler.custoDemanda({ quantidade: 1 }, t,
    [equipamento({ custoHora: 900 }), equipamento({ custoHora: 900 })], null, 100);
  assert.equal(semBancada.total, comDuas.total, 'the cost comes from the hourly rate, not from the rig');
  assert.equal(comDuas.total, 1000);
});

test('reporting hours enter the cost but occupy no rig', () => {
  const t = teste({ horasSetup: 0, horasEnsaio: 8, horasReport: 40, custoInsumos: 0 });
  const eq = equipamento({ horasDia: 8 });
  assert.equal(scheduler.diasDeOperacao(t, [eq]), 1, 'only the 8 test hours hold the rig');
  assert.equal(scheduler.custoDemanda(null, t, [eq], null, 100).custoHoras, 48 * 100);
});

test('catalogue cost uses the procedure\'s default quantity and ignores samples', () => {
  const c = scheduler.custoCatalogo(teste({ amostras: 4, horasEnsaio: 8, horasReport: 2, custoInsumos: 500 }), 200);
  assert.equal(c.quantidade, 4);
  assert.equal(c.custoAmostras, 0);
  assert.equal(c.total, 500 + 10 * 200);
});

/* The seed catalogue arrives with no rig and no hours — whoever registers fills them in
   later. To exercise scheduling end to end, we complete here what the test engineer would
   fill in, spreading the procedures across the fleet's groups. */
function catalogoCompletado(base) {
  const grupos = scheduler.agruparEquipamentos(base.equipamentos).map((g) => g.id);
  base.testes.forEach((t, i) => {
    t.equipamentoGrupos = [grupos[i % grupos.length]];
    t.horasSetup = 4;
    t.horasEnsaio = 24 + i * 8;
    t.horasReport = 6;
    t.custoInsumos = 1000;
  });
  return base;
}

test('the example catalogue is schedulable end to end', () => {
  const base = catalogoCompletado(require('../src/data.js').seed());
  /* Any part type serves any procedure: there is no longer a tie by system end. */
  base.demandas = base.testes.map((t, i) => demanda({
    id: 'D' + i,
    testeId: t.id,
    pecaId: base.pecas[i % base.pecas.length].id,
    clienteId: base.clientes[i % base.clientes.length].id,
    dataAmostras: util.somaDias(SEGUNDA, i * 3),
    prioridade: i % 3 === 0 ? 'ALTA' : 'MEDIA'
  }));
  const plano = scheduler.planejar(base, SEGUNDA);
  assert.equal(plano.bloqueadas.length, 0, 'todo procedimento aponta para um equipamento cadastrado');
  assert.equal(plano.agendadas.length, base.testes.length);
  plano.agendadas.forEach((a) => {
    assert.ok(util.diffDias(a.demanda.dataAmostras, a.inicio) >= 0, a.teste.id + ' starts before the sample');
    assert.ok(util.diffDias(a.inicio, a.fim) >= 0);
  });
});

test('the phases are only DV, PV and VAVE, and PV is Process Validation', () => {
  const dados = require('../src/data.js');
  assert.deepEqual(dados.FASES.map((f) => f.id), ['DV', 'PV', 'VAVE']);
  assert.match(util.porId(dados.FASES, 'PV').nome, /Process Validation/);
});

test('the catalogue does not tie a procedure to a phase and always carries the revision', () => {
  const dados = require('../src/data.js');
  dados.seed().testes.forEach((t) => {
    assert.equal(t.fases, undefined, t.id + ' ainda tem fase amarrada');
    assert.ok(t.revisao && t.revisao.trim(), t.id + ' has no revision');
  });
});

test('the fleet is registered and no procedure points at a group that does not exist', () => {
  const base = require('../src/data.js').seed();
  const grupos = scheduler.agruparEquipamentos(base.equipamentos).map((g) => g.id);

  assert.deepEqual(base.equipamentos.map((eq) => eq.nome), [
    'Burner 1', 'Burner 2', 'Burner 3', 'Shaker', 'MTS 1', 'MTS 2', 'MTS 3', 'MTS 4',
    'LMS / PTA', 'ColdFlow', 'Dynamometer'
  ]);
  /* The seed catalogue comes with no rig defined: the equipment is filled in when each
     procedure is registered. What must not happen is pointing at a group that does not exist
     in the fleet. */
  base.testes.forEach((t) => {
    scheduler.gruposDoTeste(t).forEach(function (id) {
      assert.ok(grupos.includes(id), t.id + ' aponta para grupo ' + id);
    });
  });
});

/* The seed catalogue is each customer's specification transcribed: what the tests below
   guard is the name/standard pair and the link to the right customer. */
const CATALOGO_GM = [
  ['TP-GM-01', 'Resonance Durability', 'Appx C'],
  ['TP-GM-02', 'Physical Durability Aging Cycle', 'Appx C'],
  ['TP-GM-03', 'Substrate Retention Cold Vibration Aging', 'Appx C'],
  ['TP-GM-04', 'Container Thermal Shock Ageing Cycle', 'Appx C'],
  ['TP-GM-05', 'Substrate Thermal Shock', 'Appx C'],
  ['TP-GM-06', 'Exhaust backpressure', 'GMW16372'],
  ['TP-GM-07', 'Joint Leakage', 'GMW15261'],
  ['TP-GM-08', 'Hanger Dynamic Stifness', 'GMW14182'],
  ['TP-GM-09', 'Muffler Thermal Shock', 'GMW14380'],
  ['TP-GM-10', 'Hanger Durability', 'GMW14381 / GMW16941'],
  ['TP-GM-11', 'Pipe Durability', 'GMW14390 / GMW18104']
];

const CATALOGO_STELLANTIS = [
  ['TP-STL-01', 'Vibrational Analysis', '90.160 - 9.4'],
  ['TP-STL-02', 'Modal Analysis', '90.160 - 9.5 and 7-A7515'],
  ['TP-STL-03', 'Thermal Shock on Engine Bench', '90.160 - 9.6'],
  ['TP-STL-04', 'Resonance Durability', '90.160 - 9.7'],
  ['TP-STL-05', 'Converter thermal shock', '90.160 - 9.8'],
  ['TP-STL-06', 'Hot vibration test', '90.160 - 9.9'],
  ['TP-STL-07', 'Cold vibration test', '90.160 - 9.10'],
  ['TP-STL-08', 'Hot fatigue test', '90.160 - 9.11'],
  ['TP-STL-09', 'Hot Vibration Manifold Joint Durability', '90.160 - 9.12'],
  ['TP-STL-10', 'Joint Integrity', '90238 – 9.14 and 90160 – 9.13'],
  ['TP-STL-11', 'Burner Thermal Shock Test', '90160 - 9.21'],
  ['TP-STL-12', 'Time to Dry', '90238 - 5.3.1 and 7.T4193'],
  ['TP-STL-13', 'NVH', '90238 - 7.3'],
  ['TP-STL-14', 'Modal Analysis', '90238 - 7.3.8 and 7-A7515'],
  ['TP-STL-15', 'Flow Restriction (Backpressure)', '90238 - 7.4 and 7.A3758'],
  ['TP-STL-16', 'Internal Condensate Evacuation', '90238 - 7.6'],
  ['TP-STL-17', 'Load Data Acquisition', '90238 - 9.4'],
  ['TP-STL-18', 'Cold Fatigue', '90238 - 9.8'],
  ['TP-STL-19', 'Muffler Thermal Shock', '90238 - 9.10'],
  ['TP-STL-20', 'Decomposition Tube Internal Shock', '90.301 - 9.1.1'],
  ['TP-STL-21', 'Mixer resonance test', '90.301 - 9.5'],
  ['TP-STL-22', 'Tail Pipe Noise', 'B32 3140'],
  ['TP-STL-23', 'Subjective Noise', 'B32 3140'],
  ['TP-STL-24', 'Backpressure', 'B32 3110'],
  ['TP-STL-25', 'Modal test', 'B22 3120 - 5.1.3.2.3'],
  ['TP-STL-26', 'Fatigue test for joint', 'B32 0730'],
  ['TP-STL-27', 'Condensate evacuation', 'B32 3200'],
  ['TP-STL-28', 'Hot shake for canning', 'B22 3210'],
  ['TP-STL-29', 'Thermal shock', 'Acc. ST Project'],
  ['TP-STL-30', 'Ressonance Test', 'Acc. ST Project']
];

const CATALOGO_FORD = [
  ['TP-FRD-01', 'Thermal fatigue rig test', 'CETP 09.00-E-306'],
  ['TP-FRD-02', 'Catalytic Converter & Pipe HeatShield Structural Durability Screening Test', 'CETP 09.00-L-306'],
  ['TP-FRD-03', 'Global Catalytic Converter Water Quench', 'CETP 09.02-E-303'],
  ['TP-FRD-04', 'Global Emission Assembly Mechanical Step Stres', 'CETP 09.02-E-308'],
  ['TP-FRD-05', 'Manifold Crack test', 'CETP 03.01-L-312'],
  ['TP-FRD-06', 'High Speed Dyno', 'CETP09.00-E-308'],
  ['TP-FRD-07', 'Cold Flow Back-pressure', 'CETP 09.00-L-403'],
  ['TP-FRD-08', 'Tail Pipe Noise', 'CETP 09.00-L-901'],
  ['TP-FRD-09', 'Condensate Evacuatione', 'CETP 09.00-E-400'],
  ['TP-FRD-10', 'Life Fatigue Curves (S-N Curve)', 'CETP 09.00-E-309'],
  ['TP-FRD-11', 'Hot Vibration Manifold Joint Durability', 'TM-09.03-E-300']
];

const CATALOGO_VW = [
  ['TP-VW-01', 'Hot Shaker Test', 'EP 18310.55'],
  ['TP-VW-02', 'Thermal Fatigue Test', 'EP 18310.55'],
  ['TP-VW-03', 'Crack Test Under Overrun Conditions', 'EP EP18100.20'],
  ['TP-VW-04', 'Fatigue Test', 'TL 82391']
];

const CATALOGO_HYUNDAI = [
  ['TP-HYU-01', 'NVH Test', 'ES 28600-09 6.3'],
  ['TP-HYU-02', 'Hanger / Pipe Durability', 'ES 28600-22'],
  ['TP-HYU-03', 'Backpressure', 'ES 28600-09 - 6.1'],
  ['TP-HYU-04', 'Hot & Cold Vibration', 'ES28530-01'],
  ['TP-HYU-05', 'Radiation Noise Test', 'ES 28600-09 - 6.4'],
  ['TP-HYU-06', 'Ressonance Frequency Test', 'ES 28600-09 - 6.5'],
  ['TP-HYU-07', 'Thermal Shock Test', 'ES 28600-09 - 6.7'],
  ['TP-HYU-08', 'Shell Stifness Test', 'ES 28600-09 - 6.9'],
  ['TP-HYU-09', 'Condensate Water Noise', 'ES 28600-09 - 6.11']
];

const CATALOGO_RSA = [
  ['TP-RSA-01', 'Cold Flow Backpresure', '34-05-803/--J'],
  ['TP-RSA-02', 'Thermal Shock', '34-05-803/--J'],
  ['TP-RSA-03', 'Hot Shaker', '34-05-803/--J'],
  ['TP-RSA-04', 'Condensate Evacuation', '34-05-803/--J']
];

const CATALOGO_NISSAN = [
  ['TP-NIS-01', 'Thermal Cycle Durability', '20000NDS01'],
  ['TP-NIS-02', 'Bypass rate', '20080NDS01'],
  ['TP-NIS-03', 'Catalyst Retaining Performance Test', '20080NDS01'],
  ['TP-NIS-04', 'Mount Bracket Durability', '20000NDS01']
];

function conferirCatalogo(base, clienteId, esperado) {
  assert.ok(util.porId(base.clientes, clienteId), clienteId + ' precisa estar no cadastro');
  const doCliente = base.testes.filter((t) => (t.clientes || []).indexOf(clienteId) !== -1);
  assert.deepEqual(doCliente.map((t) => [t.id, t.nome, t.norma]), esperado);
  doCliente.forEach((t) => {
    assert.equal(t.revisao, 'Rev. 01', t.id + ' is not on revision 1');
    assert.deepEqual(t.clientes, [clienteId], t.id + ' is required by more than one customer');
  });
}

test('the seed catalogue carries the GM procedures with standard and revision 1', () => {
  conferirCatalogo(require('../src/data.js').seed(), 'CLI-GM', CATALOGO_GM);
});

test('the seed catalogue carries the Stellantis procedures with standard and revision 1', () => {
  conferirCatalogo(require('../src/data.js').seed(), 'CLI-STL', CATALOGO_STELLANTIS);
});

test('the seed catalogue carries the Ford procedures with standard and revision 1', () => {
  conferirCatalogo(require('../src/data.js').seed(), 'CLI-FRD', CATALOGO_FORD);
});

test('the seed catalogue carries the VW procedures with standard and revision 1', () => {
  conferirCatalogo(require('../src/data.js').seed(), 'CLI-VW', CATALOGO_VW);
});

test('the seed catalogue carries the Hyundai procedures with standard and revision 1', () => {
  conferirCatalogo(require('../src/data.js').seed(), 'CLI-HYU', CATALOGO_HYUNDAI);
});

test('the seed catalogue carries the RSA procedures with standard and revision 1', () => {
  conferirCatalogo(require('../src/data.js').seed(), 'CLI-RSA', CATALOGO_RSA);
});

test('the seed catalogue carries the Nissan procedures with standard and revision 1', () => {
  conferirCatalogo(require('../src/data.js').seed(), 'CLI-NIS', CATALOGO_NISSAN);
});

test('Ford and Forvia Faurecia are different customers', () => {
  const base = require('../src/data.js').seed();
  assert.equal(util.porId(base.clientes, 'CLI-FRD').nome, 'Ford');
  assert.equal(util.porId(base.clientes, 'CLI-FOR').nome, 'Forvia Faurecia');
  assert.equal(base.testes.filter((t) => (t.clientes || []).indexOf('CLI-FOR') !== -1).length, 0,
    'no seed catalogue procedure belongs to Forvia');
});

test('the seed catalogue has only the expected customers, with no repeated code', () => {
  const base = require('../src/data.js').seed();
  assert.equal(base.testes.length, CATALOGO_GM.length + CATALOGO_STELLANTIS.length +
    CATALOGO_FORD.length + CATALOGO_VW.length + CATALOGO_HYUNDAI.length +
    CATALOGO_RSA.length + CATALOGO_NISSAN.length);
  assert.equal(new Set(base.testes.map((t) => t.id)).size, base.testes.length,
    'repeated procedure code');
});

test('part types are generic, with no customer and no system end', () => {
  const base = require('../src/data.js').seed();
  assert.deepEqual(base.pecas.map((p) => p.nome),
    ['Hot End', 'Canning', 'Cold End', 'Muffler', 'Component']);
  base.pecas.forEach((p) => {
    assert.equal(p.clienteId, undefined, p.nome + ' is still tied to a customer');
    assert.equal(p.area, undefined, p.nome + ' is still tied to a system end');
    assert.equal(p.dataAmostras, undefined, p.nome + ' ainda guarda data de amostras');
  });
});

test('a quote request reserves no rig but still enters the cost', () => {
  const s = estado({ demandas: [demanda({ id: 'COT', tipoLti: 'COTACAO', lti: '' })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  const a = alocacaoDe(plano, 'COT');

  assert.equal(a.cotacao, true);
  assert.equal(a.inicio, null, 'a quote gets no slot');
  assert.ok(a.custo.total > 0, 'the cost is still computed for the budget');
  assert.equal(plano.agendadas.length, 0);
  assert.equal(plano.bloqueadas.length, 0, 'a quote does not count as blocked');
  assert.equal(plano.cotacoes.length, 1);
});

test('a quote neither competes for nor occupies the position of schedulable requests', () => {
  const s = estado({
    demandas: [
      demanda({ id: 'COT', tipoLti: 'COTACAO', lti: '' }),
      demanda({ id: 'REAL', tipoLti: 'DV' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(alocacaoDe(plano, 'REAL').inicio, SEGUNDA, 'a demanda real usa a bancada normalmente');
  assert.equal(alocacaoDe(plano, 'COT').inicio, null);
});

test('ehCotacao recognises the COTACAO classification and only that', () => {
  assert.equal(scheduler.ehCotacao({ tipoLti: 'COTACAO' }), true);
  assert.equal(scheduler.ehCotacao({ tipoLti: 'DV' }), false);
  assert.equal(scheduler.ehCotacao({ tipoLti: 'PV' }), false);
  assert.equal(scheduler.ehCotacao({ tipoLti: 'VAVE' }), false);
  assert.equal(scheduler.ehCotacao({ tipoLti: 'ALGO_INEXISTENTE' }), false);
});

test('a test on two rigs reserves a position on both at the same time', () => {
  const s = estado({
    equipamentos: [
      equipamento({ id: 'EQ-01', continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] }),
      equipamento({ id: 'EQ-02', continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] })
    ],
    testes: [teste({ equipamentoGrupos: ['EQ-01', 'EQ-02'], horasEnsaio: 48 })]
  });
  const a = alocacaoDe(scheduler.planejar(s, SEGUNDA), 'DM-01');
  assert.deepEqual(a.equipamentos.map((eq) => eq.id), ['EQ-01', 'EQ-02']);
  assert.equal(a.inicio, SEGUNDA);
  assert.equal(a.posicoes['EQ-01'], 0);
  assert.equal(a.posicoes['EQ-02'], 0);
});

test('a shared rig pushes the other test out, even with its own rig free', () => {
  /* DUPLO uses EQ-01 + EQ-02; SIMPLES uses only EQ-02, which is held by the first one. */
  const s = estado({
    equipamentos: [
      equipamento({ id: 'EQ-01', continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] }),
      equipamento({ id: 'EQ-02', continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] })
    ],
    testes: [
      teste({ id: 'TP-DUPLO', equipamentoGrupos: ['EQ-01', 'EQ-02'], horasEnsaio: 72 }),
      teste({ id: 'TP-SIMPLES', equipamentoGrupos: ['EQ-02'], horasEnsaio: 24 })
    ],
    demandas: [
      demanda({ id: 'DUPLO', testeId: 'TP-DUPLO', prioridade: 'ALTA' }),
      demanda({ id: 'SIMPLES', testeId: 'TP-SIMPLES', prioridade: 'BAIXA' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const duplo = alocacaoDe(plano, 'DUPLO');
  const simples = alocacaoDe(plano, 'SIMPLES');
  assert.equal(duplo.inicio, SEGUNDA);
  assert.equal(duplo.fim, '2026-07-08');
  assert.ok(util.diffDias(duplo.fim, simples.inicio) > 0,
    'the single test cannot get in while the rig is held by the double one');
});

test('the pace is set by the rig with the shortest shift', () => {
  /* 48 h numa bancada 24 h/dia dariam 2 dias; com uma de 8 h/dia junto, viram 6. */
  const s = estado({
    equipamentos: [
      equipamento({ id: 'EQ-01', continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] }),
      equipamento({ id: 'EQ-02', continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5] })
    ],
    testes: [teste({ equipamentoGrupos: ['EQ-01', 'EQ-02'], horasEnsaio: 48 })]
  });
  const eqs = s.equipamentos;
  assert.equal(scheduler.diasDeOperacao(s.testes[0], eqs), 6);

  const a = alocacaoDe(scheduler.planejar(s, SEGUNDA), 'DM-01');
  /* Only working days in the intersection count: Mon-Fri. 6 working days from 06 Jul -> 13 Jul. */
  assert.equal(a.inicio, SEGUNDA);
  assert.equal(a.fim, '2026-07-13');
});

test('maintenance on any of the rigs blocks the slot', () => {
  const s = estado({
    equipamentos: [
      equipamento({ id: 'EQ-01', continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] }),
      equipamento({
        id: 'EQ-02', continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6],
        manutencao: [{ id: 'MN-1', inicio: '2026-07-07', fim: '2026-07-10', motivo: 'Calibration' }]
      })
    ],
    testes: [teste({ equipamentoGrupos: ['EQ-01', 'EQ-02'], horasEnsaio: 48 })]
  });
  const a = alocacaoDe(scheduler.planejar(s, SEGUNDA), 'DM-01');
  assert.equal(a.inicio, '2026-07-11', 'a parada da segunda bancada empurra o ensaio');
});

test('a procedure with no equipment at all is blocked with a clear reason', () => {
  const s = estado({ testes: [teste({ equipamentoGrupos: [] })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(plano.bloqueadas.length, 1);
  assert.match(plano.bloqueadas[0].motivo, /no equipment/i);
});

/* Hours measured by the test centre: [test, setup, reporting]. Whatever is not here has not
   been measured yet and stays at zero in the seed catalogue. */
const HORAS_LEVANTADAS = {
  'TP-GM-02': [300, 20, 14],
  'TP-GM-03': [150, 16, 16],
  'TP-GM-04': [20, 15, 12],
  'TP-GM-05': [700, 11, 13],
  'TP-GM-07': [9, 9, 7],
  'TP-GM-08': [5, 9, 19],
  'TP-STL-02': [16, 12, 40],
  'TP-STL-05': [30, 25, 41],
  'TP-STL-06': [82, 21, 25],
  'TP-STL-07': [82, 21, 24],
  'TP-STL-08': [232.8, 11, 30],
  'TP-STL-10': [81, 18, 27],
  'TP-STL-11': [1089, 24, 38],
  'TP-STL-15': [8, 11, 18],
  'TP-STL-20': [360, 22, 40],
  'TP-FRD-03': [14, 7, 19],
  'TP-FRD-07': [4.8, 14, 11],
  'TP-VW-04': [135, 8, 15],
  'TP-HYU-02': [109, 14, 12],
  'TP-HYU-03': [4, 3, 12],
  'TP-RSA-02': [332, 9, 19],
  'TP-RSA-03': [302, 14, 21],
  'TP-NIS-01': [375, 11, 6]
};

test('the measured hours are in the catalogue, procedure by procedure', () => {
  const base = require('../src/data.js').seed();
  Object.keys(HORAS_LEVANTADAS).forEach((id) => {
    const t = util.porId(base.testes, id);
    assert.ok(t, id + ' does not exist in the catalogue');
    const [ensaio, setup, report] = HORAS_LEVANTADAS[id];
    assert.equal(t.horasEnsaio, ensaio, id + ' com horas de ensaio erradas');
    assert.equal(t.horasSetup, setup, id + ' com horas de setup erradas');
    assert.equal(t.horasReport, report, id + ' com horas de report erradas');
  });
});

test('whatever has not been measured yet stays at zero', () => {
  const base = require('../src/data.js').seed();
  base.testes.forEach((t) => {
    ['horasSetup', 'horasEnsaio', 'horasReport', 'custoInsumos'].forEach((campo) => {
      assert.equal(typeof t[campo], 'number', t.id + ' sem o campo ' + campo);
    });
    assert.equal(t.custoBase, undefined, t.id + ' ainda usa custoBase');
    /* The consumables cost has not been given for any procedure yet. */
    assert.equal(t.custoInsumos, 0, t.id + ' com custo de insumos inesperado');

    if (!HORAS_LEVANTADAS[t.id]) {
      assert.equal(t.horasSetup + t.horasEnsaio + t.horasReport, 0,
        t.id + ' recebeu horas sem estar na tabela levantada');
    }
  });
});

test('the catalogue cost matches the formula, procedure by procedure', () => {
  const base = catalogoCompletado(require('../src/data.js').seed());
  base.testes.forEach((t) => {
    const c = scheduler.custoCatalogo(t, base.hourlyRate);
    const esperado = (t.horasSetup + t.horasEnsaio + t.horasReport) * base.hourlyRate + t.custoInsumos;
    assert.equal(c.custoProcedimento, esperado, t.id);
    assert.ok(c.custoProcedimento > 0, t.id + ' completado deveria ter custo');
  });
});

/* ---- Hourly rate do centro de testes ---- */

test('the hourly rate is a single value in the state, not a procedure field', () => {
  const base = require('../src/data.js').seed();
  assert.equal(base.hourlyRate, 368.75);
  assert.equal(base.hourlyRateVigencia, '2026');
  base.testes.forEach((t) => {
    assert.equal(t.hourlyRate, undefined, t.id + ' still carries an hourly rate of its own');
  });
  assert.equal(scheduler.taxaHoraria(base), 368.75);
});

test('changing the rate reprices the whole catalogue at once', () => {
  const base = catalogoCompletado(require('../src/data.js').seed());
  const soma = (rate) => base.testes.reduce(
    (t, p) => t + scheduler.custoCatalogo(p, rate).custoHoras, 0);

  assert.equal(soma(368.75) * 2, soma(737.5),
    'dobrar o rate dobra o custo de horas de todos os procedimentos');
});

test('the cost uses the rate from the state being scheduled, not a constant', () => {
  const s = estado({
    hourlyRate: 368.75,
    testes: [teste({ horasSetup: 0, horasEnsaio: 8, horasReport: 0, custoInsumos: 0 })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(alocacaoDe(plano, 'DM-01').custo.hourlyRate, 368.75);
  assert.equal(alocacaoDe(plano, 'DM-01').custo.custoHoras, 8 * 368.75);
});

/* ---- Interchangeable rig groups ---- */

function pool(qtd, extra) {
  const lista = [];
  for (let i = 1; i <= qtd; i++) {
    lista.push(equipamento(Object.assign({
      id: 'BRN-' + i, nome: 'Burner ' + i, grupo: 'Burner',
      continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6]
    }, extra)));
  }
  return lista;
}

test('grouping gathers units by group and keeps the register order', () => {
  const grupos = scheduler.agruparEquipamentos(pool(3).concat([
    equipamento({ id: 'SHK', nome: 'Shaker', grupo: 'Shaker' })
  ]));
  assert.deepEqual(grupos.map((g) => g.id), ['Burner', 'Shaker']);
  assert.equal(grupos[0].membros.length, 3);
  assert.equal(grupos[1].membros.length, 1);
});

test('a unit with no group defined forms a group of its own', () => {
  const grupos = scheduler.agruparEquipamentos([{ id: 'X1', nome: 'Bancada X' }]);
  assert.deepEqual(grupos.map((g) => g.id), ['Bancada X']);
});

test('three requests in the same group occupy the three units in parallel', () => {
  const s = estado({
    equipamentos: pool(3),
    testes: [teste({ equipamentoGrupos: ['Burner'], horasEnsaio: 72 })],
    demandas: [demanda({ id: 'A' }), demanda({ id: 'B' }), demanda({ id: 'C' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const usadas = ['A', 'B', 'C'].map((id) => alocacaoDe(plano, id));

  usadas.forEach((a) => assert.equal(a.inicio, SEGUNDA, 'they all start on the same day'));
  const unidades = usadas.map((a) => a.equipamentos[0].id).sort();
  assert.deepEqual(unidades, ['BRN-1', 'BRN-2', 'BRN-3'], 'uma unidade distinta para cada');
});

test('the fourth request lands on the unit that frees up first', () => {
  /* A and B take 3 days; C takes 9. The fourth should go to BRN-1 or BRN-2, not the long one. */
  const s = estado({
    equipamentos: pool(3),
    testes: [
      teste({ id: 'TP-CURTO', equipamentoGrupos: ['Burner'], horasEnsaio: 72 }),
      teste({ id: 'TP-LONGO', equipamentoGrupos: ['Burner'], horasEnsaio: 216 })
    ],
    demandas: [
      demanda({ id: 'A', testeId: 'TP-CURTO', prioridade: 'ALTA' }),
      demanda({ id: 'B', testeId: 'TP-CURTO', prioridade: 'ALTA' }),
      demanda({ id: 'C', testeId: 'TP-LONGO', prioridade: 'ALTA' }),
      demanda({ id: 'D', testeId: 'TP-CURTO', prioridade: 'BAIXA' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const d = alocacaoDe(plano, 'D');
  const longa = alocacaoDe(plano, 'C');

  assert.equal(d.inicio, '2026-07-09', 'entra assim que a primeira curta desocupa');
  assert.notEqual(d.equipamentos[0].id, longa.equipamentos[0].id,
    'it does not wait for the unit held by the long test');
});

test('maintenance on one unit throws the request onto the free sibling', () => {
  const unidades = pool(2);
  unidades[0].manutencao = [{ id: 'MN-1', inicio: SEGUNDA, fim: '2026-07-20', motivo: 'Calibration' }];
  const s = estado({
    equipamentos: unidades,
    testes: [teste({ equipamentoGrupos: ['Burner'], horasEnsaio: 48 })]
  });
  const a = alocacaoDe(scheduler.planejar(s, SEGUNDA), 'DM-01');
  assert.equal(a.equipamentos[0].id, 'BRN-2', 'it uses the one that is not down');
  assert.equal(a.inicio, SEGUNDA, 'without waiting for the other one to come back');
});

test('among units free on the same day, the one that finishes earlier wins', () => {
  /* BRN-1 runs 24 h/day and BRN-2 only 8 h: the same test finishes earlier on the first. */
  const s = estado({
    equipamentos: [
      equipamento({ id: 'BRN-1', nome: 'Burner 1', grupo: 'Burner', continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6] }),
      equipamento({ id: 'BRN-2', nome: 'Burner 2', grupo: 'Burner', continuo: false, horasDia: 8, diasUteis: [0, 1, 2, 3, 4, 5, 6] })
    ],
    testes: [teste({ equipamentoGrupos: ['Burner'], horasEnsaio: 48 })]
  });
  const a = alocacaoDe(scheduler.planejar(s, SEGUNDA), 'DM-01');
  assert.equal(a.equipamentos[0].id, 'BRN-1');
  assert.equal(a.diasOperacao, 2);
});

test('two groups together pick the best combination of units', () => {
  const unidades = pool(2).concat([
    equipamento({ id: 'MTS-1', nome: 'MTS 1', grupo: 'MTS', continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6] }),
    equipamento({ id: 'MTS-2', nome: 'MTS 2', grupo: 'MTS', continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6] })
  ]);
  /* BRN-1 and MTS-1 are already held by a long, high-priority test. */
  const s = estado({
    equipamentos: unidades,
    testes: [
      teste({ id: 'TP-B', equipamentoGrupos: ['Burner'], horasEnsaio: 240 }),
      teste({ id: 'TP-M', equipamentoGrupos: ['MTS'], horasEnsaio: 240 }),
      teste({ id: 'TP-DUPLO', equipamentoGrupos: ['Burner', 'MTS'], horasEnsaio: 48 })
    ],
    demandas: [
      demanda({ id: 'B', testeId: 'TP-B', prioridade: 'ALTA' }),
      demanda({ id: 'M', testeId: 'TP-M', prioridade: 'ALTA' }),
      demanda({ id: 'DUPLO', testeId: 'TP-DUPLO', prioridade: 'BAIXA' })
    ]
  });
  const duplo = alocacaoDe(scheduler.planejar(s, SEGUNDA), 'DUPLO');
  assert.equal(duplo.inicio, SEGUNDA, 'there is a free pair, so there is no need to wait');
  assert.deepEqual(duplo.equipamentos.map((eq) => eq.id).sort(), ['BRN-2', 'MTS-2']);
});

test('a group with no unit registered becomes a block with a clear reason', () => {
  const s = estado({ testes: [teste({ equipamentoGrupos: ['Camara'] })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(plano.bloqueadas.length, 1);
  assert.match(plano.bloqueadas[0].motivo, /Camara/);
  assert.match(plano.bloqueadas[0].motivo, /has no unit registered/);
});

test('the fleet has Burner and MTS as groups with several units', () => {
  const base = require('../src/data.js').seed();
  const grupos = scheduler.agruparEquipamentos(base.equipamentos);
  const porId = (id) => grupos.find((g) => g.id === id);

  assert.equal(porId('Burner').membros.length, 3);
  assert.equal(porId('MTS').membros.length, 4);
  assert.equal(porId('Shaker').membros.length, 1);
  base.testes.forEach((t) => {
    scheduler.gruposDoTeste(t).forEach((id) => {
      assert.ok(porId(id), t.id + ' pede o grupo inexistente ' + id);
    });
  });
});

test('the customer register has GM and has neither Tenneco nor Eberspächer', () => {
  const base = require('../src/data.js').seed();
  const ids = base.clientes.map((c) => c.id);
  assert.deepEqual(ids,
    ['CLI-GM', 'CLI-FRD', 'CLI-FOR', 'CLI-VW', 'CLI-HYU', 'CLI-RSA', 'CLI-NIS',
      'CLI-STL', 'CLI-SCA']);

  base.testes.forEach((t) => {
    (t.clientes || []).forEach((id) => {
      assert.ok(ids.includes(id), t.id + ' exige cliente inexistente ' + id);
    });
  });
});
