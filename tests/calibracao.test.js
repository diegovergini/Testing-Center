/* Testes da gestão de calibração: validade, vencimento, criticidade e o registro do
   certificado. */
const test = require('node:test');
const assert = require('node:assert');

const util = require('../src/util.js');
const dados = require('../src/data.js');
const calibracao = require('../src/calibracao.js');
require('../src/store.js');

const store = globalThis.TC.store;
const HOJE = '2026-08-10';

function instrumento(extra) {
  return Object.assign({
    id: 'TCL-XX-001', codigoAntigo: '', nome: 'Instrumento', setor: 'Tech Center',
    local: 'Instrumentation', backup: false, marca: 'ACME', modelo: 'M1', serie: '123',
    faixa: '0 - 10', resolucao: '0,1', situacao: 'EM_USO', ativo: true,
    periodicidadeMeses: 12, ultimaCalibracao: '', proximaCalibracao: '',
    certificado: '', laboratorio: '', observacao: '', historico: []
  }, extra);
}

/* ---- Soma de meses ---- */

test('a validade é somada em meses, respeitando mês curto e virada de ano', () => {
  assert.equal(calibracao.somaMeses('2026-03-10', 12), '2027-03-10');
  assert.equal(calibracao.somaMeses('2026-01-31', 1), '2026-02-28', 'fevereiro não tem dia 31');
  assert.equal(calibracao.somaMeses('2028-01-31', 1), '2028-02-29', 'ano bissexto');
  assert.equal(calibracao.somaMeses('2026-11-15', 6), '2027-05-15', 'atravessa o ano');
  assert.equal(calibracao.somaMeses('', 12), '', 'sem data não há validade');
});

/* ---- Vencimento ---- */

test('sem última calibração o instrumento fica sem plano, não vencido', () => {
  const e = calibracao.estado(instrumento(), HOJE);
  assert.equal(e.prazo, 'SEM_PLANO');
  assert.equal(e.vencimento, '');
  assert.equal(e.criticidade, '', 'lacuna de cadastro não é o mesmo que instrumento vencido');
});

test('a validade sai da última calibração mais a periodicidade', () => {
  const e = calibracao.estado(
    instrumento({ ultimaCalibracao: '2026-03-10', periodicidadeMeses: 12 }), HOJE);
  assert.equal(e.vencimento, '2027-03-10');
  assert.equal(e.prazo, 'EM_DIA');
});

test('a data do certificado tem precedência sobre a calculada', () => {
  const e = calibracao.estado(instrumento({
    ultimaCalibracao: '2026-03-10', periodicidadeMeses: 12, proximaCalibracao: '2026-09-30'
  }), HOJE);
  assert.equal(e.vencimento, '2026-09-30', 'o certificado pode trazer validade própria');
});

test('vence dentro de 30 dias entra em "a vencer"', () => {
  const emDia = calibracao.estado(instrumento({ proximaCalibracao: '2026-10-01' }), HOJE);
  const aVencer = calibracao.estado(instrumento({ proximaCalibracao: '2026-09-05' }), HOJE);
  const vencido = calibracao.estado(instrumento({ proximaCalibracao: '2026-08-09' }), HOJE);

  assert.equal(emDia.prazo, 'EM_DIA');
  assert.equal(aVencer.prazo, 'A_VENCER');
  assert.equal(vencido.prazo, 'VENCIDO');
  assert.equal(vencido.diasParaVencer, -1);
});

test('o dia do vencimento ainda conta como dentro da validade', () => {
  const e = calibracao.estado(instrumento({ proximaCalibracao: HOJE }), HOJE);
  assert.equal(e.prazo, 'A_VENCER');
  assert.equal(e.diasParaVencer, 0);
});

/* ---- Criticidade ---- */

test('vencido e em uso é crítico; vencido fora de uso ou back-up é só atenção', () => {
  const emUso = calibracao.estado(
    instrumento({ proximaCalibracao: '2026-01-01', situacao: 'EM_USO' }), HOJE);
  const foraDeUso = calibracao.estado(
    instrumento({ proximaCalibracao: '2026-01-01', situacao: 'FORA_DE_USO' }), HOJE);
  const desativado = calibracao.estado(
    instrumento({ proximaCalibracao: '2026-01-01', situacao: 'EM_USO', ativo: false }), HOJE);

  assert.equal(emUso.criticidade, 'CRITICO', 'ensaio medindo fora da validade');
  assert.equal(foraDeUso.criticidade, 'ATENCAO');
  assert.equal(desativado.criticidade, 'ATENCAO');
});

