/* Dashboard: the test centre's management indicators.
   Volume for the month, each rig's utilisation against its own capacity, the quality of the
   report delivered to the customer, and where the money goes — by project, by customer and
   across the year. The arithmetic lives in src/kpi.js; here we only draw. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  var MESES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function nomeDoMes(mes) {
    return MESES[Number(mes.slice(5, 7)) - 1] + ' ' + mes.slice(0, 4);
  }

  function porcento(fracao) {
    return Math.round((fracao || 0) * 100) + '%';
  }

  /* Utilisation goes past 100% when the schedule has reserved more hours than the rig has
     in the month — a sign of a bottleneck, not of an arithmetic error. */
  function corDaOcupacao(ocupacao) {
    if (ocupacao > 1) return 'erro';
    if (ocupacao >= 0.85) return 'alerta';
    return '';
  }

  function tabelaDeCusto(grupos, rotulo, vazio) {
    if (!grupos.length) return ui.vazio(vazio[0], vazio[1]);
    var maximo = grupos[0].custo || 1;
    var total = grupos.reduce(function (s, g) { return s + g.custo; }, 0);
    return '<table><thead><tr><th>' + e(rotulo) + '</th><th class="num">Tests</th>' +
      '<th class="num">Hours</th><th style="width:38%">Cost</th></tr></thead><tbody>' +
      grupos.map(function (g) {
        return '<tr><td class="forte">' + e(g.chave) + '</td>' +
          '<td class="num">' + g.ensaios + '</td>' +
          '<td class="num">' + Math.round(g.horas) + ' h</td>' +
          '<td><div style="display:flex;align-items:center;gap:9px">' +
            '<span class="barra-trilho" style="flex:1"><span class="barra-valor" style="width:' +
              Math.round(g.custo / maximo * 100) + '%"></span></span>' +
            '<span class="forte" style="min-width:96px;text-align:right">' +
              e(util.formatarMoeda(g.custo)) + '</span>' +
          '</div></td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><td class="forte">Total</td>' +
        '<td class="num forte">' + grupos.reduce(function (s, g) { return s + g.ensaios; }, 0) + '</td>' +
        '<td class="num forte">' + Math.round(grupos.reduce(function (s, g) { return s + g.horas; }, 0)) + ' h</td>' +
        '<td class="num forte">' + e(util.formatarMoeda(total)) + '</td></tr></tfoot></table>';
  }

  function render(container, ctx) {
    var estado = ctx.estado, hoje = ctx.hoje, plano = ctx.plano;
    var kpi = TC.kpi;

    var meses = kpi.mesesComMovimento(estado, plano, hoje);
    var mes = ctx.filtros.mesPainel && meses.indexOf(ctx.filtros.mesPainel) !== -1
      ? ctx.filtros.mesPainel : kpi.mesDe(hoje);
    var ano = kpi.anoDe(mes);

    var realizados = kpi.realizadosNoMes(estado, plano, mes);
    var ftt = kpi.certoDaPrimeiraVez(estado, plano, mes);
    var ocupacao = kpi.ocupacaoNoMes(estado, plano, mes);
    var noAno = kpi.custoPlanejadoNoAno(plano, ano);
    var porProjeto = kpi.custoPorProjeto(estado, plano);
    var porCliente = kpi.custoPorCliente(estado, plano);

    var horasMes = ocupacao.reduce(function (s, o) { return s + o.horasPlanejadas; }, 0);
    var capacidadeMes = ocupacao.reduce(function (s, o) { return s + o.capacidade; }, 0);

    var custoRealizado = realizados.reduce(function (s, a) { return s + a.custo.total; }, 0);
    var semData = kpi.concluidasSemData(estado);

    /* Riscos continuam no painel: são o que exige decisão nesta semana. */
    var atrasadas = 0, semJanela = 0;
    plano.alocacoes.forEach(function (a) {
      if (a.demanda.status === 'CANCELADA') return;
      if (a.atrasado) atrasadas++;
      else if (!a.cotacao && !a.inicio && TC.scheduler.STATUS_ATIVOS.indexOf(a.demanda.status) !== -1) semJanela++;
    });

    var indicadores =
      '<div class="indicadores">' +
        '<div class="indicador"><div class="rotulo">Tests carried out</div><div class="valor">' +
          realizados.length + '</div><div class="nota">completed in ' + e(nomeDoMes(mes)) +
          ' · ' + e(util.formatarMoeda(custoRealizado)) + '</div></div>' +

        '<div class="indicador"><div class="rotulo">Rig hours in the month</div><div class="valor">' +
          Math.round(horasMes) + ' h</div><div class="nota">of ' + Math.round(capacidadeMes) +
          ' h available · ' + porcento(capacidadeMes ? horasMes / capacidadeMes : 0) + ' of the fleet</div></div>' +

        '<div class="indicador"><div class="rotulo">Right first time</div>' +
          '<div class="valor"' + (ftt.indice !== null && ftt.indice < 0.8
            ? ' style="color:var(--alerta)"' : '') + '>' +
            (ftt.indice === null ? '—' : porcento(ftt.indice)) + '</div>' +
          '<div class="nota">' + (ftt.aprovados
            ? ftt.semCorrecao + ' of ' + ftt.aprovados + ' reports signed off with no rework'
            : 'no report signed off this month') + '</div></div>' +

        '<div class="indicador"><div class="rotulo">Scheduled in ' + e(ano) + '</div><div class="valor">' +
          util.formatarMoeda(noAno.custo) + '</div><div class="nota">' + noAno.ensaios +
          ' tests · ' + Math.round(noAno.horas) + ' h on the rigs</div></div>' +

        '<div class="indicador"><div class="rotulo">Due date risks</div>' +
          '<div class="valor" style="color:' + (atrasadas + semJanela ? 'var(--erro)' : 'var(--ok)') + '">' +
          (atrasadas + semJanela) + '</div><div class="nota">' + atrasadas +
          ' past due · ' + semJanela + ' with no slot</div></div>' +
      '</div>';

    /* Utilisation per unit, not per group: it is the unit that has a calendar and
       maintenance. */
    var linhasOcupacao = ocupacao.map(function (o) {
      var largura = Math.min(100, Math.round(o.ocupacao * 100));
      return '<tr>' +
        '<td><div class="forte">' + e(o.equipamento.nome) + '</div>' +
          '<div class="sub">' + e(o.grupo) +
          (o.equipamento.continuo ? ' · 24 h continuous' : ' · ' + o.equipamento.horasDia + ' h/day') +
          (o.diasParados ? ' · ' + o.diasParados + ' d under maintenance' : '') + '</div></td>' +
        '<td class="num">' + o.ensaios + '</td>' +
        '<td class="num">' + Math.round(o.horasPlanejadas) + ' h</td>' +
        '<td class="num">' + Math.round(o.capacidade) + ' h</td>' +
        '<td><div style="display:flex;align-items:center;gap:9px">' +
          '<span class="barra-trilho" style="flex:1"><span class="barra-valor ' +
            corDaOcupacao(o.ocupacao) + '" style="width:' + largura + '%"></span></span>' +
          '<span class="forte" style="min-width:52px;text-align:right">' +
            porcento(o.ocupacao) + '</span>' +
        '</div></td></tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Test centre dashboard</h2>' +
        '<p>Volume and utilisation for the month, the quality of the report delivered to the ' +
        'customer, and where the cost goes. The month\'s hours come from the schedule; ' +
        'completion and report sign-off are recorded on each request.</p></div>' +
        '<div class="acoes"><div class="campo" style="margin:0;min-width:190px">' +
          '<label for="f-mes">Reference month</label><select id="f-mes">' +
          meses.map(function (m) {
            return '<option value="' + e(m) + '"' + (m === mes ? ' selected' : '') + '>' +
              e(nomeDoMes(m)) + '</option>';
          }).join('') +
        '</select></div></div>' +
      '</div>' +
      indicadores +

      /* With no completion date the test cannot be assigned to any month. Rather than
         inventing one, the dashboard asks for it to be filled in. */
      (semData.length
        ? '<div class="cartao"><div class="cartao-corpo"><div class="aviso alerta" style="margin:0">' +
          '<strong>' + semData.length + ' test(s) marked as completed with no completion date.</strong> ' +
          'They stay out of every month on the dashboard until the date is entered on the request: ' +
          e(semData.slice(0, 6).map(function (d) { return d.lti || d.id; }).join(', ')) +
          (semData.length > 6 ? ' and ' + (semData.length - 6) + ' more.' : '.') +
          '</div></div></div>'
        : '') +

      '<div class="cartao">' +
        '<div class="cartao-topo"><h3>Utilisation by equipment — ' + e(nomeDoMes(mes)) + '</h3>' +
          '<span class="sub">hours scheduled against the hours the rig has in the month</span></div>' +
        (linhasOcupacao
          ? '<div class="tabela-rolagem"><table><thead><tr><th>Equipment</th>' +
            '<th class="num">Tests</th><th class="num">Scheduled</th>' +
            '<th class="num">Available</th><th style="width:34%">Utilisation</th>' +
            '</tr></thead><tbody>' + linhasOcupacao + '</tbody></table></div>'
          : ui.vazio('No equipment registered', 'Register the rigs to measure utilisation.')) +
      '</div>' +

      '<div class="cartao"><div class="cartao-topo"><h3>Cost by project</h3>' +
        '<span class="sub">everything confirmed, quotes aside</span></div>' +
        '<div class="tabela-rolagem">' +
        tabelaDeCusto(porProjeto, 'Project',
          ['No cost by project', 'Confirm tests in the catalogue to feed the dashboard.']) +
        '</div></div>' +

      '<div class="cartao"><div class="cartao-topo"><h3>Cost by customer</h3></div>' +
        '<div class="tabela-rolagem">' +
        tabelaDeCusto(porCliente, 'Customer',
          ['No cost by customer', 'Confirm tests in the catalogue to feed the dashboard.']) +
        '</div></div>' +

      '<div class="cartao"><div class="cartao-topo"><h3>Tests completed in ' + e(nomeDoMes(mes)) + '</h3>' +
        '<span class="sub">with the status of the report</span></div>' +
        (realizados.length
          ? '<div class="tabela-rolagem"><table><thead><tr><th>Completion</th><th>Procedure</th>' +
            '<th>Project</th><th>Customer</th><th>LTI</th><th>Report</th>' +
            '<th class="num">Cost</th></tr></thead><tbody>' +
            realizados.map(function (a) {
              var d = a.demanda;
              var cliente = util.porId(estado.clientes, d.clienteId);
              var correcoes = Number(d.relatorioCorrecoes) || 0;
              return '<tr><td class="forte">' +
                e(util.formatarData(TC.kpi.dataDeConclusao(a), true)) + '</td>' +
                '<td>' + e(a.teste ? a.teste.nome : d.testeId) + '</td>' +
                '<td>' + e(d.projeto || '—') + '</td>' +
                '<td>' + e(cliente ? cliente.nome : d.clienteId) + '</td>' +
                '<td>' + ui.celulaLti(d) + '</td>' +
                '<td>' + ui.etiquetaEstado('demanda', d.status) +
                  (correcoes ? ' <span class="sub">' + correcoes + ' rework round(s)</span>' : '') + '</td>' +
                '<td class="num">' + e(util.formatarMoeda(a.custo.total)) + '</td></tr>';
            }).join('') + '</tbody></table></div>'
          : ui.vazio('No test completed in ' + nomeDoMes(mes),
              'Mark the request as completed and enter the date for it to count.')) +
      '</div>';

    var seletor = container.querySelector('#f-mes');
    seletor.addEventListener('change', function () {
      ctx.filtros.mesPainel = seletor.value;
      ctx.atualizar();
    });
  }

  TC.views = TC.views || {};
  TC.views.painel = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
