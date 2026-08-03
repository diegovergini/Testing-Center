/* Peças de interface reaproveitadas pelas telas: modal, notificação, etiquetas e filtros. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util;
  var e = util.escapar;

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  var modalAberto = null;

  function fecharModal() {
    if (modalAberto) { modalAberto.remove(); modalAberto = null; }
  }

  /* opcoes: { titulo, corpo (HTML), confirmar, aoConfirmar(formulario) -> bool|undefined, largura } */
  function modal(opcoes) {
    fecharModal();
    var fundo = el(
      '<div class="modal-fundo">' +
        '<div class="modal" role="dialog" aria-modal="true">' +
          '<div class="modal-topo"><h3>' + e(opcoes.titulo) + '</h3>' +
            '<button class="fechar" aria-label="Fechar">&times;</button></div>' +
          '<form class="modal-corpo"></form>' +
          '<div class="modal-pe">' +
            '<button type="button" class="botao cancelar">Cancelar</button>' +
            (opcoes.confirmar === null ? '' :
              '<button type="button" class="botao primario confirmar">' + e(opcoes.confirmar || 'Salvar') + '</button>') +
          '</div>' +
        '</div>' +
      '</div>'
    );
    fundo.querySelector('.modal-corpo').innerHTML = opcoes.corpo;
    if (opcoes.largura) fundo.querySelector('.modal').style.width = opcoes.largura;

    var formulario = fundo.querySelector('.modal-corpo');
    formulario.addEventListener('submit', function (ev) { ev.preventDefault(); confirmar(); });

    function confirmar() {
      if (!opcoes.aoConfirmar) return fecharModal();
      var valores = {};
      formulario.querySelectorAll('[name]').forEach(function (campo) {
        if (campo.type === 'checkbox') {
          if (campo.dataset.grupo) {
            valores[campo.name] = valores[campo.name] || [];
            if (campo.checked) valores[campo.name].push(campo.value);
          } else {
            valores[campo.name] = campo.checked;
          }
        } else {
          valores[campo.name] = campo.value;
        }
      });
      if (opcoes.aoConfirmar(valores, formulario) !== false) fecharModal();
    }

    fundo.querySelector('.fechar').onclick = fecharModal;
    fundo.querySelector('.cancelar').onclick = fecharModal;
    var btn = fundo.querySelector('.confirmar');
    if (btn) btn.onclick = confirmar;
    fundo.addEventListener('mousedown', function (ev) { if (ev.target === fundo) fecharModal(); });

    document.body.appendChild(fundo);
    modalAberto = fundo;
    var primeiro = formulario.querySelector('input, select, textarea');
    if (primeiro) primeiro.focus();
    return fundo;
  }

  function confirmarAcao(mensagem, aoConfirmar) {
    modal({
      titulo: 'Confirmar',
      corpo: '<p style="margin:0">' + e(mensagem) + '</p>',
      confirmar: 'Confirmar',
      aoConfirmar: function () { aoConfirmar(); }
    });
  }

  var temporizador = null;
  function notificar(mensagem) {
    var antigo = document.querySelector('.notificacao');
    if (antigo) antigo.remove();
    var n = el('<div class="notificacao">' + e(mensagem) + '</div>');
    document.body.appendChild(n);
    clearTimeout(temporizador);
    temporizador = setTimeout(function () { n.remove(); }, 3200);
  }

  function etiquetaArea(area) {
    var mapa = { HOT: ['hot', 'Hot End'], COLD: ['cold', 'Cold End'], AMBOS: ['ambos', 'Hot & Cold'] };
    var m = mapa[area] || ['', area];
    return '<span class="etiqueta ' + m[0] + '">' + e(m[1]) + '</span>';
  }

  /* O status vem do fluxo: nome e cor moram lá, junto das regras de passagem. */
  function etiquetaEstado(tipo, status) {
    var st = TC.fluxo.estado(tipo, status);
    return '<span class="etiqueta ' + (st ? st.cor : '') + '">' +
      e(st ? st.nome : status) + '</span>';
  }

  function etiquetaStatus(status) {
    return etiquetaEstado('demanda', status);
  }

  /* Histórico do fluxo: quem moveu, quando, de onde para onde e por quê. É o que permite
     auditar uma demanda meses depois sem depender da memória de ninguém. */
  function historico(tipo, registro) {
    var linhas = registro.historico || [];
    if (!linhas.length) {
      return '<p class="sub" style="margin:10px 0 0">Sem passagens registradas ainda.</p>';
    }
    return '<div class="campo" style="margin-top:14px"><label>Histórico</label>' +
      '<div class="lista-selecao" style="max-height:180px">' +
      linhas.slice().reverse().map(function (h) {
        return '<div class="linha-selecao" style="display:block">' +
          '<div><span class="sub mono">' + e(util.formatarData(h.em, true)) + '</span> · ' +
          e(TC.fluxo.nomeDoEstado(tipo, h.de)) + ' → <strong>' +
          e(TC.fluxo.nomeDoEstado(tipo, h.para)) + '</strong>' +
          (h.perfil ? ' <span class="sub">por ' + e(TC.permissoes.nomeDoPerfil(h.perfil)) + '</span>' : '') +
          '</div>' +
          (h.nota ? '<div class="sub">' + e(h.nota) + '</div>' : '') +
          '</div>';
      }).join('') + '</div></div>';
  }

  /* Diálogo de uma passagem de fluxo: mostra o que vai acontecer, pede o que a transição
     exige e só então grava. Serve para demanda e cotação. */
  function moverNoFluxo(opcoes) {
    var tipo = opcoes.tipo, registro = opcoes.registro, para = opcoes.para;
    var t = TC.fluxo.transicao(tipo, registro.status, para);
    if (!t) { notificar('Passagem indisponível.'); return; }

    var campos = '';
    (t.exige || []).forEach(function (campo) {
      var rotulo = campo === 'dataConclusao' ? 'Data de conclusão do ensaio'
        : campo === 'dataRelatorio' ? 'Data de validação pelo cliente' : campo;
      campos += '<div class="campo"><label>' + e(rotulo) + '</label>' +
        '<input type="date" name="' + e(campo) + '" value="' +
        e(registro[campo] || util.hoje()) + '"></div>';
    });

    var janela = modal({
      titulo: t.rotulo,
      corpo:
        '<div class="aviso">' +
          e(TC.fluxo.nomeDoEstado(tipo, registro.status)) + ' → <strong>' +
          e(TC.fluxo.nomeDoEstado(tipo, para)) + '</strong>' +
          (t.descricao ? '<br>' + e(t.descricao) : '') +
          (t.contaCorrecao ? '<br><strong>Esta devolução conta uma rodada de correção</strong> ' +
            'e afeta o indicador de certo da primeira vez.' : '') +
        '</div>' +
        campos +
        '<div class="campo"><label>Observação' +
          (t.exigeNota ? '' : ' <span class="sub" style="font-weight:400">(opcional)</span>') +
          '</label><textarea name="nota" rows="2" placeholder="Fica registrada no histórico"></textarea></div>',
      confirmar: t.rotulo,
      aoConfirmar: function (v) {
        var resultado = opcoes.aoMover(v);
        if (!resultado.ok) { notificar(resultado.motivo); return false; }
        notificar(t.rotulo + ': ' + TC.fluxo.nomeDoEstado(tipo, para) + '.');
      }
    });
    return janela;
  }

  /* ---- Documentos anexados -------------------------------------------------------------

     Mesmo painel na demanda e no instrumento: lista o que está anexado e, para quem pode
     editar, um formulário curto para anexar mais um. Grava direto no store ao anexar, sem
     esperar o "Salvar" da janela — o documento é do registro, não da edição em curso, e
     quem fecha a janela no X não espera perder o anexo que acabou de colar.

     Os campos não usam name= de propósito: o modal recolhe todo [name] do formulário e os
     campos daqui virariam campos do registro que a janela está editando. */
  function linhaDocumento(documento, podeEditar) {
    var doc = TC.documentos;
    var titulo = e(documento.nome || doc.nomeDoLink(documento.link));
    var alvo = doc.abrePorClique(documento)
      ? '<a href="' + e(documento.link) + '" target="_blank" rel="noopener noreferrer">' +
        titulo + '</a>'
      : '<span title="' + e(documento.link) + '">' + titulo + '</span>';

    return '<div class="linha-selecao" style="display:block" data-documento="' + e(documento.id) + '">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span class="etiqueta marca">' + e(doc.nomeDoTipo(documento.tipo)) + '</span>' +
        '<span class="forte" style="flex:1;min-width:0;overflow-wrap:anywhere">' + alvo + '</span>' +
        (podeEditar ? '<button type="button" class="botao pequeno perigo tirar-doc" ' +
          'title="Remover o anexo">✕</button>' : '') +
      '</div>' +
      '<div class="sub mono" style="overflow-wrap:anywhere;margin-top:3px">' + e(documento.link) + '</div>' +
      '<div class="sub" style="margin-top:2px">' +
        (documento.local === doc.REDE ? 'caminho de rede — copie e cole no Explorador · ' : '') +
        'anexado em ' + e(util.formatarData(documento.anexadoEm, true)) +
        (documento.perfil ? ' por ' + e(TC.permissoes.nomeDoPerfil(documento.perfil)) : '') +
        (documento.observacao ? ' · ' + e(documento.observacao) : '') +
      '</div>' +
    '</div>';
  }

  /* alvo: { registro, contexto: 'demanda'|'instrumento', podeEditar, rotulo } */
  function painelDocumentos(alvo) {
    var doc = TC.documentos;
    var lista = alvo.registro.documentos || [];
    var perfil = TC.permissoes.perfilAtual(TC.store.get());

    var formulario = !alvo.podeEditar ? '' :
      '<div class="grade-campos" style="margin-top:8px">' +
        '<div class="campo"><label>Tipo</label><select data-doc="tipo">' +
          opcoes(doc.tipos(alvo.contexto), doc.tipoSugerido(alvo.contexto, perfil)) +
        '</select></div>' +
        '<div class="campo"><label>Nome <span class="sub" style="font-weight:400">(opcional)</span></label>' +
          '<input data-doc="nome" placeholder="Sai do fim do link se ficar vazio"></div>' +
      '</div>' +
      '<div class="campo"><label>Link do documento</label>' +
        '<div style="display:flex;gap:8px">' +
          '<input data-doc="link" placeholder="https://empresa.sharepoint.com/... ou \\\\servidor\\pasta\\arquivo.pdf">' +
          '<button type="button" class="botao primario anexar-doc" style="white-space:nowrap">Anexar</button>' +
        '</div>' +
        '<p class="sub" style="margin:6px 0 0">O arquivo continua no SharePoint, no OneDrive ' +
          'ou na rede; a plataforma guarda o endereço, quem anexou e quando.</p>' +
      '</div>';

    return '<div class="campo" data-painel-documentos style="margin-top:14px">' +
      '<label>' + e(alvo.rotulo || 'Documentos') + ' (' + lista.length + ')</label>' +
      (lista.length
        ? '<div class="lista-selecao" style="max-height:220px">' +
          lista.map(function (d) { return linhaDocumento(d, alvo.podeEditar); }).join('') + '</div>'
        : '<p class="sub" style="margin:0">Nenhum documento anexado.</p>') +
      formulario +
    '</div>';
  }

  /* Liga o painel já desenhado. Redesenha só o painel depois de anexar ou remover, para a
     janela não se fechar nem perder o que a pessoa já digitou nos outros campos. */
  function ligarDocumentos(raiz, alvo) {
    var painel = raiz.querySelector('[data-painel-documentos]');
    if (!painel) return;

    function redesenhar() {
      var atual = TC.store.get();
      var lista = alvo.contexto === 'instrumento' ? atual.instrumentos : atual.demandas;
      var registro = util.porId(lista || [], alvo.registro.id) || alvo.registro;
      alvo.registro = registro;
      var novo = el(painelDocumentos(alvo));
      painel.replaceWith(novo);
      painel = novo;
      ligar();
      if (alvo.aoMudar) alvo.aoMudar(registro);
    }

    function ligar() {
      var botao = painel.querySelector('.anexar-doc');
      if (botao) {
        var campoLink = painel.querySelector('[data-doc="link"]');
        botao.onclick = function () {
          var resultado = TC.store.anexarDocumento(alvo.contexto, alvo.registro.id, {
            tipo: painel.querySelector('[data-doc="tipo"]').value,
            nome: painel.querySelector('[data-doc="nome"]').value,
            link: campoLink.value
          });
          if (!resultado.ok) { notificar(resultado.motivo); campoLink.focus(); return; }
          notificar('Documento anexado.');
          redesenhar();
        };
        /* Enter no campo do link anexa, em vez de disparar o Salvar do modal. */
        campoLink.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); botao.click(); }
        });
      }

      painel.querySelectorAll('[data-documento]').forEach(function (linha) {
        var tirar = linha.querySelector('.tirar-doc');
        if (!tirar) return;
        tirar.onclick = function () {
          TC.store.removerDocumento(alvo.contexto, alvo.registro.id, linha.dataset.documento);
          notificar('Documento removido da lista. O arquivo continua onde estava.');
          redesenhar();
        };
      });
    }

    ligar();
  }

  function etiquetaPrioridade(prioridade) {
    var mapa = { ALTA: 'erro', MEDIA: 'alerta', BAIXA: '' };
    var p = util.porId(TC.data.PRIORIDADES, prioridade);
    return '<span class="etiqueta ' + (mapa[prioridade] || '') + '">' + e(p ? p.nome : prioridade) + '</span>';
  }

  /* Cotação recebe tratamento visual distinto: não é fase de projeto, é orçamento. */
  function etiquetaTipoLti(tipoId) {
    var tipo = util.porId(TC.data.TIPOS_LTI, tipoId);
    var rotulo = tipo ? (tipoId === 'COTACAO' ? tipo.nome : tipoId) : tipoId;
    return '<span class="etiqueta ' + (tipoId === 'COTACAO' ? 'alerta' : 'marca') + '">' + e(rotulo) + '</span>';
  }

  /* O número da LTI é o que o gerente procura na tela; o tipo qualifica. */
  function celulaLti(demanda) {
    return '<div class="mono forte">' + e(demanda.lti || '—') + '</div>' +
      '<div style="margin-top:3px">' + etiquetaTipoLti(demanda.tipoLti) + '</div>';
  }

  function opcoes(lista, selecionado, rotuloVazio) {
    var html = rotuloVazio ? '<option value="">' + e(rotuloVazio) + '</option>' : '';
    return html + lista.map(function (item) {
      return '<option value="' + e(item.id) + '"' + (item.id === selecionado ? ' selected' : '') + '>' +
        e(item.nome) + '</option>';
    }).join('');
  }

  /* Valida campos obrigatórios de um modal. Avisa e põe o foco no primeiro pendente,
     para o usuário não ter que caçar o que faltou.
     campos: [{ nome, rotulo, tipo: 'texto'|'numero', min }] — min padrão 0 em números. */
  function validarObrigatorios(janela, valores, campos) {
    for (var i = 0; i < campos.length; i++) {
      var campo = campos[i];
      var bruto = valores[campo.nome];
      var texto = bruto === undefined || bruto === null ? '' : String(bruto).trim();
      var falha = null;

      if (!texto) {
        falha = 'Preencha ' + campo.rotulo + '.';
      } else if (campo.tipo === 'numero') {
        var minimo = campo.min === undefined ? 0 : campo.min;
        var numero = Number(texto);
        if (isNaN(numero)) falha = campo.rotulo + ' precisa ser um número.';
        else if (numero < minimo) {
          falha = minimo > 0
            ? campo.rotulo + ' precisa ser maior que zero.'
            : campo.rotulo + ' não pode ser negativo.';
        }
      }

      if (falha) {
        notificar(falha);
        var alvo = janela.querySelector('[name=' + campo.nome + ']');
        if (alvo && !alvo.readOnly && !alvo.disabled) alvo.focus();
        return false;
      }
    }
    return true;
  }

  function vazio(titulo, texto) {
    return '<div class="vazio"><strong>' + e(titulo) + '</strong>' + e(texto || '') + '</div>';
  }

  TC.ui = {
    el: el,
    modal: modal,
    fecharModal: fecharModal,
    confirmarAcao: confirmarAcao,
    notificar: notificar,
    etiquetaArea: etiquetaArea,
    etiquetaStatus: etiquetaStatus,
    etiquetaPrioridade: etiquetaPrioridade,
    etiquetaTipoLti: etiquetaTipoLti,
    celulaLti: celulaLti,
    etiquetaEstado: etiquetaEstado,
    historico: historico,
    moverNoFluxo: moverNoFluxo,
    painelDocumentos: painelDocumentos,
    ligarDocumentos: ligarDocumentos,
    opcoes: opcoes,
    validarObrigatorios: validarObrigatorios,
    vazio: vazio
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
