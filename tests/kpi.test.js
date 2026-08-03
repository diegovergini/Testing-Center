/* Dashboard indicator tests: volume for the month, utilisation against capacity, right first
   time and cost by breakdown. */
const test = require('node:test');
const assert = require('node:assert');

const util = require('../src/util.js');
require('../src/data.js');
const scheduler = require('../src/scheduler.js');
const kpi = require('../src/kpi.js');

/* July 2026: the 1st is a Wednesday, the 31st a Friday. 23 working days, Monday to Friday. */
const MES = '2026-07';
const SEGUNDA = '2026-07-06';

function equipamento(extra) {
  const eq = Object.assign({
    id: 'EQ-01', nome: 'Bancada', posicoes: 1, continuo: false, horasDia: 8,
    diasUteis: [1, 2, 3, 4, 5], manutencao: []
  }, extra);
  if (!eq.grupo) eq.grupo = eq.id;
  return eq;
}

function teste(extra) {
  return Object.assign({
    id: 'TP-01', nome: 'Ensaio', area: 'COLD', equipamentoGrupos: ['EQ-01'], revisao: 'Rev. 01',
    clientes: [], horasSetup: 0, horasEnsaio: 8, horasReport: 0, amostras: 1, custoInsumos: 0
  }, extra);
}

function demanda(extra) {
  return Object.assign({
    id: 'DM-01', testeId: 'TP-01', pecaId: 'PC-01', clienteId: 'CLI-01',
    projeto: 'Projeto A', lti: 'LTI-1', tipoLti: 'DV', dataAmostras: SEGUNDA,
    prioridade: 'MEDIA', quantidade: 1, prazo: '', inicioFixo: '', status: 'SOLICITADA',
    criadoEm: SEGUNDA, dataConclusao: '', dataRelatorio: '',
    relatorioCorrecoes: 0, historico: []
  }, extra);
}

function estado(extra) {
  return Object.assign({
    hourlyRate: 100,
    clientes: [{ id: 'CLI-01', nome: 'Cliente Um' }, { id: 'CLI-02', nome: 'Cliente Dois' }],
    equipamentos: [equipamento()],
    testes: [teste()],
    pecas: [{ id: 'PC-01', nome: 'Part type', custoAmostra: 0 }],
    demandas: [demanda()]
  }, extra);
}

/* ---- Month boundaries ---- */

test('the last day of the month is computed without a calendar table', () => {
  assert.equal(kpi.ultimoDia('2026-07'), '2026-07-31');
  assert.equal(kpi.ultimoDia('2026-02'), '2026-02-28');
  assert.equal(kpi.ultimoDia('2028-02'), '2028-02-29', 'ano bissexto');
  assert.equal(kpi.ultimoDia('2026-12'), '2026-12-31', 'dezembro vira o ano');
});

/* ---- Capacity and utilisation ---- */

test('the month\'s capacity counts only the days the rig operates', () => {
  const c = kpi.capacidadeNoMes(equipamento(), MES);
  assert.equal(c.diasUteis, 23, 'julho de 2026 tem 23 dias de segunda a sexta');
  assert.equal(c.horas, 23 * 8);
});

test('continuous equipment offers 24 h on every day', () => {
  const c = kpi.capacidadeNoMes(
    equipamento({ continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6] }), MES);
  assert.equal(c.diasUteis, 31);
  assert.equal(c.horas, 31 * 24);
});

test('parallel positions multiply the capacity', () => {
  assert.equal(kpi.capacidadeNoMes(equipamento({ posicoes: 3 }), MES).horas, 23 * 8 * 3);
});

test('maintenance comes off the month\'s capacity', () => {
  const eq = equipamento({
    manutencao: [{ id: 'MN', inicio: '2026-07-06', fim: '2026-07-10', motivo: 'Calibration' }]
  });
  const c = kpi.capacidadeNoMes(eq, MES);
  assert.equal(c.diasParados, 5, 'five working days down');
  assert.equal(c.diasUteis, 18);
  assert.equal(c.horas, 18 * 8);
});

