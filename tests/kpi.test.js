/* Testes dos indicadores do painel: volume do mês, ocupação contra capacidade,
   certo da primeira vez e os cortes de custo. */
const test = require('node:test');
const assert = require('node:assert');

const util = require('../src/util.js');
require('../src/data.js');
const scheduler = require('../src/scheduler.js');
const kpi = require('../src/kpi.js');

/* Julho de 2026: 1º é quarta, 31 é sexta. 23 dias úteis de segunda a sexta. */
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
    pecas: [{ id: 'PC-01', nome: 'Peça', custoAmostra: 0 }],
    demandas: [demanda()]
  }, extra);
}

/* ---- Recortes de mês ---- */

test('o último dia do mês é calculado sem tabela de calendário', () => {
  assert.equal(kpi.ultimoDia('2026-07'), '2026-07-31');
  assert.equal(kpi.ultimoDia('2026-02'), '2026-02-28');
  assert.equal(kpi.ultimoDia('2028-02'), '2028-02-29', 'ano bissexto');
  assert.equal(kpi.ultimoDia('2026-12'), '2026-12-31', 'dezembro vira o ano');
});

/* ---- Capacidade e ocupação ---- */

test('capacidade do mês conta só os dias em que a bancada opera', () => {
  const c = kpi.capacidadeNoMes(equipamento(), MES);
  assert.equal(c.diasUteis, 23, 'julho de 2026 tem 23 dias de segunda a sexta');
  assert.equal(c.horas, 23 * 8);
});

test('equipamento contínuo oferece as 24 h de todos os dias', () => {
  const c = kpi.capacidadeNoMes(
    equipamento({ continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6] }), MES);
  assert.equal(c.diasUteis, 31);
  assert.equal(c.horas, 31 * 24);
});

test('posições em paralelo multiplicam a capacidade', () => {
  assert.equal(kpi.capacidadeNoMes(equipamento({ posicoes: 3 }), MES).horas, 23 * 8 * 3);
});

test('manutenção sai da capacidade do mês', () => {
  const eq = equipamento({
    manutencao: [{ id: 'MN', inicio: '2026-07-06', fim: '2026-07-10', motivo: 'Calibração' }]
  });
  const c = kpi.capacidadeNoMes(eq, MES);
  assert.equal(c.diasParados, 5, 'cinco dias úteis parados');
  assert.equal(c.diasUteis, 18);
  assert.equal(c.horas, 18 * 8);
});

