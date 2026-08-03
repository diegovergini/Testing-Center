/* Calibration: the inventory of instruments and sensors and the control of each one's
   validity. This screen answers a single question — is any test running on an out-of-date
   instrument? That is why "expired and in use" gets its own treatment, apart from "expired,
   but it is a back-up or out of service". */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  function cal() { return TC.calibracao; }

  function etiquetaPrazo(estadoDoItem) {
    var mapa = {
      VENCIDO: ['erro', 'Expired'],
      A_VENCER: ['alerta', 'Due soon'],
      EM_DIA: ['ok', 'In date'],
      SEM_PLANO: ['', 'No plan']
    };
    var m = mapa[estadoDoItem.prazo];
    return '<span class="etiqueta ' + m[0] + '">' + e(m[1]) + '</span>';
  }

  /* The certificate number becomes a link when the PDF is attached — that is how an auditor
     goes from the table to the document without passing through another screen. */
  function certificadoDoInstrumento(instrumento, registroId) {
    var docs = TC.documentos.doTipo(instrumento.documentos, 'CERTIFICADO');
    if (registroId) {
      var doRegistro = docs.filter(function (d) { return d.refId === registroId; });
      if (doRegistro.length) return doRegistro[0];
      return null;
    }
    return docs[docs.length - 1] || null;
  }

  function textoComLink(texto, documento) {
    if (!documento || !TC.documentos.abrePorClique(documento)) return e(texto);
    return '<a href="' + e(documento.link) + '" target="_blank" rel="noopener noreferrer" ' +
      'title="' + e(documento.nome) + '">' + e(texto) + '</a>';
  }

  function etiquetaSituacao(id) {
    var s = util.porId(cal().SITUACOES, id);
    return '<span class="etiqueta ' + (s ? s.cor : '') + '">' + e(s ? s.nome : id) + '</span>';
  }

  /* ---- Filters ---- */

  function opcoesDistintas(instrumentos, campo) {
    var vistos = {};
    instrumentos.forEach(function (i) {
      var v = (i[campo] || '').trim();
      if (v) vistos[v] = true;
    });
    return Object.keys(vistos).sort().map(function (v) { return { id: v, nome: v }; });
  }

  function filtrar(estados, f) {
    var busca = (f.buscaCal || '').toLowerCase();
    return estados.filter(function (x) {
      var i = x.instrumento;
      if (f.localCal && i.local !== f.localCal) return false;
      if (f.marcaCal && i.marca !== f.marcaCal) return false;
      if (f.situacaoCal && i.situacao !== f.situacaoCal) return false;
      if (f.prazoCal && x.prazo !== f.prazoCal) return false;
      if (busca) {
        var alvo = (i.id + ' ' + i.codigoAntigo + ' ' + i.nome + ' ' + i.marca + ' ' +
          i.modelo + ' ' + i.serie + ' ' + i.local).toLowerCase();
        if (alvo.indexOf(busca) === -1) return false;
      }
      return true;
    });
  }

  /* ---- Register ---- */

  function abrirEdicao(instrumento) {
    var novo = !instrumento;
    instrumento = instrumento || {
      id: '', codigoAntigo: '', nome: '', setor: 'Tech Center', local: '', backup: false,
      marca: '', modelo: '', serie: '', faixa: '', resolucao: '', situacao: 'EM_USO',
      ativo: true, periodicidadeMeses: 12, ultimaCalibracao: '', proximaCalibracao: '',
      certificado: '', laboratorio: '', observacao: '', historico: []
    };

    var corpo =
      '<div class="grade-campos">' +
        '<div class="campo"><label>Current code</label><input name="id" value="' + e(instrumento.id) + '"' +
          (novo ? ' placeholder="TCL-XX-001" required' : ' readonly') + '></div>' +
        '<div class="campo"><label>Legacy code</label>' +
          '<input name="codigoAntigo" value="' + e(instrumento.codigoAntigo || '') + '"></div>' +
        '<div class="campo"><label>Area</label>' +
          '<input name="setor" value="' + e(instrumento.setor || '') + '"></div>' +
        '<div class="campo"><label>Location / station</label>' +
          '<input name="local" value="' + e(instrumento.local || '') + '"></div>' +
      '</div>' +
      '<div class="campo"><label>Instrument / equipment</label>' +
        '<input name="nome" value="' + e(instrumento.nome) + '" required></div>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Brand</label><input name="marca" value="' + e(instrumento.marca || '') + '"></div>' +
        '<div class="campo"><label>Model</label><input name="modelo" value="' + e(instrumento.modelo || '') + '"></div>' +
        '<div class="campo"><label>Serial no.</label><input name="serie" value="' + e(instrumento.serie || '') + '"></div>' +
      '</div>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Working range</label>' +
          '<input name="faixa" value="' + e(instrumento.faixa || '') + '"></div>' +
        '<div class="campo"><label>Resolution / capacity</label>' +
          '<input name="resolucao" value="' + e(instrumento.resolucao || '') + '"></div>' +
        '<div class="campo"><label>Condition</label><select name="situacao">' +
          ui.opcoes(cal().SITUACOES, instrumento.situacao) + '</select></div>' +
        '<div class="campo"><label>Interval (months)</label>' +
          '<input type="number" min="1" max="120" name="periodicidadeMeses" value="' +
          e(String(instrumento.periodicidadeMeses || 12)) + '"></div>' +
      '</div>' +
      '<p class="sub" style="margin:0 0 10px">The last and next calibration normally come ' +
        'from the <strong>Calibrate</strong> button, which keeps the certificate in the ' +
        'history. The fields below exist to enter what was already on a spreadsheet.</p>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Last calibration</label>' +
          '<input type="date" name="ultimaCalibracao" value="' + e(instrumento.ultimaCalibracao || '') + '"></div>' +
        '<div class="campo"><label>Next calibration <span class="sub" style="font-weight:400">(empty = computed)</span></label>' +
          '<input type="date" name="proximaCalibracao" value="' + e(instrumento.proximaCalibracao || '') + '"></div>' +
        '<div class="campo"><label>Certificate</label>' +
          '<input name="certificado" value="' + e(instrumento.certificado || '') + '"></div>' +
        '<div class="campo"><label>Laboratory</label>' +
          '<input name="laboratorio" value="' + e(instrumento.laboratorio || '') + '"></div>' +
      '</div>' +
      '<div class="campo"><label style="display:flex;align-items:center;gap:7px;color:var(--texto)">' +
        '<input type="checkbox" name="backup" style="width:auto"' + (instrumento.backup ? ' checked' : '') + '>' +
        'This is a back-up instrument</label></div>' +
      '<div class="campo"><label style="display:flex;align-items:center;gap:7px;color:var(--texto)">' +
        '<input type="checkbox" name="ativo" style="width:auto"' + (instrumento.ativo ? ' checked' : '') + '>' +
        'Active in the fleet</label></div>' +
      '<div class="campo"><label>Notes</label>' +
        '<textarea name="observacao" rows="2">' + e(instrumento.observacao || '') + '</textarea></div>';

    ui.modal({
      titulo: novo ? 'New instrument' : instrumento.id + ' — ' + instrumento.nome,
      corpo: corpo,
      largura: 'min(880px, 100%)',
      confirmar: 'Save instrument',
      aoConfirmar: function (v) {
        if (!v.id.trim() || !v.nome.trim()) { ui.notificar('Enter code and name.'); return false; }
        if (novo && util.porId(TC.store.get().instrumentos, v.id.trim())) {
          ui.notificar('An instrument with code ' + v.id.trim() + ' already exists.');
          return false;
        }
        TC.store.salvarInstrumento({
          id: v.id.trim(), codigoAntigo: v.codigoAntigo.trim(), nome: v.nome.trim(),
          setor: v.setor.trim(), local: v.local.trim(), backup: !!v.backup, ativo: !!v.ativo,
          marca: v.marca.trim(), modelo: v.modelo.trim(), serie: v.serie.trim(),
          faixa: v.faixa.trim(), resolucao: v.resolucao.trim(), situacao: v.situacao,
          periodicidadeMeses: Number(v.periodicidadeMeses) || 12,
          ultimaCalibracao: v.ultimaCalibracao, proximaCalibracao: v.proximaCalibracao,
          certificado: v.certificado.trim(), laboratorio: v.laboratorio.trim(),
          observacao: v.observacao.trim(),
          historico: instrumento.historico || []
        });
        ui.notificar('Instrument saved.');
      }
    });
  }

  /* ---- Recording a calibration ---- */

  function abrirCalibracao(instrumento, hoje) {
    var estadoItem = cal().estado(instrumento, hoje);
    var historico = (instrumento.historico || []).slice().sort(function (a, b) {
      return util.diffDias(b.data, a.data);
    });

    var corpo =
      '<div class="aviso' + (estadoItem.prazo === 'VENCIDO' ? ' erro' : '') + '">' +
        '<strong>' + e(instrumento.id) + '</strong> · ' + e(instrumento.nome) +
        '<div class="sub" style="margin-top:4px">' +
          (instrumento.marca ? e(instrumento.marca) + ' ' + e(instrumento.modelo) + ' · ' : '') +
          (instrumento.serie ? 'serial ' + e(instrumento.serie) + ' · ' : '') +
          e(instrumento.local) + '</div>' +
        '<div style="margin-top:6px">' +
          (estadoItem.ultimaCalibracao
            ? 'Last calibrated on <strong>' + e(util.formatarData(estadoItem.ultimaCalibracao, true)) + '</strong>. '
            : 'No calibration on record. ') +
          (estadoItem.vencimento
            ? 'Valid until <strong>' + e(util.formatarData(estadoItem.vencimento, true)) + '</strong>' +
              (estadoItem.diasParaVencer < 0
                ? ' — <strong>expired ' + Math.abs(estadoItem.diasParaVencer) + ' days ago</strong>.'
                : ' — ' + estadoItem.diasParaVencer + ' days to go.')
            : 'No validity defined.') +
        '</div>' +
      '</div>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Calibration date</label>' +
          '<input type="date" name="data" value="' + e(hoje) + '"></div>' +
        '<div class="campo"><label>Result</label><select name="resultado">' +
          ui.opcoes(cal().RESULTADOS, 'APROVADO') + '</select></div>' +
        '<div class="campo"><label>Certificate no.</label>' +
          '<input name="certificado" placeholder="e.g. RBC-2026-0481"></div>' +
        '<div class="campo"><label>Laboratory</label>' +
          '<input name="laboratorio" value="' + e(instrumento.laboratorio || '') + '"></div>' +
        '<div class="campo"><label>Interval (months)</label>' +
          '<input type="number" min="1" max="120" name="periodicidadeMeses" value="' +
          e(String(instrumento.periodicidadeMeses || 12)) + '"></div>' +
        '<div class="campo"><label>Next calibration <span class="sub" style="font-weight:400">(empty = computed)</span></label>' +
          '<input type="date" name="proximaCalibracao"></div>' +
      '</div>' +
      '<div class="campo"><label>Certificate link ' +
        '<span class="sub" style="font-weight:400">(optional)</span></label>' +
        '<input name="certificadoLink" placeholder="https://company.sharepoint.com/... or ' +
        '\\\\server\\calibration\\certificate.pdf">' +
        '<p class="sub" style="margin:6px 0 0">It goes in as a document of this instrument, ' +
        'tied to this calibration. The PDF stays where it already is.</p></div>' +
      '<div class="campo"><label>Note</label>' +
        '<textarea name="observacao" rows="2" placeholder="Deviations found, adjustments, restrictions on use"></textarea></div>' +
      '<div id="previa-validade"></div>' +
      (historico.length
        ? '<div class="campo" style="margin-top:14px"><label>Calibration history</label>' +
          '<div class="lista-selecao" style="max-height:200px">' +
          historico.map(function (h) {
            var r = util.porId(cal().RESULTADOS, h.resultado);
            return '<div class="linha-selecao" style="display:block">' +
              '<div><span class="mono sub">' + e(util.formatarData(h.data, true)) + '</span> · ' +
              '<span class="etiqueta ' + (r ? r.cor : '') + '">' + e(r ? r.nome : h.resultado) + '</span>' +
              (h.certificado
                ? ' <span class="sub">certificate ' +
                  textoComLink(h.certificado, certificadoDoInstrumento(instrumento, h.id)) + '</span>'
                : '') +
              (h.laboratorio ? ' <span class="sub">· ' + e(h.laboratorio) + '</span>' : '') +
              '</div>' +
              (h.observacao ? '<div class="sub">' + e(h.observacao) + '</div>' : '') +
              '</div>';
          }).join('') + '</div></div>'
        : '<p class="sub" style="margin-top:14px">No calibration recorded on the platform yet.</p>') +
      ui.painelDocumentos({
        registro: instrumento, contexto: 'instrumento', podeEditar: true,
        rotulo: 'Instrument documents'
      });

    var janela = ui.modal({
      titulo: 'Record calibration',
      corpo: corpo,
      largura: 'min(760px, 100%)',
      confirmar: 'Record calibration',
      aoConfirmar: function (v) {
        var resultado = TC.store.registrarCalibracao(instrumento.id, {
          data: v.data, resultado: v.resultado,
          certificado: v.certificado, laboratorio: v.laboratorio,
          certificadoLink: v.certificadoLink,
          periodicidadeMeses: Number(v.periodicidadeMeses) || 0,
          proximaCalibracao: v.proximaCalibracao, observacao: v.observacao
        });
        if (!resultado.ok) { ui.notificar(resultado.motivo); return false; }
        ui.notificar(v.resultado === 'REPROVADO'
          ? 'Calibration failed — the instrument was marked out of service.'
          : 'Calibration recorded. Next one on ' +
            util.formatarData(resultado.instrumento.proximaCalibracao, true) + '.');
      }
    });

    ui.ligarDocumentos(janela, {
      registro: instrumento, contexto: 'instrumento', podeEditar: true,
      rotulo: 'Documentos do instrumento'
    });

    /* The computed validity shows while you type: it is the number that goes to the table. */
    var previa = janela.querySelector('#previa-validade');
    function atualizar() {
      function valor(nome) { return janela.querySelector('[name=' + nome + ']').value; }
      var resultado = valor('resultado');
      if (resultado === 'REPROVADO') {
        previa.innerHTML = '<div class="aviso erro">A failed calibration renews nothing: the ' +
          'instrument leaves service until someone decides between adjustment, repair or ' +
          'scrapping.</div>';
        return;
      }
      var vence = valor('proximaCalibracao') ||
        cal().somaMeses(valor('data'), Number(valor('periodicidadeMeses')) || 0);
      previa.innerHTML = '<div class="aviso">Valid until <strong>' +
        e(vence ? util.formatarData(vence, true) : '—') + '</strong>.</div>';
    }
    ['data', 'resultado', 'periodicidadeMeses', 'proximaCalibracao'].forEach(function (campo) {
      var alvo = janela.querySelector('[name=' + campo + ']');
      alvo.addEventListener('change', atualizar);
      alvo.addEventListener('input', atualizar);
    });
    atualizar();
  }

  /* ---- Bulk entry ---- */

  /* The way to take the dates off the spreadsheet and into the platform without typing 229
     times. Nothing is saved before the check: what will go in and what was refused appear
     side by side as you paste. */
  function abrirLote(instrumentos) {
    var corpo =
      '<div class="aviso">Paste the slice of the spreadsheet here: <strong>one row per ' +
        'instrument</strong>, with the code in the first column and the last calibration ' +
        'date in the second. Certificate and laboratory, if any, go in the third and the ' +
        'fourth.' +
        '<div class="sub" style="margin-top:6px">Dates as 31/12/2025 or 2025-12-31. ' +
        'The legacy code is recognised too. Validity comes from the date entered plus the ' +
        'instrument interval (12 months, unless you have changed it).</div></div>' +
      '<div class="campo"><label>Code and date</label>' +
        '<textarea name="lote" rows="9" spellcheck="false" style="font-family:ui-monospace,' +
        'Menlo,Consolas,monospace;font-size:12.5px" placeholder="TCL-AC-012&#9;12/03/2026&#10;' +
        'TCL-CC-001&#9;05/11/2025&#9;RBC-2025-0481&#9;Metrologia XPTO"></textarea></div>' +
      '<div id="previa-lote"></div>';

    var janela = ui.modal({
      titulo: 'Bulk-enter calibrations',
      corpo: corpo,
      largura: 'min(820px, 100%)',
      confirmar: 'Enter calibrations',
      aoConfirmar: function (v) {
        var leitura = cal().interpretarLote(v.lote, instrumentos);
        if (!leitura.aplicaveis.length) {
          ui.notificar('No valid row to enter.');
          return false;
        }
        var resultado = TC.store.lancarCalibracoesEmLote(leitura.aplicaveis.map(function (l) {
          return {
            instrumentoId: l.instrumento.id, data: l.data,
            certificado: l.certificado, laboratorio: l.laboratorio
          };
        }));
        ui.notificar(resultado.aplicados.length + ' calibration(s) entered' +
          (leitura.problemas.length ? ' · ' + leitura.problemas.length + ' row(s) ignored.' : '.'));
      }
    });

    var previa = janela.querySelector('#previa-lote');
    var campo = janela.querySelector('[name=lote]');
    var botao = janela.querySelector('.confirmar');

    function conferir() {
      var leitura = cal().interpretarLote(campo.value, instrumentos);
      botao.disabled = leitura.aplicaveis.length === 0;
      if (!leitura.linhas.length) { previa.innerHTML = ''; return; }

      previa.innerHTML =
        '<div class="aviso' + (leitura.aplicaveis.length ? '' : ' alerta') + '">' +
          '<strong>' + leitura.aplicaveis.length + '</strong> row(s) ready to enter' +
          (leitura.problemas.length
            ? ' · <strong>' + leitura.problemas.length + '</strong> with a problem'
            : '') + '.</div>' +
        (leitura.problemas.length
          ? '<div class="lista-selecao" style="max-height:170px">' +
            leitura.problemas.slice(0, 40).map(function (l) {
              return '<div class="linha-selecao">' +
                '<span class="sub mono">row ' + l.linha + '</span>' +
                '<span class="mono forte">' + e(l.codigo || '—') + '</span>' +
                '<span class="etiqueta erro">' + e(cal().MOTIVOS_DO_LOTE[l.situacao]) + '</span>' +
                '</div>';
            }).join('') +
            (leitura.problemas.length > 40
              ? '<div class="linha-selecao sub">and ' + (leitura.problemas.length - 40) + ' more.</div>'
              : '') +
            '</div>'
          : '') +
        (leitura.aplicaveis.length
          ? '<div class="campo" style="margin-top:12px"><label>Validity preview</label>' +
            '<div class="lista-selecao" style="max-height:200px">' +
            leitura.aplicaveis.slice(0, 40).map(function (l) {
              var vence = cal().somaMeses(l.data, l.instrumento.periodicidadeMeses || 12);
              return '<div class="linha-selecao">' +
                '<span class="mono forte">' + e(l.instrumento.id) + '</span>' +
                '<span class="sub" style="flex:1">' + e(util.recortar(l.instrumento.nome, 40)) + '</span>' +
                '<span class="sub">' + e(util.formatarData(l.data, true)) + '</span>' +
                '<span class="etiqueta ok">until ' + e(util.formatarData(vence, true)) + '</span>' +
                '</div>';
            }).join('') +
            (leitura.aplicaveis.length > 40
              ? '<div class="linha-selecao sub">and ' + (leitura.aplicaveis.length - 40) + ' more.</div>'
              : '') +
            '</div></div>'
          : '');
    }

    campo.addEventListener('input', conferir);
    campo.addEventListener('change', conferir);
    botao.disabled = true;
    campo.focus();
  }

  /* ---- Screen ---- */

  function render(container, ctx) {
    var estado = ctx.estado, hoje = ctx.hoje, f = ctx.filtros;
    var podeEditar = ctx.podeEditar;
    var instrumentos = estado.instrumentos || [];

    var resumo = cal().resumo(instrumentos, hoje);
    var todos = cal().lista(instrumentos, hoje);
    var lista = filtrar(todos, f);
    var criticos = todos.filter(function (x) { return x.criticidade === 'CRITICO'; });

    var linhas = lista.map(function (x) {
      var i = x.instrumento;
      return '<tr data-instrumento="' + e(i.id) + '">' +
        '<td><div class="mono forte">' + e(i.id) + '</div>' +
          (i.codigoAntigo ? '<div class="sub mono">' + e(i.codigoAntigo) + '</div>' : '') + '</td>' +
        '<td><div class="forte">' + e(i.nome) + '</div>' +
          '<div class="sub">' + e([i.marca, i.modelo].filter(Boolean).join(' ') || '—') +
          (i.serie && i.serie !== '-' ? ' · serial ' + e(i.serie) : '') + '</div></td>' +
        '<td><div>' + e(i.local || '—') + '</div>' +
          '<div class="sub">' + e(i.setor || '') + '</div></td>' +
        '<td><div class="sub">' + e(i.faixa || '—') + '</div>' +
          '<div class="sub">' + e(i.resolucao || '') + '</div></td>' +
        '<td>' + etiquetaSituacao(i.situacao) +
          (i.backup ? '<div><span class="etiqueta">back-up</span></div>' : '') +
          (i.ativo ? '' : '<div><span class="etiqueta erro">deactivated</span></div>') + '</td>' +
        '<td>' + (x.ultimaCalibracao
          ? '<div>' + e(util.formatarData(x.ultimaCalibracao, true)) + '</div>' +
            (i.certificado
              ? '<div class="sub">' + textoComLink(i.certificado, certificadoDoInstrumento(i)) + '</div>'
              : (i.documentos || []).length
              ? '<div class="sub">' + (i.documentos || []).length + ' document(s)</div>' : '')
          : '<span class="sub">—</span>') + '</td>' +
        '<td>' + (i.ultimoResultado === 'REPROVADO' && !x.vencimento
          ? '<span class="etiqueta erro">failed</span>'
          : x.vencimento
          ? '<div class="forte">' + e(util.formatarData(x.vencimento, true)) + '</div>' +
            '<div class="sub">' + (x.diasParaVencer < 0
              ? 'expired ' + Math.abs(x.diasParaVencer) + ' d ago'
              : 'in ' + x.diasParaVencer + ' d') + '</div>'
          : '<span class="sub">—</span>') + '</td>' +
        '<td>' + etiquetaPrazo(x) +
          (x.criticidade === 'CRITICO'
            ? '<div><span class="etiqueta erro">expired, in use</span></div>' : '') + '</td>' +
        '<td class="num" style="white-space:nowrap">' +
          (podeEditar
            ? '<button class="botao pequeno primario calibrar">Calibrate</button> ' +
              '<button class="botao pequeno editar">Edit</button> ' +
              '<button class="botao pequeno perigo excluir" title="Remove instrument">✕</button>'
            : '<span class="sub">—</span>') +
        '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Calibration management</h2>' +
        '<p>Test centre instruments and sensors, with each one\'s calibration validity. ' +
        'Validity comes from the last calibration plus the interval — <strong>12 months</strong> ' +
        'by default, adjustable per instrument — unless the certificate carries a date of its ' +
        'own.</p></div>' +
        (podeEditar ? '<div class="acoes">' +
          '<button class="botao" id="csv-cal">Export CSV</button> ' +
          '<button class="botao" id="lote-cal">Bulk-enter dates</button> ' +
          '<button class="botao primario" id="novo-instrumento">+ New instrument</button></div>' : '') +
      '</div>' +

      '<div class="indicadores">' +
        '<div class="indicador"><div class="rotulo">Instruments</div><div class="valor">' +
          resumo.total + '</div><div class="nota">' + resumo.emUso + ' in use · ' +
          resumo.backup + ' back-up</div></div>' +
        '<div class="indicador"><div class="rotulo">Calibration expired</div>' +
          '<div class="valor" style="color:' + (resumo.vencidos ? 'var(--erro)' : 'var(--ok)') + '">' +
          resumo.vencidos + '</div><div class="nota">' + resumo.criticos +
          ' in use right now</div></div>' +
        '<div class="indicador"><div class="rotulo">Due in ' + cal().DIAS_DE_ALERTA + ' days</div>' +
          '<div class="valor"' + (resumo.aVencer ? ' style="color:var(--alerta)"' : '') + '>' +
          resumo.aVencer + '</div><div class="nota">to book with the laboratory</div></div>' +
        '<div class="indicador"><div class="rotulo">No plan</div><div class="valor">' +
          resumo.semPlano + '</div><div class="nota">no calibration date entered</div></div>' +
        '<div class="indicador"><div class="rotulo">Coverage</div><div class="valor">' +
          (resumo.cobertura === null ? '—' : Math.round(resumo.cobertura * 100) + '%') +
          '</div><div class="nota">of those with a plan, within validity</div></div>' +
      '</div>' +

      /* Expired and in use is the serious finding: a test measuring on an out-of-date
         instrument. */
      (criticos.length
        ? '<div class="cartao"><div class="cartao-corpo"><div class="aviso erro" style="margin:0">' +
          '<strong>' + criticos.length + ' instrument(s) in use with expired calibration.</strong> ' +
          'A test running on them measures out of validity: ' +
          e(criticos.slice(0, 8).map(function (x) { return x.instrumento.id; }).join(', ')) +
          (criticos.length > 8 ? ' and ' + (criticos.length - 8) + ' more.' : '.') +
          '</div></div></div>'
        : '') +

      '<div class="cartao">' +
        '<div class="cartao-topo"><div class="filtros" style="flex:1">' +
          '<div class="campo busca"><label>Search</label><input id="f-cal-busca" ' +
            'placeholder="code, name, brand, model, serial or station" value="' + e(f.buscaCal || '') + '"></div>' +
          '<div class="campo"><label>Location / station</label><select id="f-cal-local">' +
            ui.opcoes(opcoesDistintas(instrumentos, 'local'), f.localCal, 'All') + '</select></div>' +
          '<div class="campo"><label>Brand</label><select id="f-cal-marca">' +
            ui.opcoes(opcoesDistintas(instrumentos, 'marca'), f.marcaCal, 'All') + '</select></div>' +
          '<div class="campo"><label>Condition</label><select id="f-cal-situacao">' +
            ui.opcoes(cal().SITUACOES, f.situacaoCal, 'All') + '</select></div>' +
          '<div class="campo"><label>Calibration</label><select id="f-cal-prazo">' +
            ui.opcoes([
              { id: 'VENCIDO', nome: 'Expired' },
              { id: 'A_VENCER', nome: 'Due soon' },
              { id: 'EM_DIA', nome: 'In date' },
              { id: 'SEM_PLANO', nome: 'No plan' }
            ], f.prazoCal, 'All') + '</select></div>' +
        '</div></div>' +
        (lista.length
          ? '<div class="tabela-rolagem"><table><thead><tr>' +
            '<th>Code</th><th>Instrument</th><th>Location</th><th>Range / resolution</th>' +
            '<th>Condition</th><th>Last calibration</th><th>Valid until</th><th>Status</th><th></th>' +
            '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
            '<div class="cartao-corpo sub">' + lista.length + ' of ' + resumo.total +
            ' instruments listed.</div>'
          : ui.vazio('No instrument found', 'Adjust the filters or register a new one.')) +
      '</div>';

    var novo = container.querySelector('#novo-instrumento');
    if (novo) novo.onclick = function () { abrirEdicao(null); };

    var csv = container.querySelector('#csv-cal');
    if (csv) csv.onclick = function () { exportarCsv(lista); };

    var lote = container.querySelector('#lote-cal');
    if (lote) lote.onclick = function () { abrirLote(instrumentos); };

    function liga(id, campo) {
      var alvo = container.querySelector(id);
      alvo.addEventListener('change', function () { f[campo] = alvo.value; ctx.atualizar(); });
    }
    liga('#f-cal-local', 'localCal');
    liga('#f-cal-marca', 'marcaCal');
    liga('#f-cal-situacao', 'situacaoCal');
    liga('#f-cal-prazo', 'prazoCal');

    var busca = container.querySelector('#f-cal-busca');
    var atraso;
    busca.addEventListener('input', function () {
      clearTimeout(atraso);
      atraso = setTimeout(function () {
        f.buscaCal = busca.value;
        ctx.atualizar();
        var novoCampo = container.querySelector('#f-cal-busca');
        if (novoCampo) { novoCampo.focus(); novoCampo.setSelectionRange(novoCampo.value.length, novoCampo.value.length); }
      }, 250);
    });

    container.querySelectorAll('tr[data-instrumento]').forEach(function (tr) {
      var i = util.porId(instrumentos, tr.dataset.instrumento);
      var calibrar = tr.querySelector('.calibrar');
      if (!calibrar) return;
      calibrar.onclick = function () { abrirCalibracao(i, hoje); };
      tr.querySelector('.editar').onclick = function () { abrirEdicao(i); };
      tr.querySelector('.excluir').onclick = function () {
        ui.confirmarAcao('Remove ' + i.id + ' — ' + i.nome + '? The calibration history goes with it.',
          function () {
            TC.store.removerInstrumento(i.id);
            ui.notificar('Instrument removed.');
          });
      };
    });
  }

  /* The CSV comes out with whatever is filtered on screen: that is how you send one
     station's list to the calibration laboratory. */
  function exportarCsv(lista) {
    var colunas = ['Code', 'Legacy code', 'Instrument', 'Area', 'Location', 'Back-up',
      'Brand', 'Model', 'Serial', 'Range', 'Resolution', 'Condition', 'Last calibration',
      'Valid until', 'Status', 'Certificate', 'Laboratory'];
    var linhas = lista.map(function (x) {
      var i = x.instrumento;
      return [i.id, i.codigoAntigo, i.nome, i.setor, i.local, i.backup ? 'Yes' : 'No',
        i.marca, i.modelo, i.serie, i.faixa, i.resolucao, cal().nomeSituacao(i.situacao),
        i.ultimaCalibracao, x.vencimento, x.prazo, i.certificado, i.laboratorio];
    });
    var csv = [colunas].concat(linhas).map(function (l) {
      return l.map(function (c) {
        var t = String(c == null ? '' : c);
        return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      }).join(';');
    }).join('\r\n');

    var url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'calibration-' + util.hoje() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    ui.notificar(lista.length + ' instrument(s) exported.');
  }

  TC.views = TC.views || {};
  TC.views.calibracao = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
