/* Exporta o estado da plataforma como CSVs, um por lista do SharePoint.
   Uso: node ferramentas/exportar-listas.js [arquivo-de-backup.json]

   Sem argumento, usa dados/instantaneo.json; sem esse arquivo, o catálogo de partida.
   Os CSVs saem em dist/listas/ com BOM UTF-8, para o Excel e o SharePoint lerem os
   acentos corretamente.

   Campos de múltiplos valores (os clientes que exigem um procedimento, os grupos de
   equipamento que ele ocupa) vão numa única coluna de texto separados por ponto e
   vírgula — é o formato que a coluna "Várias linhas de texto" do SharePoint aceita sem
   exigir uma lista de relacionamento para cada um. */
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const destino = path.join(raiz, 'dist', 'listas');

function carregarEstado() {
  const informado = process.argv[2];
  const instantaneo = path.join(raiz, 'dados', 'instantaneo.json');
  const arquivo = informado || (fs.existsSync(instantaneo) ? instantaneo : null);
  if (!arquivo) return { estado: require('../src/data.js').seed(), origem: 'catálogo de partida' };
  const estado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (!estado.testes || !estado.equipamentos) {
    throw new Error(arquivo + ' não parece um backup da plataforma.');
  }
  return { estado: estado, origem: path.relative(raiz, arquivo) };
}

