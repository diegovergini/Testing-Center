/* Quotes: the product engineer picks the tests to be priced and the platform builds the
   cost table. A saved quote keeps its prices frozen — touching the catalogue later must not
   rewrite a quote already delivered. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  /* State name and colour come from the workflow, next to the rules of who can move it. */
  function nomeStatus(id) {
    return TC.fluxo.nomeDoEstado('cotacao', id);
  }

  function etiquetaStatus(id) {
    return ui.etiquetaEstado('cotacao', id);
  }

  /* Freezes a procedure's price at the moment of the quote, hourly rate included: next
     year's revision does not rewrite a quote already delivered.
     The procedure cost is per sample tested: each sample is one run, so the quantity asked
     for multiplies the unit price. */
  function montarItem(teste, amostras, hourlyRate) {
    var custo = TC.scheduler.custoCatalogo(teste, hourlyRate);
    var quantidade = Math.max(1, Number(amostras) || 1);
    return {
      testeId: teste.id,
      nome: teste.nome,
      revisao: teste.revisao || '',
      norma: teste.norma || '',
      horasBancada: custo.horasBancada,
      horasReport: custo.horasReport,
      horasFaturaveis: custo.horasFaturaveis,
      hourlyRate: custo.hourlyRate,
      custoHoras: custo.custoHoras,
      custoInsumos: custo.custoInsumos,
      custoUnitario: custo.custoProcedimento,
      amostras: quantidade,
      total: custo.custoProcedimento * quantidade
    };
  }

  function totalDaCotacao(cotacao) {
    return (cotacao.itens || []).reduce(function (soma, i) { return soma + i.total; }, 0);
  }

  /* ---- Cost table, used on screen and in the Excel export ---- */

  /* Older quotes carried a sample cost coming from a reference part type. The column shows
     up only on those, so the total keeps reconciling. */
  function temCustoDeAmostra(cotacao) {
    return (cotacao.itens || []).some(function (i) { return i.custoAmostras > 0; });
  }

  function tabelaItens(cotacao) {
    var total = totalDaCotacao(cotacao);
    var legado = temCustoDeAmostra(cotacao);
    var colunas = legado ? 11 : 10;
    return '<div class="tabela-rolagem"><table><thead><tr>' +
      '<th>Code</th><th>Procedure</th><th>Revision</th>' +
      '<th class="num">Hours</th><th class="num">R$/h</th><th class="num">Hours × rate</th>' +
      '<th class="num">Consumables</th>' +
      (legado ? '<th class="num">Samples (R$)</th>' : '') +
      '<th class="num">Unit cost</th><th class="num">Samples</th><th class="num">Total</th>' +
      '</tr></thead><tbody>' +
      cotacao.itens.map(function (i) {
        return '<tr>' +
          '<td><span class="mono">' + e(i.testeId) + '</span></td>' +
          '<td>' + e(i.nome) + '<div class="sub">' + e(i.norma || '') + '</div></td>' +
          '<td>' + e(i.revisao || '—') + '</td>' +
          '<td class="num">' + i.horasFaturaveis + ' h' +
            '<div class="sub">' + i.horasBancada + ' + ' + i.horasReport + '</div></td>' +
          '<td class="num">' + e(util.formatarTaxa(i.hourlyRate)) + '</td>' +
          '<td class="num">' + e(util.formatarMoeda(i.custoHoras)) + '</td>' +
          '<td class="num">' + e(util.formatarMoeda(i.custoInsumos)) + '</td>' +
          (legado ? '<td class="num">' + e(util.formatarMoeda(i.custoAmostras || 0)) + '</td>' : '') +
          '<td class="num">' + e(util.formatarMoeda(i.custoUnitario)) + '</td>' +
          '<td class="num">' + (i.amostras || i.quantidade || 1) + '</td>' +
          '<td class="num forte">' + e(util.formatarMoeda(i.total)) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody><tfoot><tr>' +
        '<td colspan="' + colunas + '" class="num forte">Quote total</td>' +
        '<td class="num forte" style="font-size:15px">' + e(util.formatarMoeda(total)) + '</td>' +
      '</tr></tfoot></table></div>';
  }

  function exportarExcel(estado, cotacao) {
    var cliente = util.porId(estado.clientes, cotacao.clienteId);

    var cabecalho = [
      ['Quote', cotacao.numero],
      ['LTI', cotacao.lti || ''],
      ['Customer', cliente ? cliente.nome : cotacao.clienteId],
      ['Project', cotacao.projeto || ''],
      ['Part Number', cotacao.partNumber || ''],
      ['Requested by', cotacao.solicitante || ''],
      ['Planned execution', cotacao.previsaoExecucao ? util.formatarData(cotacao.previsaoExecucao, true) : ''],
      ['Date', util.formatarData(cotacao.criadoEm, true)],
      ['Status', nomeStatus(cotacao.status)],
      []
    ];

    var titulos = ['Code', 'Procedure', 'Revision', 'Standard', 'Rig hours',
      'Reporting hours', 'Billable hours', 'Hourly rate', 'Hours cost', 'Consumables',
      'Unit cost', 'Samples', 'Total'];

    var linhas = cotacao.itens.map(function (i) {
      return [i.testeId, i.nome, i.revisao, i.norma, i.horasBancada, i.horasReport,
        i.horasFaturaveis, i.hourlyRate, i.custoHoras, i.custoInsumos,
        i.custoUnitario, i.amostras || i.quantidade || 1, i.total];
    });

    linhas.push([]);
    linhas.push(['', 'QUOTE TOTAL', '', '', '', '', '', '', '', '', '', '',
      totalDaCotacao(cotacao)]);

    TC.xlsx.baixar(cotacao.numero + '.xlsx', [{
      nome: 'Quote',
      larguras: [14, 42, 10, 24, 16, 16, 16, 12, 16, 12, 16, 10, 16],
      linhas: cabecalho.concat([titulos]).concat(linhas)
    }]);
    ui.notificar('Excel for ' + cotacao.numero + ' exported.');
  }

  /* ---- Viewing an archived quote ---- */

  function abrirDetalhe(ctx, cotacao) {
    var estado = ctx.estado;
    var cliente = util.porId(estado.clientes, cotacao.clienteId);
    var podeEditar = TC.permissoes.podeEditar(estado, 'cotacoes');

    var corpo =
      '<div class="aviso">' +
        '<strong>' + e(cotacao.numero) + '</strong>' +
        (cotacao.lti ? ' · LTI ' + e(cotacao.lti) : '') +
        ' · ' + e(cliente ? cliente.nome : '—') +
        (cotacao.projeto ? ' · ' + e(cotacao.projeto) : '') +
        (cotacao.partNumber ? ' · ' + e(cotacao.partNumber) : '') +
        '<div class="sub" style="margin-top:4px">' +
          'Requested by: ' + e(cotacao.solicitante || '—') +
          ' · issued on ' + e(util.formatarData(cotacao.criadoEm, true)) +
          (cotacao.previsaoExecucao
            ? ' · planned execution: ' + e(util.formatarData(cotacao.previsaoExecucao, true))
            : '') +
          '. Prices frozen on the quote date.' +
        '</div>' +
      '</div>' +
      (cotacao.observacao ? '<p class="sub">' + e(cotacao.observacao) + '</p>' : '') +
      tabelaItens(cotacao) +
      ui.historico('cotacao', cotacao);

    var janela = ui.modal({
      titulo: 'Quote ' + cotacao.numero,
      corpo: corpo,
      largura: 'min(1100px, 100%)',
      confirmar: null
    });

    var pe = janela.querySelector('.modal-pe');
    var botaoExcel = ui.el('<button type="button" class="botao" style="margin-right:auto">Export Excel</button>');
    botaoExcel.onclick = function () { exportarExcel(estado, cotacao); };
    pe.insertBefore(botaoExcel, pe.firstChild);
  }

  /* ---- New quote ---- */

  function abrirNova(ctx) {
    var estado = ctx.estado;

    function distintos(lista) {
      var vistos = [];
      lista.forEach(function (v) { if (v && vistos.indexOf(v) === -1) vistos.push(v); });
      return vistos;
    }

    var projetosConhecidos = distintos(
      estado.demandas.concat(estado.cotacoes).map(function (d) { return d.projeto; }));

    /* LTIs already used on requests and quotes become a filter and a suggestion. */
    var ltisConhecidas = distintos(
      estado.demandas.concat(estado.cotacoes).map(function (d) { return d.lti; })).sort();

    /* Tests already requested under each LTI: that is what the LTI filter narrows to. */
    var testesPorLti = {};
    estado.demandas.forEach(function (d) {
      if (!d.lti) return;
      (testesPorLti[d.lti] = testesPorLti[d.lti] || {})[d.testeId] = true;
    });

    var clientePadrao = estado.clientes[0] ? estado.clientes[0].id : '';

    var corpo =
      '<p class="sub" style="margin:0 0 12px">Pick the procedures to price. The cost of each one ' +
        'comes from the catalogue and is frozen in this quote.</p>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>LTI no.</label>' +
          '<input name="lti" list="ltis-conhecidas" autocomplete="off" placeholder="e.g. LTI-2026-0142">' +
          '<datalist id="ltis-conhecidas">' +
            ltisConhecidas.map(function (l) { return '<option value="' + e(l) + '"></option>'; }).join('') +
          '</datalist></div>' +
        '<div class="campo"><label>Customer</label><select name="clienteId">' +
          ui.opcoes(estado.clientes, clientePadrao) + '</select></div>' +
        '<div class="campo"><label>Project</label>' +
          '<input name="projeto" list="projetos-cotacao" autocomplete="off" placeholder="e.g. MQB-A0 / EA211">' +
          '<datalist id="projetos-cotacao">' +
            projetosConhecidos.map(function (p) { return '<option value="' + e(p) + '"></option>'; }).join('') +
          '</datalist></div>' +
        '<div class="campo"><label>Part Number</label>' +
          '<input name="partNumber" autocomplete="off" placeholder="e.g. 04E253011AB"></div>' +
        '<div class="campo"><label>Requested by</label>' +
          '<input name="solicitante" autocomplete="off" placeholder="Who asked for the quote"></div>' +
        '<div class="campo"><label>Planned execution</label>' +
          '<input type="date" name="previsaoExecucao" value="' + e(util.somaDias(util.hoje(), 30)) + '"></div>' +
      '</div>' +
      '<div class="campo"><label>Note</label>' +
        '<textarea name="observacao" rows="2" placeholder="Context for the quote"></textarea></div>' +
      '<div class="campo"><label>Tests to quote</label>' +
        '<div class="filtros" style="margin-bottom:8px">' +
          '<div class="campo busca"><input id="f-teste" placeholder="Search by name, code or standard"></div>' +
          '<div class="campo"><select id="f-cliente-teste">' +
            ui.opcoes(estado.clientes, '', 'All customers') + '</select></div>' +
          '<div class="campo"><select id="f-lti-teste">' +
            '<option value="">All LTIs</option>' +
            ltisConhecidas.map(function (l) {
              return '<option value="' + e(l) + '">LTI ' + e(l) + '</option>';
            }).join('') +
          '</select></div>' +
        '</div>' +
        '<div id="lista-testes" class="lista-selecao">' +
          estado.testes.map(function (t) {
            var custo = TC.scheduler.custoCatalogo(t, estado.hourlyRate);
            return '<div class="linha-selecao" data-teste="' + e(t.id) + '">' +
              '<label style="display:flex;align-items:center;gap:8px;margin:0;font-weight:500;color:var(--texto);flex:1">' +
                '<input type="checkbox" class="marcar" value="' + e(t.id) + '" style="width:auto">' +
                '<span><span class="mono sub">' + e(t.id) + '</span> ' + e(t.nome) +
                  (t.revisao ? ' <span class="sub">' + e(t.revisao) + '</span>' : '') + '</span>' +
              '</label>' +
              '<span class="sub" style="white-space:nowrap">' + e(util.formatarMoeda(custo.custoProcedimento)) + ' / sample</span>' +
              '<input type="number" class="qtd" min="1" value="' + (t.amostras || 1) + '" ' +
                'title="Samples to test" style="width:64px" disabled>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="sub" style="margin-top:6px">The number on the right is how many samples ' +
          'are to be tested; it multiplies the procedure cost.</div>' +
      '</div>' +
      '<div id="resumo-cotacao"></div>';

    var janela = ui.modal({
      titulo: 'New quote',
      corpo: corpo,
      largura: 'min(920px, 100%)',
      confirmar: 'Generate quote',
      aoConfirmar: function (v) {
        if (!ui.validarObrigatorios(janela, v, [
          { nome: 'lti', rotulo: 'the LTI number' },
          { nome: 'clienteId', rotulo: 'the customer' },
          { nome: 'projeto', rotulo: 'the project' },
          { nome: 'partNumber', rotulo: 'the part number' },
          { nome: 'solicitante', rotulo: 'who requested it' },
          { nome: 'previsaoExecucao', rotulo: 'the planned execution date' }
        ])) return false;

        var itens = coletarItens();
        if (!itens.length) {
          ui.notificar('Select at least one test to quote.');
          return false;
        }

        var cotacao = TC.store.salvarCotacao({
          lti: v.lti.trim(),
          clienteId: v.clienteId,
          projeto: v.projeto.trim(),
          partNumber: v.partNumber.trim(),
          solicitante: v.solicitante.trim(),
          previsaoExecucao: v.previsaoExecucao,
          observacao: v.observacao.trim(),
          itens: itens
        });
        ui.notificar('Quote ' + cotacao.numero + ' generated: ' +
          util.formatarMoeda(totalDaCotacao(cotacao)) + '.');
        ctx.atualizar();
      }
    });

    var resumo = janela.querySelector('#resumo-cotacao');
    var campoBusca = janela.querySelector('#f-teste');
    var filtroCliente = janela.querySelector('#f-cliente-teste');
    var filtroLti = janela.querySelector('#f-lti-teste');

    function coletarItens() {
      var itens = [];
      janela.querySelectorAll('.linha-selecao').forEach(function (linha) {
        if (!linha.querySelector('.marcar').checked) return;
        var teste = util.porId(estado.testes, linha.dataset.teste);
        if (teste) {
          itens.push(montarItem(teste, linha.querySelector('.qtd').value, estado.hourlyRate));
        }
      });
      return itens;
    }

    /* Um procedimento sem cliente marcado é padrão do laboratório: vale para todos. */
    function atendeCliente(teste, clienteId) {
      if (!clienteId) return true;
      return !teste.clientes || !teste.clientes.length || teste.clientes.indexOf(clienteId) !== -1;
    }

    function aplicarFiltros() {
      var busca = campoBusca.value.trim().toLowerCase();
      var cliente = filtroCliente.value;
      var lti = filtroLti.value;
      var visiveis = 0;

      janela.querySelectorAll('.linha-selecao').forEach(function (linha) {
        var teste = util.porId(estado.testes, linha.dataset.teste);
        var marcado = linha.querySelector('.marcar').checked;
        var passa = !!teste;

        if (passa && busca) {
          var alvo = (teste.id + ' ' + teste.nome + ' ' + (teste.norma || '') + ' ' +
            (teste.revisao || '')).toLowerCase();
          passa = alvo.indexOf(busca) !== -1;
        }
        if (passa && cliente) passa = atendeCliente(teste, cliente);
        if (passa && lti) passa = !!(testesPorLti[lti] && testesPorLti[lti][teste.id]);

        /* O que já foi marcado continua visível, para não sumir da conta sem aviso. */
        linha.style.display = (passa || marcado) ? '' : 'none';
        if (passa || marcado) visiveis++;
      });

      var vazio = janela.querySelector('#lista-vazia');
      if (vazio) vazio.remove();
      if (!visiveis) {
        janela.querySelector('#lista-testes').insertAdjacentHTML('afterend',
          '<div id="lista-vazia" class="sub" style="padding:8px 2px">' +
          'No procedure matches these filters.</div>');
      }
    }

    function atualizarResumo() {
      var itens = coletarItens();
      if (!itens.length) {
        resumo.innerHTML = '<div class="aviso">No test selected yet.</div>';
        return;
      }
      var total = itens.reduce(function (s, i) { return s + i.total; }, 0);
      var amostras = itens.reduce(function (s, i) { return s + i.amostras; }, 0);
      resumo.innerHTML = '<div class="aviso alerta"><strong>' + itens.length +
        ' test(s) · ' + amostras + ' sample(s) · ' + e(util.formatarMoeda(total)) + '</strong></div>';
    }

    janela.querySelectorAll('.linha-selecao').forEach(function (linha) {
      var marcar = linha.querySelector('.marcar');
      var qtd = linha.querySelector('.qtd');
      marcar.addEventListener('change', function () {
        qtd.disabled = !marcar.checked;
        linha.classList.toggle('marcada', marcar.checked);
        atualizarResumo();
      });
      qtd.addEventListener('input', atualizarResumo);
    });

    /* Os filtros começam neutros e só mudam quando o usuário mexe neles. Herdar o cliente
       da cotação escondia procedimentos sem pedido e, combinado com o filtro de LTI,
       chegava a esvaziar a lista sem explicação. */
    campoBusca.addEventListener('input', aplicarFiltros);
    filtroCliente.addEventListener('change', aplicarFiltros);
    filtroLti.addEventListener('change', aplicarFiltros);

    aplicarFiltros();
    atualizarResumo();
  }

  /* ---- Tela ---- */

  function render(container, ctx) {
    var estado = ctx.estado;
    var podeEditar = TC.permissoes.podeEditar(estado, 'cotacoes');
    var lista = estado.cotacoes.slice().sort(function (a, b) {
      return util.diffDias(b.criadoEm, a.criadoEm) || (a.numero < b.numero ? 1 : -1);
    });

    var perfilAtual = TC.permissoes.perfilAtual(estado);
    var EM_ANDAMENTO = ['RASCUNHO', 'SOLICITADA', 'EM_ANALISE', 'DEVOLVIDA', 'VALIDADA'];

    var totalGeral = 0, aprovadas = 0, emAberto = 0;
    lista.forEach(function (c) {
      var t = totalDaCotacao(c);
      totalGeral += t;
      if (c.status === 'APROVADA') aprovadas += t;
      if (EM_ANDAMENTO.indexOf(c.status) !== -1) emAberto += t;
    });

    var linhas = lista.map(function (c) {
      var cliente = util.porId(estado.clientes, c.clienteId);
      return '<tr data-cotacao="' + e(c.id) + '">' +
        '<td><span class="mono forte">' + e(c.numero) + '</span>' +
          '<div class="sub">' + e(util.formatarData(c.criadoEm, true)) + '</div></td>' +
        '<td><span class="mono">' + e(c.lti || '—') + '</span></td>' +
        '<td><div class="forte">' + e(cliente ? cliente.nome : c.clienteId) + '</div>' +
          '<div class="sub">' + e(c.projeto || '—') + '</div></td>' +
        '<td>' + e(c.partNumber || '—') + '</td>' +
        '<td>' + e(c.solicitante || '—') + '</td>' +
        '<td>' + (c.previsaoExecucao
          ? e(util.formatarData(c.previsaoExecucao, true))
          : '<span class="sub">—</span>') + '</td>' +
        '<td class="num">' + (c.itens || []).length + '</td>' +
        '<td class="num forte">' + e(util.formatarMoeda(totalDaCotacao(c))) + '</td>' +
        '<td>' + etiquetaStatus(c.status) + '</td>' +
        /* Each role sees only the moves that belong to it: the customer sends and decides,
           the test centre reviews and confirms. */
        '<td class="num" style="white-space:nowrap">' +
          TC.fluxo.transicoesDe('cotacao', c.status, perfilAtual).map(function (t) {
            return '<button class="botao pequeno ' +
              (t.para === 'RECUSADA' || t.para === 'DEVOLVIDA' ? 'perigo' : 'primario') +
              ' mover" data-para="' + e(t.para) + '" title="' + e(t.descricao || '') + '">' +
              e(t.rotulo) + '</button> ';
          }).join('') +
          '<button class="botao pequeno ver">Open</button> ' +
          '<button class="botao pequeno excel">Excel</button>' +
          (podeEditar ? ' <button class="botao pequeno perigo excluir" title="Remove quote">✕</button>' : '') +
        '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Quotes</h2>' +
        '<p>Budgets asked for by product engineering. Pick the tests and the platform builds the cost table, which is archived here and comes out in Excel.</p></div>' +
        (podeEditar ? '<div class="acoes"><button class="botao primario" id="nova">+ New quote</button></div>' : '') +
      '</div>' +
      '<div class="indicadores">' +
        '<div class="indicador"><div class="rotulo">Quotes</div><div class="valor">' + lista.length + '</div>' +
          '<div class="nota">archived on the platform</div></div>' +
        '<div class="indicador"><div class="rotulo">Value quoted</div><div class="valor">' + util.formatarMoeda(totalGeral) + '</div>' +
          '<div class="nota">all of them added up</div></div>' +
        '<div class="indicador"><div class="rotulo">Open</div><div class="valor">' + util.formatarMoeda(emAberto) + '</div>' +
          '<div class="nota">being drafted or sent</div></div>' +
        '<div class="indicador"><div class="rotulo">Approved</div><div class="valor" style="color:var(--ok)">' + util.formatarMoeda(aprovadas) + '</div>' +
          '<div class="nota">becomes a test request</div></div>' +
      '</div>' +
      '<div class="cartao">' +
        (lista.length
          ? '<div class="tabela-rolagem"><table><thead><tr>' +
            '<th>Number</th><th>LTI</th><th>Customer / Project</th><th>Part Number</th><th>Requested by</th>' +
            '<th>Planned</th><th class="num">Tests</th><th class="num">Total</th><th>Status</th><th></th>' +
            '</tr></thead><tbody>' + linhas + '</tbody></table></div>'
          : ui.vazio('No quote yet',
              podeEditar ? 'Create the first one by picking the tests to price.' : 'No budget has been recorded.')) +
      '</div>';

    if (podeEditar) {
      container.querySelector('#nova').onclick = function () { abrirNova(ctx); };
    }

    container.querySelectorAll('tr[data-cotacao]').forEach(function (tr) {
      var cotacao = util.porId(estado.cotacoes, tr.dataset.cotacao);
      tr.querySelectorAll('.mover').forEach(function (botao) {
        botao.onclick = function () {
          ui.moverNoFluxo({
            tipo: 'cotacao', registro: cotacao, para: botao.dataset.para,
            aoMover: function (v) { return TC.store.moverCotacao(cotacao.id, botao.dataset.para, v); }
          });
        };
      });
      tr.querySelector('.ver').onclick = function () { abrirDetalhe(ctx, cotacao); };
      tr.querySelector('.excel').onclick = function () { exportarExcel(estado, cotacao); };
      var excluir = tr.querySelector('.excluir');
      if (excluir) {
        excluir.onclick = function () {
          ui.confirmarAcao('Remove quote ' + cotacao.numero + '?', function () {
            TC.store.removerCotacao(cotacao.id);
            ui.notificar('Quote removed.');
          });
        };
      }
    });
  }

  TC.views = TC.views || {};
  TC.views.cotacoes = { render: render, montarItem: montarItem, totalDaCotacao: totalDaCotacao };
})(typeof globalThis !== 'undefined' ? globalThis : this);
