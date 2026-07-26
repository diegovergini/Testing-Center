/* Testing Center — estado da aplicação, persistência local e replanejamento automático.
   Toda mutação de demandas ou equipamentos dispara um novo planejamento: é isso que faz
   "confirmar a necessidade de um ensaio" cair sozinho na agenda. */
(function (root) {
  'use strict';
  var util = root.TC.util;
  var seed = root.TC.seed;
  var scheduler = root.TC.scheduler;

  var CHAVE = 'testing-center:v1';
  var ouvintes = [];

  var estado = null;
  var plano = null;

  function estadoInicial() {
    var dataBase = util.hojeISO();
    return {
      versao: 1,
      dataBase: dataBase,
      horizonteDias: 540,
      catalogo: seed.montarCatalogo(),
      equipamentos: seed.resolverEquipamentos(dataBase),
      demandas: seed.demandasIniciais(dataBase),
      sequencia: 11
    };
  }

  function carregar() {
    var bruto = null;
    try { bruto = root.localStorage.getItem(CHAVE); } catch (e) { bruto = null; }
    if (bruto) {
      try {
        var salvo = JSON.parse(bruto);
        if (salvo && salvo.versao === 1 && Array.isArray(salvo.demandas)) {
          estado = salvo;
          // O catálogo é código, não dado do usuário: sempre remontado a partir da semente.
          estado.catalogo = seed.montarCatalogo();
          replanejar();
          return estado;
        }
      } catch (e) { /* base corrompida: recomeça da semente */ }
    }
    estado = estadoInicial();
    replanejar();
    return estado;
  }

  function salvar() {
    try {
      root.localStorage.setItem(CHAVE, JSON.stringify({
        versao: estado.versao,
        dataBase: estado.dataBase,
        horizonteDias: estado.horizonteDias,
        equipamentos: estado.equipamentos,
        demandas: estado.demandas,
        sequencia: estado.sequencia
      }));
    } catch (e) { /* modo privado / cota cheia: segue em memória */ }
  }

  function replanejar() {
    plano = scheduler.planejar({
      demandas: estado.demandas,
      equipamentos: estado.equipamentos,
      catalogo: estado.catalogo,
      dataBase: estado.dataBase,
      horizonteDias: estado.horizonteDias
    });
    return plano;
  }

  function notificar(evento) {
    ouvintes.forEach(function (fn) { fn(estado, plano, evento || {}); });
  }

  function confirmar(alteracao, evento) {
    alteracao();
    replanejar();
    salvar();
    notificar(evento);
  }

  /* ---- API pública ---- */

  function subscrever(fn) {
    ouvintes.push(fn);
    return function () { ouvintes = ouvintes.filter(function (f) { return f !== fn; }); };
  }

  function getEstado() { return estado; }
  function getPlano() { return plano; }

  function proximoId() {
    var n = estado.sequencia++;
    return 'DEM-' + String(n).padStart(4, '0');
  }

  /* Recebe a confirmação de necessidade vinda do catálogo e cria as demandas. */
  function confirmarNecessidade(itens) {
    var criadas = [];
    confirmar(function () {
      itens.forEach(function (item) {
        var teste = estado.catalogo.filter(function (t) { return t.id === item.testeId; })[0];
        if (!teste) return;
        var demanda = {
          id: proximoId(),
          testeId: item.testeId,
          projeto: item.projeto || 'Sem projeto',
          peca: item.peca || (teste.pecas && teste.pecas[0]) || '',
          fase: item.fase || teste.fases[0],
          amostras: Math.max(1, Number(item.amostras) || teste.amostrasPadrao || 1),
          dataPecaDisponivel: item.dataPecaDisponivel || estado.dataBase,
          dataAlvo: item.dataAlvo || '',
          prioridade: item.prioridade || 'Média',
          solicitante: item.solicitante || '',
          obs: item.obs || '',
          status: 'Confirmada',
          criadoEm: util.hojeISO()
        };
        estado.demandas.push(demanda);
        criadas.push(demanda);
      });
    }, { tipo: 'demandas-criadas', ids: criadas.map(function (d) { return d.id; }) });
    return criadas;
  }

  function atualizarDemanda(id, campos) {
    confirmar(function () {
      estado.demandas = estado.demandas.map(function (d) {
        return d.id === id ? Object.assign({}, d, campos) : d;
      });
    }, { tipo: 'demanda-atualizada', ids: [id] });
  }

  function removerDemanda(id) {
    confirmar(function () {
      estado.demandas = estado.demandas.filter(function (d) { return d.id !== id; });
    }, { tipo: 'demanda-removida', ids: [id] });
  }

  function atualizarEquipamento(id, campos) {
    confirmar(function () {
      estado.equipamentos = estado.equipamentos.map(function (e) {
        return e.id === id ? Object.assign({}, e, campos) : e;
      });
    }, { tipo: 'equipamento-atualizado', ids: [id] });
  }

  function adicionarManutencao(equipId, janela) {
    confirmar(function () {
      estado.equipamentos = estado.equipamentos.map(function (e) {
        if (e.id !== equipId) return e;
        var lista = (e.manutencao || []).concat([janela]).sort(function (a, b) {
          return a.inicio < b.inicio ? -1 : 1;
        });
        return Object.assign({}, e, { manutencao: lista });
      });
    }, { tipo: 'manutencao-adicionada', ids: [equipId] });
  }

  function removerManutencao(equipId, indice) {
    confirmar(function () {
      estado.equipamentos = estado.equipamentos.map(function (e) {
        if (e.id !== equipId) return e;
        var lista = (e.manutencao || []).filter(function (_, i) { return i !== indice; });
        return Object.assign({}, e, { manutencao: lista });
      });
    }, { tipo: 'manutencao-removida', ids: [equipId] });
  }

  function definirDataBase(iso) {
    confirmar(function () { estado.dataBase = iso; }, { tipo: 'data-base' });
  }

  function restaurarSemente() {
    confirmar(function () { estado = estadoInicial(); }, { tipo: 'reset' });
  }

  function importar(json) {
    var dados = typeof json === 'string' ? JSON.parse(json) : json;
    if (!dados || !Array.isArray(dados.demandas)) throw new Error('Arquivo sem lista de demandas.');
    confirmar(function () {
      estado.demandas = dados.demandas;
      if (Array.isArray(dados.equipamentos)) estado.equipamentos = dados.equipamentos;
      if (dados.dataBase) estado.dataBase = dados.dataBase;
      estado.sequencia = Math.max(estado.sequencia, (dados.sequencia || 0));
    }, { tipo: 'importado' });
  }

  function exportar() {
    return JSON.stringify({
      versao: estado.versao,
      dataBase: estado.dataBase,
      horizonteDias: estado.horizonteDias,
      equipamentos: estado.equipamentos,
      demandas: estado.demandas,
      sequencia: estado.sequencia
    }, null, 2);
  }

  root.TC.store = {
    carregar: carregar,
    subscrever: subscrever,
    getEstado: getEstado,
    getPlano: getPlano,
    confirmarNecessidade: confirmarNecessidade,
    atualizarDemanda: atualizarDemanda,
    removerDemanda: removerDemanda,
    atualizarEquipamento: atualizarEquipamento,
    adicionarManutencao: adicionarManutencao,
    removerManutencao: removerManutencao,
    definirDataBase: definirDataBase,
    restaurarSemente: restaurarSemente,
    importar: importar,
    exportar: exportar
  };
})(typeof self !== 'undefined' ? self : this);
