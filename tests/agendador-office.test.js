/* Parity test between the Office Script and the engine it was ported from.

   ferramentas/agendador-office-script.ts is a port of src/scheduler.js: the same allocation
   rules, written in TypeScript so it can run inside Microsoft 365. Two copies of an algorithm
   drift, and the drift here is expensive — the web version and the Power App would start
   disagreeing about which rig a test lands on, with nothing failing to say so.

   So this test runs both against the same scenarios and asserts they place every request on the
   same rig, on the same dates. The TypeScript is stripped of its annotations and evaluated: the
   repository has no build step and no dependencies, and adding a compiler for one file would be
   a worse trade than the small stripper below. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const scheduler = require('../src/scheduler.js');

const FONTE = path.join(__dirname, '..', 'ferramentas', 'agendador-office-script.ts');

/* ---------------------------------------------------------------- type stripping */

/* Removes `interface Name { ... }`, counting braces so a nested `{ [id: string]: number }`
   does not end the block early. */
function removerInterfaces(src) {
  let saida = '';
  let i = 0;
  while (i < src.length) {
    const m = /\binterface\s+\w+\s*\{/.exec(src.slice(i));
    if (!m) { saida += src.slice(i); break; }
    saida += src.slice(i, i + m.index);
    let j = i + m.index + m[0].length;
    let profundidade = 1;
    while (j < src.length && profundidade > 0) {
      if (src[j] === '{') profundidade++;
      else if (src[j] === '}') profundidade--;
      j++;
    }
    i = j;
  }
  return saida;
}

/* Splits a parameter list on commas that are at depth zero, so `{ [id: string]: Window[][] }`
   stays in one piece. */
function partesDeParametros(lista) {
  const partes = [];
  let atual = '';
  let profundidade = 0;
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i];
    if (c === '{' || c === '[' || c === '(') profundidade++;
    if (c === '}' || c === ']' || c === ')') profundidade--;
    if (c === ',' && profundidade === 0) { partes.push(atual); atual = ''; continue; }
    atual += c;
  }
  if (atual.trim()) partes.push(atual);
  return partes;
}

/* Drops `: Type` from a single parameter, cutting at the first colon outside braces. */
function limparParametro(p) {
  let profundidade = 0;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '{' || c === '[' || c === '(') profundidade++;
    if (c === '}' || c === ']' || c === ')') profundidade--;
    if (c === ':' && profundidade === 0) return p.slice(0, i);
  }
  return p;
}

/* Rewrites every `function name(params): Return {` header without its annotations.
   Return types in this file are plain identifiers and unions — none contains a brace — so the
   body starts at the first `{` after the parameter list. */
function limparAssinaturas(src) {
  let saida = '';
  let i = 0;
  while (i < src.length) {
    const m = /\bfunction\s+(\w+)\s*\(/.exec(src.slice(i));
    if (!m) { saida += src.slice(i); break; }
    const inicio = i + m.index;
    saida += src.slice(i, inicio);

    let j = inicio + m[0].length;
    let profundidade = 1;
    let params = '';
    while (j < src.length && profundidade > 0) {
      if (src[j] === '(') profundidade++;
      else if (src[j] === ')') { profundidade--; if (!profundidade) break; }
      params += src[j];
      j++;
    }
    const limpos = partesDeParametros(params).map(limparParametro).join(',');

    let k = j + 1;
    while (k < src.length && src[k] !== '{') k++;

    saida += 'function ' + m[1] + '(' + limpos + ') ';
    i = k;
  }
  return saida;
}

function paraJs(src) {
  let out = removerInterfaces(src);
  out = limparAssinaturas(out);
  /* `const x: T = ...` / `let x: T | null = null;` — no type here contains = or ; */
  out = out.replace(/\b(const|let)\s+(\w+)\s*:\s*[^=;]+([=;])/g, '$1 $2 $3');
  /* `value as string[]` — the [] has to go with the type, or `value[]` is left behind. */
  out = out.replace(/\s+as\s+\w+(\[\])*/g, '');
  return out;
}

const portado = (function () {
  const js = paraJs(fs.readFileSync(FONTE, 'utf8'));
  const fabrica = new Function(js + '\nreturn { plan: plan, addDays: addDays, diffDays: diffDays };');
  return fabrica();
})();

/* ---------------------------------------------------------------- scenarios */

const EQUIPAMENTOS = [
  { id: 'BURNER-1', nome: 'Burner 1', grupo: 'Burner', posicoes: 1, continuo: true,
    horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], manutencao: [] },
  { id: 'BURNER-2', nome: 'Burner 2', grupo: 'Burner', posicoes: 1, continuo: true,
    horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], manutencao: [] },
  { id: 'SHAKER', nome: 'Shaker', grupo: 'Shaker', posicoes: 1, continuo: false,
    horasDia: 16, diasUteis: [1, 2, 3, 4, 5], manutencao: [] },
  { id: 'COLDFLOW', nome: 'ColdFlow', grupo: 'ColdFlow', posicoes: 2, continuo: false,
    horasDia: 8, diasUteis: [1, 2, 3, 4, 5], manutencao: [] }
];

