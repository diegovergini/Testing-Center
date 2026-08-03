/* Permission matrix: who sees and who edits each screen. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  /* The actions stay "ver"/"editar" in the saved state; only the label is translated. */
  var ROTULO_ACAO = { ver: 'view', editar: 'edit' };

  function render(container, ctx) {
    var estado = ctx.estado;
    var podeEditar = TC.permissoes.podeEditar(estado, 'permissoes');
    var perfis = TC.data.PERFIS;

    var rotas = TC.app.ROTAS.filter(function (r) { return estado.permissoes[r.id]; });

    var linhas = rotas.map(function (rota) {
      var regra = estado.permissoes[rota.id];
      return '<tr data-rota="' + e(rota.id) + '">' +
        '<td><div class="forte">' + rota.icone + ' ' + e(rota.nome) + '</div>' +
          '<div class="sub">' + e(rota.grupo) + '</div></td>' +
        perfis.map(function (perfil) {
          function caixa(acao) {
            var marcado = regra[acao].indexOf(perfil.id) !== -1;
            return '<label style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;' +
              'font-weight:500;color:var(--texto)">' +
              '<input type="checkbox" style="width:auto" data-acao="' + acao + '" ' +
                'data-perfil="' + e(perfil.id) + '"' + (marcado ? ' checked' : '') +
                (podeEditar ? '' : ' disabled') + '>' + ROTULO_ACAO[acao] + '</label>';
          }
          return '<td>' + caixa('ver') + caixa('editar') + '</td>';
        }).join('') +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Roles and permissions</h2>' +
        '<p>What each role sees and what it can change on each screen. Ticking <strong>edit</strong> turns <strong>view</strong> on with it, because you cannot change a screen you cannot see.</p></div>' +
        (podeEditar ? '<div class="acoes"><button class="botao" id="restaurar">Restore defaults</button></div>' : '') +
      '</div>' +
      '<div class="aviso alerta">With no server, the role is an interface choice: it organises the ' +
        'work and prevents accidental edits, but it is not access control — anyone who opens the JSON ' +
        'backup reaches everything. Real authentication needs a back end.</div>' +
      '<div class="cartao">' +
        '<div class="cartao-topo"><h3>Permission matrix</h3></div>' +
        '<div class="tabela-rolagem"><table><thead><tr><th>Screen</th>' +
          perfis.map(function (p) {
            return '<th>' + e(p.nome) + '<div class="sub" style="font-weight:400;text-transform:none">' +
              e(p.descricao) + '</div></th>';
          }).join('') +
        '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      '</div>';

    if (!podeEditar) return;

    container.querySelector('#restaurar').onclick = function () {
      ui.confirmarAcao('Reset the permission matrix to its defaults?', function () {
        TC.store.restaurarPermissoes();
        ui.notificar('Permissions restored.');
      });
    };

    container.querySelectorAll('tr[data-rota]').forEach(function (tr) {
      tr.querySelectorAll('input[type=checkbox]').forEach(function (caixa) {
        caixa.onchange = function () {
          TC.store.definirPermissao(tr.dataset.rota, caixa.dataset.acao, caixa.dataset.perfil, caixa.checked);
        };
      });
    });
  }

  TC.views = TC.views || {};
  TC.views.permissoes = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
