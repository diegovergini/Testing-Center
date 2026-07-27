/* Clientes: quem exige a validação. Cada cliente carrega suas peças, seus procedimentos
   obrigatórios e o custo já confirmado. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  function abrirEdicao(cliente) {
    var novo = !cliente;
    cliente = cliente || { id: '', nome: '', segmento: '' };

    var corpo =
      '<div class="grade-campos">' +
        '<div class="campo"><label>Nome</label><input name="nome" value="' + e(cliente.nome) + '" required ' +
          'placeholder="Ex.: Volkswagen"></div>' +
        '<div class="campo"><label>Segmento</label><input name="segmento" value="' + e(cliente.segmento || '') + '" ' +
          'placeholder="OEM, Tier 1, interno…"></div>' +
      '</div>' +
      (novo ? '' : '<p class="sub" style="margin-bottom:0">Código <span class="mono">' + e(cliente.id) + '</span> — ' +
        'usado pelas peças e pelos procedimentos, não muda.</p>');

    ui.modal({
      titulo: novo ? 'Novo cliente' : 'Editar ' + cliente.nome,
      corpo: corpo,
      confirmar: 'Salvar cliente',
      aoConfirmar: function (v) {
        if (!v.nome.trim()) { ui.notificar('Informe o nome do cliente.'); return false; }
        TC.store.salvarCliente({ id: cliente.id || undefined, nome: v.nome.trim(), segmento: v.segmento.trim() });
        ui.notificar('Cliente salvo.');
      }
    });
  }

  function render(container, ctx) {
    var estado = ctx.estado;

    var resumo = {};
    estado.clientes.forEach(function (c) {
      resumo[c.id] = { tiposPeca: {}, demandas: 0, custo: 0, procedimentos: 0 };
    });
    estado.testes.forEach(function (t) {
      (t.clientes || []).forEach(function (id) {
        if (resumo[id]) resumo[id].procedimentos++;
      });
    });
    /* Peça não pertence a cliente; o que conta é quais tipos de peça o cliente já trouxe. */
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
        '<td class="num">' + r.procedimentos + '<div class="sub">+ ' + padrao + ' padrão</div></td>' +
        '<td class="num">' + Object.keys(r.tiposPeca).length + '</td>' +
        '<td class="num">' + r.demandas + '</td>' +
        '<td class="num forte">' + e(util.formatarMoeda(r.custo)) + '</td>' +
        '<td class="num" style="white-space:nowrap">' +
          '<button class="botao pequeno editar">Editar</button> ' +
          '<button class="botao pequeno perigo excluir" title="Remover cliente">✕</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Clientes</h2>' +
        '<p>Quem exige a validação. Um procedimento sem cliente marcado vale como padrão do laboratório e aparece para todos.</p></div>' +
        '<div class="acoes"><button class="botao primario" id="novo">+ Novo cliente</button></div>' +
      '</div>' +
      '<div class="cartao">' +
        (estado.clientes.length
          ? '<div class="tabela-rolagem"><table><thead><tr>' +
            '<th>Cliente</th><th>Segmento</th><th class="num">Procedimentos exigidos</th>' +
            '<th class="num">Tipos de peça</th><th class="num">Demandas</th><th class="num">Custo confirmado</th><th></th>' +
            '</tr></thead><tbody>' + linhas + '</tbody></table></div>'
          : ui.vazio('Nenhum cliente cadastrado', 'Cadastre o primeiro cliente para poder registrar peças e confirmar testes.')) +
      '</div>';

    container.querySelector('#novo').onclick = function () { abrirEdicao(null); };

    container.querySelectorAll('tr[data-cliente]').forEach(function (tr) {
      var cliente = util.porId(estado.clientes, tr.dataset.cliente);
      var r = resumo[cliente.id];
      tr.querySelector('.editar').onclick = function () { abrirEdicao(cliente); };
      tr.querySelector('.excluir').onclick = function () {
        ui.confirmarAcao(
          'Remover "' + cliente.nome + '"?' +
          (r.demandas
            ? ' Ele tem ' + r.demandas + ' demanda(s), que ficarão sem cliente e somem dos filtros.'
            : '') +
          ' O cliente também sai da lista de exigência dos procedimentos.',
          function () {
            TC.store.removerCliente(cliente.id);
            ui.notificar('Cliente removido.');
          });
      };
    });
  }

  TC.views = TC.views || {};
  TC.views.clientes = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
