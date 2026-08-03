/* Calibration management tests: validity, due dates, criticality and recording the
   certificate. */
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

/* ---- Adding months ---- */

test('validity is added in months, respecting short months and the year boundary', () => {
  assert.equal(calibracao.somaMeses('2026-03-10', 12), '2027-03-10');
  assert.equal(calibracao.somaMeses('2026-01-31', 1), '2026-02-28', 'February has no 31st');
  assert.equal(calibracao.somaMeses('2028-01-31', 1), '2028-02-29', 'leap year');
  assert.equal(calibracao.somaMeses('2026-11-15', 6), '2027-05-15', 'crosses the year');
  assert.equal(calibracao.somaMeses('', 12), '', 'with no date there is no validity');
});

/* ---- Due date ---- */

test('with no last calibration the instrument has no plan, it is not expired', () => {
  const e = calibracao.estado(instrumento(), HOJE);
  assert.equal(e.prazo, 'SEM_PLANO');
  assert.equal(e.vencimento, '');
  assert.equal(e.criticidade, '', 'a gap in the register is not the same as an expired instrument');
});

test('validity comes from the last calibration plus the interval', () => {
  const e = calibracao.estado(
    instrumento({ ultimaCalibracao: '2026-03-10', periodicidadeMeses: 12 }), HOJE);
  assert.equal(e.vencimento, '2027-03-10');
  assert.equal(e.prazo, 'EM_DIA');
});

test('the certificate date wins over the computed one', () => {
  const e = calibracao.estado(instrumento({
    ultimaCalibracao: '2026-03-10', periodicidadeMeses: 12, proximaCalibracao: '2026-09-30'
  }), HOJE);
  assert.equal(e.vencimento, '2026-09-30', 'the certificate can carry a validity of its own');
});

test('falling due within 30 days counts as "due soon"', () => {
  const emDia = calibracao.estado(instrumento({ proximaCalibracao: '2026-10-01' }), HOJE);
  const aVencer = calibracao.estado(instrumento({ proximaCalibracao: '2026-09-05' }), HOJE);
  const vencido = calibracao.estado(instrumento({ proximaCalibracao: '2026-08-09' }), HOJE);

  assert.equal(emDia.prazo, 'EM_DIA');
  assert.equal(aVencer.prazo, 'A_VENCER');
  assert.equal(vencido.prazo, 'VENCIDO');
  assert.equal(vencido.diasParaVencer, -1);
});

test('the due date itself still counts as within validity', () => {
  const e = calibracao.estado(instrumento({ proximaCalibracao: HOJE }), HOJE);
  assert.equal(e.prazo, 'A_VENCER');
  assert.equal(e.diasParaVencer, 0);
});

/* ---- Criticality ---- */

test('expired and in use is critical; expired but out of service or back-up is only a warning', () => {
  const emUso = calibracao.estado(
    instrumento({ proximaCalibracao: '2026-01-01', situacao: 'EM_USO' }), HOJE);
  const foraDeUso = calibracao.estado(
    instrumento({ proximaCalibracao: '2026-01-01', situacao: 'FORA_DE_USO' }), HOJE);
  const desativado = calibracao.estado(
    instrumento({ proximaCalibracao: '2026-01-01', situacao: 'EM_USO', ativo: false }), HOJE);

  assert.equal(emUso.criticidade, 'CRITICO', 'a test measuring out of validity');
  assert.equal(foraDeUso.criticidade, 'ATENCAO');
  assert.equal(desativado.criticidade, 'ATENCAO');
});

/* ---- Summary and queue ---- */

test('the summary separates expired, due soon, in date and no plan', () => {
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
  assert.equal(r.criticos, 1, 'only the expired one still in use');
  assert.equal(r.aVencer, 1);
  assert.equal(r.emDia, 1);
  assert.equal(r.semPlano, 1);
  assert.equal(r.cobertura, 2 / 4, 'coverage only looks at what has a plan');
});

test('the queue brings what has expired and what falls due within the horizon, most urgent first', () => {
  const lista = [
    instrumento({ id: 'DEPOIS', proximaCalibracao: '2027-06-01' }),
    instrumento({ id: 'PERTO', proximaCalibracao: '2026-09-01' }),
    instrumento({ id: 'VENCIDO', proximaCalibracao: '2026-05-01' }),
    instrumento({ id: 'SEM_PLANO' })
  ];
  const agenda = calibracao.agenda(lista, HOJE, 90);

  assert.deepEqual(agenda.map((x) => x.instrumento.id), ['VENCIDO', 'PERTO']);
});

