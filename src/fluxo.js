/* Fluxos da plataforma: demanda de teste e cotação.
   Cada fluxo é uma máquina de estados — quais são os estados, quem pode mover de um para
   o outro, e o que precisa estar preenchido para a passagem valer. Fica num módulo puro,
   testado, porque é aqui que mora a regra de quem faz o quê. A interface só desenha os
   botões que este módulo autoriza. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util || (typeof require !== 'undefined' ? require('./util.js') : null);
  if (!TC.documentos && typeof require !== 'undefined') require('./documentos.js');

  /* --- Demanda de teste ---------------------------------------------------------------

     O cliente interno pede, o centro de testes aceita e executa, o relatório vai ao
     cliente, e o cliente valida ou devolve para correção.

       SOLICITADA ─aceite→ ACEITA ─início→ EM_EXECUCAO ─fim→ CONCLUIDA
                                                                │ envio do relatório
                                                                ▼
                                    VALIDADA ←validação─ RELATORIO_ENVIADO
                                                                │ correção pedida
                                                                ▼
                                                          EM_CORRECAO ─reenvio→ (volta)

     "ativo" marca os estados que ainda disputam bancada: são os que o planejamento
     agenda. Concluída em diante, o ensaio já saiu do equipamento. */
  var DEMANDA = [
    { id: 'SOLICITADA', nome: 'Solicitada', cor: 'marca', ativo: true,
      dono: 'PRODUTO', descricao: 'Cliente interno abriu a demanda; aguarda aceite do centro de testes' },
    { id: 'ACEITA', nome: 'Aceita', cor: 'marca', ativo: true,
      dono: 'TESTES', descricao: 'Centro de testes assumiu; o ensaio está agendado' },
    { id: 'EM_EXECUCAO', nome: 'Em execução', cor: 'alerta', ativo: true,
      dono: 'TESTES', descricao: 'Ensaio rodando na bancada' },
    { id: 'CONCLUIDA', nome: 'Ensaio concluído', cor: 'ok', ativo: false,
      dono: 'TESTES', descricao: 'Ensaio terminado; relatório em elaboração' },
    { id: 'RELATORIO_ENVIADO', nome: 'Relatório enviado', cor: 'marca', ativo: false,
      dono: 'PRODUTO', descricao: 'Relatório com o cliente, aguardando validação' },
    { id: 'EM_CORRECAO', nome: 'Em correção', cor: 'erro', ativo: false,
      dono: 'TESTES', descricao: 'Cliente pediu correção do relatório' },
    { id: 'VALIDADA', nome: 'Validada pelo cliente', cor: 'ok', ativo: false,
      dono: null, descricao: 'Cliente validou o relatório; demanda encerrada' },
    { id: 'CANCELADA', nome: 'Cancelada', cor: '', ativo: false,
      dono: null, descricao: 'Demanda encerrada sem execução' }
  ];

  /* perfil = quem tem o botão. exige = campos que precisam estar preenchidos na passagem;
     sem eles a transição é recusada, para o dado do indicador não nascer furado. */
  var TRANSICOES_DEMANDA = [
    { de: 'SOLICITADA', para: 'ACEITA', perfil: 'TESTES', rotulo: 'Aceitar demanda',
      descricao: 'O centro de testes assume a demanda e ela entra firme no planejamento.' },
    { de: 'ACEITA', para: 'EM_EXECUCAO', perfil: 'TESTES', rotulo: 'Iniciar ensaio',
      descricao: 'A peça entrou na bancada.' },
    { de: 'EM_EXECUCAO', para: 'CONCLUIDA', perfil: 'TESTES', rotulo: 'Concluir ensaio',
      exige: ['dataConclusao'],
      descricao: 'O ensaio terminou. A data de conclusão alimenta o painel do mês.' },
    { de: 'CONCLUIDA', para: 'RELATORIO_ENVIADO', perfil: 'TESTES', rotulo: 'Enviar relatório',
      exigeDocumento: 'RELATORIO',
      descricao: 'O relatório vai ao cliente para validação. Anexe o relatório antes: é ' +
        'assim que o cliente chega nele a partir da demanda.' },
    { de: 'RELATORIO_ENVIADO', para: 'VALIDADA', perfil: 'PRODUTO', rotulo: 'Validar relatório',
      exige: ['dataRelatorio'],
      descricao: 'O cliente aceita o relatório como está. É esta validação que conta no ' +
        'indicador de certo da primeira vez.' },
    { de: 'RELATORIO_ENVIADO', para: 'EM_CORRECAO', perfil: 'PRODUTO', rotulo: 'Pedir correção',
      contaCorrecao: true, exigeNota: true,
      descricao: 'O cliente devolve o relatório. A rodada de correção é contabilizada.' },
    { de: 'EM_CORRECAO', para: 'RELATORIO_ENVIADO', perfil: 'TESTES', rotulo: 'Reenviar relatório',
      descricao: 'Relatório corrigido e devolvido ao cliente.' },
    { de: 'SOLICITADA', para: 'CANCELADA', perfil: 'QUALQUER', rotulo: 'Cancelar', exigeNota: true },
    { de: 'ACEITA', para: 'CANCELADA', perfil: 'QUALQUER', rotulo: 'Cancelar', exigeNota: true },
    { de: 'EM_EXECUCAO', para: 'CANCELADA', perfil: 'QUALQUER', rotulo: 'Cancelar', exigeNota: true }
  ];

  /* --- Cotação ------------------------------------------------------------------------

     O cliente monta a partir do catálogo e envia; o centro de testes analisa e valida;
     o cliente aprova ou recusa.

       RASCUNHO ─envio→ SOLICITADA ─análise→ EM_ANALISE ─validação→ VALIDADA
                              ▲                    │                     │
                              └── DEVOLVIDA ───────┘            APROVADA / RECUSADA
  */
  var COTACAO = [
    { id: 'RASCUNHO', nome: 'Rascunho', cor: '', dono: 'PRODUTO',
      descricao: 'Cliente interno montando a lista de procedimentos' },
    { id: 'SOLICITADA', nome: 'Solicitada', cor: 'marca', dono: 'TESTES',
      descricao: 'Enviada ao centro de testes, aguardando análise' },
    { id: 'EM_ANALISE', nome: 'Em análise', cor: 'alerta', dono: 'TESTES',
      descricao: 'Centro de testes conferindo escopo, horas e preço' },
    { id: 'DEVOLVIDA', nome: 'Devolvida ao cliente', cor: 'erro', dono: 'PRODUTO',
      descricao: 'Falta informação para cotar; volta ao solicitante' },
    { id: 'VALIDADA', nome: 'Validada pelo centro de testes', cor: 'ok', dono: 'PRODUTO',
      descricao: 'Preço confirmado e devolvido ao cliente para decisão' },
    { id: 'APROVADA', nome: 'Aprovada pelo cliente', cor: 'ok', dono: null,
      descricao: 'Cliente aprovou; os testes podem ser demandados' },
    { id: 'RECUSADA', nome: 'Recusada', cor: '', dono: null,
      descricao: 'Cliente não seguiu com o orçamento' }
  ];

  var TRANSICOES_COTACAO = [
    { de: 'RASCUNHO', para: 'SOLICITADA', perfil: 'PRODUTO', rotulo: 'Enviar para cotação',
      descricao: 'A solicitação vai ao centro de testes.' },
    { de: 'SOLICITADA', para: 'EM_ANALISE', perfil: 'TESTES', rotulo: 'Assumir análise',
      descricao: 'O centro de testes assume a conferência do escopo e do preço.' },
    { de: 'EM_ANALISE', para: 'VALIDADA', perfil: 'TESTES', rotulo: 'Validar cotação',
      descricao: 'Preço confirmado. A cotação volta ao cliente para decisão.' },
    { de: 'EM_ANALISE', para: 'DEVOLVIDA', perfil: 'TESTES', rotulo: 'Devolver ao solicitante',
      exigeNota: true,
      descricao: 'Falta informação para cotar; a cotação volta a quem pediu.' },
    { de: 'DEVOLVIDA', para: 'SOLICITADA', perfil: 'PRODUTO', rotulo: 'Reenviar',
      descricao: 'Informação complementada; volta ao centro de testes.' },
    { de: 'VALIDADA', para: 'APROVADA', perfil: 'PRODUTO', rotulo: 'Aprovar cotação',
      descricao: 'O cliente aprova o orçamento.' },
    { de: 'VALIDADA', para: 'RECUSADA', perfil: 'PRODUTO', rotulo: 'Recusar cotação',
      exigeNota: true, descricao: 'O cliente não segue com o orçamento.' }
  ];

  var FLUXOS = {
    demanda: { estados: DEMANDA, transicoes: TRANSICOES_DEMANDA, inicial: 'SOLICITADA' },
    cotacao: { estados: COTACAO, transicoes: TRANSICOES_COTACAO, inicial: 'RASCUNHO' }
  };

  function fluxo(tipo) {
    return FLUXOS[tipo];
  }

  function estados(tipo) {
    return fluxo(tipo).estados;
  }

  function estado(tipo, id) {
    return util.porId(estados(tipo), id) || null;
  }

  function nomeDoEstado(tipo, id) {
    var e = estado(tipo, id);
    return e ? e.nome : id;
  }

  /* Estados que ainda disputam bancada. Só a demanda tem essa noção. */
  function estadosAtivos() {
    return DEMANDA.filter(function (e) { return e.ativo; }).map(function (e) { return e.id; });
  }

  /* Transições disponíveis a partir de um estado. Sem perfil, devolve todas — é assim que
     a documentação e os testes enxergam o fluxo inteiro. */
  function transicoesDe(tipo, de, perfil) {
    return fluxo(tipo).transicoes.filter(function (t) {
      if (t.de !== de) return false;
      if (!perfil) return true;
      return t.perfil === 'QUALQUER' || t.perfil === perfil;
    });
  }

  function transicao(tipo, de, para) {
    var achadas = fluxo(tipo).transicoes.filter(function (t) {
      return t.de === de && t.para === para;
    });
    return achadas[0] || null;
  }

  function podeTransicionar(tipo, de, para, perfil) {
    var t = transicao(tipo, de, para);
    if (!t) return false;
    return t.perfil === 'QUALQUER' || t.perfil === perfil;
  }

  /* Valida a passagem antes de gravar: perfil certo, transição existente e campos exigidos
     preenchidos. Devolve { ok: true } ou { ok: false, motivo: '...' }. */
  function validar(tipo, registro, para, perfil, dados) {
    var de = registro.status;
    var t = transicao(tipo, de, para);
    if (!t) {
      return { ok: false, motivo: 'Não existe passagem de "' + nomeDoEstado(tipo, de) +
        '" para "' + nomeDoEstado(tipo, para) + '".' };
    }
    if (t.perfil !== 'QUALQUER' && t.perfil !== perfil) {
      return { ok: false, motivo: 'Esta passagem é do perfil ' +
        (t.perfil === 'TESTES' ? 'Engenheiro de Testes' : 'Engenheiro de Produto') + '.' };
    }
    var valores = dados || {};
    var faltando = (t.exige || []).filter(function (campo) {
      return !(valores[campo] || registro[campo]);
    });
    if (faltando.length) {
      return { ok: false, motivo: 'Preencha antes: ' + faltando.join(', ') + '.' };
    }
    if (t.exigeNota && !(valores.nota || '').trim()) {
      return { ok: false, motivo: 'Descreva o motivo para registrar no histórico.' };
    }
    /* Relatório enviado sem relatório anexado deixa o cliente com um status e nada para
       ler; e o indicador de certo da primeira vez passa a contar uma entrega que ninguém
       consegue abrir. A exigência é do documento, não do arquivo: basta o link. */
    if (t.exigeDocumento && !TC.documentos.tem(registro.documentos, t.exigeDocumento)) {
      return { ok: false, motivo: 'Anexe o documento "' +
        TC.documentos.nomeDoTipo(t.exigeDocumento) + '" antes desta passagem.' };
    }
    return { ok: true, transicao: t };
  }

  /* Uma linha de histórico por passagem: quem, quando, de onde para onde e por quê.
     É o que permite auditar a demanda depois sem depender da memória de ninguém. */
  function registroDeHistorico(de, para, perfil, nota, quando) {
    return {
      em: quando || util.hoje(),
      de: de, para: para,
      perfil: perfil || '',
      nota: (nota || '').trim()
    };
  }

  TC.fluxo = {
    FLUXOS: FLUXOS,
    fluxo: fluxo,
    estados: estados,
    estado: estado,
    nomeDoEstado: nomeDoEstado,
    estadosAtivos: estadosAtivos,
    transicoesDe: transicoesDe,
    transicao: transicao,
    podeTransicionar: podeTransicionar,
    validar: validar,
    registroDeHistorico: registroDeHistorico
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.fluxo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
