/* Planejamento: linha do tempo por equipamento e posição, gerada pelo motor de alocação. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  var ZOOMS = [
    { id: '9', nome: 'Trimestre', largura: 9 },
    { id: '16', nome: 'Mês', largura: 16 },
    { id: '30', nome: 'Semana', largura: 30 }
  ];

  /* Começa mostrando só o que tem ensaio alocado: o laboratório tem muito mais
     posições do que demandas em curso e a lista completa esconde o que interessa. */
  var preferencias = { zoom: '16', somenteOcupados: true };

  function segundaFeiraDe(iso) {
    var dia = util.diaDaSemana(iso);
    return util.somaDias(iso, dia === 0 ? -6 : 1 - dia);
  }

  function intervalo(alocacoes, hoje) {
    var inicio = hoje, fim = util.somaDias(hoje, 30);
    alocacoes.forEach(function (a) {
      if (!a.inicio) return;
      if (util.diffDias(a.inicio, inicio) > 0) inicio = a.inicio;
      if (util.diffDias(fim, a.fim) > 0) fim = a.fim;
    });
    inicio = segundaFeiraDe(inicio);
    fim = util.somaDias(fim, 10);
    var dias = util.diffDias(inicio, fim) + 1;
    if (dias > 730) { dias = 730; fim = util.somaDias(inicio, 729); }
    return { inicio: inicio, fim: fim, dias: dias };
  }

  /* A faixa começa sempre numa segunda-feira, então o fim de semana e as linhas de dia
     podem ser desenhados com dois gradientes que se repetem, em vez de milhares de divs. */
  function fundoDaFaixa(largura) {
    var semana = largura * 7;
    return 'background-image:' +
      'linear-gradient(to right, transparent 0, transparent ' + (largura * 5) + 'px, var(--surface-2) ' + (largura * 5) + 'px, var(--surface-2) ' + semana + 'px),' +
      'linear-gradient(to right, var(--border) 0, var(--border) 1px, transparent 1px);' +
      'background-size:' + semana + 'px 100%,' + largura + 'px 100%;';
  }

  function cabecalhoTempo(faixa, largura) {
    var html = '';
    var mesAtual = '';
    for (var i = 0; i < faixa.dias; i++) {
      var dia = util.somaDias(faixa.inicio, i);
      var d = util.paraData(dia);
      var mes = d.getUTCFullYear() + '-' + d.getUTCMonth();
      if (mes !== mesAtual) {
        mesAtual = mes;
        html += '<div class="gantt-mes" style="left:' + (i * largura) + 'px">' +
          e(util.formatarData(dia).split('/')[1].toUpperCase()) + ' ' + d.getUTCFullYear() + '</div>';
      }
      if (largura >= 16 && util.diaDaSemana(dia) === 1) {
        html += '<div class="gantt-numero" style="left:' + (i * largura) + 'px;width:' + (largura * 5) + 'px">' +
          e(util.formatarData(dia)) + '</div>';
      }
    }
    return html;
  }

  function marcadorHoje(faixa, largura, hoje) {
    var offset = util.diffDias(faixa.inicio, hoje);
    if (offset < 0 || offset >= faixa.dias) return '';
    return '<div class="gantt-dia hoje" title="Hoje" style="left:' + (offset * largura) + 'px;width:' + largura + 'px"></div>';
  }

  function blocosManutencao(equipamento, faixa, largura) {
    return (equipamento.manutencao || []).map(function (m) {
      var ini = Math.max(0, util.diffDias(faixa.inicio, m.inicio));
      var fimOffset = util.diffDias(faixa.inicio, m.fim);
      if (fimOffset < 0 || ini >= faixa.dias) return '';
      var largura_ = (Math.min(faixa.dias - 1, fimOffset) - ini + 1) * largura;
      return '<div class="gantt-dia manutencao" title="' + e(m.motivo || 'Manutenção') + '" style="left:' +
        (ini * largura) + 'px;width:' + largura_ + 'px"></div>';
    }).join('');
  }

  function barra(a, faixa, largura) {
    var offset = util.diffDias(faixa.inicio, a.inicio);
    var dias = util.diffDias(a.inicio, a.fim) + 1;
    if (offset + dias < 0 || offset >= faixa.dias) return '';
    var classe = { HOT: 'hot', COLD: 'cold', AMBOS: 'ambos' }[a.teste.area] || '';
    var titulo = a.teste.nome + (a.teste.revisao ? ' · ' + a.teste.revisao : '') +
      '\nLTI ' + (a.demanda.lti || '—') +
      (a.demanda.projeto ? ' · ' + a.demanda.projeto : '') +
      (a.peca ? ' · ' + a.peca.nome : '') +
      '\n' + a.equipamentos.map(function (eq) { return eq.nome; }).join(' + ') +
      '\n' + util.formatarData(a.inicio, true) + ' → ' + util.formatarData(a.fim, true) +
      '\n' + a.custo.horasBancada + ' h de bancada · ' + util.formatarMoeda(a.custo.total) +
      (a.atrasado ? '\nTermina ' + Math.abs(a.folga) + ' dia(s) após o prazo' : '');
    /* O projeto entra na barra junto do procedimento: no Gantt cheio é o que diz
       de quem é o ensaio sem precisar passar o mouse. */
    var rotulo = a.teste.nome + (a.demanda.projeto ? ' · ' + a.demanda.projeto : '');
    return '<div class="gantt-barra ' + classe + (a.atrasado ? ' atrasado' : '') + '" ' +
      'data-demanda="' + e(a.demandaId) + '" title="' + e(titulo) + '" ' +
      'style="left:' + (offset * largura) + 'px;width:' + Math.max(largura, dias * largura - 3) + 'px">' +
      e(rotulo) + '</div>';
  }

  function render(container, ctx) {
    var estado = ctx.estado, f = ctx.filtros, hoje = ctx.hoje;
    var largura = Number((util.porId(ZOOMS, preferencias.zoom) || ZOOMS[1]).largura);

    var visiveis = ctx.plano.agendadas.filter(function (a) {
      if (f.clienteId && a.demanda.clienteId !== f.clienteId) return false;
      if (f.tipoLti && a.demanda.tipoLti !== f.tipoLti) return false;
      if (f.area && a.teste.area !== f.area && a.teste.area !== 'AMBOS') return false;
      return true;
    });

    var faixa = intervalo(visiveis, hoje);
    /* Um ensaio que ocupa duas bancadas aparece nas duas linhas do Gantt. */
    var porPosicao = {};
    visiveis.forEach(function (a) {
      a.equipamentos.forEach(function (eq) {
        var chave = eq.id + '#' + a.posicoes[eq.id];
        (porPosicao[chave] = porPosicao[chave] || []).push(a);
      });
    });

    var linhas = '';
    estado.equipamentos.forEach(function (eq) {
      for (var p = 0; p < eq.posicoes; p++) {
        var chave = eq.id + '#' + p;
        var itens = porPosicao[chave] || [];
        if (preferencias.somenteOcupados && !itens.length) continue;
        var diasOcupados = itens.reduce(function (soma, a) { return soma + util.diffDias(a.inicio, a.fim) + 1; }, 0);
        var ocupacao = Math.min(100, Math.round(diasOcupados / faixa.dias * 100));
        linhas +=
          '<div class="gantt-linha">' +
            '<div class="gantt-rotulo">' +
              '<span class="nome">' + e(eq.nome) + (eq.posicoes > 1 ? ' <span class="sub">pos. ' + (p + 1) + '</span>' : '') + '</span>' +
              '<span class="sub">' + (eq.continuo ? '24 h contínuo' : eq.horasDia + ' h/dia') + '</span>' +
              '<div style="display:flex;align-items:center;gap:6px;margin-top:3px">' +
                '<span class="barra-trilho" style="flex:1"><span class="barra-valor' +
                  (ocupacao > 85 ? ' erro' : ocupacao > 60 ? ' alerta' : '') +
                  '" style="width:' + ocupacao + '%"></span></span>' +
                '<span class="sub">' + ocupacao + '%</span>' +
              '</div>' +
            '</div>' +
            '<div class="gantt-faixa" style="width:' + (faixa.dias * largura) + 'px;' + fundoDaFaixa(largura) + '">' +
              blocosManutencao(eq, faixa, largura) +
              marcadorHoje(faixa, largura, hoje) +
              itens.map(function (a) { return barra(a, faixa, largura); }).join('') +
            '</div>' +
          '</div>';
      }
    });

    var bloqueadas = ctx.plano.bloqueadas;

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Planejamento</h2>' +
        '<p>Alocação automática por prioridade e prazo, respeitando a chegada das amostras, o calendário de cada equipamento, as paradas de manutenção e o número de posições em paralelo.</p></div>' +
        '<div class="acoes">' +
          '<select id="zoom" style="width:auto">' + ui.opcoes(ZOOMS, preferencias.zoom) + '</select>' +
          '<button class="botao" id="ocupados">' + (preferencias.somenteOcupados ? 'Mostrar todos os recursos' : 'Só recursos ocupados') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="cartao">' +
        '<div class="cartao-topo">' +
          '<div class="filtros" style="flex:1">' +
            '<div class="campo"><label>Cliente</label><select id="f-cliente">' + ui.opcoes(estado.clientes, f.clienteId, 'Todos') + '</select></div>' +
            '<div class="campo"><label>Área</label><select id="f-area">' + ui.opcoes(TC.data.AREAS.filter(function (a) { return a.id !== 'AMBOS'; }), f.area, 'Hot + Cold') + '</select></div>' +
            '<div class="campo"><label>Classificação</label><select id="f-tipo">' + ui.opcoes(TC.data.FASES, f.tipoLti, 'Todas') + '</select></div>' +
          '</div>' +
          '<div class="legenda">' +
            '<span><i style="background:var(--hot)"></i>Hot End</span>' +
            '<span><i style="background:var(--cold)"></i>Cold End</span>' +
            '<span><i style="background:var(--ambos)"></i>Hot &amp; Cold</span>' +
            '<span><i style="background:var(--alerta-bg);border:1px solid var(--alerta)"></i>Manutenção</span>' +
            '<span><i style="border:2px solid var(--erro)"></i>Fora do prazo</span>' +
          '</div>' +
        '</div>' +
        (visiveis.length || linhas
          ? '<div class="gantt"><div class="gantt-grade">' +
              '<div class="gantt-linha cabecalho">' +
                '<div class="gantt-rotulo"><span class="nome">Equipamento</span>' +
                  '<span class="sub">' + e(util.formatarData(faixa.inicio, true)) + ' → ' + e(util.formatarData(util.somaDias(faixa.inicio, faixa.dias - 1), true)) + '</span></div>' +
                '<div class="gantt-faixa" style="width:' + (faixa.dias * largura) + 'px;' + fundoDaFaixa(largura) + '">' +
                  cabecalhoTempo(faixa, largura) + marcadorHoje(faixa, largura, hoje) +
                '</div>' +
              '</div>' + linhas +
            '</div></div>'
          : ui.vazio('Nada planejado ainda', 'Confirme a necessidade de um teste no catálogo para vê-lo aqui.')) +
      '</div>' +
      (bloqueadas.length
        ? '<div class="cartao"><div class="cartao-topo"><h3>Demandas sem janela (' + bloqueadas.length + ')</h3></div>' +
          '<div class="tabela-rolagem"><table><thead><tr><th>Procedimento</th><th>Peça</th><th>Motivo</th><th></th></tr></thead><tbody>' +
          bloqueadas.map(function (a) {
            return '<tr><td class="forte">' + e(a.teste ? a.teste.nome : a.demanda.testeId) + '</td>' +
              '<td>' + e(a.peca ? a.peca.nome : '—') + '</td>' +
              '<td><span class="etiqueta erro">' + e(a.motivo) + '</span></td>' +
              '<td class="num"><button class="botao pequeno ver" data-demanda="' + e(a.demandaId) + '">Abrir</button></td></tr>';
          }).join('') + '</tbody></table></div></div>'
        : '');

    var zoom = container.querySelector('#zoom');
    zoom.onchange = function () { preferencias.zoom = zoom.value; ctx.atualizar(); };
    container.querySelector('#ocupados').onclick = function () {
      preferencias.somenteOcupados = !preferencias.somenteOcupados;
      ctx.atualizar();
    };
    ['cliente:clienteId', 'area:area', 'tipo:tipoLti'].forEach(function (par) {
      var p = par.split(':');
      var alvo = container.querySelector('#f-' + p[0]);
      alvo.addEventListener('change', function () { f[p[1]] = alvo.value; ctx.atualizar(); });
    });

    container.querySelectorAll('[data-demanda]').forEach(function (elemento) {
      elemento.onclick = function () {
        var id = elemento.dataset.demanda;
        var alvo = null;
        ctx.plano.alocacoes.forEach(function (a) { if (a.demandaId === id) alvo = a; });
        if (alvo) TC.views.demandas.abrirDetalhe(ctx, alvo);
      };
    });

    var rolagem = container.querySelector('.gantt');
    if (rolagem) {
      var offsetHoje = util.diffDias(faixa.inicio, hoje) * largura;
      rolagem.scrollLeft = Math.max(0, offsetHoje - 120);
    }
  }

  TC.views = TC.views || {};
  TC.views.planejamento = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
