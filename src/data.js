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

  var CLIENTES = [
    { id: 'CLI-FOR', nome: 'Forvia Faurecia', segmento: 'Tier 1' },
    { id: 'CLI-VW', nome: 'Volkswagen', segmento: 'OEM' },
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

  /* Catálogo de procedimentos.
     revisao = revisão vigente do procedimento; acompanha o nome em toda a aplicação.
     Custo do procedimento = (horasSetup + horasEnsaio + horasReport) x hourlyRate + custoInsumos.
     Só horasSetup + horasEnsaio ocupam bancada; horasReport é trabalho de escritório e
     entra no custo, não na agenda do equipamento.
     equipamentoGrupos = famílias de bancada que o ensaio ocupa ao mesmo tempo. O
     planejamento escolhe, dentro de cada grupo, a unidade que libera mais cedo.
     clientes = lista vazia significa procedimento padrão do laboratório, exigido por todos.
     O procedimento não é amarrado a fase de projeto: qualquer teste pode rodar em DV, PV ou VAVE. */
  var TESTES = [
    {
      id: 'TP-HOT-01', nome: 'Fadiga termomecânica (TMF)', norma: 'PV 1200 / cliente', revisao: 'Rev. 04',
      clientes: ['CLI-VW', 'CLI-SCA'],
      area: 'HOT', equipamentoGrupos: ['Burner'],
      horasSetup: 8, horasEnsaio: 600, horasReport: 16, amostras: 2,
      hourlyRate: 610, custoInsumos: 12800,
      descricao: 'Ciclagem de gás quente com gradiente térmico para avaliar trincas em soldas e cones.'
    },
    {
      id: 'TP-HOT-02', nome: 'Ciclagem térmica acelerada', norma: 'ISO 19453-5', revisao: 'Rev. 02',
      clientes: [],
      area: 'HOT', equipamentoGrupos: ['Burner'],
      horasSetup: 4, horasEnsaio: 336, horasReport: 8, amostras: 2,
      hourlyRate: 610, custoInsumos: 6400,
      descricao: 'Ciclos rápidos de aquecimento e resfriamento para verificar integridade de juntas e revestimentos.'
    },
    {
      id: 'TP-HOT-03', nome: 'Oxidação isotérmica de longa duração', norma: 'ASTM G54', revisao: 'Rev. 01',
      clientes: [],
      area: 'HOT', equipamentoGrupos: ['Burner'],
      horasSetup: 4, horasEnsaio: 1000, horasReport: 8, amostras: 3,
      hourlyRate: 580, custoInsumos: 9800,
      descricao: 'Exposição contínua em alta temperatura para qualificar inox ferrítico e austenítico.'
    },
    {
      id: 'TP-HOT-04', nome: 'Envelhecimento acelerado de catalisador', norma: 'ZDAKW / cliente', revisao: 'Rev. 03',
      clientes: ['CLI-VW', 'CLI-SCA'],
      area: 'HOT', equipamentoGrupos: ['Burner'],
      horasSetup: 6, horasEnsaio: 480, horasReport: 12, amostras: 2,
      hourlyRate: 610, custoInsumos: 16900,
      descricao: 'Envelhecimento térmico do washcoat equivalente à vida útil do veículo.'
    },
    {
      id: 'TP-HOT-05', nome: 'Light-off e eficiência de conversão', norma: 'Cliente / EURO 6', revisao: 'Rev. 05',
      clientes: ['CLI-VW', 'CLI-STL', 'CLI-SCA'],
      area: 'HOT', equipamentoGrupos: ['Burner'],
      horasSetup: 6, horasEnsaio: 48, horasReport: 12, amostras: 2,
      hourlyRate: 610, custoInsumos: 11400,
      descricao: 'Determinação da temperatura de light-off do catalisador e da eficiência pós-envelhecimento.'
    },
    {
      id: 'TP-VIB-01', nome: 'Vibração aleatória 3 eixos', norma: 'ISO 16750-3', revisao: 'Rev. 03',
      clientes: [],
      area: 'AMBOS', equipamentoGrupos: ['Shaker'],
      horasSetup: 8, horasEnsaio: 72, horasReport: 8, amostras: 2,
      hourlyRate: 480, custoInsumos: 5600,
      descricao: 'Perfil PSD por eixo representando a vida em estrada do sistema e dos suportes.'
    },
    {
      id: 'TP-VIB-02', nome: 'Varredura senoidal e busca de ressonância', norma: 'IEC 60068-2-6', revisao: 'Rev. 02',
      clientes: [],
      area: 'AMBOS', equipamentoGrupos: ['Shaker'],
      horasSetup: 4, horasEnsaio: 16, horasReport: 6, amostras: 1,
      hourlyRate: 480, custoInsumos: 3200,
      descricao: 'Levantamento das frequências naturais e amplificação nos pontos de fixação.'
    },
    {
      id: 'TP-MEC-01', nome: 'Fadiga estrutural de suporte', norma: 'Procedimento interno LAB-BRK', revisao: 'Rev. 06',
      clientes: [],
      area: 'AMBOS', equipamentoGrupos: ['MTS'],
      horasSetup: 6, horasEnsaio: 400, horasReport: 10, amostras: 3,
      hourlyRate: 380, custoInsumos: 7600,
      descricao: 'Carregamento cíclico do bracket até a vida-alvo, com monitoramento de rigidez.'
    },
    {
      id: 'TP-MEC-02', nome: 'Durabilidade de flexível (bellows)', norma: 'Procedimento interno LAB-FLEX', revisao: 'Rev. 04',
      clientes: ['CLI-FOR'],
      area: 'HOT', equipamentoGrupos: ['MTS'],
      horasSetup: 6, horasEnsaio: 180, horasReport: 8, amostras: 3,
      hourlyRate: 380, custoInsumos: 7300,
      descricao: 'Deslocamento angular e axial cíclico até 1 milhão de ciclos.'
    },
    {
      id: 'TP-MEC-03', nome: 'Fadiga de coxim / isolador', norma: 'Procedimento interno LAB-HGR', revisao: 'Rev. 02',
      clientes: [],
      area: 'COLD', equipamentoGrupos: ['MTS'],
      horasSetup: 3, horasEnsaio: 120, horasReport: 6, amostras: 5,
      hourlyRate: 320, custoInsumos: 3400,
      descricao: 'Carregamento cíclico do isolador de borracha até perda de rigidez especificada.'
    },
    {
      id: 'TP-MEC-04', nome: 'Tração e alongamento do material', norma: 'ISO 6892-1', revisao: 'Rev. 01',
      clientes: [],
      area: 'AMBOS', equipamentoGrupos: ['MTS'],
      horasSetup: 1, horasEnsaio: 6, horasReport: 3, amostras: 6,
      hourlyRate: 320, custoInsumos: 1500,
      descricao: 'Caracterização mecânica do inox de entrada por lote.'
    },
    {
      id: 'TP-MEC-05', nome: 'Fadiga de solda por flexão', norma: 'ISO 17639 / interno', revisao: 'Rev. 03',
      clientes: [],
      area: 'AMBOS', equipamentoGrupos: ['MTS'],
      horasSetup: 3, horasEnsaio: 96, horasReport: 6, amostras: 4,
      hourlyRate: 320, custoInsumos: 4100,
      descricao: 'Flexão alternada no cordão de solda para levantar a curva S-N da junta.'
    },
    {
      id: 'TP-ACU-01', nome: 'Perda de transmissão acústica (TL)', norma: 'ISO 11820', revisao: 'Rev. 02',
      clientes: ['CLI-FOR'],
      area: 'COLD', equipamentoGrupos: ['LMS / PTA'],
      horasSetup: 4, horasEnsaio: 16, horasReport: 8, amostras: 1,
      hourlyRate: 560, custoInsumos: 6100,
      descricao: 'Medição de atenuação do silencioso em banco, por banda de terço de oitava.'
    },
    {
      id: 'TP-ACU-02', nome: 'Ruído de boca de escape e análise de ordens', norma: 'ISO 362 / interno', revisao: 'Rev. 04',
      clientes: ['CLI-STL', 'CLI-VW'],
      area: 'COLD', equipamentoGrupos: ['LMS / PTA', 'Dynamometer'],
      horasSetup: 6, horasEnsaio: 24, horasReport: 12, amostras: 1,
      hourlyRate: 1510, custoInsumos: 9200,
      descricao: 'Nível sonoro na saída e conteúdo de ordens do motor com o sistema montado.'
    },
    {
      id: 'TP-FLW-01', nome: 'Perda de carga (backpressure)', norma: 'SAE J1544', revisao: 'Rev. 03',
      clientes: [],
      area: 'AMBOS', equipamentoGrupos: ['ColdFlow'],
      horasSetup: 2, horasEnsaio: 8, horasReport: 4, amostras: 1,
      hourlyRate: 240, custoInsumos: 1800,
      descricao: 'Levantamento da curva de contrapressão em função da vazão.'
    },
    {
      id: 'TP-FLW-02', nome: 'Uniformidade de fluxo no substrato', norma: 'Procedimento interno LAB-UI', revisao: 'Rev. 02',
      clientes: ['CLI-VW', 'CLI-STL'],
      area: 'HOT', equipamentoGrupos: ['ColdFlow'],
      horasSetup: 4, horasEnsaio: 12, horasReport: 6, amostras: 1,
      hourlyRate: 240, custoInsumos: 5300,
      descricao: 'Mapeamento de velocidade na face do substrato e cálculo do índice de uniformidade.'
    },
    {
      id: 'TP-DYN-01', nome: 'Durabilidade em dinamômetro de motor', norma: 'Ciclo de durabilidade do cliente', revisao: 'Rev. 05',
      clientes: ['CLI-VW', 'CLI-STL', 'CLI-SCA'],
      area: 'AMBOS', equipamentoGrupos: ['Dynamometer', 'LMS / PTA'],
      horasSetup: 24, horasEnsaio: 500, horasReport: 24, amostras: 1,
      hourlyRate: 1510, custoInsumos: 28500,
      descricao: 'Sistema completo em motor, reproduzindo o ciclo de durabilidade veicular.'
    },
    {
      id: 'TP-DYN-02', nome: 'Contrapressão e temperatura em ciclo de motor', norma: 'Procedimento interno LAB-ENG', revisao: 'Rev. 02',
      clientes: [],
      area: 'AMBOS', equipamentoGrupos: ['Dynamometer'],
      horasSetup: 12, horasEnsaio: 72, horasReport: 12, amostras: 1,
      hourlyRate: 950, custoInsumos: 13400,
      descricao: 'Instrumentação do sistema em motor para levantar temperatura e contrapressão em carga.'
    }
  ];

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

  TC.data = {
    FASES: FASES,
    FASES_ANTIGAS: FASES_ANTIGAS,
    TIPOS_LTI: TIPOS_LTI,
    AREAS: AREAS,
    PRIORIDADES: PRIORIDADES,
    seed: function () {
      return {
        clientes: JSON.parse(JSON.stringify(CLIENTES)),
        equipamentos: JSON.parse(JSON.stringify(EQUIPAMENTOS)),
        testes: JSON.parse(JSON.stringify(TESTES)),
        pecas: JSON.parse(JSON.stringify(PECAS)),
        demandas: []
      };
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
