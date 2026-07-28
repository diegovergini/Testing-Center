/* Peças e amostras: os tipos de peça que o laboratório ensaia.
   Não pertencem a um cliente nem a uma área — qualquer cliente pode ter amostra de qualquer
   tipo. A data de chegada das amostras é informada em cada demanda, não aqui. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  function abrirEdicao(peca) {
    var novo = !peca;
    peca = peca || { id: '', nome: '', descricao: '', custoAmostra: 0 };

    var corpo =
      '<div class="grade-campos">' +
        '<div class="campo"><label>Tipo de peça</label>' +
          '<input name="nome" value="' + e(peca.nome) + '" required placeholder="Ex.: Hot End"></div>' +
        '<div class="campo"><label>Custo por amostra (R$)</label>' +
          '<input type="number" min="0" step="10" name="custoAmostra" value="' + e(String(peca.custoAmostra || 0)) + '"></div>' +
      '</div>' +
      '<div class="campo"><label>Descrição</label>' +
        '<textarea name="descricao" rows="2" placeholder="O que entra neste tipo de peça">' + e(peca.descricao || '') + '</textarea></div>' +
      (novo ? '' : '<p class="sub" style="margin-bottom:0">Código <span class="mono">' + e(peca.id) + '</span> — ' +
        'referenciado pelas demandas, não muda.</p>');

    ui.modal({
      titulo: novo ? 'Novo tipo de peça' : 'Editar ' + peca.nome,
      corpo: corpo,
      confirmar: 'Salvar peça',
      aoConfirmar: function (v) {
        if (!v.nome.trim()) { ui.notificar('Informe o tipo de peça.'); return false; }
        TC.store.salvarPeca({
          id: peca.id || undefined, nome: v.nome.trim(), descricao: v.descricao.trim(),
          custoAmostra: Number(v.custoAmostra) || 0
        });
        ui.notificar('Peça salva.');
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
            ? '<button class="botao pequeno editar">Editar</button> ' +
              '<button class="botao pequeno perigo excluir">✕</button>'
            : '<span class="sub">—</span>') + '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Peças e amostras</h2>' +
        '<p>Os tipos de peça que o laboratório ensaia. Valem para qualquer cliente — a data de chegada das amostras e o prazo são informados a cada demanda, porque variam por programa.</p></div>' +
        (ctx.podeEditar ? '<div class="acoes"><button class="botao primario" id="nova">+ Novo tipo de peça</button></div>' : '') +
      '</div>' +
      '<div class="cartao">' +
        (estado.pecas.length ? '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Tipo de peça</th><th class="num">Custo por amostra</th><th class="num">Ensaios</th>' +
          '<th class="num">Amostras</th><th class="num">Clientes</th><th>Primeira chegada</th>' +
          '<th class="num">Custo acumulado</th><th></th>' +
          '</tr></thead><tbody>' + linhas + '</tbody></table></div>'
          : ui.vazio('Nenhum tipo de peça cadastrado', 'Cadastre a peça para poder confirmar testes sobre ela.')) +
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
        ui.confirmarAcao('Remover "' + peca.nome + '"?' +
          (usos ? ' Há ' + usos + ' demanda(s) associada(s), que ficarão sem peça.' : ''), function () {
          TC.store.removerPeca(peca.id);
          ui.notificar('Peça removida.');
        });
      };
    });
  }

  TC.views = TC.views || {};
  TC.views.pecas = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
