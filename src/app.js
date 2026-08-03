/* Montagem da aplicação: navegação, recálculo do planejamento e backup dos dados. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  var ROTAS = [
    { id: 'catalogo', nome: 'Catálogo de testes', icone: '📋', grupo: 'Validação' },
    { id: 'cotacoes', nome: 'Cotações', icone: '💰', grupo: 'Validação' },
    { id: 'demandas', nome: 'Demandas', icone: '✅', grupo: 'Validação' },
    { id: 'planejamento', nome: 'Planejamento', icone: '📅', grupo: 'Validação' },
    { id: 'painel', nome: 'Painel', icone: '📊', grupo: 'Validação' },
    { id: 'clientes', nome: 'Clientes', icone: '🏢', grupo: 'Cadastros' },
    { id: 'equipamentos', nome: 'Equipamentos', icone: '⚙️', grupo: 'Cadastros' },
    { id: 'pecas', nome: 'Peças e amostras', icone: '🔩', grupo: 'Cadastros' },
    { id: 'calibracao', nome: 'Calibração', icone: '📏', grupo: 'Cadastros' },
    { id: 'permissoes', nome: 'Perfis e permissões', icone: '🔐', grupo: 'Administração' }
  ];

  /* fase filtra o catálogo por fase de aplicação do procedimento; tipoLti filtra
     demandas e planejamento pela classificação da LTI (inclui Cotação). */
  var filtros = {
    busca: '', clienteId: '', area: '', fase: '', tipoLti: '', status: '', equipamentoId: '',
    /* Filtros da janela de calibração. */
    buscaCal: '', localCal: '', marcaCal: '', situacaoCal: '', prazoCal: ''
  };
  var rotaAtual = 'catalogo';

  function contadores(estado, plano) {
    /* O contador da calibração mostra o que exige ação: vencido ou a vencer. */
    var cal = TC.calibracao.resumo(estado.instrumentos, util.hoje());
    var calibracaoPendente = cal.vencidos + cal.aVencer;
    return {
      catalogo: estado.testes.length,
      /* O contador mostra o que está em aberto no fluxo: ainda há algo a fazer enquanto
         a demanda não foi validada pelo cliente nem cancelada. */
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
    html += '<div class="perfil"><label for="seletor-perfil">Estou usando como</label>' +
      '<select id="seletor-perfil">' + ui.opcoes(TC.data.PERFIS, TC.permissoes.perfilAtual(estado)) + '</select>' +
      '<div class="descricao">' + e(perfil ? perfil.descricao : '') + '</div></div>';

    /* Na cópia publicada não há backup a exportar nem padrão a restaurar: o dado vive
       na máquina de quem mantém o centro de testes. Fica só a data do instantâneo, para
       ninguém tomar decisão em cima de um planejamento vencido sem perceber. */
    if (TC.permissoes.publicada()) {
      html += '<div style="margin-top:auto;padding:14px 10px 0" class="sub">' +
        '<strong>Cópia da equipe — somente leitura.</strong><br>' +
        'Dados de ' + e(util.formatarData(TC.PUBLICACAO.atualizadoEm, true)) + '. ' +
        'Para alterar catálogo, demandas ou cotações, fale com o centro de testes.</div>';
    } else {
      html += '<div class="nav-titulo">Dados</div>' +
        '<button class="nav-item" id="exportar"><span aria-hidden="true">⬇️</span>Exportar backup</button>' +
        '<button class="nav-item" id="importar"><span aria-hidden="true">⬆️</span>Importar backup</button>' +
        '<button class="nav-item" id="restaurar"><span aria-hidden="true">♻️</span>Restaurar padrão</button>' +
        '<div style="margin-top:auto;padding:14px 10px 0" class="sub">Dados gravados neste navegador. Exporte um backup antes de trocar de máquina.</div>';
    }

    lateral.querySelector('#menu').innerHTML = html;

    lateral.querySelectorAll('[data-rota]').forEach(function (botao) {
      botao.onclick = function () { ir(botao.dataset.rota); };
    });
    var seletor = lateral.querySelector('#seletor-perfil');
    seletor.onchange = function () {
      TC.store.definirPerfil(seletor.value);
      /* Trocar de perfil pode tirar a janela atual de vista. */
      if (!TC.permissoes.podeVer(TC.store.get(), rotaAtual)) ir(primeiraRotaVisivel());
    };
    if (TC.permissoes.publicada()) return;
    lateral.querySelector('#exportar').onclick = exportarBackup;
    lateral.querySelector('#importar').onclick = importarBackup;
    lateral.querySelector('#restaurar').onclick = function () {
      ui.confirmarAcao('Isto apaga todas as demandas e volta ao catálogo de exemplo. Continuar?', function () {
        TC.store.restaurarPadrao();
        ui.notificar('Dados restaurados.');
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

    /* Uma mudança de permissão pode tornar a janela aberta invisível. */
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

    /* Aviso discreto de somente leitura, para ninguém procurar um botão que não existe. */
    if (!ctx.podeEditar && rotaAtual !== 'painel') {
      var cabecalho = document.querySelector('#conteudo .cabecalho');
      if (cabecalho) {
        var acoes = cabecalho.querySelector('.acoes');
        if (!acoes) {
          acoes = document.createElement('div');
          acoes.className = 'acoes';
          cabecalho.appendChild(acoes);
        }
        acoes.appendChild(ui.el('<span class="somente-leitura">👁️ Somente leitura para ' +
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

  /* Em página embutida o documento já pode estar pronto quando este script roda. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
