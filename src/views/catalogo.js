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
      if (f.equipamentoId && TC.scheduler.gruposDoTeste(t).indexOf(f.equipamentoId) === -1) return false;
      if (busca) {
        var alvo = (t.id + ' ' + t.nome + ' ' + (t.norma || '') + ' ' +
          (t.revisao || '') + ' ' + (t.descricao || '')).toLowerCase();
        if (alvo.indexOf(busca) === -1) return false;
      }
      return true;
    });
  }

  /* Devolve os grupos de bancada do procedimento e os que não têm unidade cadastrada. */
  function gruposDe(estado, teste) {
    var parque = TC.scheduler.agruparEquipamentos(estado.equipamentos);
    var lista = [], faltando = [];
    TC.scheduler.gruposDoTeste(teste).forEach(function (id) {
      var g = util.porId(parque, id);
      if (g && g.membros.length) lista.push(g); else faltando.push(id);
    });
    return { lista: lista, faltando: faltando };
  }

  function linha(estado, teste, permissoes) {
    var eqs = gruposDe(estado, teste);
    var custo = TC.scheduler.custoCatalogo(teste);
    var unidades = eqs.lista.map(function (g) { return g.membros[0]; });
    var dias = unidades.length ? TC.scheduler.diasDeOperacao(teste, unidades) : null;
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
        eqs.lista.map(function (g) {
          return '<div class="forte">' + e(g.nome) +
            (g.membros.length > 1 ? ' <span class="sub">(' + g.membros.length + ' unidades)</span>' : '') +
            '</div>';
        }).join('') +
        eqs.faltando.map(function (id) {
          return '<div><span class="etiqueta erro">' + e(id) + ' sem unidade</span></div>';
        }).join('') +
        (eqs.lista.length > 1 ? '<div class="sub">ocupa os ' + eqs.lista.length + ' ao mesmo tempo</div>' : '') +
        (!eqs.lista.length && !eqs.faltando.length ? '<span class="etiqueta erro">sem equipamento</span>' : '') +
      '</td>' +
      '<td class="num">' + e(String(custo.horasBancada)) + ' h' +
        '<div class="sub">' + (dias ? dias + ' d na bancada' : '—') +
        (custo.horasReport ? ' · +' + custo.horasReport + ' h report' : '') + '</div></td>' +
      '<td class="num">' + e(String(teste.amostras)) + '</td>' +
      '<td class="num forte" title="' + e(String(custo.horasFaturaveis)) + ' h x ' +
        e(util.formatarMoeda(custo.hourlyRate)) + '/h = ' + e(util.formatarMoeda(custo.custoHoras)) +
        ' + insumos ' + e(util.formatarMoeda(custo.custoInsumos)) + '">' +
        e(util.formatarMoeda(custo.custoProcedimento)) +
        '<div class="sub">+ amostras</div></td>' +
      '<td class="num" style="white-space:nowrap">' +
        (permissoes.podeCriarDemanda
          ? '<button class="botao primario pequeno confirmar">Confirmar necessidade</button> ' : '') +
        (permissoes.podeEditarCatalogo
          ? '<button class="botao pequeno editar" title="Editar procedimento">Editar</button>' : '') +
        (!permissoes.podeCriarDemanda && !permissoes.podeEditarCatalogo ? '<span class="sub">—</span>' : '') +
      '</td>' +
    '</tr>';
  }

  /* ---- Formulário de confirmação de necessidade ---- */

  function abrirConfirmacao(ctx, teste) {
    var estado = ctx.estado;
    var eqs = gruposDe(estado, teste);
    var nomes = eqs.lista.map(function (g) { return g.nome; }).join(' + ');
    var unidadesRef = eqs.lista.map(function (g) { return g.membros[0]; });
    var temPool = eqs.lista.some(function (g) { return g.membros.length > 1; });

    var clientePadrao = ctx.filtros.clienteId ||
      (teste.clientes && teste.clientes[0]) ||
      (estado.clientes[0] && estado.clientes[0].id) || '';

    var tipoPadrao = ctx.filtros.tipoLti || 'DV';
    var amostrasPadrao = util.hoje();
    var prazoPadrao = util.somaDias(util.hoje(), 60);

    /* Projetos já usados viram sugestão, para o mesmo programa não virar três grafias. */
    var projetosConhecidos = [];
    estado.demandas.forEach(function (d) {
      if (d.projeto && projetosConhecidos.indexOf(d.projeto) === -1) projetosConhecidos.push(d.projeto);
    });

    var corpo =
      '<div class="aviso">' +
        e(teste.nome) + (teste.revisao ? ' · ' + e(teste.revisao) : '') +
        ' · ' + e(teste.norma || 'sem norma') + ' · ocupa <strong>' +
        e(nomes || '?') + '</strong> por ' +
        e(unidadesRef.length ? TC.scheduler.diasDeOperacao(teste, unidadesRef) + ' dia(s)' : '—') +
        (eqs.lista.length > 1 ? ', com os ' + eqs.lista.length + ' grupos reservados ao mesmo tempo' : '') +
        '. A data de início é calculada automaticamente pela chegada das amostras e pela agenda do equipamento' +
        (temPool ? ', escolhendo a unidade que libera mais cedo' : '') + '.' +
      '</div>' +
      '<p class="sub" style="margin:0 0 12px">Todos os campos são obrigatórios, exceto ' +
        '<strong>forçar início</strong>.</p>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Nº da LTI (ordem de serviço)</label>' +
          '<input name="lti" placeholder="Ex.: LTI-2026-0142" autocomplete="off"></div>' +
        '<div class="campo"><label>Classificação da LTI</label><select name="tipoLti">' +
          ui.opcoes(TC.data.TIPOS_LTI, tipoPadrao) + '</select></div>' +
        '<div class="campo"><label>Cliente</label><select name="clienteId">' +
          ui.opcoes(estado.clientes, clientePadrao) + '</select></div>' +
        '<div class="campo"><label>Projeto</label>' +
          '<input name="projeto" list="projetos-conhecidos" autocomplete="off" placeholder="Ex.: MQB-A0 / EA211">' +
          '<datalist id="projetos-conhecidos">' +
            projetosConhecidos.map(function (p) { return '<option value="' + e(p) + '"></option>'; }).join('') +
          '</datalist></div>' +
        '<div class="campo"><label>Part Number</label>' +
          '<input name="partNumber" autocomplete="off" placeholder="Ex.: 04E253011AB"></div>' +
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
        '<div class="campo"><label>Forçar início em <span class="sub" style="font-weight:400">(opcional)</span></label>' +
          '<input type="date" name="inicioFixo"></div>' +
      '</div>' +
      '<div class="campo"><label>Observação</label>' +
        '<textarea name="observacao" rows="2" placeholder="Ex.: repetir com material alternativo"></textarea></div>' +
      '<div class="campo" id="previa"></div>';

    var janela = ui.modal({
      titulo: 'Confirmar necessidade de teste',
      corpo: corpo,
      confirmar: 'Confirmar e planejar',
      aoConfirmar: function (v) {
        if (!ui.validarObrigatorios(janela, v, [
          { nome: 'lti', rotulo: 'o nº da LTI' },
          { nome: 'tipoLti', rotulo: 'a classificação da LTI' },
          { nome: 'clienteId', rotulo: 'o cliente' },
          { nome: 'projeto', rotulo: 'o projeto' },
          { nome: 'partNumber', rotulo: 'o part number' },
          { nome: 'pecaId', rotulo: 'a peça a ensaiar' },
          { nome: 'dataAmostras', rotulo: 'a data de disponibilidade das amostras' },
          { nome: 'prazo', rotulo: 'o prazo para finalização' },
          { nome: 'prioridade', rotulo: 'a prioridade' },
          { nome: 'quantidade', rotulo: 'a quantidade de amostras', tipo: 'numero', min: 1 },
          { nome: 'observacao', rotulo: 'a observação' }
        ])) return false;

        var demanda = TC.store.criarDemanda({
          testeId: teste.id, pecaId: v.pecaId, clienteId: v.clienteId,
          projeto: v.projeto, partNumber: v.partNumber,
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
          ui.notificar('Planejado em ' + alocacao.equipamentos.map(function (eq) { return eq.nome; }).join(' + ') + ': ' +
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
      var custo = TC.scheduler.custoDemanda({ quantidade: qtd }, teste, null, peca);
      var cotacao = selTipo.value === 'COTACAO';
      previa.innerHTML =
        '<div class="aviso alerta"><strong>Custo estimado ' + e(util.formatarMoeda(custo.total)) + '</strong> — ' +
        e(String(custo.horasFaturaveis)) + ' h (' + e(String(custo.horasBancada)) + ' de bancada + ' +
        e(String(custo.horasReport)) + ' de report) x ' + e(util.formatarMoeda(custo.hourlyRate)) + '/h = ' +
        e(util.formatarMoeda(custo.custoHoras)) +
        ' + insumos ' + e(util.formatarMoeda(custo.custoInsumos)) +
        ' + ' + e(String(qtd)) + ' amostra(s) ' + e(util.formatarMoeda(custo.custoAmostras)) +
        (cotacao
          ? '. Como cotação, não reserva bancada nem entra no planejamento.'
          : '. O ensaio não é agendado antes de ' + e(util.formatarData(campoAmostras.value, true)) + '.') +
        '</div>';
    }

    function atualizarTipo() {
      botaoConfirmar.textContent = selTipo.value === 'COTACAO' ? 'Registrar cotação' : 'Confirmar e planejar';
      atualizarPrevia();
    }

    var selTipo = janela.querySelector('[name=tipoLti]');

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
    teste = teste || { id: '', nome: '', norma: '', revisao: 'Rev. 01', area: 'COLD', clientes: [], equipamentoGrupos: [], horasSetup: 2, horasEnsaio: 24, horasReport: 4, amostras: 2, hourlyRate: 0, custoInsumos: 0, descricao: '' };
    var gruposAtuais = TC.scheduler.gruposDoTeste(teste);
    var parque = TC.scheduler.agruparEquipamentos(estado.equipamentos);

    var corpo =
      '<p class="sub" style="margin:0 0 12px">Todos os campos são obrigatórios. A exceção é ' +
        '<strong>exigido pelos clientes</strong>: deixar em branco marca o procedimento como padrão ' +
        'do laboratório, válido para todos.</p>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Código</label><input name="id" value="' + e(teste.id) + '"' +
          (novo ? ' placeholder="TP-COL-09"' : ' readonly') + '></div>' +
        '<div class="campo"><label>Nome do procedimento</label><input name="nome" value="' + e(teste.nome) + '" required></div>' +
        '<div class="campo"><label>Norma / referência</label><input name="norma" value="' + e(teste.norma || '') + '"></div>' +
        '<div class="campo"><label>Revisão do procedimento</label>' +
          '<input name="revisao" value="' + e(teste.revisao || '') + '" placeholder="Ex.: Rev. 03"></div>' +
        '<div class="campo"><label>Área do sistema</label><select name="area">' +
          ui.opcoes(TC.data.AREAS, teste.area) + '</select></div>' +
        '<div class="campo"><label>Horas de setup</label><input type="number" name="horasSetup" min="0" step="0.5" value="' + e(String(teste.horasSetup)) + '"></div>' +
        '<div class="campo"><label>Horas de ensaio</label><input type="number" name="horasEnsaio" min="0" step="0.5" value="' + e(String(teste.horasEnsaio)) + '"></div>' +
        '<div class="campo"><label>Horas de report</label><input type="number" name="horasReport" min="0" step="0.5" value="' + e(String(teste.horasReport || 0)) + '"></div>' +
        '<div class="campo"><label>Hourly Rate (R$/h)</label><input type="number" name="hourlyRate" min="0" step="10" value="' + e(String(teste.hourlyRate || 0)) + '"></div>' +
        '<div class="campo"><label>Custo de insumos (R$)</label><input type="number" name="custoInsumos" min="0" step="100" value="' + e(String(teste.custoInsumos || 0)) + '"></div>' +
        '<div class="campo"><label>Amostras necessárias</label><input type="number" name="amostras" min="1" value="' + e(String(teste.amostras)) + '"></div>' +
      '</div>' +
      '<div class="campo" id="previa-custo"></div>' +
      '<div class="campo"><label>Equipamentos que o ensaio ocupa ' +
        '<span class="sub" style="font-weight:400">(marque mais de um se o ensaio prende as bancadas ao mesmo tempo; ' +
        'em grupo com várias unidades, o planejamento escolhe a que libera mais cedo)</span></label><div>' +
        parque.map(function (g) {
          return '<label style="display:inline-flex;align-items:center;gap:5px;margin:0 12px 6px 0;font-weight:500;color:var(--texto)">' +
            '<input type="checkbox" name="equipamentoGrupos" data-grupo="1" value="' + e(g.id) + '" style="width:auto"' +
            (gruposAtuais.indexOf(g.id) !== -1 ? ' checked' : '') + '>' + e(g.nome) +
            (g.membros.length > 1 ? ' <span class="sub">(' + g.membros.length + ')</span>' : '') + '</label>';
        }).join('') +
      '</div></div>' +
      '<div class="campo"><label>Exigido pelos clientes (nenhum = procedimento padrão)</label><div>' +
        estado.clientes.map(function (c) {
          return '<label style="display:inline-flex;align-items:center;gap:5px;margin:0 12px 6px 0;font-weight:500;color:var(--texto)">' +
            '<input type="checkbox" name="clientes" data-grupo="1" value="' + e(c.id) + '" style="width:auto"' +
            ((teste.clientes || []).indexOf(c.id) !== -1 ? ' checked' : '') + '>' + e(c.nome) + '</label>';
        }).join('') +
      '</div></div>' +
      '<div class="campo"><label>Descrição</label><textarea name="descricao" rows="2">' + e(teste.descricao || '') + '</textarea></div>';

    var janela = ui.modal({
      titulo: novo ? 'Novo procedimento' : 'Editar ' + teste.id,
      corpo: corpo,
      confirmar: 'Salvar procedimento',
      aoConfirmar: function (v) {
        if (!ui.validarObrigatorios(janela, v, [
          { nome: 'id', rotulo: 'o código do procedimento' },
          { nome: 'nome', rotulo: 'o nome do procedimento' },
          { nome: 'norma', rotulo: 'a norma / referência' },
          { nome: 'revisao', rotulo: 'a revisão do procedimento' },
          { nome: 'area', rotulo: 'a área do sistema' },
          { nome: 'horasSetup', rotulo: 'as horas de setup', tipo: 'numero' },
          { nome: 'horasEnsaio', rotulo: 'as horas de ensaio', tipo: 'numero', min: 0.5 },
          { nome: 'horasReport', rotulo: 'as horas de report', tipo: 'numero' },
          { nome: 'hourlyRate', rotulo: 'o hourly rate', tipo: 'numero', min: 1 },
          { nome: 'custoInsumos', rotulo: 'o custo de insumos', tipo: 'numero' },
          { nome: 'amostras', rotulo: 'as amostras necessárias', tipo: 'numero', min: 1 },
          { nome: 'descricao', rotulo: 'a descrição' }
        ])) return false;

        if (!v.equipamentoGrupos || !v.equipamentoGrupos.length) {
          ui.notificar('Selecione ao menos um equipamento.');
          return false;
        }
        if (novo && util.porId(estado.testes, v.id.trim())) {
          ui.notificar('Já existe um procedimento com o código ' + v.id.trim() + '.');
          janela.querySelector('[name=id]').focus();
          return false;
        }
        TC.store.salvarTeste({
          id: v.id.trim(), nome: v.nome.trim(), norma: v.norma.trim(), revisao: v.revisao.trim(),
          area: v.area, equipamentoGrupos: v.equipamentoGrupos, clientes: v.clientes || [],
          horasSetup: Number(v.horasSetup) || 0, horasEnsaio: Number(v.horasEnsaio) || 0,
          horasReport: Number(v.horasReport) || 0, amostras: Number(v.amostras) || 1,
          hourlyRate: Number(v.hourlyRate) || 0, custoInsumos: Number(v.custoInsumos) || 0,
          descricao: v.descricao.trim()
        });
        ui.notificar('Procedimento salvo.');
      }
    });

    /* A conta do custo aparece enquanto se digita, para o cadastro não virar caixa-preta. */
    var previaCusto = janela.querySelector('#previa-custo');
    function atualizarCusto() {
      function num(campo) { return Number(janela.querySelector('[name=' + campo + ']').value) || 0; }
      var horasBancada = num('horasSetup') + num('horasEnsaio');
      var horasReport = num('horasReport');
      var horas = horasBancada + horasReport;
      var rate = num('hourlyRate');
      var insumos = num('custoInsumos');
      previaCusto.innerHTML =
        '<div class="aviso"><strong>Custo do procedimento ' +
        e(util.formatarMoeda(horas * rate + insumos)) + '</strong> — (' +
        e(String(horasBancada)) + ' h de bancada + ' + e(String(horasReport)) + ' h de report) × ' +
        e(util.formatarMoeda(rate)) + '/h = ' + e(util.formatarMoeda(horas * rate)) +
        ' + insumos ' + e(util.formatarMoeda(insumos)) +
        '. As amostras entram depois, na demanda.</div>';
    }
    ['horasSetup', 'horasEnsaio', 'horasReport', 'hourlyRate', 'custoInsumos'].forEach(function (campo) {
      janela.querySelector('[name=' + campo + ']').addEventListener('input', atualizarCusto);
    });
    atualizarCusto();
  }

  function render(container, ctx) {
    var estado = ctx.estado, f = ctx.filtros;
    var lista = filtrar(estado, f);
    var permissoes = {
      podeEditarCatalogo: ctx.podeEditar,
      podeCriarDemanda: TC.permissoes.podeEditar(estado, 'demandas')
    };

    var totalHoras = 0, totalCusto = 0;
    lista.forEach(function (t) {
      var c = TC.scheduler.custoCatalogo(t);
      totalHoras += c.horasBancada; totalCusto += c.total;
    });

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Catálogo de testes</h2>' +
        '<p>Todos os procedimentos de validação por área do sistema e cliente, com revisão vigente, tempo de bancada e custo. Qualquer procedimento pode ser executado em qualquer fase de projeto. Confirme a necessidade de um teste e ele entra no planejamento automaticamente.</p></div>' +
        (permissoes.podeEditarCatalogo
          ? '<div class="acoes"><button class="botao primario" id="novo">+ Novo procedimento</button></div>' : '') +
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
          '<div class="campo"><label>Equipamento</label><select id="f-equip">' +
            ui.opcoes(TC.scheduler.agruparEquipamentos(estado.equipamentos), f.equipamentoId, 'Todos') + '</select></div>' +
        '</div></div>' +
        (lista.length ? '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Código</th><th>Procedimento</th><th>Revisão</th><th>Área</th><th>Equipamento</th>' +
          '<th class="num">Duração</th><th class="num">Amostras</th><th class="num">Custo estimado</th><th></th>' +
          '</tr></thead><tbody>' + lista.map(function (t) { return linha(estado, t, permissoes); }).join('') +
          '</tbody></table></div>'
          : ui.vazio('Nenhum procedimento encontrado', 'Ajuste os filtros ou cadastre um novo procedimento.')) +
      '</div>';

    var botaoNovo = container.querySelector('#novo');
    if (botaoNovo) botaoNovo.onclick = function () { abrirEdicao(ctx, null); };

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
      var confirmar = tr.querySelector('.confirmar');
      var editar = tr.querySelector('.editar');
      if (confirmar) confirmar.onclick = function () { abrirConfirmacao(ctx, teste); };
      if (editar) editar.onclick = function () { abrirEdicao(ctx, teste); };
    });
  }

  TC.views = TC.views || {};
  TC.views.catalogo = { render: render, abrirConfirmacao: abrirConfirmacao };
})(typeof globalThis !== 'undefined' ? globalThis : this);
