/* Motor de planejamento.
   Recebe as demandas confirmadas e devolve a alocação em equipamento/posição,
   respeitando: data de chegada das amostras, calendário e manutenção do equipamento,
   número de posições em paralelo, prioridade e prazo. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util || (typeof require !== 'undefined' ? require('./util.js') : null);
  var dados = TC.data || (typeof require !== 'undefined' ? require('./data.js') : null);

  var HORIZONTE_DIAS = 1095; /* 3 anos: além disso consideramos a demanda impossível de alocar. */

  function ehDiaUtil(equipamento, iso) {
    return equipamento.diasUteis.indexOf(util.diaDaSemana(iso)) !== -1;
  }

  function emManutencao(equipamento, iso) {
    var janelas = equipamento.manutencao || [];
    for (var i = 0; i < janelas.length; i++) {
      if (util.diffDias(janelas[i].inicio, iso) >= 0 && util.diffDias(iso, janelas[i].fim) >= 0) return true;
    }
    return false;
  }

  /* Quantos dias de operação o ensaio consome neste equipamento.
     Equipamento contínuo roda 24 h/dia; os demais, apenas as horas do turno. */
  function diasDeOperacao(teste, equipamento) {
    var horas = (teste.horasSetup || 0) + (teste.horasEnsaio || 0);
    var horasPorDia = equipamento.continuo ? 24 : (equipamento.horasDia || 8);
    return Math.max(1, Math.ceil(horas / horasPorDia));
  }

  /* A partir de uma data de início, devolve a janela de calendário que o ensaio ocupa.
     Dias não úteis dentro da janela continuam ocupando a posição (a peça segue montada).
     Devolve null se a janela atravessar uma parada de manutenção. */
  function calcularJanela(equipamento, inicio, diasNecessarios) {
    var cursor = inicio;
    var contados = 0;
    var guarda = 0;
    while (contados < diasNecessarios && guarda++ < HORIZONTE_DIAS) {
      if (emManutencao(equipamento, cursor)) return null;
      if (ehDiaUtil(equipamento, cursor)) contados++;
      if (contados < diasNecessarios) cursor = util.somaDias(cursor, 1);
    }
    return contados === diasNecessarios ? { inicio: inicio, fim: cursor } : null;
  }

  function sobrepoe(a, b) {
    return util.diffDias(a.inicio, b.fim) >= 0 && util.diffDias(b.inicio, a.fim) >= 0;
  }

  function primeiroConflito(reservas, janela) {
    for (var i = 0; i < reservas.length; i++) {
      if (sobrepoe(reservas[i], janela)) return reservas[i];
    }
    return null;
  }

  /* Procura a primeira janela livre numa posição, a partir de dataMinima. */
  function buscarJanela(equipamento, reservas, dataMinima, diasNecessarios) {
    var cursor = dataMinima;
    var limite = util.somaDias(dataMinima, HORIZONTE_DIAS);
    var guarda = 0;
    while (util.diffDias(cursor, limite) > 0 && guarda++ < HORIZONTE_DIAS) {
      if (!ehDiaUtil(equipamento, cursor) || emManutencao(equipamento, cursor)) {
        cursor = util.somaDias(cursor, 1);
        continue;
      }
      var janela = calcularJanela(equipamento, cursor, diasNecessarios);
      if (!janela) { cursor = util.somaDias(cursor, 1); continue; }
      var conflito = primeiroConflito(reservas, janela);
      if (conflito) { cursor = util.somaDias(conflito.fim, 1); continue; }
      return janela;
    }
    return null;
  }

  function pesoPrioridade(id) {
    var p = util.porId(dados.PRIORIDADES, id);
    return p ? p.peso : 9;
  }

  /* Custo de uma demanda: mão de obra/insumos + hora-máquina + amostras consumidas. */
  function custoDemanda(demanda, teste, equipamento, peca) {
    if (!teste) return { horas: 0, custoBase: 0, custoEquipamento: 0, custoAmostras: 0, total: 0 };
    var horas = (teste.horasSetup || 0) + (teste.horasEnsaio || 0);
    var quantidade = demanda && demanda.quantidade ? demanda.quantidade : teste.amostras;
    var custoEquipamento = horas * (equipamento ? equipamento.custoHora : 0);
    var custoAmostras = quantidade * (peca ? peca.custoAmostra || 0 : 0);
    var custoBase = teste.custoBase || 0;
    return {
      horas: horas,
      quantidade: quantidade,
      custoBase: custoBase,
      custoEquipamento: custoEquipamento,
      custoAmostras: custoAmostras,
      total: custoBase + custoEquipamento + custoAmostras
    };
  }

  /* Custo de referência do catálogo, sem peça associada. */
  function custoCatalogo(teste, equipamento) {
    return custoDemanda(null, teste, equipamento, null);
  }

  var ATIVAS = ['PENDENTE', 'EM_ANDAMENTO'];

  /* Uma LTI de cotação é orçamento: calcula custo e duração, mas não reserva bancada. */
  function ehCotacao(demanda) {
    var tipo = util.porId(dados.TIPOS_LTI, demanda.tipoLti);
    return !!tipo && tipo.planeja === false;
  }

  /* Planeja todas as demandas ativas. Não altera o estado recebido. */
  function planejar(estado, dataBase) {
    var hoje = dataBase || util.hoje();
    var equipamentos = estado.equipamentos;
    var reservas = {}; /* equipamentoId -> array por posição */

    equipamentos.forEach(function (eq) {
      reservas[eq.id] = [];
      for (var i = 0; i < eq.posicoes; i++) reservas[eq.id].push([]);
    });

    var ativas = estado.demandas.filter(function (d) { return ATIVAS.indexOf(d.status) !== -1; });

    var cotacoes = ativas.filter(ehCotacao);
    var planejaveis = ativas.filter(function (d) { return !ehCotacao(d); });

    var fixas = planejaveis.filter(function (d) { return !!d.inicioFixo; });
    var livres = planejaveis.filter(function (d) { return !d.inicioFixo; });

    fixas.sort(function (a, b) { return util.diffDias(b.inicioFixo, a.inicioFixo); });
    livres.sort(function (a, b) {
      var dp = pesoPrioridade(a.prioridade) - pesoPrioridade(b.prioridade);
      if (dp !== 0) return dp;
      if (a.prazo && b.prazo) {
        var dd = util.diffDias(b.prazo, a.prazo);
        if (dd !== 0) return dd;
      } else if (a.prazo !== b.prazo) {
        return a.prazo ? -1 : 1;
      }
      return util.diffDias(b.criadoEm || hoje, a.criadoEm || hoje);
    });

    var alocacoes = [];

    function montarBase(demanda) {
      var teste = util.porId(estado.testes, demanda.testeId);
      var peca = util.porId(estado.pecas, demanda.pecaId);
      var equipamento = teste ? util.porId(equipamentos, teste.equipamentoId) : null;
      return {
        demandaId: demanda.id,
        demanda: demanda,
        teste: teste,
        peca: peca,
        equipamento: equipamento,
        custo: custoDemanda(demanda, teste, equipamento, peca),
        cotacao: false,
        posicao: null,
        inicio: null,
        fim: null,
        motivo: null
      };
    }

    /* Cotação: custo e duração estimados, sem reservar posição. */
    function processarCotacao(demanda) {
      var base = montarBase(demanda);
      base.cotacao = true;
      base.motivo = 'Cotação — não ocupa bancada.';
      if (base.teste && base.equipamento) {
        base.diasOperacao = diasDeOperacao(base.teste, base.equipamento);
      }
      alocacoes.push(base);
    }

    function processar(demanda) {
      var base = montarBase(demanda);
      var teste = base.teste, peca = base.peca, equipamento = base.equipamento;

      if (!teste || !equipamento) {
        base.motivo = !teste ? 'Procedimento não encontrado no catálogo.'
          : 'Equipamento "' + teste.equipamentoId + '" não cadastrado.';
        alocacoes.push(base);
        return;
      }

      var dias = diasDeOperacao(teste, equipamento);
      var disponibilidadePeca = peca ? peca.dataAmostras : hoje;
      var dataMinima = util.maiorData(hoje, disponibilidadePeca);
      if (demanda.inicioFixo) dataMinima = demanda.inicioFixo;

      var melhor = null;
      for (var p = 0; p < equipamento.posicoes; p++) {
        var janela;
        if (demanda.inicioFixo) {
          janela = calcularJanela(equipamento, demanda.inicioFixo, dias);
          if (janela && primeiroConflito(reservas[equipamento.id][p], janela)) janela = null;
        } else {
          janela = buscarJanela(equipamento, reservas[equipamento.id][p], dataMinima, dias);
        }
        if (!janela) continue;
        if (!melhor || util.diffDias(janela.inicio, melhor.janela.inicio) > 0) {
          melhor = { posicao: p, janela: janela };
        }
      }

      if (!melhor) {
        base.motivo = demanda.inicioFixo
          ? 'Data fixada em ' + util.formatarData(demanda.inicioFixo, true) + ' indisponível em todas as posições de ' + equipamento.id + '.'
          : 'Sem janela livre em ' + equipamento.id + ' dentro do horizonte de planejamento.';
        base.diasOperacao = dias;
        alocacoes.push(base);
        return;
      }

      reservas[equipamento.id][melhor.posicao].push(melhor.janela);

      base.posicao = melhor.posicao;
      base.inicio = melhor.janela.inicio;
      base.fim = melhor.janela.fim;
      base.diasOperacao = dias;
      base.esperaAmostra = util.diffDias(hoje, disponibilidadePeca) > 0
        ? util.diffDias(hoje, disponibilidadePeca) : 0;
      base.esperaFila = util.diffDias(dataMinima, melhor.janela.inicio);
      base.folga = demanda.prazo ? util.diffDias(melhor.janela.fim, demanda.prazo) : null;
      base.atrasado = base.folga !== null && base.folga < 0;
      alocacoes.push(base);
    }

    fixas.forEach(processar);
    livres.forEach(processar);
    cotacoes.forEach(processarCotacao);

    alocacoes.sort(function (a, b) {
      if (!a.inicio && !b.inicio) return 0;
      if (!a.inicio) return 1;
      if (!b.inicio) return -1;
      return util.diffDias(b.inicio, a.inicio);
    });

    return {
      alocacoes: alocacoes,
      agendadas: alocacoes.filter(function (a) { return !!a.inicio; }),
      /* Só é bloqueio o que deveria ter entrado na bancada e não entrou. */
      bloqueadas: alocacoes.filter(function (a) { return !a.inicio && !a.cotacao; }),
      cotacoes: alocacoes.filter(function (a) { return a.cotacao; })
    };
  }

  TC.scheduler = {
    planejar: planejar,
    custoDemanda: custoDemanda,
    custoCatalogo: custoCatalogo,
    diasDeOperacao: diasDeOperacao,
    calcularJanela: calcularJanela,
    buscarJanela: buscarJanela,
    ehDiaUtil: ehDiaUtil,
    emManutencao: emManutencao,
    ehCotacao: ehCotacao,
    STATUS_ATIVOS: ATIVAS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.scheduler;
})(typeof globalThis !== 'undefined' ? globalThis : this);
