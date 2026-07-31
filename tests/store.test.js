/* Testes do estado: migração de fases antigas e integridade ao remover cadastros. */
const test = require('node:test');
const assert = require('node:assert');

require('../src/util.js');
const dados = require('../src/data.js');
require('../src/store.js');

const store = globalThis.TC.store;

/* Estado no formato anterior: peça com cliente/área/data, procedimento com fases,
   demanda sem LTI e sem data de amostras. */
function comDadosAntigos() {
  const base = dados.seed();
  base.testes[0].fases = ['CONCEITO', 'DV'];
  base.testes[1].fases = ['PPAP', 'SERIE'];
  delete base.testes[0].revisao;
  base.pecas[0] = {
    id: 'PC-ANTIGA', nome: 'Silencioso traseiro', clienteId: 'CLI-VW', area: 'COLD',
    programa: 'VW MQB-A0', dataAmostras: '2026-09-15', quantidade: 8, custoAmostra: 1650
  };
  base.demandas = [
    { id: 'D1', testeId: base.testes[0].id, pecaId: 'PC-ANTIGA', clienteId: 'CLI-VW',
      fase: 'PPAP', prioridade: 'MEDIA', quantidade: 1, status: 'PENDENTE', criadoEm: '2026-07-06' }
  ];
  return JSON.stringify(base);
}

test('importar migra fases, LTI e a data de amostras para a demanda', () => {
  store.init();
  store.importar(comDadosAntigos());
  const estado = store.get();

  assert.equal(estado.demandas[0].tipoLti, 'PV', 'a antiga fase da demanda vira a classificação da LTI');
  assert.equal(estado.demandas[0].fase, undefined, 'o campo fase não existe mais na demanda');
  assert.equal(estado.demandas[0].lti, '', 'LTI sem número fica em branco para ser preenchida');
  assert.equal(estado.demandas[0].dataAmostras, '2026-09-15',
    'a data que estava na peça passa para a demanda, sem perder o planejamento');
});

test('importar limpa cliente, área e estoque das peças', () => {
  store.importar(comDadosAntigos());
  store.get().pecas.forEach((p) => {
    assert.equal(p.clienteId, undefined);
    assert.equal(p.area, undefined);
    assert.equal(p.programa, undefined);
    assert.equal(p.dataAmostras, undefined);
    assert.equal(p.quantidade, undefined);
  });
});

test('importar tira a fase do procedimento e garante o campo revisão', () => {
  store.importar(comDadosAntigos());
  store.get().testes.forEach((t) => {
    assert.equal(t.fases, undefined, t.id + ' manteve fase amarrada');
    assert.equal(typeof t.revisao, 'string', t.id + ' ficou sem o campo revisão');
  });
});

test('demanda antiga sem data de amostras recebe uma data utilizável', () => {
  const base = dados.seed();
  base.demandas = [
    { id: 'D9', testeId: base.testes[0].id, pecaId: base.pecas[0].id, clienteId: 'CLI-VW',
      tipoLti: 'DV', lti: 'LTI-9', prioridade: 'MEDIA', quantidade: 1, status: 'PENDENTE' }
  ];
  store.importar(JSON.stringify(base));
  assert.equal(store.get().demandas[0].dataAmostras, globalThis.TC.util.hoje());
});

test('remover cliente também o tira da exigência dos procedimentos', () => {
  store.restaurarPadrao();
  const alvo = 'CLI-GM';
  const antes = store.get().testes.filter((t) => (t.clientes || []).includes(alvo));
  assert.ok(antes.length > 0, 'o catálogo de exemplo precisa ter procedimentos deste cliente');

  store.removerCliente(alvo);
  const estado = store.get();

  assert.equal(estado.clientes.filter((c) => c.id === alvo).length, 0);
  estado.testes.forEach((t) => {
    assert.ok(!(t.clientes || []).includes(alvo), t.id + ' ainda aponta para o cliente removido');
  });
});

test('salvar cliente novo gera código e editar preserva o existente', () => {
  store.restaurarPadrao();
  const total = store.get().clientes.length;

  const novo = store.salvarCliente({ nome: 'Marelli', segmento: 'Tier 1' });
  assert.ok(novo.id, 'cliente novo precisa de código');
  assert.equal(store.get().clientes.length, total + 1);

  store.salvarCliente({ id: novo.id, nome: 'Marelli Brasil', segmento: 'Tier 1' });
  assert.equal(store.get().clientes.length, total + 1, 'editar não pode criar outro registro');
  assert.equal(globalThis.TC.util.porId(store.get().clientes, novo.id).nome, 'Marelli Brasil');
});

