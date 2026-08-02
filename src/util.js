/* Utilitários gerais: datas (sempre em UTC, formato ISO YYYY-MM-DD), moeda e DOM. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});

  var MS_DIA = 86400000;
  var NOMES_DIA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  var NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  /* Converte 'YYYY-MM-DD' em Date UTC à meia-noite. */
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

  /* '2026-07-26' -> '26/jul' ou '26/07/2026' quando completo. */
  function formatarData(iso, completo) {
    if (!iso) return '—';
    var d = paraData(iso);
    if (completo) {
      return String(d.getUTCDate()).padStart(2, '0') + '/' +
        String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear();
    }
    return String(d.getUTCDate()).padStart(2, '0') + '/' + NOMES_MES[d.getUTCMonth()];
  }

  /* Valores de catálogo e totais são lidos em milhares: centavos só poluem. A exceção é
     o hourly rate, que é negociado com centavos — daí o parâmetro. */
  function formatarMoeda(valor, casas) {
    var decimais = casas || 0;
    return 'R$ ' + Number(valor || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: decimais,
      maximumFractionDigits: decimais
    });
  }

  /* Hourly rate: sempre com centavos. */
  function formatarTaxa(valor) {
    return formatarMoeda(valor, 2);
  }

  /* Horas -> '72 h (3 d)' para leitura rápida no catálogo. */
  function formatarHoras(horas) {
    if (horas < 24) return horas + ' h';
    var dias = horas / 24;
    return horas + ' h (' + (Math.round(dias * 10) / 10) + ' d)';
  }

  /* Corta um texto longo para caber numa célula, preservando a leitura. */
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
