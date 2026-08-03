/* Parts and samples: the part types the lab tests.
   They belong neither to a customer nor to an end — any customer can have a sample of any
   type. The sample arrival date is given on each request, not here. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  function abrirEdicao(peca) {
    var novo = !peca;
    peca = peca || { id: '', nome: '', descricao: '', custoAmostra: 0 };

    var corpo =
      '<div class="grade-campos">' +
        '<div class="campo"><label>Part type</label>' +
          '<input name="nome" value="' + e(peca.nome) + '" required placeholder="e.g. Hot End"></div>' +
        '<div class="campo"><label>Cost per sample (R$)</label>' +
          '<input type="number" min="0" step="10" name="custoAmostra" value="' + e(String(peca.custoAmostra || 0)) + '"></div>' +
      '</div>' +
      '<div class="campo"><label>Description</label>' +
        '<textarea name="descricao" rows="2" placeholder="What goes into this part type">' + e(peca.descricao || '') + '</textarea></div>' +
      (novo ? '' : '<p class="sub" style="margin-bottom:0">Code <span class="mono">' + e(peca.id) + '</span> — ' +
        'referenced by the requests, it does not change.</p>');

    ui.modal({
      titulo: novo ? 'New part type' : 'Edit ' + peca.nome,
      corpo: corpo,
      confirmar: 'Save part type',
      aoConfirmar: function (v) {
        if (!v.nome.trim()) { ui.notificar('Enter the part type.'); return false; }
        TC.store.salvarPeca({
          id: peca.id || undefined, nome: v.nome.trim(), descricao: v.descricao.trim(),
          custoAmostra: Number(v.custoAmostra) || 0
        });
        ui.notificar('Part type saved.');
      }
    });
  }

  function render(container, ctx) {
    var estado = ctx.estado;
    var podeEditar = ctx.podeEditar;

    var uso = {};
    estado.pecas.forEach(function (p) {
      uso[p.id] = { ensaios: 0, amostras: 0, custo: 0, proximaChegada: null, clientes: {} };
    });
    ctx.plano.alocacoes.forEach(function (a) {
      var u = a.peca && uso[a.peca.id];
      if (!u) return;
      u.ensaios++;
      u.amostras += a.demanda.quantidade;
      u.custo += a.custo.total;
      u.clientes[a.demanda.clienteId] = true;
      var chegada = a.demanda.dataAmostras;
      if (chegada && (!u.proximaChegada || util.diffDias(chegada, u.proximaChegada) > 0)) {
        u.proximaChegada = chegada;
      }
    });

    var linhas = estado.pecas.map(function (p) {
      var u = uso[p.id];
      var qtdClientes = Object.keys(u.clientes).length;
      return '<tr data-peca="' + e(p.id) + '">' +
        '<td><div class="forte">' + e(p.nome) + '</div>' +
          '<div class="sub">' + e(p.descricao || '') + '</div></td>' +
        '<td class="num">' + e(util.formatarMoeda(p.custoAmostra)) + '</td>' +
        '<td class="num">' + u.ensaios + '</td>' +
        '<td class="num">' + u.amostras + '</td>' +
        '<td class="num">' + (qtdClientes || '<span class="sub">—</span>') + '</td>' +
        '<td>' + (u.proximaChegada
          ? e(util.formatarData(u.proximaChegada, true))
          : '<span class="sub">—</span>') + '</td>' +
        '<td class="num forte">' + e(util.formatarMoeda(u.custo)) + '</td>' +
        '<td class="num" style="white-space:nowrap">' +
          (podeEditar
            ? '<button class="botao pequeno editar">Edit</button> ' +
              '<button class="botao pequeno perigo excluir">✕</button>'
            : '<span class="sub">—</span>') + '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Parts and samples</h2>' +
        '<p>The part types the lab tests. They apply to any customer — the sample arrival date and the due date are given on each request, because they vary by programme.</p></div>' +
        (ctx.podeEditar ? '<div class="acoes"><button class="botao primario" id="nova">+ New part type</button></div>' : '') +
      '</div>' +
      '<div class="cartao">' +
        (estado.pecas.length ? '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Part type</th><th class="num">Cost per sample</th><th class="num">Tests</th>' +
          '<th class="num">Samples</th><th class="num">Customers</th><th>First arrival</th>' +
          '<th class="num">Accumulated cost</th><th></th>' +
          '</tr></thead><tbody>' + linhas + '</tbody></table></div>'
          : ui.vazio('No part type registered', 'Register the part type to be able to confirm tests on it.')) +
      '</div>';

    var botaoNova = container.querySelector('#nova');
    if (botaoNova) botaoNova.onclick = function () { abrirEdicao(null); };
    container.querySelectorAll('tr[data-peca]').forEach(function (tr) {
      var peca = util.porId(estado.pecas, tr.dataset.peca);
      var editar = tr.querySelector('.editar');
      if (!editar) return;
      editar.onclick = function () { abrirEdicao(peca); };
      tr.querySelector('.excluir').onclick = function () {
        var usos = estado.demandas.filter(function (d) { return d.pecaId === peca.id; }).length;
        ui.confirmarAcao('Remove "' + peca.nome + '"?' +
          (usos ? ' There are ' + usos + ' request(s) using it, which will be left without a part type.' : ''), function () {
          TC.store.removerPeca(peca.id);
          ui.notificar('Part type removed.');
        });
      };
    });
  }

  TC.views = TC.views || {};
  TC.views.pecas = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