test('remover uma unidade não desmonta o grupo dos procedimentos', () => {
  store.restaurarPadrao();
  /* O catálogo de partida chega sem bancada definida, então apontamos o grupo aqui. */
  const primeiro = store.get().testes[0];
  store.salvarTeste(Object.assign({}, primeiro, { equipamentoGrupos: ['Burner'] }));

  const usaBurner = (t) => (t.equipamentoGrupos || []).includes('Burner');
  const dependentes = store.get().testes.filter(usaBurner).length;
  assert.ok(dependentes > 0);

  store.removerEquipamento('BURNER-1');
  const estado = store.get();
  assert.equal(estado.equipamentos.filter((e) => e.id === 'BURNER-1').length, 0);
  assert.equal(estado.testes.filter(usaBurner).length, dependentes,
    'os procedimentos seguem pedindo o grupo Burner, agora com 2 unidades');
  assert.equal(estado.equipamentos.filter((e) => e.grupo === 'Burner').length, 2);
});

test('importar troca a unidade do procedimento pelo grupo dela', () => {
  const base = dados.seed();
  base.testes[0] = Object.assign({}, base.testes[0], { equipamentoId: 'BURNER-2' });
  delete base.testes[0].equipamentoGrupos;

  store.importar(JSON.stringify(base));
  const t = store.get().testes[0];
  assert.deepEqual(t.equipamentoGrupos, ['Burner'], 'BURNER-2 pertence ao grupo Burner');
  assert.equal(t.equipamentoId, undefined, 'o campo antigo não fica para trás');
  assert.equal(t.equipamentoIds, undefined);
});

test('importar deduplica grupos quando o procedimento listava unidades irmãs', () => {
  const base = dados.seed();
  base.testes[0] = Object.assign({}, base.testes[0], { equipamentoIds: ['MTS-1', 'MTS-3', 'DYNO'] });
  delete base.testes[0].equipamentoGrupos;

  store.importar(JSON.stringify(base));
  assert.deepEqual(store.get().testes[0].equipamentoGrupos, ['MTS', 'Dynamometer']);
});

test('demanda antiga ganha os campos de projeto e part number vazios', () => {
  const base = dados.seed();
  base.demandas = [
    { id: 'D7', testeId: base.testes[0].id, pecaId: base.pecas[0].id, clienteId: 'CLI-VW',
      tipoLti: 'DV', lti: 'LTI-7', prioridade: 'MEDIA', quantidade: 1, status: 'PENDENTE',
      dataAmostras: '2026-08-01' }
  ];
  store.importar(JSON.stringify(base));
  const d = store.get().demandas[0];
  assert.equal(d.projeto, '');
  assert.equal(d.partNumber, '');
});

/* ---- Substituição do catálogo ---- */

/* Dados sem a marca de versão do catálogo são de antes da troca: o catálogo antigo sai
   inteiro e entra o do cliente. */
function comCatalogoAntigo() {
  const base = dados.seed();
  delete base.catalogoVersao;
  base.clientes = [{ id: 'CLI-VW', nome: 'Volkswagen', segmento: 'OEM' }];
  base.testes = [{
    id: 'TP-VELHO', nome: 'Ensaio que saiu do catálogo', norma: 'X', revisao: 'Rev. 09',
    clientes: [], area: 'HOT', equipamentoGrupos: ['Burner'],
    horasSetup: 2, horasEnsaio: 10, horasReport: 1, amostras: 1,
    hourlyRate: 500, custoInsumos: 100, descricao: ''
  }];
  base.demandas = [{
    id: 'D-VELHA', testeId: 'TP-VELHO', pecaId: 'PC-HOT', clienteId: 'CLI-VW',
    tipoLti: 'DV', lti: 'LTI-1', prioridade: 'MEDIA', quantidade: 1,
    status: 'PENDENTE', dataAmostras: '2026-08-01'
  }];
  return JSON.stringify(base);
}

test('dados salvos antes da troca recebem o catálogo novo no lugar do antigo', () => {
  store.importar(comCatalogoAntigo());
  const estado = store.get();

  assert.equal(estado.testes.filter((t) => t.id === 'TP-VELHO').length, 0,
    'o procedimento do catálogo antigo não fica para trás');
  assert.deepEqual(estado.testes.map((t) => t.id), dados.seed().testes.map((t) => t.id));
  assert.equal(estado.catalogoVersao, dados.CATALOGO_VERSAO);
});

test('a troca de catálogo traz o cliente que os novos procedimentos exigem', () => {
  store.importar(comCatalogoAntigo());
  const estado = store.get();
  assert.ok(globalThis.TC.util.porId(estado.clientes, 'CLI-GM'), 'a GM entra no cadastro');
  assert.ok(globalThis.TC.util.porId(estado.clientes, 'CLI-VW'), 'os clientes já cadastrados ficam');
});

test('demanda de procedimento que saiu do catálogo é descartada na troca', () => {
  store.importar(comCatalogoAntigo());
  assert.equal(store.get().demandas.length, 0,
    'sem procedimento a demanda não teria custo nem bancada');
});

