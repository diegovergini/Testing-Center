/* Test centre indicators.
   A pure module: it takes state and plan, returns numbers. It runs on Node, is tested, and
   never touches the interface — this is where each KPI definition lives, so the dashboard
   never becomes a pile of arithmetic hidden inside HTML. */
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

  /* Last day of the month, with no days-per-month table: day 1 of the next month, -1. */
  function ultimoDia(mes) {
    var ano = Number(mes.slice(0, 4));
    var m = Number(mes.slice(5, 7));
    var proximo = m === 12 ? (ano + 1) + '-01-01' : ano + '-' + String(m + 1).padStart(2, '0') + '-01';
    return util.somaDias(proximo, -1);
  }

  function dentroDoMes(iso, mes) {
    return !!iso && mesDe(iso) === mes;
  }

  /* Walks the days of the month exactly once. */
  function porDiaDoMes(mes, fn) {
    var dia = primeiroDia(mes);
    var fim = ultimoDia(mes);
    while (util.diffDias(dia, fim) >= 0) {
      fn(dia);
      dia = util.somaDias(dia, 1);
    }
  }

  /* Hours the machine has to offer in the month: the days it operates, minus maintenance,
     times the shift, times the parallel positions. This is the capacity utilisation is
     measured against. */
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

  /* Operating days of a test's slot that fall inside the month.
     An operating day is a day when every rig the test uses works — the same criterion the
     scheduler used to build the slot. */
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

  /* Rig hours of the test that fall in the month. A 47-day test spans months, so the hours
     are apportioned by operating day: the month only gets what actually runs in it. */
  function horasNoMes(alocacao, mes) {
    if (!alocacao.teste) return 0;
    var totalDias = alocacao.diasOperacao || 0;
    if (!totalDias) return 0;
    var noMes = diasDeOperacaoNoMes(alocacao, mes);
    if (!noMes) return 0;
    return scheduler.horasDeBancada(alocacao.teste) * (noMes / totalDias);
  }

  /* Each unit's utilisation in the month: what the schedule reserved against what exists.
     A test occupying two rigs at once counts its hours on both — that is what actually
     happens to their calendars. */
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

  /* The scheduler only returns active requests: completed and cancelled ones leave it,
     because they no longer compete for a rig. But the dashboard needs precisely the completed
     ones — hence this view, which walks every request and reuses the allocation when one
     exists. */
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

  /* Tests carried out in the month: completed requests, by the date they actually finished.
     Whatever is still active has a planned end and serves as a reference; whatever has been
     completed left the schedule and only has the date that was entered. Without it the test
     cannot be assigned to any month — which is why concluidasSemData() exists: rather than
     guessing a month, the dashboard shows what is still to be filled in. */
  function dataDeConclusao(alocacao) {
    if (alocacao.demanda.dataConclusao) return alocacao.demanda.dataConclusao;
    return alocacao.fim || '';
  }

  /* The test counts as run from the moment it is completed: everything after that (report
     sent, in rework, signed off) has already been on the rig and counts as carried out. */
  var EXECUTADOS = ['CONCLUIDA', 'RELATORIO_ENVIADO', 'EM_CORRECAO', 'VALIDADA'];

  function jaExecutada(demanda) {
    return EXECUTADOS.indexOf(demanda.status) !== -1;
  }

  function concluidasSemData(estado) {
    return (estado.demandas || []).filter(function (d) {
      return jaExecutada(d) && !d.dataConclusao;
    });
  }

  function realizadosNoMes(estado, plano, mes) {
    return demandasComCusto(estado, plano).filter(function (a) {
      return jaExecutada(a.demanda) && dentroDoMes(dataDeConclusao(a), mes);
    });
  }

  /* Right first time: a report signed off by the customer with no rework round at all. It is
     measured over the reports approved in the month — anything still under review counts
     neither for nor against, because the verdict is not in. */
  function certoDaPrimeiraVez(estado, plano, mes) {
    var aprovados = demandasComCusto(estado, plano).filter(function (a) {
      return a.demanda.status === 'VALIDADA' &&
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

  /* Cost grouping. Quotes stay out: they are budgets, not confirmed work. */
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
      return (a.demanda.projeto || '').trim() || 'No project';
    });
  }

  function custoPorCliente(estado, plano) {
    return agruparCusto(confirmadas(estado, plano), function (a) {
      var c = util.porId(estado.clientes, a.demanda.clienteId);
      return c ? c.nome : a.demanda.clienteId;
    });
  }

  /* Confirmed work: a quote is a budget and stays out; a cancelled one is not work.
     A completed one goes in — the cost of what has already run is what matters most in the
     running total. */
  function confirmadas(estado, plano) {
    return demandasComCusto(estado, plano).filter(function (a) {
      return !a.cotacao && a.demanda.status !== 'CANCELADA';
    });
  }

  /* Cost of everything scheduled for the year: the sum of the tests whose slot falls in the
     year. A test that runs across New Year counts in the year it starts, which is when the
     commitment was made. */
  function custoPlanejadoNoAno(plano, ano) {
    var doAno = plano.agendadas.filter(function (a) { return anoDe(a.inicio) === String(ano); });
    var custo = 0, horas = 0;
    doAno.forEach(function (a) {
      custo += a.custo.total;
      horas += a.custo.horasBancada;
    });
    return { ensaios: doAno.length, custo: custo, horas: horas, lista: doAno };
  }

  /* Months that show in the selector: the ones with something scheduled or completed, plus
     the current one. */
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
    concluidasSemData: concluidasSemData,
    jaExecutada: jaExecutada,
    EXECUTADOS: EXECUTADOS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.kpi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
