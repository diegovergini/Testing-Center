/* Gestão da calibração dos instrumentos.
   Responde as perguntas do gestor: o que está calibrado, o que vence este mês, o que já
   venceu e está em uso — este último é o caso grave, porque significa ensaio rodando com
   instrumento fora da validade. Puro e testado; a tela só desenha. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util || (typeof require !== 'undefined' ? require('./util.js') : null);

  /* Situação operacional do instrumento, na coluna "Observações" da planilha de origem. */
  var SITUACOES = [
    { id: 'EM_USO', nome: 'Em uso', cor: 'ok' },
    { id: 'EM_CALIBRACAO', nome: 'Em calibração', cor: 'alerta' },
    { id: 'AGUARDANDO', nome: 'Aguardando calibração', cor: 'alerta' },
    { id: 'FORA_DE_USO', nome: 'Fora de uso', cor: '' }
  ];

  /* Resultado de uma calibração. "Aprovado com restrição" existe porque é comum: o
     certificado sai com desvio dentro da tolerância de uso, mas fora da nominal. */
  var RESULTADOS = [
    { id: 'APROVADO', nome: 'Aprovado', cor: 'ok' },
    { id: 'APROVADO_RESTRICAO', nome: 'Aprovado com restrição', cor: 'alerta' },
    { id: 'REPROVADO', nome: 'Reprovado', cor: 'erro' }
  ];

  /* Situação do prazo de calibração — é isto que a tela colore.
     SEM_PLANO não é um erro do instrumento, é uma lacuna do cadastro: alguém precisa
     informar quando ele foi calibrado pela última vez. */
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

  /* Soma meses a uma data ISO sem depender de fuso: o dia é preservado, salvo quando o mês
     de destino é mais curto (31/01 + 1 mês = 28/02). */
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

  /* O vencimento informado tem precedência sobre o calculado: o certificado às vezes traz
     uma validade que não é a periodicidade padrão do instrumento.

     Reprovado não tem validade nenhuma. Sem esta guarda, a data da própria reprovação mais
     a periodicidade renderia um vencimento futuro — o instrumento apareceria "em dia" por
     ter sido reprovado, que é o oposto do que aconteceu. */
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

  /* Tudo que a linha da tabela e os indicadores precisam de um instrumento. */
  function estado(instrumento, hoje) {
    var vence = vencimento(instrumento);
    var prazo = situacaoDoPrazo(instrumento, hoje);
    return {
      instrumento: instrumento,
      vencimento: vence,
      prazo: prazo,
      diasParaVencer: vence ? util.diffDias(hoje, vence) : null,
      /* Instrumento vencido e em uso é o achado que a auditoria procura: ensaio rodando
         com medição fora da validade. Back-up e fora de uso não pesam do mesmo jeito. */
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

  /* Contagens do cabeçalho da janela. */
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
    /* Cobertura: dos que têm plano, quantos estão dentro da validade. */
    var comPlano = contas.total - contas.semPlano;
    contas.cobertura = comPlano ? (contas.emDia + contas.aVencer) / comPlano : null;
    return contas;
  }

  /* O que vence dentro do horizonte, do mais urgente para o menos — é a fila de trabalho
     de quem manda instrumento para calibrar. */
  function agenda(instrumentos, hoje, dias) {
    var limite = dias || 90;
    return lista(instrumentos, hoje)
      .filter(function (e) {
        return e.prazo === VENCIDO ||
          (e.diasParaVencer !== null && e.diasParaVencer <= limite);
      })
      .sort(function (a, b) { return a.diasParaVencer - b.diasParaVencer; });
  }

  TC.calibracao = {
    SITUACOES: SITUACOES,
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