test('procedimentos novos entram sem apagar o que já foi preenchido', () => {
  /* Estado de quem já usava a plataforma na versão 2: só os procedimentos GM, e um
     deles com horas, bancada e rate já cadastrados. */
  const base = dados.seed();
  base.catalogoVersao = 2;
  base.testes = base.testes
    .filter((t) => t.id.indexOf('TP-GM-') === 0)
    .map((t) => (t.id === 'TP-GM-06'
      ? Object.assign({}, t, {
        equipamentoGrupos: ['ColdFlow'], horasSetup: 2, horasEnsaio: 8,
        horasReport: 4, custoInsumos: 1800, area: 'AMBOS'
      })
      : t));
  base.demandas = [
    { id: 'D-GM', testeId: 'TP-GM-06', pecaId: base.pecas[0].id, clienteId: 'CLI-GM',
      projeto: 'Onix', partNumber: 'PN', lti: 'LTI-1', tipoLti: 'PV', prioridade: 'ALTA',
      quantidade: 1, status: 'PENDENTE', dataAmostras: '2026-08-01', prazo: '2026-10-01' }
  ];

  store.importar(JSON.stringify(base));
  const estado = store.get();

  const completado = globalThis.TC.util.porId(estado.testes, 'TP-GM-06');
  assert.equal(completado.custoInsumos, 1800, 'o cadastro já preenchido não pode ser sobrescrito');
  assert.deepEqual(completado.equipamentoGrupos, ['ColdFlow']);
  assert.equal(estado.testes.filter((t) => t.id.indexOf('TP-STL-') === 0).length, 30,
    'os procedimentos Stellantis entram no catálogo');
  assert.equal(estado.demandas.length, 1, 'a demanda existente continua válida');
  assert.equal(estado.catalogoVersao, dados.CATALOGO_VERSAO);
});

test('catálogo já na versão nova não é substituído na carga', () => {
  const base = dados.seed();
  base.testes[0] = Object.assign({}, base.testes[0], { custoInsumos: 777, horasEnsaio: 40 });
  store.importar(JSON.stringify(base));

  const t = store.get().testes[0];
  assert.equal(t.custoInsumos, 777, 'o que o usuário preencheu no catálogo continua lá');
  assert.equal(t.horasEnsaio, 40);
});

test('importar converte custoBase em custo de insumos e tira o rate do procedimento', () => {
  const base = dados.seed();
  base.testes[0] = {
    id: 'TP-ANTIGO', nome: 'Ensaio antigo', norma: '', revisao: 'Rev. 01', clientes: [],
    area: 'HOT', equipamentoId: 'BURNER-1', hourlyRate: 610,
    horasSetup: 2, horasEnsaio: 10, amostras: 1, custoBase: 5000, descricao: ''
  };
  /* o custo-hora saiu do cadastro de equipamento, mas backups antigos ainda o trazem */
  base.equipamentos = base.equipamentos.map((eq) =>
    eq.id === 'BURNER-1' ? Object.assign({}, eq, { custoHora: 610 }) : eq);

  store.importar(JSON.stringify(base));
  const estado = store.get();
  const t = estado.testes[0];

  assert.equal(t.custoInsumos, 5000, 'o custo antigo vira custo de insumos');
  assert.equal(t.custoBase, undefined);
  assert.equal(t.horasReport, 0);
  assert.equal(t.hourlyRate, undefined, 'o rate deixou de ser campo do procedimento');
  assert.equal(estado.hourlyRate, dados.HOURLY_RATE,
    'o backup antigo adota o rate vigente do centro de testes');
});

/* ---- Levantamento de horas ---- */

test('procedimento sem horas medidas recebe as horas do catálogo de partida', () => {
  const base = dados.seed();
  base.catalogoVersao = 8;
  /* Estado de antes do levantamento: o mesmo catálogo, com as horas ainda zeradas. */
  base.testes = base.testes.map((t) =>
    Object.assign({}, t, { horasSetup: 0, horasEnsaio: 0, horasReport: 0 }));

  store.importar(JSON.stringify(base));
  const t = globalThis.TC.util.porId(store.get().testes, 'TP-STL-11');

  assert.equal(t.horasEnsaio, 1089);
  assert.equal(t.horasSetup, 24);
  assert.equal(t.horasReport, 38);
});

test('horas já preenchidas pelo usuário não são sobrescritas pelo levantamento', () => {
  const base = dados.seed();
  base.catalogoVersao = 8;
  base.testes = base.testes.map((t) =>
    t.id === 'TP-STL-11'
      ? Object.assign({}, t, { horasSetup: 1, horasEnsaio: 2, horasReport: 3 })
      : Object.assign({}, t, { horasSetup: 0, horasEnsaio: 0, horasReport: 0 }));

  store.importar(JSON.stringify(base));
  const estado = store.get();

  const meu = globalThis.TC.util.porId(estado.testes, 'TP-STL-11');
  assert.deepEqual([meu.horasEnsaio, meu.horasSetup, meu.horasReport], [2, 1, 3],
    'o cadastro de quem preencheu tem precedência');

  const outro = globalThis.TC.util.porId(estado.testes, 'TP-GM-05');
  assert.equal(outro.horasEnsaio, 700, 'os demais recebem o levantamento normalmente');
});
