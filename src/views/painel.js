/* Painel: leitura gerencial do que foi confirmado — custo por cliente, por fase e por área,
   carga de bancada e o que está fora do prazo. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  function agrupar(alocacoes, chave) {
    var mapa = {};
    alocacoes.forEach(function (a) {
      var k = chave(a) || '—';
      var g = mapa[k] = mapa[k] || { chave: k, custo: 0, horas: 0, ensaios: 0 };
      g.custo += a.custo.total;
      g.horas += a.custo.horas;
      g.ensaios += 1;
    });
    return Object.keys(mapa).map(function (k) { return mapa[k]; })
      .sort(function (a, b) { return b.custo - a.custo; });
  }

  function barras(grupos, rotulo) {
    if (!grupos.length) return ui.vazio('Sem dados', 'Confirme testes no catálogo para alimentar o painel.');
    var maximo = grupos[0].custo || 1;
    return '<table><thead><tr><th>' + e(rotulo) + '</th><th class="num">Ensaios</th><th class="num">Horas</th>' +
      '<th style="width:38%">Custo</th></tr></thead><tbody>' +
      grupos.map(function (g) {
        return '<tr><td class="forte">' + e(g.chave) + '</td>' +
          '<td class="num">' + g.ensaios + '</td>' +
          '<td class="num">' + Math.round(g.horas) + ' h</td>' +
          '<td><div style="display:flex;align-items:center;gap:9px">' +
            '<span class="barra-trilho" style="flex:1"><span class="barra-valor" style="width:' +
              Math.round(g.custo / maximo * 100) + '%"></span></span>' +
            '<span class="forte" style="min-width:92px;text-align:right">' + e(util.formatarMoeda(g.custo)) + '</span>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function render(container, ctx) {
    var estado = ctx.estado, hoje = ctx.hoje;
    var todas = ctx.plano.alocacoes.filter(function (a) { return a.demanda.status !== 'CANCELADO'; });

    var custoTotal = 0, horasTotal = 0, atrasadas = 0, semJanela = 0, concluidas = 0, cotacoes = 0;
    todas.forEach(function (a) {
      custoTotal += a.custo.total;
      horasTotal += a.custo.horas;
      if (a.atrasado) atrasadas++;
      if (a.cotacao) cotacoes++;
      else if (!a.inicio && TC.scheduler.STATUS_ATIVOS.indexOf(a.demanda.status) !== -1) semJanela++;
      if (a.demanda.status === 'CONCLUIDO') concluidas++;
    });

    var proximos = ctx.plano.agendadas.filter(function (a) {
      var d = util.diffDias(hoje, a.inicio);
      return d >= 0 && d <= 30;
    }).sort(function (a, b) { return util.diffDias(b.inicio, a.inicio); });

    var emCurso = ctx.plano.agendadas.filter(function (a) {
      return util.diffDias(a.inicio, hoje) >= 0 && util.diffDias(hoje, a.fim) >= 0;
    });

    var alertas = [];
    todas.forEach(function (a) {
      if (a.atrasado) {
        alertas.push({ tipo: 'erro', texto: (a.teste ? a.teste.nome : a.demanda.testeId) + ' em ' +
          (a.peca ? a.peca.nome : '—') + ' termina ' + Math.abs(a.folga) + ' dia(s) após o prazo de ' +
          util.formatarData(a.demanda.prazo, true) + '.' });
      }
      if (!a.cotacao && !a.inicio && TC.scheduler.STATUS_ATIVOS.indexOf(a.demanda.status) !== -1) {
        alertas.push({ tipo: 'erro', texto: (a.teste ? a.teste.nome : a.demanda.testeId) + ': ' + a.motivo });
      }
    });
    /* Demanda cuja amostra ainda não chegou e cujo prazo já está próximo: a janela
       de execução aperta antes mesmo de a peça entrar no laboratório. */
    ctx.plano.agendadas.forEach(function (a) {
      var esperaAmostra = util.diffDias(hoje, a.demanda.dataAmostras);
      if (esperaAmostra > 0 && a.folga !== null && a.folga !== undefined && a.folga >= 0 && a.folga < 7) {
        alertas.push({ tipo: 'alerta', texto: (a.teste ? a.teste.nome : a.demanda.testeId) +
          ' (LTI ' + (a.demanda.lti || '—') + '): amostras só em ' +
          util.formatarData(a.demanda.dataAmostras, true) + ' e apenas ' + a.folga + ' dia(s) de folga no prazo.' });
      }
    });

    var porCliente = agrupar(todas, function (a) {
      var c = util.porId(estado.clientes, a.demanda.clienteId);
      return c ? c.nome : a.demanda.clienteId;
    });
    /* Cotação fica de fora do agrupamento por fase: ela não representa carga de bancada,
       é orçamento pendente de confirmação. */
    var porFase = agrupar(todas.filter(function (a) { return !a.cotacao; }), function (a) {
      var f = util.porId(TC.data.FASES, a.demanda.tipoLti);
      return f ? f.nome : a.demanda.tipoLti;
    });
    var porArea = agrupar(todas, function (a) {
      var ar = a.teste ? util.porId(TC.data.AREAS, a.teste.area) : null;
      return ar ? ar.nome : '—';
    });

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Painel de validação</h2>' +
        '<p>Posição consolidada de tudo que foi confirmado: quanto custa, quanto ocupa de bancada e o que ameaça o prazo.</p></div>' +
      '</div>' +
      '<div class="indicadores">' +
        '<div class="indicador"><div class="rotulo">Custo confirmado</div><div class="valor">' + util.formatarMoeda(custoTotal) + '</div>' +
          '<div class="nota">' + todas.length + ' ensaios · ' + concluidas + ' concluídos</div></div>' +
        '<div class="indicador"><div class="rotulo">Horas de bancada</div><div class="valor">' + Math.round(horasTotal) + ' h</div>' +
          '<div class="nota">setup + ensaio</div></div>' +
        '<div class="indicador"><div class="rotulo">Em execução hoje</div><div class="valor">' + emCurso.length + '</div>' +
          '<div class="nota">' + proximos.length + ' iniciam em 30 dias</div></div>' +
        '<div class="indicador"><div class="rotulo">Riscos de prazo</div>' +
          '<div class="valor" style="color:' + (atrasadas + semJanela ? 'var(--erro)' : 'var(--ok)') + '">' + (atrasadas + semJanela) + '</div>' +
          '<div class="nota">' + atrasadas + ' fora do prazo · ' + semJanela + ' sem janela</div></div>' +
        '<div class="indicador"><div class="rotulo">Cotações</div><div class="valor">' + cotacoes + '</div>' +
          '<div class="nota">orçamento, fora do planejamento</div></div>' +
      '</div>' +
      (alertas.length
        ? '<div class="cartao"><div class="cartao-topo"><h3>Pontos de atenção</h3></div><div class="cartao-corpo">' +
          alertas.slice(0, 12).map(function (al) {
            return '<div class="aviso ' + al.tipo + '" style="margin-bottom:8px">' + e(al.texto) + '</div>';
          }).join('') +
          (alertas.length > 12 ? '<div class="sub">+ ' + (alertas.length - 12) + ' outros.</div>' : '') +
          '</div></div>'
        : '') +
      '<div class="cartao"><div class="cartao-topo"><h3>Custo por cliente</h3></div>' +
        '<div class="tabela-rolagem">' + barras(porCliente, 'Cliente') + '</div></div>' +
      '<div class="cartao"><div class="cartao-topo"><h3>Custo por fase de projeto</h3>' +
        '<span class="sub">cotações não entram, pois ainda não são serviço confirmado</span></div>' +
        '<div class="tabela-rolagem">' + barras(porFase, 'Fase') + '</div></div>' +
      '<div class="cartao"><div class="cartao-topo"><h3>Custo por área do sistema</h3></div>' +
        '<div class="tabela-rolagem">' + barras(porArea, 'Área') + '</div></div>' +
      '<div class="cartao"><div class="cartao-topo"><h3>Próximos 30 dias</h3>' +
        '<span class="sub">ensaios que entram em bancada</span></div>' +
        (proximos.length
          ? '<div class="tabela-rolagem"><table><thead><tr><th>Início</th><th>Procedimento</th><th>Peça</th>' +
            '<th>Equipamento</th><th class="num">Duração</th><th class="num">Custo</th></tr></thead><tbody>' +
            proximos.map(function (a) {
              return '<tr><td class="forte">' + e(util.formatarData(a.inicio, true)) + '</td>' +
                '<td>' + e(a.teste.nome) + '</td>' +
                '<td>' + e(a.peca ? a.peca.nome : '—') + '</td>' +
                '<td>' + e(a.equipamentos.map(function (eq) { return eq.nome; }).join(' + ')) + '</td>' +
                '<td class="num">' + (util.diffDias(a.inicio, a.fim) + 1) + ' d</td>' +
                '<td class="num">' + e(util.formatarMoeda(a.custo.total)) + '</td></tr>';
            }).join('') + '</tbody></table></div>'
          : ui.vazio('Nada entra em bancada nos próximos 30 dias', '')) +
      '</div>';
  }

  TC.views = TC.views || {};
  TC.views.painel = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
