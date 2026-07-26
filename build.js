/* Gera versões de arquivo único a partir do index.html, embutindo CSS e scripts.
   Uso: node build.js
     dist/testing-center.html  página completa, abre com duplo clique ou vai para qualquer host
     dist/artifact.html        mesmo conteúdo sem <html>/<head>/<body>, para hospedagens
                               que envolvem o conteúdo no próprio esqueleto */
const fs = require('fs');
const path = require('path');

const raiz = __dirname;
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), 'utf8').trimEnd();

/* Impede que uma sequência "</script>" dentro do código encerre a tag que o embute. */
const seguro = (js) => js.replace(/<\/script>/gi, '<\\/script>');

let completo = html
  .replace(/[ \t]*<link rel="stylesheet" href="([^"]+)">/,
    (_, arquivo) => '  <style>\n' + ler(arquivo) + '\n  </style>')
  .replace(/[ \t]*<script src="([^"]+)"><\/script>\n?/g,
    (_, arquivo) => '  <script>\n' + seguro(ler(arquivo)) + '\n  </script>\n');

const pendentes = completo.match(/<script src=|<link rel="stylesheet"/g);
if (pendentes) throw new Error('Sobraram referências externas: ' + pendentes.join(', '));

const dist = path.join(raiz, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'testing-center.html'), completo);

/* Versão fragmento: sem doctype nem wrapper, mantendo <title> e o conteúdo do body. */
const titulo = (completo.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
const estilo = (completo.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
const corpo = (completo.match(/<body>([\s\S]*)<\/body>/) || ['', ''])[1];

fs.writeFileSync(
  path.join(dist, 'artifact.html'),
  [titulo, estilo, corpo.trim(), ''].join('\n')
);

const kb = (arquivo) => Math.round(fs.statSync(path.join(dist, arquivo)).size / 1024);
console.log('dist/testing-center.html  ' + kb('testing-center.html') + ' kB');
console.log('dist/artifact.html        ' + kb('artifact.html') + ' kB');