test('the month\'s utilisation comes from the hours the schedule reserved', () => {
  const s = estado({
    testes: [teste({ horasEnsaio: 40 })],
    demandas: [demanda({ dataAmostras: SEGUNDA })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const o = kpi.ocupacaoNoMes(s, plano, MES)[0];

  assert.equal(o.horasPlanejadas, 40, '5 dias de 8 h, todos dentro de julho');
  assert.equal(o.capacidade, 23 * 8);
  assert.equal(o.ensaios, 1);
  assert.equal(Math.round(o.ocupacao * 1000) / 1000, Math.round(40 / 184 * 1000) / 1000);
});

test('a test spanning a month boundary apportions the hours between the two months', () => {
  /* 80 h on an 8 h/day rig = 10 working days from 27 Jul: 5 in July, 5 in August. */
  const s = estado({
    testes: [teste({ horasEnsaio: 80 })],
    demandas: [demanda({ dataAmostras: '2026-07-27' })]
  });
  const plano = scheduler.planejar(s, '2026-07-27');

  const julho = kpi.ocupacaoNoMes(s, plano, '2026-07')[0];
  const agosto = kpi.ocupacaoNoMes(s, plano, '2026-08')[0];

  assert.equal(julho.horasPlanejadas, 40);
  assert.equal(agosto.horasPlanejadas, 40);
  assert.equal(julho.horasPlanejadas + agosto.horasPlanejadas, 80,
    'the apportioned total is the test total');
});

test('a test occupying two rigs counts the hours on both calendars', () => {
  const s = estado({
    equipamentos: [equipamento({ id: 'EQ-01' }), equipamento({ id: 'EQ-02', nome: 'Outra' })],
    testes: [teste({ equipamentoGrupos: ['EQ-01', 'EQ-02'], horasEnsaio: 24 })],
    demandas: [demanda()]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const ocup = kpi.ocupacaoNoMes(s, plano, MES);

  assert.equal(ocup[0].horasPlanejadas, 24);
  assert.equal(ocup[1].horasPlanejadas, 24, 'a bancada fica presa o mesmo tempo');
});

test('utilisation never exceeds capacity, because the scheduler respects the positions', () => {
  const s = estado({
    equipamentos: [equipamento({ posicoes: 3 })],
    testes: [teste({ horasEnsaio: 160 })],
    demandas: [demanda({ id: 'A' }), demanda({ id: 'B' }), demanda({ id: 'C' }),
      demanda({ id: 'D' }), demanda({ id: 'E' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const o = kpi.ocupacaoNoMes(s, plano, MES)[0];

  assert.ok(o.horasPlanejadas > 0);
  assert.ok(o.ocupacao <= 1, 'the queue pushes the excess into the next month');
  assert.ok(o.horasPlanejadas <= o.capacidade);
});

test('a completed request does not vanish from the cost, even outside the schedule', () => {
  const s = estado({
    demandas: [
      demanda({ id: 'A', projeto: 'Onix' }),
      demanda({ id: 'B', projeto: 'Onix', status: 'CONCLUIDA', dataConclusao: '2026-07-10' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);

  assert.equal(plano.alocacoes.length, 1, 'the scheduler only carries the active request');
  assert.equal(kpi.custoPorProjeto(s, plano)[0].ensaios, 2,
    'the dashboard adds what has already run together with what is still to run');
});

/* ---- Testes realizados ---- */

test('only what was completed in the month counts as carried out in it', () => {
  const s = estado({
    demandas: [
      demanda({ id: 'A', status: 'CONCLUIDA', dataConclusao: '2026-07-15' }),
      demanda({ id: 'B', status: 'CONCLUIDA', dataConclusao: '2026-08-02' }),
      demanda({ id: 'C', status: 'EM_EXECUCAO', dataConclusao: '2026-07-20' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const realizados = kpi.realizadosNoMes(s, plano, MES);

  assert.deepEqual(realizados.map((a) => a.demandaId), ['A'],
    'the wrong month and a non-completed status stay out');
});

test('completed without a completion date is assigned to no month, and the dashboard says so', () => {
  const s = estado({
    demandas: [
      demanda({ id: 'A', status: 'CONCLUIDA', dataConclusao: '' }),
      demanda({ id: 'B', status: 'CONCLUIDA', dataConclusao: '2026-07-09' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);

  assert.deepEqual(kpi.realizadosNoMes(s, plano, MES).map((a) => a.demandaId), ['B'],
    'with no date there is no telling which month it fell in — better not to count than to count wrong');
  assert.deepEqual(kpi.concluidasSemData(s).map((d) => d.id), ['A'],
    'o painel cobra o preenchimento em vez de esconder o problema');
});

test('a still-active request uses the planned end as its completion reference', () => {
  const s = estado({ demandas: [demanda({ status: 'EM_EXECUCAO' })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(kpi.dataDeConclusao(plano.alocacoes[0]), plano.alocacoes[0].fim);
});

/* ---- Certo da primeira vez ---- */

test('right first time is a report approved with no rework at all', () => {
  const s = estado({
    demandas: [
      demanda({ id: 'A', status: 'VALIDADA', dataConclusao: '2026-07-10',
        dataRelatorio: '2026-07-20', relatorioCorrecoes: 0 }),
      demanda({ id: 'B', status: 'VALIDADA', dataConclusao: '2026-07-11',
        dataRelatorio: '2026-07-25', relatorioCorrecoes: 2 }),
      demanda({ id: 'C', status: 'VALIDADA', dataConclusao: '2026-07-12',
        dataRelatorio: '2026-07-28', relatorioCorrecoes: 0 }),
      demanda({ id: 'D', status: 'CONCLUIDA', dataConclusao: '2026-07-13',
        status: 'RELATORIO_ENVIADO', dataRelatorio: '' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const ftt = kpi.certoDaPrimeiraVez(s, plano, MES);

  assert.equal(ftt.aprovados, 3, 'anything under review stays out of the count');
  assert.equal(ftt.semCorrecao, 2);
  assert.equal(ftt.comCorrecao, 1);
  assert.equal(Math.round(ftt.indice * 100), 67);
});

test('the index counts by the sign-off month, not the execution one', () => {
  const s = estado({
    demandas: [demanda({ status: 'VALIDADA', dataConclusao: '2026-07-10',
      dataRelatorio: '2026-08-05', relatorioCorrecoes: 0 })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);

  assert.equal(kpi.certoDaPrimeiraVez(s, plano, '2026-07').aprovados, 0);
  assert.equal(kpi.certoDaPrimeiraVez(s, plano, '2026-08').aprovados, 1);
});

test('with no report signed off in the month, the index is null rather than zero', () => {
  const s = estado();
  const plano = scheduler.planejar(s, SEGUNDA);
  const ftt = kpi.certoDaPrimeiraVez(s, plano, MES);
  assert.equal(ftt.indice, null, 'zero out of zero is not a 0% hit rate');
});

/* ---- Custo ---- */

test('cost by project groups and sorts by the largest', () => {
  const s = estado({
    testes: [teste({ horasEnsaio: 10 }), teste({ id: 'TP-02', horasEnsaio: 40 })],
    demandas: [
      demanda({ id: 'A', projeto: 'Onix', testeId: 'TP-01' }),
      demanda({ id: 'B', projeto: 'Onix', testeId: 'TP-01' }),
      demanda({ id: 'C', projeto: 'Tracker', testeId: 'TP-02' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const grupos = kpi.custoPorProjeto(s, plano);

  assert.deepEqual(grupos.map((g) => g.chave), ['Tracker', 'Onix']);
  assert.equal(grupos[0].custo, 40 * 100);
  assert.equal(grupos[1].custo, 2 * 10 * 100);
  assert.equal(grupos[1].ensaios, 2);
});

test('a request with no project does not vanish from the cost, it falls under "No project"', () => {
  const s = estado({ demandas: [demanda({ projeto: '   ' })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(kpi.custoPorProjeto(s, plano)[0].chave, 'No project');
});

test('quotes and cancelled requests stay out of the cost breakdowns', () => {
  const s = estado({
    demandas: [
      demanda({ id: 'A', projeto: 'Onix' }),
      demanda({ id: 'B', projeto: 'Onix', tipoLti: 'COTACAO' }),
      demanda({ id: 'C', projeto: 'Onix', status: 'CANCELADA' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const grupos = kpi.custoPorProjeto(s, plano);

  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].ensaios, 1, 'a budget is not confirmed work; the cancelled one is out');
});

test('cost by customer uses the registered name', () => {
  const s = estado({
    demandas: [demanda({ id: 'A', clienteId: 'CLI-02' }), demanda({ id: 'B', clienteId: 'CLI-01' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const nomes = kpi.custoPorCliente(s, plano).map((g) => g.chave).sort();
  assert.deepEqual(nomes, ['Cliente Dois', 'Cliente Um']);
});

test('cost scheduled in the year adds up the tests that start in it', () => {
  const s = estado({
    testes: [teste({ horasEnsaio: 8 })],
    demandas: [
      demanda({ id: 'A', dataAmostras: '2026-07-06' }),
      demanda({ id: 'B', dataAmostras: '2027-01-04' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);

  assert.equal(kpi.custoPlanejadoNoAno(plano, 2026).ensaios, 1);
  assert.equal(kpi.custoPlanejadoNoAno(plano, 2026).custo, 8 * 100);
  assert.equal(kpi.custoPlanejadoNoAno(plano, 2027).ensaios, 1);
});

test('the month selector lists the current month and the months with activity', () => {
  const s = estado({
    demandas: [demanda({ status: 'CONCLUIDA', dataConclusao: '2026-03-10',
      dataRelatorio: '2026-04-02', status: 'VALIDADA' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const meses = kpi.mesesComMovimento(s, plano, '2026-07-06');

  assert.ok(meses.includes('2026-07'), 'the current month always shows');
  assert.ok(meses.includes('2026-03'), 'the completion month');
  assert.ok(meses.includes('2026-04'), 'the report sign-off month');
  assert.deepEqual(meses, meses.slice().sort().reverse(), 'do mais recente para o mais antigo');
});
