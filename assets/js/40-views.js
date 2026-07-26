/* Testing Center — renderização das telas. */
(function (root) {
  'use strict';
  var util = root.TC.util;
  var seed = root.TC.seed;
  var TC = root.TC;

  var CLIENTES = util.indexarPor(seed.CLIENTES);
  var PECAS = util.indexarPor(seed.TIPOS_PECA);
  var FASES = util.indexarPor(seed.FASES);
  var TIPOS_EQUIP = util.indexarPor(seed.TIPOS_EQUIP);

  var filtros = { cliente: '', peca: '', fase: '', equip: '', busca: '', modo: 'lista' };
  var selecao = new Set();
  var destaque = new Set();

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function nomeCliente(id) { return (CLIENTES[id] || {}).nome || id; }
  function corCliente(id) { return (CLIENTES[id] || {}).cor || '#7b8798'; }
  function nomePeca(id) { return (PECAS[id] || {}).nome || id; }
  function nomeFase(id) { return (FASES[id] || {}).nome || id; }
  function nomeEquipTipo(id) { return (TIPOS_EQUIP[id] || {}).nome || id; }

  function chipCliente(id) {
    return '<span class="chip-cliente"><i style="background:' + corCliente(id) + '"></i>' +
      esc(nomeCliente(id)) + '</span>';
  }

  function tagFase(f) {
    return '<span class="tag tag-fase" title="' + esc(nomeFase(f)) + '">' + esc(f) + '</span>';
  }

  function tagCrit(c) {
    return '<span class="tag crit-' + util.slug(c) + '">' + esc(c) + '</span>';
  }

  /* ============================ CATÁLOGO ============================ */

  function catalogoFiltrado(estado) {
    var busca = util.normalizar(filtros.busca).trim();
    return estado.catalogo.filter(function (t) {
      if (filtros.cliente && t.clienteId !== filtros.cliente) return false;
      if (filtros.peca && t.pecas.indexOf(filtros.peca) === -1) return false;
      if (filtros.fase && t.fases.indexOf(filtros.fase) === -1) return false;
      if (filtros.equip && t.equipTipo !== filtros.equip) return false;
      if (busca) {
        var alvo = util.normalizar([t.nome, t.norma, nomeCliente(t.clienteId), t.procedimentoId].join(' '));
        if (alvo.indexOf(busca) === -1) return false;
      }
      return true;
    });
  }

  function renderCatalogo(estado) {
    var lista = catalogoFiltrado(estado);

    $('#cat-kpis').innerHTML = [
      kpiInline('Ensaios no filtro', util.numero(lista.length)),
      kpiInline('Custo do escopo', util.moedaCompacta(util.soma(lista, seed.custoPadrao))),
      kpiInline('Horas de bancada', util.numero(util.soma(lista, function (t) { return t.duracaoHoras; })) + ' h'),
      kpiInline('Clientes', String(new Set(lista.map(function (t) { return t.clienteId; })).size))
    ].join('');

    $('#cat-lista').hidden = filtros.modo !== 'lista';
    $('#cat-matriz').hidden = filtros.modo !== 'matriz';

    if (filtros.modo === 'lista') renderCatalogoLista(lista);
    else renderCatalogoMatriz(lista);

    renderBarraSelecao();
  }

  function kpiInline(rotulo, valor) {
    return '<div class="kpi-inline"><span>' + esc(rotulo) + '</span><strong>' + esc(valor) + '</strong></div>';
  }

  function renderCatalogoLista(lista) {
    if (!lista.length) {
      $('#cat-tbody').innerHTML = '<tr><td colspan="10" class="vazio">Nenhum ensaio para este filtro.</td></tr>';
      return;
    }
    var linhas = lista.map(function (t) {
      var marcado = selecao.has(t.id);
      return '<tr class="' + (marcado ? 'sel' : '') + '" data-teste="' + esc(t.id) + '">' +
        '<td class="c-check"><input type="checkbox" data-acao="selecionar" data-teste="' + esc(t.id) + '"' +
          (marcado ? ' checked' : '') + ' aria-label="Selecionar ' + esc(t.nome) + '"></td>' +
        '<td>' + chipCliente(t.clienteId) + '</td>' +
        '<td class="c-nome"><strong>' + esc(t.nome) + '</strong><small>' + esc(t.procedimentoId) + '</small></td>' +
        '<td class="c-norma"><code>' + esc(t.norma) + '</code></td>' +
        '<td class="c-pecas">' + t.pecas.map(function (p) {
            return '<span class="tag tag-peca" title="' + esc(nomePeca(p)) + '">' + esc(p) + '</span>';
          }).join('') + '</td>' +
        '<td class="c-fases">' + t.fases.map(tagFase).join('') + '</td>' +
        '<td class="c-equip"><span title="' + esc(nomeEquipTipo(t.equipTipo)) + '">' + esc(nomeEquipTipo(t.equipTipo)) + '</span></td>' +
        '<td class="num">' + esc(util.duracao(t.duracaoHoras)) + '</td>' +
        '<td class="num forte">' + esc(util.moeda(seed.custoPadrao(t))) +
          '<small>' + esc(t.amostrasPadrao) + ' am. · setup ' + esc(util.moedaCompacta(t.custoSetup)) + '</small></td>' +
        '<td>' + tagCrit(t.criticidade) + '</td>' +
        '</tr>';
    });
    $('#cat-tbody').innerHTML = linhas.join('');
  }

  /* Matriz procedimento × cliente: leitura rápida de "quem exige o quê". */
  function renderCatalogoMatriz(lista) {
    var clientes = seed.CLIENTES.filter(function (c) {
      return !filtros.cliente || c.id === filtros.cliente;
    });
    var porProc = util.agrupar(lista, function (t) { return t.procedimentoId; });
    var procs = seed.PROCEDIMENTOS.filter(function (p) { return porProc.has(p.id); });

    if (!procs.length) {
      $('#cat-matriz').innerHTML = '<p class="vazio">Nenhum ensaio para este filtro.</p>';
      return;
    }

    var cab = '<tr><th class="mx-proc">Procedimento</th>' + clientes.map(function (c) {
      return '<th class="mx-cli"><i style="background:' + c.cor + '"></i>' + esc(c.nome) + '</th>';
    }).join('') + '</tr>';

    var corpo = procs.map(function (p) {
      var itens = porProc.get(p.id) || [];
      var porCliente = util.indexarPor(itens, 'clienteId');
      return '<tr><th class="mx-proc"><strong>' + esc(p.nome) + '</strong><small>' + esc(p.id) +
        ' · ' + esc(nomeEquipTipo(p.equip)) + '</small></th>' +
        clientes.map(function (c) {
          var t = porCliente[c.id];
          if (!t) return '<td class="mx-cell mx-off">—</td>';
          return '<td class="mx-cell" data-teste="' + esc(t.id) + '" tabindex="0" role="button" ' +
            'title="Clique para confirmar necessidade">' +
            '<code>' + esc(t.norma) + '</code>' +
            '<span class="mx-val">' + esc(util.moedaCompacta(seed.custoPadrao(t))) + '</span>' +
            '<span class="mx-dur">' + esc(util.numero(t.duracaoHoras)) + ' h</span>' +
            '<span class="mx-fases">' + t.fases.join(' · ') + '</span>' +
            '</td>';
        }).join('') + '</tr>';
    }).join('');

    $('#cat-matriz').innerHTML = '<table class="tabela matriz"><thead>' + cab + '</thead><tbody>' + corpo + '</tbody></table>';
  }

  function renderBarraSelecao() {
    var barra = $('#cat-selecao');
    var n = selecao.size;
    barra.hidden = n === 0;
    if (n) {
      var estado = TC.store.getEstado();
      var itens = estado.catalogo.filter(function (t) { return selecao.has(t.id); });
      $('#sel-resumo').innerHTML = '<strong>' + n + '</strong> ensaio' + (n > 1 ? 's' : '') +
        ' · ' + esc(util.moeda(util.soma(itens, seed.custoPadrao))) +
        ' · ' + esc(util.numero(util.soma(itens, function (t) { return t.duracaoHoras; }))) + ' h';
    }
  }

  /* ============================ DEMANDAS ============================ */

  function renderDemandas(estado, plano) {
    var porDemanda = util.indexarPor(plano.alocacoes, 'demandaId');
    var motivos = {};
    plano.naoAlocadas.forEach(function (n) { motivos[n.demandaId] = n.motivo; });
    var catalogo = util.indexarPor(estado.catalogo);

    var lista = estado.demandas.slice().sort(function (a, b) {
      var aa = (porDemanda[a.id] || {}).inicio || '9999';
      var bb = (porDemanda[b.id] || {}).inicio || '9999';
      return aa < bb ? -1 : aa > bb ? 1 : 0;
    });

    if (!lista.length) {
      $('#dem-tbody').innerHTML = '<tr><td colspan="11" class="vazio">' +
        'Nenhuma necessidade confirmada. Vá ao catálogo, selecione os ensaios e confirme.</td></tr>';
      $('#dem-kpis').innerHTML = '';
      return;
    }

    $('#dem-kpis').innerHTML = [
      kpiInline('Demandas', util.numero(lista.length)),
      kpiInline('Planejadas', util.numero(plano.alocacoes.length)),
      kpiInline('Sem janela', util.numero(plano.naoAlocadas.length)),
      kpiInline('Custo confirmado', util.moedaCompacta(plano.resumo.custoTotal))
    ].join('');

    $('#dem-tbody').innerHTML = lista.map(function (d) {
      var t = catalogo[d.testeId] || {};
      var a = porDemanda[d.id];
      var novo = destaque.has(d.id) ? ' novo' : '';
      var situacao;
      if (a) {
        situacao = '<span class="tag ' + (a.noPrazo ? 'ok' : 'alerta') + '">' +
          (a.noPrazo ? 'No prazo' : 'Atraso ' + a.atrasoDias + 'd') + '</span>';
      } else {
        situacao = '<span class="tag erro" title="' + esc(motivos[d.id] || '') + '">Sem janela</span>';
      }
      return '<tr class="' + novo + '" data-demanda="' + esc(d.id) + '">' +
        '<td class="mono">' + esc(d.id) + '</td>' +
        '<td>' + chipCliente(t.clienteId) + '</td>' +
        '<td class="c-nome"><strong>' + esc(t.nome || d.testeId) + '</strong><small>' + esc(t.norma || '') + '</small></td>' +
        '<td>' + esc(d.projeto) + '<small class="sub">' + esc(nomePeca(d.peca)) + '</small></td>' +
        '<td>' + tagFase(d.fase) + '</td>' +
        '<td class="num"><input class="mini" type="number" min="1" step="1" value="' + esc(d.amostras) +
          '" data-campo="amostras" data-demanda="' + esc(d.id) + '" aria-label="Amostras"></td>' +
        '<td><input class="mini" type="date" value="' + esc(d.dataPecaDisponivel || '') +
          '" data-campo="dataPecaDisponivel" data-demanda="' + esc(d.id) + '" aria-label="Peça disponível"></td>' +
        '<td><input class="mini" type="date" value="' + esc(d.dataAlvo || '') +
          '" data-campo="dataAlvo" data-demanda="' + esc(d.id) + '" aria-label="Data alvo"></td>' +
        '<td>' + selectPrioridade(d) + '</td>' +
        '<td class="c-plan">' + (a
          ? '<strong>' + esc(util.dataCurta(a.inicio)) + ' → ' + esc(util.dataCurta(a.fim)) + '</strong>' +
            '<small>' + esc(a.equipamentoId) + ' · ' + esc(util.moedaCompacta(a.custo)) + '</small>'
          : '<span class="sub">—</span>') + '<br>' + situacao + '</td>' +
        '<td class="c-acoes"><button class="btn-icone" data-acao="remover-demanda" data-demanda="' +
          esc(d.id) + '" title="Remover demanda">✕</button></td>' +
        '</tr>';
    }).join('');
  }

  function selectPrioridade(d) {
    var ops = ['Crítica', 'Alta', 'Média', 'Baixa'];
    return '<select class="mini prio-' + util.slug(d.prioridade) + '" data-campo="prioridade" data-demanda="' +
      esc(d.id) + '" aria-label="Prioridade">' + ops.map(function (o) {
        return '<option value="' + o + '"' + (o === d.prioridade ? ' selected' : '') + '>' + o + '</option>';
      }).join('') + '</select>';
  }

  /* ============================ PLANEJAMENTO (GANTT) ============================ */

  var LARGURA_DIA = 13;

  function renderPlano(estado, plano) {
    var r = plano.resumo;
    $('#plan-kpis').innerHTML = [
      kpiCard('Ensaios planejados', util.numero(r.testes), r.pendencias ? r.pendencias + ' sem janela' : 'todos alocados', r.pendencias ? 'alerta' : 'ok'),
      kpiCard('Custo do plano', util.moedaCompacta(r.custoTotal), util.moeda(r.custoTotal), ''),
      kpiCard('Horas de bancada', util.numero(r.horasTotais) + ' h', util.numero(r.horasTotais / 24, 0) + ' dias-equipamento', ''),
      kpiCard('Aderência à data-alvo', r.aderencia + '%', r.atrasados + ' com atraso', r.atrasados ? 'alerta' : 'ok'),
      kpiCard('Janela do plano', r.primeiroInicio ? util.dataCurta(r.primeiroInicio) + ' → ' + util.dataCurta(r.ultimoFim) : '—',
        r.ultimoFim ? util.dataLonga(r.ultimoFim) : 'sem alocações', '')
    ].join('');

    renderGantt(estado, plano);
    renderPendencias(estado, plano);
  }

  function kpiCard(rotulo, valor, nota, tom) {
    return '<div class="kpi ' + tom + '"><span class="kpi-rot">' + esc(rotulo) + '</span>' +
      '<strong class="kpi-val">' + esc(valor) + '</strong>' +
      '<span class="kpi-nota">' + esc(nota) + '</span></div>';
  }

  function renderGantt(estado, plano) {
    var alvo = $('#gantt');
    if (!plano.alocacoes.length) {
      alvo.innerHTML = '<p class="vazio">Nada planejado ainda — confirme necessidades no catálogo.</p>';
      return;
    }

    var inicio = util.addDias(plano.resumo.primeiroInicio, -2);
    var fim = util.addDias(plano.resumo.ultimoFim, 3);
    var total = util.diffDias(inicio, fim) + 1;
    var largura = total * LARGURA_DIA;

    var catalogo = util.indexarPor(estado.catalogo);
    var demandas = util.indexarPor(estado.demandas);
    var porEquip = util.agrupar(plano.alocacoes, function (a) { return a.equipamentoId; });

    // Cabeçalho: faixa de meses + marcas semanais.
    var meses = [];
    var cursor = inicio;
    while (cursor <= fim) {
      var chave = cursor.slice(0, 7);
      var ultimo = meses[meses.length - 1];
      if (ultimo && ultimo.chave === chave) ultimo.dias++;
      else meses.push({ chave: chave, dias: 1, rotulo: util.rotuloMes(cursor) });
      cursor = util.addDias(cursor, 1);
    }

    var faixaMeses = meses.map(function (m) {
      return '<div class="g-mes" style="width:' + (m.dias * LARGURA_DIA) + 'px">' + esc(m.rotulo) + '</div>';
    }).join('');

    var marcas = [];
    for (var i = 0; i < total; i++) {
      var dia = util.addDias(inicio, i);
      if (util.diaDaSemana(dia) === 1) {
        marcas.push('<div class="g-marca" style="left:' + (i * LARGURA_DIA) + 'px">' + util.dataCurta(dia) + '</div>');
      }
    }

    // Camada de fundo: fins de semana e o marcador de hoje.
    var fundo = [];
    for (var j = 0; j < total; j++) {
      var d2 = util.addDias(inicio, j);
      if (util.ehFimDeSemana(d2)) {
        fundo.push('<div class="g-fds" style="left:' + (j * LARGURA_DIA) + 'px;width:' + LARGURA_DIA + 'px"></div>');
      }
    }
    var hoje = util.hojeISO();
    var offHoje = util.diffDias(inicio, hoje);
    if (offHoje >= 0 && offHoje < total) {
      fundo.push('<div class="g-hoje" style="left:' + (offHoje * LARGURA_DIA) + 'px" title="Hoje"></div>');
    }

    var linhas = estado.equipamentos.map(function (eq) {
      var itens = (porEquip.get(eq.id) || []).slice().sort(function (a, b) {
        return a.inicio < b.inicio ? -1 : 1;
      });
      var faixas = distribuirFaixas(itens);
      var altura = Math.max(48, faixas.length * 26 + 10);

      var manut = (eq.manutencao || []).map(function (m) {
        if (m.fim < inicio || m.inicio > fim) return '';
        var ini = m.inicio < inicio ? inicio : m.inicio;
        var f = m.fim > fim ? fim : m.fim;
        return '<div class="g-manut" style="left:' + (util.diffDias(inicio, ini) * LARGURA_DIA) + 'px;width:' +
          ((util.diffDias(ini, f) + 1) * LARGURA_DIA) + 'px" title="Manutenção: ' + esc(m.motivo || '') +
          ' (' + esc(util.dataCurta(m.inicio)) + '–' + esc(util.dataCurta(m.fim)) + ')"></div>';
      }).join('');

      var barras = faixas.map(function (faixa, idx) {
        return faixa.map(function (a) {
          var t = catalogo[a.testeId] || {};
          var dem = demandas[a.demandaId] || {};
          var left = util.diffDias(inicio, a.inicio) * LARGURA_DIA;
          var w = (util.diffDias(a.inicio, a.fim) + 1) * LARGURA_DIA;
          var titulo = [
            t.nome + ' (' + t.norma + ')',
            nomeCliente(a.clienteId) + ' · ' + dem.projeto,
            'Fase ' + dem.fase + ' · ' + a.amostras + ' amostra(s) · ' + a.corridas + ' corrida(s)',
            util.dataLonga(a.inicio) + ' → ' + util.dataLonga(a.fim),
            a.diasProdutivos + ' dias produtivos · ' + util.numero(a.horas) + ' h · ' + util.moeda(a.custo),
            dem.dataAlvo ? (a.noPrazo ? 'Dentro da data-alvo' : 'Atraso de ' + a.atrasoDias + ' dia(s)') : 'Sem data-alvo'
          ].join('\n');
          return '<div class="g-barra' + (a.noPrazo ? '' : ' atrasada') + (destaque.has(a.demandaId) ? ' novo' : '') +
            '" data-demanda="' + esc(a.demandaId) + '" tabindex="0"' +
            ' style="left:' + left + 'px;width:' + w + 'px;top:' + (idx * 26 + 5) + 'px;--cor:' + corCliente(a.clienteId) + '"' +
            ' title="' + esc(titulo) + '">' +
            '<span class="g-rot">' + esc(t.procedimentoId || '') + ' · ' + esc(dem.projeto || '') + '</span></div>';
        }).join('');
      }).join('');

      return '<div class="g-linha" style="height:' + altura + 'px">' +
        '<div class="g-lbl"><strong>' + esc(eq.id) + '</strong><small>' + esc(eq.nome) + '</small>' +
        '<small class="sub">cap. ' + eq.capacidade + ' · ' + eq.horasPorDia + ' h/dia</small></div>' +
        '<div class="g-pista" style="width:' + largura + 'px">' + manut + barras + '</div>' +
        '</div>';
    }).join('');

    alvo.innerHTML =
      '<div class="g-wrap">' +
        '<div class="g-topo">' +
          '<div class="g-lbl g-lbl-topo">Equipamento</div>' +
          '<div class="g-pista g-pista-topo" style="width:' + largura + 'px">' +
            '<div class="g-meses">' + faixaMeses + '</div>' +
            '<div class="g-marcas">' + marcas.join('') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="g-corpo">' +
          '<div class="g-lbl-col"></div>' +
          '<div class="g-fundo" style="width:' + largura + 'px">' + fundo.join('') + '</div>' +
          linhas +
        '</div>' +
      '</div>';
  }

  /* Empacota alocações que se sobrepõem em faixas distintas dentro da mesma unidade
     (uma unidade com capacidade > 1 roda ensaios em paralelo). */
  function distribuirFaixas(itens) {
    var faixas = [];
    itens.forEach(function (a) {
      for (var i = 0; i < faixas.length; i++) {
        var ultima = faixas[i][faixas[i].length - 1];
        if (ultima.fim < a.inicio) { faixas[i].push(a); return; }
      }
      faixas.push([a]);
    });
    return faixas;
  }

  function renderPendencias(estado, plano) {
    var alvo = $('#plan-pendencias');
    var atrasadas = plano.alocacoes.filter(function (a) { return !a.noPrazo; });
    if (!plano.naoAlocadas.length && !atrasadas.length) {
      alvo.innerHTML = '<p class="ok-msg">Todos os ensaios confirmados couberam na agenda dentro da data-alvo.</p>';
      return;
    }
    var demandas = util.indexarPor(estado.demandas);
    var catalogo = util.indexarPor(estado.catalogo);
    var blocos = [];

    if (atrasadas.length) {
      blocos.push('<h3 class="risco">Ensaios que estouram a data-alvo (' + atrasadas.length + ')</h3><ul class="lista-risco">' +
        atrasadas.map(function (a) {
          var d = demandas[a.demandaId] || {}; var t = catalogo[a.testeId] || {};
          return '<li><strong>' + esc(t.nome) + '</strong> — ' + esc(nomeCliente(a.clienteId)) + ' / ' + esc(d.projeto) +
            ' <span class="tag alerta">+' + a.atrasoDias + ' d</span>' +
            '<small>termina em ' + esc(util.dataLonga(a.fim)) + ' · alvo ' + esc(util.dataLonga(d.dataAlvo)) +
            ' · ' + esc(a.equipamentoId) + (a.esperaDias ? ' · ' + a.esperaDias + ' d de fila' : '') + '</small></li>';
        }).join('') + '</ul>');
    }
    if (plano.naoAlocadas.length) {
      blocos.push('<h3 class="risco">Sem janela no horizonte (' + plano.naoAlocadas.length + ')</h3><ul class="lista-risco">' +
        plano.naoAlocadas.map(function (n) {
          var d = demandas[n.demandaId] || {}; var t = catalogo[n.testeId] || {};
          return '<li><strong>' + esc(t.nome || n.demandaId) + '</strong> — ' + esc(d.projeto || '') +
            '<small>' + esc(n.motivo) + '</small></li>';
        }).join('') + '</ul>');
    }
    alvo.innerHTML = blocos.join('');
  }

  /* ============================ EQUIPAMENTOS ============================ */

  function renderEquipamentos(estado, plano) {
    var uso = util.indexarPor(plano.resumo.utilizacao, 'equipamentoId');
    var horizonte = plano.resumo.ultimoFim
      ? util.diffDias(estado.dataBase, plano.resumo.ultimoFim) + 1
      : 30;

    $('#equip-lista').innerHTML = estado.equipamentos.map(function (e) {
      var u = uso[e.id] || { diasSlot: 0, horas: 0 };
      var capacidadeDias = horizonte * e.capacidade;
      var pct = capacidadeDias ? Math.min(100, Math.round((u.diasSlot / capacidadeDias) * 100)) : 0;
      var manut = (e.manutencao || []).map(function (m, i) {
        return '<li><span>' + esc(util.dataCurta(m.inicio)) + ' – ' + esc(util.dataCurta(m.fim)) + '</span>' +
          '<em>' + esc(m.motivo || 'Manutenção') + '</em>' +
          '<button class="btn-icone" data-acao="remover-manut" data-equip="' + esc(e.id) + '" data-idx="' + i +
          '" title="Remover janela">✕</button></li>';
      }).join('');

      return '<article class="card-equip">' +
        '<header><div><strong>' + esc(e.id) + '</strong><span>' + esc(e.nome) + '</span></div>' +
        '<span class="tag tag-tipo" title="' + esc(nomeEquipTipo(e.tipo)) + '">' + esc(e.tipo) + '</span></header>' +
        '<div class="uso"><div class="uso-barra"><i style="width:' + pct + '%"></i></div>' +
        '<span>' + pct + '% de ocupação · ' + util.numero(u.horas) + ' h no plano</span></div>' +
        '<div class="campos">' +
          '<label>Capacidade<input type="number" min="1" step="1" value="' + e.capacidade +
            '" data-campo-equip="capacidade" data-equip="' + esc(e.id) + '"></label>' +
          '<label>Horas/dia<input type="number" min="1" max="24" step="1" value="' + e.horasPorDia +
            '" data-campo-equip="horasPorDia" data-equip="' + esc(e.id) + '"></label>' +
          '<label class="check"><input type="checkbox" data-campo-equip="diasUteis" data-equip="' + esc(e.id) + '"' +
            (e.diasUteis ? ' checked' : '') + '>Só dias úteis</label>' +
        '</div>' +
        '<div class="manut"><span class="rot">Paradas programadas</span>' +
          (manut ? '<ul>' + manut + '</ul>' : '<p class="sub">Nenhuma parada programada.</p>') +
          '<form class="form-manut" data-equip="' + esc(e.id) + '">' +
            '<input type="date" name="inicio" required aria-label="Início da parada">' +
            '<input type="date" name="fim" required aria-label="Fim da parada">' +
            '<input type="text" name="motivo" placeholder="Motivo" aria-label="Motivo">' +
            '<button type="submit" class="btn-sec">Adicionar</button>' +
          '</form>' +
        '</div>' +
        '</article>';
    }).join('');
  }

  /* ============================ VISÃO POR CLIENTE ============================ */

  function renderVisao(estado, plano) {
    var catalogo = util.indexarPor(estado.catalogo);
    var demandas = util.indexarPor(estado.demandas);

    var porCliente = util.agrupar(plano.alocacoes, function (a) { return a.clienteId; });
    var linhasCliente = seed.CLIENTES.map(function (c) {
      var itens = porCliente.get(c.id) || [];
      var catalogoCliente = estado.catalogo.filter(function (t) { return t.clienteId === c.id; });
      return {
        cliente: c,
        planejados: itens.length,
        disponiveis: catalogoCliente.length,
        custo: util.soma(itens, function (a) { return a.custo; }),
        horas: util.soma(itens, function (a) { return a.horas; }),
        custoCatalogo: util.soma(catalogoCliente, seed.custoPadrao),
        atrasados: itens.filter(function (a) { return !a.noPrazo; }).length
      };
    }).sort(function (a, b) { return b.custo - a.custo; });

    var maxCusto = Math.max.apply(null, linhasCliente.map(function (l) { return l.custo; }).concat([1]));
    var maxHoras = Math.max.apply(null, linhasCliente.map(function (l) { return l.horas; }).concat([1]));

    var tabelaCliente = '<table class="tabela"><thead><tr>' +
      '<th>Cliente</th><th class="num">Ensaios no catálogo</th><th class="num">Confirmados</th><th class="num">Horas</th>' +
      '<th class="num">Custo planejado</th><th>Distribuição do custo</th><th class="num">Fora do prazo</th>' +
      '</tr></thead><tbody>' +
      linhasCliente.map(function (l) {
        return '<tr>' +
          '<td>' + chipCliente(l.cliente.id) + '</td>' +
          '<td class="num">' + l.disponiveis + '<small class="sub">' + esc(util.moedaCompacta(l.custoCatalogo)) + ' se full scope</small></td>' +
          '<td class="num forte">' + l.planejados + '</td>' +
          '<td class="num">' + util.numero(l.horas) + ' h</td>' +
          '<td class="num forte">' + esc(util.moeda(l.custo)) + '</td>' +
          '<td class="c-barra"><div class="barra"><i style="width:' + Math.round((l.custo / maxCusto) * 100) +
            '%;background:' + l.cliente.cor + '"></i></div></td>' +
          '<td class="num">' + (l.atrasados ? '<span class="tag alerta">' + l.atrasados + '</span>' : '<span class="sub">0</span>') + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>';

    var porFase = util.agrupar(plano.alocacoes, function (a) { return (demandas[a.demandaId] || {}).fase || '—'; });
    var barrasFase = seed.FASES.map(function (f) {
      var itens = porFase.get(f.id) || [];
      var custo = util.soma(itens, function (a) { return a.custo; });
      return { rotulo: f.id, sub: f.nome, valor: custo, n: itens.length };
    }).filter(function (b) { return b.n > 0; });

    var porEquipTipo = util.agrupar(plano.alocacoes, function (a) {
      return (catalogo[a.testeId] || {}).equipTipo || '—';
    });
    var barrasEquip = [];
    porEquipTipo.forEach(function (itens, tipo) {
      barrasEquip.push({
        rotulo: tipo, sub: nomeEquipTipo(tipo),
        valor: util.soma(itens, function (a) { return a.horas; }), n: itens.length
      });
    });
    barrasEquip.sort(function (a, b) { return b.valor - a.valor; });

    $('#visao-conteudo').innerHTML =
      '<section class="painel"><h2>Carteira por cliente</h2>' +
        '<p class="sub">Catálogo disponível × necessidade já confirmada e alocada na agenda.</p>' +
        tabelaCliente + '</section>' +
      '<div class="grid-2">' +
        painelBarras('Custo confirmado por fase', barrasFase, util.moedaCompacta, 'n ensaios') +
        painelBarras('Horas de bancada por tipo de equipamento', barrasEquip, function (v) { return util.numero(v) + ' h'; }, 'n ensaios') +
      '</div>';

    void maxHoras;
  }

  function painelBarras(titulo, barras, fmt, unidade) {
    if (!barras.length) {
      return '<section class="painel"><h2>' + esc(titulo) + '</h2><p class="vazio">Sem dados no plano atual.</p></section>';
    }
    var max = Math.max.apply(null, barras.map(function (b) { return b.valor; }).concat([1]));
    return '<section class="painel"><h2>' + esc(titulo) + '</h2><ul class="barras">' +
      barras.map(function (b) {
        return '<li><span class="b-rot" title="' + esc(b.sub) + '">' + esc(b.rotulo) + '</span>' +
          '<div class="barra"><i style="width:' + Math.round((b.valor / max) * 100) + '%"></i></div>' +
          '<span class="b-val">' + esc(fmt(b.valor)) + '<small>' + b.n + ' ensaio' + (b.n > 1 ? 's' : '') + '</small></span></li>';
      }).join('') + '</ul></section>';
  }

  /* ============================ CABEÇALHO ============================ */

  function renderCabecalho(estado, plano) {
    var r = plano.resumo;
    $('#top-kpis').innerHTML = [
      '<div class="top-kpi"><span>Ensaios na agenda</span><strong>' + util.numero(r.testes) + '</strong></div>',
      '<div class="top-kpi"><span>Custo planejado</span><strong>' + esc(util.moedaCompacta(r.custoTotal)) + '</strong></div>',
      '<div class="top-kpi"><span>Horas de bancada</span><strong>' + util.numero(r.horasTotais) + ' h</strong></div>',
      '<div class="top-kpi ' + (r.atrasados ? 'alerta' : 'ok') + '"><span>Aderência</span><strong>' + r.aderencia + '%</strong></div>'
    ].join('');
  }

  root.TC.views = {
    filtros: filtros,
    selecao: selecao,
    destaque: destaque,
    esc: esc,
    $: $,
    $$: $$,
    nomeCliente: nomeCliente,
    nomePeca: nomePeca,
    catalogoFiltrado: catalogoFiltrado,
    renderCatalogo: renderCatalogo,
    renderBarraSelecao: renderBarraSelecao,
    renderDemandas: renderDemandas,
    renderPlano: renderPlano,
    renderEquipamentos: renderEquipamentos,
    renderVisao: renderVisao,
    renderCabecalho: renderCabecalho
  };
})(typeof self !== 'undefined' ? self : this);