const TESTES = [
  { id: 'TP-01', horasSetup: 8, horasEnsaio: 300, horasReport: 14, amostras: 2,
    custoInsumos: 500, equipamentoGrupos: ['Burner'] },
  { id: 'TP-02', horasSetup: 4, horasEnsaio: 60, horasReport: 6, amostras: 1,
    custoInsumos: 0, equipamentoGrupos: ['Shaker'] },
  { id: 'TP-03', horasSetup: 2, horasEnsaio: 40, horasReport: 4, amostras: 3,
    custoInsumos: 120, equipamentoGrupos: ['Burner', 'Shaker'] },
  { id: 'TP-04', horasSetup: 1, horasEnsaio: 12, horasReport: 2, amostras: 1,
    custoInsumos: 0, equipamentoGrupos: ['ColdFlow'] },
  { id: 'TP-SEM-EQ', horasSetup: 5, horasEnsaio: 20, horasReport: 2, amostras: 1,
    custoInsumos: 0, equipamentoGrupos: [] },
  { id: 'TP-GRUPO-INEXISTENTE', horasSetup: 5, horasEnsaio: 20, horasReport: 2, amostras: 1,
    custoInsumos: 0, equipamentoGrupos: ['Dynamometer'] }
];

const PECAS = [
  { id: 'PC-HOT', custoAmostra: 3800 },
  { id: 'PC-COL', custoAmostra: 1650 }
];

const HOJE = '2026-08-17'; /* a Monday */

function demanda(id, testeId, extra) {
  const base = {
    id: id, testeId: testeId, pecaId: 'PC-COL', status: 'SOLICITADA', tipoLti: 'DV',
    prioridade: 'MEDIA', dataAmostras: HOJE, prazo: '2026-12-31', inicioFixo: '',
    quantidade: 2, criadoEm: HOJE
  };
  return Object.assign(base, extra || {});
}

/* The same scenario in the shape each engine expects. */
function paraEstado(demandas, manutencoes) {
  const equipamentos = EQUIPAMENTOS.map(function (eq) {
    const copia = Object.assign({}, eq);
    copia.manutencao = (manutencoes || []).filter(function (m) { return m.equipmentId === eq.id; })
      .map(function (m) { return { inicio: m.start, fim: m.end }; });
    return copia;
  });
  return {
    equipamentos: equipamentos, testes: TESTES, pecas: PECAS,
    demandas: demandas, hourlyRate: 368.75
  };
}

function paraPayload(demandas, manutencoes) {
  return {
    today: HOJE,
    hourlyRate: 368.75,
    equipment: EQUIPAMENTOS.map(function (eq) {
      return {
        id: eq.id, name: eq.nome, group: eq.grupo, positions: eq.posicoes,
        continuous: eq.continuo, hoursPerDay: eq.horasDia, operatingDays: eq.diasUteis
      };
    }),
    maintenance: manutencoes || [],
    procedures: TESTES.map(function (t) {
      return {
        id: t.id, setupHours: t.horasSetup, testHours: t.horasEnsaio,
        reportingHours: t.horasReport, samples: t.amostras,
        consumablesCost: t.custoInsumos, equipmentGroups: t.equipamentoGrupos
      };
    }),
    partTypes: PECAS.map(function (p) {
      return { id: p.id, costPerSample: p.custoAmostra };
    }),
    requests: demandas.map(function (d) {
      return {
        id: d.id, ref: d.id, procedureId: d.testeId, partTypeId: d.pecaId, priority: d.prioridade,
        ltiClassification: d.tipoLti, status: d.status,
        samplesAvailableFrom: d.dataAmostras, dueDate: d.prazo,
        forcedStart: d.inicioFixo || '', quantity: d.quantidade, createdAt: d.criadoEm
      };
    })
  };
}

/* Reduces either engine's output to the same comparable shape. */
function resumoOriginal(demandas, manutencoes) {
  const plano = scheduler.planejar(paraEstado(demandas, manutencoes), HOJE);
  const mapa = {};
  plano.alocacoes.forEach(function (a) {
    mapa[a.demandaId] = {
      inicio: a.inicio || '',
      fim: a.fim || '',
      equipamentos: a.equipamentos.map(function (e) { return e.nome; }).join(' + '),
      dias: a.diasOperacao || 0,
      cotacao: !!a.cotacao,
      bloqueada: !a.inicio && !a.cotacao
    };
  });
  return mapa;
}

