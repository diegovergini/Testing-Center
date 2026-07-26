'use strict';
const test = require('node:test');
const assert = require('node:assert');
const util = require('../assets/js/00-util.js');
const scheduler = require('../assets/js/20-scheduler.js');

const BASE = '2026-03-02'; // segunda-feira

function equip(over) {
  return Object.assign({
    id: 'EQ-01', nome: 'Bancada', tipo: 'BDT', capacidade: 1,
    horasPorDia: 24, diasUteis: false, manutencao: []
  }, over);
}

function teste(over) {
  return Object.assign({
    id: 'CLI-PROC', clienteId: 'CLI', procedimentoId: 'PROC', nome: 'Ensaio',
    norma: 'N-1', pecas: ['TUB'], fases: ['DV'], equipTipo: 'BDT',
    duracaoHoras: 48, amostrasPorCorrida: 1, amostrasPadrao: 1,
    custoSetup: 1000, custoAmostra: 100, criticidade: 'Média'
  }, over);
}

function demanda(over) {
  return Object.assign({
    id: 'D1', testeId: 'CLI-PROC', projeto: 'P', peca: 'TUB', fase: 'DV',
    amostras: 1, dataPecaDisponivel: BASE, dataAlvo: '', prioridade: 'Média', status: 'Confirmada'
  }, over);
}

function planejar(demandas, equipamentos, catalogo, opcoes) {
  return scheduler.planejar(Object.assign({
    demandas, equipamentos, catalogo, dataBase: BASE, horizonteDias: 400
  }, opcoes));
}

test('data-base escolhida é mesmo uma segunda-feira', () => {
  assert.strictEqual(util.diaDaSemana(BASE), 1);
});

test('aloca a partir da data-base quando a peça já está disponível', () => {
  const r = planejar([demanda()], [equip()], [teste()]);
  assert.strictEqual(r.alocacoes.length, 1);
  assert.strictEqual(r.alocacoes[0].inicio, BASE);
  assert.strictEqual(r.alocacoes[0].diasProdutivos, 2); // 48 h / 24 h por dia
  assert.strictEqual(r.alocacoes[0].fim, '2026-03-03');
});

test('nunca começa antes de a peça estar disponível', () => {
  const disponivel = util.addDias(BASE, 10);
  const r = planejar([demanda({ dataPecaDisponivel: disponivel })], [equip()], [teste()]);
  assert.strictEqual(r.alocacoes[0].inicio, disponivel);
  assert.ok(r.alocacoes[0].inicio >= disponivel);
});

test('respeita a capacidade da unidade: ensaios em série quando capacidade = 1', () => {
  const r = planejar(
    [demanda({ id: 'D1' }), demanda({ id: 'D2' })],
    [equip()],
    [teste()]
  );
  assert.strictEqual(r.alocacoes.length, 2);
  const [a, b] = r.alocacoes;
  assert.ok(b.inicio > a.fim, 'a segunda demanda deve começar depois que a primeira termina');
  assert.strictEqual(b.inicio, util.addDias(a.fim, 1));
});

test('capacidade > 1 permite ensaios simultâneos na mesma unidade', () => {
  const r = planejar(
    [demanda({ id: 'D1' }), demanda({ id: 'D2' })],
    [equip({ capacidade: 2 })],
    [teste()]
  );
  assert.strictEqual(r.alocacoes[0].inicio, r.alocacoes[1].inicio);
});

test('distribui entre unidades do mesmo tipo escolhendo a que termina antes', () => {
  const r = planejar(
    [demanda({ id: 'D1' }), demanda({ id: 'D2' })],
    [equip({ id: 'EQ-01' }), equip({ id: 'EQ-02' })],
    [teste()]
  );
  const unidades = r.alocacoes.map((a) => a.equipamentoId);
  assert.deepStrictEqual(unidades.slice().sort(), ['EQ-01', 'EQ-02']);
  assert.strictEqual(r.alocacoes[0].inicio, r.alocacoes[1].inicio);
});

test('bancada de dias úteis pausa no fim de semana e empurra a data-fim', () => {
  // 40 h a 8 h/dia = 5 dias produtivos, começando na sexta-feira.
  const sexta = util.addDias(BASE, 4);
  const r = planejar(
    [demanda({ dataPecaDisponivel: sexta })],
    [equip({ horasPorDia: 8, diasUteis: true })],
    [teste({ duracaoHoras: 40 })]
  );
  const a = r.alocacoes[0];
  assert.strictEqual(util.diaDaSemana(sexta), 5);
  assert.strictEqual(a.inicio, sexta);
  assert.strictEqual(a.diasProdutivos, 5);
  assert.strictEqual(a.diasCorridos, 7, 'os dois dias de fim de semana entram no prazo corrido');
  assert.strictEqual(util.diaDaSemana(a.fim), 4); // termina na quinta seguinte
});

test('bancada 24/7 não pula fim de semana', () => {
  const r = planejar([demanda()], [equip({ horasPorDia: 24, diasUteis: false })], [teste({ duracaoHoras: 240 })]);
  const a = r.alocacoes[0];
  assert.strictEqual(a.diasProdutivos, 10);
  assert.strictEqual(a.diasCorridos, 10);
});

