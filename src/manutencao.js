/* Gestão da manutenção das bancadas.
   Uma parada tem duas vidas: primeiro é planejada (e já bloqueia a agenda do equipamento),
   depois é realizada (e passa a registrar o que de fato foi feito). Este módulo responde as
   perguntas de gestão — qual foi a última, o que foi feito nela, quando é a próxima e o que
   está atrasado. Puro e testado; a tela só desenha. */
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

  /* A última manutenção é a realizada que terminou mais tarde — é dela que sai "o que foi
     feito" na tela. */
  function ultimaRealizada(equipamento) {
    return realizadas(equipamento).reduce(function (maior, m) {
      if (!maior) return m;
      return util.diffDias(maior.fim, m.fim) > 0 ? m : maior;
    }, null);
  }

  /* A próxima prevista é a planejada que começa mais cedo daqui para a frente. Uma parada
     planejada que já deveria ter acontecido não é "a próxima": é atraso, e aparece à parte. */
  function proximaPlanejada(equipamento, hoje) {
    return planejadas(equipamento).reduce(function (menor, m) {
      if (util.diffDias(hoje, m.fim) < 0) return menor;
      if (!menor) return m;
      return util.diffDias(m.inicio, menor.inicio) > 0 ? m : menor;
    }, null);
  }

  /* Planejada cujo período já passou sem ninguém registrar o que foi feito. */
  function atrasadas(equipamento, hoje) {
    /* diffDias(a, b) é b - a: a parada está vencida quando o fim ficou para trás. */
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

  /* Equipamentos que exigem atenção agora: parada vencida sem registro, ou nenhuma parada
     futura agendada. A segunda não é erro — é a pergunta que o gestor precisa responder. */
  function pendencias(estado, hoje) {
    var lista = [];
    (estado.equipamentos || []).forEach(function (eq) {
      var s = situacao(eq, hoje);
      s.atrasadas.forEach(function (m) {
        lista.push({
          tipo: 'atrasada', equipamento: eq, parada: m,
          texto: eq.nome + ': parada de ' + util.formatarData(m.inicio, true) + ' a ' +
            util.formatarData(m.fim, true) + ' não teve o registro do que foi feito.'
        });
      });
      if (!s.proxima) {
        lista.push({
          tipo: 'sem-proxima', equipamento: eq, parada: null,
          texto: eq.nome + ': sem próxima manutenção agendada.'
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