test('a ocupação do mês vem das horas que o planejamento reservou', () => {
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

test('ensaio que atravessa o mês rateia as horas entre os dois meses', () => {
  /* 80 h em bancada de 8 h/dia = 10 dias úteis a partir de 27/07: 5 em julho, 5 em agosto. */
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
    'o total rateado é o total do ensaio');
});

test('ensaio que ocupa duas bancadas conta as horas nas duas agendas', () => {
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

test('a ocupação não passa da capacidade, porque o planejamento respeita as posições', () => {
  const s = estado({
    equipamentos: [equipamento({ posicoes: 3 })],
    testes: [teste({ horasEnsaio: 160 })],
    demandas: [demanda({ id: 'A' }), demanda({ id: 'B' }), demanda({ id: 'C' }),
      demanda({ id: 'D' }), demanda({ id: 'E' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const o = kpi.ocupacaoNoMes(s, plano, MES)[0];

  assert.ok(o.horasPlanejadas > 0);
  assert.ok(o.ocupacao <= 1, 'a fila empurra o excedente para o mês seguinte');
  assert.ok(o.horasPlanejadas <= o.capacidade);
});

test('demanda concluída não some do custo, mesmo fora do planejamento', () => {
  const s = estado({
    demandas: [
      demanda({ id: 'A', projeto: 'Onix' }),
      demanda({ id: 'B', projeto: 'Onix', status: 'CONCLUIDA', dataConclusao: '2026-07-10' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);

  assert.equal(plano.alocacoes.length, 1, 'o planejamento só carrega a demanda ativa');
  assert.equal(kpi.custoPorProjeto(s, plano)[0].ensaios, 2,
    'o painel soma o que já foi executado junto com o que está por executar');
});

/* ---- Testes realizados ---- */

test('só conta como realizado no mês o que foi concluído nele', () => {
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
    'mês errado e status não concluído ficam de fora');
});

test('concluído sem data de conclusão não é atribuído a mês nenhum, e o painel avisa', () => {
  const s = estado({
    demandas: [
      demanda({ id: 'A', status: 'CONCLUIDA', dataConclusao: '' }),
      demanda({ id: 'B', status: 'CONCLUIDA', dataConclusao: '2026-07-09' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);

  assert.deepEqual(kpi.realizadosNoMes(s, plano, MES).map((a) => a.demandaId), ['B'],
    'sem data não dá para dizer em que mês entrou — melhor não contar do que contar errado');
  assert.deepEqual(kpi.concluidasSemData(s).map((d) => d.id), ['A'],
    'o painel cobra o preenchimento em vez de esconder o problema');
});

test('demanda ainda ativa usa o fim planejado como referência de conclusão', () => {
  const s = estado({ demandas: [demanda({ status: 'EM_EXECUCAO' })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(kpi.dataDeConclusao(plano.alocacoes[0]), plano.alocacoes[0].fim);
});

/* ---- Certo da primeira vez ---- */

test('certo da primeira vez é o relatório aprovado sem nenhuma correção', () => {
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

  assert.equal(ftt.aprovados, 3, 'o que está em análise não entra na conta');
  assert.equal(ftt.semCorrecao, 2);
  assert.equal(ftt.comCorrecao, 1);
  assert.equal(Math.round(ftt.indice * 100), 67);
});

test('o índice conta pelo mês da validação, não pelo da execução', () => {
  const s = estado({
    demandas: [demanda({ status: 'VALIDADA', dataConclusao: '2026-07-10',
      dataRelatorio: '2026-08-05', relatorioCorrecoes: 0 })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);

  assert.equal(kpi.certoDaPrimeiraVez(s, plano, '2026-07').aprovados, 0);
  assert.equal(kpi.certoDaPrimeiraVez(s, plano, '2026-08').aprovados, 1);
});

test('sem relatório validado no mês, o índice é nulo em vez de zero', () => {
  const s = estado();
  const plano = scheduler.planejar(s, SEGUNDA);
  const ftt = kpi.certoDaPrimeiraVez(s, plano, MES);
  assert.equal(ftt.indice, null, 'zero de zero não é 0% de acerto');
});

/* ---- Custo ---- */

test('custo por projeto agrupa e ordena pelo maior', () => {
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

test('demanda sem projeto não some do custo, cai em "Sem projeto"', () => {
  const s = estado({ demandas: [demanda({ projeto: '   ' })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(kpi.custoPorProjeto(s, plano)[0].chave, 'Sem projeto');
});

test('cotação e demanda cancelada ficam fora dos cortes de custo', () => {
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
  assert.equal(grupos[0].ensaios, 1, 'orçamento não é serviço confirmado; cancelado saiu');
});

test('custo por cliente usa o nome cadastrado', () => {
  const s = estado({
    demandas: [demanda({ id: 'A', clienteId: 'CLI-02' }), demanda({ id: 'B', clienteId: 'CLI-01' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const nomes = kpi.custoPorCliente(s, plano).map((g) => g.chave).sort();
  assert.deepEqual(nomes, ['Cliente Dois', 'Cliente Um']);
});

test('custo planejado no ano soma os ensaios que começam nele', () => {
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

test('o seletor de mês lista o mês corrente e os meses com movimento', () => {
  const s = estado({
    demandas: [demanda({ status: 'CONCLUIDA', dataConclusao: '2026-03-10',
      dataRelatorio: '2026-04-02', status: 'VALIDADA' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const meses = kpi.mesesComMovimento(s, plano, '2026-07-06');

  assert.ok(meses.includes('2026-07'), 'o mês corrente sempre aparece');
  assert.ok(meses.includes('2026-03'), 'mês da conclusão');
  assert.ok(meses.includes('2026-04'), 'mês da validação do relatório');
  assert.deepEqual(meses, meses.slice().sort().reverse(), 'do mais recente para o mais antigo');
});
