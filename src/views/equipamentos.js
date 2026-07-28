/* Equipamentos: capacidade, calendário e paradas de manutenção.
   É este cadastro que limita o planejamento. O custo não sai daqui: ele é calculado
   pelo hourly rate do procedimento. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  var SEMANA = [
    { valor: 1, nome: 'Seg' }, { valor: 2, nome: 'Ter' }, { valor: 3, nome: 'Qua' },
    { valor: 4, nome: 'Qui' }, { valor: 5, nome: 'Sex' }, { valor: 6, nome: 'Sáb' }, { valor: 0, nome: 'Dom' }
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
        '<div class="campo"><label>Código</label><input name="id" value="' + e(equipamento.id) + '"' +
          (novo ? ' placeholder="SHK-03" required' : ' readonly') + '></div>' +
        '<div class="campo"><label>Nome</label><input name="nome" value="' + e(equipamento.nome) + '" required></div>' +
        '<div class="campo"><label>Grupo</label>' +
          '<input name="grupo" list="grupos-existentes" autocomplete="off" value="' + e(equipamento.grupo || '') + '" ' +
          'placeholder="Ex.: Burner">' +
          '<datalist id="grupos-existentes">' +
            gruposExistentes.map(function (g) { return '<option value="' + e(g) + '"></option>'; }).join('') +
          '</datalist></div>' +
        '<div class="campo"><label>Posições em paralelo</label><input type="number" min="1" name="posicoes" value="' + e(String(equipamento.posicoes)) + '"></div>' +
        '<div class="campo"><label>Horas por dia</label><input type="number" min="1" max="24" name="horasDia" value="' + e(String(equipamento.horasDia)) + '"></div>' +
      '</div>' +
      '<div class="campo"><label style="display:flex;align-items:center;gap:7px;color:var(--texto)">' +
        '<input type="checkbox" name="continuo" style="width:auto"' + (equipamento.continuo ? ' checked' : '') + '>' +
        'Ensaio corre 24 h/dia sem operador (câmaras e bancos automáticos)</label></div>' +
      '<p class="sub" style="margin:0 0 12px">Unidades com o mesmo grupo são intercambiáveis: o ' +
        'procedimento pede o grupo e o planejamento escolhe a que libera mais cedo. Deixe em branco ' +
        'para a unidade formar um grupo só dela.</p>' +
      '<div class="campo"><label>Dias de operação</label><div>' +
        SEMANA.map(function (d) {
          return '<label style="display:inline-flex;align-items:center;gap:5px;margin:0 12px 6px 0;font-weight:500;color:var(--texto)">' +
            '<input type="checkbox" name="diasUteis" data-grupo="1" value="' + d.valor + '" style="width:auto"' +
            (equipamento.diasUteis.indexOf(d.valor) !== -1 ? ' checked' : '') + '>' + d.nome + '</label>';
        }).join('') +
      '</div></div>';

    ui.modal({
      titulo: novo ? 'Novo equipamento' : 'Editar ' + equipamento.nome,
      corpo: corpo,
      confirmar: 'Salvar equipamento',
      aoConfirmar: function (v) {
        if (!v.id || !v.nome) { ui.notificar('Informe código e nome.'); return false; }
        var dias = (v.diasUteis || []).map(Number);
        if (!dias.length) { ui.notificar('Selecione ao menos um dia de operação.'); return false; }
        TC.store.salvarEquipamento({
          id: v.id, nome: v.nome, grupo: v.grupo.trim(), posicoes: Number(v.posicoes) || 1,
          continuo: !!v.continuo, horasDia: Number(v.horasDia) || 8,
          diasUteis: dias, manutencao: equipamento.manutencao || []
        });
        ui.notificar('Equipamento salvo — planejamento recalculado.');
      }
    });
  }

  function abrirManutencao(equipamento) {
    var corpo =
      '<p class="sub" style="margin-top:0">Nenhum ensaio é agendado atravessando uma parada. Demandas já planejadas são empurradas automaticamente.</p>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Início</label><input type="date" name="inicio" value="' + e(util.hoje()) + '"></div>' +
        '<div class="campo"><label>Fim</label><input type="date" name="fim" value="' + e(util.somaDias(util.hoje(), 3)) + '"></div>' +
        '<div class="campo"><label>Motivo</label><input name="motivo" placeholder="Calibração anual"></div>' +
      '</div>' +
      (equipamento.manutencao && equipamento.manutencao.length
        ? '<table style="margin-top:8px"><thead><tr><th>Período</th><th>Motivo</th><th></th></tr></thead><tbody>' +
          equipamento.manutencao.map(function (m) {
            return '<tr><td>' + e(util.formatarData(m.inicio, true)) + ' → ' + e(util.formatarData(m.fim, true)) + '</td>' +
              '<td>' + e(m.motivo) + '</td>' +
              '<td class="num"><button type="button" class="botao pequeno perigo remover" data-janela="' + e(m.id) + '">Remover</button></td></tr>';
          }).join('') + '</tbody></table>'
        : '');

    var janela = ui.modal({
      titulo: 'Paradas de ' + equipamento.nome,
      corpo: corpo,
      confirmar: 'Agendar parada',
      aoConfirmar: function (v) {
        if (!v.inicio || !v.fim) { ui.notificar('Informe início e fim.'); return false; }
        if (util.diffDias(v.inicio, v.fim) < 0) { ui.notificar('O fim deve ser posterior ao início.'); return false; }
        TC.store.adicionarManutencao(equipamento.id, { inicio: v.inicio, fim: v.fim, motivo: v.motivo });
        ui.notificar('Parada registrada — planejamento recalculado.');
      }
    });

    janela.querySelectorAll('.remover').forEach(function (botao) {
      botao.onclick = function () {
        TC.store.removerManutencao(equipamento.id, botao.dataset.janela);
        ui.fecharModal();
        ui.notificar('Parada removida.');
      };
    });
  }

  function render(container, ctx) {
    var estado = ctx.estado;
    var podeEditar = ctx.podeEditar;
    var horizonte = 90;
    var ocupacao = ocupacaoPorEquipamento(ctx.plano, ctx.hoje, horizonte);

    var irmaos = {};
    TC.scheduler.agruparEquipamentos(estado.equipamentos).forEach(function (g) {
      irmaos[g.id] = g.membros.length;
    });

    var linhas = estado.equipamentos.map(function (eq) {
      var o = ocupacao[eq.id] || { dias: 0, ensaios: 0, horas: 0, custo: 0 };
      var capacidade = eq.posicoes * horizonte;
      var uso = Math.min(100, Math.round(o.dias / capacidade * 100));
      var dias = eq.diasUteis.slice().sort().map(function (d) { return util.NOMES_DIA[d]; }).join(' ');
      return '<tr data-equip="' + e(eq.id) + '">' +
        '<td><div class="forte">' + e(eq.nome) + '</div>' +
          '<div class="sub mono">' + e(eq.id) + '</div></td>' +
        '<td>' + (irmaos[TC.scheduler.grupoDe(eq)] > 1
          ? '<span class="etiqueta marca">' + e(TC.scheduler.grupoDe(eq)) + '</span>' +
            '<div class="sub">' + irmaos[TC.scheduler.grupoDe(eq)] + ' unidades</div>'
          : '<span class="sub">unidade única</span>') + '</td>' +
        '<td class="num">' + eq.posicoes + '</td>' +
        '<td>' + (eq.continuo ? '<span class="etiqueta ok">24 h contínuo</span>' : '<span class="etiqueta">' + eq.horasDia + ' h/dia</span>') +
          '<div class="sub">' + e(dias) + '</div></td>' +
        '<td class="num">' + o.ensaios + '</td>' +
        '<td style="min-width:150px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span class="barra-trilho" style="flex:1"><span class="barra-valor' +
              (uso > 85 ? ' erro' : uso > 60 ? ' alerta' : '') + '" style="width:' + uso + '%"></span></span>' +
            '<span class="sub">' + uso + '%</span></div>' +
        '</td>' +
        '<td class="num">' + Math.round(o.horas) + ' h</td>' +
        '<td>' + ((eq.manutencao || []).length
          ? '<span class="etiqueta alerta">' + eq.manutencao.length + ' parada(s)</span>'
          : '<span class="sub">—</span>') + '</td>' +
        '<td class="num" style="white-space:nowrap">' +
          (podeEditar
            ? '<button class="botao pequeno manutencao">Paradas</button> ' +
              '<button class="botao pequeno editar">Editar</button> ' +
              '<button class="botao pequeno perigo excluir" title="Remover equipamento">✕</button>'
            : '<span class="sub">—</span>') +
        '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Equipamentos</h2>' +
        '<p>Capacidade instalada do laboratório. Posições em paralelo, calendário e paradas de manutenção são exatamente as restrições que o planejamento respeita. O custo do ensaio não vem daqui: ele sai do hourly rate do procedimento.</p></div>' +
        (ctx.podeEditar ? '<div class="acoes"><button class="botao primario" id="novo">+ Novo equipamento</button></div>' : '') +
      '</div>' +
      '<div class="cartao">' +
        '<div class="cartao-topo"><h3>Ocupação nos próximos ' + horizonte + ' dias</h3>' +
          '<span class="sub">Percentual calculado sobre posições × dias disponíveis</span></div>' +
        '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Equipamento</th><th>Grupo</th><th class="num">Posições</th><th>Regime</th>' +
          '<th class="num">Ensaios</th><th>Ocupação</th><th class="num">Horas alocadas</th><th>Manutenção</th><th></th>' +
        '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      '</div>';

    var botaoNovo = container.querySelector('#novo');
    if (botaoNovo) botaoNovo.onclick = function () { abrirEdicao(null, estado); };
    container.querySelectorAll('tr[data-equip]').forEach(function (tr) {
      var eq = util.porId(estado.equipamentos, tr.dataset.equip);
      var editar = tr.querySelector('.editar');
      if (!editar) return;
      editar.onclick = function () { abrirEdicao(eq, estado); };
      tr.querySelector('.manutencao').onclick = function () { abrirManutencao(eq); };
      tr.querySelector('.excluir').onclick = function () {
        var grupo = TC.scheduler.grupoDe(eq);
        var ultimaDoGrupo = irmaos[grupo] === 1;
        var dependentes = ultimaDoGrupo
          ? estado.testes.filter(function (t) { return TC.scheduler.gruposDoTeste(t).indexOf(grupo) !== -1; })
          : [];
        ui.confirmarAcao(
          'Remover ' + eq.nome + '?' +
          (dependentes.length
            ? ' É a última unidade do grupo ' + grupo + ', e ' + dependentes.length +
              ' procedimento(s) o usam: eles ficarão sem bancada até serem apontados para outro grupo.'
            : ultimaDoGrupo ? '' : ' O grupo ' + grupo + ' continua com as outras unidades.'),
          function () {
            TC.store.removerEquipamento(eq.id);
            ui.notificar('Equipamento removido.');
          });
      };
    });
  }

  TC.views = TC.views || {};
  TC.views.equipamentos = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