/* ---- Resumo e agenda ---- */

test('o resumo separa vencido, a vencer, em dia e sem plano', () => {
  const lista = [
    instrumento({ id: 'A', proximaCalibracao: '2026-01-01' }),
    instrumento({ id: 'B', proximaCalibracao: '2026-08-20' }),
    instrumento({ id: 'C', proximaCalibracao: '2027-01-01' }),
    instrumento({ id: 'D' }),
    instrumento({ id: 'E', proximaCalibracao: '2026-01-01', situacao: 'FORA_DE_USO' })
  ];
  const r = calibracao.resumo(lista, HOJE);

  assert.equal(r.total, 5);
  assert.equal(r.vencidos, 2);
  assert.equal(r.criticos, 1, 'só o vencido que segue em uso');
  assert.equal(r.aVencer, 1);
  assert.equal(r.emDia, 1);
  assert.equal(r.semPlano, 1);
  assert.equal(r.cobertura, 2 / 4, 'a cobertura só olha quem tem plano');
});

test('a agenda traz o que já venceu e o que vence no horizonte, do mais urgente', () => {
  const lista = [
    instrumento({ id: 'DEPOIS', proximaCalibracao: '2027-06-01' }),
    instrumento({ id: 'PERTO', proximaCalibracao: '2026-09-01' }),
    instrumento({ id: 'VENCIDO', proximaCalibracao: '2026-05-01' }),
    instrumento({ id: 'SEM_PLANO' })
  ];
  const agenda = calibracao.agenda(lista, HOJE, 90);

  assert.deepEqual(agenda.map((x) => x.instrumento.id), ['VENCIDO', 'PERTO']);
});

/* ---- Inventário de partida ---- */

test('o inventário de partida traz os instrumentos da planilha, sem código repetido', () => {
  const base = dados.seed();
  assert.equal(base.instrumentos.length, 229);
  assert.equal(new Set(base.instrumentos.map((i) => i.id)).size, base.instrumentos.length);

  const acelerometro = util.porId(base.instrumentos, 'TCL-AC-012');
  assert.equal(acelerometro.nome, 'Uniaxial Accelerometer B&K');
  assert.equal(acelerometro.marca, 'B&K');
  assert.equal(acelerometro.modelo, '4384');
  assert.equal(acelerometro.serie, '31642');
  assert.equal(acelerometro.local, 'Instrumentation');
  assert.equal(acelerometro.situacao, 'EM_USO');

  const celula = util.porId(base.instrumentos, 'TCL-CC-003');
  assert.equal(celula.situacao, 'EM_CALIBRACAO', 'a coluna Observações vira situação');
  assert.equal(celula.backup, true, 'a coluna de back-up vira booleano');
  assert.equal(celula.local, 'Hydro pulse 1');
});

test('todo instrumento do inventário vem com a data da última calibração', () => {
  dados.seed().instrumentos.forEach((i) => {
    assert.match(i.ultimaCalibracao, /^\d{4}-\d{2}-\d{2}$/, i.id + ' sem data válida');
    assert.equal(i.periodicidadeMeses, 12);
    assert.equal(i.proximaCalibracao, '', 'o vencimento é calculado, não transcrito');
    assert.deepEqual(i.historico, []);
    assert.equal(i.ativo, true);
  });
});

/* A segunda planilha traz a data por nome, e há nome repetido — 24 canais por burner, dez
   acelerômetros triaxiais. O que sustenta o casamento é a ordem: cada campanha caiu num dia
   só, então data errada aqui aparece como um burner com dois dias diferentes. */
