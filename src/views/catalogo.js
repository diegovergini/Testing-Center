/* Test catalogue: what exists, what it costs and how long it takes.
   This is where the confirmation of need that feeds the schedule comes from. */
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

  /* Returns the procedure's rig groups and the ones with no unit registered. */
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
    var custo = TC.scheduler.custoCatalogo(teste, estado.hourlyRate);
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
          (clientes.length ? ' · required by ' + e(clientes.join(', ')) : ' · lab standard procedure') +
        '</div>' +
      '</td>' +
      '<td>' + (teste.revisao
        ? '<span class="etiqueta">' + e(teste.revisao) + '</span>'
        : '<span class="sub">no revision</span>') + '</td>' +
      '<td>' + ui.etiquetaArea(teste.area) + '</td>' +
      '<td>' +
        eqs.lista.map(function (g) {
          return '<div class="forte">' + e(g.nome) +
            (g.membros.length > 1 ? ' <span class="sub">(' + g.membros.length + ' units)</span>' : '') +
            '</div>';
        }).join('') +
        eqs.faltando.map(function (id) {
          return '<div><span class="etiqueta erro">' + e(id) + ' has no unit</span></div>';
        }).join('') +
        (eqs.lista.length > 1 ? '<div class="sub">takes all ' + eqs.lista.length + ' at once</div>' : '') +
        (!eqs.lista.length && !eqs.faltando.length ? '<span class="etiqueta erro">no equipment</span>' : '') +
      '</td>' +
      '<td class="num">' + e(String(custo.horasBancada)) + ' h' +
        '<div class="sub">' + (dias ? dias + ' d on the rig' : '—') +
        (custo.horasReport ? ' · +' + custo.horasReport + ' h report' : '') + '</div></td>' +
      '<td class="num">' + e(String(teste.amostras)) + '</td>' +
      '<td class="num forte" title="' + e(String(custo.horasFaturaveis)) + ' h x ' +
        e(util.formatarTaxa(custo.hourlyRate)) + '/h = ' + e(util.formatarMoeda(custo.custoHoras)) +
        ' + consumables ' + e(util.formatarMoeda(custo.custoInsumos)) + '">' +
        e(util.formatarMoeda(custo.custoProcedimento)) +
        '<div class="sub">+ samples</div></td>' +
      '<td class="num" style="white-space:nowrap">' +
        (permissoes.podeCriarDemanda
          ? '<button class="botao primario pequeno confirmar">Confirm need</button> ' : '') +
        (permissoes.podeEditarCatalogo
          ? '<button class="botao pequeno editar" title="Edit procedure">Edit</button>' : '') +
        (!permissoes.podeCriarDemanda && !permissoes.podeEditarCatalogo ? '<span class="sub">—</span>' : '') +
      '</td>' +
    '</tr>';
  }

  /* ---- Confirmation of need form ---- */

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

    /* Projects already used become suggestions, so the same programme does not end up
       spelled three different ways. */
    var projetosConhecidos = [];
    estado.demandas.forEach(function (d) {
      if (d.projeto && projetosConhecidos.indexOf(d.projeto) === -1) projetosConhecidos.push(d.projeto);
    });

    /* A newly registered procedure may still have no rig and no hours. The request is
       recorded anyway — the need exists — but without those the scheduler has nothing to
       place, so the warning says where to complete it. */
    var identificacao = e(teste.nome) + (teste.revisao ? ' · ' + e(teste.revisao) : '') +
      ' · ' + e(teste.norma || 'no standard');
    var incompleto = !eqs.lista.length || !TC.scheduler.horasDeBancada(teste);

    var corpo =
      (incompleto
        ? '<div class="aviso alerta">' + identificacao +
            ' — this procedure still has <strong>no ' +
            (!eqs.lista.length ? 'equipment' : '') +
            (!eqs.lista.length && !TC.scheduler.horasDeBancada(teste) ? ' and no ' : '') +
            (!TC.scheduler.horasDeBancada(teste) ? 'rig hours' : '') +
            '</strong> in the catalogue. The request is recorded, but it only enters the ' +
            'calendar once the procedure register is completed.</div>'
        : '<div class="aviso">' + identificacao + ' · takes <strong>' +
            e(nomes) + '</strong> for ' +
            e(TC.scheduler.diasDeOperacao(teste, unidadesRef) + ' day(s)') +
            (eqs.lista.length > 1 ? ', with all ' + eqs.lista.length + ' groups reserved at once' : '') +
            '. The start date is worked out automatically from the sample arrival and the equipment calendar' +
            (temPool ? ', picking the unit that frees up first' : '') + '.' +
          '</div>') +
      '<p class="sub" style="margin:0 0 12px">Every field is required except ' +
        '<strong>force start</strong>.</p>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>LTI no. (work order)</label>' +
          '<input name="lti" placeholder="e.g. LTI-2026-0142" autocomplete="off"></div>' +
        '<div class="campo"><label>LTI classification</label><select name="tipoLti">' +
          ui.opcoes(TC.data.TIPOS_LTI, tipoPadrao) + '</select></div>' +
        '<div class="campo"><label>Customer</label><select name="clienteId">' +
          ui.opcoes(estado.clientes, clientePadrao) + '</select></div>' +
        '<div class="campo"><label>Project</label>' +
          '<input name="projeto" list="projetos-conhecidos" autocomplete="off" placeholder="e.g. MQB-A0 / EA211">' +
          '<datalist id="projetos-conhecidos">' +
            projetosConhecidos.map(function (p) { return '<option value="' + e(p) + '"></option>'; }).join('') +
          '</datalist></div>' +
        '<div class="campo"><label>Part Number</label>' +
          '<input name="partNumber" autocomplete="off" placeholder="e.g. 04E253011AB"></div>' +
        '<div class="campo"><label>Part type to test</label><select name="pecaId">' +
          ui.opcoes(estado.pecas, '') + '</select></div>' +
        '<div class="campo"><label>Samples available from</label>' +
          '<input type="date" name="dataAmostras" value="' + e(amostrasPadrao) + '"></div>' +
        '<div class="campo"><label>Due date</label>' +
          '<input type="date" name="prazo" value="' + e(prazoPadrao) + '"></div>' +
        '<div class="campo"><label>Priority</label><select name="prioridade">' +
          ui.opcoes(TC.data.PRIORIDADES, 'MEDIA') + '</select></div>' +
        '<div class="campo"><label>Samples to consume</label>' +
          '<input type="number" name="quantidade" min="1" value="' + e(String(teste.amostras)) + '"></div>' +
        '<div class="campo"><label>Force start on <span class="sub" style="font-weight:400">(optional)</span></label>' +
          '<input type="date" name="inicioFixo"></div>' +
      '</div>' +
      '<div class="campo"><label>Note</label>' +
        '<textarea name="observacao" rows="2" placeholder="e.g. repeat with alternative material"></textarea></div>' +
      '<div class="campo" id="previa"></div>';

    var janela = ui.modal({
      titulo: 'Confirm test need',
      corpo: corpo,
      confirmar: 'Confirm and schedule',
      aoConfirmar: function (v) {
        if (!ui.validarObrigatorios(janela, v, [
          { nome: 'lti', rotulo: 'the LTI number' },
          { nome: 'tipoLti', rotulo: 'the LTI classification' },
          { nome: 'clienteId', rotulo: 'the customer' },
          { nome: 'projeto', rotulo: 'the project' },
          { nome: 'partNumber', rotulo: 'the part number' },
          { nome: 'pecaId', rotulo: 'the part type to test' },
          { nome: 'dataAmostras', rotulo: 'the date the samples become available' },
          { nome: 'prazo', rotulo: 'the due date' },
          { nome: 'prioridade', rotulo: 'the priority' },
          { nome: 'quantidade', rotulo: 'the number of samples', tipo: 'numero', min: 1 },
          { nome: 'observacao', rotulo: 'the note' }
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
          ui.notificar('Quote recorded — cost estimated without reserving a rig.');
          ctx.ir('demandas');
          return;
        }
        if (alocacao && alocacao.inicio) {
          ui.notificar('Scheduled on ' + alocacao.equipamentos.map(function (eq) { return eq.nome; }).join(' + ') + ': ' +
            util.formatarData(alocacao.inicio, true) + ' → ' + util.formatarData(alocacao.fim, true));
        } else {
          ui.notificar('Request created, but with no slot available — check the schedule.');
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
      var custo = TC.scheduler.custoDemanda({ quantidade: qtd }, teste, null, peca, estado.hourlyRate);
      var cotacao = selTipo.value === 'COTACAO';
      previa.innerHTML =
        '<div class="aviso alerta"><strong>Estimated cost ' + e(util.formatarMoeda(custo.total)) + '</strong> — ' +
        e(String(custo.horasFaturaveis)) + ' h (' + e(String(custo.horasBancada)) + ' on the rig + ' +
        e(String(custo.horasReport)) + ' reporting) x ' + e(util.formatarTaxa(custo.hourlyRate)) + '/h = ' +
        e(util.formatarMoeda(custo.custoHoras)) +
        ' + consumables ' + e(util.formatarMoeda(custo.custoInsumos)) +
        ' + ' + e(String(qtd)) + ' sample(s) ' + e(util.formatarMoeda(custo.custoAmostras)) +
        (cotacao
          ? '. As a quote, it reserves no rig and stays out of the schedule.'
          : '. The test is not scheduled before ' + e(util.formatarData(campoAmostras.value, true)) + '.') +
        '</div>';
    }

    function atualizarTipo() {
      botaoConfirmar.textContent = selTipo.value === 'COTACAO' ? 'Record quote' : 'Confirm and schedule';
      atualizarPrevia();
    }

    var selTipo = janela.querySelector('[name=tipoLti]');

    selPeca.addEventListener('change', atualizarPrevia);
    selTipo.addEventListener('change', atualizarTipo);
    campoAmostras.addEventListener('change', atualizarPrevia);
    janela.querySelector('[name=quantidade]').addEventListener('input', atualizarPrevia);
    atualizarTipo();
  }

  /* ---- Procedure form ---- */

  function abrirEdicao(ctx, teste) {
    var estado = ctx.estado;
    var novo = !teste;
    teste = teste || { id: '', nome: '', norma: '', revisao: 'Rev. 01', area: 'COLD', clientes: [], equipamentoGrupos: [], horasSetup: 2, horasEnsaio: 24, horasReport: 4, amostras: 2, custoInsumos: 0, descricao: '' };
    var gruposAtuais = TC.scheduler.gruposDoTeste(teste);
    var parque = TC.scheduler.agruparEquipamentos(estado.equipamentos);

    var corpo =
      '<p class="sub" style="margin:0 0 12px">Every field is required. The exception is ' +
        '<strong>required by customers</strong>: leaving it blank marks the procedure as a lab ' +
        'standard, valid for everyone.</p>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Code</label><input name="id" value="' + e(teste.id) + '"' +
          (novo ? ' placeholder="TP-GM-12"' : ' readonly') + '></div>' +
        '<div class="campo"><label>Procedure name</label><input name="nome" value="' + e(teste.nome) + '" required></div>' +
        '<div class="campo"><label>Standard / reference</label><input name="norma" value="' + e(teste.norma || '') + '"></div>' +
        '<div class="campo"><label>Procedure revision</label>' +
          '<input name="revisao" value="' + e(teste.revisao || '') + '" placeholder="e.g. Rev. 03"></div>' +
        '<div class="campo"><label>System end</label><select name="area">' +
          ui.opcoes(TC.data.AREAS, teste.area) + '</select></div>' +
        '<div class="campo"><label>Setup hours</label><input type="number" name="horasSetup" min="0" step="0.5" value="' + e(String(teste.horasSetup)) + '"></div>' +
        '<div class="campo"><label>Test hours</label><input type="number" name="horasEnsaio" min="0" step="0.5" value="' + e(String(teste.horasEnsaio)) + '"></div>' +
        '<div class="campo"><label>Reporting hours</label><input type="number" name="horasReport" min="0" step="0.5" value="' + e(String(teste.horasReport || 0)) + '"></div>' +
        '<div class="campo"><label>Consumables cost (R$)</label><input type="number" name="custoInsumos" min="0" step="100" value="' + e(String(teste.custoInsumos || 0)) + '"></div>' +
        '<div class="campo"><label>Samples required</label><input type="number" name="amostras" min="1" value="' + e(String(teste.amostras)) + '"></div>' +
      '</div>' +
      '<div class="campo" id="previa-custo"></div>' +
      '<div class="campo"><label>Equipment the test occupies ' +
        '<span class="sub" style="font-weight:400">(tick more than one if the test holds the rigs at the same time; ' +
        'in a group with several units, the scheduler picks the one that frees up first)</span></label><div>' +
        parque.map(function (g) {
          return '<label style="display:inline-flex;align-items:center;gap:5px;margin:0 12px 6px 0;font-weight:500;color:var(--texto)">' +
            '<input type="checkbox" name="equipamentoGrupos" data-grupo="1" value="' + e(g.id) + '" style="width:auto"' +
            (gruposAtuais.indexOf(g.id) !== -1 ? ' checked' : '') + '>' + e(g.nome) +
            (g.membros.length > 1 ? ' <span class="sub">(' + g.membros.length + ')</span>' : '') + '</label>';
        }).join('') +
      '</div></div>' +
      '<div class="campo"><label>Required by customers (none = lab standard procedure)</label><div>' +
        estado.clientes.map(function (c) {
          return '<label style="display:inline-flex;align-items:center;gap:5px;margin:0 12px 6px 0;font-weight:500;color:var(--texto)">' +
            '<input type="checkbox" name="clientes" data-grupo="1" value="' + e(c.id) + '" style="width:auto"' +
            ((teste.clientes || []).indexOf(c.id) !== -1 ? ' checked' : '') + '>' + e(c.nome) + '</label>';
        }).join('') +
      '</div></div>' +
      '<div class="campo"><label>Description</label><textarea name="descricao" rows="2">' + e(teste.descricao || '') + '</textarea></div>';

    var janela = ui.modal({
      titulo: novo ? 'New procedure' : 'Edit ' + teste.id,
      corpo: corpo,
      confirmar: 'Save procedure',
      aoConfirmar: function (v) {
        if (!ui.validarObrigatorios(janela, v, [
          { nome: 'id', rotulo: 'the procedure code' },
          { nome: 'nome', rotulo: 'the procedure name' },
          { nome: 'norma', rotulo: 'the standard / reference' },
          { nome: 'revisao', rotulo: 'the procedure revision' },
          { nome: 'area', rotulo: 'the system end' },
          { nome: 'horasSetup', rotulo: 'the setup hours', tipo: 'numero' },
          { nome: 'horasEnsaio', rotulo: 'the test hours', tipo: 'numero', min: 0.5 },
          { nome: 'horasReport', rotulo: 'the reporting hours', tipo: 'numero' },
          { nome: 'custoInsumos', rotulo: 'the consumables cost', tipo: 'numero' },
          { nome: 'amostras', rotulo: 'the samples required', tipo: 'numero', min: 1 },
          { nome: 'descricao', rotulo: 'the description' }
        ])) return false;

        if (!v.equipamentoGrupos || !v.equipamentoGrupos.length) {
          ui.notificar('Select at least one piece of equipment.');
          return false;
        }
        if (novo && util.porId(estado.testes, v.id.trim())) {
          ui.notificar('A procedure with code ' + v.id.trim() + ' already exists.');
          janela.querySelector('[name=id]').focus();
          return false;
        }
        TC.store.salvarTeste({
          id: v.id.trim(), nome: v.nome.trim(), norma: v.norma.trim(), revisao: v.revisao.trim(),
          area: v.area, equipamentoGrupos: v.equipamentoGrupos, clientes: v.clientes || [],
          horasSetup: Number(v.horasSetup) || 0, horasEnsaio: Number(v.horasEnsaio) || 0,
          horasReport: Number(v.horasReport) || 0, amostras: Number(v.amostras) || 1,
          custoInsumos: Number(v.custoInsumos) || 0,
          descricao: v.descricao.trim()
        });
        ui.notificar('Procedure saved.');
      }
    });

    /* The cost breakdown shows as you type, so the register never becomes a black box. */
    var previaCusto = janela.querySelector('#previa-custo');
    function atualizarCusto() {
      function num(campo) { return Number(janela.querySelector('[name=' + campo + ']').value) || 0; }
      var horasBancada = num('horasSetup') + num('horasEnsaio');
      var horasReport = num('horasReport');
      var horas = horasBancada + horasReport;
      var rate = TC.scheduler.taxaHoraria(estado);
      var insumos = num('custoInsumos');
      previaCusto.innerHTML =
        '<div class="aviso"><strong>Procedure cost ' +
        e(util.formatarMoeda(horas * rate + insumos)) + '</strong> — (' +
        e(String(horasBancada)) + ' h on the rig + ' + e(String(horasReport)) + ' h reporting) × ' +
        e(util.formatarTaxa(rate)) + '/h = ' + e(util.formatarMoeda(horas * rate)) +
        ' + consumables ' + e(util.formatarMoeda(insumos)) +
        '. The hourly rate belongs to the test centre and is the same across the catalogue. ' +
        'Samples come in later, on the request.</div>';
    }
    ['horasSetup', 'horasEnsaio', 'horasReport', 'custoInsumos'].forEach(function (campo) {
      janela.querySelector('[name=' + campo + ']').addEventListener('input', atualizarCusto);
    });
    atualizarCusto();
  }

  /* ---- Test centre hourly rate ---- */

  /* A single value for the whole catalogue, updated once a year. It used to be a field on
     each procedure, which meant editing dozens of records at every revision. */
  function abrirHourlyRate(ctx) {
    var estado = ctx.estado;
    var comHoras = estado.testes.filter(function (t) {
      return TC.scheduler.horasFaturaveis(t) > 0;
    }).length;

    var janela = ui.modal({
      titulo: 'Test centre hourly rate',
      corpo:
        '<div class="aviso">It applies to the <strong>' + estado.testes.length +
          ' procedures</strong> in the catalogue (' + comHoras + ' already with measured hours). ' +
          'Archived quotes keep the rate of the day they were made and ' +
          '<strong>do not change</strong> with this revision.</div>' +
        '<div class="grade-campos">' +
          '<div class="campo"><label>Hourly rate (R$/h)</label>' +
            '<input type="number" name="hourlyRate" min="0" step="0.01" value="' +
            e(String(estado.hourlyRate)) + '"></div>' +
          '<div class="campo"><label>In force for</label>' +
            '<input name="vigencia" placeholder="e.g. 2026" value="' +
            e(estado.hourlyRateVigencia || '') + '"></div>' +
        '</div>' +
        '<div class="campo" id="previa-rate"></div>',
      confirmar: 'Save hourly rate',
      aoConfirmar: function (v) {
        if (!ui.validarObrigatorios(janela, v, [
          { nome: 'hourlyRate', rotulo: 'the hourly rate', tipo: 'numero', min: 0.01 },
          { nome: 'vigencia', rotulo: 'the period it is in force for' }
        ])) return false;
        TC.store.definirHourlyRate(v.hourlyRate, v.vigencia);
        ui.notificar('Hourly rate updated across the catalogue.');
      }
    });

    /* Shows the effect on the whole package at once: it is the number that justifies the
       rate. */
    var previa = janela.querySelector('#previa-rate');
    var campo = janela.querySelector('[name=hourlyRate]');
    function atualizar() {
      var rate = Number(campo.value) || 0;
      var total = estado.testes.reduce(function (soma, t) {
        return soma + TC.scheduler.custoCatalogo(t, rate).custoProcedimento;
      }, 0);
      previa.innerHTML = '<div class="aviso alerta">At this rate, running the whole catalogue ' +
        'once costs <strong>' + e(util.formatarMoeda(total)) + '</strong>.</div>';
    }
    campo.addEventListener('input', atualizar);
    atualizar();
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
      var c = TC.scheduler.custoCatalogo(t, estado.hourlyRate);
      totalHoras += c.horasBancada; totalCusto += c.total;
    });

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Test catalogue</h2>' +
        '<p>Every validation procedure by system end and customer, with its current revision, rig time and cost. Any procedure can run in any project phase. Confirm the need for a test and it enters the schedule automatically.</p></div>' +
        (permissoes.podeEditarCatalogo
          ? '<div class="acoes"><button class="botao primario" id="novo">+ New procedure</button></div>' : '') +
      '</div>' +
      '<div class="indicadores">' +
        '<div class="indicador"><div class="rotulo">Procedures listed</div><div class="valor">' + lista.length +
          '</div><div class="nota">of ' + estado.testes.length + ' in the catalogue</div></div>' +
        '<div class="indicador"><div class="rotulo">Total rig time</div><div class="valor">' +
          Math.round(totalHoras) + ' h</div><div class="nota">if every one ran once</div></div>' +
        '<div class="indicador"><div class="rotulo">Package cost</div><div class="valor">' +
          util.formatarMoeda(totalCusto) + '</div><div class="nota">excluding sample cost</div></div>' +
        /* The hourly rate belongs to the test centre, not to the procedure: a single field
           that applies to every procedure and changes once a year. */
        '<div class="indicador"><div class="rotulo">Hourly rate</div><div class="valor">' +
          util.formatarTaxa(estado.hourlyRate) + '<span class="sub" style="font-size:13px">/h</span></div>' +
          '<div class="nota">in force ' + e(estado.hourlyRateVigencia || '—') + ' · applies to the whole catalogue' +
          (permissoes.podeEditarCatalogo
            ? ' · <button class="botao pequeno" id="editar-rate" style="margin-top:6px">Change</button>'
            : '') + '</div></div>' +
      '</div>' +
      '<div class="cartao">' +
        '<div class="cartao-topo"><div class="filtros" style="flex:1">' +
          '<div class="campo busca"><label>Search</label><input id="f-busca" placeholder="name, code, standard or revision" value="' + e(f.busca || '') + '"></div>' +
          '<div class="campo"><label>Customer</label><select id="f-cliente">' + ui.opcoes(estado.clientes, f.clienteId, 'All') + '</select></div>' +
          '<div class="campo"><label>End</label><select id="f-area">' + ui.opcoes(TC.data.AREAS.filter(function (a) { return a.id !== 'AMBOS'; }), f.area, 'Hot + Cold') + '</select></div>' +
          '<div class="campo"><label>Equipment</label><select id="f-equip">' +
            ui.opcoes(TC.scheduler.agruparEquipamentos(estado.equipamentos), f.equipamentoId, 'All') + '</select></div>' +
        '</div></div>' +
        (lista.length ? '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Code</th><th>Procedure</th><th>Revision</th><th>End</th><th>Equipment</th>' +
          '<th class="num">Duration</th><th class="num">Samples</th><th class="num">Estimated cost</th><th></th>' +
          '</tr></thead><tbody>' + lista.map(function (t) { return linha(estado, t, permissoes); }).join('') +
          '</tbody></table></div>'
          : ui.vazio('No procedure found', 'Adjust the filters or register a new procedure.')) +
      '</div>';

    var botaoNovo = container.querySelector('#novo');
    if (botaoNovo) botaoNovo.onclick = function () { abrirEdicao(ctx, null); };

    var botaoRate = container.querySelector('#editar-rate');
    if (botaoRate) botaoRate.onclick = function () { abrirHourlyRate(ctx); };

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