/* Uma célula CSV só precisa de aspas quando contém separador, aspas ou quebra de linha. */
function celula(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  return /[",\n\r]/.test(texto) ? '"' + texto.replace(/"/g, '""') + '"' : texto;
}

function csv(colunas, linhas) {
  const corpo = [colunas.join(',')]
    .concat(linhas.map((l) => colunas.map((c) => celula(l[c])).join(',')));
  return '﻿' + corpo.join('\r\n') + '\r\n';
}

function simNao(valor) {
  return valor ? 'Sim' : 'Não';
}

function lista(valores) {
  return (valores || []).join('; ');
}

const { estado, origem } = carregarEstado();

const arquivos = {};

arquivos['TC_Clientes'] = csv(
  ['Title', 'Nome', 'Segmento'],
  estado.clientes.map((c) => ({ Title: c.id, Nome: c.nome, Segmento: c.segmento || '' }))
);

/* Parâmetros do centro de testes: hoje só o hourly rate, atualizado uma vez por ano. */
arquivos['TC_Parametros'] = csv(
  ['Title', 'Valor', 'Vigencia'],
  [{ Title: 'HourlyRate', Valor: estado.hourlyRate, Vigencia: estado.hourlyRateVigencia || '' }]
);

arquivos['TC_Equipamentos'] = csv(
  ['Title', 'Nome', 'Grupo', 'Posicoes', 'Continuo', 'HorasDia', 'DiasUteis'],
  estado.equipamentos.map((eq) => ({
    Title: eq.id, Nome: eq.nome, Grupo: eq.grupo || eq.nome,
    Posicoes: eq.posicoes, Continuo: simNao(eq.continuo), HorasDia: eq.horasDia,
    /* 0 = domingo. Guardado como texto porque o SharePoint não tem coluna de lista de números. */
    DiasUteis: lista(eq.diasUteis)
  }))
);

/* As paradas de manutenção viram uma lista própria: são vários períodos por equipamento
   e cada um tem início, fim e motivo. */
const manutencoes = [];
estado.equipamentos.forEach((eq) => {
  (eq.manutencao || []).forEach((m) => {
    manutencoes.push({
      Title: eq.id + ' ' + m.inicio, EquipamentoId: eq.id,
      Inicio: m.inicio, Fim: m.fim, Motivo: m.motivo || ''
    });
  });
});
arquivos['TC_Manutencoes'] = csv(['Title', 'EquipamentoId', 'Inicio', 'Fim', 'Motivo'], manutencoes);

arquivos['TC_Pecas'] = csv(
  ['Title', 'Nome', 'Descricao', 'CustoAmostra'],
  estado.pecas.map((p) => ({
    Title: p.id, Nome: p.nome, Descricao: p.descricao || '', CustoAmostra: p.custoAmostra || 0
  }))
);

/* O hourly rate não é coluna do procedimento: é um parâmetro único do centro de testes,
   na lista TC_Parametros. */
arquivos['TC_Procedimentos'] = csv(
  ['Title', 'Nome', 'Norma', 'Revisao', 'Area', 'EquipamentoGrupos', 'Clientes',
    'HorasSetup', 'HorasEnsaio', 'HorasReport', 'Amostras', 'CustoInsumos', 'Descricao'],
  estado.testes.map((t) => ({
    Title: t.id, Nome: t.nome, Norma: t.norma || '', Revisao: t.revisao || '',
    Area: t.area, EquipamentoGrupos: lista(t.equipamentoGrupos), Clientes: lista(t.clientes),
    HorasSetup: t.horasSetup || 0, HorasEnsaio: t.horasEnsaio || 0, HorasReport: t.horasReport || 0,
    Amostras: t.amostras || 1, CustoInsumos: t.custoInsumos || 0,
    Descricao: t.descricao || ''
  }))
);

/* DataConclusao, DataRelatorio, RelatorioStatus e RelatorioCorrecoes são o registro da
   execução real — alimentam os indicadores do painel (testes realizados no mês e certo da
   primeira vez). As quatro últimas colunas são preenchidas pelo motor de planejamento. */
arquivos['TC_Demandas'] = csv(
  ['Title', 'ProcedimentoId', 'PecaId', 'ClienteId', 'Projeto', 'PartNumber', 'LTI', 'TipoLTI',
    'Prioridade', 'Quantidade', 'DataAmostras', 'Prazo', 'InicioFixo', 'Observacao', 'Status',
    'DataConclusao', 'DataRelatorio', 'RelatorioStatus', 'RelatorioCorrecoes',
    'InicioPlanejado', 'FimPlanejado', 'EquipamentosAlocados', 'MotivoBloqueio'],
  (estado.demandas || []).map((d) => ({
    Title: d.id, ProcedimentoId: d.testeId, PecaId: d.pecaId, ClienteId: d.clienteId,
    Projeto: d.projeto || '', PartNumber: d.partNumber || '', LTI: d.lti || '',
    TipoLTI: d.tipoLti, Prioridade: d.prioridade, Quantidade: d.quantidade,
    DataAmostras: d.dataAmostras || '', Prazo: d.prazo || '', InicioFixo: d.inicioFixo || '',
    Observacao: d.observacao || '', Status: d.status,
    DataConclusao: d.dataConclusao || '', DataRelatorio: d.dataRelatorio || '',
    RelatorioStatus: d.relatorioStatus || 'NAO_ENVIADO',
    RelatorioCorrecoes: d.relatorioCorrecoes || 0,
    InicioPlanejado: '', FimPlanejado: '', EquipamentosAlocados: '', MotivoBloqueio: ''
  }))
);

arquivos['TC_Cotacoes'] = csv(
  ['Title', 'ClienteId', 'Projeto', 'PartNumber', 'LTI', 'Solicitante', 'PrevisaoExecucao',
    'Status', 'Observacao', 'CriadoEm'],
  (estado.cotacoes || []).map((c) => ({
    Title: c.numero, ClienteId: c.clienteId, Projeto: c.projeto || '',
    PartNumber: c.partNumber || '', LTI: c.lti || '', Solicitante: c.solicitante || '',
    PrevisaoExecucao: c.previsaoExecucao || '', Status: c.status,
    Observacao: c.observacao || '', CriadoEm: c.criadoEm || ''
  }))
);

/* Os itens guardam o preço congelado no momento da cotação: mudar o catálogo depois não
   pode reescrever um orçamento já entregue. */
const itens = [];
(estado.cotacoes || []).forEach((c) => {
  (c.itens || []).forEach((i) => {
    itens.push({
      Title: c.numero + ' / ' + i.testeId, CotacaoNumero: c.numero, ProcedimentoId: i.testeId,
      Nome: i.nome, Revisao: i.revisao || '', Norma: i.norma || '',
      HorasFaturaveis: i.horasFaturaveis, HourlyRate: i.hourlyRate,
      CustoHoras: i.custoHoras, CustoInsumos: i.custoInsumos,
      CustoUnitario: i.custoUnitario, Amostras: i.amostras, Total: i.total
    });
  });
});
arquivos['TC_CotacaoItens'] = csv(
  ['Title', 'CotacaoNumero', 'ProcedimentoId', 'Nome', 'Revisao', 'Norma', 'HorasFaturaveis',
    'HourlyRate', 'CustoHoras', 'CustoInsumos', 'CustoUnitario', 'Amostras', 'Total'],
  itens
);

fs.mkdirSync(destino, { recursive: true });
console.log('Origem dos dados: ' + origem);
Object.keys(arquivos).forEach((nome) => {
  const arquivo = path.join(destino, nome + '.csv');
  fs.writeFileSync(arquivo, arquivos[nome]);
  const registros = arquivos[nome].trim().split('\r\n').length - 1;
  console.log('dist/listas/' + nome + '.csv  ' + registros + ' registro(s)');
});