test('a data da última calibração casa com a campanha de cada posto', () => {
  const base = dados.seed();
  const porPosto = {};
  base.instrumentos
    .filter((i) => /^Type K Temperature - Channel /.test(i.nome))
    .forEach((i) => {
      porPosto[i.local] = porPosto[i.local] || new Set();
      porPosto[i.local].add(i.ultimaCalibracao);
    });

  assert.deepEqual([...porPosto['Burner 01']], ['2026-05-04']);
  assert.deepEqual([...porPosto['Burner 02']], ['2026-05-04']);
  assert.deepEqual([...porPosto['Burner 03']], ['2026-05-05']);

  assert.equal(util.porId(base.instrumentos, 'TCL-TKC-B3-001').ultimaCalibracao, '2026-05-05',
    'o controlador do burner 03 foi junto com os canais dele');
  assert.equal(util.porId(base.instrumentos, 'TCL-AC-015').ultimaCalibracao, '2026-05-15');
  assert.equal(util.porId(base.instrumentos, 'TCL-AC-006').ultimaCalibracao, '2026-05-22');
});

/* Com o inventário datado ninguém mais fica sem plano, e a janela passa a mostrar o que a
   planilha escondia: o que já venceu está medindo. */
test('o inventário datado não deixa instrumento sem plano', () => {
  const resumo = calibracao.resumo(dados.seed().instrumentos, '2026-08-03');

  assert.equal(resumo.total, 229);
  assert.equal(resumo.semPlano, 0);
  assert.ok(resumo.vencidos > 0, 'a planilha traz datas fora da validade de 12 meses');
  assert.equal(resumo.vencidos + resumo.aVencer + resumo.emDia, 229);
});

/* ---- Registro pelo store ---- */

test('registrar calibração renova a validade e guarda o certificado', () => {
  store.restaurarPadrao();
  const r = store.registrarCalibracao('TCL-AC-012', {
    data: '2026-03-10', resultado: 'APROVADO',
    certificado: 'RBC-2026-0481', laboratorio: 'Metrologia XPTO'
  });

  assert.equal(r.ok, true);
  const i = util.porId(store.get().instrumentos, 'TCL-AC-012');
  assert.equal(i.ultimaCalibracao, '2026-03-10');
  assert.equal(i.proximaCalibracao, '2027-03-10');
  assert.equal(i.certificado, 'RBC-2026-0481');
  assert.equal(i.situacao, 'EM_USO');
  assert.equal(i.historico.length, 1);
  assert.equal(i.historico[0].resultado, 'APROVADO');
});

test('a periodicidade informada no registro passa a valer para o instrumento', () => {
  store.restaurarPadrao();
  store.registrarCalibracao('TCL-AC-012', {
    data: '2026-03-10', resultado: 'APROVADO', periodicidadeMeses: 24
  });
  const i = util.porId(store.get().instrumentos, 'TCL-AC-012');

  assert.equal(i.periodicidadeMeses, 24);
  assert.equal(i.proximaCalibracao, '2028-03-10');
});

test('calibração reprovada não renova a validade e tira o instrumento de uso', () => {
  store.restaurarPadrao();
  store.registrarCalibracao('TCL-AC-012', { data: '2026-03-10', resultado: 'APROVADO' });
  store.registrarCalibracao('TCL-AC-012', {
    data: '2027-03-12', resultado: 'REPROVADO', observacao: 'desvio acima da tolerância'
  });

  const i = util.porId(store.get().instrumentos, 'TCL-AC-012');
  assert.equal(i.situacao, 'FORA_DE_USO');
  assert.equal(i.proximaCalibracao, '', 'reprovado não ganha validade nova');
  assert.equal(i.historico.length, 2, 'a reprovação fica registrada');
  assert.equal(calibracao.estado(i, '2027-04-01').prazo, 'SEM_PLANO');
});

