/* Instrument calibration management.
   It answers the manager's questions: what is calibrated, what expires this month, and what
   has already expired while still in use — that last one is the serious case, because it
   means a test running on an out-of-date instrument. Pure and tested; the screen only
   draws. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util || (typeof require !== 'undefined' ? require('./util.js') : null);

  /* Operating condition of the instrument, from the "Observações" column of the source
     spreadsheet (the header is kept as the lab writes it). */
  var SITUACOES = [
    { id: 'EM_USO', nome: 'In use', cor: 'ok' },
    { id: 'EM_CALIBRACAO', nome: 'Being calibrated', cor: 'alerta' },
    { id: 'AGUARDANDO', nome: 'Awaiting calibration', cor: 'alerta' },
    { id: 'FORA_DE_USO', nome: 'Out of service', cor: '' }
  ];

  /* Result of a calibration. "Approved with restriction" exists because it is common: the
     certificate comes back with a deviation inside the usable tolerance but outside the
     nominal one. */
  var RESULTADOS = [
    { id: 'APROVADO', nome: 'Approved', cor: 'ok' },
    { id: 'APROVADO_RESTRICAO', nome: 'Approved with restriction', cor: 'alerta' },
    { id: 'REPROVADO', nome: 'Failed', cor: 'erro' }
  ];

  /* Calibration due status — this is what the screen colours.
     SEM_PLANO is not a fault of the instrument, it is a gap in the register: someone has to
     say when it was last calibrated. */
  var VENCIDO = 'VENCIDO';
  var A_VENCER = 'A_VENCER';
  var EM_DIA = 'EM_DIA';
  var SEM_PLANO = 'SEM_PLANO';

  var DIAS_DE_ALERTA = 30;

  function nomeSituacao(id) {
    var s = util.porId(SITUACOES, id);
    return s ? s.nome : id;
  }

  function nomeResultado(id) {
    var r = util.porId(RESULTADOS, id);
    return r ? r.nome : id;
  }

  /* Adds months to an ISO date without depending on the time zone: the day is preserved
     unless the target month is shorter (31 Jan + 1 month = 28 Feb). */
  function somaMeses(iso, meses) {
    if (!iso) return '';
    var ano = Number(iso.slice(0, 4));
    var mes = Number(iso.slice(5, 7)) - 1 + Number(meses || 0);
    var dia = Number(iso.slice(8, 10));
    var anoFinal = ano + Math.floor(mes / 12);
    var mesFinal = ((mes % 12) + 12) % 12;
    var ultimoDoMes = new Date(Date.UTC(anoFinal, mesFinal + 1, 0)).getUTCDate();
    return anoFinal + '-' + String(mesFinal + 1).padStart(2, '0') + '-' +
      String(Math.min(dia, ultimoDoMes)).padStart(2, '0');
  }

  /* A due date that was entered wins over the computed one: the certificate sometimes
     carries a validity that is not the instrument's standard interval.

     A failed calibration has no validity at all. Without this guard, the date of the failure
     itself plus the interval would yield a future due date — the instrument would show as
     "in date" because it failed, which is the opposite of what happened. */
  function vencimento(instrumento) {
    if (instrumento.ultimoResultado === 'REPROVADO') return '';
    if (instrumento.proximaCalibracao) return instrumento.proximaCalibracao;
    if (instrumento.ultimaCalibracao && instrumento.periodicidadeMeses) {
      return somaMeses(instrumento.ultimaCalibracao, instrumento.periodicidadeMeses);
    }
    return '';
  }

  function situacaoDoPrazo(instrumento, hoje) {
    var vence = vencimento(instrumento);
    if (!vence) return SEM_PLANO;
    var dias = util.diffDias(hoje, vence);
    if (dias < 0) return VENCIDO;
    if (dias <= DIAS_DE_ALERTA) return A_VENCER;
    return EM_DIA;
  }

  /* Everything the table row and the KPI tiles need from an instrument. */
  function estado(instrumento, hoje) {
    var vence = vencimento(instrumento);
    var prazo = situacaoDoPrazo(instrumento, hoje);
    return {
      instrumento: instrumento,
      vencimento: vence,
      prazo: prazo,
      diasParaVencer: vence ? util.diffDias(hoje, vence) : null,
      /* Expired and in use is the finding an audit looks for: a test running on an
         out-of-date measurement. Back-up and out of service do not weigh the same. */
      criticidade: prazo === VENCIDO && instrumento.situacao === 'EM_USO' && instrumento.ativo
        ? 'CRITICO' : prazo === VENCIDO ? 'ATENCAO' : '',
      ultimaCalibracao: instrumento.ultimaCalibracao || '',
      ultimoRegistro: (instrumento.historico || []).slice().sort(function (a, b) {
        return util.diffDias(b.data, a.data);
      })[0] || null
    };
  }

  function lista(instrumentos, hoje) {
    return (instrumentos || []).map(function (i) { return estado(i, hoje); });
  }

  /* Counts for the screen header. */
  function resumo(instrumentos, hoje) {
    var contas = {
      total: 0, ativos: 0, emUso: 0, emCalibracao: 0, backup: 0,
      vencidos: 0, aVencer: 0, emDia: 0, semPlano: 0, criticos: 0
    };
    lista(instrumentos, hoje).forEach(function (e) {
      var i = e.instrumento;
      contas.total++;
      if (i.ativo) contas.ativos++;
      if (i.situacao === 'EM_USO') contas.emUso++;
      if (i.situacao === 'EM_CALIBRACAO') contas.emCalibracao++;
      if (i.backup) contas.backup++;
      if (e.prazo === VENCIDO) contas.vencidos++;
      if (e.prazo === A_VENCER) contas.aVencer++;
      if (e.prazo === EM_DIA) contas.emDia++;
      if (e.prazo === SEM_PLANO) contas.semPlano++;
      if (e.criticidade === 'CRITICO') contas.criticos++;
    });
    /* Coverage: of those with a plan, how many are within validity. */
    var comPlano = contas.total - contas.semPlano;
    contas.cobertura = comPlano ? (contas.emDia + contas.aVencer) / comPlano : null;
    return contas;
  }

  /* What falls due within the horizon, most urgent first — the work queue of whoever sends
     instruments out for calibration. */
  function agenda(instrumentos, hoje, dias) {
    var limite = dias || 90;
    return lista(instrumentos, hoje)
      .filter(function (e) {
        return e.prazo === VENCIDO ||
          (e.diasParaVencer !== null && e.diasParaVencer <= limite);
      })
      .sort(function (a, b) { return a.diasParaVencer - b.diasParaVencer; });
  }

  /* ---- Bulk entry ----------------------------------------------------------------------

     There are 229 instruments. Opening one dialog per instrument to type the last
     calibration date is a full day's work, so bulk entry exists: paste the slice of the
     spreadsheet (code and date, optionally certificate and laboratory) and the platform
     checks it row by row before saving anything. */

  var DIAS_NO_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  function diasDoMes(ano, mes) {
    if (mes !== 2) return DIAS_NO_MES[mes - 1];
    return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0 ? 29 : 28;
  }

  function montarISO(ano, mes, dia) {
    if (mes < 1 || mes > 12 || dia < 1 || dia > diasDoMes(ano, mes)) return '';
    return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
  }

  /* Accepts what comes out of a Brazilian spreadsheet (31/12/2025, 31-12-25, 31.12.2025)
     and ISO as well. An impossible date — 31/02, month 13 — returns empty instead of
     becoming another day: a wrong calibration date is worse than a missing one. */
  function interpretarData(texto) {
    var t = String(texto == null ? '' : texto).trim();
    if (!t) return '';
    var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (iso) return montarISO(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    var br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
    if (br) {
      var ano = Number(br[3]);
      /* Two-digit year: a calibration certificate is a recent document. */
      if (br[3].length === 2) ano += 2000;
      return montarISO(ano, Number(br[2]), Number(br[1]));
    }
    return '';
  }

  /* A row pasted from Excel comes tab-separated; from a CSV, by ; or ,. */
  function separarCampos(linha) {
    var campos = linha.split(/\t|;/);
    if (campos.length === 1) campos = linha.split(',');
    if (campos.length === 1) campos = linha.trim().split(/\s{2,}|\s+/);
    return campos.map(function (c) { return c.trim(); });
  }

  /* Matches on the current code and, failing that, on the legacy code — the calibration
     spreadsheet is usually still on the old numbering. */
  function acharInstrumento(instrumentos, codigo) {
    var alvo = codigo.toUpperCase();
    var porAntigo = null;
    for (var n = 0; n < instrumentos.length; n++) {
      var i = instrumentos[n];
      if (String(i.id).toUpperCase() === alvo) return i;
      if (!porAntigo && i.codigoAntigo && String(i.codigoAntigo).toUpperCase() === alvo) {
        porAntigo = i;
      }
    }
    return porAntigo;
  }

  /* Reads the pasted text and returns what will be saved and what cannot be, without
     touching anything — the screen shows both lists and only saves after confirmation. */
  function interpretarLote(texto, instrumentos) {
    var linhas = [];
    var jaVistos = {};
    String(texto == null ? '' : texto).split(/\r?\n/).forEach(function (bruta, indice) {
      if (!bruta.trim()) return;
      var campos = separarCampos(bruta);
      var codigo = campos[0] || '';
      /* A header copied along with the data is not the user's mistake: it is ignored. */
      if (/^(c[oó]d|code|tag)/i.test(codigo)) return;

      var registro = {
        linha: indice + 1, codigo: codigo, data: interpretarData(campos[1]),
        certificado: campos[2] || '', laboratorio: campos[3] || '',
        instrumento: null, situacao: 'OK'
      };
      var instrumento = codigo ? acharInstrumento(instrumentos || [], codigo) : null;

      if (!codigo) registro.situacao = 'SEM_CODIGO';
      else if (!instrumento) registro.situacao = 'DESCONHECIDO';
      else if (!registro.data) registro.situacao = 'DATA_INVALIDA';
      else if (jaVistos[instrumento.id]) registro.situacao = 'REPETIDO';

      if (instrumento) {
        registro.instrumento = instrumento;
        if (registro.situacao === 'OK') jaVistos[instrumento.id] = true;
      }
      linhas.push(registro);
    });

    return {
      linhas: linhas,
      aplicaveis: linhas.filter(function (l) { return l.situacao === 'OK'; }),
      problemas: linhas.filter(function (l) { return l.situacao !== 'OK'; })
    };
  }

  var MOTIVOS_DO_LOTE = {
    SEM_CODIGO: 'row without a code',
    DESCONHECIDO: 'code does not exist in the inventory',
    DATA_INVALIDA: 'date missing or invalid',
    REPETIDO: 'code repeated in the paste'
  };

  TC.calibracao = {
    SITUACOES: SITUACOES,
    MOTIVOS_DO_LOTE: MOTIVOS_DO_LOTE,
    interpretarData: interpretarData,
    interpretarLote: interpretarLote,
    RESULTADOS: RESULTADOS,
    VENCIDO: VENCIDO,
    A_VENCER: A_VENCER,
    EM_DIA: EM_DIA,
    SEM_PLANO: SEM_PLANO,
    DIAS_DE_ALERTA: DIAS_DE_ALERTA,
    nomeSituacao: nomeSituacao,
    nomeResultado: nomeResultado,
    somaMeses: somaMeses,
    vencimento: vencimento,
    situacaoDoPrazo: situacaoDoPrazo,
    estado: estado,
    lista: lista,
    resumo: resumo,
    agenda: agenda
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.calibracao;
})(typeof globalThis !== 'undefined' ? globalThis : this);
