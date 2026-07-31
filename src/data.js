/* Dados de partida: clientes, classificação de LTI, equipamentos, catálogo de testes e peças.
   Tudo é editável na aplicação — isto é apenas o estado inicial. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});

  /* Fases de projeto. Não classificam o procedimento (qualquer teste pode rodar em
     qualquer fase); classificam a LTI que abre a demanda. */
  var FASES = [
    { id: 'DV', nome: 'DV — Design Validation', descricao: 'Validação de projeto com protótipos' },
    { id: 'PV', nome: 'PV — Process Validation', descricao: 'Validação de processo com peças de ferramental definitivo' },
    { id: 'VAVE', nome: 'VAVE', descricao: 'Revalidação após mudança de material, processo ou custo' }
  ];

  /* Fases de versões anteriores, convertidas ao carregar dados já salvos. */
  var FASES_ANTIGAS = { CONCEITO: 'DV', PPAP: 'PV', SERIE: 'VAVE' };

  /* Classificação da LTI (ordem de serviço) que abre a demanda.
     Cotação é orçamento: entra no custo, mas não reserva bancada. */
  var TIPOS_LTI = [
    { id: 'COTACAO', nome: 'Cotação', planeja: false, descricao: 'Orçamento; não ocupa bancada nem entra no planejamento' }
  ].concat(FASES.map(function (f) {
    return { id: f.id, nome: f.nome, planeja: true, descricao: f.descricao };
  }));

  /* Quem usa a plataforma. Sem servidor, o perfil é uma escolha da interface: guia o que
     cada um vê e edita, não é controle de acesso. */
  var PERFIS = [
    { id: 'PRODUTO', nome: 'Engenheiro de Produto',
      descricao: 'Cliente interno: solicita cotações e abre demandas de teste' },
    { id: 'TESTES', nome: 'Engenheiro de Testes',
      descricao: 'Mantém catálogo e cadastros, opera o laboratório e acompanha os KPIs' }
  ];

  var TODOS_PERFIS = PERFIS.map(function (p) { return p.id; });

  /* Permissão por janela. "editar" sempre implica "ver". */
  var PERMISSOES_PADRAO = {
    catalogo: { ver: TODOS_PERFIS.slice(), editar: ['TESTES'] },
    cotacoes: { ver: TODOS_PERFIS.slice(), editar: TODOS_PERFIS.slice() },
    demandas: { ver: TODOS_PERFIS.slice(), editar: TODOS_PERFIS.slice() },
    planejamento: { ver: TODOS_PERFIS.slice(), editar: ['TESTES'] },
    painel: { ver: ['TESTES'], editar: ['TESTES'] },
    clientes: { ver: ['TESTES'], editar: ['TESTES'] },
    equipamentos: { ver: ['TESTES'], editar: ['TESTES'] },
    pecas: { ver: ['TESTES'], editar: ['TESTES'] },
    permissoes: { ver: ['TESTES'], editar: ['TESTES'] }
  };

  var STATUS_COTACAO = [
    { id: 'ABERTA', nome: 'Em elaboração' },
    { id: 'ENVIADA', nome: 'Enviada' },
    { id: 'APROVADA', nome: 'Aprovada' },
    { id: 'RECUSADA', nome: 'Recusada' }
  ];

  var AREAS = [
    { id: 'HOT', nome: 'Hot End', descricao: 'Coletor, downpipe, catalisador, DPF/GPF, flexível' },
    { id: 'COLD', nome: 'Cold End', descricao: 'Silencioso, ressonador, tubos, ponteira, coxins' },
    { id: 'AMBOS', nome: 'Hot & Cold End', descricao: 'Aplicável aos dois lados do sistema' }
  ];

  var PRIORIDADES = [
    { id: 'ALTA', nome: 'Alta', peso: 0 },
    { id: 'MEDIA', nome: 'Média', peso: 1 },
    { id: 'BAIXA', nome: 'Baixa', peso: 2 }
  ];

  /* Hourly rate do centro de testes: um único valor para todos os procedimentos,
     atualizado uma vez por ano. Não varia por ensaio nem por bancada. Cotações já
     arquivadas guardam o rate do dia em que foram feitas e não mudam quando este sobe. */
  var HOURLY_RATE = 368.75;
  var HOURLY_RATE_VIGENCIA = '2026';

  var CLIENTES = [
    { id: 'CLI-GM', nome: 'GM — General Motors', segmento: 'OEM' },
    /* CLI-FRD é a Ford; CLI-FOR, abaixo, é a Forvia Faurecia — empresas diferentes. */
    { id: 'CLI-FRD', nome: 'Ford', segmento: 'OEM' },
    { id: 'CLI-FOR', nome: 'Forvia Faurecia', segmento: 'Tier 1' },
    { id: 'CLI-VW', nome: 'Volkswagen', segmento: 'OEM' },
    { id: 'CLI-HYU', nome: 'Hyundai', segmento: 'OEM' },
    { id: 'CLI-RSA', nome: 'RSA', segmento: 'OEM' },
    { id: 'CLI-NIS', nome: 'Nissan', segmento: 'OEM' },
    { id: 'CLI-STL', nome: 'Stellantis', segmento: 'OEM' },
    { id: 'CLI-SCA', nome: 'Scania', segmento: 'OEM — Comerciais' }
  ];

  /* posicoes = quantos ensaios o equipamento roda em paralelo.
     continuo = true -> ensaio corre 24 h/dia sem operador.
     diasUteis = dias da semana em que o equipamento opera (0 = domingo).
     grupo = família de unidades intercambiáveis. O procedimento pede o grupo ("Burner"),
     e o planejamento escolhe a unidade livre mais cedo. */
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

  /* Catálogo de procedimentos por cliente.
     Cada linha é [nome do procedimento, norma] e, quando as horas já foram levantadas,
     um terceiro elemento { ensaio, setup, report }. Nome, norma e revisão vêm da
     especificação do cliente; as horas vêm do levantamento do centro de testes. Os
     demais campos ficam em branco para o engenheiro de testes preencher no cadastro —
     até isso o procedimento aparece no catálogo marcado como "sem equipamento".

     Sobre os campos preenchidos depois:
     revisao = revisão vigente do procedimento; acompanha o nome em toda a aplicação.
     Custo do procedimento = (horasSetup + horasEnsaio + horasReport) x hourly rate do
     centro de testes + custoInsumos. O rate não é do procedimento: é um valor só,
     no estado da aplicação.
     Só horasSetup + horasEnsaio ocupam bancada; horasReport é trabalho de escritório e
     entra no custo, não na agenda do equipamento.
     equipamentoGrupos = famílias de bancada que o ensaio ocupa ao mesmo tempo. O
     planejamento escolhe, dentro de cada grupo, a unidade que libera mais cedo.
     clientes = lista vazia significa procedimento padrão do laboratório, exigido por todos.
     O procedimento não é amarrado a fase de projeto: qualquer teste pode rodar em DV, PV ou VAVE. */
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

  /* Stellantis: a lista de origem trazia "Resonance Durability 90.160 - 9.7" duas vezes,
     com nome e norma idênticos — aqui ela entra uma vez. */
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

  /* Ford: a lista de origem trazia "Thermal fatigue rig test CETP 09.00-E-306" duas vezes,
     com nome e norma idênticos — aqui ela entra uma vez. */
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

  /* RSA: os quatro procedimentos vêm da mesma norma, mudando só o ensaio. */
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

  /* Monta os procedimentos de um cliente. O código é sequencial dentro do prefixo
     (TP-STL-07), então acrescentar um cliente não renumera os que já existem.

     O terceiro elemento da linha, quando existe, são as horas levantadas pelo centro de
     testes: { ensaio, setup, report }. Procedimento sem esse elemento ainda está por
     medir e fica zerado. */
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

  /* Peças e amostras. São tipos de peça, não peças de um cliente específico:
     qualquer cliente pode ter uma amostra de qualquer um destes tipos.
     A data de chegada das amostras é informada na demanda, não aqui. */
  var PECAS = [
    { id: 'PC-HOT', nome: 'Hot End', custoAmostra: 3800, descricao: 'Coletor, downpipe, tubo quente e flexível' },
    { id: 'PC-CAN', nome: 'Canning', custoAmostra: 5400, descricao: 'Substrato encapsulado: catalisador, DPF/GPF' },
    { id: 'PC-COL', nome: 'Cold End', custoAmostra: 1650, descricao: 'Tubos, ressonador e ponteira' },
    { id: 'PC-MUF', nome: 'Muffler', custoAmostra: 1900, descricao: 'Silencioso completo' },
    { id: 'PC-CMP', nome: 'Component', custoAmostra: 420, descricao: 'Coxim, suporte, flange, corpo de prova' }
  ];

  /* Versão do catálogo de partida. Subir este número faz os dados já salvos no
     navegador receberem os procedimentos novos daqui na próxima carga — é como uma
     mudança de catálogo chega a quem já usava a plataforma. Ver migrar() em store.js:
     até a versão 2 o catálogo antigo era substituído; a partir dela a atualização é
     aditiva e preserva o que já foi preenchido. */
  var CATALOGO_VERSAO = 9;

  TC.data = {
    CATALOGO_VERSAO: CATALOGO_VERSAO,
    HOURLY_RATE: HOURLY_RATE,
    HOURLY_RATE_VIGENCIA: HOURLY_RATE_VIGENCIA,
    PERFIS: PERFIS,
    PERMISSOES_PADRAO: PERMISSOES_PADRAO,
    STATUS_COTACAO: STATUS_COTACAO,
    FASES: FASES,
    FASES_ANTIGAS: FASES_ANTIGAS,
    TIPOS_LTI: TIPOS_LTI,
    AREAS: AREAS,
    PRIORIDADES: PRIORIDADES,
    seed: function () {
      return {
        catalogoVersao: CATALOGO_VERSAO,
        hourlyRate: HOURLY_RATE,
        hourlyRateVigencia: HOURLY_RATE_VIGENCIA,
        clientes: JSON.parse(JSON.stringify(CLIENTES)),
        equipamentos: JSON.parse(JSON.stringify(EQUIPAMENTOS)),
        testes: JSON.parse(JSON.stringify(TESTES)),
        pecas: JSON.parse(JSON.stringify(PECAS)),
        demandas: [],
        cotacoes: [],
        permissoes: JSON.parse(JSON.stringify(PERMISSOES_PADRAO)),
        perfilAtual: 'TESTES'
      };
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
