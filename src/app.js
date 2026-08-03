/* Application shell: navigation, schedule recalculation and data backup. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  var ROTAS = [
    { id: 'catalogo', nome: 'Test catalogue', icone: '📋', grupo: 'Validation' },
    { id: 'cotacoes', nome: 'Quotes', icone: '💰', grupo: 'Validation' },
    { id: 'demandas', nome: 'Requests', icone: '✅', grupo: 'Validation' },
    { id: 'planejamento', nome: 'Schedule', icone: '📅', grupo: 'Validation' },
    { id: 'painel', nome: 'Dashboard', icone: '📊', grupo: 'Validation' },
    { id: 'clientes', nome: 'Customers', icone: '🏢', grupo: 'Registers' },
    { id: 'equipamentos', nome: 'Equipment', icone: '⚙️', grupo: 'Registers' },
    { id: 'pecas', nome: 'Parts and samples', icone: '🔩', grupo: 'Registers' },
    { id: 'calibracao', nome: 'Calibration', icone: '📏', grupo: 'Registers' },
    { id: 'permissoes', nome: 'Roles and permissions', icone: '🔐', grupo: 'Administration' }
  ];

  /* fase filters the catalogue by the procedure's application phase; tipoLti filters
     requests and schedule by the LTI classification (Quote included). */
  var filtros = {
    busca: '', clienteId: '', area: '', fase: '', tipoLti: '', status: '', equipamentoId: '',
    /* Calibration screen filters. */
    buscaCal: '', localCal: '', marcaCal: '', situacaoCal: '', prazoCal: ''
  };
  var rotaAtual = 'catalogo';

  function contadores(estado, plano) {
    /* The calibration counter shows what needs action: expired or due soon. */
    var cal = TC.calibracao.resumo(estado.instrumentos, util.hoje());
    var calibracaoPendente = cal.vencidos + cal.aVencer;
    return {
      catalogo: estado.testes.length,
      /* The counter shows what is still open in the workflow: there is something left to do
         until the request has been signed off by the customer or cancelled. */
      demandas: estado.demandas.filter(function (d) {
        return ['VALIDADA', 'CANCELADA'].indexOf(d.status) === -1;
      }).length,
      planejamento: plano.agendadas.length,
      cotacoes: estado.cotacoes.length,
      clientes: estado.clientes.length,
      equipamentos: estado.equipamentos.length,
      pecas: estado.pecas.length,
      calibracao: calibracaoPendente
    };
  }

  function desenharNavegacao(estado, plano) {
    var lateral = document.getElementById('lateral');
    var contas = contadores(estado, plano);
    var grupoAtual = '';
    var html = '';
    ROTAS.filter(function (r) { return TC.permissoes.podeVer(estado, r.id); }).forEach(function (r) {
      if (r.grupo !== grupoAtual) {
        grupoAtual = r.grupo;
        html += '<div class="nav-titulo">' + e(grupoAtual) + '</div>';
      }
      html += '<button class="nav-item' + (r.id === rotaAtual ? ' ativo' : '') + '" data-rota="' + e(r.id) + '">' +
        '<span aria-hidden="true">' + r.icone + '</span>' + e(r.nome) +
        (contas[r.id] !== undefined ? '<span class="contador">' + contas[r.id] + '</span>' : '') +
        '</button>';
    });
    var perfil = util.porId(TC.data.PERFIS, TC.permissoes.perfilAtual(estado));
    html += '<div class="perfil"><label for="seletor-perfil">I am working as</label>' +
      '<select id="seletor-perfil">' + ui.opcoes(TC.data.PERFIS, TC.permissoes.perfilAtual(estado)) + '</select>' +
      '<div class="descricao">' + e(perfil ? perfil.descricao : '') + '</div></div>';

    /* The published copy has no backup to export and no defaults to restore: the data lives
       on the machine of whoever keeps the test centre. Only the snapshot date stays, so that
       nobody decides on top of a stale schedule without noticing. */
    if (TC.permissoes.publicada()) {
      html += '<div style="margin-top:auto;padding:14px 10px 0" class="sub">' +
        '<strong>Team copy — read only.</strong><br>' +
        'Data as of ' + e(util.formatarData(TC.PUBLICACAO.atualizadoEm, true)) + '. ' +
        'To change the catalogue, requests or quotes, talk to the test centre.</div>';
    } else {
      html += '<div class="nav-titulo">Data</div>' +
        '<button class="nav-item" id="exportar"><span aria-hidden="true">⬇️</span>Export backup</button>' +
        '<button class="nav-item" id="importar"><span aria-hidden="true">⬆️</span>Import backup</button>' +
        '<button class="nav-item" id="restaurar"><span aria-hidden="true">♻️</span>Restore defaults</button>' +
        '<div style="margin-top:auto;padding:14px 10px 0" class="sub">Data is saved in this browser. Export a backup before switching machines.</div>';
    }

    lateral.querySelector('#menu').innerHTML = html;

    lateral.querySelectorAll('[data-rota]').forEach(function (botao) {
      botao.onclick = function () { ir(botao.dataset.rota); };
    });
    var seletor = lateral.querySelector('#seletor-perfil');
    seletor.onchange = function () {
      TC.store.definirPerfil(seletor.value);
      /* Switching roles can take the current screen out of sight. */
      if (!TC.permissoes.podeVer(TC.store.get(), rotaAtual)) ir(primeiraRotaVisivel());
    };
    if (TC.permissoes.publicada()) return;
    lateral.querySelector('#exportar').onclick = exportarBackup;
    lateral.querySelector('#importar').onclick = importarBackup;
    lateral.querySelector('#restaurar').onclick = function () {
      ui.confirmarAcao('This erases every request and goes back to the seed catalogue. Continue?', function () {
        TC.store.restaurarPadrao();
        ui.notificar('Data restored.');
      });
    };
  }

  function primeiraRotaVisivel() {
    var estado = TC.store.get();
    for (var i = 0; i < ROTAS.length; i++) {
      if (TC.permissoes.podeVer(estado, ROTAS[i].id)) return ROTAS[i].id;
    }
    return 'catalogo';
  }

  function exportarBackup() {
    var url = URL.createObjectURL(new Blob([TC.store.exportar()], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'testing-center-' + util.hoje() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    ui.notificar('Backup exported.');
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
          ui.notificar('Backup imported.');
        } catch (erro) {
          ui.notificar('Invalid file: ' + erro.message);
        }
      };
      leitor.readAsText(arquivo);
    };
    campo.click();
  }

  function ir(rota) {
    if (!util.porId(ROTAS, rota)) rota = 'catalogo';
    if (!TC.permissoes.podeVer(TC.store.get(), rota)) rota = primeiraRotaVisivel();
    rotaAtual = rota;
    if (global.location.hash !== '#' + rota) global.location.hash = rota;
    global.scrollTo(0, 0);
    desenhar();
  }

  function desenhar() {
    var estado = TC.store.get();
    var hoje = util.hoje();
    var plano = TC.scheduler.planejar(estado, hoje);

    /* A permission change can make the screen currently open invisible. */
    if (!TC.permissoes.podeVer(estado, rotaAtual)) rotaAtual = primeiraRotaVisivel();

    var ctx = {
      estado: estado,
      plano: plano,
      hoje: hoje,
      filtros: filtros,
      ir: ir,
      atualizar: desenhar,
      podeEditar: TC.permissoes.podeEditar(estado, rotaAtual)
    };

    desenharNavegacao(estado, plano);
    TC.views[rotaAtual].render(document.getElementById('conteudo'), ctx);

    /* A discreet read-only badge, so nobody hunts for a button that is not there. */
    if (!ctx.podeEditar && rotaAtual !== 'painel') {
      var cabecalho = document.querySelector('#conteudo .cabecalho');
      if (cabecalho) {
        var acoes = cabecalho.querySelector('.acoes');
        if (!acoes) {
          acoes = document.createElement('div');
          acoes.className = 'acoes';
          cabecalho.appendChild(acoes);
        }
        acoes.appendChild(ui.el('<span class="somente-leitura">👁️ Read only for ' +
          e(TC.permissoes.nomeDoPerfil(TC.permissoes.perfilAtual(estado))) + '</span>'));
      }
    }
  }

  function iniciar() {
    TC.store.init();
    TC.store.aoMudar(desenhar);
    var inicial = (global.location.hash || '').replace('#', '');
    rotaAtual = util.porId(ROTAS, inicial) ? inicial : 'catalogo';
    if (!TC.permissoes.podeVer(TC.store.get(), rotaAtual)) rotaAtual = primeiraRotaVisivel();
    global.addEventListener('hashchange', function () {
      var alvo = (global.location.hash || '').replace('#', '');
      if (alvo && alvo !== rotaAtual) ir(alvo);
    });
    desenhar();
  }

  TC.app = { iniciar: iniciar, ir: ir, ROTAS: ROTAS };

  /* On an embedded page the document may already be ready when this script runs. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
