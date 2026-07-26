/* Equipamentos: capacidade, calendário, custo-hora e paradas de manutenção.
   É este cadastro que limita o planejamento. */
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
      var m = mapa[a.equipamento.id] = mapa[a.equipamento.id] || { dias: 0, ensaios: 0, horas: 0, custo: 0 };
      m.dias += Math.min(dias, horizonte);
      m.ensaios += 1;
      m.horas += a.custo.horas;
      m.custo += a.custo.custoEquipamento;
    });
    return mapa;
  }

  function abrirEdicao(equipamento) {
    var novo = !equipamento;
    equipamento = equipamento || { id: '', nome: '', posicoes: 1, continuo: false, horasDia: 8, diasUteis: [1, 2, 3, 4, 5], custoHora: 0, manutencao: [] };

    var corpo =
      '<div class="grade-campos">' +
        '<div class="campo"><label>Código</label><input name="id" value="' + e(equipamento.id) + '"' +
          (novo ? ' placeholder="SHK-03" required' : ' readonly') + '></div>' +
        '<div class="campo"><label>Nome</label><input name="nome" value="' + e(equipamento.nome) + '" required></div>' +
        '<div class="campo"><label>Posições em paralelo</label><input type="number" min="1" name="posicoes" value="' + e(String(equipamento.posicoes)) + '"></div>' +
        '<div class="campo"><label>Horas por dia</label><input type="number" min="1" max="24" name="horasDia" value="' + e(String(equipamento.horasDia)) + '"></div>' +
        '<div class="campo"><label>Custo por hora (R$)</label><input type="number" min="0" step="10" name="custoHora" value="' + e(String(equipamento.custoHora)) + '"></div>' +
      '</div>' +
      '<div class="campo"><label style="display:flex;align-items:center;gap:7px;color:var(--texto)">' +
        '<input type="checkbox" name="continuo" style="width:auto"' + (equipamento.continuo ? ' checked' : '') + '>' +
        'Ensaio corre 24 h/dia sem operador (câmaras e bancos automáticos)</label></div>' +
      '<div class="campo"><label>Dias de operação</label><div>' +
        SEMANA.map(function (d) {
          return '<label style="display:inline-flex;align-items:center;gap:5px;margin:0 12px 6px 0;font-weight:500;color:var(--texto)">' +
            '<input type="checkbox" name="diasUteis" data-grupo="1" value="' + d.valor + '" style="width:auto"' +
            (equipamento.diasUteis.indexOf(d.valor) !== -1 ? ' checked' : '') + '>' + d.nome + '</label>';
        }).join('') +
      '</div></div>';

    ui.modal({
      titulo: novo ? 'Novo equipamento' : 'Editar ' + equipamento.id,
      corpo: corpo,
      confirmar: 'Salvar equipamento',
      aoConfirmar: function (v) {
        if (!v.id || !v.nome) { ui.notificar('Informe código e nome.'); return false; }
        var dias = (v.diasUteis || []).map(Number);
        if (!dias.length) { ui.notificar('Selecione ao menos um dia de operação.'); return false; }
        TC.store.salvarEquipamento({
          id: v.id, nome: v.nome, posicoes: Number(v.posicoes) || 1,
          continuo: !!v.continuo, horasDia: Number(v.horasDia) || 8,
          diasUteis: dias, custoHora: Number(v.custoHora) || 0,
          manutencao: equipamento.manutencao || []
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
      titulo: 'Paradas de ' + equipamento.id,
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
    var horizonte = 90;
    var ocupacao = ocupacaoPorEquipamento(ctx.plano, ctx.hoje, horizonte);

    var linhas = estado.equipamentos.map(function (eq) {
      var o = ocupacao[eq.id] || { dias: 0, ensaios: 0, horas: 0, custo: 0 };
      var capacidade = eq.posicoes * horizonte;
      var uso = Math.min(100, Math.round(o.dias / capacidade * 100));
      var dias = eq.diasUteis.slice().sort().map(function (d) { return util.NOMES_DIA[d]; }).join(' ');
      return '<tr data-equip="' + e(eq.id) + '">' +
        '<td><span class="mono forte">' + e(eq.id) + '</span><div class="sub">' + e(eq.nome) + '</div></td>' +
        '<td class="num">' + eq.posicoes + '</td>' +
        '<td>' + (eq.continuo ? '<span class="etiqueta ok">24 h contínuo</span>' : '<span class="etiqueta">' + eq.horasDia + ' h/dia</span>') +
          '<div class="sub">' + e(dias) + '</div></td>' +
        '<td class="num">' + e(util.formatarMoeda(eq.custoHora)) + '</td>' +
        '<td class="num">' + o.ensaios + '</td>' +
        '<td style="min-width:150px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span class="barra-trilho" style="flex:1"><span class="barra-valor' +
              (uso > 85 ? ' erro' : uso > 60 ? ' alerta' : '') + '" style="width:' + uso + '%"></span></span>' +
            '<span class="sub">' + uso + '%</span></div>' +
        '</td>' +
        '<td class="num">' + e(util.formatarMoeda(o.custo)) + '</td>' +
        '<td>' + ((eq.manutencao || []).length
          ? '<span class="etiqueta alerta">' + eq.manutencao.length + ' parada(s)</span>'
          : '<span class="sub">—</span>') + '</td>' +
        '<td class="num" style="white-space:nowrap">' +
          '<button class="botao pequeno manutencao">Paradas</button> ' +
          '<button class="botao pequeno editar">Editar</button> ' +
          '<button class="botao pequeno perigo excluir" title="Remover equipamento">✕</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Equipamentos</h2>' +
        '<p>Capacidade instalada do laboratório. Posições em paralelo, calendário e paradas de manutenção são exatamente as restrições que o planejamento respeita.</p></div>' +
        '<div class="acoes"><button class="botao primario" id="novo">+ Novo equipamento</button></div>' +
      '</div>' +
      '<div class="cartao">' +
        '<div class="cartao-topo"><h3>Ocupação nos próximos ' + horizonte + ' dias</h3>' +
          '<span class="sub">Percentual calculado sobre posições × dias disponíveis</span></div>' +
        '<div class="tabela-rolagem"><table><thead><tr>' +
          '<th>Equipamento</th><th class="num">Posições</th><th>Regime</th><th class="num">R$/h</th>' +
          '<th class="num">Ensaios</th><th>Ocupação</th><th class="num">Custo-máquina</th><th>Manutenção</th><th></th>' +
        '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      '</div>';

    container.querySelector('#novo').onclick = function () { abrirEdicao(null); };
    container.querySelectorAll('tr[data-equip]').forEach(function (tr) {
      var eq = util.porId(estado.equipamentos, tr.dataset.equip);
      tr.querySelector('.editar').onclick = function () { abrirEdicao(eq); };
      tr.querySelector('.manutencao').onclick = function () { abrirManutencao(eq); };
      tr.querySelector('.excluir').onclick = function () {
        var dependentes = estado.testes.filter(function (t) { return t.equipamentoId === eq.id; });
        ui.confirmarAcao(
          'Remover ' + eq.id + ' — ' + eq.nome + '?' +
          (dependentes.length
            ? ' ' + dependentes.length + ' procedimento(s) usam este equipamento e ficarão sem bancada, ' +
              'aparecendo como demandas sem janela até você apontá-los para outro.'
            : ''),
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
