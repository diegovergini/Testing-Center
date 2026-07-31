/* Gera versões de arquivo único a partir do index.html, embutindo CSS e scripts.
   Uso: node build.js
     dist/testing-center.html         página completa, abre com duplo clique ou vai para qualquer host
     dist/artifact.html               mesmo conteúdo sem <html>/<head>/<body>, para hospedagens
                                      que envolvem o conteúdo no próprio esqueleto
     dist/testing-center-equipe.html  cópia da equipe: dados embutidos e somente leitura.
                                      Todo mundo que abrir vê os mesmos dados — é o
                                      compartilhamento possível sem servidor.

   A cópia da equipe usa dados/instantaneo.json, que é o arquivo do "Exportar backup"
   de quem mantém o centro de testes. Sem esse arquivo, sai com o catálogo de partida. */
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

/* ---- Cópia da equipe ---- */

const arquivoInstantaneo = path.join(raiz, 'dados', 'instantaneo.json');
let dados, atualizadoEm;

if (fs.existsSync(arquivoInstantaneo)) {
  dados = JSON.parse(fs.readFileSync(arquivoInstantaneo, 'utf8'));
  /* A data do instantâneo é a do arquivo, a menos que o próprio backup traga uma. */
  atualizadoEm = dados.atualizadoEm ||
    fs.statSync(arquivoInstantaneo).mtime.toISOString().slice(0, 10);
} else {
  dados = require('./src/data.js').seed();
  atualizadoEm = new Date().toISOString().slice(0, 10);
}

if (!dados.testes || !dados.equipamentos) {
  throw new Error('dados/instantaneo.json não parece um backup da plataforma.');
}

/* Escapar "<" impede que qualquer texto do backup encerre a tag que embute o JSON. */
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
  '  (dados de ' + atualizadoEm + (fs.existsSync(arquivoInstantaneo) ? '' : ', catálogo de partida') + ')');
