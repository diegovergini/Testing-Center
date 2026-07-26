/* Montagem da aplicação: navegação, recálculo do planejamento e backup dos dados. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  var ROTAS = [
    { id: 'catalogo', nome: 'Catálogo de testes', icone: '📋', grupo: 'Validação' },
    { id: 'demandas', nome: 'Demandas', icone: '✅', grupo: 'Validação' },
    { id: 'planejamento', nome: 'Planejamento', icone: '📅', grupo: 'Validação' },
    { id: 'painel', nome: 'Painel', icone: '📊', grupo: 'Validação' },
    { id: 'equipamentos', nome: 'Equipamentos', icone: '⚙️', grupo: 'Cadastros' },
    { id: 'pecas', nome: 'Peças e amostras', icone: '🔩', grupo: 'Cadastros' }
  ];

  var filtros = { busca: '', clienteId: '', area: '', fase: '', status: '', equipamentoId: '' };
  var rotaAtual = 'catalogo';

  function contadores(estado, plano) {
    return {
      catalogo: estado.testes.length,
      demandas: estado.demandas.filter(function (d) {
        return TC.scheduler.STATUS_ATIVOS.indexOf(d.status) !== -1;
      }).length,
      planejamento: plano.agendadas.length,
      equipamentos: estado.equipamentos.length,
      pecas: estado.pecas.length
    };
  }

  function desenharNavegacao(estado, plano) {
    var lateral = document.getElementById('lateral');
    var contas = contadores(estado, plano);
    var grupoAtual = '';
    var html = '';
    ROTAS.forEach(function (r) {
      if (r.grupo !== grupoAtual) {
        grupoAtual = r.grupo;
        html += '<div class="nav-titulo">' + e(grupoAtual) + '</div>';
      }
      html += '<button class="nav-item' + (r.id === rotaAtual ? ' ativo' : '') + '" data-rota="' + e(r.id) + '">' +
        '<span aria-hidden="true">' + r.icone + '</span>' + e(r.nome) +
        (contas[r.id] !== undefined ? '<span class="contador">' + contas[r.id] + '</span>' : '') +
        '</button>';
    });
    html += '<div class="nav-titulo">Dados</div>' +
      '<button class="nav-item" id="exportar"><span aria-hidden="true">⬇️</span>Exportar backup</button>' +
      '<button class="nav-item" id="importar"><span aria-hidden="true">⬆️</span>Importar backup</button>' +
      '<button class="nav-item" id="restaurar"><span aria-hidden="true">♻️</span>Restaurar padrão</button>' +
      '<div style="margin-top:auto;padding:14px 10px 0" class="sub">Dados gravados neste navegador. Exporte um backup antes de trocar de máquina.</div>';

    lateral.querySelector('#menu').innerHTML = html;

    lateral.querySelectorAll('[data-rota]').forEach(function (botao) {
      botao.onclick = function () { ir(botao.dataset.rota); };
    });
    lateral.querySelector('#exportar').onclick = exportarBackup;
    lateral.querySelector('#importar').onclick = importarBackup;
    lateral.querySelector('#restaurar').onclick = function () {
      ui.confirmarAcao('Isto apaga todas as demandas e volta ao catálogo de exemplo. Continuar?', function () {
        TC.store.restaurarPadrao();
        ui.notificar('Dados restaurados.');
      });
    };
  }

  function exportarBackup() {
    var url = URL.createObjectURL(new Blob([TC.store.exportar()], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'testing-center-' + util.hoje() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    ui.notificar('Backup exportado.');
  }

  function importarBackup() {
    var campo = document.createElement('input');
    campo.type = 'file';
    campo.accept = 'application/json';
    campo.onchange = function () {
      var arquivo = campo.files[0];
      if (!arquivo) return;
      var leitor = new FileReader();
      leitor.onload = function () {
        try {
          TC.store.importar(String(leitor.result));
          ui.notificar('Backup importado.');
        } catch (erro) {
          ui.notificar('Arquivo inválido: ' + erro.message);
        }
      };
      leitor.readAsText(arquivo);
    };
    campo.click();
  }

  function ir(rota) {
    if (!util.porId(ROTAS, rota)) rota = 'catalogo';
    rotaAtual = rota;
    if (global.location.hash !== '#' + rota) global.location.hash = rota;
    global.scrollTo(0, 0);
    desenhar();
  }

  function desenhar() {
    var estado = TC.store.get();
    var hoje = util.hoje();
    var plano = TC.scheduler.planejar(estado, hoje);
    var ctx = {
      estado: estado,
      plano: plano,
      hoje: hoje,
      filtros: filtros,
      ir: ir,
      atualizar: desenhar
    };

    desenharNavegacao(estado, plano);
    TC.views[rotaAtual].render(document.getElementById('conteudo'), ctx);
  }

  function iniciar() {
    TC.store.init();
    TC.store.aoMudar(desenhar);
    var inicial = (global.location.hash || '').replace('#', '');
    rotaAtual = util.porId(ROTAS, inicial) ? inicial : 'catalogo';
    global.addEventListener('hashchange', function () {
      var alvo = (global.location.hash || '').replace('#', '');
      if (alvo && alvo !== rotaAtual) ir(alvo);
    });
    desenhar();
  }

  TC.app = { iniciar: iniciar, ir: ir, ROTAS: ROTAS };

  /* Em página embutida o documento já pode estar pronto quando este script roda. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
