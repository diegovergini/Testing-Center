/* Builds single-file versions from index.html, inlining CSS and scripts.
   Usage: node build.js
     dist/testing-center.html         full page, opens on double click or goes to any host
     dist/artifact.html               same content without <html>/<head>/<body>, for hosts
                                      that wrap the content in their own skeleton
     dist/testing-center-equipe.html  team copy: embedded data, read only. Everyone who
                                      opens it sees exactly the same data — the sharing
                                      that is possible without a server.

   The team copy uses dados/instantaneo.json, the file produced by "Export backup" on the
   machine of whoever keeps the test centre. Without that file it ships the seed
   catalogue. */
const fs = require('fs');
const path = require('path');

const raiz = __dirname;
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), 'utf8').trimEnd();

/* Stops a "</script>" sequence inside the code from closing the tag that embeds it. */
const seguro = (js) => js.replace(/<\/script>/gi, '<\\/script>');

let completo = html
  .replace(/[ \t]*<link rel="stylesheet" href="([^"]+)">/,
    (_, arquivo) => '  <style>\n' + ler(arquivo) + '\n  </style>')
  .replace(/[ \t]*<script src="([^"]+)"><\/script>\n?/g,
    (_, arquivo) => '  <script>\n' + seguro(ler(arquivo)) + '\n  </script>\n');

const pendentes = completo.match(/<script src=|<link rel="stylesheet"/g);
if (pendentes) throw new Error('External references left over: ' + pendentes.join(', '));

const dist = path.join(raiz, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'testing-center.html'), completo);

/* Fragment version: no doctype and no wrapper, keeping <title> and the body content. */
const titulo = (completo.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
const estilo = (completo.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
const corpo = (completo.match(/<body>([\s\S]*)<\/body>/) || ['', ''])[1];

fs.writeFileSync(
  path.join(dist, 'artifact.html'),
  [titulo, estilo, corpo.trim(), ''].join('\n')
);

/* ---- Team copy ---- */

const arquivoInstantaneo = path.join(raiz, 'dados', 'instantaneo.json');
let dados, atualizadoEm;

if (fs.existsSync(arquivoInstantaneo)) {
  dados = JSON.parse(fs.readFileSync(arquivoInstantaneo, 'utf8'));
  /* The snapshot date is the file's, unless the backup itself carries one. */
  atualizadoEm = dados.atualizadoEm ||
    fs.statSync(arquivoInstantaneo).mtime.toISOString().slice(0, 10);
} else {
  dados = require('./src/data.js').seed();
  atualizadoEm = new Date().toISOString().slice(0, 10);
}

if (!dados.testes || !dados.equipamentos) {
  throw new Error('dados/instantaneo.json does not look like a platform backup.');
}

/* Escaping "<" stops any text from the backup closing the tag that embeds the JSON. */
const publicacao = '  <script>\n' +
  '  window.TC = window.TC || {};\n' +
  '  TC.PUBLICACAO = { atualizadoEm: ' + JSON.stringify(atualizadoEm) + ', dados: ' +
  JSON.stringify(dados).replace(/</g, '\\u003c') + ' };\n' +
  '  </script>\n';

fs.writeFileSync(
  path.join(dist, 'testing-center-equipe.html'),
  completo.replace('  <script>', publicacao + '  <script>')
);

const kb = (arquivo) => Math.round(fs.statSync(path.join(dist, arquivo)).size / 1024);
console.log('dist/testing-center.html         ' + kb('testing-center.html') + ' kB');
console.log('dist/artifact.html               ' + kb('artifact.html') + ' kB');
console.log('dist/testing-center-equipe.html  ' + kb('testing-center-equipe.html') + ' kB' +
  '  (data as of ' + atualizadoEm + (fs.existsSync(arquivoInstantaneo) ? '' : ', seed catalogue') + ')');
