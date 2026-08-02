/* Indicadores do centro de testes.
   Módulo puro: recebe estado e plano, devolve números. Roda no Node, é testado, e não
   toca em interface — é aqui que mora a definição de cada KPI, para o painel não virar
   um amontoado de contas escondidas em HTML. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util || (typeof require !== 'undefined' ? require('./util.js') : null);
  var scheduler = TC.scheduler || (typeof require !== 'undefined' ? require('./scheduler.js') : null);

  /* '2026-08-14' -> '2026-08' */
  function mesDe(iso) {
    return iso ? String(iso).slice(0, 7) : '';
  }

  function anoDe(iso) {
    return iso ? String(iso).slice(0, 4) : '';
  }

  function primeiroDia(mes) {
    return mes + '-01';
  }

  /* Último dia do mês, sem depender de tabela de dias por mês: dia 1 do mês seguinte -1. */
  function ultimoDia(mes) {
    var ano = Number(mes.slice(0, 4));
    var m = Number(mes.slice(5, 7));
    var proximo = m === 12 ? (ano + 1) + '-01-01' : ano + '-' + String(m + 1).padStart(2, '0') + '-01';
    return util.somaDias(proximo, -1);
  }

  function dentroDoMes(iso, mes) {
    return !!iso && mesDe(iso) === mes;
  }

  /* Percorre os dias do mês uma vez só. */
  function porDiaDoMes(mes, fn) {
    var dia = primeiroDia(mes);
    var fim = ultimoDia(mes);
    while (util.diffDias(dia, fim) >= 0) {
      fn(dia);
      dia = util.somaDias(dia, 1);
    }
  }

  /* Horas que o equipamento tem para oferecer no mês: dias em que ele opera, descontada
     a manutenção, vezes o turno, vezes as posições em paralelo. É a capacidade contra a
     qual a ocupação é medida. */
  function capacidadeNoMes(equipamento, mes) {
    var horasDia = equipamento.continuo ? 24 : (equipamento.horasDia || 8);
    var horas = 0, diasUteis = 0, diasParados = 0;
    porDiaDoMes(mes, function (dia) {
      if (!scheduler.ehDiaUtil(equipamento, dia)) return;
      if (scheduler.emManutencao(equipamento, dia)) { diasParados++; return; }
      diasUteis++;
      horas += horasDia * (equipamento.posicoes || 1);
    });
    return { horas: horas, diasUteis: diasUteis, diasParados: diasParados, horasDia: horasDia };
  }

  /* Dias de operação da janela de um ensaio que caem dentro do mês.
     Dia de operação é dia em que todas as bancadas do ensaio trabalham — o mesmo critério
     que o planejamento usou para montar a janela. */
  function diasDeOperacaoNoMes(alocacao, mes) {
    if (!alocacao.inicio || !alocacao.fim) return 0;
    var lista = alocacao.equipamentos || [];
    if (!lista.length) return 0;
    var dias = 0;
    porDiaDoMes(mes, function (dia) {
      if (util.diffDias(alocacao.inicio, dia) < 0 || util.diffDias(dia, alocacao.fim) < 0) return;
      for (var i = 0; i < lista.length; i++) {
        if (!scheduler.ehDiaUtil(lista[i], dia)) return;
      }
      dias++;
    });
    return dias;
  }

  /* Horas de bancada do ensaio que caem no mês. Um ensaio de 47 dias atravessa meses, então
     as horas são rateadas pelos dias de operação: o mês só recebe o que roda nele. */
  function horasNoMes(alocacao, mes) {
    if (!alocacao.teste) return 0;
    var totalDias = alocacao.diasOperacao || 0;
    if (!totalDias) return 0;
    var noMes = diasDeOperacaoNoMes(alocacao, mes);
    if (!noMes) return 0;
    return scheduler.horasDeBancada(alocacao.teste) * (noMes / totalDias);
  }

  /* Ocupação de cada unidade no mês: o que o planejamento reservou contra o que existe.
     O ensaio que ocupa duas bancadas ao mesmo tempo conta as horas nas duas — é isso que
     acontece de fato com a agenda delas. */
  function ocupacaoNoMes(estado, plano, mes) {
    var porEquipamento = {};
    estado.equipamentos.forEach(function (eq) {
      var cap = capacidadeNoMes(eq, mes);
      porEquipamento[eq.id] = {
        equipamento: eq,
        grupo: scheduler.grupoDe(eq),
        horasPlanejadas: 0,
        capacidade: cap.horas,
        diasUteis: cap.diasUteis,
        diasParados: cap.diasParados,
        ensaios: 0
      };
    });

    plano.agendadas.forEach(function (a) {
      var horas = horasNoMes(a, mes);
      if (!horas) return;
      (a.equipamentos || []).forEach(function (eq) {
        var registro = porEquipamento[eq.id];
        if (!registro) return;
        registro.horasPlanejadas += horas;
        registro.ensaios++;
      });
    });

    return estado.equipamentos.map(function (eq) {
      var r = porEquipamento[eq.id];
      r.ocupacao = r.capacidade ? r.horasPlanejadas / r.capacidade : 0;
      return r;
    });
  }

  /* O planejamento só devolve demanda ativa: concluída e cancelada saem dele, porque não
     disputam mais bancada. Só que o painel precisa justamente das concluídas — daí esta
     visão, que percorre todas as demandas e reaproveita a alocação quando existe. */
  function demandasComCusto(estado, plano) {
    var porDemanda = {};
    plano.alocacoes.forEach(function (a) { porDemanda[a.demandaId] = a; });

    return (estado.demandas || []).map(function (d) {
      var alocada = porDemanda[d.id];
      if (alocada) return alocada;
      var teste = util.porId(estado.testes, d.testeId);
      var peca = util.porId(estado.pecas, d.pecaId);
      return {
        demandaId: d.id, demanda: d, teste: teste, peca: peca,
        equipamentos: [], inicio: null, fim: null, diasOperacao: 0,
        cotacao: scheduler.ehCotacao(d),
        custo: scheduler.custoDemanda(d, teste, null, peca, scheduler.taxaHoraria(estado))
      };
    });
  }

  /* Testes realizados no mês: demanda concluída, pela data em que de fato terminou.
     Quem ainda está ativo tem fim planejado e serve de referência; quem já foi concluído
     saiu do planejamento e só tem a data informada. Sem ela o ensaio não pode ser
     atribuído a mês nenhum — por isso concluidasSemData() existe: em vez de chutar um
     mês, o painel mostra o que falta preencher. */
  function dataDeConclusao(alocacao) {
    if (alocacao.demanda.dataConclusao) return alocacao.demanda.dataConclusao;
    return alocacao.fim || '';
  }

  function concluidasSemData(estado) {
    return (estado.demandas || []).filter(function (d) {
      return d.status === 'CONCLUIDO' && !d.dataConclusao;
    });
  }

  function realizadosNoMes(estado, plano, mes) {
    return demandasComCusto(estado, plano).filter(function (a) {
      return a.demanda.status === 'CONCLUIDO' && dentroDoMes(dataDeConclusao(a), mes);
    });
  }

  /* Certo da primeira vez: relatório validado pelo cliente sem nenhuma rodada de correção.
     Mede-se sobre os relatórios aprovados no mês — o que ainda está em análise não conta
     nem a favor nem contra, porque o veredito não saiu. */
  function certoDaPrimeiraVez(estado, plano, mes) {
    var aprovados = demandasComCusto(estado, plano).filter(function (a) {
      return a.demanda.relatorioStatus === 'APROVADO' &&
        dentroDoMes(a.demanda.dataRelatorio || dataDeConclusao(a), mes);
    });
    var semCorrecao = aprovados.filter(function (a) {
      return !(Number(a.demanda.relatorioCorrecoes) || 0);
    });
    return {
      aprovados: aprovados.length,
      semCorrecao: semCorrecao.length,
      comCorrecao: aprovados.length - semCorrecao.length,
      indice: aprovados.length ? semCorrecao.length / aprovados.length : null,
      lista: aprovados
    };
  }

  /* Agrupamento de custo. Cotação fica de fora: é orçamento, não serviço confirmado. */
  function agruparCusto(alocacoes, chave) {
    var mapa = {};
    alocacoes.forEach(function (a) {
      var k = chave(a) || '—';
      var g = mapa[k] = mapa[k] || { chave: k, custo: 0, horas: 0, ensaios: 0 };
      g.custo += a.custo.total;
      g.horas += a.custo.horasFaturaveis;
      g.ensaios++;
    });
    return Object.keys(mapa).map(function (k) { return mapa[k]; })
      .sort(function (a, b) { return b.custo - a.custo; });
  }

  function custoPorProjeto(estado, plano) {
    return agruparCusto(confirmadas(estado, plano), function (a) {
      return (a.demanda.projeto || '').trim() || 'Sem projeto';
    });
  }

  function custoPorCliente(estado, plano) {
    return agruparCusto(confirmadas(estado, plano), function (a) {
      var c = util.porId(estado.clientes, a.demanda.clienteId);
      return c ? c.nome : a.demanda.clienteId;
    });
  }

  /* Serviço confirmado: cotação é orçamento e fica de fora; cancelada não é serviço.
     Concluída entra — o custo do que já foi executado é o que mais importa no acumulado. */
  function confirmadas(estado, plano) {
    return demandasComCusto(estado, plano).filter(function (a) {
      return !a.cotacao && a.demanda.status !== 'CANCELADO';
    });
  }

  /* Custo de tudo que está planejado para o ano: soma dos ensaios cuja janela cai no ano.
     Um ensaio que atravessa o réveillon conta no ano em que começa, que é quando o
     compromisso foi assumido. */
  function custoPlanejadoNoAno(plano, ano) {
    var doAno = plano.agendadas.filter(function (a) { return anoDe(a.inicio) === String(ano); });
    var custo = 0, horas = 0;
    doAno.forEach(function (a) {
      custo += a.custo.total;
      horas += a.custo.horasBancada;
    });
    return { ensaios: doAno.length, custo: custo, horas: horas, lista: doAno };
  }

  /* Meses que aparecem no seletor: os que têm algo planejado ou concluído, mais o corrente. */
  function mesesComMovimento(estado, plano, hoje) {
    var meses = {};
    meses[mesDe(hoje)] = true;
    demandasComCusto(estado, plano).forEach(function (a) {
      if (a.inicio) meses[mesDe(a.inicio)] = true;
      if (a.fim) meses[mesDe(a.fim)] = true;
      if (a.demanda.dataConclusao) meses[mesDe(a.demanda.dataConclusao)] = true;
      if (a.demanda.dataRelatorio) meses[mesDe(a.demanda.dataRelatorio)] = true;
    });
    return Object.keys(meses).sort().reverse();
  }

  TC.kpi = {
    mesDe: mesDe,
    anoDe: anoDe,
    primeiroDia: primeiroDia,
    ultimoDia: ultimoDia,
    capacidadeNoMes: capacidadeNoMes,
    diasDeOperacaoNoMes: diasDeOperacaoNoMes,
    horasNoMes: horasNoMes,
    ocupacaoNoMes: ocupacaoNoMes,
    realizadosNoMes: realizadosNoMes,
    certoDaPrimeiraVez: certoDaPrimeiraVez,
    custoPorProjeto: custoPorProjeto,
    custoPorCliente: custoPorCliente,
    custoPlanejadoNoAno: custoPlanejadoNoAno,
    mesesComMovimento: mesesComMovimento,
    demandasComCusto: demandasComCusto,
    confirmadas: confirmadas,
    dataDeConclusao: dataDeConclusao,
    concluidasSemData: concluidasSemData
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.kpi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
