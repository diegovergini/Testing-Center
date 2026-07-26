/* Testing Center — base de dados inicial do laboratório de validação de sistemas de exaustão.
   O catálogo por cliente é montado a partir de procedimentos-base + uma matriz por cliente,
   de modo que cada cliente carrega sua própria norma, fases e fatores de custo/duração. */
(function (root, factory) {
  var api = factory(
    typeof module === 'object' && module.exports ? require('./00-util.js') : root.TC.util
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.TC = root.TC || {}).seed = api;
})(typeof self !== 'undefined' ? self : this, function (util) {
  'use strict';

  var CLIENTES = [
    { id: 'STL', nome: 'Stellantis', segmento: 'Leves', cor: '#5b8def' },
    { id: 'VW', nome: 'Volkswagen', segmento: 'Leves', cor: '#3fb27f' },
    { id: 'GM', nome: 'General Motors', segmento: 'Leves', cor: '#e2a03f' },
    { id: 'TOY', nome: 'Toyota', segmento: 'Leves', cor: '#e35d6a' },
    { id: 'SCA', nome: 'Scania', segmento: 'Pesados', cor: '#9b6bde' },
    { id: 'MB', nome: 'Mercedes-Benz', segmento: 'Pesados', cor: '#4bb8c9' }
  ];

  var TIPOS_PECA = [
    { id: 'COL', nome: 'Coletor de escape' },
    { id: 'CAT', nome: 'Catalisador' },
    { id: 'DPF', nome: 'Filtro de particulados (DPF/GPF)' },
    { id: 'SCR', nome: 'Sistema SCR / dosador' },
    { id: 'SIL', nome: 'Silencioso' },
    { id: 'TUB', nome: 'Tubulação / downpipe' },
    { id: 'FLX', nome: 'Junta flexível' },
    { id: 'PON', nome: 'Ponteira' },
    { id: 'SUP', nome: 'Suportes e coxins' },
    { id: 'ISO', nome: 'Isolamento térmico' },
    { id: 'SEN', nome: 'Sensores e bossas' },
    { id: 'SIS', nome: 'Sistema completo' }
  ];

  var FASES = [
    { id: 'P0', nome: 'Conceito / Protótipo', ordem: 1 },
    { id: 'DV', nome: 'DV — Design Validation', ordem: 2 },
    { id: 'PV', nome: 'PV — Product Validation', ordem: 3 },
    { id: 'PP', nome: 'PPAP / Aprovação', ordem: 4 },
    { id: 'SR', nome: 'Série / Auditoria', ordem: 5 }
  ];

  /* Um "tipo" de equipamento pode ter várias unidades físicas; o planejador
     escolhe a unidade que libera o ensaio mais cedo. */
  var TIPOS_EQUIP = [
    { id: 'BDT', nome: 'Bancada de durabilidade térmica' },
    { id: 'SHK', nome: 'Shaker eletrodinâmico' },
    { id: 'HSK', nome: 'Bancada de vibração a quente' },
    { id: 'CNS', nome: 'Câmara de névoa salina' },
    { id: 'CCL', nome: 'Câmara de ciclo climático' },
    { id: 'BFL', nome: 'Banco de fluxo / contrapressão' },
    { id: 'EST', nome: 'Bancada de estanqueidade' },
    { id: 'ACU', nome: 'Câmara semianecoica' },
    { id: 'DIN', nome: 'Dinamômetro de motor' },
    { id: 'MUE', nome: 'Máquina universal de ensaios' },
    { id: 'MET', nome: 'Laboratório metalúrgico' },
    { id: 'BFX', nome: 'Bancada de fadiga de flexível' },
    { id: 'MOD', nome: 'Sistema de análise modal' },
    { id: 'PST', nome: 'Pista de prova / veículo' }
  ];

  /* capacidade = ensaios simultâneos na unidade; horasPorDia = janela produtiva;
     diasUteis = true significa que o ensaio pausa em fim de semana. */
  var EQUIPAMENTOS = [
    { id: 'BDT-01', nome: 'Burner rig hot-end #1', tipo: 'BDT', capacidade: 1, horasPorDia: 24, diasUteis: false, custoHora: 320, manutencao: [] },
    { id: 'BDT-02', nome: 'Burner rig hot-end #2', tipo: 'BDT', capacidade: 1, horasPorDia: 24, diasUteis: false, custoHora: 320, manutencao: [{ inicio: '+35', fim: '+45', motivo: 'Revisão do queimador' }] },
    { id: 'SHK-01', nome: 'Shaker eletrodinâmico 60 kN', tipo: 'SHK', capacidade: 1, horasPorDia: 20, diasUteis: false, custoHora: 260, manutencao: [] },
    { id: 'HSK-01', nome: 'Hot shaker (vibração a quente)', tipo: 'HSK', capacidade: 1, horasPorDia: 24, diasUteis: false, custoHora: 410, manutencao: [] },
    { id: 'CNS-01', nome: 'Câmara de névoa salina 1000 L', tipo: 'CNS', capacidade: 4, horasPorDia: 24, diasUteis: false, custoHora: 90, manutencao: [] },
    { id: 'CCL-01', nome: 'Câmara de ciclo climático VDA', tipo: 'CCL', capacidade: 3, horasPorDia: 24, diasUteis: false, custoHora: 140, manutencao: [{ inicio: '+120', fim: '+127', motivo: 'Calibração anual' }] },
    { id: 'BFL-01', nome: 'Banco de fluxo a frio', tipo: 'BFL', capacidade: 1, horasPorDia: 8, diasUteis: true, custoHora: 180, manutencao: [] },
    { id: 'EST-01', nome: 'Bancada de estanqueidade', tipo: 'EST', capacidade: 2, horasPorDia: 8, diasUteis: true, custoHora: 110, manutencao: [] },
    { id: 'ACU-01', nome: 'Câmara semianecoica', tipo: 'ACU', capacidade: 1, horasPorDia: 8, diasUteis: true, custoHora: 380, manutencao: [] },
    { id: 'DIN-01', nome: 'Dinamômetro de motor #1', tipo: 'DIN', capacidade: 1, horasPorDia: 20, diasUteis: false, custoHora: 640, manutencao: [] },
    { id: 'DIN-02', nome: 'Dinamômetro de motor #2', tipo: 'DIN', capacidade: 1, horasPorDia: 20, diasUteis: false, custoHora: 640, manutencao: [{ inicio: '+70', fim: '+82', motivo: 'Troca de motor de ensaio' }] },
    { id: 'MUE-01', nome: 'Máquina universal 100 kN', tipo: 'MUE', capacidade: 1, horasPorDia: 8, diasUteis: true, custoHora: 150, manutencao: [] },
    { id: 'MET-01', nome: 'Laboratório metalúrgico', tipo: 'MET', capacidade: 3, horasPorDia: 8, diasUteis: true, custoHora: 130, manutencao: [] },
    { id: 'BFX-01', nome: 'Bancada de fadiga de flexível #1', tipo: 'BFX', capacidade: 2, horasPorDia: 24, diasUteis: false, custoHora: 170, manutencao: [] },
    { id: 'BFX-02', nome: 'Bancada de fadiga de flexível #2', tipo: 'BFX', capacidade: 2, horasPorDia: 24, diasUteis: false, custoHora: 170, manutencao: [] },
    { id: 'MOD-01', nome: 'Análise modal (LMS + martelo)', tipo: 'MOD', capacidade: 1, horasPorDia: 8, diasUteis: true, custoHora: 210, manutencao: [] },
    { id: 'PST-01', nome: 'Pista de prova / veículo instrumentado', tipo: 'PST', capacidade: 2, horasPorDia: 10, diasUteis: true, custoHora: 520, manutencao: [] }
  ];

  /* Procedimentos-base: o "o quê" do ensaio, independente do cliente.
     duracaoHoras e custos referem-se a UMA corrida com amostrasPorCorrida peças. */
  var PROCEDIMENTOS = [
    { id: 'FAD-TERM', nome: 'Fadiga térmica — ciclagem hot-end', pecas: ['COL', 'CAT', 'DPF', 'TUB', 'SIS'], equip: 'BDT', horas: 480, amostrasPorCorrida: 1, custoSetup: 12000, custoAmostra: 8500, criticidade: 'Crítica' },
    { id: 'CHQ-TERM', nome: 'Choque térmico com resfriamento forçado', pecas: ['COL', 'CAT', 'TUB'], equip: 'BDT', horas: 240, amostrasPorCorrida: 1, custoSetup: 8000, custoAmostra: 6000, criticidade: 'Alta' },
    { id: 'VIB-RND', nome: 'Vibração aleatória e senoidal (PSD)', pecas: ['SIL', 'TUB', 'SUP', 'SEN', 'SIS'], equip: 'SHK', horas: 72, amostrasPorCorrida: 1, custoSetup: 5000, custoAmostra: 3200, criticidade: 'Alta' },
    { id: 'VIB-QNT', nome: 'Fadiga vibratória a quente', pecas: ['COL', 'CAT', 'SIS'], equip: 'HSK', horas: 300, amostrasPorCorrida: 1, custoSetup: 14000, custoAmostra: 9500, criticidade: 'Crítica' },
    { id: 'COR-NSS', nome: 'Corrosão em névoa salina (ASTM B117)', pecas: ['TUB', 'SIL', 'PON', 'SUP', 'ISO'], equip: 'CNS', horas: 720, amostrasPorCorrida: 6, custoSetup: 3000, custoAmostra: 900, criticidade: 'Média' },
    { id: 'COR-CIC', nome: 'Corrosão cíclica acelerada', pecas: ['TUB', 'SIL', 'PON', 'SUP', 'FLX'], equip: 'CCL', horas: 1008, amostrasPorCorrida: 6, custoSetup: 4500, custoAmostra: 1400, criticidade: 'Alta' },
    { id: 'CTP-FLW', nome: 'Contrapressão e perda de carga', pecas: ['CAT', 'DPF', 'SIL', 'SIS'], equip: 'BFL', horas: 6, amostrasPorCorrida: 1, custoSetup: 1200, custoAmostra: 450, criticidade: 'Média' },
    { id: 'EST-LEAK', nome: 'Estanqueidade por queda de pressão', pecas: ['SIS', 'SIL', 'TUB', 'FLX', 'SCR'], equip: 'EST', horas: 4, amostrasPorCorrida: 4, custoSetup: 800, custoAmostra: 180, criticidade: 'Média' },
    { id: 'ACU-NVH', nome: 'Desempenho acústico e ruído de escape', pecas: ['SIL', 'PON', 'SIS'], equip: 'ACU', horas: 16, amostrasPorCorrida: 1, custoSetup: 6500, custoAmostra: 2100, criticidade: 'Alta' },
    { id: 'MOD-FRQ', nome: 'Análise modal e frequências naturais', pecas: ['SIS', 'SUP', 'SIL', 'TUB'], equip: 'MOD', horas: 12, amostrasPorCorrida: 1, custoSetup: 3800, custoAmostra: 1500, criticidade: 'Média' },
    { id: 'FLX-FAD', nome: 'Fadiga de junta flexível (deslocamento angular)', pecas: ['FLX'], equip: 'BFX', horas: 336, amostrasPorCorrida: 2, custoSetup: 5200, custoAmostra: 2600, criticidade: 'Alta' },
    { id: 'CAT-ENV', nome: 'Envelhecimento acelerado de catalisador', pecas: ['CAT', 'DPF'], equip: 'BDT', horas: 600, amostrasPorCorrida: 1, custoSetup: 18000, custoAmostra: 12000, criticidade: 'Crítica' },
    { id: 'CAT-EFI', nome: 'Eficiência de conversão e light-off', pecas: ['CAT'], equip: 'DIN', horas: 40, amostrasPorCorrida: 1, custoSetup: 15000, custoAmostra: 7400, criticidade: 'Crítica' },
    { id: 'DPF-REG', nome: 'Carregamento de fuligem e regeneração', pecas: ['DPF'], equip: 'DIN', horas: 120, amostrasPorCorrida: 1, custoSetup: 22000, custoAmostra: 9800, criticidade: 'Crítica' },
    { id: 'SCR-DOS', nome: 'Dosagem de ureia e uniformidade de mistura', pecas: ['SCR'], equip: 'DIN', horas: 60, amostrasPorCorrida: 1, custoSetup: 16000, custoAmostra: 6200, criticidade: 'Alta' },
    { id: 'MEC-SUP', nome: 'Fadiga mecânica de suportes e coxins', pecas: ['SUP', 'SIS'], equip: 'MUE', horas: 96, amostrasPorCorrida: 1, custoSetup: 2600, custoAmostra: 1400, criticidade: 'Média' },
    { id: 'MET-SLD', nome: 'Análise metalográfica de solda', pecas: ['SIS', 'TUB', 'COL', 'SIL'], equip: 'MET', horas: 24, amostrasPorCorrida: 3, custoSetup: 1900, custoAmostra: 700, criticidade: 'Média' },
    { id: 'TRA-SLD', nome: 'Tração destrutiva de junta soldada', pecas: ['TUB', 'SUP', 'SIL'], equip: 'MUE', horas: 8, amostrasPorCorrida: 5, custoSetup: 1100, custoAmostra: 260, criticidade: 'Média' },
    { id: 'BUR-PRS', nome: 'Pressão de ruptura (burst)', pecas: ['TUB', 'SIL', 'FLX'], equip: 'MUE', horas: 8, amostrasPorCorrida: 2, custoSetup: 1400, custoAmostra: 620, criticidade: 'Média' },
    { id: 'ISO-TMP', nome: 'Mapeamento térmico e eficiência de isolamento', pecas: ['ISO', 'COL', 'SIS'], equip: 'BDT', horas: 72, amostrasPorCorrida: 1, custoSetup: 5600, custoAmostra: 2400, criticidade: 'Média' },
    { id: 'VEI-DUR', nome: 'Durabilidade em veículo / pista de prova', pecas: ['SIS'], equip: 'PST', horas: 900, amostrasPorCorrida: 1, custoSetup: 45000, custoAmostra: 21000, criticidade: 'Crítica' },
    { id: 'SEN-VID', nome: 'Vida útil de sensor e bossa (ciclagem)', pecas: ['SEN', 'SIS'], equip: 'BDT', horas: 240, amostrasPorCorrida: 2, custoSetup: 4200, custoAmostra: 1800, criticidade: 'Média' },
    { id: 'CON-INT', nome: 'Corrosão interna por condensado', pecas: ['SIL', 'TUB'], equip: 'CCL', horas: 504, amostrasPorCorrida: 4, custoSetup: 3600, custoAmostra: 1200, criticidade: 'Alta' }
  ];

  /* Matriz por cliente: qual procedimento é exigido, sob qual norma e em quais fases.
     fatorCusto / fatorDuracao refletem exigências próprias de cada montadora. */
  var MATRIZ = {
    STL: {
      fatorCusto: 1.00, fatorDuracao: 1.00,
      itens: [
        { base: 'FAD-TERM', norma: 'D45 1734', fases: ['DV', 'PV'] },
        { base: 'CHQ-TERM', norma: 'B21 7110', fases: ['DV'] },
        { base: 'VIB-RND', norma: 'D45 1727', fases: ['DV', 'PV'] },
        { base: 'COR-NSS', norma: 'D17 2028', fases: ['DV', 'PV', 'SR'] },
        { base: 'COR-CIC', norma: 'D17 1058', fases: ['PV'] },
        { base: 'CTP-FLW', norma: 'D45 1015', fases: ['P0', 'DV', 'PV'] },
        { base: 'EST-LEAK', norma: 'D45 1016', fases: ['PV', 'PP', 'SR'] },
        { base: 'ACU-NVH', norma: 'D45 5290', fases: ['P0', 'DV'] },
        { base: 'MOD-FRQ', norma: 'D45 1721', fases: ['P0', 'DV'] },
        { base: 'FLX-FAD', norma: 'D45 1748', fases: ['DV', 'PV'] },
        { base: 'MEC-SUP', norma: 'D45 1750', fases: ['DV'] },
        { base: 'MET-SLD', norma: 'D25 5401', fases: ['PP', 'SR'] },
        { base: 'TRA-SLD', norma: 'D25 5410', fases: ['PP', 'SR'] },
        { base: 'VEI-DUR', norma: 'D45 1800', fases: ['PV'] }
      ]
    },
    VW: {
      fatorCusto: 1.12, fatorDuracao: 1.00,
      itens: [
        { base: 'FAD-TERM', norma: 'PV 1200 / TL 82500', fases: ['DV', 'PV'] },
        { base: 'CHQ-TERM', norma: 'PV 1201', fases: ['DV'] },
        { base: 'VIB-RND', norma: 'PV 3906 / PV 3929', fases: ['DV', 'PV'] },
        { base: 'VIB-QNT', norma: 'PV 3930', fases: ['PV'] },
        { base: 'COR-NSS', norma: 'PV 1210', fases: ['DV', 'PV'] },
        { base: 'COR-CIC', norma: 'VDA 233-102', fases: ['PV', 'SR'] },
        { base: 'CTP-FLW', norma: 'TL 52691', fases: ['P0', 'DV'] },
        { base: 'EST-LEAK', norma: 'PV 3964', fases: ['PP', 'SR'] },
        { base: 'ACU-NVH', norma: 'TL 82121', fases: ['P0', 'DV', 'PV'] },
        { base: 'MOD-FRQ', norma: 'PV 3915', fases: ['P0', 'DV'] },
        { base: 'CAT-ENV', norma: 'PV 1215', fases: ['PV'] },
        { base: 'CAT-EFI', norma: 'TL 82126', fases: ['PV', 'PP'] },
        { base: 'MET-SLD', norma: 'PV 6702', fases: ['PP', 'SR'] },
        { base: 'SEN-VID', norma: 'PV 2005', fases: ['DV'] },
        { base: 'ISO-TMP', norma: 'TL 82530', fases: ['DV', 'PV'] }
      ]
    },
    GM: {
      fatorCusto: 1.05, fatorDuracao: 1.00,
      itens: [
        { base: 'FAD-TERM', norma: 'GMW14650', fases: ['DV', 'PV'] },
        { base: 'CHQ-TERM', norma: 'GMW3103', fases: ['DV'] },
        { base: 'VIB-RND', norma: 'GMW3172', fases: ['DV', 'PV'] },
        { base: 'COR-NSS', norma: 'GMW3286', fases: ['DV'] },
        { base: 'COR-CIC', norma: 'GMW14872', fases: ['DV', 'PV', 'SR'] },
        { base: 'CTP-FLW', norma: 'GMW16026', fases: ['P0', 'DV'] },
        { base: 'EST-LEAK', norma: 'GMW15873', fases: ['PP', 'SR'] },
        { base: 'ACU-NVH', norma: 'GMW15218', fases: ['DV', 'PV'] },
        { base: 'MOD-FRQ', norma: 'GMW3103-M', fases: ['P0', 'DV'] },
        { base: 'MEC-SUP', norma: 'GMW14124', fases: ['DV'] },
        { base: 'TRA-SLD', norma: 'GMW15761', fases: ['PP', 'SR'] },
        { base: 'BUR-PRS', norma: 'GMW16663', fases: ['DV'] },
        { base: 'ISO-TMP', norma: 'GMW16346', fases: ['DV', 'PV'] },
        { base: 'CAT-EFI', norma: 'GMW17010', fases: ['PV', 'PP'] }
      ]
    },
    TOY: {
      fatorCusto: 1.18, fatorDuracao: 1.10,
      itens: [
        { base: 'FAD-TERM', norma: 'TSC7000G', fases: ['DV', 'PV'] },
        { base: 'VIB-RND', norma: 'TSC7203', fases: ['DV', 'PV'] },
        { base: 'VIB-QNT', norma: 'TSC7215', fases: ['PV'] },
        { base: 'COR-NSS', norma: 'TSC7302', fases: ['DV', 'PV'] },
        { base: 'CTP-FLW', norma: 'TSC1503', fases: ['P0', 'DV'] },
        { base: 'EST-LEAK', norma: 'TSC1504', fases: ['PP', 'SR'] },
        { base: 'ACU-NVH', norma: 'TSC7401', fases: ['DV'] },
        { base: 'MOD-FRQ', norma: 'TSC7210', fases: ['P0', 'DV'] },
        { base: 'CAT-EFI', norma: 'TSC7551', fases: ['PV', 'PP'] },
        { base: 'MET-SLD', norma: 'TSC0401', fases: ['PP', 'SR'] },
        { base: 'FLX-FAD', norma: 'TSC7260', fases: ['DV', 'PV'] },
        { base: 'VEI-DUR', norma: 'TSC9000', fases: ['PV'] }
      ]
    },
    SCA: {
      fatorCusto: 1.25, fatorDuracao: 1.40,
      itens: [
        { base: 'FAD-TERM', norma: 'STD4319', fases: ['DV', 'PV'] },
        { base: 'VIB-QNT', norma: 'STD4189', fases: ['PV'] },
        { base: 'VIB-RND', norma: 'STD4185', fases: ['DV'] },
        { base: 'COR-CIC', norma: 'STD4445', fases: ['DV', 'PV'] },
        { base: 'DPF-REG', norma: 'STD4762', fases: ['PV', 'PP'] },
        { base: 'SCR-DOS', norma: 'STD4771', fases: ['DV', 'PV'] },
        { base: 'CTP-FLW', norma: 'STD4102', fases: ['P0', 'DV'] },
        { base: 'EST-LEAK', norma: 'STD4110', fases: ['PP', 'SR'] },
        { base: 'ISO-TMP', norma: 'STD4520', fases: ['DV'] },
        { base: 'MEC-SUP', norma: 'STD4225', fases: ['DV', 'PV'] },
        { base: 'CON-INT', norma: 'STD4478', fases: ['PV'] },
        { base: 'MET-SLD', norma: 'STD4030', fases: ['PP', 'SR'] },
        { base: 'VEI-DUR', norma: 'STD9100', fases: ['PV'] }
      ]
    },
    MB: {
      fatorCusto: 1.30, fatorDuracao: 1.15,
      itens: [
        { base: 'FAD-TERM', norma: 'MBN 10494', fases: ['DV', 'PV'] },
        { base: 'CHQ-TERM', norma: 'MBN 31000', fases: ['DV'] },
        { base: 'VIB-RND', norma: 'MBN 10284', fases: ['DV', 'PV'] },
        { base: 'VIB-QNT', norma: 'MBN 10290', fases: ['PV'] },
        { base: 'COR-CIC', norma: 'MBN 10494-6', fases: ['PV', 'SR'] },
        { base: 'DPF-REG', norma: 'MBN 11031', fases: ['PV'] },
        { base: 'SCR-DOS', norma: 'MBN 11040', fases: ['DV', 'PV'] },
        { base: 'ACU-NVH', norma: 'MBN 10371', fases: ['DV', 'PV'] },
        { base: 'FLX-FAD', norma: 'MBN 10620', fases: ['DV'] },
        { base: 'EST-LEAK', norma: 'MBN 10256', fases: ['PP', 'SR'] },
        { base: 'CAT-ENV', norma: 'MBN 11020', fases: ['PV'] },
        { base: 'MET-SLD', norma: 'DBL 4919', fases: ['PP', 'SR'] },
        { base: 'CON-INT', norma: 'MBN 10500', fases: ['PV'] }
      ]
    }
  };

  function arredondarCusto(v) {
    return Math.round(v / 50) * 50;
  }

  function arredondarHoras(h) {
    return h >= 72 ? Math.round(h / 4) * 4 : Math.round(h);
  }

  /* Expande a matriz em um catálogo plano: uma linha por cliente + procedimento. */
  function montarCatalogo() {
    var base = util.indexarPor(PROCEDIMENTOS);
    var catalogo = [];
    CLIENTES.forEach(function (cliente) {
      var m = MATRIZ[cliente.id];
      if (!m) return;
      m.itens.forEach(function (item) {
        var p = base[item.base];
        if (!p) return;
        catalogo.push({
          id: cliente.id + '-' + p.id,
          clienteId: cliente.id,
          procedimentoId: p.id,
          nome: p.nome,
          norma: item.norma,
          pecas: item.pecas || p.pecas,
          fases: item.fases,
          equipTipo: p.equip,
          duracaoHoras: arredondarHoras(p.horas * (item.fatorDuracao || m.fatorDuracao)),
          amostrasPorCorrida: p.amostrasPorCorrida,
          amostrasPadrao: p.amostrasPorCorrida,
          custoSetup: arredondarCusto(p.custoSetup * (item.fatorCusto || m.fatorCusto)),
          custoAmostra: arredondarCusto(p.custoAmostra * (item.fatorCusto || m.fatorCusto)),
          criticidade: item.criticidade || p.criticidade
        });
      });
    });
    return catalogo;
  }

  /* Custo de referência do ensaio na configuração padrão de amostras. */
  function custoPadrao(teste) {
    return teste.custoSetup + teste.custoAmostra * teste.amostrasPadrao;
  }

  function custoDemanda(teste, amostras) {
    var corridas = Math.max(1, Math.ceil(amostras / (teste.amostrasPorCorrida || 1)));
    return teste.custoSetup * corridas + teste.custoAmostra * amostras;
  }

  /* Manutenções são declaradas como deslocamento em dias ('+35') a partir da data-base,
     para que a base semente continue coerente independentemente de quando for aberta. */
  function resolverEquipamentos(dataBase) {
    return EQUIPAMENTOS.map(function (e) {
      return Object.assign({}, e, {
        manutencao: (e.manutencao || []).map(function (j) {
          return {
            inicio: String(j.inicio).charAt(0) === '+' ? util.addDias(dataBase, Number(j.inicio.slice(1))) : j.inicio,
            fim: String(j.fim).charAt(0) === '+' ? util.addDias(dataBase, Number(j.fim.slice(1))) : j.fim,
            motivo: j.motivo
          };
        })
      });
    });
  }

  /* Carteira inicial de demandas, para que a tela de planejamento já abra com conteúdo. */
  function demandasIniciais(dataBase) {
    var d = function (n) { return util.addDias(dataBase, n); };
    return [
      { id: 'DEM-0001', testeId: 'STL-FAD-TERM', projeto: 'P/X-Hatch 1.0 Turbo', peca: 'CAT', fase: 'DV', amostras: 3, dataPecaDisponivel: d(3), dataAlvo: d(60), prioridade: 'Crítica', solicitante: 'D. Vergini', obs: 'Gate DV travado nesta amostra.' },
      { id: 'DEM-0002', testeId: 'STL-VIB-RND', projeto: 'P/X-Hatch 1.0 Turbo', peca: 'SIS', fase: 'DV', amostras: 2, dataPecaDisponivel: d(5), dataAlvo: d(45), prioridade: 'Alta', solicitante: 'D. Vergini', obs: '' },
      { id: 'DEM-0003', testeId: 'VW-COR-CIC', projeto: 'MQB Facelift', peca: 'TUB', fase: 'PV', amostras: 12, dataPecaDisponivel: d(10), dataAlvo: d(110), prioridade: 'Alta', solicitante: 'L. Prado', obs: 'Duas corridas de câmara.' },
      { id: 'DEM-0004', testeId: 'VW-CAT-EFI', projeto: 'MQB Facelift', peca: 'CAT', fase: 'PV', amostras: 2, dataPecaDisponivel: d(14), dataAlvo: d(70), prioridade: 'Crítica', solicitante: 'L. Prado', obs: '' },
      { id: 'DEM-0005', testeId: 'GM-COR-CIC', projeto: 'GEM BEV Range Ext.', peca: 'SIL', fase: 'DV', amostras: 6, dataPecaDisponivel: d(2), dataAlvo: d(75), prioridade: 'Média', solicitante: 'R. Nakamura', obs: '' },
      { id: 'DEM-0006', testeId: 'SCA-DPF-REG', projeto: 'Euro 6 Step E', peca: 'DPF', fase: 'PV', amostras: 2, dataPecaDisponivel: d(20), dataAlvo: d(95), prioridade: 'Crítica', solicitante: 'A. Guedes', obs: 'Depende de motor no dinamômetro.' },
      { id: 'DEM-0007', testeId: 'SCA-SCR-DOS', projeto: 'Euro 6 Step E', peca: 'SCR', fase: 'DV', amostras: 1, dataPecaDisponivel: d(8), dataAlvo: d(55), prioridade: 'Alta', solicitante: 'A. Guedes', obs: '' },
      { id: 'DEM-0008', testeId: 'MB-FAD-TERM', projeto: 'OM 470 Update', peca: 'COL', fase: 'PV', amostras: 2, dataPecaDisponivel: d(25), dataAlvo: d(105), prioridade: 'Alta', solicitante: 'C. Bittencourt', obs: '' },
      { id: 'DEM-0009', testeId: 'TOY-ACU-NVH', projeto: 'TNGA-B Hybrid', peca: 'SIL', fase: 'DV', amostras: 2, dataPecaDisponivel: d(6), dataAlvo: d(40), prioridade: 'Média', solicitante: 'M. Ferraz', obs: '' },
      { id: 'DEM-0010', testeId: 'TOY-FAD-TERM', projeto: 'TNGA-B Hybrid', peca: 'CAT', fase: 'DV', amostras: 2, dataPecaDisponivel: d(12), dataAlvo: d(80), prioridade: 'Alta', solicitante: 'M. Ferraz', obs: '' }
    ].map(function (dem) { return Object.assign({ status: 'Confirmada', criadoEm: dataBase }, dem); });
  }

  return {
    CLIENTES: CLIENTES,
    TIPOS_PECA: TIPOS_PECA,
    FASES: FASES,
    TIPOS_EQUIP: TIPOS_EQUIP,
    EQUIPAMENTOS: EQUIPAMENTOS,
    PROCEDIMENTOS: PROCEDIMENTOS,
    MATRIZ: MATRIZ,
    montarCatalogo: montarCatalogo,
    custoPadrao: custoPadrao,
    custoDemanda: custoDemanda,
    resolverEquipamentos: resolverEquipamentos,
    demandasIniciais: demandasIniciais
  };
});