test('registrar sem data é recusado', () => {
  store.restaurarPadrao();
  const r = store.registrarCalibracao('TCL-AC-012', { resultado: 'APROVADO' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /date/i);
});

/* ---- Lançamento em lote ---- */

test('a data é lida no formato da planilha brasileira e no ISO', () => {
  assert.equal(calibracao.interpretarData('31/12/2025'), '2025-12-31');
  assert.equal(calibracao.interpretarData('5/3/26'), '2026-03-05', 'dois dígitos são deste século');
  assert.equal(calibracao.interpretarData('31.12.2025'), '2025-12-31');
  assert.equal(calibracao.interpretarData('2025-12-31'), '2025-12-31');
  assert.equal(calibracao.interpretarData('29/02/2028'), '2028-02-29', 'ano bissexto existe');
});

test('data impossível é recusada em vez de virar outro dia', () => {
  assert.equal(calibracao.interpretarData('31/02/2026'), '', 'fevereiro não tem dia 31');
  assert.equal(calibracao.interpretarData('10/13/2026'), '', 'não existe mês 13');
  assert.equal(calibracao.interpretarData('29/02/2026'), '', '2026 não é bissexto');
  assert.equal(calibracao.interpretarData('em breve'), '');
  assert.equal(calibracao.interpretarData(''), '');
});

test('o lote aceita a colagem do Excel, com e sem certificado', () => {
  const instrumentos = [
    instrumento({ id: 'TCL-AC-012' }),
    instrumento({ id: 'TCL-CC-001', periodicidadeMeses: 6 })
  ];
  const leitura = calibracao.interpretarLote(
    'Código\tData\n' +
    'TCL-AC-012\t12/03/2026\n' +
    'TCL-CC-001\t05/11/2025\tRBC-2025-0481\tMetrologia XPTO\n',
    instrumentos);

  assert.equal(leitura.aplicaveis.length, 2, 'o cabeçalho colado junto é ignorado');
  assert.equal(leitura.problemas.length, 0);
  assert.equal(leitura.aplicaveis[0].instrumento.id, 'TCL-AC-012');
  assert.equal(leitura.aplicaveis[0].data, '2026-03-12');
  assert.equal(leitura.aplicaveis[1].certificado, 'RBC-2025-0481');
  assert.equal(leitura.aplicaveis[1].laboratorio, 'Metrologia XPTO');
});

test('o lote separa por ponto e vírgula, vírgula ou espaço', () => {
  const instrumentos = [instrumento({ id: 'TCL-AC-012' })];
  ['TCL-AC-012;12/03/2026', 'TCL-AC-012,12/03/2026', 'TCL-AC-012 12/03/2026'].forEach((linha) => {
    const leitura = calibracao.interpretarLote(linha, instrumentos);
    assert.equal(leitura.aplicaveis.length, 1, linha);
    assert.equal(leitura.aplicaveis[0].data, '2026-03-12');
  });
});

test('o lote reconhece o código antigo da planilha', () => {
  const instrumentos = [instrumento({ id: 'TCL-AC-012', codigoAntigo: 'INS-0345' })];
  const leitura = calibracao.interpretarLote('INS-0345\t12/03/2026', instrumentos);

  assert.equal(leitura.aplicaveis.length, 1);
  assert.equal(leitura.aplicaveis[0].instrumento.id, 'TCL-AC-012');
});

test('o lote aponta cada linha que não dá para lançar, sem descartar as boas', () => {
  const instrumentos = [instrumento({ id: 'TCL-AC-012' }), instrumento({ id: 'TCL-CC-001' })];
  const leitura = calibracao.interpretarLote(
    'TCL-AC-012\t12/03/2026\n' +
    'TCL-XX-999\t12/03/2026\n' +
    'TCL-CC-001\t31/02/2026\n' +
    'TCL-AC-012\t01/01/2026\n',
    instrumentos);

  assert.equal(leitura.aplicaveis.length, 1, 'só a primeira linha sobrevive');
  assert.deepEqual(leitura.problemas.map((l) => l.situacao),
    ['DESCONHECIDO', 'DATA_INVALIDA', 'REPETIDO']);
  assert.deepEqual(leitura.problemas.map((l) => l.linha), [2, 3, 4],
    'o número da linha é o da colagem, para o usuário achar o erro');
});

test('lançar em lote preenche a última calibração e a validade de 12 meses', () => {
  store.restaurarPadrao();
  const antes = store.get().instrumentos.length;
  const r = store.lancarCalibracoesEmLote([
    { instrumentoId: 'TCL-AC-012', data: '2026-03-10' },
    { instrumentoId: 'TCL-AC-014', data: '2024-11-05', certificado: 'RBC-2024-0481' }
  ]);

  assert.equal(r.aplicados.length, 2);
  assert.equal(store.get().instrumentos.length, antes, 'lote não cria instrumento');

  const a = util.porId(store.get().instrumentos, 'TCL-AC-012');
  assert.equal(a.ultimaCalibracao, '2026-03-10');
  assert.equal(a.proximaCalibracao, '2027-03-10', '12 meses é o padrão');
  assert.equal(a.historico.length, 1, 'o lançamento fica no histórico');

  const b = util.porId(store.get().instrumentos, 'TCL-AC-014');
  assert.equal(b.certificado, 'RBC-2024-0481');
  assert.equal(b.proximaCalibracao, '2025-11-05');
  assert.equal(calibracao.estado(b, '2026-08-10').prazo, 'VENCIDO',
    'data antiga entra vencida, que é a informação que interessa');
});

test('o lote respeita a periodicidade já ajustada no instrumento', () => {
  store.restaurarPadrao();
  store.salvarInstrumento({ id: 'TCL-AC-012', periodicidadeMeses: 6 });
  store.lancarCalibracoesEmLote([{ instrumentoId: 'TCL-AC-012', data: '2026-03-10' }]);

  const i = util.porId(store.get().instrumentos, 'TCL-AC-012');
  assert.equal(i.periodicidadeMeses, 6);
  assert.equal(i.proximaCalibracao, '2026-09-10');
});

test('o lote não muda a situação de quem está em calibração', () => {
  store.restaurarPadrao();
  const emCalibracao = store.get().instrumentos.find((i) => i.situacao === 'EM_CALIBRACAO');
  store.lancarCalibracoesEmLote([{ instrumentoId: emCalibracao.id, data: '2026-03-10' }]);

  assert.equal(util.porId(store.get().instrumentos, emCalibracao.id).situacao, 'EM_CALIBRACAO',
    'lançar a data anterior não devolve o instrumento ao uso');
});

test('o instrumento cadastrado à mão convive com o inventário de partida', () => {
  store.restaurarPadrao();
  const total = store.get().instrumentos.length;
  store.salvarInstrumento({
    id: 'TCL-NV-001', nome: 'Instrumento novo', local: 'Instrumentation',
    situacao: 'EM_USO', ativo: true, periodicidadeMeses: 6
  });
  assert.equal(store.get().instrumentos.length, total + 1);

  store.salvarInstrumento({ id: 'TCL-NV-001', nome: 'Instrumento novo (revisado)' });
  assert.equal(store.get().instrumentos.length, total + 1, 'editar não duplica');
  assert.equal(util.porId(store.get().instrumentos, 'TCL-NV-001').nome,
    'Instrumento novo (revisado)');
});

test('dados salvos sem inventário recebem os instrumentos sem perder o que foi preenchido', () => {
  const base = dados.seed();
  delete base.instrumentosVersao;
  base.instrumentos = [
    Object.assign(instrumento({ id: 'TCL-AC-012' }), {
      ultimaCalibracao: '2026-02-01', certificado: 'MEU-123', periodicidadeMeses: 6
    })
  ];

  store.importar(JSON.stringify(base));
  const estado = store.get();

  assert.equal(estado.instrumentos.length, 229, 'os que faltavam entram');
  const meu = util.porId(estado.instrumentos, 'TCL-AC-012');
  assert.equal(meu.ultimaCalibracao, '2026-02-01', 'o plano preenchido não é sobrescrito');
  assert.equal(meu.certificado, 'MEU-123');
  assert.equal(meu.periodicidadeMeses, 6);
});

test('dados salvos antes das datas recebem a última calibração da planilha', () => {
  const base = dados.seed();
  base.instrumentosVersao = 1;
  base.instrumentos = base.instrumentos.map((i) => Object.assign({}, i, { ultimaCalibracao: '' }));
  /* Um já foi lançado na plataforma: tem data e histórico, e é ele quem manda. */
  const lancado = util.porId(base.instrumentos, 'TCL-AC-014');
  lancado.ultimaCalibracao = '2026-06-30';
  lancado.historico = [{ data: '2026-06-30', resultado: 'APROVADO' }];

  store.importar(JSON.stringify(base));
  const estado = store.get();

  assert.equal(util.porId(estado.instrumentos, 'TCL-AC-012').ultimaCalibracao, '2026-05-14',
    'a lacuna é preenchida pela planilha');
  assert.equal(util.porId(estado.instrumentos, 'TCL-AC-014').ultimaCalibracao, '2026-06-30',
    'o que já foi lançado na plataforma não volta atrás');
  assert.equal(calibracao.resumo(estado.instrumentos, '2026-08-03').semPlano, 0);
});
