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

  /* Lista de equipamentos que o procedimento ocupa ao mesmo tempo. */
  function idsDeEquipamento(teste) {
    if (!teste) return [];
    if (teste.equipamentoIds) return teste.equipamentoIds;
    return teste.equipamentoId ? [teste.equipamentoId] : [];
  }

  /* Um ensaio só avança quando TODAS as bancadas que ele ocupa estão operando:
     o turno mais curto e a interseção dos dias úteis mandam no ritmo. */
  function horasPorDiaCombinadas(lista) {
    return lista.reduce(function (menor, eq) {
      var horas = eq.continuo ? 24 : (eq.horasDia || 8);
      return Math.min(menor, horas);
    }, 24);
  }

  function ehDiaUtilEmTodos(lista, iso) {
    for (var i = 0; i < lista.length; i++) if (!ehDiaUtil(lista[i], iso)) return false;
    return true;
  }

  function algumEmManutencao(lista, iso) {
    for (var i = 0; i < lista.length; i++) if (emManutencao(lista[i], iso)) return true;
    return false;
  }

  /* Quantos dias de operação o ensaio consome no conjunto de bancadas. */
  function diasDeOperacao(teste, equipamentos) {
    var lista = [].concat(equipamentos || []);
    var horas = (teste.horasSetup || 0) + (teste.horasEnsaio || 0);
    var horasPorDia = lista.length ? horasPorDiaCombinadas(lista) : 8;
    return Math.max(1, Math.ceil(horas / horasPorDia));
  }

  /* A partir de uma data de início, devolve a janela de calendário que o ensaio ocupa.
     Dias não úteis dentro da janela continuam ocupando as posições (a peça segue montada).
     Devolve null se a janela atravessar uma parada de manutenção de qualquer bancada. */
  function calcularJanela(equipamentos, inicio, diasNecessarios) {
    var lista = [].concat(equipamentos || []);
    var cursor = inicio;
    var contados = 0;
    var guarda = 0;
    while (contados < diasNecessarios && guarda++ < HORIZONTE_DIAS) {
      if (algumEmManutencao(lista, cursor)) return null;
      if (ehDiaUtilEmTodos(lista, cursor)) contados++;
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

  /* Primeira posição livre do equipamento para a janela.
     Devolve o índice, ou -1 e a data em que a posição mais cedo se libera. */
  function posicaoLivre(posicoes, janela) {
    var liberaEm = null;
    for (var p = 0; p < posicoes.length; p++) {
      var conflito = primeiroConflito(posicoes[p], janela);
      if (!conflito) return { posicao: p, liberaEm: null };
      if (!liberaEm || util.diffDias(conflito.fim, liberaEm) > 0) liberaEm = conflito.fim;
    }
    return { posicao: -1, liberaEm: liberaEm };
  }

  /* Procura a primeira janela em que TODAS as bancadas têm uma posição livre. */
  function buscarJanela(equipamentos, reservasPorEquipamento, dataMinima, diasNecessarios) {
    var lista = [].concat(equipamentos || []);
    if (!lista.length) return null;
    var cursor = dataMinima;
    var limite = util.somaDias(dataMinima, HORIZONTE_DIAS);
    var guarda = 0;

    while (util.diffDias(cursor, limite) > 0 && guarda++ < HORIZONTE_DIAS) {
      if (!ehDiaUtilEmTodos(lista, cursor) || algumEmManutencao(lista, cursor)) {
        cursor = util.somaDias(cursor, 1);
        continue;
      }
      var janela = calcularJanela(lista, cursor, diasNecessarios);
      if (!janela) { cursor = util.somaDias(cursor, 1); continue; }

      var escolhidas = {};
      var ocupado = false;
      /* Como todas as bancadas precisam estar livres juntas, a próxima tentativa só
         faz sentido depois que a última delas se liberar. */
      var proximaTentativa = null;
      for (var i = 0; i < lista.length; i++) {
        var r = posicaoLivre(reservasPorEquipamento[lista[i].id], janela);
        if (r.posicao === -1) {
          ocupado = true;
          if (r.liberaEm && (!proximaTentativa || util.diffDias(r.liberaEm, proximaTentativa) < 0)) {
            proximaTentativa = r.liberaEm;
          }
        } else {
          escolhidas[lista[i].id] = r.posicao;
        }
      }
      if (!ocupado) return { janela: janela, posicoes: escolhidas };
      cursor = proximaTentativa ? util.somaDias(proximaTentativa, 1) : util.somaDias(cursor, 1);
    }
    return null;
  }

  function pesoPrioridade(id) {
    var p = util.porId(dados.PRIORIDADES, id);
    return p ? p.peso : 9;
  }

  /* Custo de uma demanda: mão de obra/insumos + hora-máquina + amostras consumidas.
     Ensaio que ocupa mais de uma bancada paga a hora de todas elas. */
  function custoDemanda(demanda, teste, equipamentos, peca) {
    if (!teste) return { horas: 0, custoBase: 0, custoEquipamento: 0, custoAmostras: 0, total: 0 };
    var lista = [].concat(equipamentos || []).filter(Boolean);
    var horas = (teste.horasSetup || 0) + (teste.horasEnsaio || 0);
    var quantidade = demanda && demanda.quantidade ? demanda.quantidade : teste.amostras;
    var custoHoraTotal = lista.reduce(function (soma, eq) { return soma + (eq.custoHora || 0); }, 0);
    var custoEquipamento = horas * custoHoraTotal;
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
  function custoCatalogo(teste, equipamentos) {
    return custoDemanda(null, teste, equipamentos, null);
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
      var ids = idsDeEquipamento(teste);
      var lista = [];
      var faltando = [];
      ids.forEach(function (id) {
        var eq = util.porId(equipamentos, id);
        if (eq) lista.push(eq); else faltando.push(id);
      });
      return {
        demandaId: demanda.id,
        demanda: demanda,
        teste: teste,
        peca: peca,
        equipamentos: lista,
        equipamentosFaltando: faltando,
        custo: custoDemanda(demanda, teste, lista, peca),
        cotacao: false,
        /* posicoes: { equipamentoId: índice da posição ocupada } */
        posicoes: null,
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
      if (base.teste && base.equipamentos.length) {
        base.diasOperacao = diasDeOperacao(base.teste, base.equipamentos);
      }
      alocacoes.push(base);
    }

    function nomesDe(lista) {
      return lista.map(function (eq) { return eq.nome; }).join(' + ');
    }

    function processar(demanda) {
      var base = montarBase(demanda);
      var teste = base.teste;
      var lista = base.equipamentos;

      if (!teste) {
        base.motivo = 'Procedimento não encontrado no catálogo.';
        alocacoes.push(base);
        return;
      }
      if (base.equipamentosFaltando.length) {
        base.motivo = 'Equipamento "' + base.equipamentosFaltando.join('", "') + '" não cadastrado.';
        alocacoes.push(base);
        return;
      }
      if (!lista.length) {
        base.motivo = 'Procedimento sem equipamento definido.';
        alocacoes.push(base);
        return;
      }

      var dias = diasDeOperacao(teste, lista);
      /* A chegada das amostras é informada na demanda: o mesmo tipo de peça chega em
         datas diferentes conforme o cliente e o programa. */
      var disponibilidadePeca = demanda.dataAmostras || hoje;
      var dataMinima = util.maiorData(hoje, disponibilidadePeca);
      if (demanda.inicioFixo) dataMinima = demanda.inicioFixo;

      var melhor = null;
      if (demanda.inicioFixo) {
        var janelaFixa = calcularJanela(lista, demanda.inicioFixo, dias);
        if (janelaFixa) {
          var escolhidas = {};
          var livre = true;
          lista.forEach(function (eq) {
            var r = posicaoLivre(reservas[eq.id], janelaFixa);
            if (r.posicao === -1) livre = false; else escolhidas[eq.id] = r.posicao;
          });
          if (livre) melhor = { janela: janelaFixa, posicoes: escolhidas };
        }
      } else {
        melhor = buscarJanela(lista, reservas, dataMinima, dias);
      }

      if (!melhor) {
        base.motivo = demanda.inicioFixo
          ? 'Data fixada em ' + util.formatarData(demanda.inicioFixo, true) +
            ' indisponível em ' + nomesDe(lista) + '.'
          : 'Sem janela livre em ' + nomesDe(lista) + ' dentro do horizonte de planejamento.';
        base.diasOperacao = dias;
        alocacoes.push(base);
        return;
      }

      lista.forEach(function (eq) {
        reservas[eq.id][melhor.posicoes[eq.id]].push(melhor.janela);
      });

      base.posicoes = melhor.posicoes;
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
    idsDeEquipamento: idsDeEquipamento,
    STATUS_ATIVOS: ATIVAS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.scheduler;
})(typeof globalThis !== 'undefined' ? globalThis : this);