function resumoPortado(demandas, manutencoes) {
  const saida = portado.plan(paraPayload(demandas, manutencoes));
  const mapa = {};
  saida.results.forEach(function (r) {
    mapa[r.id] = {
      inicio: r.plannedStart,
      fim: r.plannedEnd,
      equipamentos: r.allocatedEquipment,
      dias: r.operatingDays,
      cotacao: r.isQuote,
      bloqueada: !r.plannedStart && !r.isQuote
    };
  });
  return mapa;
}

function conferirParidade(nome, demandas, manutencoes) {
  const a = resumoOriginal(demandas, manutencoes);
  const b = resumoPortado(demandas, manutencoes);
  assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(),
    nome + ': the two engines returned different requests');
  Object.keys(a).forEach(function (id) {
    assert.deepEqual(b[id], a[id], nome + ': ' + id + ' was placed differently');
  });
  return a;
}

/* ---------------------------------------------------------------- the tests */

test('the type stripper produced something runnable', () => {
  assert.equal(typeof portado.plan, 'function');
  assert.equal(portado.addDays('2026-08-17', 5), '2026-08-22');
  assert.equal(portado.diffDays('2026-08-17', '2026-08-22'), 5);
});

test('a single request lands on the same rig, on the same dates', () => {
  const resumo = conferirParidade('single', [demanda('DM-1', 'TP-01')]);
  assert.ok(resumo['DM-1'].inicio, 'the request should have been scheduled');
  assert.equal(resumo['DM-1'].equipamentos, 'Burner 1');
});

test('competing requests queue in the same order on both engines', () => {
  conferirParidade('queue', [
    demanda('DM-1', 'TP-01'),
    demanda('DM-2', 'TP-01'),
    demanda('DM-3', 'TP-01'),
    demanda('DM-4', 'TP-01')
  ]);
});

test('priority and due date order the queue identically', () => {
  conferirParidade('priority', [
    demanda('DM-BAIXA', 'TP-01', { prioridade: 'BAIXA', prazo: '2026-09-30' }),
    demanda('DM-ALTA', 'TP-01', { prioridade: 'ALTA', prazo: '2026-12-31' }),
    demanda('DM-MEDIA-CEDO', 'TP-01', { prioridade: 'MEDIA', prazo: '2026-09-01' }),
    demanda('DM-MEDIA-TARDE', 'TP-01', { prioridade: 'MEDIA', prazo: '2026-11-01' })
  ]);
});

test('a test occupying two groups reserves a unit in each, for the same window', () => {
  const resumo = conferirParidade('two groups', [demanda('DM-1', 'TP-03')]);
  assert.match(resumo['DM-1'].equipamentos, /\+/,
    'the allocation should name a unit from each group');
});

/* The Shaker runs 16 h a day Mon-Fri and the Burner 24/7: a test on both advances at the
   Shaker's pace. This is the case where a naive port silently gets the duration wrong. */
test('the slowest rig sets the pace when two groups are held at once', () => {
  const soBurner = conferirParidade('burner only', [demanda('DM-1', 'TP-03', {
    testeId: 'TP-03'
  })]);
  assert.ok(soBurner['DM-1'].dias >= 3, 'a 42 h test at 16 h/day takes at least 3 days');
});

test('a pinned start is honoured the same way, or blocked with the same reason', () => {
  conferirParidade('pinned', [
    demanda('DM-FIXA', 'TP-01', { inicioFixo: '2026-09-01' }),
    demanda('DM-LIVRE', 'TP-01')
  ]);
});

test('maintenance pushes the same requests out on both engines', () => {
  conferirParidade('maintenance', [
    demanda('DM-1', 'TP-02')
  ], [
    { equipmentId: 'SHAKER', start: '2026-08-17', end: '2026-08-28' }
  ]);
});

test('quotes take no rig on either engine', () => {
  const resumo = conferirParidade('quotes', [
    demanda('DM-COT', 'TP-01', { tipoLti: 'COTACAO' }),
    demanda('DM-REAL', 'TP-01')
  ]);
  assert.equal(resumo['DM-COT'].cotacao, true);
  assert.equal(resumo['DM-COT'].inicio, '', 'a quote reserves nothing');
  assert.ok(resumo['DM-REAL'].inicio, 'the real request still gets a slot');
});

test('a procedure with no equipment is blocked identically', () => {
  const resumo = conferirParidade('no equipment', [demanda('DM-1', 'TP-SEM-EQ')]);
  assert.equal(resumo['DM-1'].bloqueada, true);
});

test('an equipment group with no unit registered is blocked identically', () => {
  const resumo = conferirParidade('missing group', [demanda('DM-1', 'TP-GRUPO-INEXISTENTE')]);
  assert.equal(resumo['DM-1'].bloqueada, true);
});

