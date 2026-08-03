/* Requests: tests whose need has been confirmed, with the slot the scheduler worked out. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  function filtrar(alocacoes, f) {
    return alocacoes.filter(function (a) {
      var d = a.demanda;
      if (f.clienteId && d.clienteId !== f.clienteId) return false;
      if (f.tipoLti && d.tipoLti !== f.tipoLti) return false;
      if (f.area && a.teste && a.teste.area !== f.area && a.teste.area !== 'AMBOS') return false;
      if (f.status && d.status !== f.status) return false;
      if (f.busca) {
        var alvo = ((d.lti || '') + ' ' + (d.projeto || '') + ' ' + (d.partNumber || '') + ' ' +
          (a.teste ? a.teste.nome : '') + ' ' + (a.peca ? a.peca.nome : '')).toLowerCase();
        if (alvo.indexOf(f.busca.toLowerCase()) === -1) return false;
      }
      return true;
    });
  }

  function celulaJanela(a) {
    if (a.cotacao) {
      return '<span class="etiqueta alerta">Quote</span><div class="sub">takes no rig</div>';
    }
    if (!a.inicio) {
      return '<span class="etiqueta erro">No slot</span><div class="sub">' + e(a.motivo || '') + '</div>';
    }
    var extras = [];
    if (a.esperaAmostra) extras.push('waiting for sample ' + a.esperaAmostra + ' d');
    if (a.esperaFila > 0) extras.push('queue ' + a.esperaFila + ' d');
    var bancadas = a.equipamentos.map(function (eq) {
      return eq.nome + (eq.posicoes > 1 ? ' pos. ' + (a.posicoes[eq.id] + 1) : '');
    }).join(' + ');
    return '<span class="forte">' + e(util.formatarData(a.inicio, true)) + ' → ' + e(util.formatarData(a.fim, true)) + '</span>' +
      '<div class="sub">' + e(bancadas + (extras.length ? ' · ' + extras.join(' · ') : '')) + '</div>';
  }

  function celulaPrazo(a) {
    if (!a.demanda.prazo) return '<span class="sub">no due date</span>';
    var texto = util.formatarData(a.demanda.prazo, true);
    if (a.folga === null || a.folga === undefined) return texto;
    var etiqueta = a.folga < 0
      ? '<span class="etiqueta erro">' + Math.abs(a.folga) + ' d late</span>'
      : '<span class="etiqueta ' + (a.folga < 7 ? 'alerta' : 'ok') + '">' + a.folga + ' d spare</span>';
    return texto + '<div style="margin-top:3px">' + etiqueta + '</div>';
  }

  /* The report is called out because it is what unlocks "Send report": whoever scans the
     list has to spot from afar the completed request with no report attached yet. */
  function celulaDocumentos(d) {
    var docs = d.documentos || [];
    var contas = TC.documentos.resumo(docs);
    if (!contas.total) return '<span class="sub">—</span>';
    return '<span class="etiqueta">' + contas.total + ' file' + (contas.total > 1 ? 's' : '') + '</span>' +
      (contas.RELATORIO ? '<div class="sub">report</div>' : '');
  }

  function linha(a, podeEditar, perfil) {
    var transicoes = TC.fluxo.transicoesDe('demanda', a.demanda.status, perfil);
    var d = a.demanda;
    return '<tr data-demanda="' + e(d.id) + '">' +
      '<td>' +
        '<div class="forte">' + e(a.teste ? a.teste.nome : d.testeId) + '</div>' +
        '<div class="sub"><span class="mono">' + e(d.testeId) + '</span>' +
          (a.teste && a.teste.revisao ? ' · ' + e(a.teste.revisao) : '') +
          (a.teste ? ' · ' + e(a.teste.norma || '') : '') + '</div>' +
      '</td>' +
      '<td>' +
        '<div class="forte">' + e(d.projeto || '—') + '</div>' +
        '<div class="sub">' + e(d.partNumber || 'no part number') + '</div>' +
      '</td>' +
      '<td>' +
        '<div>' + e(a.peca ? a.peca.nome : '—') + '</div>' +
        '<div class="sub">samples ' + e(util.formatarData(d.dataAmostras)) + '</div>' +
      '</td>' +
      '<td>' + (a.teste ? ui.etiquetaArea(a.teste.area) : '') + '</td>' +
      '<td>' + ui.celulaLti(d) + '</td>' +
      '<td>' + ui.etiquetaPrioridade(d.prioridade) + '</td>' +
      '<td class="num">' + e(String(d.quantidade)) + '</td>' +
      '<td>' + celulaJanela(a) + '</td>' +
      '<td>' + celulaPrazo(a) + '</td>' +
      '<td class="num forte">' + e(util.formatarMoeda(a.custo.total)) + '</td>' +
      '<td>' + celulaDocumentos(d) + '</td>' +
      '<td>' + ui.etiquetaStatus(d.status) +
        (d.relatorioCorrecoes
          ? '<div class="sub">' + d.relatorioCorrecoes + ' rework round(s)</div>' : '') + '</td>' +
      /* Only the buttons the workflow authorises for the role in use show up — the rule of
         who does what lives in src/fluxo.js, not scattered across the screen. */
      '<td class="num" style="white-space:nowrap">' +
        transicoes.map(function (t) {
          return '<button class="botao pequeno ' +
            (t.para === 'CANCELADA' ? 'perigo' : 'primario') +
            ' mover" data-para="' + e(t.para) + '" title="' + e(t.descricao || '') + '">' +
            e(t.rotulo) + '</button> ';
        }).join('') +
        (podeEditar
          ? '<button class="botao pequeno editar">Edit</button> ' +
            '<button class="botao pequeno perigo excluir" title="Remove request">✕</button>'
          : (transicoes.length ? '' : '<span class="sub">—</span>')) +
      '</td>' +
    '</tr>';
  }

  function abrirEdicao(ctx, demanda, alocacao) {
    var estado = ctx.estado;
    var teste = util.porId(estado.testes, demanda.testeId);
    var corpo =
      '<div class="aviso">' + e(teste ? teste.nome : demanda.testeId) +
        (teste && teste.revisao ? ' · ' + e(teste.revisao) : '') +
        (alocacao && alocacao.cotacao
          ? ' · quote, takes no rig'
          : alocacao && alocacao.inicio
          ? ' · scheduled for ' + e(util.formatarData(alocacao.inicio, true)) + ' → ' + e(util.formatarData(alocacao.fim, true)) +
            ' on ' + e(alocacao.equipamentos.map(function (eq) { return eq.nome; }).join(' + '))
          : ' · no slot yet') +
      '</div>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>LTI no. (work order)</label><input name="lti" value="' + e(demanda.lti || '') + '"></div>' +
        '<div class="campo"><label>LTI classification</label><select name="tipoLti">' + ui.opcoes(TC.data.TIPOS_LTI, demanda.tipoLti) + '</select></div>' +
        '<div class="campo"><label>Customer</label><select name="clienteId">' + ui.opcoes(estado.clientes, demanda.clienteId) + '</select></div>' +
        '<div class="campo"><label>Project</label><input name="projeto" value="' + e(demanda.projeto || '') + '"></div>' +
        '<div class="campo"><label>Part Number</label><input name="partNumber" value="' + e(demanda.partNumber || '') + '"></div>' +
        '<div class="campo"><label>Part type</label><select name="pecaId">' +
          ui.opcoes(estado.pecas, demanda.pecaId) + '</select></div>' +
        '<div class="campo"><label>Samples available from</label>' +
          '<input type="date" name="dataAmostras" value="' + e(demanda.dataAmostras || '') + '"></div>' +
        '<div class="campo"><label>Due date</label><input type="date" name="prazo" value="' + e(demanda.prazo || '') + '"></div>' +
        '<div class="campo"><label>Priority</label><select name="prioridade">' + ui.opcoes(TC.data.PRIORIDADES, demanda.prioridade) + '</select></div>' +
        '<div class="campo"><label>Samples</label><input type="number" min="1" name="quantidade" value="' + e(String(demanda.quantidade)) + '"></div>' +
        '<div class="campo"><label>Force start on</label><input type="date" name="inicioFixo" value="' + e(demanda.inicioFixo || '') + '"></div>' +
      '</div>' +
      /* The status is not edited by hand: it moves through the workflow buttons, which
         record who made the move and when. The dates stay visible for checking. */
      '<p class="sub" style="margin:14px 0 8px"><strong>Status: ' +
        e(TC.fluxo.nomeDoEstado('demanda', demanda.status)) + '</strong>' +
        (demanda.dataConclusao ? ' · test completed on ' + e(util.formatarData(demanda.dataConclusao, true)) : '') +
        (demanda.dataRelatorio ? ' · report signed off on ' + e(util.formatarData(demanda.dataRelatorio, true)) : '') +
        (demanda.relatorioCorrecoes ? ' · ' + demanda.relatorioCorrecoes + ' rework round(s)' : '') +
        '<br>The status changes through the workflow buttons in the request list.</p>' +
      ui.painelDocumentos({
        registro: demanda, contexto: 'demanda', podeEditar: ctx.podeEditar,
        rotulo: 'Request documents'
      }) +
      ui.historico('demanda', demanda) +
      '<div class="campo"><label>Note</label><textarea name="observacao" rows="2">' + e(demanda.observacao || '') + '</textarea></div>';

    var janela = ui.modal({
      titulo: 'Edit request',
      corpo: corpo,
      largura: 'min(760px, 100%)',
      confirmar: 'Save and reschedule',
      aoConfirmar: function (v) {
        if (v.tipoLti !== 'COTACAO' && !v.lti.trim()) {
          ui.notificar('Enter the LTI number — only a quote can go without one.');
          return false;
        }
        if (!v.dataAmostras) {
          ui.notificar('Enter the date the samples become available.');
          return false;
        }
        TC.store.atualizarDemanda(demanda.id, {
          clienteId: v.clienteId, pecaId: v.pecaId, lti: v.lti.trim(), tipoLti: v.tipoLti,
          projeto: v.projeto.trim(), partNumber: v.partNumber.trim(),
          prioridade: v.prioridade, quantidade: Number(v.quantidade) || 1,
          dataAmostras: v.dataAmostras, prazo: v.prazo,
          inicioFixo: v.inicioFixo, observacao: v.observacao
        });
        ui.notificar('Request updated and schedule recalculated.');
      }
    });
    /* Attaching saves at once and redraws only the panel — the screen stays open with what
       was already typed. Without the ctx.atualizar() reschedule, which would close it. */
    ui.ligarDocumentos(janela, {
      registro: demanda, contexto: 'demanda', podeEditar: ctx.podeEditar,
      rotulo: 'Documentos da demanda'
    });
    return janela;
  }

  function render(container, ctx) {
    var estado = ctx.estado, f = ctx.filtros;
    /* Every request, not just the ones the scheduler carries: a completed one leaves the
       plan (it no longer competes for a rig) but stays in the workflow, with a report to
       send and sign off. If the list came from the plan, the request would vanish
       midway. */
    var todas = TC.kpi.demandasComCusto(estado, ctx.plano);
    var lista = filtrar(todas, f);

    var custoTotal = 0, atrasadas = 0, semJanela = 0, cotacoes = 0;
    lista.forEach(function (a) {
      custoTotal += a.custo.total;
      if (a.atrasado) atrasadas++;
      if (a.cotacao) cotacoes++;
      else if (!a.inicio && TC.scheduler.STATUS_ATIVOS.indexOf(a.demanda.status) !== -1) semJanela++;
    });

    var statusLista = TC.fluxo.estados('demanda');
    var perfilAtual = TC.permissoes.perfilAtual(estado);

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Test requests</h2>' +
        '<p>Every need confirmed in the catalogue becomes a row here and is rescheduled automatically whenever priority, due date or availability changes.</p></div>' +
        '<div class="acoes"><button class="botao" id="csv">Export CSV</button>' +
        (ctx.podeEditar ? '<button class="botao primario" id="ir-catalogo">+ Confirm new test</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="indicadores">' +
        '<div class="indicador"><div class="rotulo">Requests</div><div class="valor">' + lista.length + '</div>' +
          '<div class="nota">' + lista.filter(function (a) { return a.demanda.status === 'PENDENTE'; }).length + ' pending</div></div>' +
        '<div class="indicador"><div class="rotulo">Committed cost</div><div class="valor">' + util.formatarMoeda(custoTotal) + '</div>' +
          '<div class="nota">labour + machine + samples</div></div>' +
        '<div class="indicador"><div class="rotulo">Past due date</div><div class="valor" style="color:' + (atrasadas ? 'var(--erro)' : 'inherit') + '">' + atrasadas + '</div>' +
          '<div class="nota">finish after the customer due date</div></div>' +
        '<div class="indicador"><div class="rotulo">No slot</div><div class="valor" style="color:' + (semJanela ? 'var(--alerta)' : 'inherit') + '">' + semJanela + '</div>' +
          '<div class="nota">equipment missing or fully booked</div></div>' +
        '<div class="indicador"><div class="rotulo">Quotes</div><div class="valor">' + cotacoes + '</div>' +
          '<div class="nota">take no rig</div></div>' +
      '</div>' +
      '<div class="cartao">' +
        '<div class="cartao-topo"><div class="filtros" style="flex:1">' +
          '<div class="campo busca"><label>Search LTI</label><input id="f-busca" placeholder="LTI, project, part number, procedure or part type" value="' + e(f.busca || '') + '"></div>' +
          '<div class="campo"><label>Customer</label><select id="f-cliente">' + ui.opcoes(estado.clientes, f.clienteId, 'All') + '</select></div>' +
          '<div class="campo"><label>End</label><select id="f-area">' + ui.opcoes(TC.data.AREAS.filter(function (a) { return a.id !== 'AMBOS'; }), f.area, 'Hot + Cold') + '</select></div>' +
          '<div class="campo"><label>Classification</label><select id="f-tipo">' + ui.opcoes(TC.data.TIPOS_LTI, f.tipoLti, 'All') + '</select></div>' +
          '<div class="campo"><label>Status</label><select id="f-status">' + ui.opcoes(statusLista, f.status, 'All') + '</select></div>' +
        '</div></div>' +
        (lista.length ? '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Procedure</th><th>Project</th><th>Part type</th><th>End</th><th>LTI</th><th>Priority</th><th class="num">Samples</th>' +
          '<th>Planned slot</th><th>Due date</th><th class="num">Cost</th><th>Documents</th><th>Status</th><th></th>' +
          '</tr></thead><tbody>' + lista.map(function (a) { return linha(a, ctx.podeEditar, perfilAtual); }).join('') + '</tbody></table></div>'
          : ui.vazio('No request confirmed', 'Open the catalogue and confirm the need for a test.')) +
      '</div>';

    var irCatalogo = container.querySelector('#ir-catalogo');
    if (irCatalogo) irCatalogo.onclick = function () { ctx.ir('catalogo'); };
    container.querySelector('#csv').onclick = function () { exportarCsv(lista); };

    var busca = container.querySelector('#f-busca');
    var atraso;
    busca.addEventListener('input', function () {
      clearTimeout(atraso);
      atraso = setTimeout(function () {
        f.busca = busca.value;
        ctx.atualizar();
        var novoCampo = container.querySelector('#f-busca');
        if (novoCampo) { novoCampo.focus(); novoCampo.setSelectionRange(novoCampo.value.length, novoCampo.value.length); }
      }, 250);
    });

    ['cliente:clienteId', 'area:area', 'tipo:tipoLti', 'status:status'].forEach(function (par) {
      var p = par.split(':');
      var alvo = container.querySelector('#f-' + p[0]);
      alvo.addEventListener('change', function () { f[p[1]] = alvo.value; ctx.atualizar(); });
    });

    container.querySelectorAll('tr[data-demanda]').forEach(function (tr) {
      var alocacao = null;
      lista.forEach(function (a) { if (a.demandaId === tr.dataset.demanda) alocacao = a; });
      tr.querySelectorAll('.mover').forEach(function (botao) {
        botao.onclick = function () {
          ui.moverNoFluxo({
            tipo: 'demanda', registro: alocacao.demanda, para: botao.dataset.para,
            aoMover: function (v) {
              return TC.store.moverDemanda(alocacao.demandaId, botao.dataset.para, v);
            }
          });
        };
      });
      var editar = tr.querySelector('.editar');
      if (!editar) return;
      editar.onclick = function () { abrirEdicao(ctx, alocacao.demanda, alocacao); };
      tr.querySelector('.excluir').onclick = function () {
        ui.confirmarAcao('Remove the request for "' + (alocacao.teste ? alocacao.teste.nome : '') + '"?', function () {
          TC.store.removerDemanda(tr.dataset.demanda);
          ui.notificar('Request removed.');
        });
      };
    });
  }

  function exportarCsv(lista) {
    var cabecalho = ['LTI', 'LTI_classification', 'Code', 'Procedure', 'Revision', 'Project',
      'Part_number', 'Part_type', 'Customer', 'Priority', 'Samples', 'Equipment',
      'Samples_available_from', 'Start', 'End', 'Due_date', 'Spare_days', 'Total_cost', 'Status',
      'Documents', 'Report_link'];
    var linhas = lista.map(function (a) {
      return [
        a.demanda.lti || '',
        a.demanda.tipoLti,
        a.demanda.testeId,
        a.teste ? a.teste.nome : '',
        a.teste ? (a.teste.revisao || '') : '',
        a.demanda.projeto || '',
        a.demanda.partNumber || '',
        a.peca ? a.peca.nome : '',
        a.demanda.clienteId,
        a.demanda.prioridade,
        a.demanda.quantidade,
        a.equipamentos.map(function (eq) { return eq.nome; }).join(' + '),
        a.demanda.dataAmostras || '',
        a.cotacao ? '' : (a.inicio || ''),
        a.cotacao ? '' : (a.fim || ''),
        a.demanda.prazo || '',
        a.folga === null || a.folga === undefined ? '' : a.folga,
        a.custo.total,
        a.demanda.status,
        (a.demanda.documentos || []).length,
        (TC.documentos.doTipo(a.demanda.documentos, 'RELATORIO')[0] || {}).link || ''
      ].map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';');
    });
    var conteudo = '﻿' + [cabecalho.join(';')].concat(linhas).join('\n');
    var url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'test-requests-' + util.hoje() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    ui.notificar('CSV exported.');
  }

  TC.views = TC.views || {};
  TC.views.demandas = {
    render: render,
    /* Used by the Gantt: clicking a bar opens the matching request. */
    abrirDetalhe: function (ctx, alocacao) { abrirEdicao(ctx, alocacao.demanda, alocacao); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
