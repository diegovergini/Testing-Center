/* Calibração: o inventário de instrumentos e sensores e o controle da validade de cada um.
   A pergunta que esta janela responde é uma só — algum ensaio está rodando com instrumento
   fora da validade? Por isso "vencido e em uso" tem tratamento próprio, separado de
   "vencido, mas é back-up ou está fora de uso". */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});
  var util = TC.util, ui = TC.ui, e = util.escapar;

  function cal() { return TC.calibracao; }

  function etiquetaPrazo(estadoDoItem) {
    var mapa = {
      VENCIDO: ['erro', 'Vencida'],
      A_VENCER: ['alerta', 'A vencer'],
      EM_DIA: ['ok', 'Em dia'],
      SEM_PLANO: ['', 'Sem plano']
    };
    var m = mapa[estadoDoItem.prazo];
    return '<span class="etiqueta ' + m[0] + '">' + e(m[1]) + '</span>';
  }

  function etiquetaSituacao(id) {
    var s = util.porId(cal().SITUACOES, id);
    return '<span class="etiqueta ' + (s ? s.cor : '') + '">' + e(s ? s.nome : id) + '</span>';
  }

  /* ---- Filtros ---- */

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

  /* ---- Cadastro ---- */

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
        '<div class="campo"><label>Código atual</label><input name="id" value="' + e(instrumento.id) + '"' +
          (novo ? ' placeholder="TCL-XX-001" required' : ' readonly') + '></div>' +
        '<div class="campo"><label>Código antigo</label>' +
          '<input name="codigoAntigo" value="' + e(instrumento.codigoAntigo || '') + '"></div>' +
        '<div class="campo"><label>Setor / área</label>' +
          '<input name="setor" value="' + e(instrumento.setor || '') + '"></div>' +
        '<div class="campo"><label>Local / posto</label>' +
          '<input name="local" value="' + e(instrumento.local || '') + '"></div>' +
      '</div>' +
      '<div class="campo"><label>Instrumento / equipamento</label>' +
        '<input name="nome" value="' + e(instrumento.nome) + '" required></div>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Marca</label><input name="marca" value="' + e(instrumento.marca || '') + '"></div>' +
        '<div class="campo"><label>Modelo</label><input name="modelo" value="' + e(instrumento.modelo || '') + '"></div>' +
        '<div class="campo"><label>Nº de série</label><input name="serie" value="' + e(instrumento.serie || '') + '"></div>' +
      '</div>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Range de utilização</label>' +
          '<input name="faixa" value="' + e(instrumento.faixa || '') + '"></div>' +
        '<div class="campo"><label>Resolução / capacidade</label>' +
          '<input name="resolucao" value="' + e(instrumento.resolucao || '') + '"></div>' +
        '<div class="campo"><label>Situação</label><select name="situacao">' +
          ui.opcoes(cal().SITUACOES, instrumento.situacao) + '</select></div>' +
        '<div class="campo"><label>Periodicidade (meses)</label>' +
          '<input type="number" min="1" max="120" name="periodicidadeMeses" value="' +
          e(String(instrumento.periodicidadeMeses || 12)) + '"></div>' +
      '</div>' +
      '<p class="sub" style="margin:0 0 10px">A última e a próxima calibração normalmente ' +
        'vêm do botão <strong>Calibrar</strong>, que guarda o certificado no histórico. ' +
        'Os campos abaixo existem para lançar o que já estava em planilha.</p>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Última calibração</label>' +
          '<input type="date" name="ultimaCalibracao" value="' + e(instrumento.ultimaCalibracao || '') + '"></div>' +
        '<div class="campo"><label>Próxima calibração <span class="sub" style="font-weight:400">(vazio = calculada)</span></label>' +
          '<input type="date" name="proximaCalibracao" value="' + e(instrumento.proximaCalibracao || '') + '"></div>' +
        '<div class="campo"><label>Certificado</label>' +
          '<input name="certificado" value="' + e(instrumento.certificado || '') + '"></div>' +
        '<div class="campo"><label>Laboratório</label>' +
          '<input name="laboratorio" value="' + e(instrumento.laboratorio || '') + '"></div>' +
      '</div>' +
      '<div class="campo"><label style="display:flex;align-items:center;gap:7px;color:var(--texto)">' +
        '<input type="checkbox" name="backup" style="width:auto"' + (instrumento.backup ? ' checked' : '') + '>' +
        'É um instrumento back-up</label></div>' +
      '<div class="campo"><label style="display:flex;align-items:center;gap:7px;color:var(--texto)">' +
        '<input type="checkbox" name="ativo" style="width:auto"' + (instrumento.ativo ? ' checked' : '') + '>' +
        'Ativo no parque</label></div>' +
      '<div class="campo"><label>Observações</label>' +
        '<textarea name="observacao" rows="2">' + e(instrumento.observacao || '') + '</textarea></div>';

    ui.modal({
      titulo: novo ? 'Novo instrumento' : instrumento.id + ' — ' + instrumento.nome,
      corpo: corpo,
      largura: 'min(880px, 100%)',
      confirmar: 'Salvar instrumento',
      aoConfirmar: function (v) {
        if (!v.id.trim() || !v.nome.trim()) { ui.notificar('Informe código e nome.'); return false; }
        if (novo && util.porId(TC.store.get().instrumentos, v.id.trim())) {
          ui.notificar('Já existe um instrumento com o código ' + v.id.trim() + '.');
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
        ui.notificar('Instrumento salvo.');
      }
    });
  }

  /* ---- Registro de calibração ---- */

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
          (instrumento.serie ? 'série ' + e(instrumento.serie) + ' · ' : '') +
          e(instrumento.local) + '</div>' +
        '<div style="margin-top:6px">' +
          (estadoItem.ultimaCalibracao
            ? 'Última calibração em <strong>' + e(util.formatarData(estadoItem.ultimaCalibracao, true)) + '</strong>. '
            : 'Sem calibração registrada. ') +
          (estadoItem.vencimento
            ? 'Validade até <strong>' + e(util.formatarData(estadoItem.vencimento, true)) + '</strong>' +
              (estadoItem.diasParaVencer < 0
                ? ' — <strong>vencida há ' + Math.abs(estadoItem.diasParaVencer) + ' dias</strong>.'
                : ' — faltam ' + estadoItem.diasParaVencer + ' dias.')
            : 'Sem validade definida.') +
        '</div>' +
      '</div>' +
      '<div class="grade-campos">' +
        '<div class="campo"><label>Data da calibração</label>' +
          '<input type="date" name="data" value="' + e(hoje) + '"></div>' +
        '<div class="campo"><label>Resultado</label><select name="resultado">' +
          ui.opcoes(cal().RESULTADOS, 'APROVADO') + '</select></div>' +
        '<div class="campo"><label>Certificado nº</label>' +
          '<input name="certificado" placeholder="Ex.: RBC-2026-0481"></div>' +
        '<div class="campo"><label>Laboratório</label>' +
          '<input name="laboratorio" value="' + e(instrumento.laboratorio || '') + '"></div>' +
        '<div class="campo"><label>Periodicidade (meses)</label>' +
          '<input type="number" min="1" max="120" name="periodicidadeMeses" value="' +
          e(String(instrumento.periodicidadeMeses || 12)) + '"></div>' +
        '<div class="campo"><label>Próxima calibração <span class="sub" style="font-weight:400">(vazio = calculada)</span></label>' +
          '<input type="date" name="proximaCalibracao"></div>' +
      '</div>' +
      '<div class="campo"><label>Observação</label>' +
        '<textarea name="observacao" rows="2" placeholder="Desvios encontrados, ajustes, restrições de uso"></textarea></div>' +
      '<div id="previa-validade"></div>' +
      (historico.length
        ? '<div class="campo" style="margin-top:14px"><label>Histórico de calibrações</label>' +
          '<div class="lista-selecao" style="max-height:200px">' +
          historico.map(function (h) {
            var r = util.porId(cal().RESULTADOS, h.resultado);
            return '<div class="linha-selecao" style="display:block">' +
              '<div><span class="mono sub">' + e(util.formatarData(h.data, true)) + '</span> · ' +
              '<span class="etiqueta ' + (r ? r.cor : '') + '">' + e(r ? r.nome : h.resultado) + '</span>' +
              (h.certificado ? ' <span class="sub">certificado ' + e(h.certificado) + '</span>' : '') +
              (h.laboratorio ? ' <span class="sub">· ' + e(h.laboratorio) + '</span>' : '') +
              '</div>' +
              (h.observacao ? '<div class="sub">' + e(h.observacao) + '</div>' : '') +
              '</div>';
          }).join('') + '</div></div>'
        : '<p class="sub" style="margin-top:14px">Nenhuma calibração registrada na plataforma ainda.</p>');

    var janela = ui.modal({
      titulo: 'Registrar calibração',
      corpo: corpo,
      largura: 'min(760px, 100%)',
      confirmar: 'Registrar calibração',
      aoConfirmar: function (v) {
        var resultado = TC.store.registrarCalibracao(instrumento.id, {
          data: v.data, resultado: v.resultado,
          certificado: v.certificado, laboratorio: v.laboratorio,
          periodicidadeMeses: Number(v.periodicidadeMeses) || 0,
          proximaCalibracao: v.proximaCalibracao, observacao: v.observacao
        });
        if (!resultado.ok) { ui.notificar(resultado.motivo); return false; }
        ui.notificar(v.resultado === 'REPROVADO'
          ? 'Calibração reprovada — o instrumento foi marcado como fora de uso.'
          : 'Calibração registrada. Próxima em ' +
            util.formatarData(resultado.instrumento.proximaCalibracao, true) + '.');
      }
    });

    /* A validade calculada aparece enquanto se preenche: é o número que vai para a tabela. */
    var previa = janela.querySelector('#previa-validade');
    function atualizar() {
      function valor(nome) { return janela.querySelector('[name=' + nome + ']').value; }
      var resultado = valor('resultado');
      if (resultado === 'REPROVADO') {
        previa.innerHTML = '<div class="aviso erro">Reprovado não renova a validade: o ' +
          'instrumento sai de uso até alguém decidir entre ajuste, reparo ou descarte.</div>';
        return;
      }
      var vence = valor('proximaCalibracao') ||
        cal().somaMeses(valor('data'), Number(valor('periodicidadeMeses')) || 0);
      previa.innerHTML = '<div class="aviso">Validade até <strong>' +
        e(vence ? util.formatarData(vence, true) : '—') + '</strong>.</div>';
    }
    ['data', 'resultado', 'periodicidadeMeses', 'proximaCalibracao'].forEach(function (campo) {
      var alvo = janela.querySelector('[name=' + campo + ']');
      alvo.addEventListener('change', atualizar);
      alvo.addEventListener('input', atualizar);
    });
    atualizar();
  }

  /* ---- Lançamento em lote ---- */

  /* O caminho para tirar as datas da planilha e pôr na plataforma sem digitar 229 vezes.
     Nada é gravado antes da conferência: o que vai entrar e o que foi recusado aparecem
     lado a lado enquanto se cola. */
  function abrirLote(instrumentos) {
    var corpo =
      '<div class="aviso">Cole aqui o recorte da planilha: <strong>uma linha por ' +
        'instrumento</strong>, com o código na primeira coluna e a data da última ' +
        'calibração na segunda. Certificado e laboratório, se houver, entram na terceira ' +
        'e na quarta.' +
        '<div class="sub" style="margin-top:6px">Datas em 31/12/2025 ou 2025-12-31. ' +
        'O código antigo também é reconhecido. A validade sai da data lançada mais a ' +
        'periodicidade do instrumento (12 meses, salvo se você já mudou).</div></div>' +
      '<div class="campo"><label>Código e data</label>' +
        '<textarea name="lote" rows="9" spellcheck="false" style="font-family:ui-monospace,' +
        'Menlo,Consolas,monospace;font-size:12.5px" placeholder="TCL-AC-012&#9;12/03/2026&#10;' +
        'TCL-CC-001&#9;05/11/2025&#9;RBC-2025-0481&#9;Metrologia XPTO"></textarea></div>' +
      '<div id="previa-lote"></div>';

    var janela = ui.modal({
      titulo: 'Lançar calibrações em lote',
      corpo: corpo,
      largura: 'min(820px, 100%)',
      confirmar: 'Lançar calibrações',
      aoConfirmar: function (v) {
        var leitura = cal().interpretarLote(v.lote, instrumentos);
        if (!leitura.aplicaveis.length) {
          ui.notificar('Nenhuma linha válida para lançar.');
          return false;
        }
        var resultado = TC.store.lancarCalibracoesEmLote(leitura.aplicaveis.map(function (l) {
          return {
            instrumentoId: l.instrumento.id, data: l.data,
            certificado: l.certificado, laboratorio: l.laboratorio
          };
        }));
        ui.notificar(resultado.aplicados.length + ' calibração(ões) lançada(s)' +
          (leitura.problemas.length ? ' · ' + leitura.problemas.length + ' linha(s) ignorada(s).' : '.'));
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
          '<strong>' + leitura.aplicaveis.length + '</strong> linha(s) prontas para lançar' +
          (leitura.problemas.length
            ? ' · <strong>' + leitura.problemas.length + '</strong> com problema'
            : '') + '.</div>' +
        (leitura.problemas.length
          ? '<div class="lista-selecao" style="max-height:170px">' +
            leitura.problemas.slice(0, 40).map(function (l) {
              return '<div class="linha-selecao">' +
                '<span class="sub mono">linha ' + l.linha + '</span>' +
                '<span class="mono forte">' + e(l.codigo || '—') + '</span>' +
                '<span class="etiqueta erro">' + e(cal().MOTIVOS_DO_LOTE[l.situacao]) + '</span>' +
                '</div>';
            }).join('') +
            (leitura.problemas.length > 40
              ? '<div class="linha-selecao sub">e mais ' + (leitura.problemas.length - 40) + '.</div>'
              : '') +
            '</div>'
          : '') +
        (leitura.aplicaveis.length
          ? '<div class="campo" style="margin-top:12px"><label>Prévia das validades</label>' +
            '<div class="lista-selecao" style="max-height:200px">' +
            leitura.aplicaveis.slice(0, 40).map(function (l) {
              var vence = cal().somaMeses(l.data, l.instrumento.periodicidadeMeses || 12);
              return '<div class="linha-selecao">' +
                '<span class="mono forte">' + e(l.instrumento.id) + '</span>' +
                '<span class="sub" style="flex:1">' + e(util.recortar(l.instrumento.nome, 40)) + '</span>' +
                '<span class="sub">' + e(util.formatarData(l.data, true)) + '</span>' +
                '<span class="etiqueta ok">até ' + e(util.formatarData(vence, true)) + '</span>' +
                '</div>';
            }).join('') +
            (leitura.aplicaveis.length > 40
              ? '<div class="linha-selecao sub">e mais ' + (leitura.aplicaveis.length - 40) + '.</div>'
              : '') +
            '</div></div>'
          : '');
    }

    campo.addEventListener('input', conferir);
    campo.addEventListener('change', conferir);
    botao.disabled = true;
    campo.focus();
  }

  /* ---- Tela ---- */

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
          (i.serie && i.serie !== '-' ? ' · série ' + e(i.serie) : '') + '</div></td>' +
        '<td><div>' + e(i.local || '—') + '</div>' +
          '<div class="sub">' + e(i.setor || '') + '</div></td>' +
        '<td><div class="sub">' + e(i.faixa || '—') + '</div>' +
          '<div class="sub">' + e(i.resolucao || '') + '</div></td>' +
        '<td>' + etiquetaSituacao(i.situacao) +
          (i.backup ? '<div><span class="etiqueta">back-up</span></div>' : '') +
          (i.ativo ? '' : '<div><span class="etiqueta erro">desativado</span></div>') + '</td>' +
        '<td>' + (x.ultimaCalibracao
          ? '<div>' + e(util.formatarData(x.ultimaCalibracao, true)) + '</div>' +
            (i.certificado ? '<div class="sub">' + e(i.certificado) + '</div>' : '')
          : '<span class="sub">—</span>') + '</td>' +
        '<td>' + (i.ultimoResultado === 'REPROVADO' && !x.vencimento
          ? '<span class="etiqueta erro">reprovada</span>'
          : x.vencimento
          ? '<div class="forte">' + e(util.formatarData(x.vencimento, true)) + '</div>' +
            '<div class="sub">' + (x.diasParaVencer < 0
              ? 'vencida há ' + Math.abs(x.diasParaVencer) + ' d'
              : 'em ' + x.diasParaVencer + ' d') + '</div>'
          : '<span class="sub">—</span>') + '</td>' +
        '<td>' + etiquetaPrazo(x) +
          (x.criticidade === 'CRITICO'
            ? '<div><span class="etiqueta erro">em uso vencido</span></div>' : '') + '</td>' +
        '<td class="num" style="white-space:nowrap">' +
          (podeEditar
            ? '<button class="botao pequeno primario calibrar">Calibrar</button> ' +
              '<button class="botao pequeno editar">Editar</button> ' +
              '<button class="botao pequeno perigo excluir" title="Remover instrumento">✕</button>'
            : '<span class="sub">—</span>') +
        '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="cabecalho">' +
        '<div><h2>Gerenciamento de calibração</h2>' +
        '<p>Instrumentos e sensores do centro de testes, com a validade da calibração de cada um. ' +
        'A validade sai da última calibração mais a periodicidade — <strong>12 meses</strong> ' +
        'por padrão, ajustável por instrumento —, salvo quando o certificado traz uma data ' +
        'própria.</p></div>' +
        (podeEditar ? '<div class="acoes">' +
          '<button class="botao" id="csv-cal">Exportar CSV</button> ' +
          '<button class="botao" id="lote-cal">Lançar datas em lote</button> ' +
          '<button class="botao primario" id="novo-instrumento">+ Novo instrumento</button></div>' : '') +
      '</div>' +

      '<div class="indicadores">' +
        '<div class="indicador"><div class="rotulo">Instrumentos</div><div class="valor">' +
          resumo.total + '</div><div class="nota">' + resumo.emUso + ' em uso · ' +
          resumo.backup + ' back-up</div></div>' +
        '<div class="indicador"><div class="rotulo">Calibração vencida</div>' +
          '<div class="valor" style="color:' + (resumo.vencidos ? 'var(--erro)' : 'var(--ok)') + '">' +
          resumo.vencidos + '</div><div class="nota">' + resumo.criticos +
          ' em uso agora</div></div>' +
        '<div class="indicador"><div class="rotulo">Vencem em ' + cal().DIAS_DE_ALERTA + ' dias</div>' +
          '<div class="valor"' + (resumo.aVencer ? ' style="color:var(--alerta)"' : '') + '>' +
          resumo.aVencer + '</div><div class="nota">a programar com o laboratório</div></div>' +
        '<div class="indicador"><div class="rotulo">Sem plano</div><div class="valor">' +
          resumo.semPlano + '</div><div class="nota">sem data de calibração informada</div></div>' +
        '<div class="indicador"><div class="rotulo">Cobertura</div><div class="valor">' +
          (resumo.cobertura === null ? '—' : Math.round(resumo.cobertura * 100) + '%') +
          '</div><div class="nota">dos que têm plano, dentro da validade</div></div>' +
      '</div>' +

      /* Vencido e em uso é o achado grave: ensaio medindo com instrumento fora da validade. */
      (criticos.length
        ? '<div class="cartao"><div class="cartao-corpo"><div class="aviso erro" style="margin:0">' +
          '<strong>' + criticos.length + ' instrumento(s) em uso com calibração vencida.</strong> ' +
          'Um ensaio rodando com eles mede fora da validade: ' +
          e(criticos.slice(0, 8).map(function (x) { return x.instrumento.id; }).join(', ')) +
          (criticos.length > 8 ? ' e mais ' + (criticos.length - 8) + '.' : '.') +
          '</div></div></div>'
        : '') +

      '<div class="cartao">' +
        '<div class="cartao-topo"><div class="filtros" style="flex:1">' +
          '<div class="campo busca"><label>Buscar</label><input id="f-cal-busca" ' +
            'placeholder="código, nome, marca, modelo, série ou posto" value="' + e(f.buscaCal || '') + '"></div>' +
          '<div class="campo"><label>Local / posto</label><select id="f-cal-local">' +
            ui.opcoes(opcoesDistintas(instrumentos, 'local'), f.localCal, 'Todos') + '</select></div>' +
          '<div class="campo"><label>Marca</label><select id="f-cal-marca">' +
            ui.opcoes(opcoesDistintas(instrumentos, 'marca'), f.marcaCal, 'Todas') + '</select></div>' +
          '<div class="campo"><label>Situação</label><select id="f-cal-situacao">' +
            ui.opcoes(cal().SITUACOES, f.situacaoCal, 'Todas') + '</select></div>' +
          '<div class="campo"><label>Calibração</label><select id="f-cal-prazo">' +
            ui.opcoes([
              { id: 'VENCIDO', nome: 'Vencida' },
              { id: 'A_VENCER', nome: 'A vencer' },
              { id: 'EM_DIA', nome: 'Em dia' },
              { id: 'SEM_PLANO', nome: 'Sem plano' }
            ], f.prazoCal, 'Todas') + '</select></div>' +
        '</div></div>' +
        (lista.length
          ? '<div class="tabela-rolagem"><table><thead><tr>' +
            '<th>Código</th><th>Instrumento</th><th>Local</th><th>Range / resolução</th>' +
            '<th>Situação</th><th>Última calibração</th><th>Validade</th><th>Prazo</th><th></th>' +
            '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
            '<div class="cartao-corpo sub">' + lista.length + ' de ' + resumo.total +
            ' instrumentos listados.</div>'
          : ui.vazio('Nenhum instrumento encontrado', 'Ajuste os filtros ou cadastre um novo.')) +
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
        ui.confirmarAcao('Remover ' + i.id + ' — ' + i.nome + '? O histórico de calibração vai junto.',
          function () {
            TC.store.removerInstrumento(i.id);
            ui.notificar('Instrumento removido.');
          });
      };
    });
  }

  /* O CSV sai com o que está filtrado na tela: é assim que se manda a lista de um posto
     para o laboratório de calibração. */
  function exportarCsv(lista) {
    var colunas = ['Codigo', 'Codigo antigo', 'Instrumento', 'Setor', 'Local', 'Back-up',
      'Marca', 'Modelo', 'Serie', 'Range', 'Resolucao', 'Situacao', 'Ultima calibracao',
      'Validade', 'Prazo', 'Certificado', 'Laboratorio'];
    var linhas = lista.map(function (x) {
      var i = x.instrumento;
      return [i.id, i.codigoAntigo, i.nome, i.setor, i.local, i.backup ? 'Sim' : 'Não',
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
    a.download = 'calibracao-' + util.hoje() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    ui.notificar(lista.length + ' instrumento(s) exportados.');
  }

  TC.views = TC.views || {};
  TC.views.calibracao = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
