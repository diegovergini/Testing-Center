/* Equipment: capacity, calendar and maintenance downtime.
   This register is what limits the schedule. Cost does not come from here: it is worked out
   from the procedure's hourly rate. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  var SEMANA = [
    { valor: 1, nome: 'Mon' }, { valor: 2, nome: 'Tue' }, { valor: 3, nome: 'Wed' },
    { valor: 4, nome: 'Thu' }, { valor: 5, nome: 'Fri' }, { valor: 6, nome: 'Sat' }, { valor: 0, nome: 'Sun' }
  ];

  function ocupacaoPorEquipamento(plano, hoje, horizonte) {
    var mapa = {};
    plano.agendadas.forEach(function (a) {
      var inicio = util.maiorData(a.inicio, hoje);
      var dias = util.diffDias(inicio, a.fim) + 1;
      if (dias <= 0) return;
      /* Ensaio que prende duas bancadas conta ocupação nas duas; o custo-máquina de
         cada uma é a hora dela, não o total do ensaio. */
      a.equipamentos.forEach(function (eq) {
        var m = mapa[eq.id] = mapa[eq.id] || { dias: 0, ensaios: 0, horas: 0, custo: 0 };
        m.dias += Math.min(dias, horizonte);
        m.ensaios += 1;
        m.horas += a.custo.horasBancada;
      });
    });
    return mapa;
  }

  function abrirEdicao(equipamento, estado) {
    var novo = !equipamento;
    equipamento = equipamento || { id: '', nome: '', grupo: '', posicoes: 1, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], manutencao: [] };

    var gruposExistentes = TC.scheduler.agruparEquipamentos(estado.equipamentos)
      .map(function (g) { return g.id; });

    var corpo =
      '<div class="grade-campos">' +
        '<div class="campo"><label>Code</label><input name="id" value="' + e(equipamento.id) + '"' +
          (novo ? ' placeholder="SHK-03" required' : ' readonly') + '></div>' +
        '<div class="campo"><label>Name</label><input name="nome" value="' + e(equipamento.nome) + '" required></div>' +
        '<div class="campo"><label>Group</label>' +
          '<input name="grupo" list="grupos-existentes" autocomplete="off" value="' + e(equipamento.grupo || '') + '" ' +
          'placeholder="e.g. Burner">' +
          '<datalist id="grupos-existentes">' +
            gruposExistentes.map(function (g) { return '<option value="' + e(g) + '"></option>'; }).join('') +
          '</datalist></div>' +
        '<div class="campo"><label>Parallel positions</label><input type="number" min="1" name="posicoes" value="' + e(String(equipamento.posicoes)) + '"></div>' +
        '<div class="campo"><label>Hours per day</label><input type="number" min="1" max="24" name="horasDia" value="' + e(String(equipamento.horasDia)) + '"></div>' +
      '</div>' +
      '<div class="campo"><label style="display:flex;align-items:center;gap:7px;color:var(--texto)">' +
        '<input type="checkbox" name="continuo" style="width:auto"' + (equipamento.continuo ? ' checked' : '') + '>' +
        'Test runs 24 h/day with no operator (chambers and automatic rigs)</label></div>' +
      '<p class="sub" style="margin:0 0 12px">Units in the same group are interchangeable: the ' +
        'procedure asks for the group and the scheduler picks the one that frees up first. Leave it ' +
        'blank for the unit to form a group of its own.</p>' +
      '<div class="campo"><label>Operating days</label><div>' +
        SEMANA.map(function (d) {
          return '<label style="display:inline-flex;align-items:center;gap:5px;margin:0 12px 6px 0;font-weight:500;color:var(--texto)">' +
            '<input type="checkbox" name="diasUteis" data-grupo="1" value="' + d.valor + '" style="width:auto"' +
            (equipamento.diasUteis.indexOf(d.valor) !== -1 ? ' checked' : '') + '>' + d.nome + '</label>';
        }).join('') +
      '</div></div>';

    ui.modal({
      titulo: novo ? 'New equipment' : 'Edit ' + equipamento.nome,
      corpo: corpo,
      confirmar: 'Save equipment',
      aoConfirmar: function (v) {
        if (!v.id || !v.nome) { ui.notificar('Enter code and name.'); return false; }
        var dias = (v.diasUteis || []).map(Number);
        if (!dias.length) { ui.notificar('Select at least one operating day.'); return false; }
        TC.store.salvarEquipamento({
          id: v.id, nome: v.nome, grupo: v.grupo.trim(), posicoes: Number(v.posicoes) || 1,
          continuo: !!v.continuo, horasDia: Number(v.horasDia) || 8,
          diasUteis: dias, manutencao: equipamento.manutencao || []
        });
        ui.notificar('Equipment saved — schedule recalculated.');
      }
    });
  }

  function nomeTipo(id) {
    var t = util.porId(TC.data.TIPOS_MANUTENCAO, id);
    return t ? t.nome : (id || '—');
  }

  /* Recording what was done: it closes a planned downtime. The dates can change here —
     maintenance rarely ends on the day it was planned to. */
  function abrirRegistro(equipamento, parada) {
    ui.modal({
      titulo: 'Record maintenance on ' + equipamento.nome,
      corpo:
        '<div class="aviso">Downtime planned from <strong>' +
          e(util.formatarData(parada.inicio, true)) + '</strong> to <strong>' +
          e(util.formatarData(parada.fim, true)) + '</strong> — ' + e(parada.motivo) + '.<br>' +
          'Adjust the dates if the work did not go as planned.</div>' +
        '<div class="grade-campos">' +
          '<div class="campo"><label>Actual start</label>' +
            '<input type="date" name="inicio" value="' + e(parada.inicio) + '"></div>' +
          '<div class="campo"><label>Actual end</label>' +
            '<input type="date" name="fim" value="' + e(parada.fim) + '"></div>' +
          '<div class="campo"><label>Type</label><select name="tipo">' +
            ui.opcoes(TC.data.TIPOS_MANUTENCAO, parada.tipo || 'PREVENTIVA') + '</select></div>' +
          '<div class="campo"><label>Carried out by</label>' +
            '<input name="responsavel" value="' + e(parada.responsavel || '') + '" ' +
            'placeholder="Who did the work"></div>' +
        '</div>' +
        '<div class="campo"><label>What was done</label>' +
          '<textarea name="oQueFoiFeito" rows="3" placeholder="Thermocouples replaced, load cell calibrated, controller adjusted...">' +
          e(parada.oQueFoiFeito || '') + '</textarea></div>',
      confirmar: 'Record as carried out',
      aoConfirmar: function (v) {
        if (!v.inicio || !v.fim) { ui.notificar('Enter start and end.'); return false; }
        if (util.diffDias(v.inicio, v.fim) < 0) { ui.notificar('The end has to come after the start.'); return false; }
        if (!(v.oQueFoiFeito || '').trim()) {
          ui.notificar('Describe what was done — it is the rig\'s history.');
          return false;
        }
        TC.store.registrarManutencao(equipamento.id, parada.id, v);
        ui.notificar('Maintenance recorded.');
      }
    });
  }

  function abrirManutencao(equipamento, hoje) {
    var situacao = TC.manutencao.situacao(equipamento, hoje);
    var lista = TC.manutencao.paradas(equipamento).slice().sort(function (a, b) {
      return util.diffDias(b.inicio, a.inicio);
    });

    var corpo =
      '<div class="aviso">' +
        (situacao.ultima
          ? '<strong>Last maintenance:</strong> ' + e(util.formatarData(situacao.ultima.fim, true)) +
            ' (' + situacao.diasDesdeUltima + ' days ago) — ' + e(situacao.ultima.oQueFoiFeito || situacao.ultima.motivo)
          : '<strong>No maintenance recorded</strong> on this rig') +
        '<br>' +
        (situacao.proxima
          ? '<strong>Next planned:</strong> ' + e(util.formatarData(situacao.proxima.inicio, true)) +
            ' (in ' + situacao.diasParaProxima + ' days) — ' + e(situacao.proxima.motivo)
          : '<strong>No next maintenance scheduled.</strong>') +
      '</div>' +
      (situacao.atrasadas.length
        ? '<div class="aviso erro">' + situacao.atrasadas.length +
          ' downtime(s) past their date with no record of what was done. Record or remove them.</div>'
        : '') +
      '<p class="sub" style="margin:0 0 10px">Scheduling downtime blocks the calendar: no test is ' +
        'planned across the period, and requests already planned are pushed out.</p>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Start</label><input type="date" name="inicio" value="' +
          e(util.hoje()) + '"></div>' +
        '<div class="campo"><label>End</label><input type="date" name="fim" value="' +
          e(util.somaDias(util.hoje(), 3)) + '"></div>' +
        '<div class="campo"><label>Type</label><select name="tipo">' +
          ui.opcoes(TC.data.TIPOS_MANUTENCAO, 'PREVENTIVA') + '</select></div>' +
        '<div class="campo"><label>Reason / planned scope</label>' +
          '<input name="motivo" placeholder="Annual calibration"></div>' +
      '</div>' +
      (lista.length
        ? '<div class="tabela-rolagem" style="margin-top:8px"><table><thead><tr>' +
          '<th>Period</th><th>Type</th><th>Scope / what was done</th><th>Status</th><th></th>' +
          '</tr></thead><tbody>' +
          lista.map(function (m) {
            var realizada = m.situacao === TC.manutencao.REALIZADA;
            /* diffDias(a, b) is b - a: overdue is the planned one whose end is behind us. */
            var vencida = !realizada && util.diffDias(m.fim, hoje) > 0;
            return '<tr>' +
              '<td style="white-space:nowrap">' + e(util.formatarData(m.inicio, true)) + ' → ' +
                e(util.formatarData(m.fim, true)) + '</td>' +
              '<td>' + e(nomeTipo(m.tipo)) + '</td>' +
              '<td><div>' + e(m.motivo) + '</div>' +
                (m.oQueFoiFeito ? '<div class="sub">' + e(m.oQueFoiFeito) + '</div>' : '') +
                (m.responsavel ? '<div class="sub">by ' + e(m.responsavel) + '</div>' : '') + '</td>' +
              '<td><span class="etiqueta ' + (realizada ? 'ok' : vencida ? 'erro' : 'alerta') + '">' +
                (realizada ? 'Carried out' : vencida ? 'Overdue' : 'Planned') + '</span></td>' +
              '<td class="num" style="white-space:nowrap">' +
                (realizada ? '' : '<button type="button" class="botao pequeno primario registrar" data-janela="' +
                  e(m.id) + '">Record</button> ') +
                '<button type="button" class="botao pequeno perigo remover" data-janela="' +
                  e(m.id) + '">✕</button></td>' +
            '</tr>';
          }).join('') + '</tbody></table></div>'
        : '');

    var janela = ui.modal({
      titulo: 'Maintenance on ' + equipamento.nome,
      corpo: corpo,
      largura: 'min(900px, 100%)',
      confirmar: 'Schedule downtime',
      aoConfirmar: function (v) {
        if (!v.inicio || !v.fim) { ui.notificar('Enter start and end.'); return false; }
        if (util.diffDias(v.inicio, v.fim) < 0) { ui.notificar('The end has to come after the start.'); return false; }
        TC.store.adicionarManutencao(equipamento.id, {
          inicio: v.inicio, fim: v.fim, tipo: v.tipo, motivo: v.motivo || 'Maintenance'
        });
        ui.notificar('Downtime scheduled — schedule recalculated.');
      }
    });

    janela.querySelectorAll('.registrar').forEach(function (botao) {
      botao.onclick = function () {
        var parada = util.porId(equipamento.manutencao, botao.dataset.janela);
        ui.fecharModal();
        abrirRegistro(equipamento, parada);
      };
    });
    janela.querySelectorAll('.remover').forEach(function (botao) {
      botao.onclick = function () {
        TC.store.removerManutencao(equipamento.id, botao.dataset.janela);
        ui.fecharModal();
        ui.notificar('Downtime removed.');
      };
    });
  }

  function render(container, ctx) {
    var estado = ctx.estado;
    var podeEditar = ctx.podeEditar;
    var horizonte = 90;
    var ocupacao = ocupacaoPorEquipamento(ctx.plano, ctx.hoje, horizonte);

    var pendencias = TC.manutencao.pendencias(estado, ctx.hoje);
    var vencidas = pendencias.filter(function (p) { return p.tipo === 'atrasada'; });
    var semPlano = pendencias.filter(function (p) { return p.tipo === 'sem-proxima'; });

    var irmaos = {};
    TC.scheduler.agruparEquipamentos(estado.equipamentos).forEach(function (g) {
      irmaos[g.id] = g.membros.length;
    });

    var linhas = estado.equipamentos.map(function (eq) {
      var o = ocupacao[eq.id] || { dias: 0, ensaios: 0, horas: 0, custo: 0 };
      var m = TC.manutencao.situacao(eq, ctx.hoje);
      var capacidade = eq.posicoes * horizonte;
      var uso = Math.min(100, Math.round(o.dias / capacidade * 100));
      var dias = eq.diasUteis.slice().sort().map(function (d) { return util.NOMES_DIA[d]; }).join(' ');
      return '<tr data-equip="' + e(eq.id) + '">' +
        '<td><div class="forte">' + e(eq.nome) + '</div>' +
          '<div class="sub mono">' + e(eq.id) + '</div></td>' +
        '<td>' + (irmaos[TC.scheduler.grupoDe(eq)] > 1
          ? '<span class="etiqueta marca">' + e(TC.scheduler.grupoDe(eq)) + '</span>' +
            '<div class="sub">' + irmaos[TC.scheduler.grupoDe(eq)] + ' units</div>'
          : '<span class="sub">single unit</span>') + '</td>' +
        '<td class="num">' + eq.posicoes + '</td>' +
        '<td>' + (eq.continuo ? '<span class="etiqueta ok">24 h continuous</span>' : '<span class="etiqueta">' + eq.horasDia + ' h/day</span>') +
          '<div class="sub">' + e(dias) + '</div></td>' +
        '<td class="num">' + o.ensaios + '</td>' +
        '<td style="min-width:150px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span class="barra-trilho" style="flex:1"><span class="barra-valor' +
              (uso > 85 ? ' erro' : uso > 60 ? ' alerta' : '') + '" style="width:' + uso + '%"></span></span>' +
            '<span class="sub">' + uso + '%</span></div>' +
        '</td>' +
        '<td class="num">' + Math.round(o.horas) + ' h</td>' +
        /* Last and next maintenance are the management question about a rig: how long it
           has been running untouched and when it stops again. */
        '<td>' + (m.ultima
          ? '<div class="forte">' + e(util.formatarData(m.ultima.fim, true)) + '</div>' +
            '<div class="sub">' + e(nomeTipo(m.ultima.tipo)) + ' · ' + m.diasDesdeUltima + ' d ago</div>' +
            '<div class="sub">' + e(util.recortar(m.ultima.oQueFoiFeito || m.ultima.motivo, 46)) + '</div>'
          : '<span class="sub">none recorded</span>') + '</td>' +
        '<td>' + (m.proxima
          ? '<div class="forte">' + e(util.formatarData(m.proxima.inicio, true)) + '</div>' +
            '<div class="sub">' + e(nomeTipo(m.proxima.tipo)) + ' · in ' + m.diasParaProxima + ' d</div>'
          : '<span class="etiqueta alerta">not scheduled</span>') +
          (m.atrasadas.length
            ? '<div><span class="etiqueta erro">' + m.atrasadas.length + ' overdue</span></div>'
            : '') +
          (m.emManutencaoHoje ? '<div><span class="etiqueta erro">down today</span></div>' : '') +
        '</td>' +
        '<td class="num" style="white-space:nowrap">' +
          (podeEditar
            ? '<button class="botao pequeno manutencao">Maintenance</button> ' +
              '<button class="botao pequeno editar">Edit</button> ' +
              '<button class="botao pequeno perigo excluir" title="Remove equipment">✕</button>'
            : '<span class="sub">—</span>') +
        '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Equipment</h2>' +
        '<p>The lab\'s installed capacity. Parallel positions, calendar and maintenance downtime are exactly the constraints the scheduler respects. The cost of a test does not come from here: it comes from the procedure\'s hourly rate.</p></div>' +
        (ctx.podeEditar ? '<div class="acoes"><button class="botao primario" id="novo">+ New equipment</button></div>' : '') +
      '</div>' +
      /* Overdue ones show up one by one: each is a call to action. "No next scheduled"
         collapses into a single line, otherwise the warning becomes a wall nobody reads. */
      (vencidas.length || semPlano.length
        ? '<div class="cartao"><div class="cartao-corpo">' +
          vencidas.slice(0, 6).map(function (p) {
            return '<div class="aviso erro" style="margin-bottom:8px">' + e(p.texto) + '</div>';
          }).join('') +
          (vencidas.length > 6
            ? '<div class="sub" style="margin-bottom:8px">+ ' + (vencidas.length - 6) +
              ' other overdue downtime(s).</div>'
            : '') +
          (semPlano.length
            ? '<div class="aviso alerta" style="margin:0"><strong>' + semPlano.length +
              ' piece(s) of equipment with no next maintenance scheduled:</strong> ' +
              e(semPlano.map(function (p) { return p.equipamento.nome; }).join(', ')) + '.</div>'
            : '') +
          '</div></div>'
        : '') +
      '<div class="cartao">' +
        '<div class="cartao-topo"><h3>Utilisation over the next ' + horizonte + ' days</h3>' +
          '<span class="sub">Percentage over positions × available days</span></div>' +
        '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Equipment</th><th>Group</th><th class="num">Positions</th><th>Regime</th>' +
          '<th class="num">Tests</th><th>Utilisation</th><th class="num">Hours allocated</th>' +
          '<th>Last maintenance</th><th>Next planned</th><th></th>' +
        '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      '</div>';

    var botaoNovo = container.querySelector('#novo');
    if (botaoNovo) botaoNovo.onclick = function () { abrirEdicao(null, estado); };
    container.querySelectorAll('tr[data-equip]').forEach(function (tr) {
      var eq = util.porId(estado.equipamentos, tr.dataset.equip);
      var editar = tr.querySelector('.editar');
      if (!editar) return;
      editar.onclick = function () { abrirEdicao(eq, estado); };
      tr.querySelector('.manutencao').onclick = function () { abrirManutencao(eq, ctx.hoje); };
      tr.querySelector('.excluir').onclick = function () {
        var grupo = TC.scheduler.grupoDe(eq);
        var ultimaDoGrupo = irmaos[grupo] === 1;
        var dependentes = ultimaDoGrupo
          ? estado.testes.filter(function (t) { return TC.scheduler.gruposDoTeste(t).indexOf(grupo) !== -1; })
          : [];
        ui.confirmarAcao(
          'Remove ' + eq.nome + '?' +
          (dependentes.length
            ? ' It is the last unit in the ' + grupo + ' group, and ' + dependentes.length +
              ' procedure(s) use it: they will be left without a rig until they are pointed at another group.'
            : ultimaDoGrupo ? '' : ' The ' + grupo + ' group carries on with its other units.'),
          function () {
            TC.store.removerEquipamento(eq.id);
            ui.notificar('Equipment removed.');
          });
      };
    });
  }

  TC.views = TC.views || {};
  TC.views.equipamentos = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
