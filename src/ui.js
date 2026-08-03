/* Interface pieces reused by the screens: modal, toast, tags and filters. */
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
            '<button class="fechar" aria-label="Close">&times;</button></div>' +
          '<form class="modal-corpo"></form>' +
          '<div class="modal-pe">' +
            '<button type="button" class="botao cancelar">Cancel</button>' +
            (opcoes.confirmar === null ? '' :
              '<button type="button" class="botao primario confirmar">' + e(opcoes.confirmar || 'Save') + '</button>') +
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
      titulo: 'Confirm',
      corpo: '<p style="margin:0">' + e(mensagem) + '</p>',
      confirmar: 'Confirm',
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

  /* The status comes from the workflow: name and colour live there, next to the move
     rules. */
  function etiquetaEstado(tipo, status) {
    var st = TC.fluxo.estado(tipo, status);
    return '<span class="etiqueta ' + (st ? st.cor : '') + '">' +
      e(st ? st.nome : status) + '</span>';
  }

  function etiquetaStatus(status) {
    return etiquetaEstado('demanda', status);
  }

  /* Workflow history: who moved it, when, from where to where and why. It is what makes a
     request auditable months later without relying on anyone's memory. */
  function historico(tipo, registro) {
    var linhas = registro.historico || [];
    if (!linhas.length) {
      return '<p class="sub" style="margin:10px 0 0">No moves recorded yet.</p>';
    }
    return '<div class="campo" style="margin-top:14px"><label>History</label>' +
      '<div class="lista-selecao" style="max-height:180px">' +
      linhas.slice().reverse().map(function (h) {
        return '<div class="linha-selecao" style="display:block">' +
          '<div><span class="sub mono">' + e(util.formatarData(h.em, true)) + '</span> · ' +
          e(TC.fluxo.nomeDoEstado(tipo, h.de)) + ' → <strong>' +
          e(TC.fluxo.nomeDoEstado(tipo, h.para)) + '</strong>' +
          (h.perfil ? ' <span class="sub">by ' + e(TC.permissoes.nomeDoPerfil(h.perfil)) + '</span>' : '') +
          '</div>' +
          (h.nota ? '<div class="sub">' + e(h.nota) + '</div>' : '') +
          '</div>';
      }).join('') + '</div></div>';
  }

  /* Dialog for a workflow move: it shows what is about to happen, asks for what the
     transition requires and only then saves. Serves both request and quote. */
  function moverNoFluxo(opcoes) {
    var tipo = opcoes.tipo, registro = opcoes.registro, para = opcoes.para;
    var t = TC.fluxo.transicao(tipo, registro.status, para);
    if (!t) { notificar('Move not available.'); return; }

    var campos = '';
    (t.exige || []).forEach(function (campo) {
      var rotulo = campo === 'dataConclusao' ? 'Test completion date'
        : campo === 'dataRelatorio' ? 'Customer sign-off date' : campo;
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
          (t.contaCorrecao ? '<br><strong>This return counts as a rework round</strong> ' +
            'and affects right first time.' : '') +
        '</div>' +
        campos +
        '<div class="campo"><label>Note' +
          (t.exigeNota ? '' : ' <span class="sub" style="font-weight:400">(optional)</span>') +
          '</label><textarea name="nota" rows="2" placeholder="Goes into the history"></textarea></div>',
      confirmar: t.rotulo,
      aoConfirmar: function (v) {
        var resultado = opcoes.aoMover(v);
        if (!resultado.ok) { notificar(resultado.motivo); return false; }
        notificar(t.rotulo + ': ' + TC.fluxo.nomeDoEstado(tipo, para) + '.');
      }
    });
    return janela;
  }

  /* ---- Attached documents ---------------------------------------------------------------

     The same panel on the request and on the instrument: it lists what is attached and, for
     whoever can edit, a short form to attach one more. It saves straight to the store on
     attach, without waiting for the screen's "Save" — the document belongs to the record,
     not to the edit in progress, and whoever closes the screen with the X does not expect to
     lose the attachment they have just pasted.

     The fields deliberately avoid name=: the modal collects every [name] in the form, and
     the fields here would become fields of the record the screen is editing. */
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
          'title="Remove the attachment">✕</button>' : '') +
      '</div>' +
      '<div class="sub mono" style="overflow-wrap:anywhere;margin-top:3px">' + e(documento.link) + '</div>' +
      '<div class="sub" style="margin-top:2px">' +
        (documento.local === doc.REDE ? 'network path — copy and paste it into Explorer · ' : '') +
        'attached on ' + e(util.formatarData(documento.anexadoEm, true)) +
        (documento.perfil ? ' by ' + e(TC.permissoes.nomeDoPerfil(documento.perfil)) : '') +
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
        '<div class="campo"><label>Type</label><select data-doc="tipo">' +
          opcoes(doc.tipos(alvo.contexto), doc.tipoSugerido(alvo.contexto, perfil)) +
        '</select></div>' +
        '<div class="campo"><label>Name <span class="sub" style="font-weight:400">(optional)</span></label>' +
          '<input data-doc="nome" placeholder="Taken from the end of the link if left empty"></div>' +
      '</div>' +
      '<div class="campo"><label>Document link</label>' +
        '<div style="display:flex;gap:8px">' +
          '<input data-doc="link" placeholder="https://company.sharepoint.com/... or \\\\server\\folder\\file.pdf">' +
          '<button type="button" class="botao primario anexar-doc" style="white-space:nowrap">Attach</button>' +
        '</div>' +
        '<p class="sub" style="margin:6px 0 0">The file stays on SharePoint, on OneDrive ' +
          'or on the network; the platform keeps the address, who attached it and when.</p>' +
      '</div>';

    return '<div class="campo" data-painel-documentos style="margin-top:14px">' +
      '<label>' + e(alvo.rotulo || 'Documents') + ' (' + lista.length + ')</label>' +
      (lista.length
        ? '<div class="lista-selecao" style="max-height:220px">' +
          lista.map(function (d) { return linhaDocumento(d, alvo.podeEditar); }).join('') + '</div>'
        : '<p class="sub" style="margin:0">No document attached.</p>') +
      formulario +
    '</div>';
  }

  /* Wires the panel already drawn. It redraws only the panel after attaching or removing,
     so the screen neither closes nor loses what the person typed in the other fields. */
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
          notificar('Document attached.');
          redesenhar();
        };
        /* Enter in the link field attaches, instead of firing the modal's Save. */
        campoLink.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); botao.click(); }
        });
      }

      painel.querySelectorAll('[data-documento]').forEach(function (linha) {
        var tirar = linha.querySelector('.tirar-doc');
        if (!tirar) return;
        tirar.onclick = function () {
          TC.store.removerDocumento(alvo.contexto, alvo.registro.id, linha.dataset.documento);
          notificar('Document removed from the list. The file stays where it was.');
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

  /* A quote gets its own visual treatment: it is not a project phase, it is a budget. */
  function etiquetaTipoLti(tipoId) {
    var tipo = util.porId(TC.data.TIPOS_LTI, tipoId);
    var rotulo = tipo ? (tipoId === 'COTACAO' ? tipo.nome : tipoId) : tipoId;
    return '<span class="etiqueta ' + (tipoId === 'COTACAO' ? 'alerta' : 'marca') + '">' + e(rotulo) + '</span>';
  }

  /* The LTI number is what the manager looks for on screen; the type qualifies it. */
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

  /* Validates a modal's required fields. It warns and focuses the first one missing, so the
     user does not have to hunt for what is left.
     campos: [{ nome, rotulo, tipo: 'texto'|'numero', min }] — min defaults to 0 for numbers. */
  function validarObrigatorios(janela, valores, campos) {
    for (var i = 0; i < campos.length; i++) {
      var campo = campos[i];
      var bruto = valores[campo.nome];
      var texto = bruto === undefined || bruto === null ? '' : String(bruto).trim();
      var falha = null;

      if (!texto) {
        falha = 'Fill in ' + campo.rotulo + '.';
      } else if (campo.tipo === 'numero') {
        var minimo = campo.min === undefined ? 0 : campo.min;
        var numero = Number(texto);
        if (isNaN(numero)) falha = campo.rotulo + ' has to be a number.';
        else if (numero < minimo) {
          falha = minimo > 0
            ? campo.rotulo + ' has to be greater than zero.'
            : campo.rotulo + ' cannot be negative.';
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
