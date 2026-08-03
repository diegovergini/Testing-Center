/* Customers: whoever requires the validation. Each customer carries its part types, its
   required procedures and the cost already committed. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  function abrirEdicao(cliente) {
    var novo = !cliente;
    cliente = cliente || { id: '', nome: '', segmento: '' };

    var corpo =
      '<div class="grade-campos">' +
        '<div class="campo"><label>Name</label><input name="nome" value="' + e(cliente.nome) + '" required ' +
          'placeholder="e.g. Volkswagen"></div>' +
        '<div class="campo"><label>Segment</label><input name="segmento" value="' + e(cliente.segmento || '') + '" ' +
          'placeholder="OEM, Tier 1, internal…"></div>' +
      '</div>' +
      (novo ? '' : '<p class="sub" style="margin-bottom:0">Code <span class="mono">' + e(cliente.id) + '</span> — ' +
        'used by the part types and the procedures, it does not change.</p>');

    ui.modal({
      titulo: novo ? 'New customer' : 'Edit ' + cliente.nome,
      corpo: corpo,
      confirmar: 'Save customer',
      aoConfirmar: function (v) {
        if (!v.nome.trim()) { ui.notificar('Enter the customer name.'); return false; }
        TC.store.salvarCliente({ id: cliente.id || undefined, nome: v.nome.trim(), segmento: v.segmento.trim() });
        ui.notificar('Customer saved.');
      }
    });
  }

  function render(container, ctx) {
    var estado = ctx.estado;
    var podeEditar = ctx.podeEditar;

    var resumo = {};
    estado.clientes.forEach(function (c) {
      resumo[c.id] = { tiposPeca: {}, demandas: 0, custo: 0, procedimentos: 0 };
    });
    estado.testes.forEach(function (t) {
      (t.clientes || []).forEach(function (id) {
        if (resumo[id]) resumo[id].procedimentos++;
      });
    });
    /* A part type does not belong to a customer; what counts is which types the
       customer has already brought in. */
    ctx.plano.alocacoes.forEach(function (a) {
      var r = resumo[a.demanda.clienteId];
      if (!r) return;
      r.demandas++;
      r.custo += a.custo.total;
      if (a.peca) r.tiposPeca[a.peca.id] = true;
    });

    var padrao = estado.testes.filter(function (t) { return !t.clientes || !t.clientes.length; }).length;

    var linhas = estado.clientes.map(function (c) {
      var r = resumo[c.id];
      return '<tr data-cliente="' + e(c.id) + '">' +
        '<td><div class="forte">' + e(c.nome) + '</div>' +
          '<div class="sub"><span class="mono">' + e(c.id) + '</span></div></td>' +
        '<td>' + (c.segmento ? '<span class="etiqueta">' + e(c.segmento) + '</span>' : '<span class="sub">—</span>') + '</td>' +
        '<td class="num">' + r.procedimentos + '<div class="sub">+ ' + padrao + ' standard</div></td>' +
        '<td class="num">' + Object.keys(r.tiposPeca).length + '</td>' +
        '<td class="num">' + r.demandas + '</td>' +
        '<td class="num forte">' + e(util.formatarMoeda(r.custo)) + '</td>' +
        '<td class="num" style="white-space:nowrap">' +
          (podeEditar
            ? '<button class="botao pequeno editar">Edit</button> ' +
              '<button class="botao pequeno perigo excluir" title="Remove customer">✕</button>'
            : '<span class="sub">—</span>') +
        '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Customers</h2>' +
        '<p>Whoever requires the validation. A procedure with no customer marked counts as a lab standard and shows up for everyone.</p></div>' +
        (ctx.podeEditar ? '<div class="acoes"><button class="botao primario" id="novo">+ New customer</button></div>' : '') +
      '</div>' +
      '<div class="cartao">' +
        (estado.clientes.length
          ? '<div class="tabela-rolagem"><table><thead><tr>' +
            '<th>Customer</th><th>Segment</th><th class="num">Required procedures</th>' +
            '<th class="num">Part types</th><th class="num">Requests</th><th class="num">Committed cost</th><th></th>' +
            '</tr></thead><tbody>' + linhas + '</tbody></table></div>'
          : ui.vazio('No customer registered', 'Register the first customer to be able to add part types and confirm tests.')) +
      '</div>';

    var botaoNovo = container.querySelector('#novo');
    if (botaoNovo) botaoNovo.onclick = function () { abrirEdicao(null); };

    container.querySelectorAll('tr[data-cliente]').forEach(function (tr) {
      var cliente = util.porId(estado.clientes, tr.dataset.cliente);
      var r = resumo[cliente.id];
      var editar = tr.querySelector('.editar');
      if (!editar) return;
      editar.onclick = function () { abrirEdicao(cliente); };
      tr.querySelector('.excluir').onclick = function () {
        ui.confirmarAcao(
          'Remove "' + cliente.nome + '"?' +
          (r.demandas
            ? ' It has ' + r.demandas + ' request(s), which will be left without a customer and drop out of the filters.'
            : '') +
          ' The customer is also removed from the procedures that require it.',
          function () {
            TC.store.removerCliente(cliente.id);
            ui.notificar('Customer removed.');
          });
      };
    });
  }

  TC.views = TC.views || {};
  TC.views.clientes = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
