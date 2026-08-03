/* Rig maintenance management.
   A downtime has two lives: first it is planned (and already blocks the equipment calendar),
   then it is carried out (and starts recording what was actually done). This module answers
   the management questions — which was the last one, what was done in it, when is the next
   one and what is overdue. Pure and tested; the screen only draws. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util || (typeof require !== 'undefined' ? require('./util.js') : null);

  var PLANEJADA = 'PLANEJADA';
  var REALIZADA = 'REALIZADA';

  function paradas(equipamento) {
    return (equipamento && equipamento.manutencao) || [];
  }

  function realizadas(equipamento) {
    return paradas(equipamento).filter(function (m) { return m.situacao === REALIZADA; });
  }

  function planejadas(equipamento) {
    return paradas(equipamento).filter(function (m) { return m.situacao !== REALIZADA; });
  }

  /* The last maintenance is the carried-out one that ended latest — it is where "what was
     done" on screen comes from. */
  function ultimaRealizada(equipamento) {
    return realizadas(equipamento).reduce(function (maior, m) {
      if (!maior) return m;
      return util.diffDias(maior.fim, m.fim) > 0 ? m : maior;
    }, null);
  }

  /* The next planned one is the planned downtime starting soonest from here on. A planned
     downtime that should already have happened is not "the next one": it is overdue, and it
     shows up separately. */
  function proximaPlanejada(equipamento, hoje) {
    return planejadas(equipamento).reduce(function (menor, m) {
      if (util.diffDias(hoje, m.fim) < 0) return menor;
      if (!menor) return m;
      return util.diffDias(m.inicio, menor.inicio) > 0 ? m : menor;
    }, null);
  }

  /* A planned downtime whose period has passed with nobody recording what was done. */
  function atrasadas(equipamento, hoje) {
    /* diffDias(a, b) is b - a: the downtime is overdue when its end is behind us. */
    return planejadas(equipamento).filter(function (m) {
      return util.diffDias(m.fim, hoje) > 0;
    }).sort(function (a, b) { return util.diffDias(b.fim, a.fim); });
  }

  /* Resumo por equipamento, do jeito que a linha da tabela precisa. */
  function situacao(equipamento, hoje) {
    var ultima = ultimaRealizada(equipamento);
    var proxima = proximaPlanejada(equipamento, hoje);
    var emAtraso = atrasadas(equipamento, hoje);
    return {
      ultima: ultima,
      proxima: proxima,
      atrasadas: emAtraso,
      /* Dias desde a última: quanto tempo a bancada roda sem intervenção. */
      diasDesdeUltima: ultima ? util.diffDias(ultima.fim, hoje) : null,
      /* Negativo não acontece: proximaPlanejada já descarta o que ficou para trás. */
      diasParaProxima: proxima ? util.diffDias(hoje, proxima.inicio) : null,
      emManutencaoHoje: paradas(equipamento).some(function (m) {
        return util.diffDias(m.inicio, hoje) >= 0 && util.diffDias(hoje, m.fim) >= 0;
      })
    };
  }

  /* Equipment needing attention now: an overdue downtime with no record, or no future
     downtime scheduled. The second is not an error — it is the question the manager has to
     answer. */
  function pendencias(estado, hoje) {
    var lista = [];
    (estado.equipamentos || []).forEach(function (eq) {
      var s = situacao(eq, hoje);
      s.atrasadas.forEach(function (m) {
        lista.push({
          tipo: 'atrasada', equipamento: eq, parada: m,
          texto: eq.nome + ': downtime from ' + util.formatarData(m.inicio, true) + ' to ' +
            util.formatarData(m.fim, true) + ' has no record of what was done.'
        });
      });
      if (!s.proxima) {
        lista.push({
          tipo: 'sem-proxima', equipamento: eq, parada: null,
          texto: eq.nome + ': no next maintenance scheduled.'
        });
      }
    });
    return lista;
  }

  TC.manutencao = {
    PLANEJADA: PLANEJADA,
    REALIZADA: REALIZADA,
    paradas: paradas,
    realizadas: realizadas,
    planejadas: planejadas,
    ultimaRealizada: ultimaRealizada,
    proximaPlanejada: proximaPlanejada,
    atrasadas: atrasadas,
    situacao: situacao,
    pendencias: pendencias
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.manutencao;
})(typeof globalThis !== 'undefined' ? globalThis : this);