test('janela de manutenção bloqueia o equipamento', () => {
  const manutencao = [{ inicio: BASE, fim: util.addDias(BASE, 4), motivo: 'Calibração' }];
  const r = planejar([demanda()], [equip({ manutencao })], [teste()]);
  assert.strictEqual(r.alocacoes[0].inicio, util.addDias(BASE, 5));
});

test('prioridade Crítica passa à frente de Média mesmo entrando depois na lista', () => {
  const r = planejar(
    [demanda({ id: 'D-media', prioridade: 'Média' }), demanda({ id: 'D-critica', prioridade: 'Crítica' })],
    [equip()],
    [teste()]
  );
  assert.strictEqual(r.alocacoes[0].demandaId, 'D-critica');
  assert.ok(r.alocacoes[0].inicio < r.alocacoes[1].inicio);
});

test('empate de prioridade é resolvido pela data-alvo mais próxima', () => {
  const r = planejar(
    [
      demanda({ id: 'D-tarde', dataAlvo: util.addDias(BASE, 90) }),
      demanda({ id: 'D-cedo', dataAlvo: util.addDias(BASE, 20) })
    ],
    [equip()],
    [teste()]
  );
  assert.strictEqual(r.alocacoes[0].demandaId, 'D-cedo');
});

test('amostras acima da capacidade do dispositivo geram corridas extras em tempo e custo', () => {
  const r = planejar(
    [demanda({ amostras: 5 })],
    [equip()],
    [teste({ amostrasPorCorrida: 2, duracaoHoras: 24, custoSetup: 1000, custoAmostra: 100 })]
  );
  const a = r.alocacoes[0];
  assert.strictEqual(a.corridas, 3); // ceil(5 / 2)
  assert.strictEqual(a.horas, 72);
  assert.strictEqual(a.custo, 3 * 1000 + 5 * 100);
});

test('marca atraso quando a alocação ultrapassa a data-alvo', () => {
  const r = planejar(
    [demanda({ dataAlvo: BASE })],
    [equip()],
    [teste({ duracaoHoras: 240 })]
  );
  const a = r.alocacoes[0];
  assert.strictEqual(a.noPrazo, false);
  assert.strictEqual(a.atrasoDias, util.diffDias(BASE, a.fim));
  assert.strictEqual(r.resumo.atrasados, 1);
  assert.strictEqual(r.resumo.aderencia, 0);
});

test('demanda sem equipamento compatível fica pendente com motivo', () => {
  const r = planejar([demanda()], [equip({ tipo: 'OUTRO' })], [teste()]);
  assert.strictEqual(r.alocacoes.length, 0);
  assert.strictEqual(r.naoAlocadas.length, 1);
  assert.match(r.naoAlocadas[0].motivo, /BDT/);
});

test('demanda apontando para ensaio inexistente não quebra o plano', () => {
  const r = planejar([demanda({ testeId: 'NAO-EXISTE' })], [equip()], [teste()]);
  assert.strictEqual(r.naoAlocadas.length, 1);
  assert.match(r.naoAlocadas[0].motivo, /catálogo/);
});

test('horizonte curto demais devolve pendência em vez de alocar fora da janela', () => {
  const r = planejar([demanda()], [equip()], [teste({ duracaoHoras: 24 * 30 })], { horizonteDias: 5 });
  assert.strictEqual(r.alocacoes.length, 0);
  assert.strictEqual(r.naoAlocadas.length, 1);
});

test('demandas canceladas ou concluídas ficam fora do plano', () => {
  const r = planejar(
    [demanda({ id: 'D1', status: 'Cancelada' }), demanda({ id: 'D2', status: 'Concluída' })],
    [equip()],
    [teste()]
  );
  assert.strictEqual(r.alocacoes.length, 0);
  assert.strictEqual(r.naoAlocadas.length, 0);
});

test('resumo consolida custo, horas e aderência', () => {
  const r = planejar(
    [demanda({ id: 'D1', dataAlvo: util.addDias(BASE, 60) }), demanda({ id: 'D2', dataAlvo: util.addDias(BASE, 60) })],
    [equip({ capacidade: 2 })],
    [teste({ custoSetup: 1000, custoAmostra: 100, duracaoHoras: 48 })]
  );
  assert.strictEqual(r.resumo.testes, 2);
  assert.strictEqual(r.resumo.custoTotal, 2200);
  assert.strictEqual(r.resumo.horasTotais, 96);
  assert.strictEqual(r.resumo.aderencia, 100);
  assert.strictEqual(r.resumo.primeiroInicio, BASE);
});

test('o plano é determinístico: mesma entrada, mesma saída', () => {
  const entrada = () => ({
    demandas: [
      demanda({ id: 'A', prioridade: 'Alta' }),
      demanda({ id: 'B', prioridade: 'Média' }),
      demanda({ id: 'C', prioridade: 'Crítica' })
    ],
    equipamentos: [equip({ id: 'EQ-01' }), equip({ id: 'EQ-02', capacidade: 2 })],
    catalogo: [teste()]
  });
  const a = planejar(entrada().demandas, entrada().equipamentos, entrada().catalogo);
  const b = planejar(entrada().demandas, entrada().equipamentos, entrada().catalogo);
  assert.deepStrictEqual(
    a.alocacoes.map((x) => [x.demandaId, x.equipamentoId, x.inicio, x.fim]),
    b.alocacoes.map((x) => [x.demandaId, x.equipamentoId, x.inicio, x.fim])
  );
});
