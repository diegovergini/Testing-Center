/* Testes do motor de planejamento: node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');

const util = require('../src/util.js');
require('../src/data.js');
const scheduler = require('../src/scheduler.js');

/* 2026-07-06 é uma segunda-feira — facilita conferir os saltos de fim de semana. */
const SEGUNDA = '2026-07-06';

function equipamento(extra) {
  const base = {
    id: 'EQ-01', nome: 'Bancada', posicoes: 1, continuo: false, horasDia: 8,
    diasUteis: [1, 2, 3, 4, 5], custoHora: 100, manutencao: []
  };
  const eq = Object.assign(base, extra);
  /* sem grupo explícito, cada unidade é o próprio grupo, nomeado pelo id */
  if (!eq.grupo) eq.grupo = eq.id;
  return eq;
}

function teste(extra) {
  return Object.assign({
    id: 'TP-01', nome: 'Ensaio', area: 'COLD', equipamentoGrupos: ['EQ-01'], revisao: 'Rev. 01',
    clientes: [], horasSetup: 0, horasEnsaio: 8, horasReport: 0, amostras: 1,
    hourlyRate: 100, custoInsumos: 1000
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
  assert.equal(scheduler.diasDeOperacao(teste({ horasEnsaio: 8 }), [equipamento()]), 1);
  assert.equal(scheduler.diasDeOperacao(teste({ horasEnsaio: 24 }), [equipamento()]), 3);
  assert.equal(scheduler.diasDeOperacao(teste({ horasSetup: 4, horasEnsaio: 20 }), [equipamento()]), 3);
  assert.equal(scheduler.diasDeOperacao(teste({ horasEnsaio: 72 }), [equipamento({ continuo: true })]), 3);
  assert.equal(scheduler.diasDeOperacao(teste({ horasEnsaio: 1 }), [equipamento()]), 1, 'nunca menos de um dia');
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
  assert.notEqual(a.posicoes['EQ-01'], b.posicoes['EQ-01'], 'cada uma numa posição diferente');
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
  const s = estado({ testes: [teste({ equipamentoGrupos: ['GRUPO-INEXISTENTE'] })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(plano.bloqueadas.length, 1);
  assert.match(plano.bloqueadas[0].motivo, /sem unidade cadastrada/);
});

test('custo do procedimento é (setup + ensaio + report) x rate + insumos', () => {
  const t = teste({ horasSetup: 2, horasEnsaio: 8, horasReport: 5, hourlyRate: 200, custoInsumos: 1000 });
  const c = scheduler.custoDemanda({ quantidade: 3 }, t, null, peca({ custoAmostra: 500 }));

  assert.equal(c.horasBancada, 10, 'setup + ensaio');
  assert.equal(c.horasFaturaveis, 15, 'setup + ensaio + report');
  assert.equal(c.custoHoras, 15 * 200);
  assert.equal(c.custoInsumos, 1000);
  assert.equal(c.custoProcedimento, 3000 + 1000);
  assert.equal(c.custoAmostras, 1500);
  assert.equal(c.total, 4000 + 1500);
});

test('a hora do equipamento não entra mais no custo', () => {
  const t = teste({ horasSetup: 0, horasEnsaio: 10, horasReport: 0, hourlyRate: 100, custoInsumos: 0 });
  const semBancada = scheduler.custoDemanda({ quantidade: 1 }, t, null, null);
  const comDuas = scheduler.custoDemanda({ quantidade: 1 }, t,
    [equipamento({ custoHora: 900 }), equipamento({ custoHora: 900 })], null);
  assert.equal(semBancada.total, comDuas.total, 'o custo sai do hourly rate, não da bancada');
  assert.equal(comDuas.total, 1000);
});

test('horas de report entram no custo, mas não ocupam bancada', () => {
  const t = teste({ horasSetup: 0, horasEnsaio: 8, horasReport: 40, hourlyRate: 100, custoInsumos: 0 });
  const eq = equipamento({ horasDia: 8 });
  assert.equal(scheduler.diasDeOperacao(t, [eq]), 1, 'só as 8 h de ensaio prendem a bancada');
  assert.equal(scheduler.custoDemanda(null, t, [eq], null).custoHoras, 48 * 100);
});

test('custo de catálogo usa a quantidade padrão do procedimento e ignora amostras', () => {
  const c = scheduler.custoCatalogo(teste({ amostras: 4, horasEnsaio: 8, horasReport: 2, hourlyRate: 200, custoInsumos: 500 }));
  assert.equal(c.quantidade, 4);
  assert.equal(c.custoAmostras, 0);
  assert.equal(c.total, 500 + 10 * 200);
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
  const grupos = scheduler.agruparEquipamentos(base.equipamentos).map((g) => g.id);

  assert.deepEqual(base.equipamentos.map((eq) => eq.nome), [
    'Burner 1', 'Burner 2', 'Burner 3', 'Shaker', 'MTS 1', 'MTS 2', 'MTS 3', 'MTS 4',
    'LMS / PTA', 'ColdFlow', 'Dynamometer'
  ]);
  base.testes.forEach((t) => {
    const usados = scheduler.gruposDoTeste(t);
    assert.ok(usados.length, t.id + ' está sem equipamento');
    usados.forEach((id) => assert.ok(grupos.includes(id), t.id + ' aponta para grupo ' + id));
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

test('ensaio em duas bancadas reserva posição nas duas ao mesmo tempo', () => {
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

test('bancada compartilhada empurra o outro ensaio, mesmo com a dela livre', () => {
  /* DUPLO usa EQ-01 + EQ-02; SIMPLES usa só EQ-02, que fica preso pelo primeiro. */
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
    'o ensaio simples não pode entrar enquanto a bancada estiver presa pelo duplo');
});

test('o ritmo é ditado pela bancada de turno mais curto', () => {
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
  /* Só conta dia útil da interseção: seg-sex. 6 dias úteis a partir de 06/07 -> 13/07. */
  assert.equal(a.inicio, SEGUNDA);
  assert.equal(a.fim, '2026-07-13');
});

test('manutenção em qualquer uma das bancadas bloqueia a janela', () => {
  const s = estado({
    equipamentos: [
      equipamento({ id: 'EQ-01', continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6] }),
      equipamento({
        id: 'EQ-02', continuo: true, diasUteis: [0, 1, 2, 3, 4, 5, 6],
        manutencao: [{ id: 'MN-1', inicio: '2026-07-07', fim: '2026-07-10', motivo: 'Calibração' }]
      })
    ],
    testes: [teste({ equipamentoGrupos: ['EQ-01', 'EQ-02'], horasEnsaio: 48 })]
  });
  const a = alocacaoDe(scheduler.planejar(s, SEGUNDA), 'DM-01');
  assert.equal(a.inicio, '2026-07-11', 'a parada da segunda bancada empurra o ensaio');
});

test('procedimento sem nenhum equipamento fica bloqueado com motivo claro', () => {
  const s = estado({ testes: [teste({ equipamentoGrupos: [] })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(plano.bloqueadas.length, 1);
  assert.match(plano.bloqueadas[0].motivo, /sem equipamento/i);
});

test('todo procedimento do catálogo tem hourly rate e horas de report definidos', () => {
  const base = require('../src/data.js').seed();
  base.testes.forEach((t) => {
    assert.equal(typeof t.hourlyRate, 'number', t.id + ' sem hourly rate');
    assert.ok(t.hourlyRate > 0, t.id + ' com hourly rate zerado');
    assert.equal(typeof t.horasReport, 'number', t.id + ' sem horas de report');
    assert.equal(typeof t.custoInsumos, 'number', t.id + ' sem custo de insumos');
    assert.equal(t.custoBase, undefined, t.id + ' ainda usa custoBase');
  });
});

test('o custo do catálogo bate com a fórmula, procedimento a procedimento', () => {
  const base = require('../src/data.js').seed();
  base.testes.forEach((t) => {
    const c = scheduler.custoCatalogo(t);
    const esperado = (t.horasSetup + t.horasEnsaio + t.horasReport) * t.hourlyRate + t.custoInsumos;
    assert.equal(c.custoProcedimento, esperado, t.id);
  });
});

/* ---- Grupos de bancada intercambiáveis ---- */

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

test('agrupar reúne unidades pelo grupo e mantém a ordem do cadastro', () => {
  const grupos = scheduler.agruparEquipamentos(pool(3).concat([
    equipamento({ id: 'SHK', nome: 'Shaker', grupo: 'Shaker' })
  ]));
  assert.deepEqual(grupos.map((g) => g.id), ['Burner', 'Shaker']);
  assert.equal(grupos[0].membros.length, 3);
  assert.equal(grupos[1].membros.length, 1);
});

test('unidade sem grupo definido forma um grupo só dela', () => {
  const grupos = scheduler.agruparEquipamentos([{ id: 'X1', nome: 'Bancada X' }]);
  assert.deepEqual(grupos.map((g) => g.id), ['Bancada X']);
});

test('três demandas no mesmo grupo ocupam as três unidades em paralelo', () => {
  const s = estado({
    equipamentos: pool(3),
    testes: [teste({ equipamentoGrupos: ['Burner'], horasEnsaio: 72 })],
    demandas: [demanda({ id: 'A' }), demanda({ id: 'B' }), demanda({ id: 'C' })]
  });
  const plano = scheduler.planejar(s, SEGUNDA);
  const usadas = ['A', 'B', 'C'].map((id) => alocacaoDe(plano, id));

  usadas.forEach((a) => assert.equal(a.inicio, SEGUNDA, 'todas começam no mesmo dia'));
  const unidades = usadas.map((a) => a.equipamentos[0].id).sort();
  assert.deepEqual(unidades, ['BRN-1', 'BRN-2', 'BRN-3'], 'uma unidade distinta para cada');
});

test('a quarta demanda cai na unidade que libera mais cedo', () => {
  /* A e B pegam 3 dias; C pega 9. A quarta deve ir para BRN-1 ou BRN-2, não para a longa. */
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
    'não espera a unidade presa pelo ensaio longo');
});

test('manutenção numa unidade joga a demanda para a irmã livre', () => {
  const unidades = pool(2);
  unidades[0].manutencao = [{ id: 'MN-1', inicio: SEGUNDA, fim: '2026-07-20', motivo: 'Calibração' }];
  const s = estado({
    equipamentos: unidades,
    testes: [teste({ equipamentoGrupos: ['Burner'], horasEnsaio: 48 })]
  });
  const a = alocacaoDe(scheduler.planejar(s, SEGUNDA), 'DM-01');
  assert.equal(a.equipamentos[0].id, 'BRN-2', 'usa a que não está parada');
  assert.equal(a.inicio, SEGUNDA, 'sem esperar o fim da manutenção da outra');
});

test('entre unidades livres no mesmo dia, ganha a que termina antes', () => {
  /* BRN-1 roda 24 h/dia e BRN-2 só 8 h: o mesmo ensaio acaba antes na primeira. */
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

test('dois grupos juntos escolhem a melhor combinação de unidades', () => {
  const unidades = pool(2).concat([
    equipamento({ id: 'MTS-1', nome: 'MTS 1', grupo: 'MTS', continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6] }),
    equipamento({ id: 'MTS-2', nome: 'MTS 2', grupo: 'MTS', continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6] })
  ]);
  /* BRN-1 e MTS-1 já estão presos por um ensaio longo de prioridade alta. */
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
  assert.equal(duplo.inicio, SEGUNDA, 'há um par livre, então não precisa esperar');
  assert.deepEqual(duplo.equipamentos.map((eq) => eq.id).sort(), ['BRN-2', 'MTS-2']);
});

test('grupo sem unidade cadastrada vira bloqueio com motivo claro', () => {
  const s = estado({ testes: [teste({ equipamentoGrupos: ['Camara'] })] });
  const plano = scheduler.planejar(s, SEGUNDA);
  assert.equal(plano.bloqueadas.length, 1);
  assert.match(plano.bloqueadas[0].motivo, /Camara/);
  assert.match(plano.bloqueadas[0].motivo, /sem unidade cadastrada/);
});

test('o catálogo de exemplo tem Burner e MTS como grupos com várias unidades', () => {
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

test('Tenneco e Eberspächer saíram do cadastro e das exigências do catálogo', () => {
  const base = require('../src/data.js').seed();
  const ids = base.clientes.map((c) => c.id);
  assert.deepEqual(ids, ['CLI-FOR', 'CLI-VW', 'CLI-STL', 'CLI-SCA']);

  base.testes.forEach((t) => {
    (t.clientes || []).forEach((id) => {
      assert.ok(ids.includes(id), t.id + ' exige cliente inexistente ' + id);
    });
  });
});
