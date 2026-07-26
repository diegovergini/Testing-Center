#!/usr/bin/env node
/* Gera dist/index.html — uma única página autocontida (CSS e JS embutidos),
   para abrir direto do disco, publicar em qualquer estático ou enviar por e-mail. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const raiz = __dirname;
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

function ler(rel) {
  return fs.readFileSync(path.join(raiz, rel), 'utf8');
}

let saida = html.replace(
  /<link rel="stylesheet" href="([^"]+)">/g,
  (_, href) => '<style>\n' + ler(href) + '\n</style>'
);

saida = saida.replace(
  /<script src="([^"]+)"><\/script>\s*/g,
  (_, src) => '<script>\n' + ler(src) + '\n</script>\n'
);

const restos = saida.match(/(src|href)="assets\//g);
if (restos) {
  console.error('Referências externas não embutidas:', restos.join(', '));
  process.exit(1);
}

fs.mkdirSync(path.join(raiz, 'dist'), { recursive: true });
const destino = path.join(raiz, 'dist', 'index.html');
fs.writeFileSync(destino, saida);
console.log('dist/index.html gerado —', (Buffer.byteLength(saida) / 1024).toFixed(1), 'kB');

/* dist/artifact.html — mesma página, sem <!doctype>/<html>/<head>/<body>, para
   hospedagens que embrulham o conteúdo no próprio esqueleto. */
const titulo = (saida.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'Testing Center';
const corpo = (saida.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1];
const estilos = (saida.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');

if (!corpo) {
  console.error('Não foi possível extrair o <body> da página construída.');
  process.exit(1);
}

const fragmento = '<title>' + titulo + '</title>\n' + estilos + '\n' + corpo.trim() + '\n';
fs.writeFileSync(path.join(raiz, 'dist', 'artifact.html'), fragmento);
console.log('dist/artifact.html gerado —', (Buffer.byteLength(fragmento) / 1024).toFixed(1), 'kB');
