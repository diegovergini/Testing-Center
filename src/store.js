/* Estado da aplicação: persistência em localStorage, CRUD e exportação/importação. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util;
  /* No navegador estes módulos já foram carregados; no Node (testes) resolvemos na hora. */
  var scheduler = TC.scheduler || (typeof require !== 'undefined' ? require('./scheduler.js') : null);
  if (!TC.fluxo && typeof require !== 'undefined') require('./fluxo.js');
  if (!TC.manutencao && typeof require !== 'undefined') require('./manutencao.js');
  if (!TC.calibracao && typeof require !== 'undefined') require('./calibracao.js');
  if (!TC.permissoes && typeof require !== 'undefined') require('./permissoes.js');

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

    estado.clientes = estado.clientes || [];

    /* Hourly rate do centro de testes: um valor só, para todo o catálogo. Dados salvos
       antes desta mudança traziam o rate em cada procedimento; adotamos o valor vigente
       do centro de testes, que é o que passa a valer para todos. */
    if (typeof estado.hourlyRate !== 'number') estado.hourlyRate = TC.data.HOURLY_RATE;
    if (typeof estado.hourlyRateVigencia !== 'string') {
      estado.hourlyRateVigencia = TC.data.HOURLY_RATE_VIGENCIA;
    }

    /* Mudança de catálogo em dados já salvos no navegador.
       Até a versão 2 o catálogo era o de exemplo, de vários clientes: ele sai inteiro.
       Daí para frente a atualização é aditiva — procedimentos novos entram e os que já
       existem ficam como estão, com as horas e a bancada que já foram preenchidas. Cotações arquivadas nunca são tocadas: têm preço congelado. */
    var versaoSalva = Number(estado.catalogoVersao) || 0;
    if (versaoSalva < TC.data.CATALOGO_VERSAO) {
      var padraoNovo = TC.data.seed();
      estado.testes = estado.testes || [];
      if (versaoSalva < 2) estado.testes = [];
      padraoNovo.testes.forEach(function (t) {
        var salvo = util.porId(estado.testes, t.id);
        if (!salvo) { estado.testes.push(t); return; }

        /* Levantamento de horas do centro de testes: um procedimento que ainda não tem
           nenhuma hora medida herda as do catálogo de partida. Se alguém já preencheu
           qualquer uma das três, o cadastro é dele e fica como está. */
        var semHoras = !salvo.horasSetup && !salvo.horasEnsaio && !salvo.horasReport;
        var padraoTemHoras = t.horasSetup || t.horasEnsaio || t.horasReport;
        if (semHoras && padraoTemHoras) {
          salvo.horasSetup = t.horasSetup;
          salvo.horasEnsaio = t.horasEnsaio;
          salvo.horasReport = t.horasReport;
        }
      });

      /* Os clientes que o novo catálogo exige precisam existir no cadastro salvo,
         senão o catálogo aponta para um cliente que não está na lista. */
      var exigidos = {};
      estado.testes.forEach(function (t) {
        (t.clientes || []).forEach(function (id) { exigidos[id] = true; });
      });
      padraoNovo.clientes.forEach(function (c) {
        if (exigidos[c.id] && !util.porId(estado.clientes, c.id)) estado.clientes.push(c);
      });

      /* O procedimento é a referência da demanda: sem ele a demanda não tem custo nem
         bancada. Só descarta algo quando o catálogo perdeu procedimentos. */
      var idsDoCatalogo = estado.testes.map(function (t) { return t.id; });
      estado.demandas = (estado.demandas || []).filter(function (d) {
        return idsDoCatalogo.indexOf(d.testeId) !== -1;
      });
      estado.catalogoVersao = TC.data.CATALOGO_VERSAO;
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

      /* O hourly rate deixou de ser campo do procedimento: virou um valor único do
         centro de testes, guardado no estado e atualizado uma vez por ano. */
      if (typeof t.horasReport !== 'number') t.horasReport = 0;
      delete t.hourlyRate;
      if (typeof t.custoInsumos !== 'number') t.custoInsumos = t.custoBase || 0;
      delete t.custoBase;
    });

    /* Inventário de instrumentos sujeitos a calibração. Mesma mecânica do catálogo:
       instrumento novo entra, e o que já existe fica com o plano de calibração que o
       laboratório preencheu. */
    estado.instrumentos = estado.instrumentos || [];
    if ((Number(estado.instrumentosVersao) || 0) < TC.data.INSTRUMENTOS_VERSAO) {
      TC.instrumentosPadrao().forEach(function (i) {
        if (!util.porId(estado.instrumentos, i.id)) estado.instrumentos.push(i);
      });
      estado.instrumentosVersao = TC.data.INSTRUMENTOS_VERSAO;
    }
    estado.instrumentos.forEach(function (i) {
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

    /* As paradas de manutenção passaram a ter duas vidas: planejada e realizada, com o
       registro do que foi feito. Parada antiga que já terminou entra como realizada — ela
       aconteceu —, e a que ainda está por vir fica planejada. */
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
       situação do relatório viraram um fluxo só. A conversão junta os dois: quem estava
       concluído com relatório aprovado passa direto a validado. */
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
        /* Só quem já terminou o ensaio pode ter avançado no ciclo do relatório. */
        if (d.status === 'CONCLUIDA' && RELATORIO_ANTIGO[d.relatorioStatus]) {
          d.status = RELATORIO_ANTIGO[d.relatorioStatus];
        }
      }
      delete d.relatorioStatus;
      if (!Array.isArray(d.historico)) d.historico = [];
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
      /* Execução real e ciclo do relatório: alimentam os indicadores do painel
         (testes realizados no mês e certo da primeira vez). */
      if (typeof d.dataConclusao !== 'string') d.dataConclusao = '';
      if (typeof d.dataRelatorio !== 'string') d.dataRelatorio = '';
      if (typeof d.relatorioCorrecoes !== 'number') d.relatorioCorrecoes = 0;
      if (!d.dataAmostras) d.dataAmostras = dataAntigaDaPeca[d.pecaId] || util.hoje();
      delete d.fase;
    });

    /* Perfis, permissões e cotações chegaram depois; estados antigos ganham o padrão. */
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

  /* Cópia publicada para a equipe: o build embute um instantâneo dos dados em
     TC.PUBLICACAO e a aplicação passa a ler dele, sem gravar nada. Todo mundo que abrir
     o arquivo vê exatamente os mesmos dados — é o compartilhamento possível enquanto não
     existe servidor. Ver publicada() em permissoes.js: nesta cópia ninguém edita. */
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
      console.warn('Não foi possível ler os dados salvos, recomeçando do catálogo padrão.', e);
    }
    return TC.data.seed();
  }

  function salvar() {
    /* Na cópia publicada não há onde gravar: o dado de origem está na máquina de quem
       mantém o centro de testes, e gravar aqui só criaria uma divergência silenciosa. */
    if (publicacao()) return;
    try {
      if (global.localStorage) global.localStorage.setItem(CHAVE, JSON.stringify(estado));
    } catch (e) {
      console.warn('Não foi possível salvar no navegador.', e);
    }
  }

  /* Aplica uma passagem de estado, gravando o histórico. Os campos que a transição exige
     (data de conclusão, data de validação) são gravados junto, na mesma operação — não
     adianta mudar o estado e deixar a data para depois. */
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
        /* Preenchidos depois, conforme o ensaio roda e o relatório vai ao cliente. */
        dataConclusao: '',
        dataRelatorio: '',
        relatorioCorrecoes: 0,
        historico: [],
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
    /* A parada nasce planejada — e já bloqueia a agenda do equipamento a partir daí. */
    adicionarManutencao: function (equipamentoId, janela) {
      var eq = util.porId(estado.equipamentos, equipamentoId);
      if (!eq) return null;
      eq.manutencao = eq.manutencao || [];
      var parada = {
        id: util.id('MN'),
        inicio: janela.inicio, fim: janela.fim,
        tipo: janela.tipo || 'PREVENTIVA',
        motivo: janela.motivo || 'Manutenção',
        situacao: janela.situacao || TC.manutencao.PLANEJADA,
        oQueFoiFeito: janela.oQueFoiFeito || '',
        responsavel: janela.responsavel || ''
      };
      eq.manutencao.push(parada);
      commit();
      return parada;
    },

    /* Registro do que foi feito: a parada passa a realizada e guarda a execução.
       As datas podem mudar aqui — manutenção raramente termina no dia previsto. */
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

    /* ---- Instrumentos e calibração ---- */
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

    /* Registro de uma calibração: entra no histórico e passa a ser a vigente. O vencimento
       vem do certificado quando informado; senão sai da periodicidade do instrumento.
       Reprovado não renova a validade — o instrumento não pode voltar a medir por decurso
       de prazo, então ele sai de uso até alguém decidir o que fazer. */
    registrarCalibracao: function (instrumentoId, dados) {
      var i = util.porId(estado.instrumentos, instrumentoId);
      if (!i) return { ok: false, motivo: 'Instrumento não encontrado.' };
      if (!dados.data) return { ok: false, motivo: 'Informe a data da calibração.' };

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
    /* Hourly rate do centro de testes: um campo só, aplicado a todo o catálogo.
       Cotações já arquivadas guardam o rate do dia e não são afetadas. */
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

    /* ---- Fluxos ----
       Uma passagem de estado só acontece por aqui: o fluxo valida perfil, transição e
       campos exigidos, e cada passagem deixa uma linha no histórico do registro.
       Devolve { ok: true, registro } ou { ok: false, motivo }. */
    moverDemanda: function (id, para, dados) {
      var demanda = util.porId(estado.demandas, id);
      if (!demanda) return { ok: false, motivo: 'Demanda não encontrada.' };
      return mover('demanda', demanda, para, dados);
    },
    moverCotacao: function (id, para, dados) {
      var cotacao = util.porId(estado.cotacoes, id);
      if (!cotacao) return { ok: false, motivo: 'Cotação não encontrada.' };
      return mover('cotacao', cotacao, para, dados);
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
