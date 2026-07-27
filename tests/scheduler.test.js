/* Testes do motor de planejamento: node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');

const util = require('../src/util.js');
require('../src/data.js');
const scheduler = require('../src/scheduler.js');

/* 2026-07-06 é uma segunda-feira — facilita conferir os saltos de fim de semana. */
const SEGUNDA = '2026-07-06';

function equipamento(extra) {
  return Object.assign({
    id: 'EQ-01', nome: 'Bancada', posicoes: 1, continuo: false, horasDia: 8,
    diasUteis: [1, 2, 3, 4, 5], custoHora: 100, manutencao: []
  }, extra);
}

function teste(extra) {
  return Object.assign({
    id: 'TP-01', nome: 'Ensaio', area: 'COLD', equipamentoId: 'EQ-01', revisao: 'Rev. 01',
    clientes: [], horasSetup: 0, horasEnsaio: 8, amostras: 1, custoBase: 1000
  }, extra);
}

function peca(extra) {
  return Object.assign({
    id: 'PC-01', nome: 'Peça', custoAmostra: 500
  }, extra);
}

function demanda(extra) {
  return Object.assign({
    id: 'DM-01', testeId: 'TP-01', pecaId: 'PC-01', clienteId: 'CLI-01',
    lti: 'LTI-0001', tipoLti: 'DV', dataAmostras: SEGUNDA,
    prioridade: 'MEDIA', quantidade: 1, prazo: '', inicioFixo: '', status: 'PENDENTE',
    criadoEm: SEGUNDA
  }, extra);
}

