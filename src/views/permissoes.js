/* Matriz de permissões: quem vê e quem edita cada janela. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

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
                (podeEditar ? '' : ' disabled') + '>' + acao + '</label>';
          }
          return '<td>' + caixa('ver') + caixa('editar') + '</td>';
        }).join('') +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Perfis e permissões</h2>' +
        '<p>O que cada perfil enxerga e o que pode alterar em cada janela. Marcar <strong>editar</strong> liga <strong>ver</strong> junto, porque não dá para alterar uma tela que não se vê.</p></div>' +
        (podeEditar ? '<div class="acoes"><button class="botao" id="restaurar">Restaurar padrão</button></div>' : '') +
      '</div>' +
      '<div class="aviso alerta">Sem servidor, o perfil é uma escolha da interface: ele organiza o ' +
        'trabalho e evita edição acidental, mas não é controle de acesso — quem abrir o backup JSON ' +
        'alcança tudo. Autenticação de verdade só com um back-end.</div>' +
      '<div class="cartao">' +
        '<div class="cartao-topo"><h3>Matriz de permissões</h3></div>' +
        '<div class="tabela-rolagem"><table><thead><tr><th>Janela</th>' +
          perfis.map(function (p) {
            return '<th>' + e(p.nome) + '<div class="sub" style="font-weight:400;text-transform:none">' +
              e(p.descricao) + '</div></th>';
          }).join('') +
        '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      '</div>';

    if (!podeEditar) return;

    container.querySelector('#restaurar').onclick = function () {
      ui.confirmarAcao('Voltar a matriz de permissões ao padrão?', function () {
        TC.store.restaurarPermissoes();
        ui.notificar('Permissões restauradas.');
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
