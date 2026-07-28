/* Estado da aplicação: persistência em localStorage, CRUD e exportação/importação. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util;
  /* No navegador o scheduler já foi carregado; no Node (testes) resolvemos na hora. */
  var scheduler = TC.scheduler || (typeof require !== 'undefined' ? require('./scheduler.js') : null);

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

    /* O procedimento não é mais amarrado a fase de projeto, e pode ocupar
       mais de uma bancada ao mesmo tempo. */
    (estado.testes || []).forEach(function (t) {
      delete t.fases;
      if (typeof t.revisao !== 'string') t.revisao = '';
      /* As unidades que o procedimento apontava ainda servem para herdar o hourly rate
         antigo, então guardamos antes de trocá-las pelo grupo. */
      var unidadesAntigas = t.equipamentoIds || (t.equipamentoId ? [t.equipamentoId] : []);

      /* O procedimento passou a pedir o grupo de bancada, não a unidade. */
      if (!t.equipamentoGrupos) {
        var grupos = [];
        unidadesAntigas.forEach(function (id) {
          var eq = util.porId(estado.equipamentos || [], id);
          var grupo = eq ? scheduler.grupoDe(eq) : id;
          if (grupos.indexOf(grupo) === -1) grupos.push(grupo);
        });
        t.equipamentoGrupos = grupos;
      }
      delete t.equipamentoIds;
      delete t.equipamentoId;

      /* O custo passou a ser horas x hourly rate + insumos. Sem hourly rate gravado,
         herdamos a soma do custo-hora das bancadas do ensaio, que era o que valia antes. */
      if (typeof t.horasReport !== 'number') t.horasReport = 0;
      if (typeof t.hourlyRate !== 'number') {
        t.hourlyRate = unidadesAntigas.reduce(function (soma, id) {
          var eq = util.porId(estado.equipamentos || [], id);
          return soma + (eq && eq.custoHora ? eq.custoHora : 0);
        }, 0);
      }
      if (typeof t.custoInsumos !== 'number') t.custoInsumos = t.custoBase || 0;
      delete t.custoBase;
    });

    /* Antes da LTI, a demanda guardava só a fase; ela vira a classificação da ordem
       de serviço, e o número fica em branco para ser preenchido. */
    (estado.demandas || []).forEach(function (d) {
      var tipos = TC.data.TIPOS_LTI.map(function (t) { return t.id; });
      if (!d.tipoLti || tipos.indexOf(d.tipoLti) === -1) {
        d.tipoLti = converter(d.fase) || validas[0];
      }
      if (typeof d.lti !== 'string') d.lti = '';
      if (typeof d.projeto !== 'string') d.projeto = '';
      if (typeof d.partNumber !== 'string') d.partNumber = '';
      if (!d.dataAmostras) d.dataAmostras = dataAntigaDaPeca[d.pecaId] || util.hoje();
      delete d.fase;
    });

    /* Perfis, permissões e cotações chegaram depois; estados antigos ganham o padrão. */
    if (!Array.isArray(estado.cotacoes)) estado.cotacoes = [];
    estado.cotacoes.forEach(function (c) {
      if (typeof c.lti !== 'string') c.lti = '';
      if (typeof c.previsaoExecucao !== 'string') c.previsaoExecucao = '';
      /* A peça de referência saiu; o item passou a guardar a quantidade em "amostras".
         Os totais gravados não são recalculados: cotação arquivada tem preço congelado. */
      delete c.pecaId;
      (c.itens || []).forEach(function (i) {
        if (typeof i.amostras !== 'number' || i.quantidade !== undefined) {
          i.amostras = i.quantidade || i.amostras || 1;
        }
        delete i.quantidade;
      });
    });
    var padrao = TC.data.PERMISSOES_PADRAO;
    var permissoes = estado.permissoes || {};
    Object.keys(padrao).forEach(function (rota) {
      var atual = permissoes[rota];
      permissoes[rota] = {
        ver: Array.isArray(atual && atual.ver) ? atual.ver : padrao[rota].ver.slice(),
        editar: Array.isArray(atual && atual.editar) ? atual.editar : padrao[rota].editar.slice()
      };
    });
    estado.permissoes = permissoes;

    var perfisValidos = TC.data.PERFIS.map(function (p) { return p.id; });
    if (perfisValidos.indexOf(estado.perfilAtual) === -1) estado.perfilAtual = 'TESTES';

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
        projeto: (dados.projeto || '').trim(),
        partNumber: (dados.partNumber || '').trim(),
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

    /* ---- Perfil e permissões ---- */
    definirPerfil: function (perfilId) {
      estado.perfilAtual = perfilId;
      commit();
    },
    /* editar implica ver: quem edita precisa enxergar a janela. */
    definirPermissao: function (rota, acao, perfilId, permitido) {
      var regra = estado.permissoes[rota];
      if (!regra) return;
      function ligar(lista, ligado) {
        var i = lista.indexOf(perfilId);
        if (ligado && i === -1) lista.push(perfilId);
        if (!ligado && i !== -1) lista.splice(i, 1);
      }
      ligar(regra[acao], permitido);
      if (acao === 'editar' && permitido) ligar(regra.ver, true);
      if (acao === 'ver' && !permitido) ligar(regra.editar, false);
      commit();
    },
    restaurarPermissoes: function () {
      estado.permissoes = JSON.parse(JSON.stringify(TC.data.PERMISSOES_PADRAO));
      commit();
    },

    /* ---- Cotações ---- */
    proximoNumeroCotacao: function () {
      var ano = util.hoje().slice(0, 4);
      var prefixo = 'COT-' + ano + '-';
      var maior = 0;
      estado.cotacoes.forEach(function (c) {
        if (c.numero && c.numero.indexOf(prefixo) === 0) {
          var n = parseInt(c.numero.slice(prefixo.length), 10);
          if (!isNaN(n) && n > maior) maior = n;
        }
      });
      return prefixo + String(maior + 1).padStart(4, '0');
    },
    salvarCotacao: function (cotacao) {
      var existente = cotacao.id ? util.porId(estado.cotacoes, cotacao.id) : null;
      if (existente) {
        Object.keys(cotacao).forEach(function (k) { existente[k] = cotacao[k]; });
        commit();
        return existente;
      }
      cotacao.id = util.id('COT');
      cotacao.numero = cotacao.numero || store.proximoNumeroCotacao();
      cotacao.criadoEm = cotacao.criadoEm || util.hoje();
      cotacao.status = cotacao.status || 'ABERTA';
      estado.cotacoes.push(cotacao);
      commit();
      return cotacao;
    },
    removerCotacao: function (id) {
      estado.cotacoes = estado.cotacoes.filter(function (c) { return c.id !== id; });
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
      lido.cotacoes = lido.cotacoes || [];
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
