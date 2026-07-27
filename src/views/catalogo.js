/* Catálogo de testes: o que existe, quanto custa e quanto tempo leva.
   É daqui que sai a confirmação de necessidade que alimenta o planejamento. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  function aplicaAoCliente(teste, clienteId) {
    if (!clienteId) return true;
    return !teste.clientes || !teste.clientes.length || teste.clientes.indexOf(clienteId) !== -1;
  }

  function filtrar(estado, f) {
    var busca = (f.busca || '').toLowerCase();
    return estado.testes.filter(function (t) {
      if (f.area && t.area !== f.area && t.area !== 'AMBOS') return false;
      if (!aplicaAoCliente(t, f.clienteId)) return false;
      if (f.equipamentoId && t.equipamentoId !== f.equipamentoId) return false;
      if (busca) {
        var alvo = (t.id + ' ' + t.nome + ' ' + (t.norma || '') + ' ' +
          (t.revisao || '') + ' ' + (t.descricao || '')).toLowerCase();
        if (alvo.indexOf(busca) === -1) return false;
      }
      return true;
    });
  }

  function linha(estado, teste) {
    var equipamento = util.porId(estado.equipamentos, teste.equipamentoId);
    var custo = TC.scheduler.custoCatalogo(teste, equipamento);
    var dias = equipamento ? TC.scheduler.diasDeOperacao(teste, equipamento) : null;
    var clientes = (teste.clientes || []).map(function (id) {
      var c = util.porId(estado.clientes, id);
      return c ? c.nome : id;
    });

    return '<tr data-teste="' + e(teste.id) + '">' +
      '<td><span class="mono">' + e(teste.id) + '</span></td>' +
      '<td>' +
        '<div class="forte">' + e(teste.nome) + '</div>' +
        '<div class="sub">' + e(teste.norma || '—') +
          (clientes.length ? ' · exigido por ' + e(clientes.join(', ')) : ' · procedimento padrão') +
        '</div>' +
      '</td>' +
      '<td>' + (teste.revisao
        ? '<span class="etiqueta">' + e(teste.revisao) + '</span>'
        : '<span class="sub">sem revisão</span>') + '</td>' +
      '<td>' + ui.etiquetaArea(teste.area) + '</td>' +
      '<td>' +
        (equipamento
          ? '<div class="forte">' + e(equipamento.nome) + '</div>'
          : '<span class="etiqueta erro">não cadastrado</span>') +
      '</td>' +
      '<td class="num">' + e(String(custo.horas)) + ' h' +
        '<div class="sub">' + (dias ? dias + ' d na bancada' : '—') + '</div></td>' +
      '<td class="num">' + e(String(teste.amostras)) + '</td>' +
      '<td class="num forte" title="Mão de obra ' + e(util.formatarMoeda(custo.custoBase)) +
        ' + hora-máquina ' + e(util.formatarMoeda(custo.custoEquipamento)) + '">' +
        e(util.formatarMoeda(custo.total)) +
        '<div class="sub">+ amostras</div></td>' +
      '<td class="num">' +
        '<button class="botao primario pequeno confirmar">Confirmar necessidade</button> ' +
        '<button class="botao pequeno editar" title="Editar procedimento">Editar</button>' +
      '</td>' +
    '</tr>';
  }

  /* ---- Formulário de confirmação de necessidade ---- */

  function abrirConfirmacao(ctx, teste) {
    var estado = ctx.estado;
    var equipamento = util.porId(estado.equipamentos, teste.equipamentoId);

    var clientePadrao = ctx.filtros.clienteId ||
      (teste.clientes && teste.clientes[0]) ||
      (estado.clientes[0] && estado.clientes[0].id) || '';

    var tipoPadrao = ctx.filtros.tipoLti || 'DV';
    var amostrasPadrao = util.hoje();
    var prazoPadrao = util.somaDias(util.hoje(), 60);

    var corpo =
      '<div class="aviso">' +
        e(teste.nome) + (teste.revisao ? ' · ' + e(teste.revisao) : '') +
        ' · ' + e(teste.norma || 'sem norma') + ' · ocupa <strong>' +
        e(equipamento ? equipamento.nome : '?') + '</strong> por ' +
        e(equipamento ? TC.scheduler.diasDeOperacao(teste, equipamento) + ' dia(s)' : '—') +
        '. A data de início é calculada automaticamente pela chegada das amostras e pela agenda do equipamento.' +
      '</div>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Nº da LTI (ordem de serviço)</label>' +
          '<input name="lti" placeholder="Ex.: LTI-2026-0142" autocomplete="off"></div>' +
        '<div class="campo"><label>Classificação da LTI</label><select name="tipoLti">' +
          ui.opcoes(TC.data.TIPOS_LTI, tipoPadrao) + '</select></div>' +
        '<div class="campo"><label>Cliente</label><select name="clienteId">' +
          ui.opcoes(estado.clientes, clientePadrao) + '</select></div>' +
        '<div class="campo"><label>Peça a ensaiar</label><select name="pecaId">' +
          ui.opcoes(estado.pecas, '') + '</select></div>' +
        '<div class="campo"><label>Amostras disponíveis a partir de</label>' +
          '<input type="date" name="dataAmostras" value="' + e(amostrasPadrao) + '"></div>' +
        '<div class="campo"><label>Prazo para finalização</label>' +
          '<input type="date" name="prazo" value="' + e(prazoPadrao) + '"></div>' +
        '<div class="campo"><label>Prioridade</label><select name="prioridade">' +
          ui.opcoes(TC.data.PRIORIDADES, 'MEDIA') + '</select></div>' +
        '<div class="campo"><label>Amostras a consumir</label>' +
          '<input type="number" name="quantidade" min="1" value="' + e(String(teste.amostras)) + '"></div>' +
        '<div class="campo"><label>Forçar início em (opcional)</label><input type="date" name="inicioFixo"></div>' +
      '</div>' +
      '<div class="campo"><label>Observação</label>' +
        '<textarea name="observacao" rows="2" placeholder="Ex.: repetir com material alternativo"></textarea></div>' +
      '<div class="campo" id="previa"></div>';

    var janela = ui.modal({
      titulo: 'Confirmar necessidade de teste',
      corpo: corpo,
      confirmar: 'Confirmar e planejar',
      aoConfirmar: function (v) {
        if (!v.pecaId) {
          ui.notificar('Escolha a peça a ensaiar.');
          return false;
        }
        if (v.tipoLti !== 'COTACAO' && !v.lti.trim()) {
          ui.notificar('Informe o número da LTI — só cotação pode ficar sem.');
          janela.querySelector('[name=lti]').focus();
          return false;
        }
        if (!v.dataAmostras) {
          ui.notificar('Informe a data de disponibilidade das amostras.');
          janela.querySelector('[name=dataAmostras]').focus();
          return false;
        }
        if (v.tipoLti !== 'COTACAO' && !v.prazo) {
          ui.notificar('Informe o prazo para finalização.');
          janela.querySelector('[name=prazo]').focus();
          return false;
        }
        var demanda = TC.store.criarDemanda({
          testeId: teste.id, pecaId: v.pecaId, clienteId: v.clienteId,
          lti: v.lti, tipoLti: v.tipoLti,
          prioridade: v.prioridade, quantidade: v.quantidade,
          dataAmostras: v.dataAmostras, prazo: v.prazo,
          inicioFixo: v.inicioFixo, observacao: v.observacao
        });
        var plano = TC.scheduler.planejar(TC.store.get());
        var alocacao = plano.alocacoes.filter(function (a) { return a.demandaId === demanda.id; })[0];
        if (alocacao && alocacao.cotacao) {
          ui.notificar('Cotação registrada — custo estimado sem reservar bancada.');
          ctx.ir('demandas');
          return;
        }
        if (alocacao && alocacao.inicio) {
          ui.notificar('Planejado em ' + alocacao.equipamento.nome + ': ' +
            util.formatarData(alocacao.inicio, true) + ' → ' + util.formatarData(alocacao.fim, true));
        } else {
          ui.notificar('Demanda criada, mas sem janela disponível — veja o planejamento.');
        }
        ctx.ir('planejamento');
      }
    });

    var selPeca = janela.querySelector('[name=pecaId]');
    var previa = janela.querySelector('#previa');
    var botaoConfirmar = janela.querySelector('.confirmar');
    var campoAmostras = janela.querySelector('[name=dataAmostras]');

    function atualizarPrevia() {
      var peca = util.porId(estado.pecas, selPeca.value);
      var qtd = Number(janela.querySelector('[name=quantidade]').value) || teste.amostras;
      var custo = TC.scheduler.custoDemanda({ quantidade: qtd }, teste, equipamento, peca);
      var cotacao = selTipo.value === 'COTACAO';
      previa.innerHTML =
        '<div class="aviso alerta"><strong>Custo estimado ' + e(util.formatarMoeda(custo.total)) + '</strong> — ' +
        'mão de obra e insumos ' + e(util.formatarMoeda(custo.custoBase)) +
        ' + ' + e(String(custo.horas)) + ' h de ' + e(equipamento ? equipamento.nome : '—') + ' ' +
        e(util.formatarMoeda(custo.custoEquipamento)) +
        ' + ' + e(String(qtd)) + ' amostra(s) ' + e(util.formatarMoeda(custo.custoAmostras)) +
        (cotacao
          ? '. Como cotação, não reserva bancada nem entra no planejamento.'
          : '. O ensaio não é agendado antes de ' + e(util.formatarData(campoAmostras.value, true)) + '.') +
        '</div>';
    }

    /* Só cotação pode ficar sem número de LTI e sem prazo; o formulário diz isso antes do envio. */
    function atualizarTipo() {
      var cotacao = selTipo.value === 'COTACAO';
      campoLti.placeholder = cotacao ? 'Opcional na cotação' : 'Ex.: LTI-2026-0142';
      campoLti.required = !cotacao;
      rotuloLti.textContent = cotacao
        ? 'Nº da LTI (ordem de serviço) — opcional'
        : 'Nº da LTI (ordem de serviço)';
      rotuloPrazo.textContent = cotacao ? 'Prazo para finalização — opcional' : 'Prazo para finalização';
      botaoConfirmar.textContent = cotacao ? 'Registrar cotação' : 'Confirmar e planejar';
      atualizarPrevia();
    }

    var selTipo = janela.querySelector('[name=tipoLti]');
    var campoLti = janela.querySelector('[name=lti]');
    var rotuloLti = campoLti.parentElement.querySelector('label');
    var rotuloPrazo = janela.querySelector('[name=prazo]').parentElement.querySelector('label');

    selPeca.addEventListener('change', atualizarPrevia);
    selTipo.addEventListener('change', atualizarTipo);
    campoAmostras.addEventListener('change', atualizarPrevia);
    janela.querySelector('[name=quantidade]').addEventListener('input', atualizarPrevia);
    atualizarTipo();
  }

  /* ---- Formulário de procedimento ---- */

  function abrirEdicao(ctx, teste) {
    var estado = ctx.estado;
    var novo = !teste;
    teste = teste || { id: '', nome: '', norma: '', revisao: 'Rev. 01', area: 'COLD', clientes: [], equipamentoId: estado.equipamentos[0].id, horasSetup: 2, horasEnsaio: 24, amostras: 2, custoBase: 0, descricao: '' };

    var corpo =
      '<div class="grade-campos">' +
        '<div class="campo"><label>Código</label><input name="id" value="' + e(teste.id) + '"' +
          (novo ? ' placeholder="TP-COL-09"' : ' readonly') + '></div>' +
        '<div class="campo"><label>Nome do procedimento</label><input name="nome" value="' + e(teste.nome) + '" required></div>' +
        '<div class="campo"><label>Norma / referência</label><input name="norma" value="' + e(teste.norma || '') + '"></div>' +
        '<div class="campo"><label>Revisão do procedimento</label>' +
          '<input name="revisao" value="' + e(teste.revisao || '') + '" placeholder="Ex.: Rev. 03"></div>' +
        '<div class="campo"><label>Área do sistema</label><select name="area">' +
          ui.opcoes(TC.data.AREAS, teste.area) + '</select></div>' +
        '<div class="campo"><label>Equipamento</label><select name="equipamentoId">' +
          ui.opcoes(estado.equipamentos, teste.equipamentoId) + '</select></div>' +
        '<div class="campo"><label>Horas de setup</label><input type="number" name="horasSetup" min="0" step="0.5" value="' + e(String(teste.horasSetup)) + '"></div>' +
        '<div class="campo"><label>Horas de ensaio</label><input type="number" name="horasEnsaio" min="0" step="0.5" value="' + e(String(teste.horasEnsaio)) + '"></div>' +
        '<div class="campo"><label>Amostras necessárias</label><input type="number" name="amostras" min="1" value="' + e(String(teste.amostras)) + '"></div>' +
        '<div class="campo"><label>Custo de mão de obra e insumos (R$)</label><input type="number" name="custoBase" min="0" step="100" value="' + e(String(teste.custoBase)) + '"></div>' +
      '</div>' +
      '<div class="campo"><label>Exigido pelos clientes (nenhum = procedimento padrão)</label><div>' +
        estado.clientes.map(function (c) {
          return '<label style="display:inline-flex;align-items:center;gap:5px;margin:0 12px 6px 0;font-weight:500;color:var(--texto)">' +
            '<input type="checkbox" name="clientes" data-grupo="1" value="' + e(c.id) + '" style="width:auto"' +
            ((teste.clientes || []).indexOf(c.id) !== -1 ? ' checked' : '') + '>' + e(c.nome) + '</label>';
        }).join('') +
      '</div></div>' +
      '<div class="campo"><label>Descrição</label><textarea name="descricao" rows="2">' + e(teste.descricao || '') + '</textarea></div>';

    ui.modal({
      titulo: novo ? 'Novo procedimento' : 'Editar ' + teste.id,
      corpo: corpo,
      confirmar: 'Salvar procedimento',
      aoConfirmar: function (v) {
        if (!v.nome) { ui.notificar('Informe o nome do procedimento.'); return false; }
        TC.store.salvarTeste({
          id: v.id || undefined, nome: v.nome, norma: v.norma, revisao: v.revisao.trim(),
          area: v.area, equipamentoId: v.equipamentoId, clientes: v.clientes || [],
          horasSetup: Number(v.horasSetup) || 0, horasEnsaio: Number(v.horasEnsaio) || 0,
          amostras: Number(v.amostras) || 1, custoBase: Number(v.custoBase) || 0,
          descricao: v.descricao
        });
        ui.notificar('Procedimento salvo.');
      }
    });
  }

  function render(container, ctx) {
    var estado = ctx.estado, f = ctx.filtros;
    var lista = filtrar(estado, f);

    var totalHoras = 0, totalCusto = 0;
    lista.forEach(function (t) {
      var eq = util.porId(estado.equipamentos, t.equipamentoId);
      var c = TC.scheduler.custoCatalogo(t, eq);
      totalHoras += c.horas; totalCusto += c.total;
    });

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Catálogo de testes</h2>' +
        '<p>Todos os procedimentos de validação por área do sistema e cliente, com revisão vigente, tempo de bancada e custo. Qualquer procedimento pode ser executado em qualquer fase de projeto. Confirme a necessidade de um teste e ele entra no planejamento automaticamente.</p></div>' +
        '<div class="acoes"><button class="botao primario" id="novo">+ Novo procedimento</button></div>' +
      '</div>' +
      '<div class="indicadores">' +
        '<div class="indicador"><div class="rotulo">Procedimentos listados</div><div class="valor">' + lista.length +
          '</div><div class="nota">de ' + estado.testes.length + ' no catálogo</div></div>' +
        '<div class="indicador"><div class="rotulo">Tempo total de bancada</div><div class="valor">' +
          Math.round(totalHoras) + ' h</div><div class="nota">se todos forem executados uma vez</div></div>' +
        '<div class="indicador"><div class="rotulo">Custo do pacote</div><div class="valor">' +
          util.formatarMoeda(totalCusto) + '</div><div class="nota">sem o custo das amostras</div></div>' +
      '</div>' +
      '<div class="cartao">' +
        '<div class="cartao-topo"><div class="filtros" style="flex:1">' +
          '<div class="campo busca"><label>Buscar</label><input id="f-busca" placeholder="nome, código, norma ou revisão" value="' + e(f.busca || '') + '"></div>' +
          '<div class="campo"><label>Cliente</label><select id="f-cliente">' + ui.opcoes(estado.clientes, f.clienteId, 'Todos') + '</select></div>' +
          '<div class="campo"><label>Área</label><select id="f-area">' + ui.opcoes(TC.data.AREAS.filter(function (a) { return a.id !== 'AMBOS'; }), f.area, 'Hot + Cold') + '</select></div>' +
          '<div class="campo"><label>Equipamento</label><select id="f-equip">' + ui.opcoes(estado.equipamentos, f.equipamentoId, 'Todos') + '</select></div>' +
        '</div></div>' +
        (lista.length ? '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Código</th><th>Procedimento</th><th>Revisão</th><th>Área</th><th>Equipamento</th>' +
          '<th class="num">Duração</th><th class="num">Amostras</th><th class="num">Custo estimado</th><th></th>' +
          '</tr></thead><tbody>' + lista.map(function (t) { return linha(estado, t); }).join('') +
          '</tbody></table></div>'
          : ui.vazio('Nenhum procedimento encontrado', 'Ajuste os filtros ou cadastre um novo procedimento.')) +
      '</div>';

    container.querySelector('#novo').onclick = function () { abrirEdicao(ctx, null); };

    function liga(id, campo) {
      var alvo = container.querySelector(id);
      alvo.addEventListener(alvo.tagName === 'SELECT' ? 'change' : 'input', function () {
        f[campo] = alvo.value;
        ctx.atualizar();
      });
    }
    liga('#f-cliente', 'clienteId');
    liga('#f-area', 'area');
    liga('#f-equip', 'equipamentoId');

    var busca = container.querySelector('#f-busca');
    var atraso;
    busca.addEventListener('input', function () {
      clearTimeout(atraso);
      atraso = setTimeout(function () {
        f.busca = busca.value;
        ctx.atualizar();
        var novoCampo = container.querySelector('#f-busca');
        if (novoCampo) { novoCampo.focus(); novoCampo.setSelectionRange(novoCampo.value.length, novoCampo.value.length); }
      }, 250);
    });

    container.querySelectorAll('tr[data-teste]').forEach(function (tr) {
      var teste = util.porId(estado.testes, tr.dataset.teste);
      tr.querySelector('.confirmar').onclick = function () { abrirConfirmacao(ctx, teste); };
      tr.querySelector('.editar').onclick = function () { abrirEdicao(ctx, teste); };
    });
  }

  TC.views = TC.views || {};
  TC.views.catalogo = { render: render, abrirConfirmacao: abrirConfirmacao };
})(typeof globalThis !== 'undefined' ? globalThis : this);
