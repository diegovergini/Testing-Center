/* Demandas: testes cuja necessidade já foi confirmada, com a janela que o motor calculou. */
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
        var alvo = ((d.lti || '') + ' ' + (a.teste ? a.teste.nome : '') + ' ' +
          (a.peca ? a.peca.nome : '')).toLowerCase();
        if (alvo.indexOf(f.busca.toLowerCase()) === -1) return false;
      }
      return true;
    });
  }

  function celulaJanela(a) {
    if (a.cotacao) {
      return '<span class="etiqueta alerta">Cotação</span><div class="sub">não ocupa bancada</div>';
    }
    if (!a.inicio) {
      return '<span class="etiqueta erro">Sem janela</span><div class="sub">' + e(a.motivo || '') + '</div>';
    }
    var extras = [];
    if (a.esperaAmostra) extras.push('aguarda amostra ' + a.esperaAmostra + ' d');
    if (a.esperaFila > 0) extras.push('fila ' + a.esperaFila + ' d');
    return '<span class="forte">' + e(util.formatarData(a.inicio, true)) + ' → ' + e(util.formatarData(a.fim, true)) + '</span>' +
      '<div class="sub">' + e(a.equipamento.nome + ' · pos. ' + (a.posicao + 1) +
        (extras.length ? ' · ' + extras.join(' · ') : '')) + '</div>';
  }

  function celulaPrazo(a) {
    if (!a.demanda.prazo) return '<span class="sub">sem prazo</span>';
    var texto = util.formatarData(a.demanda.prazo, true);
    if (a.folga === null || a.folga === undefined) return texto;
    var etiqueta = a.folga < 0
      ? '<span class="etiqueta erro">' + Math.abs(a.folga) + ' d de atraso</span>'
      : '<span class="etiqueta ' + (a.folga < 7 ? 'alerta' : 'ok') + '">' + a.folga + ' d de folga</span>';
    return texto + '<div style="margin-top:3px">' + etiqueta + '</div>';
  }

  function linha(a) {
    var d = a.demanda;
    return '<tr data-demanda="' + e(d.id) + '">' +
      '<td>' +
        '<div class="forte">' + e(a.teste ? a.teste.nome : d.testeId) + '</div>' +
        '<div class="sub"><span class="mono">' + e(d.testeId) + '</span>' +
          (a.teste && a.teste.revisao ? ' · ' + e(a.teste.revisao) : '') +
          (a.teste ? ' · ' + e(a.teste.norma || '') : '') + '</div>' +
      '</td>' +
      '<td>' +
        '<div>' + e(a.peca ? a.peca.nome : '—') + '</div>' +
        '<div class="sub">amostras ' + e(util.formatarData(d.dataAmostras)) + '</div>' +
      '</td>' +
      '<td>' + (a.teste ? ui.etiquetaArea(a.teste.area) : '') + '</td>' +
      '<td>' + ui.celulaLti(d) + '</td>' +
      '<td>' + ui.etiquetaPrioridade(d.prioridade) + '</td>' +
      '<td class="num">' + e(String(d.quantidade)) + '</td>' +
      '<td>' + celulaJanela(a) + '</td>' +
      '<td>' + celulaPrazo(a) + '</td>' +
      '<td class="num forte">' + e(util.formatarMoeda(a.custo.total)) + '</td>' +
      '<td>' + ui.etiquetaStatus(d.status) + '</td>' +
      '<td class="num" style="white-space:nowrap">' +
        '<button class="botao pequeno editar">Editar</button> ' +
        '<button class="botao pequeno perigo excluir" title="Remover demanda">✕</button>' +
      '</td>' +
    '</tr>';
  }

  function abrirEdicao(ctx, demanda, alocacao) {
    var estado = ctx.estado;
    var teste = util.porId(estado.testes, demanda.testeId);
    var statusLista = Object.keys(ui.STATUS).map(function (k) { return { id: k, nome: ui.STATUS[k][1] }; });

    var corpo =
      '<div class="aviso">' + e(teste ? teste.nome : demanda.testeId) +
        (teste && teste.revisao ? ' · ' + e(teste.revisao) : '') +
        (alocacao && alocacao.cotacao
          ? ' · cotação, não ocupa bancada'
          : alocacao && alocacao.inicio
          ? ' · planejado para ' + e(util.formatarData(alocacao.inicio, true)) + ' → ' + e(util.formatarData(alocacao.fim, true)) +
            ' em ' + e(alocacao.equipamento.nome)
          : ' · ainda sem janela') +
      '</div>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Nº da LTI (ordem de serviço)</label><input name="lti" value="' + e(demanda.lti || '') + '"></div>' +
        '<div class="campo"><label>Classificação da LTI</label><select name="tipoLti">' + ui.opcoes(TC.data.TIPOS_LTI, demanda.tipoLti) + '</select></div>' +
        '<div class="campo"><label>Cliente</label><select name="clienteId">' + ui.opcoes(estado.clientes, demanda.clienteId) + '</select></div>' +
        '<div class="campo"><label>Peça</label><select name="pecaId">' +
          ui.opcoes(estado.pecas, demanda.pecaId) + '</select></div>' +
        '<div class="campo"><label>Amostras disponíveis a partir de</label>' +
          '<input type="date" name="dataAmostras" value="' + e(demanda.dataAmostras || '') + '"></div>' +
        '<div class="campo"><label>Prazo para finalização</label><input type="date" name="prazo" value="' + e(demanda.prazo || '') + '"></div>' +
        '<div class="campo"><label>Prioridade</label><select name="prioridade">' + ui.opcoes(TC.data.PRIORIDADES, demanda.prioridade) + '</select></div>' +
        '<div class="campo"><label>Status</label><select name="status">' + ui.opcoes(statusLista, demanda.status) + '</select></div>' +
        '<div class="campo"><label>Amostras</label><input type="number" min="1" name="quantidade" value="' + e(String(demanda.quantidade)) + '"></div>' +
        '<div class="campo"><label>Forçar início em</label><input type="date" name="inicioFixo" value="' + e(demanda.inicioFixo || '') + '"></div>' +
      '</div>' +
      '<div class="campo"><label>Observação</label><textarea name="observacao" rows="2">' + e(demanda.observacao || '') + '</textarea></div>';

    var janela = ui.modal({
      titulo: 'Editar demanda',
      corpo: corpo,
      confirmar: 'Salvar e replanejar',
      aoConfirmar: function (v) {
        if (v.tipoLti !== 'COTACAO' && !v.lti.trim()) {
          ui.notificar('Informe o número da LTI — só cotação pode ficar sem.');
          return false;
        }
        if (!v.dataAmostras) {
          ui.notificar('Informe a data de disponibilidade das amostras.');
          return false;
        }
        TC.store.atualizarDemanda(demanda.id, {
          clienteId: v.clienteId, pecaId: v.pecaId, lti: v.lti.trim(), tipoLti: v.tipoLti,
          prioridade: v.prioridade, status: v.status, quantidade: Number(v.quantidade) || 1,
          dataAmostras: v.dataAmostras, prazo: v.prazo,
          inicioFixo: v.inicioFixo, observacao: v.observacao
        });
        ui.notificar('Demanda atualizada e planejamento recalculado.');
      }
    });
    return janela;
  }

  function render(container, ctx) {
    var estado = ctx.estado, f = ctx.filtros;
    var todas = ctx.plano.alocacoes;
    var lista = filtrar(todas, f);

    var custoTotal = 0, atrasadas = 0, semJanela = 0, cotacoes = 0;
    lista.forEach(function (a) {
      custoTotal += a.custo.total;
      if (a.atrasado) atrasadas++;
      if (a.cotacao) cotacoes++;
      else if (!a.inicio && TC.scheduler.STATUS_ATIVOS.indexOf(a.demanda.status) !== -1) semJanela++;
    });

    var statusLista = Object.keys(ui.STATUS).map(function (k) { return { id: k, nome: ui.STATUS[k][1] }; });

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Demandas de teste</h2>' +
        '<p>Cada necessidade confirmada no catálogo vira uma linha aqui e é reagendada automaticamente sempre que a prioridade, o prazo ou a disponibilidade muda.</p></div>' +
        '<div class="acoes"><button class="botao" id="csv">Exportar CSV</button>' +
        '<button class="botao primario" id="ir-catalogo">+ Confirmar novo teste</button></div>' +
      '</div>' +
      '<div class="indicadores">' +
        '<div class="indicador"><div class="rotulo">Demandas</div><div class="valor">' + lista.length + '</div>' +
          '<div class="nota">' + lista.filter(function (a) { return a.demanda.status === 'PENDENTE'; }).length + ' pendentes</div></div>' +
        '<div class="indicador"><div class="rotulo">Custo comprometido</div><div class="valor">' + util.formatarMoeda(custoTotal) + '</div>' +
          '<div class="nota">mão de obra + máquina + amostras</div></div>' +
        '<div class="indicador"><div class="rotulo">Fora do prazo</div><div class="valor" style="color:' + (atrasadas ? 'var(--erro)' : 'inherit') + '">' + atrasadas + '</div>' +
          '<div class="nota">terminam depois do prazo do cliente</div></div>' +
        '<div class="indicador"><div class="rotulo">Sem janela</div><div class="valor" style="color:' + (semJanela ? 'var(--alerta)' : 'inherit') + '">' + semJanela + '</div>' +
          '<div class="nota">equipamento ausente ou lotado</div></div>' +
        '<div class="indicador"><div class="rotulo">Cotações</div><div class="valor">' + cotacoes + '</div>' +
          '<div class="nota">não ocupam bancada</div></div>' +
      '</div>' +
      '<div class="cartao">' +
        '<div class="cartao-topo"><div class="filtros" style="flex:1">' +
          '<div class="campo busca"><label>Buscar LTI</label><input id="f-busca" placeholder="nº da LTI, procedimento ou peça" value="' + e(f.busca || '') + '"></div>' +
          '<div class="campo"><label>Cliente</label><select id="f-cliente">' + ui.opcoes(estado.clientes, f.clienteId, 'Todos') + '</select></div>' +
          '<div class="campo"><label>Área</label><select id="f-area">' + ui.opcoes(TC.data.AREAS.filter(function (a) { return a.id !== 'AMBOS'; }), f.area, 'Hot + Cold') + '</select></div>' +
          '<div class="campo"><label>Classificação</label><select id="f-tipo">' + ui.opcoes(TC.data.TIPOS_LTI, f.tipoLti, 'Todas') + '</select></div>' +
          '<div class="campo"><label>Status</label><select id="f-status">' + ui.opcoes(statusLista, f.status, 'Todos') + '</select></div>' +
        '</div></div>' +
        (lista.length ? '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Procedimento</th><th>Peça</th><th>Área</th><th>LTI</th><th>Prioridade</th><th class="num">Amostras</th>' +
          '<th>Janela planejada</th><th>Prazo</th><th class="num">Custo</th><th>Status</th><th></th>' +
          '</tr></thead><tbody>' + lista.map(linha).join('') + '</tbody></table></div>'
          : ui.vazio('Nenhuma demanda confirmada', 'Abra o catálogo e confirme a necessidade de um teste.')) +
      '</div>';

    container.querySelector('#ir-catalogo').onclick = function () { ctx.ir('catalogo'); };
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
      tr.querySelector('.editar').onclick = function () { abrirEdicao(ctx, alocacao.demanda, alocacao); };
      tr.querySelector('.excluir').onclick = function () {
        ui.confirmarAcao('Remover a demanda de "' + (alocacao.teste ? alocacao.teste.nome : '') + '"?', function () {
          TC.store.removerDemanda(tr.dataset.demanda);
          ui.notificar('Demanda removida.');
        });
      };
    });
  }

  function exportarCsv(lista) {
    var cabecalho = ['LTI', 'Classificacao_LTI', 'Codigo', 'Procedimento', 'Revisao', 'Peca', 'Cliente',
      'Prioridade', 'Amostras', 'Equipamento', 'Amostras_disponiveis_em', 'Inicio', 'Fim', 'Prazo',
      'Folga_dias', 'Custo_total', 'Status'];
    var linhas = lista.map(function (a) {
      return [
        a.demanda.lti || '',
        a.demanda.tipoLti,
        a.demanda.testeId,
        a.teste ? a.teste.nome : '',
        a.teste ? (a.teste.revisao || '') : '',
        a.peca ? a.peca.nome : '',
        a.demanda.clienteId,
        a.demanda.prioridade,
        a.demanda.quantidade,
        a.equipamento ? a.equipamento.nome : '',
        a.demanda.dataAmostras || '',
        a.cotacao ? '' : (a.inicio || ''),
        a.cotacao ? '' : (a.fim || ''),
        a.demanda.prazo || '',
        a.folga === null || a.folga === undefined ? '' : a.folga,
        a.custo.total,
        a.demanda.status
      ].map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';');
    });
    var conteudo = '﻿' + [cabecalho.join(';')].concat(linhas).join('\n');
    var url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'demandas-de-teste-' + util.hoje() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    ui.notificar('CSV exportado.');
  }

  TC.views = TC.views || {};
  TC.views.demandas = {
    render: render,
    /* Usado pelo Gantt: clicar numa barra abre a demanda correspondente. */
    abrirDetalhe: function (ctx, alocacao) { abrirEdicao(ctx, alocacao.demanda, alocacao); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