function estado(extra) {
  return Object.assign({
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

test('duração converte horas em dias conforme o regime do equipamento', () => {
  assert.equal(scheduler.diasDeOperacao(teste({ horasEnsaio: 8 }), equipamento()), 1);
  assert.equal(scheduler.diasDeOperacao(teste({ horasEnsaio: 24 }), equipamento()), 3);
  assert.equal(scheduler.diasDeOperacao(teste({ horasSetup: 4, horasEnsaio: 20 }), equipamento()), 3);
  assert.equal(scheduler.diasDeOperacao(teste({ horasEnsaio: 72 }), equipamento({ continuo: true })), 3);
  assert.equal(scheduler.diasDeOperacao(teste({ horasEnsaio: 1 }), equipamento()), 1, 'nunca menos de um dia');
});

test('nenhum ensaio começa antes da chegada das amostras', () => {
  const s = estado({ demandas: [demanda({ dataAmostras: '2026-08-10' })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  const a = alocacaoDe(plano, 'DM-01');
  assert.equal(a.inicio, '2026-08-10');
  assert.equal(a.esperaAmostra, util.diffDias(SEGUNDA, '2026-08-10'));
});

test('amostra já disponível no passado não puxa o ensaio para trás', () => {
  const s = estado({ demandas: [demanda({ dataAmostras: '2026-01-05' })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(alocacaoDe(plano, 'DM-01').inicio, SEGUNDA);
});

test('a janela atravessa o fim de semana quando o equipamento só opera em dias úteis', () => {
  /* 3 dias de operação começando numa quinta -> qui, sex, seg. */
  const s = estado({
    testes: [teste({ horasEnsaio: 24 })],
    demandas: [demanda({ dataAmostras: '2026-07-09' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const a = alocacaoDe(plano, 'DM-01');
  assert.equal(a.inicio, '2026-07-09');
  assert.equal(a.fim, '2026-07-13');
});

test('equipamento contínuo ocupa dias corridos, inclusive fim de semana', () => {
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

test('posições em paralelo são usadas antes de empurrar a fila', () => {
  const s = estado({
    equipamentos: [equipamento({ posicoes: 2, continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] })],
    testes: [teste({ horasEnsaio: 48 })],
    demandas: [demanda({ id: 'A' }), demanda({ id: 'B' }), demanda({ id: 'C' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const a = alocacaoDe(plano, 'A'), b = alocacaoDe(plano, 'B'), c = alocacaoDe(plano, 'C');
  assert.equal(a.inicio, SEGUNDA);
  assert.equal(b.inicio, SEGUNDA);
  assert.notEqual(a.posicao, b.posicao);
  assert.equal(c.inicio, '2026-07-08', 'a terceira só entra quando a primeira posição vaga');
});

test('duas demandas nunca dividem a mesma posição no mesmo dia', () => {
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

test('manutenção bloqueia a janela e empurra o ensaio para depois da parada', () => {
  const s = estado({
    equipamentos: [equipamento({
      continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6],
      manutencao: [{ id: 'MN-1', inicio: '2026-07-07', fim: '2026-07-10', motivo: 'Calibração' }]
    })],
    testes: [teste({ horasEnsaio: 48 })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const a = alocacaoDe(plano, 'DM-01');
  assert.equal(a.inicio, '2026-07-11', 'não cabe antes da parada nem a atravessa');
});

test('prioridade alta pega a janela antes da baixa, mesmo criada depois', () => {
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

test('entre a mesma prioridade, ganha o prazo mais curto', () => {
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

test('folga e atraso são calculados contra o prazo do cliente', () => {
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

test('início forçado é respeitado mesmo com o equipamento livre antes', () => {
  const s = estado({ demandas: [demanda({ inicioFixo: '2026-07-15' })] });
  const a = alocacaoDe(scheduler.planejar(s, SEGUNDA), 'DM-01');
  assert.equal(a.inicio, '2026-07-15');
});

test('demanda fixada reserva a posição antes das demais', () => {
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

test('demandas concluídas e canceladas não ocupam bancada', () => {
  const s = estado({
    equipamentos: [equipamento({ continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] })],
    testes: [teste({ horasEnsaio: 72 })],
    demandas: [
      demanda({ id: 'FEITA', status: 'CONCLUIDO' }),
      demanda({ id: 'CANCELADA', status: 'CANCELADO' }),
      demanda({ id: 'ATIVA' })
    ]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(plano.agendadas.length, 1);
  assert.equal(alocacaoDe(plano, 'ATIVA').inicio, SEGUNDA);
  assert.equal(alocacaoDe(plano, 'FEITA'), undefined);
});

test('demanda sem equipamento cadastrado sai como bloqueada, não some', () => {
  const s = estado({ testes: [teste({ equipamentoId: 'INEXISTENTE' })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(plano.bloqueadas.length, 1);
  assert.match(plano.bloqueadas[0].motivo, /não cadastrado/);
});

test('custo soma mão de obra, hora-máquina e amostras', () => {
  const t = teste({ horasSetup: 2, horasEnsaio: 8, custoBase: 1000 });
  const c = scheduler.custoDemanda({ quantidade: 3 }, t, equipamento({ custoHora: 100 }), peca({ custoAmostra: 500 }));
  assert.equal(c.horas, 10);
  assert.equal(c.custoEquipamento, 1000);
  assert.equal(c.custoAmostras, 1500);
  assert.equal(c.total, 3500);
});

test('custo de catálogo usa a quantidade padrão do procedimento e ignora amostras', () => {
  const c = scheduler.custoCatalogo(teste({ amostras: 4, horasEnsaio: 8, custoBase: 500 }), equipamento({ custoHora: 200 }));
  assert.equal(c.quantidade, 4);
  assert.equal(c.custoAmostras, 0);
  assert.equal(c.total, 500 + 1600);
});

test('o catálogo de exemplo é planejável de ponta a ponta', () => {
  const base = require('../src/data.js').seed();
  /* Qualquer peça serve para qualquer procedimento: não há mais amarração por área. */
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
    assert.ok(util.diffDias(a.demanda.dataAmostras, a.inicio) >= 0, a.teste.id + ' começa antes da amostra');
    assert.ok(util.diffDias(a.inicio, a.fim) >= 0);
  });
});

test('as fases são apenas DV, PV e VAVE, e PV é Process Validation', () => {
  const dados = require('../src/data.js');
  assert.deepEqual(dados.FASES.map((f) => f.id), ['DV', 'PV', 'VAVE']);
  assert.match(util.porId(dados.FASES, 'PV').nome, /Process Validation/);
});

test('o catálogo não amarra procedimento a fase e sempre traz a revisão', () => {
  const dados = require('../src/data.js');
  dados.seed().testes.forEach((t) => {
    assert.equal(t.fases, undefined, t.id + ' ainda tem fase amarrada');
    assert.ok(t.revisao && t.revisao.trim(), t.id + ' está sem revisão');
  });
});

test('todo procedimento do catálogo aponta para um equipamento existente', () => {
  const base = require('../src/data.js').seed();
  const ids = base.equipamentos.map((eq) => eq.id);
  assert.deepEqual(base.equipamentos.map((eq) => eq.nome), [
    'Burner 1', 'Burner 2', 'Burner 3', 'Shaker', 'MTS 1', 'MTS 2', 'MTS 3', 'MTS 4',
    'LMS / PTA', 'ColdFlow', 'Dynamometer'
  ]);
  base.testes.forEach((t) => {
    assert.ok(ids.includes(t.equipamentoId), t.id + ' aponta para ' + t.equipamentoId);
  });
});

test('as peças são tipos genéricos, sem cliente nem área', () => {
  const base = require('../src/data.js').seed();
  assert.deepEqual(base.pecas.map((p) => p.nome),
    ['Hot End', 'Canning', 'Cold End', 'Muffler', 'Component']);
  base.pecas.forEach((p) => {
    assert.equal(p.clienteId, undefined, p.nome + ' ainda está preso a um cliente');
    assert.equal(p.area, undefined, p.nome + ' ainda está preso a uma área');
    assert.equal(p.dataAmostras, undefined, p.nome + ' ainda guarda data de amostras');
  });
});

test('demanda de cotação não reserva bancada, mas entra no custo', () => {
  const s = estado({ demandas: [demanda({ id: 'COT', tipoLti: 'COTACAO', lti: '' })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  const a = alocacaoDe(plano, 'COT');

  assert.equal(a.cotacao, true);
  assert.equal(a.inicio, null, 'cotação não recebe janela');
  assert.ok(a.custo.total > 0, 'o custo ainda é calculado para orçamento');
  assert.equal(plano.agendadas.length, 0);
  assert.equal(plano.bloqueadas.length, 0, 'cotação não conta como bloqueada');
  assert.equal(plano.cotacoes.length, 1);
});

test('cotação não disputa nem ocupa a posição de demandas planejáveis', () => {
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

test('ehCotacao reconhece a classificação COTACAO e só ela', () => {
  assert.equal(scheduler.ehCotacao({ tipoLti: 'COTACAO' }), true);
  assert.equal(scheduler.ehCotacao({ tipoLti: 'DV' }), false);
  assert.equal(scheduler.ehCotacao({ tipoLti: 'PV' }), false);
  assert.equal(scheduler.ehCotacao({ tipoLti: 'VAVE' }), false);
  assert.equal(scheduler.ehCotacao({ tipoLti: 'ALGO_INEXISTENTE' }), false);
});
