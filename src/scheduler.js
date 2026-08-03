/* Motor de planejamento.
   It takes the confirmed requests and returns the allocation to equipment/position,
   respecting: sample arrival date, equipment calendar and maintenance, number of parallel
   positions, priority and due date. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util || (typeof require !== 'undefined' ? require('./util.js') : null);
  var dados = TC.data || (typeof require !== 'undefined' ? require('./data.js') : null);

  var HORIZONTE_DIAS = 1095; /* 3 years: past that we treat the request as impossible to place. */

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

  /* Equipment group: a family of interchangeable units. With no group defined, the unit is
     its own group. */
  function grupoDe(equipamento) {
    return equipamento.grupo || equipamento.nome || equipamento.id;
  }

  /* Groups the fleet into families, preserving the register order. */
  function agruparEquipamentos(equipamentos) {
    var ordem = [];
    var mapa = {};
    (equipamentos || []).forEach(function (eq) {
      var id = grupoDe(eq);
      if (!mapa[id]) {
        mapa[id] = { id: id, nome: id, membros: [] };
        ordem.push(mapa[id]);
      }
      mapa[id].membros.push(eq);
    });
    return ordem;
  }

  /* Grupos de bancada que o procedimento ocupa ao mesmo tempo. */
  function gruposDoTeste(teste) {
    if (!teste) return [];
    if (teste.equipamentoGrupos) return teste.equipamentoGrupos;
    return [];
  }

  /* A test only advances when EVERY rig it occupies is operating: the shortest shift and
     the intersection of working days set the pace. */
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

  /* Hours that actually hold the rig. Reporting is done afterwards, at a desk. */
  function horasDeBancada(teste) {
    return (teste.horasSetup || 0) + (teste.horasEnsaio || 0);
  }

  /* Hours billed to the customer: rig time + writing the report. */
  function horasFaturaveis(teste) {
    return horasDeBancada(teste) + (teste.horasReport || 0);
  }

  /* How many operating days the test consumes across the set of rigs. */
  function diasDeOperacao(teste, equipamentos) {
    var lista = [].concat(equipamentos || []);
    var horasPorDia = lista.length ? horasPorDiaCombinadas(lista) : 8;
    return Math.max(1, Math.ceil(horasDeBancada(teste) / horasPorDia));
  }

  /* From a start date, returns the calendar window the test occupies.
     Non-working days inside the window still hold the positions (the part stays mounted).
     Returns null if the window crosses maintenance downtime on any of the rigs. */
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

  /* First free position on the machine for the window.
     Returns the index, or -1 plus the date the earliest position frees up. */
  function posicaoLivre(posicoes, janela) {
    var liberaEm = null;
    for (var p = 0; p < posicoes.length; p++) {
      var conflito = primeiroConflito(posicoes[p], janela);
      if (!conflito) return { posicao: p, liberaEm: null };
      if (!liberaEm || util.diffDias(conflito.fim, liberaEm) > 0) liberaEm = conflito.fim;
    }
    return { posicao: -1, liberaEm: liberaEm };
  }

  /* Looks for the first window in which EVERY rig has a free position. */
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
      /* Since every rig has to be free at the same time, the next attempt only makes sense
         after the last of them frees up. */
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

  var MAX_COMBINACOES = 400;

  /* One unit from each group. With few groups and few units the product is small; above the
     ceiling we fall back to the first unit of each group so the recalculation never hangs. */
  function combinacoesDeUnidades(grupos) {
    var total = grupos.reduce(function (n, g) { return n * g.membros.length; }, 1);
    if (!total) return [];
    if (total > MAX_COMBINACOES) {
      return [grupos.map(function (g) { return g.membros[0]; })];
    }
    var combinacoes = [[]];
    grupos.forEach(function (g) {
      var proxima = [];
      combinacoes.forEach(function (parcial) {
        g.membros.forEach(function (unidade) { proxima.push(parcial.concat([unidade])); });
      });
      combinacoes = proxima;
    });
    return combinacoes;
  }

  /* Among every possible unit, looks for the one that starts earliest.
     A tie on the start is broken by whichever finishes first — a rig with a longer shift
     delivers the same test in fewer days. */
  function melhorEntreGrupos(grupos, teste, reservasPorEquipamento, dataMinima, inicioFixo) {
    var melhor = null;
    combinacoesDeUnidades(grupos).forEach(function (unidades) {
      var dias = diasDeOperacao(teste, unidades);
      var achado = null;

      if (inicioFixo) {
        var janela = calcularJanela(unidades, inicioFixo, dias);
        if (janela) {
          var posicoes = {};
          var livre = true;
          unidades.forEach(function (eq) {
            var r = posicaoLivre(reservasPorEquipamento[eq.id], janela);
            if (r.posicao === -1) livre = false; else posicoes[eq.id] = r.posicao;
          });
          if (livre) achado = { janela: janela, posicoes: posicoes };
        }
      } else {
        achado = buscarJanela(unidades, reservasPorEquipamento, dataMinima, dias);
      }
      if (!achado) return;

      var candidato = { unidades: unidades, janela: achado.janela, posicoes: achado.posicoes, dias: dias };
      if (!melhor) { melhor = candidato; return; }
      var deltaInicio = util.diffDias(candidato.janela.inicio, melhor.janela.inicio);
      if (deltaInicio > 0 || (deltaInicio === 0 && util.diffDias(candidato.janela.fim, melhor.janela.fim) > 0)) {
        melhor = candidato;
      }
    });
    return melhor;
  }

  function pesoPrioridade(id) {
    var p = util.porId(dados.PRIORIDADES, id);
    return p ? p.peso : 9;
  }

  /* Hourly rate from the state, with the test centre constant as a last resort.
     The rate is a single value for the whole catalogue, updated once a year. */
  function taxaHoraria(estado) {
    if (estado && typeof estado.hourlyRate === 'number') return estado.hourlyRate;
    return dados.HOURLY_RATE;
  }

  /* Custo do procedimento:
       (horas de setup + ensaio + report) x hourly rate + insumos
     The hourly rate comes from outside because it does not belong to the procedure: it
     belongs to the test centre. A request also adds the samples consumed, which depend on the
     part type chosen. */
  function custoDemanda(demanda, teste, equipamentos, peca, hourlyRate) {
    if (!teste) {
      return {
        horasBancada: 0, horasReport: 0, horasFaturaveis: 0, hourlyRate: 0,
        custoHoras: 0, custoInsumos: 0, custoAmostras: 0, custoProcedimento: 0, total: 0
      };
    }
    var quantidade = demanda && demanda.quantidade ? demanda.quantidade : teste.amostras;
    var horas = horasFaturaveis(teste);
    var rate = typeof hourlyRate === 'number' ? hourlyRate : taxaHoraria(null);
    var custoHoras = horas * rate;
    var custoInsumos = teste.custoInsumos || 0;
    var custoProcedimento = custoHoras + custoInsumos;
    var custoAmostras = quantidade * (peca ? peca.custoAmostra || 0 : 0);
    return {
      horasBancada: horasDeBancada(teste),
      horasReport: teste.horasReport || 0,
      horasFaturaveis: horas,
      hourlyRate: rate,
      quantidade: quantidade,
      custoHoras: custoHoras,
      custoInsumos: custoInsumos,
      custoProcedimento: custoProcedimento,
      custoAmostras: custoAmostras,
      total: custoProcedimento + custoAmostras
    };
  }

  /* Reference cost for the catalogue, with no part type attached. */
  function custoCatalogo(teste, hourlyRate) {
    return custoDemanda(null, teste, null, null, hourlyRate);
  }

  /* States in which a request still competes for a rig. The list comes from the workflow, so
     there are never two truths about what is active. */
  var fluxo = TC.fluxo || (typeof require !== 'undefined' ? require('./fluxo.js') : null);
  var ATIVAS = fluxo.estadosAtivos();

  /* A quote LTI is a budget: it works out cost and duration but reserves no rig. */
  function ehCotacao(demanda) {
    var tipo = util.porId(dados.TIPOS_LTI, demanda.tipoLti);
    return !!tipo && tipo.planeja === false;
  }

  /* Schedules every active request. It does not modify the state it receives. */
  function planejar(estado, dataBase) {
    var hoje = dataBase || util.hoje();
    var equipamentos = estado.equipamentos;
    var reservas = {}; /* equipamentoId -> array indexed by position */

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

    var gruposDoParque = agruparEquipamentos(equipamentos);

    function montarBase(demanda) {
      var teste = util.porId(estado.testes, demanda.testeId);
      var peca = util.porId(estado.pecas, demanda.pecaId);
      var grupos = [];
      var faltando = [];
      gruposDoTeste(teste).forEach(function (id) {
        var g = util.porId(gruposDoParque, id);
        if (g && g.membros.length) grupos.push(g); else faltando.push(id);
      });
      return {
        demandaId: demanda.id,
        demanda: demanda,
        teste: teste,
        peca: peca,
        grupos: grupos,
        gruposFaltando: faltando,
        /* equipamentos: the units actually chosen; empty until it is placed. */
        equipamentos: [],
        custo: custoDemanda(demanda, teste, null, peca, taxaHoraria(estado)),
        cotacao: false,
        /* posicoes: { equipamentoId: index of the position taken } */
        posicoes: null,
        inicio: null,
        fim: null,
        motivo: null
      };
    }

    /* Quote: estimated cost and duration, with no position reserved. */
    function processarCotacao(demanda) {
      var base = montarBase(demanda);
      base.cotacao = true;
      base.motivo = 'Quote — takes no rig.';
      if (base.teste && base.grupos.length) {
        /* Estimated from the first unit of each group, only to give the duration. */
        base.diasOperacao = diasDeOperacao(base.teste, base.grupos.map(function (g) { return g.membros[0]; }));
      }
      alocacoes.push(base);
    }

    function nomesDosGrupos(grupos) {
      return grupos.map(function (g) { return g.nome; }).join(' + ');
    }

    function processar(demanda) {
      var base = montarBase(demanda);
      var teste = base.teste;

      if (!teste) {
        base.motivo = 'Procedure not found in the catalogue.';
        alocacoes.push(base);
        return;
      }
      if (base.gruposFaltando.length) {
        base.motivo = 'Equipment group "' + base.gruposFaltando.join('", "') + '" has no unit registered.';
        alocacoes.push(base);
        return;
      }
      if (!base.grupos.length) {
        base.motivo = 'Procedure with no equipment defined.';
        alocacoes.push(base);
        return;
      }

      /* Sample arrival is given on the request: the same part type arrives on different
         dates depending on the customer and the programme. */
      var disponibilidadePeca = demanda.dataAmostras || hoje;
      var dataMinima = util.maiorData(hoje, disponibilidadePeca);
      if (demanda.inicioFixo) dataMinima = demanda.inicioFixo;

      var melhor = melhorEntreGrupos(base.grupos, teste, reservas, dataMinima, demanda.inicioFixo);

      if (!melhor) {
        base.motivo = demanda.inicioFixo
          ? 'Start pinned to ' + util.formatarData(demanda.inicioFixo, true) +
            ' unavailable on ' + nomesDosGrupos(base.grupos) + '.'
          : 'No free slot on ' + nomesDosGrupos(base.grupos) + ' within the planning horizon.';
        base.diasOperacao = diasDeOperacao(teste, base.grupos.map(function (g) { return g.membros[0]; }));
        alocacoes.push(base);
        return;
      }

      melhor.unidades.forEach(function (eq) {
        reservas[eq.id][melhor.posicoes[eq.id]].push(melhor.janela);
      });

      base.equipamentos = melhor.unidades;
      base.posicoes = melhor.posicoes;
      base.inicio = melhor.janela.inicio;
      base.fim = melhor.janela.fim;
      base.diasOperacao = melhor.dias;
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
      /* Only what should have made it onto a rig and did not counts as blocked. */
      bloqueadas: alocacoes.filter(function (a) { return !a.inicio && !a.cotacao; }),
      cotacoes: alocacoes.filter(function (a) { return a.cotacao; })
    };
  }

  TC.scheduler = {
    planejar: planejar,
    custoDemanda: custoDemanda,
    custoCatalogo: custoCatalogo,
    taxaHoraria: taxaHoraria,
    diasDeOperacao: diasDeOperacao,
    calcularJanela: calcularJanela,
    buscarJanela: buscarJanela,
    ehDiaUtil: ehDiaUtil,
    emManutencao: emManutencao,
    ehCotacao: ehCotacao,
    gruposDoTeste: gruposDoTeste,
    agruparEquipamentos: agruparEquipamentos,
    grupoDe: grupoDe,
    horasDeBancada: horasDeBancada,
    horasFaturaveis: horasFaturaveis,
    STATUS_ATIVOS: ATIVAS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.scheduler;
})(typeof globalThis !== 'undefined' ? globalThis : this);
