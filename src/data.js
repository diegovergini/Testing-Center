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

  var CLIENTES = [
    { id: 'CLI-GM', nome: 'GM — General Motors', segmento: 'OEM' },
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

  /* Catálogo de procedimentos GM.
     Cada linha é [código, nome do procedimento, norma]. Nome e norma vêm da
     especificação do cliente; os demais campos ficam em branco para o engenheiro de
     testes preencher no cadastro — no catálogo o procedimento aparece marcado como
     "sem equipamento" e com custo zero até ser completado.

     Sobre os campos preenchidos depois:
     revisao = revisão vigente do procedimento; acompanha o nome em toda a aplicação.
     Custo do procedimento = (horasSetup + horasEnsaio + horasReport) x hourlyRate + custoInsumos.
     Só horasSetup + horasEnsaio ocupam bancada; horasReport é trabalho de escritório e
     entra no custo, não na agenda do equipamento.
     equipamentoGrupos = famílias de bancada que o ensaio ocupa ao mesmo tempo. O
     planejamento escolhe, dentro de cada grupo, a unidade que libera mais cedo.
     clientes = lista vazia significa procedimento padrão do laboratório, exigido por todos.
     O procedimento não é amarrado a fase de projeto: qualquer teste pode rodar em DV, PV ou VAVE. */
  var PROCEDIMENTOS = [
    ['TP-GM-01', 'Resonance Durability', 'Appx C'],
    ['TP-GM-02', 'Physical Durability Aging Cycle', 'Appx C'],
    ['TP-GM-03', 'Substrate Retention Cold Vibration Aging', 'Appx C'],
    ['TP-GM-04', 'Container Thermal Shock Ageing Cycle', 'Appx C'],
    ['TP-GM-05', 'Substrate Thermal Shock', 'Appx C'],
    ['TP-GM-06', 'Exhaust backpressure', 'GMW16372'],
    ['TP-GM-07', 'Joint Leakage', 'GMW15261'],
    ['TP-GM-08', 'Hanger Dynamic Stifness', 'GMW14182'],
    ['TP-GM-09', 'Muffler Thermal Shock', 'GMW14380'],
    ['TP-GM-10', 'Hanger Durability', 'GMW14381 / GMW16941'],
    ['TP-GM-11', 'Pipe Durability', 'GMW14390 / GMW18104']
  ];

  var TESTES = PROCEDIMENTOS.map(function (linha) {
    return {
      id: linha[0], nome: linha[1], norma: linha[2], revisao: 'Rev. 01',
      clientes: ['CLI-GM'],
      area: 'AMBOS', equipamentoGrupos: [],
      horasSetup: 0, horasEnsaio: 0, horasReport: 0, amostras: 1,
      hourlyRate: 0, custoInsumos: 0,
      descricao: ''
    };
  });

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

  /* Versão do catálogo de partida. Subir este número troca o catálogo dos dados já
     salvos no navegador pelo catálogo daqui — é como uma substituição de catálogo
     chega a quem já usava a plataforma. */
  var CATALOGO_VERSAO = 2;

  TC.data = {
    CATALOGO_VERSAO: CATALOGO_VERSAO,
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
