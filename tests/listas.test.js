/* Tests for the SharePoint load files.

   These guard the handover, not the application: the CSVs in dist/listas/ and the columns
   ferramentas/provisionar-listas.ps1 creates have to describe the same lists. They used to
   keep two separate lists of columns, and translating the platform into English changed only
   one side — the script created "Nome" while the CSV carried "Name". Nothing failed here;
   it would have failed while pasting data into the site. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const raiz = path.join(__dirname, '..');
const pastaCsv = path.join(raiz, 'dist', 'listas');
const esquema = JSON.parse(
  fs.readFileSync(path.join(raiz, 'ferramentas', 'listas-schema.json'), 'utf8'));

const LISTAS = Object.keys(esquema).filter((k) => !k.startsWith('_'));

/* The CSVs are a build artefact: regenerate before reading so the test never passes on a
   stale file left over from an earlier run. */
test.before(() => {
  execFileSync('node', [path.join(raiz, 'ferramentas', 'exportar-listas.js')], { cwd: raiz });
});

function cabecalho(lista) {
  const bruto = fs.readFileSync(path.join(pastaCsv, lista + '.csv'), 'utf8');
  return bruto.replace(/^﻿/, '').split('\r\n')[0].split(',');
}

function linhas(lista) {
  const bruto = fs.readFileSync(path.join(pastaCsv, lista + '.csv'), 'utf8');
  return bruto.replace(/^﻿/, '').trim().split('\r\n').slice(1);
}

/* A real split, not linha.split(','): a quoted cell can hold a comma. The acoustic
   calibrator's resolution is "94dB± 0,2 - 1kHz", and splitting naively shifted every column
   after it — the first version of this test blamed the data for its own bug. */
function campos(linha) {
  const saida = [];
  let atual = '';
  let entreAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (entreAspas) {
      if (c === '"' && linha[i + 1] === '"') { atual += '"'; i++; }
      else if (c === '"') entreAspas = false;
      else atual += c;
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === ',') {
      saida.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  saida.push(atual);
  return saida;
}

test('every list in the schema has a load file, and no file is left over', () => {
  const arquivos = fs.readdirSync(pastaCsv)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => f.replace(/\.csv$/, ''))
    .sort();
  assert.deepEqual(arquivos, LISTAS.slice().sort());
});

/* This is the assertion that would have caught the translation: the header of each CSV has to
   be Title plus exactly the schema columns, in the same order. */
test('the CSV header matches the schema column by column', () => {
  LISTAS.forEach((lista) => {
    const esperado = ['Title'].concat(esquema[lista].map((c) => c.nome));
    assert.deepEqual(cabecalho(lista), esperado, lista + ' is out of step with the schema');
  });
});

/* SharePoint refuses (or silently renames) a column whose internal name is one of its own.
   The failure only shows up when the data is pasted in, which is the worst moment to find it. */
test('no column uses a name SharePoint reserves', () => {
  const RESERVADOS = ['ID', 'Name', 'Type', 'Order', 'Created', 'Modified', 'Author', 'Editor',
    'Version', 'GUID', 'Attachments', 'File', 'FileRef', 'FileLeafRef', 'ContentType',
    'Folder', 'Path', 'Level', 'Selected', 'All', 'Rank', 'Title'];

  LISTAS.forEach((lista) => {
    esquema[lista].forEach((c) => {
      assert.equal(RESERVADOS.indexOf(c.nome), -1,
        lista + '.' + c.nome + ' collides with a SharePoint built-in name');
    });
  });
});

test('every column declares a type SharePoint understands', () => {
  const TIPOS = ['Text', 'Note', 'Number', 'Currency', 'DateTime', 'Choice'];
  LISTAS.forEach((lista) => {
    esquema[lista].forEach((c) => {
      assert.ok(TIPOS.indexOf(c.tipo) !== -1, lista + '.' + c.nome + ': unknown type ' + c.tipo);
      if (c.tipo === 'Choice') {
        assert.ok(Array.isArray(c.opcoes) && c.opcoes.length,
          lista + '.' + c.nome + ' is a Choice with no options');
      }
    });
  });
});

/* A value outside the declared options loads as blank in a SharePoint choice column — the
   record goes in and the field comes out empty, which is worse than an error. */
test('every value exported into a Choice column is declared in the schema', () => {
  LISTAS.forEach((lista) => {
    const colunas = ['Title'].concat(esquema[lista].map((c) => c.nome));
    const escolhas = {};
    esquema[lista].forEach((c) => {
      if (c.tipo === 'Choice') escolhas[colunas.indexOf(c.nome)] = c.opcoes;
    });
    if (!Object.keys(escolhas).length) return;

    linhas(lista).forEach((linha, n) => {
      const celulas = campos(linha);
      Object.keys(escolhas).forEach((indice) => {
        const valor = celulas[indice];
        if (valor === undefined || valor === '') return;
        assert.ok(escolhas[indice].indexOf(valor) !== -1,
          lista + ' row ' + (n + 1) + ': "' + valor + '" is not an option of ' +
          colunas[indice]);
      });
    });
  });
});

/* Title is how the lists reference each other (ProcedureId, CustomerId, InstrumentId). A
   repeated or empty Title breaks the lookup on the Power Apps side. */
test('Title is filled in and unique in every load file', () => {
  LISTAS.forEach((lista) => {
    const titulos = linhas(lista).map((l) => campos(l)[0]);
    titulos.forEach((t, n) => {
      assert.ok(t && t.trim(), lista + ' row ' + (n + 1) + ' has no Title');
    });
    assert.equal(new Set(titulos).size, titulos.length, lista + ' has a repeated Title');
  });
});

/* The seed load is what goes into the site on day one; these are the counts the runbook
   tells whoever is doing it to check on screen. */
test('the seed load carries the expected volume', () => {
  assert.equal(linhas('TC_Instrumentos').length, 229);
  assert.equal(linhas('TC_Procedimentos').length, 73);
  assert.equal(linhas('TC_Equipamentos').length, 11);
  assert.equal(linhas('TC_Clientes').length, 9);
  assert.equal(linhas('TC_Pecas').length, 5);
  assert.equal(linhas('TC_Parametros').length, 1);
});

/* The dates go in as ISO, which is what SharePoint reads without depending on the site's
   regional setting — 03/08 is 3 August here and 8 March there. */
test('the dates in the load file are ISO', () => {
  const colunas = ['Title'].concat(esquema.TC_Instrumentos.map((c) => c.nome));
  const indice = colunas.indexOf('LastCalibration');
  linhas('TC_Instrumentos').forEach((l, n) => {
    assert.match(campos(l)[indice], /^\d{4}-\d{2}-\d{2}$/,
      'TC_Instrumentos row ' + (n + 1) + ' has a non-ISO date');
  });
});