/* ---- Seed inventory ---- */

test('the seed inventory carries the spreadsheet instruments, with no repeated code', () => {
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
  assert.equal(celula.situacao, 'EM_CALIBRACAO', 'the Observações column becomes the condition');
  assert.equal(celula.backup, true, 'the back-up column becomes a boolean');
  assert.equal(celula.local, 'Hydro pulse 1');
});

test('every instrument in the inventory comes with its last calibration date', () => {
  dados.seed().instrumentos.forEach((i) => {
    assert.match(i.ultimaCalibracao, /^\d{4}-\d{2}-\d{2}$/, i.id + ' has no valid date');
    assert.equal(i.periodicidadeMeses, 12);
    assert.equal(i.proximaCalibracao, '', 'the due date is computed, not transcribed');
    assert.deepEqual(i.historico, []);
    assert.equal(i.ativo, true);
  });
});

/* The second spreadsheet gives the date by name, and names repeat — 24 channels per burner,
   ten triaxial accelerometers. What holds the match together is the order: each campaign fell
   on a single day, so a wrong date here shows up as a burner with two different days. */
test('the last calibration date matches each station\'s campaign', () => {
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
    'the burner 03 controller went along with its own channels');
  assert.equal(util.porId(base.instrumentos, 'TCL-AC-015').ultimaCalibracao, '2026-05-15');
  assert.equal(util.porId(base.instrumentos, 'TCL-AC-006').ultimaCalibracao, '2026-05-22');
});

/* With the inventory dated, nothing is left without a plan, and the screen starts showing
   what the spreadsheet was hiding: what has expired is still measuring. */
test('the dated inventory leaves no instrument without a plan', () => {
  const resumo = calibracao.resumo(dados.seed().instrumentos, '2026-08-03');

  assert.equal(resumo.total, 229);
  assert.equal(resumo.semPlano, 0);
  assert.ok(resumo.vencidos > 0, 'the spreadsheet carries dates outside the 12-month validity');
  assert.equal(resumo.vencidos + resumo.aVencer + resumo.emDia, 229);
});

/* ---- Recording through the store ---- */