test('inactive requests are ignored by both engines', () => {
  const resumo = conferirParidade('inactive', [
    demanda('DM-ATIVA', 'TP-01'),
    demanda('DM-CONCLUIDA', 'TP-01', { status: 'CONCLUIDA' }),
    demanda('DM-CANCELADA', 'TP-01', { status: 'CANCELADA' })
  ]);
  assert.equal(Object.keys(resumo).length, 1, 'only the active request should come back');
});

test('a machine with two positions takes two requests at once, on both engines', () => {
  conferirParidade('positions', [
    demanda('DM-1', 'TP-04'),
    demanda('DM-2', 'TP-04'),
    demanda('DM-3', 'TP-04')
  ]);
});

test('sample arrival delays the start the same way', () => {
  conferirParidade('samples', [
    demanda('DM-1', 'TP-02', { dataAmostras: '2026-10-01' }),
    demanda('DM-2', 'TP-02')
  ]);
});

/* The flow hands over whatever SharePoint gives it. If a column was never converted from text,
   or a Choice arrives as its label, or a date carries a timestamp, the script has to cope —
   otherwise the failure shows up as a silently unscheduled request, weeks later. */
test('the raw SharePoint shapes produce the same plan as the clean ones', () => {
  const demandas = [
    demanda('DM-1', 'TP-01'),
    demanda('DM-2', 'TP-02'),
    demanda('DM-3', 'TP-03', { prioridade: 'ALTA' })
  ];
  const manutencoes = [{ equipmentId: 'BURNER-2', start: '2026-09-10', end: '2026-09-20' }];

  const limpo = portado.plan(paraPayload(demandas, manutencoes));

  /* The same payload as the lists actually hold it. */
  const cru = paraPayload(demandas, manutencoes);
  cru.today = '2026-08-17T03:00:00Z';
  cru.hourlyRate = '368.75';
  cru.equipment = cru.equipment.map(function (eq) {
    return {
      id: eq.id, name: eq.name, group: eq.group,
      positions: String(eq.positions),
      continuous: eq.continuous ? 'Yes' : 'No',
      hoursPerDay: String(eq.hoursPerDay),
      operatingDays: eq.operatingDays.join('; ')
    };
  });
  cru.procedures = cru.procedures.map(function (p) {
    return {
      id: p.id, setupHours: String(p.setupHours), testHours: String(p.testHours),
      reportingHours: String(p.reportingHours), samples: String(p.samples),
      consumablesCost: String(p.consumablesCost),
      equipmentGroups: p.equipmentGroups.join('; ')
    };
  });
  cru.partTypes = cru.partTypes.map(function (p) {
    return { id: p.id, costPerSample: String(p.costPerSample) };
  });
  cru.maintenance = cru.maintenance.map(function (m) {
    return { equipmentId: m.equipmentId, start: m.start + 'T03:00:00Z', end: m.end + 'T03:00:00Z' };
  });
  cru.requests = cru.requests.map(function (r) {
    return Object.assign({}, r, {
      quantity: String(r.quantity),
      samplesAvailableFrom: r.samplesAvailableFrom + 'T03:00:00Z',
      dueDate: r.dueDate + 'T03:00:00Z',
      createdAt: r.createdAt + 'T03:00:00Z'
    });
  });

  assert.deepEqual(portado.plan(cru), limpo,
    'raw SharePoint values should schedule exactly like clean ones');
});

/* A mixed load is where ordering, positions, groups and maintenance interact. If the two
   engines agree here, they agree in practice. */
test('a mixed load places every request identically', () => {
  const demandas = [];
  const testes = ['TP-01', 'TP-02', 'TP-03', 'TP-04'];
  const prioridades = ['ALTA', 'MEDIA', 'BAIXA'];
  for (let i = 0; i < 24; i++) {
    demandas.push(demanda('DM-' + i, testes[i % testes.length], {
      prioridade: prioridades[i % prioridades.length],
      prazo: '2026-' + (i % 2 ? '10' : '12') + '-' + (10 + (i % 18)),
      dataAmostras: i % 5 === 0 ? '2026-09-15' : HOJE,
      inicioFixo: i % 7 === 0 ? '2026-09-0' + (1 + (i % 8)) : '',
      quantidade: 1 + (i % 3)
    }));
  }
  const resumo = conferirParidade('mixed', demandas, [
    { equipmentId: 'BURNER-2', start: '2026-09-10', end: '2026-09-20' },
    { equipmentId: 'COLDFLOW', start: '2026-11-02', end: '2026-11-06' }
  ]);
  const agendadas = Object.keys(resumo).filter(function (id) { return !!resumo[id].inicio; });
  assert.ok(agendadas.length > 10, 'the scenario should actually schedule something');
});
