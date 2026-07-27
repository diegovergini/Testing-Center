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
    { id: 'CLI-TEN', nome: 'Tenneco / Walker', segmento: 'Tier 1' },
    { id: 'CLI-EBE', nome: 'Eberspächer', segmento: 'Tier 1' },
    { id: 'CLI-VW', nome: 'Volkswagen', segmento: 'OEM' },
    { id: 'CLI-STL', nome: 'Stellantis', segmento: 'OEM' },
    { id: 'CLI-SCA', nome: 'Scania', segmento: 'OEM — Comerciais' }
  ];

  /* posicoes = quantos ensaios o equipamento roda em paralelo.
     continuo = true -> ensaio corre 24 h/dia sem operador.
     diasUteis = dias da semana em que o equipamento opera (0 = domingo). */
  var EQUIPAMENTOS = [
    { id: 'BURNER-1', nome: 'Burner 1', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], custoHora: 610, manutencao: [] },
    { id: 'BURNER-2', nome: 'Burner 2', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], custoHora: 610, manutencao: [] },
    { id: 'BURNER-3', nome: 'Burner 3', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], custoHora: 580, manutencao: [] },
    { id: 'SHAKER', nome: 'Shaker', posicoes: 1, continuo: false, horasDia: 16, diasUteis: [1, 2, 3, 4, 5], custoHora: 480, manutencao: [] },
    { id: 'MTS-1', nome: 'MTS 1', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], custoHora: 380, manutencao: [] },
    { id: 'MTS-2', nome: 'MTS 2', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], custoHora: 380, manutencao: [] },
    { id: 'MTS-3', nome: 'MTS 3', posicoes: 1, continuo: false, horasDia: 16, diasUteis: [1, 2, 3, 4, 5], custoHora: 320, manutencao: [] },
    { id: 'MTS-4', nome: 'MTS 4', posicoes: 1, continuo: false, horasDia: 16, diasUteis: [1, 2, 3, 4, 5], custoHora: 320, manutencao: [] },
    { id: 'LMS-PTA', nome: 'LMS / PTA', posicoes: 1, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], custoHora: 560, manutencao: [] },
    { id: 'COLDFLOW', nome: 'ColdFlow', posicoes: 1, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], custoHora: 240, manutencao: [] },
    { id: 'DYNO', nome: 'Dynamometer', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], custoHora: 950, manutencao: [] }
  ];

  /* Catálogo de procedimentos.
     revisao = revisão vigente do procedimento; acompanha o nome em toda a aplicação.
     custoBase = mão de obra, preparação, instrumentação e insumos (não inclui hora-máquina nem amostras).
     horasSetup + horasEnsaio alimentam tanto o custo quanto o planejamento.
     equipamentoIds = bancadas que o ensaio ocupa ao mesmo tempo; a janela precisa estar
     livre em todas elas simultaneamente.
     clientes = lista vazia significa procedimento padrão do laboratório, exigido por todos.
     O procedimento não é amarrado a fase de projeto: qualquer teste pode rodar em DV, PV ou VAVE. */
  var TESTES = [
    {
      id: 'TP-HOT-01', nome: 'Fadiga termomecânica (TMF)', norma: 'PV 1200 / cliente', revisao: 'Rev. 04',
      clientes: ['CLI-VW', 'CLI-SCA'],
      area: 'HOT', equipamentoIds: ['BURNER-1'],
      horasSetup: 8, horasEnsaio: 600, amostras: 2, custoBase: 12800,
      descricao: 'Ciclagem de gás quente com gradiente térmico para avaliar trincas em soldas e cones.'
    },
    {
      id: 'TP-HOT-02', nome: 'Ciclagem térmica acelerada', norma: 'ISO 19453-5', revisao: 'Rev. 02',
      clientes: [],
      area: 'HOT', equipamentoIds: ['BURNER-2'],
      horasSetup: 4, horasEnsaio: 336, amostras: 2, custoBase: 6400,
      descricao: 'Ciclos rápidos de aquecimento e resfriamento para verificar integridade de juntas e revestimentos.'
    },
    {
      id: 'TP-HOT-03', nome: 'Oxidação isotérmica de longa duração', norma: 'ASTM G54', revisao: 'Rev. 01',
      clientes: [],
      area: 'HOT', equipamentoIds: ['BURNER-3'],
      horasSetup: 4, horasEnsaio: 1000, amostras: 3, custoBase: 9800,
      descricao: 'Exposição contínua em alta temperatura para qualificar inox ferrítico e austenítico.'
    },
    {
      id: 'TP-HOT-04', nome: 'Envelhecimento acelerado de catalisador', norma: 'ZDAKW / cliente', revisao: 'Rev. 03',
      clientes: ['CLI-VW', 'CLI-SCA'],
      area: 'HOT', equipamentoIds: ['BURNER-1'],
      horasSetup: 6, horasEnsaio: 480, amostras: 2, custoBase: 16900,
      descricao: 'Envelhecimento térmico do washcoat equivalente à vida útil do veículo.'
    },
    {
      id: 'TP-HOT-05', nome: 'Light-off e eficiência de conversão', norma: 'Cliente / EURO 6', revisao: 'Rev. 05',
      clientes: ['CLI-VW', 'CLI-STL', 'CLI-SCA'],
      area: 'HOT', equipamentoIds: ['BURNER-2'],
      horasSetup: 6, horasEnsaio: 48, amostras: 2, custoBase: 11400,
      descricao: 'Determinação da temperatura de light-off do catalisador e da eficiência pós-envelhecimento.'
    },
    {
      id: 'TP-VIB-01', nome: 'Vibração aleatória 3 eixos', norma: 'ISO 16750-3', revisao: 'Rev. 03',
      clientes: [],
      area: 'AMBOS', equipamentoIds: ['SHAKER'],
      horasSetup: 8, horasEnsaio: 72, amostras: 2, custoBase: 5600,
      descricao: 'Perfil PSD por eixo representando a vida em estrada do sistema e dos suportes.'
    },
    {
      id: 'TP-VIB-02', nome: 'Varredura senoidal e busca de ressonância', norma: 'IEC 60068-2-6', revisao: 'Rev. 02',
      clientes: [],
      area: 'AMBOS', equipamentoIds: ['SHAKER'],
      horasSetup: 4, horasEnsaio: 16, amostras: 1, custoBase: 3200,
      descricao: 'Levantamento das frequências naturais e amplificação nos pontos de fixação.'
    },
    {
      id: 'TP-MEC-01', nome: 'Fadiga estrutural de suporte', norma: 'Procedimento interno LAB-BRK', revisao: 'Rev. 06',
      clientes: [],
      area: 'AMBOS', equipamentoIds: ['MTS-1'],
      horasSetup: 6, horasEnsaio: 400, amostras: 3, custoBase: 7600,
      descricao: 'Carregamento cíclico do bracket até a vida-alvo, com monitoramento de rigidez.'
    },
    {
      id: 'TP-MEC-02', nome: 'Durabilidade de flexível (bellows)', norma: 'Procedimento interno LAB-FLEX', revisao: 'Rev. 04',
      clientes: ['CLI-FOR', 'CLI-TEN'],
      area: 'HOT', equipamentoIds: ['MTS-2'],
      horasSetup: 6, horasEnsaio: 180, amostras: 3, custoBase: 7300,
      descricao: 'Deslocamento angular e axial cíclico até 1 milhão de ciclos.'
    },
    {
      id: 'TP-MEC-03', nome: 'Fadiga de coxim / isolador', norma: 'Procedimento interno LAB-HGR', revisao: 'Rev. 02',
      clientes: ['CLI-EBE'],
      area: 'COLD', equipamentoIds: ['MTS-3'],
      horasSetup: 3, horasEnsaio: 120, amostras: 5, custoBase: 3400,
      descricao: 'Carregamento cíclico do isolador de borracha até perda de rigidez especificada.'
    },
    {
      id: 'TP-MEC-04', nome: 'Tração e alongamento do material', norma: 'ISO 6892-1', revisao: 'Rev. 01',
      clientes: [],
      area: 'AMBOS', equipamentoIds: ['MTS-4'],
      horasSetup: 1, horasEnsaio: 6, amostras: 6, custoBase: 1500,
      descricao: 'Caracterização mecânica do inox de entrada por lote.'
    },
    {
      id: 'TP-MEC-05', nome: 'Fadiga de solda por flexão', norma: 'ISO 17639 / interno', revisao: 'Rev. 03',
      clientes: [],
      area: 'AMBOS', equipamentoIds: ['MTS-4'],
      horasSetup: 3, horasEnsaio: 96, amostras: 4, custoBase: 4100,
      descricao: 'Flexão alternada no cordão de solda para levantar a curva S-N da junta.'
    },
    {
      id: 'TP-ACU-01', nome: 'Perda de transmissão acústica (TL)', norma: 'ISO 11820', revisao: 'Rev. 02',
      clientes: ['CLI-FOR', 'CLI-TEN', 'CLI-EBE'],
      area: 'COLD', equipamentoIds: ['LMS-PTA'],
      horasSetup: 4, horasEnsaio: 16, amostras: 1, custoBase: 6100,
      descricao: 'Medição de atenuação do silencioso em banco, por banda de terço de oitava.'
    },
    {
      id: 'TP-ACU-02', nome: 'Ruído de boca de escape e análise de ordens', norma: 'ISO 362 / interno', revisao: 'Rev. 04',
      clientes: ['CLI-STL', 'CLI-VW'],
      area: 'COLD', equipamentoIds: ['LMS-PTA', 'DYNO'],
      horasSetup: 6, horasEnsaio: 24, amostras: 1, custoBase: 9200,
      descricao: 'Nível sonoro na saída e conteúdo de ordens do motor com o sistema montado.'
    },
    {
      id: 'TP-FLW-01', nome: 'Perda de carga (backpressure)', norma: 'SAE J1544', revisao: 'Rev. 03',
      clientes: [],
      area: 'AMBOS', equipamentoIds: ['COLDFLOW'],
      horasSetup: 2, horasEnsaio: 8, amostras: 1, custoBase: 1800,
      descricao: 'Levantamento da curva de contrapressão em função da vazão.'
    },
    {
      id: 'TP-FLW-02', nome: 'Uniformidade de fluxo no substrato', norma: 'Procedimento interno LAB-UI', revisao: 'Rev. 02',
      clientes: ['CLI-VW', 'CLI-STL'],
      area: 'HOT', equipamentoIds: ['COLDFLOW'],
      horasSetup: 4, horasEnsaio: 12, amostras: 1, custoBase: 5300,
      descricao: 'Mapeamento de velocidade na face do substrato e cálculo do índice de uniformidade.'
    },
    {
      id: 'TP-DYN-01', nome: 'Durabilidade em dinamômetro de motor', norma: 'Ciclo de durabilidade do cliente', revisao: 'Rev. 05',
      clientes: ['CLI-VW', 'CLI-STL', 'CLI-SCA'],
      area: 'AMBOS', equipamentoIds: ['DYNO', 'LMS-PTA'],
      horasSetup: 24, horasEnsaio: 500, amostras: 1, custoBase: 28500,
      descricao: 'Sistema completo em motor, reproduzindo o ciclo de durabilidade veicular.'
    },
    {
      id: 'TP-DYN-02', nome: 'Contrapressão e temperatura em ciclo de motor', norma: 'Procedimento interno LAB-ENG', revisao: 'Rev. 02',
      clientes: [],
      area: 'AMBOS', equipamentoIds: ['DYNO'],
      horasSetup: 12, horasEnsaio: 72, amostras: 1, custoBase: 13400,
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
