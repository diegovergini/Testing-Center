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

  var STATUS = {
    PENDENTE: ['marca', 'Pendente'],
    EM_ANDAMENTO: ['alerta', 'Em andamento'],
    CONCLUIDO: ['ok', 'Concluído'],
    CANCELADO: ['', 'Cancelado']
  };

  function etiquetaStatus(status) {
    var m = STATUS[status] || ['', status];
    return '<span class="etiqueta ' + m[0] + '">' + e(m[1]) + '</span>';
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
    opcoes: opcoes,
    validarObrigatorios: validarObrigatorios,
    vazio: vazio,
    STATUS: STATUS
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
