/* Estado da aplicação: persistência em localStorage, CRUD e exportação/importação. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util;

  var CHAVE = 'testing-center/v1';
  var estado = null;
  var ouvintes = [];

  /* Converte dados gravados por versões anteriores. */
  function migrar(estado) {
    var antigas = TC.data.FASES_ANTIGAS;
    var validas = TC.data.FASES.map(function (f) { return f.id; });

    function converter(fase) {
      if (validas.indexOf(fase) !== -1) return fase;
      return antigas[fase] || null;
    }

    /* A data de chegada das amostras saiu da peça e foi para a demanda; guardamos a
       data antiga de cada peça para não perder o que já estava planejado. */
    var dataAntigaDaPeca = {};
    (estado.pecas || []).forEach(function (p) {
      if (p.dataAmostras) dataAntigaDaPeca[p.id] = p.dataAmostras;
      /* Peça deixou de ser de um cliente e de uma área: é um tipo de peça. */
      delete p.clienteId;
      delete p.area;
      delete p.programa;
      delete p.dataAmostras;
      delete p.quantidade;
    });

    /* O procedimento não é mais amarrado a fase de projeto. */
    (estado.testes || []).forEach(function (t) {
      delete t.fases;
      if (typeof t.revisao !== 'string') t.revisao = '';
    });

    /* Antes da LTI, a demanda guardava só a fase; ela vira a classificação da ordem
       de serviço, e o número fica em branco para ser preenchido. */
    (estado.demandas || []).forEach(function (d) {
      var tipos = TC.data.TIPOS_LTI.map(function (t) { return t.id; });
      if (!d.tipoLti || tipos.indexOf(d.tipoLti) === -1) {
        d.tipoLti = converter(d.fase) || validas[0];
      }
      if (typeof d.lti !== 'string') d.lti = '';
      if (!d.dataAmostras) d.dataAmostras = dataAntigaDaPeca[d.pecaId] || util.hoje();
      delete d.fase;
    });

    return estado;
  }

  function carregar() {
    try {
      var bruto = global.localStorage && global.localStorage.getItem(CHAVE);
      if (bruto) {
        var lido = JSON.parse(bruto);
        if (lido && lido.testes && lido.equipamentos) return migrar(lido);
      }
    } catch (e) {
      console.warn('Não foi possível ler os dados salvos, recomeçando do catálogo padrão.', e);
    }
    return TC.data.seed();
  }

  function salvar() {
    try {
      if (global.localStorage) global.localStorage.setItem(CHAVE, JSON.stringify(estado));
    } catch (e) {
      console.warn('Não foi possível salvar no navegador.', e);
    }
  }

  function notificar() {
    ouvintes.forEach(function (fn) { fn(estado); });
  }

  function commit() {
    salvar();
    notificar();
  }

  var store = {
    init: function () {
      estado = carregar();
      return estado;
    },
    get: function () { return estado; },
    aoMudar: function (fn) { ouvintes.push(fn); },

    /* ---- Demandas ---- */
    criarDemanda: function (dados) {
      var demanda = {
        id: util.id('DM'),
        testeId: dados.testeId,
        pecaId: dados.pecaId,
        clienteId: dados.clienteId,
        lti: (dados.lti || '').trim(),
        tipoLti: dados.tipoLti || 'DV',
        prioridade: dados.prioridade || 'MEDIA',
        quantidade: Number(dados.quantidade) || 1,
        dataAmostras: dados.dataAmostras || util.hoje(),
        prazo: dados.prazo || '',
        inicioFixo: dados.inicioFixo || '',
        observacao: dados.observacao || '',
        status: 'PENDENTE',
        criadoEm: util.hoje()
      };
      estado.demandas.push(demanda);
      commit();
      return demanda;
    },
    atualizarDemanda: function (id, campos) {
      var d = util.porId(estado.demandas, id);
      if (!d) return null;
      Object.keys(campos).forEach(function (k) { d[k] = campos[k]; });
      commit();
      return d;
    },
    removerDemanda: function (id) {
      estado.demandas = estado.demandas.filter(function (d) { return d.id !== id; });
      commit();
    },

    /* ---- Catálogo de testes ---- */
    salvarTeste: function (teste) {
      var existente = teste.id ? util.porId(estado.testes, teste.id) : null;
      if (existente) {
        Object.keys(teste).forEach(function (k) { existente[k] = teste[k]; });
      } else {
        teste.id = teste.id || util.id('TP');
        estado.testes.push(teste);
      }
      commit();
      return teste;
    },
    removerTeste: function (id) {
      estado.testes = estado.testes.filter(function (t) { return t.id !== id; });
      estado.demandas = estado.demandas.filter(function (d) { return d.testeId !== id; });
      commit();
    },

    /* ---- Equipamentos ---- */
    salvarEquipamento: function (equipamento) {
      var existente = equipamento.id ? util.porId(estado.equipamentos, equipamento.id) : null;
      if (existente) {
        Object.keys(equipamento).forEach(function (k) { existente[k] = equipamento[k]; });
      } else {
        equipamento.manutencao = equipamento.manutencao || [];
        estado.equipamentos.push(equipamento);
      }
      commit();
      return equipamento;
    },
    removerEquipamento: function (id) {
      estado.equipamentos = estado.equipamentos.filter(function (e) { return e.id !== id; });
      commit();
    },
    adicionarManutencao: function (equipamentoId, janela) {
      var eq = util.porId(estado.equipamentos, equipamentoId);
      if (!eq) return;
      eq.manutencao = eq.manutencao || [];
      eq.manutencao.push({ id: util.id('MN'), inicio: janela.inicio, fim: janela.fim, motivo: janela.motivo || 'Manutenção' });
      commit();
    },
    removerManutencao: function (equipamentoId, janelaId) {
      var eq = util.porId(estado.equipamentos, equipamentoId);
      if (!eq) return;
      eq.manutencao = (eq.manutencao || []).filter(function (m) { return m.id !== janelaId; });
      commit();
    },

    /* ---- Peças ---- */
    salvarPeca: function (peca) {
      var existente = peca.id ? util.porId(estado.pecas, peca.id) : null;
      if (existente) {
        Object.keys(peca).forEach(function (k) { existente[k] = peca[k]; });
      } else {
        peca.id = peca.id || util.id('PC');
        estado.pecas.push(peca);
      }
      commit();
      return peca;
    },
    removerPeca: function (id) {
      estado.pecas = estado.pecas.filter(function (p) { return p.id !== id; });
      commit();
    },

    /* ---- Clientes ---- */
    salvarCliente: function (cliente) {
      var existente = cliente.id ? util.porId(estado.clientes, cliente.id) : null;
      if (existente) {
        Object.keys(cliente).forEach(function (k) { existente[k] = cliente[k]; });
      } else {
        cliente.id = cliente.id || util.id('CLI');
        estado.clientes.push(cliente);
      }
      commit();
      return cliente;
    },
    removerCliente: function (id) {
      estado.clientes = estado.clientes.filter(function (c) { return c.id !== id; });
      /* O cliente sai também das listas de exigência dos procedimentos, senão o
         catálogo passa a filtrar por um cliente que não existe mais. */
      estado.testes.forEach(function (t) {
        if (t.clientes) t.clientes = t.clientes.filter(function (c) { return c !== id; });
      });
      commit();
    },

    /* ---- Backup ---- */
    exportar: function () {
      return JSON.stringify(estado, null, 2);
    },
    importar: function (texto) {
      var lido = JSON.parse(texto);
      if (!lido.testes || !lido.equipamentos) throw new Error('Arquivo sem catálogo de testes ou equipamentos.');
      lido.demandas = lido.demandas || [];
      lido.pecas = lido.pecas || [];
      lido.clientes = lido.clientes || [];
      estado = migrar(lido);
      commit();
    },
    restaurarPadrao: function () {
      estado = TC.data.seed();
      commit();
    }
  };

  TC.store = store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
