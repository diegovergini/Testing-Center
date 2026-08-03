/* General helpers: dates (always UTC, ISO YYYY-MM-DD), currency and DOM.

   Dates are shown as "26 Jul 2026", never 26/07 or 07/26: the platform runs in English for
   a Brazilian team, and a numeric month is read one way by each of them. The month name
   removes the ambiguity at the cost of two characters. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});

  var MS_DIA = 86400000;
  var NOMES_DIA = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var NOMES_MES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* Turns 'YYYY-MM-DD' into a UTC Date at midnight. */
  function paraData(iso) {
    var p = String(iso).slice(0, 10).split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }

  function paraISO(data) {
    return data.toISOString().slice(0, 10);
  }

  function somaDias(iso, dias) {
    return paraISO(new Date(paraData(iso).getTime() + dias * MS_DIA));
  }

  function diffDias(isoA, isoB) {
    return Math.round((paraData(isoB) - paraData(isoA)) / MS_DIA);
  }

  function diaDaSemana(iso) {
    return paraData(iso).getUTCDay();
  }

  function hoje() {
    return paraISO(new Date());
  }

  function maiorData(a, b) {
    return diffDias(a, b) > 0 ? b : a;
  }

  /* '2026-07-26' -> '26 Jul', or '26 Jul 2026' when complete. */
  function formatarData(iso, completo) {
    if (!iso) return '—';
    var d = paraData(iso);
    var curto = String(d.getUTCDate()).padStart(2, '0') + ' ' + NOMES_MES[d.getUTCMonth()];
    return completo ? curto + ' ' + d.getUTCFullYear() : curto;
  }

  /* Catalogue values and totals are read in thousands: cents only add noise. The exception
     is the hourly rate, negotiated down to cents — hence the parameter.

     The currency stays BRL, which is what the test centre charges in, but the grouping is
     the English one: "R$ 3,800" in a page that reads "R$ 3.800" would be taken for three
     point eight by half the people opening it. */
  function formatarMoeda(valor, casas) {
    var decimais = casas || 0;
    return 'R$ ' + Number(valor || 0).toLocaleString('en-US', {
      minimumFractionDigits: decimais,
      maximumFractionDigits: decimais
    });
  }

  /* Hourly rate: always with cents. */
  function formatarTaxa(valor) {
    return formatarMoeda(valor, 2);
  }

  /* Hours -> '72 h (3 d)', for quick reading in the catalogue. */
  function formatarHoras(horas) {
    if (horas < 24) return horas + ' h';
    var dias = horas / 24;
    return horas + ' h (' + (Math.round(dias * 10) / 10) + ' d)';
  }

  /* Trims a long text to fit a table cell without breaking the reading. */
  function recortar(texto, limite) {
    var t = String(texto == null ? '' : texto);
    return t.length > limite ? t.slice(0, limite - 1).trimEnd() + '…' : t;
  }

  function escapar(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function id(prefixo) {
    return prefixo + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function porId(lista, chave) {
    for (var i = 0; i < lista.length; i++) if (lista[i].id === chave) return lista[i];
    return null;
  }

  TC.util = {
    MS_DIA: MS_DIA,
    NOMES_DIA: NOMES_DIA,
    paraData: paraData,
    paraISO: paraISO,
    somaDias: somaDias,
    diffDias: diffDias,
    diaDaSemana: diaDaSemana,
    hoje: hoje,
    maiorData: maiorData,
    formatarData: formatarData,
    formatarMoeda: formatarMoeda,
    formatarTaxa: formatarTaxa,
    formatarHoras: formatarHoras,
    escapar: escapar,
    recortar: recortar,
    id: id,
    porId: porId
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.util;
})(typeof globalThis !== 'undefined' ? globalThis : this);