test('recording a calibration renews the validity and keeps the certificate', () => {
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

test('the interval given when recording becomes the instrument\'s', () => {
  store.restaurarPadrao();
  store.registrarCalibracao('TCL-AC-012', {
    data: '2026-03-10', resultado: 'APROVADO', periodicidadeMeses: 24
  });
  const i = util.porId(store.get().instrumentos, 'TCL-AC-012');

  assert.equal(i.periodicidadeMeses, 24);
  assert.equal(i.proximaCalibracao, '2028-03-10');
});

test('a failed calibration renews nothing and takes the instrument out of service', () => {
  store.restaurarPadrao();
  store.registrarCalibracao('TCL-AC-012', { data: '2026-03-10', resultado: 'APROVADO' });
  store.registrarCalibracao('TCL-AC-012', {
    data: '2027-03-12', resultado: 'REPROVADO', observacao: 'deviation above tolerance'
  });

  const i = util.porId(store.get().instrumentos, 'TCL-AC-012');
  assert.equal(i.situacao, 'FORA_DE_USO');
  assert.equal(i.proximaCalibracao, '', 'a failed one gets no new validity');
  assert.equal(i.historico.length, 2, 'the failure is recorded');
  assert.equal(calibracao.estado(i, '2027-04-01').prazo, 'SEM_PLANO');
});

test('recording without a date is refused', () => {
  store.restaurarPadrao();
  const r = store.registrarCalibracao('TCL-AC-012', { resultado: 'APROVADO' });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /date/i);
});

/* ---- Bulk entry ---- */

test('the date is read in the Brazilian spreadsheet format and in ISO', () => {
  assert.equal(calibracao.interpretarData('31/12/2025'), '2025-12-31');
  assert.equal(calibracao.interpretarData('5/3/26'), '2026-03-05', 'two digits belong to this century');
  assert.equal(calibracao.interpretarData('31.12.2025'), '2025-12-31');
  assert.equal(calibracao.interpretarData('2025-12-31'), '2025-12-31');
  assert.equal(calibracao.interpretarData('29/02/2028'), '2028-02-29', 'ano bissexto existe');
});

test('an impossible date is refused instead of becoming another day', () => {
  assert.equal(calibracao.interpretarData('31/02/2026'), '', 'February has no 31st');
  assert.equal(calibracao.interpretarData('10/13/2026'), '', 'there is no month 13');
  assert.equal(calibracao.interpretarData('29/02/2026'), '', '2026 is not a leap year');
  assert.equal(calibracao.interpretarData('em breve'), '');
  assert.equal(calibracao.interpretarData(''), '');
});

test('bulk entry accepts an Excel paste, with and without a certificate', () => {
  const instrumentos = [
    instrumento({ id: 'TCL-AC-012' }),
    instrumento({ id: 'TCL-CC-001', periodicidadeMeses: 6 })
  ];
  const leitura = calibracao.interpretarLote(
    'Code\tDate\n' +
    'TCL-AC-012\t12/03/2026\n' +
    'TCL-CC-001\t05/11/2025\tRBC-2025-0481\tMetrologia XPTO\n',
    instrumentos);

  assert.equal(leitura.aplicaveis.length, 2, 'a header pasted along with it is ignored');
  assert.equal(leitura.problemas.length, 0);
  assert.equal(leitura.aplicaveis[0].instrumento.id, 'TCL-AC-012');
  assert.equal(leitura.aplicaveis[0].data, '2026-03-12');
  assert.equal(leitura.aplicaveis[1].certificado, 'RBC-2025-0481');
  assert.equal(leitura.aplicaveis[1].laboratorio, 'Metrologia XPTO');
});

test('bulk entry splits on semicolon, comma or space', () => {
  const instrumentos = [instrumento({ id: 'TCL-AC-012' })];
  ['TCL-AC-012;12/03/2026', 'TCL-AC-012,12/03/2026', 'TCL-AC-012 12/03/2026'].forEach((linha) => {
    const leitura = calibracao.interpretarLote(linha, instrumentos);
    assert.equal(leitura.aplicaveis.length, 1, linha);
    assert.equal(leitura.aplicaveis[0].data, '2026-03-12');
  });
});

test('bulk entry recognises the spreadsheet\'s legacy code', () => {
  const instrumentos = [instrumento({ id: 'TCL-AC-012', codigoAntigo: 'INS-0345' })];
  const leitura = calibracao.interpretarLote('INS-0345\t12/03/2026', instrumentos);

  assert.equal(leitura.aplicaveis.length, 1);
  assert.equal(leitura.aplicaveis[0].instrumento.id, 'TCL-AC-012');
});

test('bulk entry points out each row it cannot take, without discarding the good ones', () => {
  const instrumentos = [instrumento({ id: 'TCL-AC-012' }), instrumento({ id: 'TCL-CC-001' })];
  const leitura = calibracao.interpretarLote(
    'TCL-AC-012\t12/03/2026\n' +
    'TCL-XX-999\t12/03/2026\n' +
    'TCL-CC-001\t31/02/2026\n' +
    'TCL-AC-012\t01/01/2026\n',
    instrumentos);

  assert.equal(leitura.aplicaveis.length, 1, 'only the first row survives');
  assert.deepEqual(leitura.problemas.map((l) => l.situacao),
    ['DESCONHECIDO', 'DATA_INVALIDA', 'REPETIDO']);
  assert.deepEqual(leitura.problemas.map((l) => l.linha), [2, 3, 4],
    'the row number is the one from the paste, so the user can find the mistake');
});

test('bulk entry fills in the last calibration and the 12-month validity', () => {
  store.restaurarPadrao();
  const antes = store.get().instrumentos.length;
  const r = store.lancarCalibracoesEmLote([
    { instrumentoId: 'TCL-AC-012', data: '2026-03-10' },
    { instrumentoId: 'TCL-AC-014', data: '2024-11-05', certificado: 'RBC-2024-0481' }
  ]);

  assert.equal(r.aplicados.length, 2);
  assert.equal(store.get().instrumentos.length, antes, 'bulk entry creates no instrument');

  const a = util.porId(store.get().instrumentos, 'TCL-AC-012');
  assert.equal(a.ultimaCalibracao, '2026-03-10');
  assert.equal(a.proximaCalibracao, '2027-03-10', '12 months is the default');
  assert.equal(a.historico.length, 1, 'the entry stays in the history');

  const b = util.porId(store.get().instrumentos, 'TCL-AC-014');
  assert.equal(b.certificado, 'RBC-2024-0481');
  assert.equal(b.proximaCalibracao, '2025-11-05');
  assert.equal(calibracao.estado(b, '2026-08-10').prazo, 'VENCIDO',
    'an old date goes in expired, which is the information that matters');
});

test('bulk entry respects the interval already adjusted on the instrument', () => {
  store.restaurarPadrao();
  store.salvarInstrumento({ id: 'TCL-AC-012', periodicidadeMeses: 6 });
  store.lancarCalibracoesEmLote([{ instrumentoId: 'TCL-AC-012', data: '2026-03-10' }]);

  const i = util.porId(store.get().instrumentos, 'TCL-AC-012');
  assert.equal(i.periodicidadeMeses, 6);
  assert.equal(i.proximaCalibracao, '2026-09-10');
});

test('bulk entry does not change the condition of what is being calibrated', () => {
  store.restaurarPadrao();
  const emCalibracao = store.get().instrumentos.find((i) => i.situacao === 'EM_CALIBRACAO');
  store.lancarCalibracoesEmLote([{ instrumentoId: emCalibracao.id, data: '2026-03-10' }]);

  assert.equal(util.porId(store.get().instrumentos, emCalibracao.id).situacao, 'EM_CALIBRACAO',
    'entering the earlier date does not put the instrument back in service');
});

test('an instrument added by hand coexists with the seed inventory', () => {
  store.restaurarPadrao();
  const total = store.get().instrumentos.length;
  store.salvarInstrumento({
    id: 'TCL-NV-001', nome: 'Instrumento novo', local: 'Instrumentation',
    situacao: 'EM_USO', ativo: true, periodicidadeMeses: 6
  });
  assert.equal(store.get().instrumentos.length, total + 1);

  store.salvarInstrumento({ id: 'TCL-NV-001', nome: 'Instrumento novo (revisado)' });
  assert.equal(store.get().instrumentos.length, total + 1, 'editing does not duplicate');
  assert.equal(util.porId(store.get().instrumentos, 'TCL-NV-001').nome,
    'Instrumento novo (revisado)');
});

test('saved data without an inventory receives the instruments without losing what was filled in', () => {
  const base = dados.seed();
  delete base.instrumentosVersao;
  base.instrumentos = [
    Object.assign(instrumento({ id: 'TCL-AC-012' }), {
      ultimaCalibracao: '2026-02-01', certificado: 'MEU-123', periodicidadeMeses: 6
    })
  ];

  store.importar(JSON.stringify(base));
  const estado = store.get();

  assert.equal(estado.instrumentos.length, 229, 'the missing ones go in');
  const meu = util.porId(estado.instrumentos, 'TCL-AC-012');
  assert.equal(meu.ultimaCalibracao, '2026-02-01', 'the plan already filled in is not overwritten');
  assert.equal(meu.certificado, 'MEU-123');
  assert.equal(meu.periodicidadeMeses, 6);
});

test('data saved before the dates receives the spreadsheet\'s last calibration', () => {
  const base = dados.seed();
  base.instrumentosVersao = 1;
  base.instrumentos = base.instrumentos.map((i) => Object.assign({}, i, { ultimaCalibracao: '' }));
  /* One has already been entered on the platform: it has a date and a history, and it wins. */
  const lancado = util.porId(base.instrumentos, 'TCL-AC-014');
  lancado.ultimaCalibracao = '2026-06-30';
  lancado.historico = [{ data: '2026-06-30', resultado: 'APROVADO' }];

  store.importar(JSON.stringify(base));
  const estado = store.get();

  assert.equal(util.porId(estado.instrumentos, 'TCL-AC-012').ultimaCalibracao, '2026-05-14',
    'the gap is filled by the spreadsheet');
  assert.equal(util.porId(estado.instrumentos, 'TCL-AC-014').ultimaCalibracao, '2026-06-30',
    'what was already entered on the platform does not go back');
  assert.equal(calibracao.resumo(estado.instrumentos, '2026-08-03').semPlano, 0);
});
