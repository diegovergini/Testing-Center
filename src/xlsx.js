/* Gerador mínimo de .xlsx (Office Open XML).
   Um .xlsx é um ZIP com alguns XML dentro. Como não há dependências no projeto, o ZIP é
   escrito à mão pelo método "store" (sem compressão), que é válido e dispensa deflate.
   Isso entrega um arquivo que o Excel abre sem o aviso de "formato não confere" que
   apareceria ao renomear um CSV ou um XML de .xls. */
(function (global) {
  'use strict';

  var TC = (global.TC = global.TC || {});

  /* ---------- CRC32, exigido no cabeçalho de cada entrada do ZIP ---------- */

  var TABELA_CRC = (function () {
    var tabela = new Int32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      tabela[i] = c;
    }
    return tabela;
  })();

  function crc32(bytes) {
    var c = -1;
    for (var i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function paraBytes(texto) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(texto);
    /* Node antigo / ambiente sem TextEncoder */
    return new Uint8Array(Buffer.from(texto, 'utf8'));
  }

  /* ---------- ZIP (store) ---------- */

  function escrever16(destino, pos, valor) {
    destino[pos] = valor & 0xFF;
    destino[pos + 1] = (valor >>> 8) & 0xFF;
  }

  function escrever32(destino, pos, valor) {
    destino[pos] = valor & 0xFF;
    destino[pos + 1] = (valor >>> 8) & 0xFF;
    destino[pos + 2] = (valor >>> 16) & 0xFF;
    destino[pos + 3] = (valor >>> 24) & 0xFF;
  }

  /* arquivos: [{ nome, conteudo (string) }] -> Uint8Array com o ZIP completo. */
  function zipar(arquivos) {
    var entradas = arquivos.map(function (a) {
      var nome = paraBytes(a.nome);
      var dados = paraBytes(a.conteudo);
      return { nome: nome, dados: dados, crc: crc32(dados) };
    });

    var tamanhoLocal = entradas.reduce(function (t, e) { return t + 30 + e.nome.length + e.dados.length; }, 0);
    var tamanhoCentral = entradas.reduce(function (t, e) { return t + 46 + e.nome.length; }, 0);
    var saida = new Uint8Array(tamanhoLocal + tamanhoCentral + 22);

    var pos = 0;
    entradas.forEach(function (e) {
      e.offset = pos;
      escrever32(saida, pos, 0x04034B50);      /* assinatura do cabeçalho local */
      escrever16(saida, pos + 4, 20);          /* versão necessária */
      escrever16(saida, pos + 6, 0x0800);      /* nomes em UTF-8 */
      escrever16(saida, pos + 8, 0);           /* método 0 = store */
      escrever16(saida, pos + 10, 0);          /* hora */
      escrever16(saida, pos + 12, 0x21);       /* data: 1980-01-01 */
      escrever32(saida, pos + 14, e.crc);
      escrever32(saida, pos + 18, e.dados.length);
      escrever32(saida, pos + 22, e.dados.length);
      escrever16(saida, pos + 26, e.nome.length);
      escrever16(saida, pos + 28, 0);          /* sem campo extra */
      pos += 30;
      saida.set(e.nome, pos); pos += e.nome.length;
      saida.set(e.dados, pos); pos += e.dados.length;
    });

    var inicioCentral = pos;
    entradas.forEach(function (e) {
      escrever32(saida, pos, 0x02014B50);      /* assinatura do diretório central */
      escrever16(saida, pos + 4, 20);
      escrever16(saida, pos + 6, 20);
      escrever16(saida, pos + 8, 0x0800);
      escrever16(saida, pos + 10, 0);
      escrever16(saida, pos + 12, 0);
      escrever16(saida, pos + 14, 0x21);
      escrever32(saida, pos + 16, e.crc);
      escrever32(saida, pos + 20, e.dados.length);
      escrever32(saida, pos + 24, e.dados.length);
      escrever16(saida, pos + 28, e.nome.length);
      escrever16(saida, pos + 30, 0);
      escrever16(saida, pos + 32, 0);
      escrever16(saida, pos + 34, 0);
      escrever16(saida, pos + 36, 0);
      escrever32(saida, pos + 38, 0);
      escrever32(saida, pos + 42, e.offset);
      pos += 46;
      saida.set(e.nome, pos); pos += e.nome.length;
    });

    escrever32(saida, pos, 0x06054B50);        /* fim do diretório central */
    escrever16(saida, pos + 4, 0);
    escrever16(saida, pos + 6, 0);
    escrever16(saida, pos + 8, entradas.length);
    escrever16(saida, pos + 10, entradas.length);
    escrever32(saida, pos + 12, tamanhoCentral);
    escrever32(saida, pos + 16, inicioCentral);
    escrever16(saida, pos + 20, 0);

    return saida;
  }

  /* ---------- Planilha ---------- */

  function escaparXml(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      /* caracteres de controle quebram o XML do Excel */
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function letraColuna(indice) {
    var nome = '';
    var n = indice + 1;
    while (n > 0) {
      var resto = (n - 1) % 26;
      nome = String.fromCharCode(65 + resto) + nome;
      n = Math.floor((n - resto) / 26);
    }
    return nome;
  }

  /* Célula: número vira <v>, o resto vira texto embutido. Booleano/null viram texto. */
  function celula(referencia, valor, estilo) {
    var atributoEstilo = estilo ? ' s="' + estilo + '"' : '';
    if (typeof valor === 'number' && isFinite(valor)) {
      return '<c r="' + referencia + '"' + atributoEstilo + '><v>' + valor + '</v></c>';
    }
    var texto = valor == null ? '' : String(valor);
    if (!texto) return '<c r="' + referencia + '"' + atributoEstilo + '/>';
    return '<c r="' + referencia + '" t="inlineStr"' + atributoEstilo + '>' +
      '<is><t xml:space="preserve">' + escaparXml(texto) + '</t></is></c>';
  }

  /* linhas: matriz de valores. A primeira linha é tratada como cabeçalho (negrito). */
  function folha(linhas, larguras) {
    var colunas = larguras && larguras.length
      ? '<cols>' + larguras.map(function (largura, i) {
          return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + largura + '" customWidth="1"/>';
        }).join('') + '</cols>'
      : '';

    var corpo = linhas.map(function (valores, indiceLinha) {
      var celulas = valores.map(function (valor, indiceColuna) {
        var estilo = indiceLinha === 0 ? 1 : (typeof valor === 'number' ? 2 : 0);
        return celula(letraColuna(indiceColuna) + (indiceLinha + 1), valor, estilo);
      }).join('');
      return '<row r="' + (indiceLinha + 1) + '">' + celulas + '</row>';
    }).join('');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      colunas + '<sheetData>' + corpo + '</sheetData></worksheet>';
  }

  /* Dois formatos: cabeçalho em negrito e número com separador de milhar. */
  var ESTILOS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* planilhas: [{ nome, linhas, larguras }] -> Uint8Array do .xlsx */
  function gerar(planilhas) {
    var abas = planilhas.map(function (p, i) {
      return { indice: i + 1, nome: (p.nome || ('Planilha' + (i + 1))).slice(0, 31), planilha: p };
    });

    var arquivos = [
      { nome: '[Content_Types].xml',
        conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          abas.map(function (a) {
            return '<Override PartName="/xl/worksheets/sheet' + a.indice + '.xml" ' +
              'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
          }).join('') +
          '</Types>' },

      { nome: '_rels/.rels',
        conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>' },

      { nome: 'xl/workbook.xml',
        conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
          abas.map(function (a) {
            return '<sheet name="' + escaparXml(a.nome) + '" sheetId="' + a.indice + '" r:id="rId' + a.indice + '"/>';
          }).join('') +
          '</sheets></workbook>' },

      { nome: 'xl/_rels/workbook.xml.rels',
        conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          abas.map(function (a) {
            return '<Relationship Id="rId' + a.indice + '" ' +
              'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
              'Target="worksheets/sheet' + a.indice + '.xml"/>';
          }).join('') +
          '<Relationship Id="rIdEstilos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>' },

      { nome: 'xl/styles.xml', conteudo: ESTILOS }
    ];

    abas.forEach(function (a) {
      arquivos.push({
        nome: 'xl/worksheets/sheet' + a.indice + '.xml',
        conteudo: folha(a.planilha.linhas || [], a.planilha.larguras)
      });
    });

    return zipar(arquivos);
  }

  /* Dispara o download no navegador. */
  function baixar(nomeArquivo, planilhas) {
    var bytes = gerar(planilhas);
    var url = URL.createObjectURL(new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }));
    var link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivo;
    link.click();
    URL.revokeObjectURL(url);
  }

  TC.xlsx = { gerar: gerar, baixar: baixar, zipar: zipar, crc32: crc32, letraColuna: letraColuna };

  if (typeof module !== 'undefined' && module.exports) module.exports = TC.xlsx;
})(typeof globalThis !== 'undefined' ? globalThis : this);
