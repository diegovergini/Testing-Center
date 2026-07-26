/* Testing Center — utilitários compartilhados (datas, moeda, formatação).
   Carregado como script clássico no navegador e como módulo CommonJS nos testes. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.TC = root.TC || {}).util = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIA_MS = 86400000;

  /* Datas são sempre strings ISO 'YYYY-MM-DD' e a aritmética é feita em UTC,
     para que o fuso do navegador nunca desloque um dia do planejamento. */
  function paraTimestamp(iso) {
    var p = String(iso).slice(0, 10).split('-');
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function paraISO(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  function addDias(iso, n) {
    return paraISO(paraTimestamp(iso) + n * DIA_MS);
  }

  function diffDias(de, ate) {
    return Math.round((paraTimestamp(ate) - paraTimestamp(de)) / DIA_MS);
  }

  function diaDaSemana(iso) {
    return new Date(paraTimestamp(iso)).getUTCDay(); // 0 = domingo
  }

  function ehFimDeSemana(iso) {
    var d = diaDaSemana(iso);
    return d === 0 || d === 6;
  }

  function maiorData() {
    var maior = null;
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (!v) continue;
      if (maior === null || v > maior) maior = v;
    }
    return maior;
  }

  function hojeISO() {
    return new Date().toISOString().slice(0, 10);
  }

  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function dataCurta(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + '/' + p[1];
  }

  function dataLonga(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p[2] + ' ' + MESES[Number(p[1]) - 1] + ' ' + p[0];
  }

  function rotuloMes(iso) {
    var p = String(iso).slice(0, 10).split('-');
    return MESES[Number(p[1]) - 1] + '/' + p[0].slice(2);
  }

  /* Moeda e números — pt-BR, sem centavos (valores de ensaio são altos). */
  function moeda(v) {
    var n = Number(v) || 0;
    return 'R$\u00a0' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }

  function moedaCompacta(v) {
    var n = Number(v) || 0;
    if (Math.abs(n) >= 1000000) return 'R$\u00a0' + (n / 1000000).toFixed(1).replace('.', ',') + '\u00a0M';
    if (Math.abs(n) >= 1000) return 'R$\u00a0' + Math.round(n / 1000) + '\u00a0k';
    return moeda(n);
  }

  function numero(v, casas) {
    var n = Number(v) || 0;
    return n.toLocaleString('pt-BR', { maximumFractionDigits: casas == null ? 0 : casas });
  }

  /* Duração de ensaio: engenheiro pensa em horas até ~72h, depois em dias. */
  function duracao(horas) {
    var h = Number(horas) || 0;
    if (h < 72) return numero(h) + ' h';
    var dias = h / 24;
    return numero(h) + ' h (' + numero(dias, 1) + ' d)';
  }

  function slug(s) {
    return String(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function normalizar(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function indexarPor(lista, chave) {
    var mapa = {};
    (lista || []).forEach(function (item) { mapa[item[chave || 'id']] = item; });
    return mapa;
  }

  function soma(lista, fn) {
    return (lista || []).reduce(function (acc, item) { return acc + (Number(fn(item)) || 0); }, 0);
  }

  function agrupar(lista, fn) {
    var mapa = new Map();
    (lista || []).forEach(function (item) {
      var k = fn(item);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(item);
    });
    return mapa;
  }

  function id(prefixo) {
    return prefixo + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  return {
    DIA_MS: DIA_MS,
    paraTimestamp: paraTimestamp,
    paraISO: paraISO,
    addDias: addDias,
    diffDias: diffDias,
    diaDaSemana: diaDaSemana,
    ehFimDeSemana: ehFimDeSemana,
    maiorData: maiorData,
    hojeISO: hojeISO,
    dataCurta: dataCurta,
    dataLonga: dataLonga,
    rotuloMes: rotuloMes,
    moeda: moeda,
    moedaCompacta: moedaCompacta,
    numero: numero,
    duracao: duracao,
    slug: slug,
    normalizar: normalizar,
    indexarPor: indexarPor,
    soma: soma,
    agrupar: agrupar,
    id: id
  };
});
