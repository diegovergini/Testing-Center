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

  /* Congela o preço de um procedimento no momento da cotação. */
  function montarItem(teste, quantidade, peca) {
    var custo = TC.scheduler.custoCatalogo(teste);
    var custoAmostras = (teste.amostras || 0) * (peca ? peca.custoAmostra || 0 : 0);
    var unitario = custo.custoProcedimento + custoAmostras;
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
      amostras: teste.amostras || 0,
      custoAmostras: custoAmostras,
      custoUnitario: unitario,
      quantidade: quantidade,
      total: unitario * quantidade
    };
  }

  function totalDaCotacao(cotacao) {
    return (cotacao.itens || []).reduce(function (soma, i) { return soma + i.total; }, 0);
  }

  /* ---- Tabela de custos, usada na visualização e no Excel ---- */

  function tabelaItens(cotacao) {
    var total = totalDaCotacao(cotacao);
    return '<div class="tabela-rolagem"><table><thead><tr>' +
      '<th>Código</th><th>Procedimento</th><th>Revisão</th>' +
      '<th class="num">Horas</th><th class="num">R$/h</th><th class="num">Horas × rate</th>' +
      '<th class="num">Insumos</th><th class="num">Amostras</th>' +
      '<th class="num">Custo unitário</th><th class="num">Qtd</th><th class="num">Total</th>' +
      '</tr></thead><tbody>' +
      cotacao.itens.map(function (i) {
        return '<tr>' +
          '<td><span class="mono">' + e(i.testeId) + '</span></td>' +
          '<td>' + e(i.nome) + '<div class="sub">' + e(i.norma || '') + '</div></td>' +
          '<td>' + e(i.revisao || '—') + '</td>' +
          '<td class="num">' + i.horasFaturaveis + ' h' +
            '<div class="sub">' + i.horasBancada + ' + ' + i.horasReport + '</div></td>' +
          '<td class="num">' + e(util.formatarMoeda(i.hourlyRate)) + '</td>' +
          '<td class="num">' + e(util.formatarMoeda(i.custoHoras)) + '</td>' +
          '<td class="num">' + e(util.formatarMoeda(i.custoInsumos)) + '</td>' +
          '<td class="num">' + e(util.formatarMoeda(i.custoAmostras)) + '</td>' +
          '<td class="num">' + e(util.formatarMoeda(i.custoUnitario)) + '</td>' +
          '<td class="num">' + i.quantidade + '</td>' +
          '<td class="num forte">' + e(util.formatarMoeda(i.total)) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody><tfoot><tr>' +
        '<td colspan="10" class="num forte">Total da cotação</td>' +
        '<td class="num forte" style="font-size:15px">' + e(util.formatarMoeda(total)) + '</td>' +
      '</tr></tfoot></table></div>';
  }

  function exportarExcel(estado, cotacao) {
    var cliente = util.porId(estado.clientes, cotacao.clienteId);
    var peca = util.porId(estado.pecas, cotacao.pecaId);

    var cabecalho = [
      ['Cotação', cotacao.numero],
      ['Cliente', cliente ? cliente.nome : cotacao.clienteId],
      ['Projeto', cotacao.projeto || ''],
      ['Part Number', cotacao.partNumber || ''],
      ['Solicitante', cotacao.solicitante || ''],
      ['Peça de referência', peca ? peca.nome : 'não informada'],
      ['Data', util.formatarData(cotacao.criadoEm, true)],
      ['Status', nomeStatus(cotacao.status)],
      []
    ];

    var titulos = ['Código', 'Procedimento', 'Revisão', 'Norma', 'Horas de bancada',
      'Horas de report', 'Horas faturáveis', 'Hourly rate', 'Custo das horas', 'Insumos',
      'Amostras', 'Custo das amostras', 'Custo unitário', 'Quantidade', 'Total'];

    var linhas = cotacao.itens.map(function (i) {
      return [i.testeId, i.nome, i.revisao, i.norma, i.horasBancada, i.horasReport,
        i.horasFaturaveis, i.hourlyRate, i.custoHoras, i.custoInsumos, i.amostras,
        i.custoAmostras, i.custoUnitario, i.quantidade, i.total];
    });

    linhas.push([]);
    linhas.push(['', 'TOTAL DA COTAÇÃO', '', '', '', '', '', '', '', '', '', '', '', '',
      totalDaCotacao(cotacao)]);

    TC.xlsx.baixar(cotacao.numero + '.xlsx', [{
      nome: 'Cotação',
      larguras: [14, 42, 10, 24, 16, 16, 16, 12, 16, 12, 10, 18, 16, 10, 16],
      linhas: cabecalho.concat([titulos]).concat(linhas)
    }]);
    ui.notificar('Excel de ' + cotacao.numero + ' exportado.');
  }

  /* ---- Visualizar cotação arquivada ---- */

  function abrirDetalhe(ctx, cotacao) {
    var estado = ctx.estado;
    var cliente = util.porId(estado.clientes, cotacao.clienteId);
    var peca = util.porId(estado.pecas, cotacao.pecaId);
    var podeEditar = TC.permissoes.podeEditar(estado, 'cotacoes');

    var corpo =
      '<div class="aviso">' +
        '<strong>' + e(cotacao.numero) + '</strong> · ' + e(cliente ? cliente.nome : '—') +
        (cotacao.projeto ? ' · ' + e(cotacao.projeto) : '') +
        (cotacao.partNumber ? ' · ' + e(cotacao.partNumber) : '') +
        '<div class="sub" style="margin-top:4px">' +
          'Solicitante: ' + e(cotacao.solicitante || '—') +
          ' · ' + e(util.formatarData(cotacao.criadoEm, true)) +
          ' · peça de referência: ' + e(peca ? peca.nome : 'não informada') +
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

    var projetosConhecidos = [];
    estado.demandas.concat(estado.cotacoes).forEach(function (d) {
      if (d.projeto && projetosConhecidos.indexOf(d.projeto) === -1) projetosConhecidos.push(d.projeto);
    });

    var corpo =
      '<p class="sub" style="margin:0 0 12px">Escolha os procedimentos a orçar. O custo de cada um ' +
        'vem do catálogo e fica congelado nesta cotação.</p>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Cliente</label><select name="clienteId">' +
          ui.opcoes(estado.clientes, '') + '</select></div>' +
        '<div class="campo"><label>Projeto</label>' +
          '<input name="projeto" list="projetos-cotacao" autocomplete="off" placeholder="Ex.: MQB-A0 / EA211">' +
          '<datalist id="projetos-cotacao">' +
            projetosConhecidos.map(function (p) { return '<option value="' + e(p) + '"></option>'; }).join('') +
          '</datalist></div>' +
        '<div class="campo"><label>Part Number</label>' +
          '<input name="partNumber" autocomplete="off" placeholder="Ex.: 04E253011AB"></div>' +
        '<div class="campo"><label>Solicitante</label>' +
          '<input name="solicitante" autocomplete="off" placeholder="Quem pediu o orçamento"></div>' +
        '<div class="campo"><label>Peça de referência ' +
          '<span class="sub" style="font-weight:400">(entra o custo das amostras)</span></label>' +
          '<select name="pecaId">' + ui.opcoes(estado.pecas, '', 'Sem peça definida') + '</select></div>' +
      '</div>' +
      '<div class="campo"><label>Observação</label>' +
        '<textarea name="observacao" rows="2" placeholder="Contexto do orçamento"></textarea></div>' +
      '<div class="campo"><label>Testes a cotar</label>' +
        '<div id="lista-testes" class="lista-selecao">' +
          estado.testes.map(function (t) {
            var custo = TC.scheduler.custoCatalogo(t);
            return '<div class="linha-selecao" data-teste="' + e(t.id) + '">' +
              '<label style="display:flex;align-items:center;gap:8px;margin:0;font-weight:500;color:var(--texto);flex:1">' +
                '<input type="checkbox" class="marcar" value="' + e(t.id) + '" style="width:auto">' +
                '<span><span class="mono sub">' + e(t.id) + '</span> ' + e(t.nome) +
                  (t.revisao ? ' <span class="sub">' + e(t.revisao) + '</span>' : '') + '</span>' +
              '</label>' +
              '<span class="sub" style="white-space:nowrap">' + e(util.formatarMoeda(custo.custoProcedimento)) + '</span>' +
              '<input type="number" class="qtd" min="1" value="1" style="width:64px" disabled>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div id="resumo-cotacao"></div>';

    var janela = ui.modal({
      titulo: 'Nova cotação',
      corpo: corpo,
      largura: 'min(900px, 100%)',
      confirmar: 'Gerar cotação',
      aoConfirmar: function (v) {
        if (!ui.validarObrigatorios(janela, v, [
          { nome: 'clienteId', rotulo: 'o cliente' },
          { nome: 'projeto', rotulo: 'o projeto' },
          { nome: 'partNumber', rotulo: 'o part number' },
          { nome: 'solicitante', rotulo: 'o solicitante' }
        ])) return false;

        var itens = coletarItens();
        if (!itens.length) {
          ui.notificar('Selecione ao menos um teste para cotar.');
          return false;
        }

        var cotacao = TC.store.salvarCotacao({
          clienteId: v.clienteId,
          projeto: v.projeto.trim(),
          partNumber: v.partNumber.trim(),
          solicitante: v.solicitante.trim(),
          pecaId: v.pecaId || '',
          observacao: v.observacao.trim(),
          itens: itens
        });
        ui.notificar('Cotação ' + cotacao.numero + ' gerada: ' +
          util.formatarMoeda(totalDaCotacao(cotacao)) + '.');
        ctx.atualizar();
      }
    });

    var selPeca = janela.querySelector('[name=pecaId]');
    var resumo = janela.querySelector('#resumo-cotacao');

    function coletarItens() {
      var peca = util.porId(estado.pecas, selPeca.value);
      var itens = [];
      janela.querySelectorAll('.linha-selecao').forEach(function (linha) {
        if (!linha.querySelector('.marcar').checked) return;
        var teste = util.porId(estado.testes, linha.dataset.teste);
        var qtd = Number(linha.querySelector('.qtd').value) || 1;
        if (teste) itens.push(montarItem(teste, qtd, peca));
      });
      return itens;
    }

    function atualizarResumo() {
      var itens = coletarItens();
      if (!itens.length) {
        resumo.innerHTML = '<div class="aviso">Nenhum teste selecionado ainda.</div>';
        return;
      }
      var total = itens.reduce(function (s, i) { return s + i.total; }, 0);
      resumo.innerHTML = '<div class="aviso alerta"><strong>' + itens.length +
        ' teste(s) · ' + e(util.formatarMoeda(total)) + '</strong>' +
        (selPeca.value ? '' : ' — sem peça de referência, o custo das amostras fica fora.') +
        '</div>';
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
    selPeca.addEventListener('change', atualizarResumo);
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
        '<td><div class="forte">' + e(cliente ? cliente.nome : c.clienteId) + '</div>' +
          '<div class="sub">' + e(c.projeto || '—') + '</div></td>' +
        '<td>' + e(c.partNumber || '—') + '</td>' +
        '<td>' + e(c.solicitante || '—') + '</td>' +
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
            '<th>Número</th><th>Cliente / Projeto</th><th>Part Number</th><th>Solicitante</th>' +
            '<th class="num">Testes</th><th class="num">Total</th><th>Status</th><th></th>' +
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
