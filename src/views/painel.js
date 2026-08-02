/* Painel: os indicadores de gestão do centro de testes.
   Volume do mês, ocupação de cada bancada contra a capacidade dela, qualidade do relatório
   entregue ao cliente, e para onde vai o dinheiro — por projeto, por cliente e no ano.
   As contas ficam em src/kpi.js; aqui só se desenha. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function nomeDoMes(mes) {
    return MESES[Number(mes.slice(5, 7)) - 1] + ' de ' + mes.slice(0, 4);
  }

  function porcento(fracao) {
    return Math.round((fracao || 0) * 100) + '%';
  }

  /* Ocupação passa de 100% quando o planejamento reservou mais horas do que a bancada tem
     no mês — sinal de gargalo, não de erro de conta. */
  function corDaOcupacao(ocupacao) {
    if (ocupacao > 1) return 'erro';
    if (ocupacao >= 0.85) return 'alerta';
    return '';
  }

  function tabelaDeCusto(grupos, rotulo, vazio) {
    if (!grupos.length) return ui.vazio(vazio[0], vazio[1]);
    var maximo = grupos[0].custo || 1;
    var total = grupos.reduce(function (s, g) { return s + g.custo; }, 0);
    return '<table><thead><tr><th>' + e(rotulo) + '</th><th class="num">Ensaios</th>' +
      '<th class="num">Horas</th><th style="width:38%">Custo</th></tr></thead><tbody>' +
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
        '<div class="indicador"><div class="rotulo">Testes realizados</div><div class="valor">' +
          realizados.length + '</div><div class="nota">concluídos em ' + e(nomeDoMes(mes)) +
          ' · ' + e(util.formatarMoeda(custoRealizado)) + '</div></div>' +

        '<div class="indicador"><div class="rotulo">Horas de bancada no mês</div><div class="valor">' +
          Math.round(horasMes) + ' h</div><div class="nota">de ' + Math.round(capacidadeMes) +
          ' h disponíveis · ' + porcento(capacidadeMes ? horasMes / capacidadeMes : 0) + ' do parque</div></div>' +

        '<div class="indicador"><div class="rotulo">Certo da primeira vez</div>' +
          '<div class="valor"' + (ftt.indice !== null && ftt.indice < 0.8
            ? ' style="color:var(--alerta)"' : '') + '>' +
            (ftt.indice === null ? '—' : porcento(ftt.indice)) + '</div>' +
          '<div class="nota">' + (ftt.aprovados
            ? ftt.semCorrecao + ' de ' + ftt.aprovados + ' relatórios validados sem correção'
            : 'nenhum relatório validado no mês') + '</div></div>' +

        '<div class="indicador"><div class="rotulo">Planejado em ' + e(ano) + '</div><div class="valor">' +
          util.formatarMoeda(noAno.custo) + '</div><div class="nota">' + noAno.ensaios +
          ' ensaios · ' + Math.round(noAno.horas) + ' h de bancada</div></div>' +

        '<div class="indicador"><div class="rotulo">Riscos de prazo</div>' +
          '<div class="valor" style="color:' + (atrasadas + semJanela ? 'var(--erro)' : 'var(--ok)') + '">' +
          (atrasadas + semJanela) + '</div><div class="nota">' + atrasadas +
          ' fora do prazo · ' + semJanela + ' sem janela</div></div>' +
      '</div>';

    /* Ocupação por unidade, e não por grupo: é a unidade que tem agenda e manutenção. */
    var linhasOcupacao = ocupacao.map(function (o) {
      var largura = Math.min(100, Math.round(o.ocupacao * 100));
      return '<tr>' +
        '<td><div class="forte">' + e(o.equipamento.nome) + '</div>' +
          '<div class="sub">' + e(o.grupo) +
          (o.equipamento.continuo ? ' · contínuo 24 h' : ' · ' + o.equipamento.horasDia + ' h/dia') +
          (o.diasParados ? ' · ' + o.diasParados + ' d em manutenção' : '') + '</div></td>' +
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
        '<div><h2>Painel do centro de testes</h2>' +
        '<p>Volume e ocupação do mês, qualidade do relatório entregue ao cliente e para onde vai ' +
        'o custo. As horas do mês vêm do planejamento; a conclusão e a validação do relatório ' +
        'são registradas em cada demanda.</p></div>' +
        '<div class="acoes"><div class="campo" style="margin:0;min-width:190px">' +
          '<label for="f-mes">Mês de referência</label><select id="f-mes">' +
          meses.map(function (m) {
            return '<option value="' + e(m) + '"' + (m === mes ? ' selected' : '') + '>' +
              e(nomeDoMes(m)) + '</option>';
          }).join('') +
        '</select></div></div>' +
      '</div>' +
      indicadores +

      /* Sem data de conclusão o ensaio não pode ser atribuído a mês nenhum. Em vez de
         inventar um mês, o painel cobra o preenchimento. */
      (semData.length
        ? '<div class="cartao"><div class="cartao-corpo"><div class="aviso alerta" style="margin:0">' +
          '<strong>' + semData.length + ' teste(s) marcados como concluídos sem data de conclusão.</strong> ' +
          'Eles não entram em nenhum mês do painel até a data ser informada na demanda: ' +
          e(semData.slice(0, 6).map(function (d) { return d.lti || d.id; }).join(', ')) +
          (semData.length > 6 ? ' e mais ' + (semData.length - 6) + '.' : '.') +
          '</div></div></div>'
        : '') +

      '<div class="cartao">' +
        '<div class="cartao-topo"><h3>Ocupação por equipamento — ' + e(nomeDoMes(mes)) + '</h3>' +
          '<span class="sub">horas planejadas contra as horas que a bancada tem no mês</span></div>' +
        (linhasOcupacao
          ? '<div class="tabela-rolagem"><table><thead><tr><th>Equipamento</th>' +
            '<th class="num">Ensaios</th><th class="num">Planejadas</th>' +
            '<th class="num">Disponíveis</th><th style="width:34%">Ocupação</th>' +
            '</tr></thead><tbody>' + linhasOcupacao + '</tbody></table></div>'
          : ui.vazio('Nenhum equipamento cadastrado', 'Cadastre as bancadas para medir a ocupação.')) +
      '</div>' +

      '<div class="cartao"><div class="cartao-topo"><h3>Custo por projeto</h3>' +
        '<span class="sub">tudo que está confirmado, cotações à parte</span></div>' +
        '<div class="tabela-rolagem">' +
        tabelaDeCusto(porProjeto, 'Projeto',
          ['Sem custo por projeto', 'Confirme testes no catálogo para alimentar o painel.']) +
        '</div></div>' +

      '<div class="cartao"><div class="cartao-topo"><h3>Custo por cliente</h3></div>' +
        '<div class="tabela-rolagem">' +
        tabelaDeCusto(porCliente, 'Cliente',
          ['Sem custo por cliente', 'Confirme testes no catálogo para alimentar o painel.']) +
        '</div></div>' +

      '<div class="cartao"><div class="cartao-topo"><h3>Testes concluídos em ' + e(nomeDoMes(mes)) + '</h3>' +
        '<span class="sub">com a situação do relatório</span></div>' +
        (realizados.length
          ? '<div class="tabela-rolagem"><table><thead><tr><th>Conclusão</th><th>Procedimento</th>' +
            '<th>Projeto</th><th>Cliente</th><th>LTI</th><th>Relatório</th>' +
            '<th class="num">Custo</th></tr></thead><tbody>' +
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
                  (correcoes ? ' <span class="sub">' + correcoes + ' correção(ões)</span>' : '') + '</td>' +
                '<td class="num">' + e(util.formatarMoeda(a.custo.total)) + '</td></tr>';
            }).join('') + '</tbody></table></div>'
          : ui.vazio('Nenhum teste concluído em ' + nomeDoMes(mes),
              'Marque a demanda como concluída e informe a data para o indicador contar.')) +
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
