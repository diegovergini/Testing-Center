/* Platform workflows: test request and quote.
   Each workflow is a state machine — which states exist, who can move from one to the next,
   and what has to be filled in for the move to count. It lives in a pure, tested module,
   because this is where the rule of who does what belongs. The interface only draws the
   buttons this module authorises. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util || (typeof require !== 'undefined' ? require('./util.js') : null);
  if (!TC.documentos && typeof require !== 'undefined') require('./documentos.js');

  /* --- Test request -------------------------------------------------------------------

     The internal customer asks, the test centre accepts and runs it, the report goes to the
     customer, and the customer either signs it off or sends it back for rework.

       SOLICITADA ─accept→ ACEITA ─start→ EM_EXECUCAO ─finish→ CONCLUIDA
                                                                │ report sent
                                                                ▼
                                     VALIDADA ←sign-off─ RELATORIO_ENVIADO
                                                                │ rework asked
                                                                ▼
                                                          EM_CORRECAO ─resend→ (back)

     "ativo" marks the states still competing for a rig: those are the ones the scheduler
     places. From Test completed on, the test has left the equipment. */
  var DEMANDA = [
    { id: 'SOLICITADA', nome: 'Requested', cor: 'marca', ativo: true,
      dono: 'PRODUTO', descricao: 'Internal customer opened the request; waiting for the test centre to accept' },
    { id: 'ACEITA', nome: 'Accepted', cor: 'marca', ativo: true,
      dono: 'TESTES', descricao: 'Test centre took it on; the test is scheduled' },
    { id: 'EM_EXECUCAO', nome: 'Running', cor: 'alerta', ativo: true,
      dono: 'TESTES', descricao: 'Test running on the rig' },
    { id: 'CONCLUIDA', nome: 'Test completed', cor: 'ok', ativo: false,
      dono: 'TESTES', descricao: 'Test finished; report being written' },
    { id: 'RELATORIO_ENVIADO', nome: 'Report sent', cor: 'marca', ativo: false,
      dono: 'PRODUTO', descricao: 'Report with the customer, awaiting sign-off' },
    { id: 'EM_CORRECAO', nome: 'In rework', cor: 'erro', ativo: false,
      dono: 'TESTES', descricao: 'Customer asked for the report to be reworked' },
    { id: 'VALIDADA', nome: 'Signed off by customer', cor: 'ok', ativo: false,
      dono: null, descricao: 'Customer accepted the report; request closed' },
    { id: 'CANCELADA', nome: 'Cancelled', cor: '', ativo: false,
      dono: null, descricao: 'Request closed without running' }
  ];

  /* perfil = who gets the button. exige = fields that must be filled in on the way through;
     without them the transition is refused, so the KPI data is never born with holes. */
  var TRANSICOES_DEMANDA = [
    { de: 'SOLICITADA', para: 'ACEITA', perfil: 'TESTES', rotulo: 'Accept request',
      descricao: 'The test centre takes the request on and it enters the schedule for good.' },
    { de: 'ACEITA', para: 'EM_EXECUCAO', perfil: 'TESTES', rotulo: 'Start test',
      descricao: 'The part is on the rig.' },
    { de: 'EM_EXECUCAO', para: 'CONCLUIDA', perfil: 'TESTES', rotulo: 'Complete test',
      exige: ['dataConclusao'],
      descricao: 'The test is over. The completion date feeds the dashboard for the month.' },
    { de: 'CONCLUIDA', para: 'RELATORIO_ENVIADO', perfil: 'TESTES', rotulo: 'Send report',
      exigeDocumento: 'RELATORIO',
      descricao: 'The report goes to the customer for sign-off. Attach the report first: ' +
        'that is how the customer reaches it from the request.' },
    { de: 'RELATORIO_ENVIADO', para: 'VALIDADA', perfil: 'PRODUTO', rotulo: 'Sign off report',
      exige: ['dataRelatorio'],
      descricao: 'The customer accepts the report as it stands. This sign-off is what counts ' +
        'towards right first time.' },
    { de: 'RELATORIO_ENVIADO', para: 'EM_CORRECAO', perfil: 'PRODUTO', rotulo: 'Request rework',
      contaCorrecao: true, exigeNota: true,
      descricao: 'The customer sends the report back. The rework round is counted.' },
    { de: 'EM_CORRECAO', para: 'RELATORIO_ENVIADO', perfil: 'TESTES', rotulo: 'Resend report',
      descricao: 'Report reworked and returned to the customer.' },
    { de: 'SOLICITADA', para: 'CANCELADA', perfil: 'QUALQUER', rotulo: 'Cancel', exigeNota: true },
    { de: 'ACEITA', para: 'CANCELADA', perfil: 'QUALQUER', rotulo: 'Cancel', exigeNota: true },
    { de: 'EM_EXECUCAO', para: 'CANCELADA', perfil: 'QUALQUER', rotulo: 'Cancel', exigeNota: true }
  ];

  /* --- Quote --------------------------------------------------------------------------

     The customer builds it from the catalogue and sends it; the test centre reviews and
     confirms it; the customer approves or declines.

       RASCUNHO ─send→ SOLICITADA ─review→ EM_ANALISE ─confirm→ VALIDADA
                             ▲                   │                    │
                             └── DEVOLVIDA ──────┘           APROVADA / RECUSADA
  */
  var COTACAO = [
    { id: 'RASCUNHO', nome: 'Draft', cor: '', dono: 'PRODUTO',
      descricao: 'Internal customer building the list of procedures' },
    { id: 'SOLICITADA', nome: 'Requested', cor: 'marca', dono: 'TESTES',
      descricao: 'Sent to the test centre, awaiting review' },
    { id: 'EM_ANALISE', nome: 'Under review', cor: 'alerta', dono: 'TESTES',
      descricao: 'Test centre checking scope, hours and price' },
    { id: 'DEVOLVIDA', nome: 'Returned to customer', cor: 'erro', dono: 'PRODUTO',
      descricao: 'Missing information to quote; goes back to the requester' },
    { id: 'VALIDADA', nome: 'Confirmed by test centre', cor: 'ok', dono: 'PRODUTO',
      descricao: 'Price confirmed and returned to the customer to decide' },
    { id: 'APROVADA', nome: 'Approved by customer', cor: 'ok', dono: null,
      descricao: 'Customer approved; the tests can now be requested' },
    { id: 'RECUSADA', nome: 'Declined', cor: '', dono: null,
      descricao: 'Customer did not go ahead with the quote' }
  ];

  var TRANSICOES_COTACAO = [
    { de: 'RASCUNHO', para: 'SOLICITADA', perfil: 'PRODUTO', rotulo: 'Send for quoting',
      descricao: 'The request goes to the test centre.' },
    { de: 'SOLICITADA', para: 'EM_ANALISE', perfil: 'TESTES', rotulo: 'Take on review',
      descricao: 'The test centre takes on the scope and price check.' },
    { de: 'EM_ANALISE', para: 'VALIDADA', perfil: 'TESTES', rotulo: 'Confirm quote',
      descricao: 'Price confirmed. The quote goes back to the customer to decide.' },
    { de: 'EM_ANALISE', para: 'DEVOLVIDA', perfil: 'TESTES', rotulo: 'Return to requester',
      exigeNota: true,
      descricao: 'Missing information to quote; the quote goes back to whoever asked.' },
    { de: 'DEVOLVIDA', para: 'SOLICITADA', perfil: 'PRODUTO', rotulo: 'Resend',
      descricao: 'Information completed; back to the test centre.' },
    { de: 'VALIDADA', para: 'APROVADA', perfil: 'PRODUTO', rotulo: 'Approve quote',
      descricao: 'The customer approves the quote.' },
    { de: 'VALIDADA', para: 'RECUSADA', perfil: 'PRODUTO', rotulo: 'Decline quote',
      exigeNota: true, descricao: 'The customer does not go ahead with the quote.' }
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

  /* States still competing for a rig. Only the request has this notion. */
  function estadosAtivos() {
    return DEMANDA.filter(function (e) { return e.ativo; }).map(function (e) { return e.id; });
  }

  /* Transitions available from a state. With no role it returns all of them — that is how
     the documentation and the tests see the whole workflow. */
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

  /* Validates the move before saving: right role, existing transition and required fields
     filled in. Returns { ok: true } or { ok: false, motivo: '...' }. */
  function validar(tipo, registro, para, perfil, dados) {
    var de = registro.status;
    var t = transicao(tipo, de, para);
    if (!t) {
      return { ok: false, motivo: 'There is no move from "' + nomeDoEstado(tipo, de) +
        '" to "' + nomeDoEstado(tipo, para) + '".' };
    }
    if (t.perfil !== 'QUALQUER' && t.perfil !== perfil) {
      return { ok: false, motivo: 'This move belongs to the ' +
        (t.perfil === 'TESTES' ? 'Test Engineer' : 'Product Engineer') + ' role.' };
    }
    var valores = dados || {};
    var faltando = (t.exige || []).filter(function (campo) {
      return !(valores[campo] || registro[campo]);
    });
    if (faltando.length) {
      return { ok: false, motivo: 'Fill in first: ' + faltando.join(', ') + '.' };
    }
    if (t.exigeNota && !(valores.nota || '').trim()) {
      return { ok: false, motivo: 'Describe the reason so it goes into the history.' };
    }
    /* A report sent with no report attached leaves the customer with a status and nothing
       to read, and right first time starts counting a delivery nobody can open. What is
       required is the document, not the file: the link is enough. */
    if (t.exigeDocumento && !TC.documentos.tem(registro.documentos, t.exigeDocumento)) {
      return { ok: false, motivo: 'Attach the "' +
        TC.documentos.nomeDoTipo(t.exigeDocumento) + '" document before this move.' };
    }
    return { ok: true, transicao: t };
  }

  /* One history line per move: who, when, from where to where and why. It is what makes a
     request auditable later without relying on anyone's memory. */
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
