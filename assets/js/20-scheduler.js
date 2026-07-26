/* Testing Center — planejador de ensaios.

   Regra de alocação:
   1. Demandas são ordenadas por prioridade, depois por data-alvo e por disponibilidade da peça.
   2. Cada demanda só pode começar depois que a PEÇA estiver disponível.
   3. O ensaio ocupa N dias produtivos da unidade; dias não elegíveis (fim de semana em
      bancada não automatizada, janela de manutenção) pausam o ensaio e empurram a data-fim.
   4. Entre as unidades compatíveis, vence a que termina mais cedo.
   Isso é um "earliest-finish first" guloso com capacidade por unidade — determinístico e
   auditável, que é o que um plano de laboratório precisa ser. */
(function (root, factory) {
  var api = factory(
    typeof module === 'object' && module.exports ? require('./00-util.js') : root.TC.util
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.TC = root.TC || {}).scheduler = api;
})(typeof self !== 'undefined' ? self : this, function (util) {
  'use strict';

  var PESO_PRIORIDADE = { 'Crítica': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3 };

  function pesoPrioridade(p) {
    var v = PESO_PRIORIDADE[p];
    return v == null ? 2 : v;
  }

  function ordenarDemandas(demandas) {
    return demandas.slice().sort(function (a, b) {
      var pa = pesoPrioridade(a.prioridade), pb = pesoPrioridade(b.prioridade);
      if (pa !== pb) return pa - pb;
      var aa = a.dataAlvo || '9999-12-31', ab = b.dataAlvo || '9999-12-31';
      if (aa !== ab) return aa < ab ? -1 : 1;
      var da = a.dataPecaDisponivel || '0000-01-01', db = b.dataPecaDisponivel || '0000-01-01';
      if (da !== db) return da < db ? -1 : 1;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
  }

  function emManutencao(equip, dia) {
    var janelas = equip.manutencao || [];
    for (var i = 0; i < janelas.length; i++) {
      if (dia >= janelas[i].inicio && dia <= janelas[i].fim) return janelas[i];
    }
    return null;
  }

  /* Dia elegível = a unidade realmente produz nesse dia. */
  function diaElegivel(equip, dia) {
    if (equip.diasUteis && util.ehFimDeSemana(dia)) return false;
    if (emManutencao(equip, dia)) return false;
    return true;
  }

  function ocupacaoDoDia(mapa, dia) {
    return mapa.get(dia) || 0;
  }

  /* Procura a primeira sequência de `diasNecessarios` dias elegíveis com vaga livre,
     começando em `inicioMin`. Retorna a lista de dias ocupados ou null. */
  function buscarJanela(equip, mapa, inicioMin, diasNecessarios, limite) {
    var cursor = inicioMin;
    while (cursor <= limite) {
      if (!diaElegivel(equip, cursor)) { cursor = util.addDias(cursor, 1); continue; }
      if (ocupacaoDoDia(mapa, cursor) >= equip.capacidade) { cursor = util.addDias(cursor, 1); continue; }

      var dias = [cursor];
      var probe = util.addDias(cursor, 1);
      var conflito = null;
      while (dias.length < diasNecessarios && probe <= limite) {
        if (!diaElegivel(equip, probe)) { probe = util.addDias(probe, 1); continue; }
        if (ocupacaoDoDia(mapa, probe) >= equip.capacidade) { conflito = probe; break; }
        dias.push(probe);
        probe = util.addDias(probe, 1);
      }

      if (dias.length === diasNecessarios) return dias;
      if (conflito) { cursor = util.addDias(conflito, 1); continue; }
      return null; // estourou o horizonte
    }
    return null;
  }

  function reservar(mapa, dias) {
    dias.forEach(function (d) { mapa.set(d, (mapa.get(d) || 0) + 1); });
  }

  /* cfg = { demandas, equipamentos, catalogo, dataBase, horizonteDias } */
  function planejar(cfg) {
    var dataBase = cfg.dataBase || util.hojeISO();
    var horizonte = cfg.horizonteDias || 540;
    var limite = util.addDias(dataBase, horizonte);
    var catalogo = util.indexarPor(cfg.catalogo || []);
    var equipamentos = cfg.equipamentos || [];

    var ocupacao = new Map();
    equipamentos.forEach(function (e) { ocupacao.set(e.id, new Map()); });

    var alocacoes = [];
    var naoAlocadas = [];

    var fila = ordenarDemandas((cfg.demandas || []).filter(function (d) {
      return d.status !== 'Cancelada' && d.status !== 'Concluída';
    }));

    fila.forEach(function (demanda) {
      var teste = catalogo[demanda.testeId];
      if (!teste) {
        naoAlocadas.push({ demandaId: demanda.id, motivo: 'Ensaio não encontrado no catálogo.' });
        return;
      }

      var amostras = Math.max(1, Number(demanda.amostras) || teste.amostrasPadrao || 1);
      var corridas = Math.max(1, Math.ceil(amostras / (teste.amostrasPorCorrida || 1)));
      var horas = teste.duracaoHoras * corridas;
      var custo = teste.custoSetup * corridas + teste.custoAmostra * amostras;

      var candidatos = equipamentos.filter(function (e) { return e.tipo === teste.equipTipo; });
      if (!candidatos.length) {
        naoAlocadas.push({
          demandaId: demanda.id, testeId: teste.id,
          motivo: 'Nenhuma unidade do tipo ' + teste.equipTipo + ' cadastrada.'
        });
        return;
      }

      var inicioMin = util.maiorData(dataBase, demanda.dataPecaDisponivel || dataBase);
      var melhor = null;

      candidatos.forEach(function (equip) {
        var horasDia = equip.horasPorDia || 8;
        var diasNecessarios = Math.max(1, Math.ceil(horas / horasDia));
        var dias = buscarJanela(equip, ocupacao.get(equip.id), inicioMin, diasNecessarios, limite);
        if (!dias) return;
        var cand = {
          equip: equip,
          dias: dias,
          inicio: dias[0],
          fim: dias[dias.length - 1],
          diasProdutivos: diasNecessarios
        };
        if (!melhor || cand.fim < melhor.fim || (cand.fim === melhor.fim && cand.inicio < melhor.inicio)) {
          melhor = cand;
        }
      });

      if (!melhor) {
        naoAlocadas.push({
          demandaId: demanda.id, testeId: teste.id,
          motivo: 'Sem janela livre em ' + teste.equipTipo + ' dentro de ' + horizonte + ' dias.'
        });
        return;
      }

      reservar(ocupacao.get(melhor.equip.id), melhor.dias);

      var atraso = demanda.dataAlvo ? Math.max(0, util.diffDias(demanda.dataAlvo, melhor.fim)) : 0;
      alocacoes.push({
        demandaId: demanda.id,
        testeId: teste.id,
        clienteId: teste.clienteId,
        equipamentoId: melhor.equip.id,
        inicio: melhor.inicio,
        fim: melhor.fim,
        dias: melhor.dias,
        diasProdutivos: melhor.diasProdutivos,
        diasCorridos: util.diffDias(melhor.inicio, melhor.fim) + 1,
        esperaDias: util.diffDias(inicioMin, melhor.inicio),
        corridas: corridas,
        amostras: amostras,
        horas: horas,
        custo: custo,
        atrasoDias: atraso,
        noPrazo: atraso === 0
      });
    });

    return {
      dataBase: dataBase,
      alocacoes: alocacoes,
      naoAlocadas: naoAlocadas,
      ocupacao: ocupacao,
      resumo: resumir(alocacoes, naoAlocadas, equipamentos, ocupacao)
    };
  }

  function resumir(alocacoes, naoAlocadas, equipamentos, ocupacao) {
    var custo = util.soma(alocacoes, function (a) { return a.custo; });
    var horas = util.soma(alocacoes, function (a) { return a.horas; });
    var noPrazo = alocacoes.filter(function (a) { return a.noPrazo; }).length;
    var fim = alocacoes.reduce(function (m, a) { return !m || a.fim > m ? a.fim : m; }, null);
    var inicio = alocacoes.reduce(function (m, a) { return !m || a.inicio < m ? a.inicio : m; }, null);

    var utilizacao = equipamentos.map(function (e) {
      var mapa = ocupacao.get(e.id) || new Map();
      var diasOcupados = 0;
      mapa.forEach(function (v) { diasOcupados += v; });
      return {
        equipamentoId: e.id,
        diasSlot: diasOcupados,
        diasDistintos: mapa.size,
        horas: diasOcupados * (e.horasPorDia || 8)
      };
    });

    return {
      testes: alocacoes.length,
      pendencias: naoAlocadas.length,
      custoTotal: custo,
      horasTotais: horas,
      noPrazo: noPrazo,
      atrasados: alocacoes.length - noPrazo,
      aderencia: alocacoes.length ? Math.round((noPrazo / alocacoes.length) * 100) : 100,
      primeiroInicio: inicio,
      ultimoFim: fim,
      utilizacao: utilizacao
    };
  }

  return {
    planejar: planejar,
    ordenarDemandas: ordenarDemandas,
    buscarJanela: buscarJanela,
    diaElegivel: diaElegivel,
    emManutencao: emManutencao,
    pesoPrioridade: pesoPrioridade
  };
});
