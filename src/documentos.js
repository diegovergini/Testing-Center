/* Documents attached to the platform's records.

   A document here is a reference, not the file: name, link, and who attached it when. The
   file stays where the company already keeps documents — SharePoint, OneDrive, network
   drive — and that is where version control and retention apply. The platform saves
   everything as a single JSON in the browser (a few MB in total), so a PDF report would not
   fit; and the link is exactly what becomes a list column when this moves to SharePoint.

   Pure, tested module: it validates the link, builds the record and counts what is
   attached. The screen only draws. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util || (typeof require !== 'undefined' ? require('./util.js') : null);

  /* Nature of the document. "perfil" is who usually attaches it — it lets the screen
     suggest the right type, not block anything: whoever can edit the screen can attach any
     of them. "contexto" separates what makes sense on each screen. */
  var TIPOS = [
    { id: 'ENTRADA', nome: 'Test input', contexto: 'demanda', perfil: 'PRODUTO',
      descricao: 'What the requester wants tested: specification, drawing, test condition' },
    { id: 'RELATORIO', nome: 'Test report', contexto: 'demanda', perfil: 'TESTES',
      descricao: 'The report that goes to the customer at the end of the test' },
    { id: 'EVIDENCIA', nome: 'Test evidence', contexto: 'demanda', perfil: 'TESTES',
      descricao: 'Raw data, photos, video, rig acquisition' },
    { id: 'CERTIFICADO', nome: 'Calibration certificate', contexto: 'instrumento', perfil: 'TESTES',
      descricao: 'The certificate issued by the laboratory' },
    { id: 'OUTRO', nome: 'Other document', contexto: 'ambos', perfil: null,
      descricao: 'Any other attachment' }
  ];

  function tipos(contexto) {
    return TIPOS.filter(function (t) {
      return !contexto || t.contexto === contexto || t.contexto === 'ambos';
    });
  }

  function nomeDoTipo(id) {
    var t = util.porId(TIPOS, id);
    return t ? t.nome : id;
  }

  /* Type suggested for whoever has the screen open: the requester attaches test input, the
     test engineer attaches the report. */
  function tipoSugerido(contexto, perfil) {
    var candidatos = tipos(contexto).filter(function (t) { return t.perfil === perfil; });
    return (candidatos[0] || tipos(contexto)[0]).id;
  }

  /* --- Link ----------------------------------------------------------------------------

     Only http(s) and network paths get in. Refusing the other schemes is not fussiness: the
     link is saved and later becomes an href on a screen someone else opens, and
     "javascript:" or "data:" in that href runs code instead of opening a document. */
  var ESQUEMAS_WEB = ['http:', 'https:'];

  var WEB = 'WEB';
  var REDE = 'REDE';

  var MOTIVOS = {
    SEM_LINK: 'enter the document link',
    ESQUEMA_RECUSADO: 'only http, https or network path links are accepted',
    INCOMPLETO: 'the link does not look like a complete address'
  };

  /* Returns { ok, link, local } or { ok: false, motivo }. The link comes back normalised:
     an address pasted without a scheme ("company.sharepoint.com/...") gets https, which is
     what the person meant. */
  function interpretarLink(texto) {
    var t = String(texto == null ? '' : texto).trim();
    /* Excel and Outlook paste the address wrapped in < >. */
    t = t.replace(/^<+/, '').replace(/>+$/, '').trim();
    if (!t) return { ok: false, motivo: 'SEM_LINK' };

    /* Windows network path: \\server\folder\file.pdf */
    if (/^\\\\[^\\]+\\/.test(t)) return { ok: true, link: t, local: REDE };

    var comEsquema = /^([a-z][a-z0-9+.-]*):/i.exec(t);
    if (!comEsquema) {
      /* With no scheme, it requires a dotted host and a path after the slash. The dot alone
         cannot decide: "certificate.pdf" has the same shape as "company.com" and is a file
         name, not an address — it would become https:// and lead nowhere. */
      if (/^[\w-]+(\.[\w-]+)+\/\S/.test(t)) return { ok: true, link: 'https://' + t, local: WEB };
      return { ok: false, motivo: 'INCOMPLETO' };
    }

    var esquema = comEsquema[1].toLowerCase() + ':';
    if (esquema === 'file:') return { ok: true, link: t, local: REDE };
    if (ESQUEMAS_WEB.indexOf(esquema) === -1) return { ok: false, motivo: 'ESQUEMA_RECUSADO' };
    /* "https:" on its own passes the scheme test but leads nowhere. */
    if (!/^https?:\/\/[^\/\s]+/i.test(t)) return { ok: false, motivo: 'INCOMPLETO' };
    return { ok: true, link: t, local: WEB };
  }

  /* Network paths and file:// do not open on click — the browser blocks navigation from a
     page to the file system. The screen shows the path to copy instead, so knowing this is
     a rendering decision and belongs here. */
  function abrePorClique(documento) {
    return (documento && documento.local) === WEB;
  }

  /* Builds the document from what the screen collected. Returns { ok, documento } or
     { ok: false, motivo }. An empty name takes the tail of the link, which is almost always
     the file name — better than retyping what the address already carries. */
  function criar(dados, perfil, quando) {
    var d = dados || {};
    var lido = interpretarLink(d.link);
    if (!lido.ok) return { ok: false, motivo: MOTIVOS[lido.motivo] || lido.motivo };

    var nome = String(d.nome == null ? '' : d.nome).trim() || nomeDoLink(lido.link);
    var tipo = util.porId(TIPOS, d.tipo) ? d.tipo : 'OUTRO';

    return {
      ok: true,
      documento: {
        id: util.id('DOC'),
        tipo: tipo,
        nome: nome,
        link: lido.link,
        local: lido.local,
        /* Ties the document to the calibration record it evidences, when there is one. */
        refId: d.refId || '',
        observacao: String(d.observacao == null ? '' : d.observacao).trim(),
        perfil: perfil || '',
        anexadoEm: quando || util.hoje()
      }
    };
  }

  /* Last chunk of the address, without query or trailing slash and with %20 undone. */
  function nomeDoLink(link) {
    var limpo = String(link).split(/[?#]/)[0].replace(/[\/\\]+$/, '');
    var partes = limpo.split(/[\/\\]/);
    var fim = partes[partes.length - 1] || limpo;
    try { fim = decodeURIComponent(fim); } catch (erro) { /* a stray % is left as it is */ }
    return fim || limpo;
  }

  function doTipo(documentos, tipo) {
    return (documentos || []).filter(function (d) { return d.tipo === tipo; });
  }

  function tem(documentos, tipo) {
    return doTipo(documentos, tipo).length > 0;
  }

  /* Count per type, for the screen footer and for the list column. */
  function resumo(documentos) {
    var contas = { total: (documentos || []).length };
    TIPOS.forEach(function (t) { contas[t.id] = doTipo(documentos, t.id).length; });
    return contas;
  }

  TC.documentos = {
    TIPOS: TIPOS,
    MOTIVOS: MOTIVOS,
    WEB: WEB,
    REDE: REDE,
    tipos: tipos,
    nomeDoTipo: nomeDoTipo,
    tipoSugerido: tipoSugerido,
    interpretarLink: interpretarLink,
    abrePorClique: abrePorClique,
    nomeDoLink: nomeDoLink,
    criar: criar,
    doTipo: doTipo,
    tem: tem,
    resumo: resumo
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.documentos;
})(typeof globalThis !== 'undefined' ? globalThis : this);
