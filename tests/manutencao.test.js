/* Testes da gestão de manutenção: última realizada, próxima prevista, vencidas e o
   efeito sobre a agenda do equipamento. */
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
    motivo: 'Calibração', situacao: 'PLANEJADA', oQueFoiFeito: '', responsavel: ''
  }, extra);
}

/* ---- Última realizada ---- */

test('a última manutenção é a realizada que terminou mais tarde', () => {
  const eq = equipamento([
    parada({ id: 'A', inicio: '2026-05-04', fim: '2026-05-06', situacao: 'REALIZADA',
      oQueFoiFeito: 'troca de termopares' }),
    parada({ id: 'B', inicio: '2026-07-06', fim: '2026-07-08', situacao: 'REALIZADA',
      oQueFoiFeito: 'calibração da célula de carga' }),
    parada({ id: 'C', inicio: '2026-06-01', fim: '2026-06-02', situacao: 'REALIZADA',
      oQueFoiFeito: 'ajuste do controlador' })
  ]);
  const s = manutencao.situacao(eq, HOJE);

  assert.equal(s.ultima.id, 'B');
  assert.equal(s.ultima.oQueFoiFeito, 'calibração da célula de carga');
  assert.equal(s.diasDesdeUltima, util.diffDias('2026-07-08', HOJE));
});

test('parada apenas planejada não conta como última realizada', () => {
  const eq = equipamento([parada({ inicio: '2026-06-01', fim: '2026-06-03' })]);
  const s = manutencao.situacao(eq, HOJE);

  assert.equal(s.ultima, null, 'planejada e vencida não é manutenção feita');
  assert.equal(s.diasDesdeUltima, null);
});

/* ---- Próxima prevista ---- */

test('a próxima prevista é a planejada que começa mais cedo daqui para a frente', () => {
  const eq = equipamento([
    parada({ id: 'A', inicio: '2026-11-03', fim: '2026-11-05' }),
    parada({ id: 'B', inicio: '2026-09-14', fim: '2026-09-16' }),
    parada({ id: 'C', inicio: '2026-12-01', fim: '2026-12-02' })
  ]);
  const s = manutencao.situacao(eq, HOJE);

  assert.equal(s.proxima.id, 'B');
  assert.equal(s.diasParaProxima, util.diffDias(HOJE, '2026-09-14'));
});

test('parada em curso hoje conta como próxima e é sinalizada', () => {
  const eq = equipamento([parada({ inicio: '2026-08-09', fim: '2026-08-12' })]);
  const s = manutencao.situacao(eq, HOJE);

  assert.equal(s.proxima.id, 'MN-1', 'ainda não terminou, então ainda é a próxima');
  assert.equal(s.emManutencaoHoje, true);
});

test('sem parada futura agendada a próxima é nula', () => {
  const eq = equipamento([
    parada({ inicio: '2026-05-04', fim: '2026-05-06', situacao: 'REALIZADA', oQueFoiFeito: 'x' })
  ]);
  assert.equal(manutencao.situacao(eq, HOJE).proxima, null);
});

/* ---- Vencidas ---- */

test('planejada com data vencida vira pendência, não próxima', () => {
  const eq = equipamento([
    parada({ id: 'VENCIDA', inicio: '2026-07-06', fim: '2026-07-08' }),
    parada({ id: 'FUTURA', inicio: '2026-09-14', fim: '2026-09-16' })
  ]);
  const s = manutencao.situacao(eq, HOJE);

  assert.equal(s.proxima.id, 'FUTURA');
  assert.deepEqual(s.atrasadas.map((m) => m.id), ['VENCIDA']);
});

test('as pendências apontam o que exige decisão do gestor', () => {
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
    ['EQ-01', 'EQ-02'], 'quem só tem parada vencida também está sem próxima agendada');
  assert.equal(lista.filter((p) => p.equipamento.id === 'EQ-03').length, 0);
});

/* ---- Efeito na agenda ---- */

test('parada planejada bloqueia a bancada, realizada no passado não atrapalha', () => {
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

test('a parada nasce planejada e o registro a fecha com o que foi feito', () => {
  store.restaurarPadrao();
  const criada = store.adicionarManutencao('SHAKER', {
    inicio: '2026-09-01', fim: '2026-09-03', tipo: 'CALIBRACAO', motivo: 'Calibração anual'
  });

  assert.equal(criada.situacao, 'PLANEJADA');
  assert.equal(criada.oQueFoiFeito, '');

  store.registrarManutencao('SHAKER', criada.id, {
    inicio: '2026-09-01', fim: '2026-09-05',
    oQueFoiFeito: 'calibração da célula e troca do amplificador',
    responsavel: 'Metrologia'
  });

  const eq = globalThis.TC.util.porId(store.get().equipamentos, 'SHAKER');
  const parada = globalThis.TC.util.porId(eq.manutencao, criada.id);
  assert.equal(parada.situacao, 'REALIZADA');
  assert.equal(parada.fim, '2026-09-05', 'a execução pode estender o período previsto');
  assert.equal(parada.oQueFoiFeito, 'calibração da célula e troca do amplificador');
  assert.equal(parada.responsavel, 'Metrologia');
  assert.equal(manutencao.situacao(eq, '2026-09-10').ultima.id, criada.id);
});

test('paradas gravadas antes deste cadastro entram com a situação certa', () => {
  const base = dados.seed();
  base.equipamentos = base.equipamentos.map((eq) => eq.id === 'SHAKER'
    ? Object.assign({}, eq, {
      manutencao: [
        { id: 'ANTIGA', inicio: '2020-01-06', fim: '2020-01-08', motivo: 'Calibração' },
        { id: 'FUTURA', inicio: '2099-01-06', fim: '2099-01-08', motivo: 'Revisão' }
      ]
    })
    : eq);

  store.importar(JSON.stringify(base));
  const eq = globalThis.TC.util.porId(store.get().equipamentos, 'SHAKER');

  assert.equal(globalThis.TC.util.porId(eq.manutencao, 'ANTIGA').situacao, 'REALIZADA',
    'já aconteceu');
  assert.equal(globalThis.TC.util.porId(eq.manutencao, 'FUTURA').situacao, 'PLANEJADA');
  eq.manutencao.forEach((m) => {
    assert.equal(typeof m.tipo, 'string');
    assert.equal(typeof m.oQueFoiFeito, 'string');
  });
});

test('a manutenção agendada tira horas da capacidade do mês', () => {
  store.restaurarPadrao();
  const antes = kpi.capacidadeNoMes(
    globalThis.TC.util.porId(store.get().equipamentos, 'SHAKER'), '2026-09');

  store.adicionarManutencao('SHAKER', {
    inicio: '2026-09-07', fim: '2026-09-11', tipo: 'PREVENTIVA', motivo: 'Revisão'
  });
  const depois = kpi.capacidadeNoMes(
    globalThis.TC.util.porId(store.get().equipamentos, 'SHAKER'), '2026-09');

  assert.equal(antes.horas - depois.horas, 5 * 16, 'cinco dias úteis de 16 h saem do mês');
  assert.equal(depois.diasParados, 5);
});
