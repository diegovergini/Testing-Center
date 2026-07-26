/* Peças em validação. A data de chegada das amostras é a segunda restrição do planejamento:
   nenhum ensaio começa antes dela. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  function abrirEdicao(ctx, peca) {
    var estado = ctx.estado;
    var novo = !peca;
    peca = peca || {
      id: '', nome: '', clienteId: estado.clientes[0] ? estado.clientes[0].id : '',
      programa: '', area: 'COLD', dataAmostras: util.somaDias(util.hoje(), 14),
      quantidade: 6, custoAmostra: 0
    };

    var corpo =
      '<div class="grade-campos">' +
        '<div class="campo"><label>Nome da peça</label><input name="nome" value="' + e(peca.nome) + '" required></div>' +
        '<div class="campo"><label>Cliente</label><select name="clienteId">' + ui.opcoes(estado.clientes, peca.clienteId) + '</select></div>' +
        '<div class="campo"><label>Programa / projeto</label><input name="programa" value="' + e(peca.programa || '') + '"></div>' +
        '<div class="campo"><label>Área do sistema</label><select name="area">' +
          ui.opcoes(TC.data.AREAS.filter(function (a) { return a.id !== 'AMBOS'; }), peca.area) + '</select></div>' +
        '<div class="campo"><label>Amostras disponíveis a partir de</label><input type="date" name="dataAmostras" value="' + e(peca.dataAmostras) + '"></div>' +
        '<div class="campo"><label>Quantidade de amostras</label><input type="number" min="1" name="quantidade" value="' + e(String(peca.quantidade)) + '"></div>' +
        '<div class="campo"><label>Custo por amostra (R$)</label><input type="number" min="0" step="10" name="custoAmostra" value="' + e(String(peca.custoAmostra || 0)) + '"></div>' +
      '</div>';

    ui.modal({
      titulo: novo ? 'Nova peça' : 'Editar ' + peca.nome,
      corpo: corpo,
      confirmar: 'Salvar peça',
      aoConfirmar: function (v) {
        if (!v.nome) { ui.notificar('Informe o nome da peça.'); return false; }
        TC.store.salvarPeca({
          id: peca.id || undefined, nome: v.nome, clienteId: v.clienteId, programa: v.programa,
          area: v.area, dataAmostras: v.dataAmostras, quantidade: Number(v.quantidade) || 1,
          custoAmostra: Number(v.custoAmostra) || 0
        });
        ui.notificar('Peça salva — planejamento recalculado.');
      }
    });
  }

  function render(container, ctx) {
    var estado = ctx.estado, f = ctx.filtros;

    var consumo = {};
    ctx.plano.alocacoes.forEach(function (a) {
      if (!a.peca) return;
      var c = consumo[a.peca.id] = consumo[a.peca.id] || { ensaios: 0, amostras: 0, custo: 0, primeiroInicio: null, ultimoFim: null };
      c.ensaios++;
      c.amostras += a.demanda.quantidade;
      c.custo += a.custo.total;
      if (a.inicio && (!c.primeiroInicio || util.diffDias(a.inicio, c.primeiroInicio) > 0)) c.primeiroInicio = a.inicio;
      if (a.fim && (!c.ultimoFim || util.diffDias(c.ultimoFim, a.fim) > 0)) c.ultimoFim = a.fim;
    });

    var lista = estado.pecas.filter(function (p) {
      if (f.clienteId && p.clienteId !== f.clienteId) return false;
      if (f.area && p.area !== f.area) return false;
      return true;
    });

    var linhas = lista.map(function (p) {
      var cliente = util.porId(estado.clientes, p.clienteId);
      var c = consumo[p.id] || { ensaios: 0, amostras: 0, custo: 0 };
      var saldo = p.quantidade - c.amostras;
      var dias = util.diffDias(ctx.hoje, p.dataAmostras);
      return '<tr data-peca="' + e(p.id) + '">' +
        '<td><div class="forte">' + e(p.nome) + '</div><div class="sub">' + e(p.programa || '') + '</div></td>' +
        '<td>' + e(cliente ? cliente.nome : p.clienteId) + '</td>' +
        '<td>' + ui.etiquetaArea(p.area) + '</td>' +
        '<td>' + e(util.formatarData(p.dataAmostras, true)) +
          '<div class="sub">' + (dias > 0 ? 'em ' + dias + ' dia(s)' : 'disponível') + '</div></td>' +
        '<td class="num">' + p.quantidade + '</td>' +
        '<td class="num">' + c.amostras +
          (saldo < 0 ? ' <span class="etiqueta erro">faltam ' + Math.abs(saldo) + '</span>' : '') + '</td>' +
        '<td class="num">' + c.ensaios + '</td>' +
        '<td class="num">' + e(util.formatarMoeda(c.custo)) + '</td>' +
        '<td>' + (c.ultimoFim ? e(util.formatarData(c.ultimoFim, true)) : '<span class="sub">—</span>') + '</td>' +
        '<td class="num" style="white-space:nowrap">' +
          '<button class="botao pequeno editar">Editar</button> ' +
          '<button class="botao pequeno perigo excluir">✕</button></td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Peças e amostras</h2>' +
        '<p>Quando o lote de amostras chega ao laboratório e quantas peças existem. O planejamento nunca agenda um ensaio antes dessa data.</p></div>' +
        '<div class="acoes"><button class="botao primario" id="nova">+ Nova peça</button></div>' +
      '</div>' +
      '<div class="cartao">' +
        '<div class="cartao-topo"><div class="filtros" style="flex:1">' +
          '<div class="campo"><label>Cliente</label><select id="f-cliente">' + ui.opcoes(estado.clientes, f.clienteId, 'Todos') + '</select></div>' +
          '<div class="campo"><label>Área</label><select id="f-area">' + ui.opcoes(TC.data.AREAS.filter(function (a) { return a.id !== 'AMBOS'; }), f.area, 'Hot + Cold') + '</select></div>' +
        '</div></div>' +
        (lista.length ? '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Peça</th><th>Cliente</th><th>Área</th><th>Amostras a partir de</th><th class="num">Disponíveis</th>' +
          '<th class="num">Comprometidas</th><th class="num">Ensaios</th><th class="num">Custo</th><th>Fim da validação</th><th></th>' +
          '</tr></thead><tbody>' + linhas + '</tbody></table></div>'
          : ui.vazio('Nenhuma peça cadastrada', 'Cadastre a peça para poder confirmar testes sobre ela.')) +
      '</div>';

    container.querySelector('#nova').onclick = function () { abrirEdicao(ctx, null); };
    ['cliente:clienteId', 'area:area'].forEach(function (par) {
      var p = par.split(':');
      var alvo = container.querySelector('#f-' + p[0]);
      alvo.addEventListener('change', function () { f[p[1]] = alvo.value; ctx.atualizar(); });
    });
    container.querySelectorAll('tr[data-peca]').forEach(function (tr) {
      var peca = util.porId(estado.pecas, tr.dataset.peca);
      tr.querySelector('.editar').onclick = function () { abrirEdicao(ctx, peca); };
      tr.querySelector('.excluir').onclick = function () {
        var usos = ctx.estado.demandas.filter(function (d) { return d.pecaId === peca.id; }).length;
        ui.confirmarAcao('Remover "' + peca.nome + '"?' + (usos ? ' Há ' + usos + ' demanda(s) associada(s), que ficarão sem peça.' : ''), function () {
          TC.store.removerPeca(peca.id);
          ui.notificar('Peça removida.');
        });
      };
    });
  }

  TC.views = TC.views || {};
  TC.views.pecas = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
