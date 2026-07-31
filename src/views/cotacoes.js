/* Cotações: o engenheiro de produto escolhe os testes que precisa orçar e a plataforma
   monta a tabela de custos. A cotação salva guarda os preços congelados — mexer no
   catálogo depois não pode reescrever um orçamento já entregue. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  function nomeStatus(id) {
    var s = util.porId(TC.data.STATUS_COTACAO, id);
    return s ? s.nome : id;
  }

  function etiquetaStatus(id) {
    var cor = { ABERTA: 'marca', ENVIADA: 'alerta', APROVADA: 'ok', RECUSADA: 'erro' }[id] || '';
    return '<span class="etiqueta ' + cor + '">' + e(nomeStatus(id)) + '</span>';
  }

  /* Congela o preço de um procedimento no momento da cotação, inclusive o hourly rate
     vigente: o reajuste do ano seguinte não reescreve um orçamento já entregue.
     O custo do procedimento é por amostra ensaiada: cada amostra é uma execução, então
     a quantidade pedida multiplica o unitário. */
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

  /* ---- Tabela de custos, usada na visualização e no Excel ---- */

  /* Cotações antigas traziam o custo das amostras vindo de uma peça de referência.
     A coluna só aparece nelas, para o total continuar reconciliando. */
  function temCustoDeAmostra(cotacao) {
    return (cotacao.itens || []).some(function (i) { return i.custoAmostras > 0; });
  }

  function tabelaItens(cotacao) {
    var total = totalDaCotacao(cotacao);
    var legado = temCustoDeAmostra(cotacao);
    var colunas = legado ? 11 : 10;
    return '<div class="tabela-rolagem"><table><thead><tr>' +
      '<th>Código</th><th>Procedimento</th><th>Revisão</th>' +
      '<th class="num">Horas</th><th class="num">R$/h</th><th class="num">Horas × rate</th>' +
      '<th class="num">Insumos</th>' +
      (legado ? '<th class="num">Amostras (R$)</th>' : '') +
      '<th class="num">Custo unitário</th><th class="num">Amostras</th><th class="num">Total</th>' +
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
        '<td colspan="' + colunas + '" class="num forte">Total da cotação</td>' +
        '<td class="num forte" style="font-size:15px">' + e(util.formatarMoeda(total)) + '</td>' +
      '</tr></tfoot></table></div>';
  }

  function exportarExcel(estado, cotacao) {
    var cliente = util.porId(estado.clientes, cotacao.clienteId);

    var cabecalho = [
      ['Cotação', cotacao.numero],
      ['LTI', cotacao.lti || ''],
      ['Cliente', cliente ? cliente.nome : cotacao.clienteId],
      ['Projeto', cotacao.projeto || ''],
      ['Part Number', cotacao.partNumber || ''],
      ['Solicitante', cotacao.solicitante || ''],
      ['Previsão de execução', cotacao.previsaoExecucao ? util.formatarData(cotacao.previsaoExecucao, true) : ''],
      ['Data', util.formatarData(cotacao.criadoEm, true)],
      ['Status', nomeStatus(cotacao.status)],
      []
    ];

    var titulos = ['Código', 'Procedimento', 'Revisão', 'Norma', 'Horas de bancada',
      'Horas de report', 'Horas faturáveis', 'Hourly rate', 'Custo das horas', 'Insumos',
      'Custo unitário', 'Amostras', 'Total'];

    var linhas = cotacao.itens.map(function (i) {
      return [i.testeId, i.nome, i.revisao, i.norma, i.horasBancada, i.horasReport,
        i.horasFaturaveis, i.hourlyRate, i.custoHoras, i.custoInsumos,
        i.custoUnitario, i.amostras || i.quantidade || 1, i.total];
    });

    linhas.push([]);
    linhas.push(['', 'TOTAL DA COTAÇÃO', '', '', '', '', '', '', '', '', '', '',
      totalDaCotacao(cotacao)]);

    TC.xlsx.baixar(cotacao.numero + '.xlsx', [{
      nome: 'Cotação',
      larguras: [14, 42, 10, 24, 16, 16, 16, 12, 16, 12, 16, 10, 16],
      linhas: cabecalho.concat([titulos]).concat(linhas)
    }]);
    ui.notificar('Excel de ' + cotacao.numero + ' exportado.');
  }

  /* ---- Visualizar cotação arquivada ---- */

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
          'Solicitante: ' + e(cotacao.solicitante || '—') +
          ' · emitida em ' + e(util.formatarData(cotacao.criadoEm, true)) +
          (cotacao.previsaoExecucao
            ? ' · previsão de execução: ' + e(util.formatarData(cotacao.previsaoExecucao, true))
            : '') +
          '. Preços congelados na data da cotação.' +
        '</div>' +
      '</div>' +
      (cotacao.observacao ? '<p class="sub">' + e(cotacao.observacao) + '</p>' : '') +
      tabelaItens(cotacao) +
      (podeEditar
        ? '<div class="campo" style="margin-top:14px;max-width:260px"><label>Status</label>' +
          '<select name="status">' + ui.opcoes(TC.data.STATUS_COTACAO, cotacao.status) + '</select></div>'
        : '');

    var janela = ui.modal({
      titulo: 'Cotação ' + cotacao.numero,
      corpo: corpo,
      largura: 'min(1100px, 100%)',
      confirmar: podeEditar ? 'Salvar status' : null,
      aoConfirmar: podeEditar ? function (v) {
        TC.store.salvarCotacao({ id: cotacao.id, status: v.status });
        ui.notificar('Cotação atualizada.');
      } : null
    });

    var pe = janela.querySelector('.modal-pe');
    var botaoExcel = ui.el('<button type="button" class="botao" style="margin-right:auto">Exportar Excel</button>');
    botaoExcel.onclick = function () { exportarExcel(estado, cotacao); };
    pe.insertBefore(botaoExcel, pe.firstChild);
  }

  /* ---- Nova cotação ---- */

  function abrirNova(ctx) {
    var estado = ctx.estado;

    function distintos(lista) {
      var vistos = [];
      lista.forEach(function (v) { if (v && vistos.indexOf(v) === -1) vistos.push(v); });
      return vistos;
    }

    var projetosConhecidos = distintos(
      estado.demandas.concat(estado.cotacoes).map(function (d) { return d.projeto; }));

    /* LTIs já usadas em demandas e cotações viram filtro e sugestão. */
    var ltisConhecidas = distintos(
      estado.demandas.concat(estado.cotacoes).map(function (d) { return d.lti; })).sort();

    /* Testes já demandados sob cada LTI: é o que o filtro por LTI restringe. */
    var testesPorLti = {};
    estado.demandas.forEach(function (d) {
      if (!d.lti) return;
      (testesPorLti[d.lti] = testesPorLti[d.lti] || {})[d.testeId] = true;
    });

    var clientePadrao = estado.clientes[0] ? estado.clientes[0].id : '';

    var corpo =
      '<p class="sub" style="margin:0 0 12px">Escolha os procedimentos a orçar. O custo de cada um ' +
        'vem do catálogo e fica congelado nesta cotação.</p>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Nº da LTI</label>' +
          '<input name="lti" list="ltis-conhecidas" autocomplete="off" placeholder="Ex.: LTI-2026-0142">' +
          '<datalist id="ltis-conhecidas">' +
            ltisConhecidas.map(function (l) { return '<option value="' + e(l) + '"></option>'; }).join('') +
          '</datalist></div>' +
        '<div class="campo"><label>Cliente</label><select name="clienteId">' +
          ui.opcoes(estado.clientes, clientePadrao) + '</select></div>' +
        '<div class="campo"><label>Projeto</label>' +
          '<input name="projeto" list="projetos-cotacao" autocomplete="off" placeholder="Ex.: MQB-A0 / EA211">' +
          '<datalist id="projetos-cotacao">' +
            projetosConhecidos.map(function (p) { return '<option value="' + e(p) + '"></option>'; }).join('') +
          '</datalist></div>' +
        '<div class="campo"><label>Part Number</label>' +
          '<input name="partNumber" autocomplete="off" placeholder="Ex.: 04E253011AB"></div>' +
        '<div class="campo"><label>Solicitante</label>' +
          '<input name="solicitante" autocomplete="off" placeholder="Quem pediu o orçamento"></div>' +
        '<div class="campo"><label>Previsão de execução</label>' +
          '<input type="date" name="previsaoExecucao" value="' + e(util.somaDias(util.hoje(), 30)) + '"></div>' +
      '</div>' +
      '<div class="campo"><label>Observação</label>' +
        '<textarea name="observacao" rows="2" placeholder="Contexto do orçamento"></textarea></div>' +
      '<div class="campo"><label>Testes a cotar</label>' +
        '<div class="filtros" style="margin-bottom:8px">' +
          '<div class="campo busca"><input id="f-teste" placeholder="Buscar por nome, código ou norma"></div>' +
          '<div class="campo"><select id="f-cliente-teste">' +
            ui.opcoes(estado.clientes, '', 'Todos os clientes') + '</select></div>' +
          '<div class="campo"><select id="f-lti-teste">' +
            '<option value="">Todas as LTIs</option>' +
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
              '<span class="sub" style="white-space:nowrap">' + e(util.formatarMoeda(custo.custoProcedimento)) + ' / amostra</span>' +
              '<input type="number" class="qtd" min="1" value="' + (t.amostras || 1) + '" ' +
                'title="Amostras a ensaiar" style="width:64px" disabled>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="sub" style="margin-top:6px">O número à direita é a quantidade de amostras ' +
          'a ensaiar; ela multiplica o custo do procedimento.</div>' +
      '</div>' +
      '<div id="resumo-cotacao"></div>';

    var janela = ui.modal({
      titulo: 'Nova cotação',
      corpo: corpo,
      largura: 'min(920px, 100%)',
      confirmar: 'Gerar cotação',
      aoConfirmar: function (v) {
        if (!ui.validarObrigatorios(janela, v, [
          { nome: 'lti', rotulo: 'o nº da LTI' },
          { nome: 'clienteId', rotulo: 'o cliente' },
          { nome: 'projeto', rotulo: 'o projeto' },
          { nome: 'partNumber', rotulo: 'o part number' },
          { nome: 'solicitante', rotulo: 'o solicitante' },
          { nome: 'previsaoExecucao', rotulo: 'a previsão de execução' }
        ])) return false;

        var itens = coletarItens();
        if (!itens.length) {
          ui.notificar('Selecione ao menos um teste para cotar.');
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
        ui.notificar('Cotação ' + cotacao.numero + ' gerada: ' +
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
          'Nenhum procedimento com esses filtros.</div>');
      }
    }

    function atualizarResumo() {
      var itens = coletarItens();
      if (!itens.length) {
        resumo.innerHTML = '<div class="aviso">Nenhum teste selecionado ainda.</div>';
        return;
      }
      var total = itens.reduce(function (s, i) { return s + i.total; }, 0);
      var amostras = itens.reduce(function (s, i) { return s + i.amostras; }, 0);
      resumo.innerHTML = '<div class="aviso alerta"><strong>' + itens.length +
        ' teste(s) · ' + amostras + ' amostra(s) · ' + e(util.formatarMoeda(total)) + '</strong></div>';
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

    var totalGeral = 0, aprovadas = 0, emAberto = 0;
    lista.forEach(function (c) {
      var t = totalDaCotacao(c);
      totalGeral += t;
      if (c.status === 'APROVADA') aprovadas += t;
      if (c.status === 'ABERTA' || c.status === 'ENVIADA') emAberto += t;
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
        '<td class="num" style="white-space:nowrap">' +
          '<button class="botao pequeno ver">Abrir</button> ' +
          '<button class="botao pequeno excel">Excel</button>' +
          (podeEditar ? ' <button class="botao pequeno perigo excluir" title="Remover cotação">✕</button>' : '') +
        '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Cotações</h2>' +
        '<p>Orçamentos pedidos pela engenharia de produto. Escolha os testes e a plataforma monta a tabela de custos, que fica arquivada aqui e sai em Excel.</p></div>' +
        (podeEditar ? '<div class="acoes"><button class="botao primario" id="nova">+ Nova cotação</button></div>' : '') +
      '</div>' +
      '<div class="indicadores">' +
        '<div class="indicador"><div class="rotulo">Cotações</div><div class="valor">' + lista.length + '</div>' +
          '<div class="nota">arquivadas na plataforma</div></div>' +
        '<div class="indicador"><div class="rotulo">Valor cotado</div><div class="valor">' + util.formatarMoeda(totalGeral) + '</div>' +
          '<div class="nota">somando todas</div></div>' +
        '<div class="indicador"><div class="rotulo">Em aberto</div><div class="valor">' + util.formatarMoeda(emAberto) + '</div>' +
          '<div class="nota">em elaboração ou enviadas</div></div>' +
        '<div class="indicador"><div class="rotulo">Aprovado</div><div class="valor" style="color:var(--ok)">' + util.formatarMoeda(aprovadas) + '</div>' +
          '<div class="nota">vira demanda de teste</div></div>' +
      '</div>' +
      '<div class="cartao">' +
        (lista.length
          ? '<div class="tabela-rolagem"><table><thead><tr>' +
            '<th>Número</th><th>LTI</th><th>Cliente / Projeto</th><th>Part Number</th><th>Solicitante</th>' +
            '<th>Previsão</th><th class="num">Testes</th><th class="num">Total</th><th>Status</th><th></th>' +
            '</tr></thead><tbody>' + linhas + '</tbody></table></div>'
          : ui.vazio('Nenhuma cotação ainda',
              podeEditar ? 'Crie a primeira escolhendo os testes a orçar.' : 'Nenhum orçamento foi registrado.')) +
      '</div>';

    if (podeEditar) {
      container.querySelector('#nova').onclick = function () { abrirNova(ctx); };
    }

    container.querySelectorAll('tr[data-cotacao]').forEach(function (tr) {
      var cotacao = util.porId(estado.cotacoes, tr.dataset.cotacao);
      tr.querySelector('.ver').onclick = function () { abrirDetalhe(ctx, cotacao); };
      tr.querySelector('.excel').onclick = function () { exportarExcel(estado, cotacao); };
      var excluir = tr.querySelector('.excluir');
      if (excluir) {
        excluir.onclick = function () {
          ui.confirmarAcao('Remover a cotação ' + cotacao.numero + '?', function () {
            TC.store.removerCotacao(cotacao.id);
            ui.notificar('Cotação removida.');
          });
        };
      }
    });
  }

  TC.views = TC.views || {};
  TC.views.cotacoes = { render: render, montarItem: montarItem, totalDaCotacao: totalDaCotacao };
})(typeof globalThis !== 'undefined' ? globalThis : this);
