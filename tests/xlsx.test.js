/* Testes do gerador de .xlsx: o arquivo precisa ser um ZIP válido com XML bem formado. */
const test = require('node:test');
const assert = require('node:assert');
const xlsx = require('../src/xlsx.js');

function lerUInt32(bytes, pos) {
  return (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16) | (bytes[pos + 3] << 24)) >>> 0;
}

test('CRC32 bate com o vetor conhecido', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(xlsx.crc32(bytes), 0xCBF43926);
});

test('nomes de coluna seguem a sequência do Excel', () => {
  assert.equal(xlsx.letraColuna(0), 'A');
  assert.equal(xlsx.letraColuna(25), 'Z');
  assert.equal(xlsx.letraColuna(26), 'AA');
  assert.equal(xlsx.letraColuna(27), 'AB');
  assert.equal(xlsx.letraColuna(51), 'AZ');
  assert.equal(xlsx.letraColuna(52), 'BA');
});

test('o arquivo começa e termina com as assinaturas do ZIP', () => {
  const bytes = xlsx.gerar([{ nome: 'Teste', linhas: [['a', 1]] }]);
  assert.equal(lerUInt32(bytes, 0), 0x04034B50, 'cabeçalho local no início');

  /* fim do diretório central: 22 bytes finais, sem comentário */
  const fim = bytes.length - 22;
  assert.equal(lerUInt32(bytes, fim), 0x06054B50);
  const entradas = bytes[fim + 10] | (bytes[fim + 11] << 8);
  assert.equal(entradas, 6, '5 partes fixas + 1 planilha');
});

test('o offset do diretório central aponta para uma assinatura válida', () => {
  const bytes = xlsx.gerar([{ nome: 'A', linhas: [['x']] }, { nome: 'B', linhas: [['y']] }]);
  const fim = bytes.length - 22;
  const inicioCentral = lerUInt32(bytes, fim + 16);
  const tamanhoCentral = lerUInt32(bytes, fim + 12);

  assert.equal(lerUInt32(bytes, inicioCentral), 0x02014B50, 'diretório central no offset gravado');
  assert.equal(inicioCentral + tamanhoCentral, fim, 'o diretório termina onde começa o EOCD');
});

test('número vira <v> e texto vira string embutida', () => {
  const bytes = xlsx.gerar([{ nome: 'Teste', linhas: [['Código', 'Total'], ['TP-01', 1234.5]] }]);
  const conteudo = Buffer.from(bytes).toString('latin1');
  assert.ok(conteudo.includes('<v>1234.5</v>'), 'número entra como número');
  assert.ok(conteudo.includes('t="inlineStr"'), 'texto entra como string embutida');
});

test('caracteres especiais do XML são escapados', () => {
  const bytes = xlsx.gerar([{ nome: 'Teste', linhas: [['a & b <c> "d"']] }]);
  const conteudo = Buffer.from(bytes).toString('utf8');
  assert.ok(conteudo.includes('a &amp; b &lt;c&gt;'));
  assert.ok(!conteudo.includes('<c> "d"</t>'), 'nada de tag crua vazando');
});

test('nome de planilha é cortado no limite do Excel', () => {
  const nomeLongo = 'Planilha com um nome muito comprido que o Excel recusa';
  const bytes = xlsx.gerar([{ nome: nomeLongo, linhas: [['x']] }]);
  const conteudo = Buffer.from(bytes).toString('utf8');
  assert.ok(conteudo.includes('name="' + nomeLongo.slice(0, 31) + '"'));
});
