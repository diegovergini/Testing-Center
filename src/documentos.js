/* Documentos anexados aos registros da plataforma.

   O documento aqui é uma referência, não o arquivo: nome, link e quem anexou quando. O
   arquivo continua onde a empresa já guarda documento — SharePoint, OneDrive, unidade de
   rede — e é lá que valem o controle de versão e a política de retenção. A plataforma
   grava tudo num único JSON no navegador (poucos MB no total), então um relatório em PDF
   não caberia; e o link é exatamente o que vira coluna de lista quando isto migrar para o
   SharePoint.

   Módulo puro e testado: valida o link, monta o registro e conta o que está anexado. A
   tela só desenha. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util || (typeof require !== 'undefined' ? require('./util.js') : null);

  /* Natureza do documento. "perfil" é quem normalmente anexa — serve para a tela sugerir
     o tipo certo, não para bloquear: quem pode editar a janela pode anexar qualquer um.
     "contexto" separa o que faz sentido em cada janela. */
  var TIPOS = [
    { id: 'ENTRADA', nome: 'Test input', contexto: 'demanda', perfil: 'PRODUTO',
      descricao: 'O que o solicitante quer testar: especificação, desenho, condição de ensaio' },
    { id: 'RELATORIO', nome: 'Relatório de teste', contexto: 'demanda', perfil: 'TESTES',
      descricao: 'O relatório que vai ao cliente ao fim do ensaio' },
    { id: 'EVIDENCIA', nome: 'Evidência do ensaio', contexto: 'demanda', perfil: 'TESTES',
      descricao: 'Dados brutos, fotos, vídeo, aquisição da bancada' },
    { id: 'CERTIFICADO', nome: 'Certificado de calibração', contexto: 'instrumento', perfil: 'TESTES',
      descricao: 'O certificado emitido pelo laboratório' },
    { id: 'OUTRO', nome: 'Outro documento', contexto: 'ambos', perfil: null,
      descricao: 'Qualquer outro anexo' }
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

  /* Tipo sugerido para quem está com a janela aberta: o solicitante anexa test input, o
     engenheiro de testes anexa relatório. */
  function tipoSugerido(contexto, perfil) {
    var candidatos = tipos(contexto).filter(function (t) { return t.perfil === perfil; });
    return (candidatos[0] || tipos(contexto)[0]).id;
  }

  /* --- Link ----------------------------------------------------------------------------

     Só http(s) e caminho de rede entram. A recusa dos demais esquemas não é preciosismo:
     o link é gravado e depois vira href numa tela que outra pessoa abre, e "javascript:"
     ou "data:" nesse href executa código no lugar de abrir documento. */
  var ESQUEMAS_WEB = ['http:', 'https:'];

  var WEB = 'WEB';
  var REDE = 'REDE';

  var MOTIVOS = {
    SEM_LINK: 'informe o link do documento',
    ESQUEMA_RECUSADO: 'só entram links http, https ou caminho de rede',
    INCOMPLETO: 'o link não parece um endereço completo'
  };

  /* Devolve { ok, link, local } ou { ok: false, motivo }. O link volta normalizado: um
     endereço colado sem esquema ("empresa.sharepoint.com/...") ganha https, que é o que a
     pessoa quis dizer. */
  function interpretarLink(texto) {
    var t = String(texto == null ? '' : texto).trim();
    /* Excel e Outlook colam o endereço entre < >. */
    t = t.replace(/^<+/, '').replace(/>+$/, '').trim();
    if (!t) return { ok: false, motivo: 'SEM_LINK' };

    /* Caminho de rede do Windows: \\servidor\pasta\arquivo.pdf */
    if (/^\\\\[^\\]+\\/.test(t)) return { ok: true, link: t, local: REDE };

    var comEsquema = /^([a-z][a-z0-9+.-]*):/i.exec(t);
    if (!comEsquema) {
      /* Sem esquema, exige servidor com ponto e um caminho depois da barra. Só o ponto não
         serve para decidir: "certificado.pdf" tem a mesma forma de "empresa.com" e é nome
         de arquivo, não endereço — vira https:// e leva a lugar nenhum. */
      if (/^[\w-]+(\.[\w-]+)+\/\S/.test(t)) return { ok: true, link: 'https://' + t, local: WEB };
      return { ok: false, motivo: 'INCOMPLETO' };
    }

    var esquema = comEsquema[1].toLowerCase() + ':';
    if (esquema === 'file:') return { ok: true, link: t, local: REDE };
    if (ESQUEMAS_WEB.indexOf(esquema) === -1) return { ok: false, motivo: 'ESQUEMA_RECUSADO' };
    /* "https:" sozinho passa no teste do esquema mas não leva a lugar nenhum. */
    if (!/^https?:\/\/[^\/\s]+/i.test(t)) return { ok: false, motivo: 'INCOMPLETO' };
    return { ok: true, link: t, local: WEB };
  }

  /* Caminho de rede e file:// não abrem por clique — o navegador bloqueia a navegação de
     uma página para o sistema de arquivos. A tela mostra o caminho para copiar, então
     saber disto é decisão de renderização e mora aqui. */
  function abrePorClique(documento) {
    return (documento && documento.local) === WEB;
  }

  /* Monta o documento a partir do que a tela coletou. Devolve { ok, documento } ou
     { ok: false, motivo }. Nome vazio recebe o fim do link, que é quase sempre o nome do
     arquivo — melhor que obrigar a digitar de novo o que já está no endereço. */
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
        /* Amarra o documento ao registro de calibração que ele comprova, quando houver. */
        refId: d.refId || '',
        observacao: String(d.observacao == null ? '' : d.observacao).trim(),
        perfil: perfil || '',
        anexadoEm: quando || util.hoje()
      }
    };
  }

  /* Último pedaço do endereço, sem query nem barra final e com %20 desfeito. */
  function nomeDoLink(link) {
    var limpo = String(link).split(/[?#]/)[0].replace(/[\/\\]+$/, '');
    var partes = limpo.split(/[\/\\]/);
    var fim = partes[partes.length - 1] || limpo;
    try { fim = decodeURIComponent(fim); } catch (erro) { /* link com % solto fica como está */ }
    return fim || limpo;
  }

  function doTipo(documentos, tipo) {
    return (documentos || []).filter(function (d) { return d.tipo === tipo; });
  }

  function tem(documentos, tipo) {
    return doTipo(documentos, tipo).length > 0;
  }

  /* Contagem por tipo para o rodapé da janela e para a coluna da lista. */
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
