/* Dados de partida: clientes, fases de projeto, equipamentos, catálogo de testes e peças.
   Tudo é editável na aplicação — isto é apenas o estado inicial. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});

  /* Fases de projeto. */
  var FASES = [
    { id: 'DV', nome: 'DV — Design Validation', descricao: 'Validação de projeto com protótipos' },
    { id: 'PV', nome: 'PV — Product Validation', descricao: 'Validação com peças de ferramental definitivo' },
    { id: 'VAVE', nome: 'VAVE', descricao: 'Revalidação após mudança de material, processo ou custo' }
  ];

  /* Fases de versões anteriores, convertidas ao carregar dados já salvos. */
  var FASES_ANTIGAS = { CONCEITO: 'DV', PPAP: 'PV', SERIE: 'VAVE' };

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

  /* positions = quantos ensaios o equipamento roda em paralelo.
     continuo = true -> ensaio corre 24 h/dia sem operador (câmaras, bancos de gás).
     diasUteis = dias da semana em que o equipamento opera (0 = domingo). */
  var EQUIPAMENTOS = [
    { id: 'SHK-01', nome: 'Shaker eletrodinâmico 3 eixos', posicoes: 1, continuo: false, horasDia: 16, diasUteis: [1, 2, 3, 4, 5], custoHora: 480, manutencao: [] },
    { id: 'SHK-02', nome: 'Shaker com câmara térmica (vibração a quente)', posicoes: 1, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], custoHora: 690, manutencao: [] },
    { id: 'HGB-01', nome: 'Banco de gás quente (burner rig)', posicoes: 2, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], custoHora: 610, manutencao: [] },
    { id: 'TSC-01', nome: 'Câmara de choque térmico', posicoes: 2, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], custoHora: 290, manutencao: [] },
    { id: 'CCT-01', nome: 'Câmara de corrosão cíclica (VDA / ASTM)', posicoes: 6, continuo: true, horasDia: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6], custoHora: 150, manutencao: [] },
    { id: 'RDS-01', nome: 'Simulador de estrada 4 postes', posicoes: 1, continuo: false, horasDia: 16, diasUteis: [1, 2, 3, 4, 5], custoHora: 820, manutencao: [] },
    { id: 'FLW-01', nome: 'Banco de fluxo / perda de carga', posicoes: 1, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], custoHora: 240, manutencao: [] },
    { id: 'ACU-01', nome: 'Câmara semi-anecoica', posicoes: 1, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], custoHora: 560, manutencao: [] },
    { id: 'LEK-01', nome: 'Bancada de estanqueidade (hélio)', posicoes: 2, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], custoHora: 130, manutencao: [] },
    { id: 'UTM-01', nome: 'Máquina universal de ensaios', posicoes: 1, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], custoHora: 180, manutencao: [] },
    { id: 'GRV-01', nome: 'Câmara de gravelometria', posicoes: 1, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], custoHora: 200, manutencao: [] },
    { id: 'CMM-01', nome: 'Máquina de medição por coordenadas', posicoes: 1, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], custoHora: 210, manutencao: [] },
    { id: 'MET-01', nome: 'Laboratório metalográfico', posicoes: 2, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], custoHora: 160, manutencao: [] }
  ];

  /* Catálogo de procedimentos.
     custoBase = mão de obra, preparação, instrumentação e insumos (não inclui hora-máquina nem amostras).
     horasSetup + horasEnsaio alimentam tanto o custo quanto o planejamento.
     clientes = lista vazia significa procedimento padrão do laboratório, exigido por todos. */
  var TESTES = [
    {
      id: 'TP-HOT-01', nome: 'Fadiga termomecânica (TMF)', norma: 'PV 1200 / cliente',
      clientes: ['CLI-VW', 'CLI-SCA'],
      area: 'HOT', equipamentoId: 'HGB-01', fases: ['DV', 'PV'],
      horasSetup: 8, horasEnsaio: 600, amostras: 2, custoBase: 12800,
      descricao: 'Ciclagem de gás quente com gradiente térmico para avaliar trincas em soldas e cones.'
    },
    {
      id: 'TP-HOT-02', nome: 'Choque térmico acelerado', norma: 'ISO 19453-5',
      clientes: [],
      area: 'HOT', equipamentoId: 'TSC-01', fases: ['DV', 'PV'],
      horasSetup: 4, horasEnsaio: 336, amostras: 2, custoBase: 6400,
      descricao: 'Ciclos rápidos entre −40 °C e 950 °C para verificar integridade de juntas e revestimentos.'
    },
    {
      id: 'TP-HOT-03', nome: 'Vibração a quente (hot vibration)', norma: 'LV 124 / cliente',
      clientes: ['CLI-VW', 'CLI-FOR'],
      area: 'HOT', equipamentoId: 'SHK-02', fases: ['DV', 'PV'],
      horasSetup: 12, horasEnsaio: 240, amostras: 2, custoBase: 15200,
      descricao: 'Vibração aleatória com peça aquecida, reproduzindo o carregamento do coletor em serviço.'
    },
    {
      id: 'TP-HOT-04', nome: 'Oxidação isotérmica de longa duração', norma: 'ASTM G54',
      clientes: [],
      area: 'HOT', equipamentoId: 'HGB-01', fases: ['DV', 'VAVE'],
      horasSetup: 4, horasEnsaio: 1000, amostras: 3, custoBase: 9800,
      descricao: 'Exposição contínua em alta temperatura para qualificar inox ferrítico/austenítico.'
    },
    {
      id: 'TP-HOT-05', nome: 'Durabilidade de flexível (bellows)', norma: 'Procedimento interno LAB-FLEX',
      clientes: ['CLI-FOR', 'CLI-TEN'],
      area: 'HOT', equipamentoId: 'SHK-02', fases: ['DV', 'PV'],
      horasSetup: 6, horasEnsaio: 180, amostras: 3, custoBase: 7300,
      descricao: 'Deslocamento angular e axial cíclico a quente até 1 milhão de ciclos.'
    },
    {
      id: 'TP-HOT-06', nome: 'Light-off e eficiência de conversão', norma: 'Cliente / EURO 6',
      clientes: ['CLI-VW', 'CLI-STL', 'CLI-SCA'],
      area: 'HOT', equipamentoId: 'HGB-01', fases: ['DV', 'PV'],
      horasSetup: 6, horasEnsaio: 48, amostras: 2, custoBase: 11400,
      descricao: 'Determinação da temperatura de light-off do catalisador e da eficiência pós-envelhecimento.'
    },
    {
      id: 'TP-HOT-07', nome: 'Envelhecimento acelerado de catalisador', norma: 'ZDAKW / cliente',
      clientes: ['CLI-VW', 'CLI-SCA'],
      area: 'HOT', equipamentoId: 'HGB-01', fases: ['DV', 'PV'],
      horasSetup: 6, horasEnsaio: 480, amostras: 2, custoBase: 16900,
      descricao: 'Envelhecimento térmico do washcoat equivalente à vida útil do veículo.'
    },
    {
      id: 'TP-COL-01', nome: 'Vibração aleatória 3 eixos', norma: 'ISO 16750-3',
      clientes: [],
      area: 'COLD', equipamentoId: 'SHK-01', fases: ['DV', 'PV'],
      horasSetup: 8, horasEnsaio: 72, amostras: 2, custoBase: 5600,
      descricao: 'Perfil PSD por eixo representando a vida em estrada do silencioso e suportes.'
    },
    {
      id: 'TP-COL-02', nome: 'Corrosão cíclica VDA 233-102', norma: 'VDA 233-102',
      clientes: ['CLI-VW', 'CLI-STL', 'CLI-EBE'],
      area: 'COLD', equipamentoId: 'CCT-01', fases: ['DV', 'PV', 'VAVE'],
      horasSetup: 3, horasEnsaio: 1512, amostras: 3, custoBase: 4200,
      descricao: 'Doze semanas de ciclos de salmoura, umidade e frio para avaliar aluminizado e inox.'
    },
    {
      id: 'TP-COL-03', nome: 'Névoa salina neutra 480 h', norma: 'ASTM B117',
      clientes: [],
      area: 'COLD', equipamentoId: 'CCT-01', fases: ['DV', 'VAVE'],
      horasSetup: 2, horasEnsaio: 480, amostras: 3, custoBase: 2400,
      descricao: 'Ensaio de referência para revestimentos e proteção de solda.'
    },
    {
      id: 'TP-COL-04', nome: 'Perda de carga (backpressure)', norma: 'SAE J1544',
      clientes: [],
      area: 'COLD', equipamentoId: 'FLW-01', fases: ['DV', 'PV', 'VAVE'],
      horasSetup: 2, horasEnsaio: 8, amostras: 1, custoBase: 1800,
      descricao: 'Levantamento da curva de contrapressão em função da vazão.'
    },
    {
      id: 'TP-COL-05', nome: 'Perda de transmissão acústica (TL)', norma: 'ISO 11820',
      clientes: ['CLI-FOR', 'CLI-TEN', 'CLI-EBE'],
      area: 'COLD', equipamentoId: 'ACU-01', fases: ['DV', 'PV', 'VAVE'],
      horasSetup: 4, horasEnsaio: 16, amostras: 1, custoBase: 6100,
      descricao: 'Medição de atenuação do silencioso em banco, por banda de terço de oitava.'
    },
    {
      id: 'TP-COL-06', nome: 'Ruído de passagem e tailpipe noise', norma: 'ISO 362',
      clientes: ['CLI-STL', 'CLI-VW'],
      area: 'COLD', equipamentoId: 'ACU-01', fases: ['PV', 'VAVE'],
      horasSetup: 6, horasEnsaio: 24, amostras: 1, custoBase: 9200,
      descricao: 'Verificação do nível sonoro do sistema completo montado no veículo.'
    },
    {
      id: 'TP-COL-07', nome: 'Gravelometria (impacto de pedras)', norma: 'ISO 20567-1',
      clientes: ['CLI-TEN', 'CLI-STL'],
      area: 'COLD', equipamentoId: 'GRV-01', fases: ['DV', 'PV'],
      horasSetup: 2, horasEnsaio: 12, amostras: 2, custoBase: 2900,
      descricao: 'Projeção de granalha para avaliar resistência do revestimento externo e da ponteira.'
    },
    {
      id: 'TP-COL-08', nome: 'Fadiga de coxim / isolador', norma: 'Procedimento interno LAB-HGR',
      clientes: ['CLI-EBE'],
      area: 'COLD', equipamentoId: 'UTM-01', fases: ['DV', 'PV'],
      horasSetup: 3, horasEnsaio: 120, amostras: 5, custoBase: 3400,
      descricao: 'Carregamento cíclico do isolador de borracha até perda de rigidez especificada.'
    },
    {
      id: 'TP-AMB-01', nome: 'Estanqueidade por hélio', norma: 'Procedimento interno LAB-LEAK',
      clientes: [],
      area: 'AMBOS', equipamentoId: 'LEK-01', fases: ['DV', 'PV', 'VAVE'],
      horasSetup: 1, horasEnsaio: 4, amostras: 3, custoBase: 900,
      descricao: 'Detecção de vazamento em soldas e flanges com traçador de hélio.'
    },
    {
      id: 'TP-AMB-02', nome: 'Durabilidade em simulador de estrada', norma: 'Perfil de pista do cliente',
      clientes: ['CLI-VW', 'CLI-STL', 'CLI-SCA'],
      area: 'AMBOS', equipamentoId: 'RDS-01', fases: ['PV'],
      horasSetup: 24, horasEnsaio: 320, amostras: 1, custoBase: 28500,
      descricao: 'Sistema completo montado no veículo, reproduzindo o ciclo de durabilidade de pista.'
    },
    {
      id: 'TP-AMB-03', nome: 'Análise dimensional em CMM', norma: 'Desenho do cliente',
      clientes: [],
      area: 'AMBOS', equipamentoId: 'CMM-01', fases: ['PV', 'VAVE'],
      horasSetup: 3, horasEnsaio: 10, amostras: 5, custoBase: 2100,
      descricao: 'Layout dimensional completo para o dossiê de PPAP.'
    },
    {
      id: 'TP-AMB-04', nome: 'Análise metalográfica de solda', norma: 'ISO 17639',
      clientes: [],
      area: 'AMBOS', equipamentoId: 'MET-01', fases: ['DV', 'PV'],
      horasSetup: 2, horasEnsaio: 16, amostras: 4, custoBase: 3100,
      descricao: 'Macrografia e micrografia para penetração, porosidade e tamanho de grão.'
    },
    {
      id: 'TP-AMB-05', nome: 'Tração e alongamento do material', norma: 'ISO 6892-1',
      clientes: [],
      area: 'AMBOS', equipamentoId: 'UTM-01', fases: ['DV', 'VAVE'],
      horasSetup: 1, horasEnsaio: 6, amostras: 6, custoBase: 1500,
      descricao: 'Caracterização mecânica do inox de entrada por lote.'
    }
  ];

  /* Peças em validação. dataAmostras = quando o lote de amostras chega ao laboratório;
     nenhum ensaio pode começar antes dessa data. */
  var PECAS = [
    { id: 'PC-001', nome: 'Coletor de escape 1.0 TSI', clienteId: 'CLI-VW', programa: 'VW MQB-A0 / EA211', area: 'HOT', dataAmostras: '2026-08-03', quantidade: 8, custoAmostra: 3800 },
    { id: 'PC-002', nome: 'Catalisador close-coupled', clienteId: 'CLI-VW', programa: 'VW MQB-A0 / EA211', area: 'HOT', dataAmostras: '2026-08-17', quantidade: 6, custoAmostra: 5400 },
    { id: 'PC-003', nome: 'Downpipe com flexível', clienteId: 'CLI-FOR', programa: 'Fiat 270 Hybrid', area: 'HOT', dataAmostras: '2026-08-10', quantidade: 10, custoAmostra: 2200 },
    { id: 'PC-004', nome: 'Silencioso traseiro', clienteId: 'CLI-FOR', programa: 'Fiat 270 Hybrid', area: 'COLD', dataAmostras: '2026-08-24', quantidade: 8, custoAmostra: 1650 },
    { id: 'PC-005', nome: 'Ressonador intermediário', clienteId: 'CLI-TEN', programa: 'Stellantis P1H', area: 'COLD', dataAmostras: '2026-09-07', quantidade: 12, custoAmostra: 980 },
    { id: 'PC-006', nome: 'Ponteira cromada dupla', clienteId: 'CLI-TEN', programa: 'Stellantis P1H', area: 'COLD', dataAmostras: '2026-09-14', quantidade: 10, custoAmostra: 740 },
    { id: 'PC-007', nome: 'Módulo DPF pesado', clienteId: 'CLI-SCA', programa: 'Scania Euro 6 Step E', area: 'HOT', dataAmostras: '2026-09-21', quantidade: 4, custoAmostra: 14200 },
    { id: 'PC-008', nome: 'Coxim de suspensão do sistema', clienteId: 'CLI-EBE', programa: 'GM Gemini BEV Range Ext.', area: 'COLD', dataAmostras: '2026-08-31', quantidade: 30, custoAmostra: 120 },
    { id: 'PC-009', nome: 'Tubo intermediário conformado', clienteId: 'CLI-STL', programa: 'Stellantis SmallWide', area: 'COLD', dataAmostras: '2026-10-05', quantidade: 10, custoAmostra: 860 }
  ];

  TC.data = {
    FASES: FASES,
    FASES_ANTIGAS: FASES_ANTIGAS,
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
