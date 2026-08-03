/* Application state: localStorage persistence, CRUD and export/import. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util;
  /* In the browser these modules are already loaded; on Node (tests) we resolve them here. */
  var scheduler = TC.scheduler || (typeof require !== 'undefined' ? require('./scheduler.js') : null);
  if (!TC.fluxo && typeof require !== 'undefined') require('./fluxo.js');
  if (!TC.manutencao && typeof require !== 'undefined') require('./manutencao.js');
  if (!TC.calibracao && typeof require !== 'undefined') require('./calibracao.js');
  if (!TC.permissoes && typeof require !== 'undefined') require('./permissoes.js');

  var CHAVE = 'testing-center/v1';
  var estado = null;
  var ouvintes = [];

  /* Converts data saved by earlier versions. */
  function migrar(estado) {
    var antigas = TC.data.FASES_ANTIGAS;
    var validas = TC.data.FASES.map(function (f) { return f.id; });

    function converter(fase) {
      if (validas.indexOf(fase) !== -1) return fase;
      return antigas[fase] || null;
    }

    estado.clientes = estado.clientes || [];

    /* Test centre hourly rate: a single value for the whole catalogue. Data saved before
       this change carried the rate on each procedure; we take the test centre's current
       value, which is what now applies to all of them. */
    if (typeof estado.hourlyRate !== 'number') estado.hourlyRate = TC.data.HOURLY_RATE;
    if (typeof estado.hourlyRateVigencia !== 'string') {
      estado.hourlyRateVigencia = TC.data.HOURLY_RATE_VIGENCIA;
    }

    /* Catalogue change on data already saved in the browser.
       Up to version 2 the catalogue was the multi-customer example: it goes out whole. From
       there on the update is additive — new procedures go in and the existing ones stay as
       they are, with the hours and rig already filled in. Archived quotes are never touched:
       they have frozen prices. */
    var versaoSalva = Number(estado.catalogoVersao) || 0;
    if (versaoSalva < TC.data.CATALOGO_VERSAO) {
      var padraoNovo = TC.data.seed();
      estado.testes = estado.testes || [];
      if (versaoSalva < 2) estado.testes = [];
      padraoNovo.testes.forEach(function (t) {
        var salvo = util.porId(estado.testes, t.id);
        if (!salvo) { estado.testes.push(t); return; }

        /* Test centre hours survey: a procedure with no hours measured yet inherits the ones
           from the seed catalogue. If anyone has already filled in any of the three, the
           record is theirs and stays as it is. */
        var semHoras = !salvo.horasSetup && !salvo.horasEnsaio && !salvo.horasReport;
        var padraoTemHoras = t.horasSetup || t.horasEnsaio || t.horasReport;
        if (semHoras && padraoTemHoras) {
          salvo.horasSetup = t.horasSetup;
          salvo.horasEnsaio = t.horasEnsaio;
          salvo.horasReport = t.horasReport;
        }
      });

      /* The customers the new catalogue requires have to exist in the saved register, or the
         catalogue points at a customer that is not on the list. */
      var exigidos = {};
      estado.testes.forEach(function (t) {
        (t.clientes || []).forEach(function (id) { exigidos[id] = true; });
      });
      padraoNovo.clientes.forEach(function (c) {
        if (exigidos[c.id] && !util.porId(estado.clientes, c.id)) estado.clientes.push(c);
      });

      /* The procedure is the request's reference: without it the request has neither cost nor
         rig. It only discards something when the catalogue has lost procedures. */
      var idsDoCatalogo = estado.testes.map(function (t) { return t.id; });
      estado.demandas = (estado.demandas || []).filter(function (d) {
        return idsDoCatalogo.indexOf(d.testeId) !== -1;
      });
      estado.catalogoVersao = TC.data.CATALOGO_VERSAO;
    }

    /* The sample arrival date moved from the part type to the request; we keep each part
       type's old date so nothing already scheduled is lost. */
    var dataAntigaDaPeca = {};
    (estado.pecas || []).forEach(function (p) {
      if (p.dataAmostras) dataAntigaDaPeca[p.id] = p.dataAmostras;
      /* A part stopped belonging to a customer and a system end: it is a part type. */
      delete p.clienteId;
      delete p.area;
      delete p.programa;
      delete p.dataAmostras;
      delete p.quantidade;
    });

    /* The procedure is no longer tied to a project phase, and it can occupy more than one
       rig at the same time. */
    (estado.testes || []).forEach(function (t) {
      delete t.fases;
      if (typeof t.revisao !== 'string') t.revisao = '';
      var unidadesAntigas = t.equipamentoIds || (t.equipamentoId ? [t.equipamentoId] : []);

      /* The procedure now asks for the rig group, not the unit. */
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

      /* The hourly rate stopped being a procedure field: it became a single test centre
         value, kept in the state and updated once a year. */
      if (typeof t.horasReport !== 'number') t.horasReport = 0;
      delete t.hourlyRate;
      if (typeof t.custoInsumos !== 'number') t.custoInsumos = t.custoBase || 0;
      delete t.custoBase;
    });

    /* Inventory of instruments subject to calibration. Same mechanics as the catalogue: a
       new instrument goes in, and an existing one keeps the calibration plan the lab filled
       in. */
    estado.instrumentos = estado.instrumentos || [];
    if ((Number(estado.instrumentosVersao) || 0) < TC.data.INSTRUMENTOS_VERSAO) {
      TC.instrumentosPadrao().forEach(function (i) {
        var salvo = util.porId(estado.instrumentos, i.id);
        if (!salvo) {
          estado.instrumentos.push(i);
          return;
        }
        /* Version 2 brought each instrument's last calibration, which the original inventory
           did not have. It only fills gaps: whoever entered the date through the screen knows
           more than the spreadsheet, and the calibration history is never rewritten. */
        if (!salvo.ultimaCalibracao && i.ultimaCalibracao && !(salvo.historico || []).length) {
          salvo.ultimaCalibracao = i.ultimaCalibracao;
        }
      });
      estado.instrumentosVersao = TC.data.INSTRUMENTOS_VERSAO;
    }
    /* Documents came later: requests and instruments gain the attachment list, empty for
       whoever already had saved data. */
    (estado.demandas || []).forEach(function (d) {
      if (!Array.isArray(d.documentos)) d.documentos = [];
    });

    estado.instrumentos.forEach(function (i) {
      if (!Array.isArray(i.documentos)) i.documentos = [];
      if (typeof i.periodicidadeMeses !== 'number') i.periodicidadeMeses = 12;
      if (typeof i.ultimaCalibracao !== 'string') i.ultimaCalibracao = '';
      if (typeof i.proximaCalibracao !== 'string') i.proximaCalibracao = '';
      if (typeof i.certificado !== 'string') i.certificado = '';
      if (typeof i.laboratorio !== 'string') i.laboratorio = '';
      if (typeof i.observacao !== 'string') i.observacao = '';
      if (typeof i.ultimoResultado !== 'string') i.ultimoResultado = '';
      if (typeof i.situacao !== 'string') i.situacao = 'EM_USO';
      if (typeof i.ativo !== 'boolean') i.ativo = true;
      if (!Array.isArray(i.historico)) i.historico = [];
    });

    /* Maintenance downtime gained two lives: planned and carried out, with the record of
       what was done. An old downtime that has already ended goes in as carried out — it
       happened — and one still to come stays planned. */
    (estado.equipamentos || []).forEach(function (eq) {
      (eq.manutencao || []).forEach(function (m) {
        if (typeof m.tipo !== 'string') m.tipo = 'PREVENTIVA';
        if (typeof m.oQueFoiFeito !== 'string') m.oQueFoiFeito = '';
        if (typeof m.responsavel !== 'string') m.responsavel = '';
        if (typeof m.situacao !== 'string') {
          m.situacao = util.diffDias(util.hoje(), m.fim) < 0
            ? TC.manutencao.REALIZADA : TC.manutencao.PLANEJADA;
        }
      });
    });

    /* Status antigo (PENDENTE/EM_ANDAMENTO/CONCLUIDO/CANCELADO) mais o campo separado de
       report status became a single workflow. The conversion merges the two: whatever was
       completed with an approved report goes straight to signed off. */
    var STATUS_ANTIGO = {
      PENDENTE: 'SOLICITADA', EM_ANDAMENTO: 'EM_EXECUCAO',
      CONCLUIDO: 'CONCLUIDA', CANCELADO: 'CANCELADA'
    };
    var RELATORIO_ANTIGO = {
      EM_ANALISE: 'RELATORIO_ENVIADO', CORRECAO: 'EM_CORRECAO', APROVADO: 'VALIDADA'
    };
    var estadosDemanda = TC.fluxo.estados('demanda').map(function (e) { return e.id; });
    (estado.demandas || []).forEach(function (d) {
      if (estadosDemanda.indexOf(d.status) === -1) {
        d.status = STATUS_ANTIGO[d.status] || 'SOLICITADA';
        /* Only something that has finished testing can have moved on in the report cycle. */
        if (d.status === 'CONCLUIDA' && RELATORIO_ANTIGO[d.relatorioStatus]) {
          d.status = RELATORIO_ANTIGO[d.relatorioStatus];
        }
      }
      delete d.relatorioStatus;
      if (!Array.isArray(d.historico)) d.historico = [];
    });

    /* Before the LTI, a request only kept the phase; it becomes the work order
       classification, and the number is left blank to be filled in. */
    (estado.demandas || []).forEach(function (d) {
      var tipos = TC.data.TIPOS_LTI.map(function (t) { return t.id; });
      if (!d.tipoLti || tipos.indexOf(d.tipoLti) === -1) {
        d.tipoLti = converter(d.fase) || validas[0];
      }
      if (typeof d.lti !== 'string') d.lti = '';
      if (typeof d.projeto !== 'string') d.projeto = '';
      if (typeof d.partNumber !== 'string') d.partNumber = '';
      /* Actual execution and report cycle: they feed the dashboard indicators (tests carried
         out in the month and right first time). */
      if (typeof d.dataConclusao !== 'string') d.dataConclusao = '';
      if (typeof d.dataRelatorio !== 'string') d.dataRelatorio = '';
      if (typeof d.relatorioCorrecoes !== 'number') d.relatorioCorrecoes = 0;
      if (!d.dataAmostras) d.dataAmostras = dataAntigaDaPeca[d.pecaId] || util.hoje();
      delete d.fase;
    });

    /* Roles, permissions and quotes came later; older states get the defaults. */
    if (!Array.isArray(estado.cotacoes)) estado.cotacoes = [];
    var COTACAO_ANTIGA = {
      ABERTA: 'RASCUNHO', ENVIADA: 'SOLICITADA', APROVADA: 'APROVADA', RECUSADA: 'RECUSADA'
    };
    var estadosCotacao = TC.fluxo.estados('cotacao').map(function (e) { return e.id; });
    estado.cotacoes.forEach(function (c) {
      if (estadosCotacao.indexOf(c.status) === -1) {
        c.status = COTACAO_ANTIGA[c.status] || 'RASCUNHO';
      }
      if (!Array.isArray(c.historico)) c.historico = [];
      if (typeof c.lti !== 'string') c.lti = '';
      if (typeof c.previsaoExecucao !== 'string') c.previsaoExecucao = '';
      /* The reference part type is gone; the line item now keeps the quantity in "amostras".
         Saved totals are not recalculated: an archived quote has frozen prices. */
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

  /* The copy published for the team: the build embeds a snapshot of the data in
     TC.PUBLICACAO and the application reads from it, writing nothing. Everyone who opens the
     file sees exactly the same data — the sharing that is possible while there is no server.
     See publicada() in permissoes.js: nobody edits in this copy. */
  function publicacao() {
    return TC.PUBLICACAO && TC.PUBLICACAO.dados ? TC.PUBLICACAO : null;
  }

  function carregar() {
    var pub = publicacao();
    if (pub) return migrar(JSON.parse(JSON.stringify(pub.dados)));
    try {
      var bruto = global.localStorage && global.localStorage.getItem(CHAVE);
      if (bruto) {
        var lido = JSON.parse(bruto);
        if (lido && lido.testes && lido.equipamentos) return migrar(lido);
      }
    } catch (e) {
      console.warn('Could not read the saved data, starting again from the seed catalogue.', e);
    }
    return TC.data.seed();
  }

  function salvar() {
    /* In the published copy there is nowhere to write: the source data is on the machine of
       whoever keeps the test centre, and writing here would only create a silent
       divergence. */
    if (publicacao()) return;
    try {
      if (global.localStorage) global.localStorage.setItem(CHAVE, JSON.stringify(estado));
    } catch (e) {
      console.warn('Could not save to the browser.', e);
    }
  }

  /* Applies a state move, saving the history. The fields the transition requires (completion
     date, sign-off date) are saved along with it, in the same operation — there is no point
     changing the state and leaving the date for later. */
  function mover(tipo, registro, para, dados) {
    var valores = dados || {};
    var perfil = TC.permissoes.perfilAtual(estado);
    var conferido = TC.fluxo.validar(tipo, registro, para, perfil, valores);
    if (!conferido.ok) return conferido;

    var de = registro.status;
    ['dataConclusao', 'dataRelatorio'].forEach(function (campo) {
      if (valores[campo]) registro[campo] = valores[campo];
    });
    if (conferido.transicao.contaCorrecao) {
      registro.relatorioCorrecoes = (Number(registro.relatorioCorrecoes) || 0) + 1;
    }
    registro.status = para;
    registro.historico = registro.historico || [];
    registro.historico.push(
      TC.fluxo.registroDeHistorico(de, para, perfil, valores.nota));
    commit();
    return { ok: true, registro: registro };
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
        /* Filled in later, as the test runs and the report goes to the customer. */
        dataConclusao: '',
        dataRelatorio: '',
        relatorioCorrecoes: 0,
        historico: [],
        documentos: [],
        prazo: dados.prazo || '',
        inicioFixo: dados.inicioFixo || '',
        observacao: dados.observacao || '',
        status: TC.fluxo.FLUXOS.demanda.inicial,
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

    /* ---- Test catalogue ---- */
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
    /* Downtime starts planned — and blocks the machine's calendar from then on. */
    adicionarManutencao: function (equipamentoId, janela) {
      var eq = util.porId(estado.equipamentos, equipamentoId);
      if (!eq) return null;
      eq.manutencao = eq.manutencao || [];
      var parada = {
        id: util.id('MN'),
        inicio: janela.inicio, fim: janela.fim,
        tipo: janela.tipo || 'PREVENTIVA',
        motivo: janela.motivo || 'Maintenance',
        situacao: janela.situacao || TC.manutencao.PLANEJADA,
        oQueFoiFeito: janela.oQueFoiFeito || '',
        responsavel: janela.responsavel || ''
      };
      eq.manutencao.push(parada);
      commit();
      return parada;
    },

    /* Record of what was done: the downtime becomes carried out and keeps the execution.
       The dates can change here — maintenance rarely ends on the day it was planned to. */
    registrarManutencao: function (equipamentoId, paradaId, dados) {
      var eq = util.porId(estado.equipamentos, equipamentoId);
      if (!eq) return null;
      var parada = util.porId(eq.manutencao || [], paradaId);
      if (!parada) return null;
      if (dados.inicio) parada.inicio = dados.inicio;
      if (dados.fim) parada.fim = dados.fim;
      if (dados.tipo) parada.tipo = dados.tipo;
      if (typeof dados.motivo === 'string' && dados.motivo.trim()) parada.motivo = dados.motivo.trim();
      parada.oQueFoiFeito = (dados.oQueFoiFeito || '').trim();
      parada.responsavel = (dados.responsavel || '').trim();
      parada.situacao = TC.manutencao.REALIZADA;
      commit();
      return parada;
    },
    removerManutencao: function (equipamentoId, janelaId) {
      var eq = util.porId(estado.equipamentos, equipamentoId);
      if (!eq) return;
      eq.manutencao = (eq.manutencao || []).filter(function (m) { return m.id !== janelaId; });
      commit();
    },

    /* ---- Instruments and calibration ---- */
    salvarInstrumento: function (instrumento) {
      var existente = instrumento.id ? util.porId(estado.instrumentos, instrumento.id) : null;
      if (existente) {
        Object.keys(instrumento).forEach(function (k) { existente[k] = instrumento[k]; });
        commit();
        return existente;
      }
      instrumento.id = instrumento.id || util.id('INS');
      instrumento.historico = instrumento.historico || [];
      estado.instrumentos.push(instrumento);
      commit();
      return instrumento;
    },
    removerInstrumento: function (id) {
      estado.instrumentos = estado.instrumentos.filter(function (i) { return i.id !== id; });
      commit();
    },

    /* Recording a calibration: it goes into the history and becomes the current one. The due
       date comes from the certificate when given; otherwise from the instrument's interval.
       A failed one renews nothing — the instrument cannot go back to measuring just because
       time passed, so it leaves service until someone decides what to do. */
    registrarCalibracao: function (instrumentoId, dados) {
      var i = util.porId(estado.instrumentos, instrumentoId);
      if (!i) return { ok: false, motivo: 'Instrument not found.' };
      if (!dados.data) return { ok: false, motivo: 'Enter the calibration date.' };

      var resultado = dados.resultado || 'APROVADO';
      var registro = {
        id: util.id('CAL'),
        data: dados.data,
        resultado: resultado,
        certificado: (dados.certificado || '').trim(),
        laboratorio: (dados.laboratorio || '').trim(),
        proximaCalibracao: dados.proximaCalibracao || '',
        observacao: (dados.observacao || '').trim(),
        registradoEm: util.hoje()
      };
      i.historico = i.historico || [];
      i.historico.push(registro);

      /* The certificate link, when given, becomes a document of the instrument tied to this
         record — so the history points at the PDF that evidences it. A refused link does not
         bring down the calibration record: the calibration happened anyway. */
      if ((dados.certificadoLink || '').trim()) {
        var anexo = TC.documentos.criar({
          tipo: 'CERTIFICADO', link: dados.certificadoLink, refId: registro.id,
          nome: dados.certificadoNome || (registro.certificado
            ? 'Certificate ' + registro.certificado : ''),
          observacao: registro.laboratorio
        }, TC.permissoes.perfilAtual(estado));
        if (anexo.ok) {
          i.documentos = i.documentos || [];
          i.documentos.push(anexo.documento);
          registro.documentoId = anexo.documento.id;
        } else {
          registro.observacao = (registro.observacao ? registro.observacao + ' ' : '') +
            '(certificate link not saved: ' + anexo.motivo + ')';
        }
      }

      i.ultimaCalibracao = registro.data;
      i.ultimoResultado = resultado;
      i.certificado = registro.certificado;
      i.laboratorio = registro.laboratorio;
      if (typeof dados.periodicidadeMeses === 'number' && dados.periodicidadeMeses > 0) {
        i.periodicidadeMeses = dados.periodicidadeMeses;
      }
      if (resultado === 'REPROVADO') {
        i.proximaCalibracao = '';
        i.situacao = 'FORA_DE_USO';
      } else {
        i.proximaCalibracao = registro.proximaCalibracao ||
          TC.calibracao.somaMeses(registro.data, i.periodicidadeMeses);
        i.situacao = 'EM_USO';
      }
      commit();
      return { ok: true, instrumento: i, registro: registro };
    },

    /* Bulk entry of dates that were already on a spreadsheet. It saves everything at once —
       229 commits in a row would redraw the screen 229 times — and reuses the same validity
       rule as the individual record, so there are never two ways of computing the same thing.
       Problem rows are the caller's responsibility: the screen only sends the ones
       interpretarLote() approved. */
    lancarCalibracoesEmLote: function (linhas) {
      var aplicados = [];
      (linhas || []).forEach(function (l) {
        var i = util.porId(estado.instrumentos, l.instrumentoId);
        if (!i || !l.data) return;

        var registro = {
          id: util.id('CAL'),
          data: l.data,
          resultado: 'APROVADO',
          certificado: (l.certificado || '').trim(),
          laboratorio: (l.laboratorio || '').trim(),
          proximaCalibracao: '',
          observacao: l.observacao || 'Bulk entry from the calibration spreadsheet.',
          registradoEm: util.hoje()
        };
        i.historico = i.historico || [];
        i.historico.push(registro);
        i.ultimaCalibracao = registro.data;
        i.ultimoResultado = 'APROVADO';
        if (registro.certificado) i.certificado = registro.certificado;
        if (registro.laboratorio) i.laboratorio = registro.laboratorio;
        i.periodicidadeMeses = i.periodicidadeMeses || 12;
        i.proximaCalibracao = TC.calibracao.somaMeses(registro.data, i.periodicidadeMeses);
        /* The condition does not change in bulk, unlike the individual record: whatever is
           "being calibrated" today stays that way, even when entering the earlier date. */
        aplicados.push(i.id);
      });

      if (aplicados.length) commit();
      return { ok: true, aplicados: aplicados };
    },

    /* ---- Documentos ----

       An attachment is a link to where the file already is — SharePoint, OneDrive, network.
       It works for requests and for instruments; the rest of the rule is in
       src/documentos.js. */
    anexarDocumento: function (alvo, registroId, dados) {
      var lista = alvo === 'instrumento' ? estado.instrumentos : estado.demandas;
      var registro = util.porId(lista || [], registroId);
      if (!registro) return { ok: false, motivo: 'Record not found.' };

      var criado = TC.documentos.criar(dados, TC.permissoes.perfilAtual(estado));
      if (!criado.ok) return criado;

      registro.documentos = registro.documentos || [];
      registro.documentos.push(criado.documento);
      commit();
      return { ok: true, documento: criado.documento, registro: registro };
    },

    removerDocumento: function (alvo, registroId, documentoId) {
      var lista = alvo === 'instrumento' ? estado.instrumentos : estado.demandas;
      var registro = util.porId(lista || [], registroId);
      if (!registro) return { ok: false, motivo: 'Record not found.' };
      registro.documentos = (registro.documentos || []).filter(function (d) {
        return d.id !== documentoId;
      });
      commit();
      return { ok: true, registro: registro };
    },

    /* ---- Part types ---- */
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
      /* The customer also leaves the procedures that require it, or the catalogue starts
         filtering by a customer that no longer exists. */
      estado.testes.forEach(function (t) {
        if (t.clientes) t.clientes = t.clientes.filter(function (c) { return c !== id; });
      });
      commit();
    },

    /* ---- Role and permissions ---- */
    /* Test centre hourly rate: a single field, applied to the whole catalogue. Archived
       quotes keep the rate of their day and are not affected. */
    definirHourlyRate: function (valor, vigencia) {
      estado.hourlyRate = Number(valor) || 0;
      if (typeof vigencia === 'string') estado.hourlyRateVigencia = vigencia.trim();
      commit();
      return estado.hourlyRate;
    },
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

    /* ---- Quotes ---- */
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
      cotacao.status = cotacao.status || TC.fluxo.FLUXOS.cotacao.inicial;
      cotacao.historico = cotacao.historico || [];
      estado.cotacoes.push(cotacao);
      commit();
      return cotacao;
    },
    removerCotacao: function (id) {
      estado.cotacoes = estado.cotacoes.filter(function (c) { return c.id !== id; });
      commit();
    },

    /* ---- Workflows ----
       A state move only happens through here: the workflow validates role, transition and
       required fields, and every move leaves a line in the record's history.
       Returns { ok: true, registro } or { ok: false, motivo }. */
    moverDemanda: function (id, para, dados) {
      var demanda = util.porId(estado.demandas, id);
      if (!demanda) return { ok: false, motivo: 'Request not found.' };
      return mover('demanda', demanda, para, dados);
    },
    moverCotacao: function (id, para, dados) {
      var cotacao = util.porId(estado.cotacoes, id);
      if (!cotacao) return { ok: false, motivo: 'Quote not found.' };
      return mover('cotacao', cotacao, para, dados);
    },

    /* ---- Backup ---- */
    exportar: function () {
      return JSON.stringify(estado, null, 2);
    },
    importar: function (texto) {
      var lido = JSON.parse(texto);
      if (!lido.testes || !lido.equipamentos) throw new Error('File has no test catalogue or equipment.');
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
