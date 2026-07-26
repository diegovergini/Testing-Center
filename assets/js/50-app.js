/* Testing Center — controlador: navegação, eventos e exportações. */
(function (root) {
  'use strict';
  var util = root.TC.util;
  var seed = root.TC.seed;
  var store = root.TC.store;
  var views = root.TC.views;

  var $ = views.$;
  var $$ = views.$$;
  var esc = views.esc;
  var filtros = views.filtros;
  var selecao = views.selecao;
  var destaque = views.destaque;

  var abaAtual = 'catalogo';
  var temporizadorDestaque = null;

  function render() {
    var estado = store.getEstado();
    var plano = store.getPlano();
    views.renderCabecalho(estado, plano);
    if (abaAtual === 'catalogo') views.renderCatalogo(estado);
    if (abaAtual === 'demandas') views.renderDemandas(estado, plano);
    if (abaAtual === 'plano') views.renderPlano(estado, plano);
    if (abaAtual === 'equipamentos') views.renderEquipamentos(estado, plano);
    if (abaAtual === 'visao') views.renderVisao(estado, plano);
  }

  function irPara(aba) {
    abaAtual = aba;
    $$('.aba').forEach(function (b) {
      var ativo = b.dataset.aba === aba;
      b.classList.toggle('ativa', ativo);
      b.setAttribute('aria-selected', ativo ? 'true' : 'false');
    });
    $$('.vista').forEach(function (v) { v.hidden = v.id !== 'view-' + aba; });
    render();
  }

  /* ---------- filtros do catálogo ---------- */

  function preencherFiltros() {
    opcoes('#f-cliente', seed.CLIENTES, 'Todos os clientes');
    opcoes('#f-peca', seed.TIPOS_PECA, 'Todas as peças');
    opcoes('#f-fase', seed.FASES, 'Todas as fases');
    opcoes('#f-equip', seed.TIPOS_EQUIP, 'Todos os equipamentos');
  }

  function opcoes(sel, lista, rotuloVazio) {
    $(sel).innerHTML = '<option value="">' + esc(rotuloVazio) + '</option>' +
      lista.map(function (i) {
        return '<option value="' + esc(i.id) + '">' + esc(i.nome) + '</option>';
      }).join('');
  }

  /* ---------- modal de confirmação de necessidade ---------- */

  function abrirConfirmacao() {
    if (!selecao.size) return;
    var estado = store.getEstado();
    var itens = estado.catalogo.filter(function (t) { return selecao.has(t.id); });

    var fasesDisponiveis = [];
    seed.FASES.forEach(function (f) {
      if (itens.some(function (t) { return t.fases.indexOf(f.id) !== -1; })) fasesDisponiveis.push(f);
    });

    $('#conf-fase').innerHTML = fasesDisponiveis.map(function (f) {
      return '<option value="' + esc(f.id) + '"' + (f.id === filtros.fase ? ' selected' : '') + '>' +
        esc(f.nome) + '</option>';
    }).join('');

    $('#conf-peca-disp').value = util.addDias(estado.dataBase, 7);
    $('#conf-alvo').value = util.addDias(estado.dataBase, 90);

    $('#conf-itens').innerHTML = itens.map(function (t) {
      var pecas = t.pecas.map(function (p) {
        return '<option value="' + esc(p) + '"' + (p === filtros.peca ? ' selected' : '') + '>' +
          esc(views.nomePeca(p)) + '</option>';
      }).join('');
      return '<li data-teste="' + esc(t.id) + '">' +
        '<div class="ci-nome"><strong>' + esc(t.nome) + '</strong>' +
        '<small>' + esc(views.nomeCliente(t.clienteId)) + ' · ' + esc(t.norma) + ' · ' +
        esc(util.duracao(t.duracaoHoras)) + '</small></div>' +
        '<label class="ci-peca">Peça<select data-conf="peca">' + pecas + '</select></label>' +
        '<label class="ci-am">Amostras<input type="number" min="1" step="1" value="' + t.amostrasPadrao +
          '" data-conf="amostras"></label>' +
        '<span class="ci-custo" data-custo>' + esc(util.moeda(seed.custoPadrao(t))) + '</span>' +
        '</li>';
    }).join('');

    atualizarTotalConfirmacao();
    $('#dlg-confirmar').showModal();
  }

  function atualizarTotalConfirmacao() {
    var estado = store.getEstado();
    var catalogo = util.indexarPor(estado.catalogo);
    var total = 0, horas = 0;
    $$('#conf-itens li').forEach(function (li) {
      var t = catalogo[li.dataset.teste];
      if (!t) return;
      var amostras = Math.max(1, Number(li.querySelector('[data-conf="amostras"]').value) || 1);
      var custo = seed.custoDemanda(t, amostras);
      var corridas = Math.max(1, Math.ceil(amostras / (t.amostrasPorCorrida || 1)));
      li.querySelector('[data-custo]').textContent = util.moeda(custo);
      total += custo;
      horas += t.duracaoHoras * corridas;
    });
    $('#conf-total').innerHTML = '<span>Custo estimado</span><strong>' + esc(util.moeda(total)) +
      '</strong><span>· ' + esc(util.numero(horas)) + ' h de bancada</span>';
  }

  function submeterConfirmacao(ev) {
    ev.preventDefault();
    var projeto = $('#conf-projeto').value.trim() || 'Sem projeto';
    var fase = $('#conf-fase').value;
    var dataPeca = $('#conf-peca-disp').value;
    var dataAlvo = $('#conf-alvo').value;
    var prioridade = $('#conf-prioridade').value;
    var solicitante = $('#conf-solicitante').value.trim();
    var obs = $('#conf-obs').value.trim();

    var estado = store.getEstado();
    var catalogo = util.indexarPor(estado.catalogo);

    var itens = $$('#conf-itens li').map(function (li) {
      var t = catalogo[li.dataset.teste] || {};
      return {
        testeId: li.dataset.teste,
        projeto: projeto,
        peca: li.querySelector('[data-conf="peca"]').value,
        // Se a fase escolhida não vale para este ensaio, cai na primeira fase prevista pela norma.
        fase: (t.fases || []).indexOf(fase) !== -1 ? fase : (t.fases || [fase])[0],
        amostras: Number(li.querySelector('[data-conf="amostras"]').value) || 1,
        dataPecaDisponivel: dataPeca,
        dataAlvo: dataAlvo,
        prioridade: prioridade,
        solicitante: solicitante,
        obs: obs
      };
    });

    var criadas = store.confirmarNecessidade(itens);
    $('#dlg-confirmar').close();
    selecao.clear();

    marcarDestaque(criadas.map(function (d) { return d.id; }));
    irPara('plano');
    anunciar(criadas.length + ' ensaio(s) confirmado(s) e alocado(s) na agenda.');
  }

  function marcarDestaque(ids) {
    destaque.clear();
    ids.forEach(function (id) { destaque.add(id); });
    clearTimeout(temporizadorDestaque);
    temporizadorDestaque = setTimeout(function () { destaque.clear(); render(); }, 6000);
  }

  function anunciar(msg) {
    var el = $('#aviso');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(anunciar._t);
    anunciar._t = setTimeout(function () { el.hidden = true; }, 5000);
  }

  /* ---------- exportações ---------- */

  function baixar(nome, conteudo, tipo) {
    var blob = new Blob([conteudo], { type: tipo + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csv(linhas) {
    return '﻿' + linhas.map(function (l) {
      return l.map(function (c) {
        var s = String(c == null ? '' : c);
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(';');
    }).join('\n');
  }

  function exportarCatalogo() {
    var lista = views.catalogoFiltrado(store.getEstado());
    var linhas = [['Cliente', 'Procedimento', 'Código', 'Norma', 'Peças', 'Fases', 'Equipamento',
      'Duração (h)', 'Amostras padrão', 'Custo setup (R$)', 'Custo por amostra (R$)', 'Custo padrão (R$)', 'Criticidade']];
    lista.forEach(function (t) {
      linhas.push([views.nomeCliente(t.clienteId), t.nome, t.procedimentoId, t.norma,
        t.pecas.join(' / '), t.fases.join(' / '), t.equipTipo, t.duracaoHoras, t.amostrasPadrao,
        t.custoSetup, t.custoAmostra, seed.custoPadrao(t), t.criticidade]);
    });
    baixar('catalogo-ensaios.csv', csv(linhas), 'text/csv');
  }

  function exportarPlano() {
    var estado = store.getEstado();
    var plano = store.getPlano();
    var catalogo = util.indexarPor(estado.catalogo);
    var demandas = util.indexarPor(estado.demandas);
    var linhas = [['Demanda', 'Cliente', 'Projeto', 'Ensaio', 'Norma', 'Peça', 'Fase', 'Equipamento',
      'Início', 'Fim', 'Dias produtivos', 'Amostras', 'Corridas', 'Horas', 'Custo (R$)', 'Data alvo', 'Atraso (dias)']];
    plano.alocacoes.forEach(function (a) {
      var t = catalogo[a.testeId] || {}; var d = demandas[a.demandaId] || {};
      linhas.push([a.demandaId, views.nomeCliente(a.clienteId), d.projeto, t.nome, t.norma,
        views.nomePeca(d.peca), d.fase, a.equipamentoId, a.inicio, a.fim, a.diasProdutivos,
        a.amostras, a.corridas, a.horas, a.custo, d.dataAlvo || '', a.atrasoDias]);
    });
    plano.naoAlocadas.forEach(function (n) {
      var d = demandas[n.demandaId] || {}; var t = catalogo[n.testeId] || {};
      linhas.push([n.demandaId, views.nomeCliente(t.clienteId), d.projeto, t.nome, t.norma,
        views.nomePeca(d.peca), d.fase, 'NÃO ALOCADO', '', '', '', d.amostras, '', '', '', d.dataAlvo || '', n.motivo]);
    });
    baixar('planejamento-ensaios.csv', csv(linhas), 'text/csv');
  }

  /* ---------- eventos ---------- */

  function ligarEventos() {
    $$('.aba').forEach(function (b) {
      b.addEventListener('click', function () { irPara(b.dataset.aba); });
    });

    ['cliente', 'peca', 'fase', 'equip'].forEach(function (campo) {
      $('#f-' + campo).addEventListener('change', function (e) {
        filtros[campo] = e.target.value;
        render();
      });
    });

    var t = null;
    $('#f-busca').addEventListener('input', function (e) {
      clearTimeout(t);
      var v = e.target.value;
      t = setTimeout(function () { filtros.busca = v; render(); }, 150);
    });

    $$('[data-modo]').forEach(function (b) {
      b.addEventListener('click', function () {
        filtros.modo = b.dataset.modo;
        $$('[data-modo]').forEach(function (x) { x.classList.toggle('ativa', x === b); });
        render();
      });
    });

    $('#f-limpar').addEventListener('click', function () {
      filtros.cliente = filtros.peca = filtros.fase = filtros.equip = filtros.busca = '';
      ['cliente', 'peca', 'fase', 'equip'].forEach(function (c) { $('#f-' + c).value = ''; });
      $('#f-busca').value = '';
      render();
    });

    // Catálogo: seleção e clique na matriz.
    $('#view-catalogo').addEventListener('click', function (ev) {
      var chk = ev.target.closest('[data-acao="selecionar"]');
      if (chk) {
        if (chk.checked) selecao.add(chk.dataset.teste); else selecao.delete(chk.dataset.teste);
        chk.closest('tr').classList.toggle('sel', chk.checked);
        views.renderBarraSelecao();
        return;
      }
      var linha = ev.target.closest('tr[data-teste]');
      if (linha && !ev.target.closest('input')) {
        var box = linha.querySelector('[data-acao="selecionar"]');
        box.checked = !box.checked;
        box.dispatchEvent(new Event('click', { bubbles: true }));
        return;
      }
      var celula = ev.target.closest('.mx-cell[data-teste]');
      if (celula) {
        selecao.clear();
        selecao.add(celula.dataset.teste);
        abrirConfirmacao();
      }
    });

    $('#view-catalogo').addEventListener('keydown', function (ev) {
      var celula = ev.target.closest && ev.target.closest('.mx-cell[data-teste]');
      if (celula && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        selecao.clear(); selecao.add(celula.dataset.teste); abrirConfirmacao();
      }
    });

    $('#cat-todos').addEventListener('change', function (e) {
      var lista = views.catalogoFiltrado(store.getEstado());
      if (e.target.checked) lista.forEach(function (x) { selecao.add(x.id); });
      else lista.forEach(function (x) { selecao.delete(x.id); });
      render();
    });

    $('#sel-confirmar').addEventListener('click', abrirConfirmacao);
    $('#sel-limpar').addEventListener('click', function () { selecao.clear(); render(); });

    $('#form-confirmar').addEventListener('submit', submeterConfirmacao);
    $('#conf-cancelar').addEventListener('click', function () { $('#dlg-confirmar').close(); });
    $('#conf-itens').addEventListener('input', atualizarTotalConfirmacao);

    // Demandas: edição inline e remoção.
    $('#view-demandas').addEventListener('change', function (ev) {
      var alvo = ev.target.closest('[data-campo][data-demanda]');
      if (!alvo) return;
      var valor = alvo.type === 'number' ? Math.max(1, Number(alvo.value) || 1) : alvo.value;
      var campos = {};
      campos[alvo.dataset.campo] = valor;
      store.atualizarDemanda(alvo.dataset.demanda, campos);
    });

    $('#view-demandas').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-acao="remover-demanda"]');
      if (!btn) return;
      var id = btn.dataset.demanda;
      if (confirm('Remover a demanda ' + id + ' do planejamento?')) store.removerDemanda(id);
    });

    // Equipamentos: capacidade, jornada e paradas.
    $('#view-equipamentos').addEventListener('change', function (ev) {
      var alvo = ev.target.closest('[data-campo-equip][data-equip]');
      if (!alvo) return;
      var campo = alvo.dataset.campoEquip;
      var valor = alvo.type === 'checkbox' ? alvo.checked : Math.max(1, Number(alvo.value) || 1);
      if (campo === 'horasPorDia') valor = Math.min(24, valor);
      var campos = {};
      campos[campo] = valor;
      store.atualizarEquipamento(alvo.dataset.equip, campos);
    });

    $('#view-equipamentos').addEventListener('submit', function (ev) {
      var form = ev.target.closest('.form-manut');
      if (!form) return;
      ev.preventDefault();
      var inicio = form.inicio.value, fim = form.fim.value;
      if (!inicio || !fim) return;
      if (fim < inicio) { anunciar('A data final da parada não pode ser anterior à inicial.'); return; }
      store.adicionarManutencao(form.dataset.equip, {
        inicio: inicio, fim: fim, motivo: form.motivo.value.trim() || 'Manutenção'
      });
    });

    $('#view-equipamentos').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-acao="remover-manut"]');
      if (!btn) return;
      store.removerManutencao(btn.dataset.equip, Number(btn.dataset.idx));
    });

    // Gantt: clicar numa barra leva à demanda correspondente.
    $('#view-plano').addEventListener('click', function (ev) {
      var barra = ev.target.closest('.g-barra[data-demanda]');
      if (!barra) return;
      marcarDestaque([barra.dataset.demanda]);
      irPara('demandas');
    });

    $('#btn-exportar-catalogo').addEventListener('click', exportarCatalogo);
    $('#btn-exportar-plano').addEventListener('click', exportarPlano);
    $('#btn-exportar-json').addEventListener('click', function () {
      baixar('testing-center.json', store.exportar(), 'application/json');
    });
    $('#btn-importar').addEventListener('click', function () { $('#file-importar').click(); });
    $('#file-importar').addEventListener('change', function (ev) {
      var arquivo = ev.target.files && ev.target.files[0];
      if (!arquivo) return;
      var leitor = new FileReader();
      leitor.onload = function () {
        try { store.importar(String(leitor.result)); anunciar('Base importada e replanejada.'); }
        catch (e) { anunciar('Não foi possível importar: ' + e.message); }
      };
      leitor.readAsText(arquivo);
      ev.target.value = '';
    });
    $('#btn-reset').addEventListener('click', function () {
      if (confirm('Restaurar a base de exemplo? As demandas atuais serão descartadas.')) {
        store.restaurarSemente();
        selecao.clear();
        anunciar('Base de exemplo restaurada.');
      }
    });
  }

  function iniciar() {
    store.carregar();
    store.subscrever(function () { render(); });
    preencherFiltros();
    ligarEventos();
    irPara('catalogo');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(typeof self !== 'undefined' ? self : this);
