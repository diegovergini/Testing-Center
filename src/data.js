/* Seed data: customers, LTI classification, equipment, test catalogue and parts.
   Everything is editable in the app — this is only the initial state. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  if (!TC.instrumentosPadrao && typeof require !== 'undefined') require('./instrumentos-padrao.js');

  /* Project phases. They do not classify the procedure (any test can run in any phase);
     they classify the LTI that opens the request. */
  var FASES = [
    { id: 'DV', nome: 'DV — Design Validation', descricao: 'Design validation on prototypes' },
    { id: 'PV', nome: 'PV — Process Validation', descricao: 'Process validation on production-tooling parts' },
    { id: 'VAVE', nome: 'VAVE', descricao: 'Revalidation after a material, process or cost change' }
  ];

  /* Phases from earlier versions, converted when saved data is loaded. */
  var FASES_ANTIGAS = { CONCEITO: 'DV', PPAP: 'PV', SERIE: 'VAVE' };

  /* Classification of the LTI (work order) that opens the request.
     A quote is a budget: it counts towards cost but reserves no rig. */
  var TIPOS_LTI = [
    { id: 'COTACAO', nome: 'Quote', planeja: false, descricao: 'Budget only; takes no rig and stays out of the schedule' }
  ].concat(FASES.map(function (f) {
    return { id: f.id, nome: f.nome, planeja: true, descricao: f.descricao };
  }));

  /* Who uses the platform. With no server, the role is an interface choice: it guides what
     each person sees and edits, it is not access control. */
  var PERFIS = [
    { id: 'PRODUTO', nome: 'Product Engineer',
      descricao: 'Internal customer: requests quotes and opens test requests' },
    { id: 'TESTES', nome: 'Test Engineer',
      descricao: 'Keeps the catalogue and registers, runs the lab and follows the KPIs' }
  ];

  var TODOS_PERFIS = PERFIS.map(function (p) { return p.id; });

  /* Permission per screen. "edit" always implies "view". */
  var PERMISSOES_PADRAO = {
    catalogo: { ver: TODOS_PERFIS.slice(), editar: ['TESTES'] },
    cotacoes: { ver: TODOS_PERFIS.slice(), editar: TODOS_PERFIS.slice() },
    demandas: { ver: TODOS_PERFIS.slice(), editar: TODOS_PERFIS.slice() },
    planejamento: { ver: TODOS_PERFIS.slice(), editar: ['TESTES'] },
    painel: { ver: ['TESTES'], editar: ['TESTES'] },
    clientes: { ver: ['TESTES'], editar: ['TESTES'] },
    equipamentos: { ver: ['TESTES'], editar: ['TESTES'] },
    pecas: { ver: ['TESTES'], editar: ['TESTES'] },
    calibracao: { ver: ['TESTES'], editar: ['TESTES'] },
    permissoes: { ver: ['TESTES'], editar: ['TESTES'] }
  };

  /* Request and quote states live in src/fluxo.js, next to the rules of who can move each
     one — so there are never two lists of statuses to maintain. */

  /* Nature of the downtime. Preventive and calibration are scheduled; corrective is the one
     that happens because the rig broke. */
  var TIPOS_MANUTENCAO = [
    { id: 'PREVENTIVA', nome: 'Preventive' },
    { id: 'CALIBRACAO', nome: 'Calibration' },
    { id: 'CORRETIVA', nome: 'Corrective' },
    { id: 'MELHORIA', nome: 'Upgrade / rework' }
  ];

  var AREAS = [
    { id: 'HOT', nome: 'Hot End', descricao: 'Manifold, downpipe, catalyst, DPF/GPF, flex pipe' },
    { id: 'COLD', nome: 'Cold End', descricao: 'Muffler, resonator, pipes, tailpipe, hangers' },
    { id: 'AMBOS', nome: 'Hot & Cold End', descricao: 'Applies to both ends of the system' }
  ];

  var PRIORIDADES = [
    { id: 'ALTA', nome: 'High', peso: 0 },
    { id: 'MEDIA', nome: 'Medium', peso: 1 },
    { id: 'BAIXA', nome: 'Low', peso: 2 }
  ];

  /* Test centre hourly rate: a single value for every procedure, updated once a year. It
     does not vary by test or by rig. Archived quotes keep the rate of the day they were
     made and do not change when this one goes up. */
  var HOURLY_RATE = 368.75;
  var HOURLY_RATE_VIGENCIA = '2026';

  var CLIENTES = [
    { id: 'CLI-GM', nome: 'GM — General Motors', segmento: 'OEM' },
    /* CLI-FRD is Ford; CLI-FOR, below, is Forvia Faurecia — different companies. */
    { id: 'CLI-FRD', nome: 'Ford', segmento: 'OEM' },
    { id: 'CLI-FOR', nome: 'Forvia Faurecia', segmento: 'Tier 1' },
    { id: 'CLI-VW', nome: 'Volkswagen', segmento: 'OEM' },
    { id: 'CLI-HYU', nome: 'Hyundai', segmento: 'OEM' },
    { id: 'CLI-RSA', nome: 'RSA', segmento: 'OEM' },
    { id: 'CLI-NIS', nome: 'Nissan', segmento: 'OEM' },
    { id: 'CLI-STL', nome: 'Stellantis', segmento: 'OEM' },
    { id: 'CLI-SCA', nome: 'Scania', segmento: 'OEM — Commercial vehicles' }
  ];

  /* posicoes = how many tests the equipment runs in parallel.
     continuo = true -> the test runs 24 h/day with no operator.
     diasUteis = weekdays the equipment operates (0 = Sunday).
     grupo = family of interchangeable units. The procedure asks for the group ("Burner")
     and the scheduler picks the unit that frees up first. */
  var EQUIPAMENTOS = [
    { id: 'BURNER-1', nome: 'Burner 1', grupo: 'Burner', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], manutencao: [] },
    { id: 'BURNER-2', nome: 'Burner 2', grupo: 'Burner', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], manutencao: [] },
    { id: 'BURNER-3', nome: 'Burner 3', grupo: 'Burner', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], manutencao: [] },
    { id: 'SHAKER', nome: 'Shaker', grupo: 'Shaker', posicoes: 1, continuo: false, horasDia: 16, diasUteis: [1, 2, 3, 4, 5], manutencao: [] },
    { id: 'MTS-1', nome: 'MTS 1', grupo: 'MTS', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], manutencao: [] },
    { id: 'MTS-2', nome: 'MTS 2', grupo: 'MTS', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], manutencao: [] },
    { id: 'MTS-3', nome: 'MTS 3', grupo: 'MTS', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], manutencao: [] },
    { id: 'MTS-4', nome: 'MTS 4', grupo: 'MTS', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], manutencao: [] },
    { id: 'LMS-PTA', nome: 'LMS / PTA', grupo: 'LMS / PTA', posicoes: 1, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], manutencao: [] },
    { id: 'COLDFLOW', nome: 'ColdFlow', grupo: 'ColdFlow', posicoes: 1, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], manutencao: [] },
    { id: 'DYNO', nome: 'Dynamometer', grupo: 'Dynamometer', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], manutencao: [] }
  ];

  /* Procedure catalogue per customer.
     Each row is [procedure name, standard] plus, when the hours have been measured, a third
     element { ensaio, setup, report }. Name, standard and revision come from the customer
     specification; the hours come from the test centre's own survey. The remaining fields
     are left blank for the test engineer to fill in — until then the procedure shows up in
     the catalogue flagged as "no equipment".

     About the fields filled in later:
     revisao = the procedure's current revision; it follows the name across the whole app.
     Procedure cost = (horasSetup + horasEnsaio + horasReport) x the test centre hourly rate
     + custoInsumos. The rate does not belong to the procedure: it is a single value in the
     application state.
     Only horasSetup + horasEnsaio take up a rig; horasReport is desk work and counts
     towards cost, not towards the equipment schedule.
     equipamentoGrupos = rig families the test occupies at the same time. Within each group
     the scheduler picks the unit that frees up first.
     clientes = an empty list means a lab standard procedure, required by everyone.
     The procedure is not tied to a project phase: any test can run in DV, PV or VAVE. */
  var PROCEDIMENTOS_GM = [
    ['Resonance Durability', 'Appx C'],
    ['Physical Durability Aging Cycle', 'Appx C', { ensaio: 300, setup: 20, report: 14 }],
    ['Substrate Retention Cold Vibration Aging', 'Appx C', { ensaio: 150, setup: 16, report: 16 }],
    ['Container Thermal Shock Ageing Cycle', 'Appx C', { ensaio: 20, setup: 15, report: 12 }],
    ['Substrate Thermal Shock', 'Appx C', { ensaio: 700, setup: 11, report: 13 }],
    ['Exhaust backpressure', 'GMW16372'],
    ['Joint Leakage', 'GMW15261', { ensaio: 9, setup: 9, report: 7 }],
    ['Hanger Dynamic Stifness', 'GMW14182', { ensaio: 5, setup: 9, report: 19 }],
    ['Muffler Thermal Shock', 'GMW14380'],
    ['Hanger Durability', 'GMW14381 / GMW16941'],
    ['Pipe Durability', 'GMW14390 / GMW18104']
  ];

  /* Stellantis: the source list had "Resonance Durability 90.160 - 9.7" twice, with the
     same name and standard — here it goes in once. */
  var PROCEDIMENTOS_STELLANTIS = [
    ['Vibrational Analysis', '90.160 - 9.4'],
    ['Modal Analysis', '90.160 - 9.5 and 7-A7515', { ensaio: 16, setup: 12, report: 40 }],
    ['Thermal Shock on Engine Bench', '90.160 - 9.6'],
    ['Resonance Durability', '90.160 - 9.7'],
    ['Converter thermal shock', '90.160 - 9.8', { ensaio: 30, setup: 25, report: 41 }],
    ['Hot vibration test', '90.160 - 9.9', { ensaio: 82, setup: 21, report: 25 }],
    ['Cold vibration test', '90.160 - 9.10', { ensaio: 82, setup: 21, report: 24 }],
    ['Hot fatigue test', '90.160 - 9.11', { ensaio: 232.8, setup: 11, report: 30 }],
    ['Hot Vibration Manifold Joint Durability', '90.160 - 9.12'],
    ['Joint Integrity', '90238 – 9.14 and 90160 – 9.13', { ensaio: 81, setup: 18, report: 27 }],
    ['Burner Thermal Shock Test', '90160 - 9.21', { ensaio: 1089, setup: 24, report: 38 }],
    ['Time to Dry', '90238 - 5.3.1 and 7.T4193'],
    ['NVH', '90238 - 7.3'],
    ['Modal Analysis', '90238 - 7.3.8 and 7-A7515'],
    ['Flow Restriction (Backpressure)', '90238 - 7.4 and 7.A3758', { ensaio: 8, setup: 11, report: 18 }],
    ['Internal Condensate Evacuation', '90238 - 7.6'],
    ['Load Data Acquisition', '90238 - 9.4'],
    ['Cold Fatigue', '90238 - 9.8'],
    ['Muffler Thermal Shock', '90238 - 9.10'],
    ['Decomposition Tube Internal Shock', '90.301 - 9.1.1', { ensaio: 360, setup: 22, report: 40 }],
    ['Mixer resonance test', '90.301 - 9.5'],
    ['Tail Pipe Noise', 'B32 3140'],
    ['Subjective Noise', 'B32 3140'],
    ['Backpressure', 'B32 3110'],
    ['Modal test', 'B22 3120 - 5.1.3.2.3'],
    ['Fatigue test for joint', 'B32 0730'],
    ['Condensate evacuation', 'B32 3200'],
    ['Hot shake for canning', 'B22 3210'],
    ['Thermal shock', 'Acc. ST Project'],
    ['Ressonance Test', 'Acc. ST Project']
  ];

  /* Ford: the source list had "Thermal fatigue rig test CETP 09.00-E-306" twice, with the
     same name and standard — here it goes in once. */
  var PROCEDIMENTOS_FORD = [
    ['Thermal fatigue rig test', 'CETP 09.00-E-306'],
    ['Catalytic Converter & Pipe HeatShield Structural Durability Screening Test', 'CETP 09.00-L-306'],
    ['Global Catalytic Converter Water Quench', 'CETP 09.02-E-303', { ensaio: 14, setup: 7, report: 19 }],
    ['Global Emission Assembly Mechanical Step Stres', 'CETP 09.02-E-308'],
    ['Manifold Crack test', 'CETP 03.01-L-312'],
    ['High Speed Dyno', 'CETP09.00-E-308'],
    ['Cold Flow Back-pressure', 'CETP 09.00-L-403', { ensaio: 4.8, setup: 14, report: 11 }],
    ['Tail Pipe Noise', 'CETP 09.00-L-901'],
    ['Condensate Evacuatione', 'CETP 09.00-E-400'],
    ['Life Fatigue Curves (S-N Curve)', 'CETP 09.00-E-309'],
    ['Hot Vibration Manifold Joint Durability', 'TM-09.03-E-300']
  ];

  var PROCEDIMENTOS_VW = [
    ['Hot Shaker Test', 'EP 18310.55'],
    ['Thermal Fatigue Test', 'EP 18310.55'],
    ['Crack Test Under Overrun Conditions', 'EP EP18100.20'],
    ['Fatigue Test', 'TL 82391', { ensaio: 135, setup: 8, report: 15 }]
  ];

  var PROCEDIMENTOS_HYUNDAI = [
    ['NVH Test', 'ES 28600-09 6.3'],
    ['Hanger / Pipe Durability', 'ES 28600-22', { ensaio: 109, setup: 14, report: 12 }],
    ['Backpressure', 'ES 28600-09 - 6.1', { ensaio: 4, setup: 3, report: 12 }],
    ['Hot & Cold Vibration', 'ES28530-01'],
    ['Radiation Noise Test', 'ES 28600-09 - 6.4'],
    ['Ressonance Frequency Test', 'ES 28600-09 - 6.5'],
    ['Thermal Shock Test', 'ES 28600-09 - 6.7'],
    ['Shell Stifness Test', 'ES 28600-09 - 6.9'],
    ['Condensate Water Noise', 'ES 28600-09 - 6.11']
  ];

  /* RSA: the four procedures come from the same standard, only the test changes. */
  var PROCEDIMENTOS_RSA = [
    ['Cold Flow Backpresure', '34-05-803/--J'],
    ['Thermal Shock', '34-05-803/--J', { ensaio: 332, setup: 9, report: 19 }],
    ['Hot Shaker', '34-05-803/--J', { ensaio: 302, setup: 14, report: 21 }],
    ['Condensate Evacuation', '34-05-803/--J']
  ];

  var PROCEDIMENTOS_NISSAN = [
    ['Thermal Cycle Durability', '20000NDS01', { ensaio: 375, setup: 11, report: 6 }],
    ['Bypass rate', '20080NDS01'],
    ['Catalyst Retaining Performance Test', '20080NDS01'],
    ['Mount Bracket Durability', '20000NDS01']
  ];

  /* Builds one customer's procedures. The code is sequential within the prefix
     (TP-STL-07), so adding a customer does not renumber the existing ones.

     The row's third element, when present, holds the hours measured by the test centre:
     { ensaio, setup, report }. A procedure without it is still to be measured and stays at
     zero. */
  function procedimentosDe(clienteId, prefixo, linhas) {
    return linhas.map(function (linha, i) {
      var horas = linha[2] || {};
      return {
        id: prefixo + '-' + String(i + 1).padStart(2, '0'),
        nome: linha[0], norma: linha[1], revisao: 'Rev. 01',
        clientes: [clienteId],
        area: 'AMBOS', equipamentoGrupos: [],
        horasSetup: horas.setup || 0,
        horasEnsaio: horas.ensaio || 0,
        horasReport: horas.report || 0,
        amostras: 1,
        custoInsumos: 0,
        descricao: ''
      };
    });
  }

  var TESTES = procedimentosDe('CLI-GM', 'TP-GM', PROCEDIMENTOS_GM)
    .concat(procedimentosDe('CLI-STL', 'TP-STL', PROCEDIMENTOS_STELLANTIS))
    .concat(procedimentosDe('CLI-FRD', 'TP-FRD', PROCEDIMENTOS_FORD))
    .concat(procedimentosDe('CLI-VW', 'TP-VW', PROCEDIMENTOS_VW))
    .concat(procedimentosDe('CLI-HYU', 'TP-HYU', PROCEDIMENTOS_HYUNDAI))
    .concat(procedimentosDe('CLI-RSA', 'TP-RSA', PROCEDIMENTOS_RSA))
    .concat(procedimentosDe('CLI-NIS', 'TP-NIS', PROCEDIMENTOS_NISSAN));

  /* Parts and samples. These are part types, not parts of one customer: any customer can
     have a sample of any of these types.
     The sample arrival date is given on the request, not here. */
  var PECAS = [
    { id: 'PC-HOT', nome: 'Hot End', custoAmostra: 3800, descricao: 'Manifold, downpipe, hot pipe and flex pipe' },
    { id: 'PC-CAN', nome: 'Canning', custoAmostra: 5400, descricao: 'Canned substrate: catalyst, DPF/GPF' },
    { id: 'PC-COL', nome: 'Cold End', custoAmostra: 1650, descricao: 'Pipes, resonator and tailpipe' },
    { id: 'PC-MUF', nome: 'Muffler', custoAmostra: 1900, descricao: 'Complete muffler' },
    { id: 'PC-CMP', nome: 'Component', custoAmostra: 420, descricao: 'Hanger, bracket, flange, coupon' }
  ];

  /* Seed catalogue version. Raising this number makes data already saved in the browser
     pick up the new procedures from here on the next load — it is how a catalogue change
     reaches someone who was already using the platform. See migrar() in store.js: up to
     version 2 the old catalogue was replaced; from there on the update is additive and
     preserves whatever was filled in. */
  var CATALOGO_VERSAO = 9;

  /* Instrument inventory version, same mechanics as the catalogue: raising this number
     brings the new instruments to whoever already has saved data, without touching the
     calibration plan they filled in. */
  var INSTRUMENTOS_VERSAO = 2;

  TC.data = {
    CATALOGO_VERSAO: CATALOGO_VERSAO,
    INSTRUMENTOS_VERSAO: INSTRUMENTOS_VERSAO,
    HOURLY_RATE: HOURLY_RATE,
    HOURLY_RATE_VIGENCIA: HOURLY_RATE_VIGENCIA,
    PERFIS: PERFIS,
    PERMISSOES_PADRAO: PERMISSOES_PADRAO,
    FASES: FASES,
    FASES_ANTIGAS: FASES_ANTIGAS,
    TIPOS_LTI: TIPOS_LTI,
    AREAS: AREAS,
    TIPOS_MANUTENCAO: TIPOS_MANUTENCAO,
    PRIORIDADES: PRIORIDADES,
    seed: function () {
      return {
        catalogoVersao: CATALOGO_VERSAO,
        instrumentosVersao: INSTRUMENTOS_VERSAO,
        hourlyRate: HOURLY_RATE,
        hourlyRateVigencia: HOURLY_RATE_VIGENCIA,
        clientes: JSON.parse(JSON.stringify(CLIENTES)),
        equipamentos: JSON.parse(JSON.stringify(EQUIPAMENTOS)),
        testes: JSON.parse(JSON.stringify(TESTES)),
        pecas: JSON.parse(JSON.stringify(PECAS)),
        instrumentos: TC.instrumentosPadrao(),
        demandas: [],
        cotacoes: [],
        permissoes: JSON.parse(JSON.stringify(PERMISSOES_PADRAO)),
        perfilAtual: 'TESTES'
      };
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
