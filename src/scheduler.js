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

  /* Grupo do equipamento: família de unidades intercambiáveis. Sem grupo definido,
     a própria unidade é o grupo. */
  function grupoDe(equipamento) {
    return equipamento.grupo || equipamento.nome || equipamento.id;
  }

  /* Agrupa o parque em famílias, preservando a ordem do cadastro. */
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

  /* Horas que realmente prendem a bancada. O report é feito depois, na mesa. */
  function horasDeBancada(teste) {
    return (teste.horasSetup || 0) + (teste.horasEnsaio || 0);
  }

  /* Horas faturadas ao cliente: bancada + elaboração do relatório. */
  function horasFaturaveis(teste) {
    return horasDeBancada(teste) + (teste.horasReport || 0);
  }

  /* Quantos dias de operação o ensaio consome no conjunto de bancadas. */
  function diasDeOperacao(teste, equipamentos) {
    var lista = [].concat(equipamentos || []);
    var horasPorDia = lista.length ? horasPorDiaCombinadas(lista) : 8;
    return Math.max(1, Math.ceil(horasDeBancada(teste) / horasPorDia));
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

  var MAX_COMBINACOES = 400;

  /* Uma unidade de cada grupo. Com poucos grupos e poucas unidades o produto é pequeno;
     acima do teto caímos na primeira unidade de cada grupo para não travar o recálculo. */
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

  /* Procura, entre todas as unidades possíveis, a que começa mais cedo.
     Empate no início é desempatado por quem termina antes — uma bancada de turno
     mais longo entrega o mesmo ensaio em menos dias. */
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

  /* Hourly rate do estado, com a constante do centro de testes como último recurso.
     O rate é um valor só para todo o catálogo, atualizado uma vez por ano. */
  function taxaHoraria(estado) {
    if (estado && typeof estado.hourlyRate === 'number') return estado.hourlyRate;
    return dados.HOURLY_RATE;
  }

  /* Custo do procedimento:
       (horas de setup + ensaio + report) x hourly rate + insumos
     O hourly rate vem de fora porque não pertence ao procedimento: é do centro de testes.
     A demanda soma ainda as amostras consumidas, que dependem da peça escolhida. */
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

  /* Custo de referência do catálogo, sem peça associada. */
  function custoCatalogo(teste, hourlyRate) {
    return custoDemanda(null, teste, null, null, hourlyRate);
  }

  /* Estados em que a demanda ainda disputa bancada. A lista vem do fluxo, para não haver
     duas verdades sobre o que está ativo. */
  var fluxo = TC.fluxo || (typeof require !== 'undefined' ? require('./fluxo.js') : null);
  var ATIVAS = fluxo.estadosAtivos();

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
        /* equipamentos: as unidades efetivamente escolhidas; vazio até alocar. */
        equipamentos: [],
        custo: custoDemanda(demanda, teste, null, peca, taxaHoraria(estado)),
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
      if (base.teste && base.grupos.length) {
        /* Estimativa pela primeira unidade de cada grupo, só para dar a duração. */
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
        base.motivo = 'Procedimento não encontrado no catálogo.';
        alocacoes.push(base);
        return;
      }
      if (base.gruposFaltando.length) {
        base.motivo = 'Grupo de equipamento "' + base.gruposFaltando.join('", "') + '" sem unidade cadastrada.';
        alocacoes.push(base);
        return;
      }
      if (!base.grupos.length) {
        base.motivo = 'Procedimento sem equipamento definido.';
        alocacoes.push(base);
        return;
      }

      /* A chegada das amostras é informada na demanda: o mesmo tipo de peça chega em
         datas diferentes conforme o cliente e o programa. */
      var disponibilidadePeca = demanda.dataAmostras || hoje;
      var dataMinima = util.maiorData(hoje, disponibilidadePeca);
      if (demanda.inicioFixo) dataMinima = demanda.inicioFixo;

      var melhor = melhorEntreGrupos(base.grupos, teste, reservas, dataMinima, demanda.inicioFixo);

      if (!melhor) {
        base.motivo = demanda.inicioFixo
          ? 'Data fixada em ' + util.formatarData(demanda.inicioFixo, true) +
            ' indisponível em ' + nomesDosGrupos(base.grupos) + '.'
          : 'Sem janela livre em ' + nomesDosGrupos(base.grupos) + ' dentro do horizonte de planejamento.';
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
      /* Só é bloqueio o que deveria ter entrado na bancada e não entrou. */
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
