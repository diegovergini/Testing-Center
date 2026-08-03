/* Exports the platform state as CSVs, one per SharePoint list.
   Usage: node ferramentas/exportar-listas.js [backup-file.json]

   With no argument it uses dados/instantaneo.json; without that file, the seed catalogue.
   The CSVs go to dist/listas/ with a UTF-8 BOM, so Excel and SharePoint read accents
   correctly.

   Multi-value fields (the customers that require a procedure, the equipment groups it
   occupies) go into a single text column separated by semicolons — the format SharePoint's
   "Multiple lines of text" column accepts without demanding a lookup list for each one. */
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const destino = path.join(raiz, 'dist', 'listas');
const ESQUEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'listas-schema.json'), 'utf8'));

function carregarEstado() {
  const informado = process.argv[2];
  const instantaneo = path.join(raiz, 'dados', 'instantaneo.json');
  const arquivo = informado || (fs.existsSync(instantaneo) ? instantaneo : null);
  if (!arquivo) return { estado: require('../src/data.js').seed(), origem: 'seed catalogue' };
  const estado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (!estado.testes || !estado.equipamentos) {
    throw new Error(arquivo + ' does not look like a platform backup.');
  }
  return { estado: estado, origem: path.relative(raiz, arquivo) };
}

/* A CSV cell only needs quoting when it holds a separator, a quote or a line break. */
function celula(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  return /[",\n\r]/.test(texto) ? '"' + texto.replace(/"/g, '""') + '"' : texto;
}

/* As colunas vêm do esquema, nunca daqui: é o que impede este gerador e o script de
   provisionamento de divergirem. Uma chave que o esquema não conhece é erro de programação
   e para a exportação — melhor do que gerar um CSV que o SharePoint recusa na hora de colar. */
function csv(nomeDaLista, linhas) {
  const colunas = ['Title'].concat(ESQUEMA[nomeDaLista].map((c) => c.nome));
  linhas.forEach((l) => {
    const sobrando = Object.keys(l).filter((k) => colunas.indexOf(k) === -1);
    if (sobrando.length) {
      throw new Error(nomeDaLista + ': coluna fora do esquema — ' + sobrando.join(', '));
    }
  });
  const corpo = [colunas.join(',')]
    .concat(linhas.map((l) => colunas.map((c) => celula(l[c])).join(',')));
  return '﻿' + corpo.join('\r\n') + '\r\n';
}

function simNao(valor) {
  return valor ? 'Yes' : 'No';
}

function lista(valores) {
  return (valores || []).join('; ');
}

const { estado, origem } = carregarEstado();

const arquivos = {};

arquivos['TC_Clientes'] = csv(
  'TC_Clientes',
  estado.clientes.map((c) => ({ Title: c.id, CustomerName: c.nome, Segment: c.segmento || '' }))
);

/* Test centre parameters: today only the hourly rate, updated once a year. */
arquivos['TC_Parametros'] = csv(
  'TC_Parametros',
  [{ Title: 'HourlyRate', Value: estado.hourlyRate, InForceFor: estado.hourlyRateVigencia || '' }]
);

arquivos['TC_Equipamentos'] = csv(
  'TC_Equipamentos',
  estado.equipamentos.map((eq) => ({
    Title: eq.id, EquipmentName: eq.nome, GroupName: eq.grupo || eq.nome,
    Positions: eq.posicoes, Continuous: simNao(eq.continuo), HoursPerDay: eq.horasDia,
    /* 0 = Sunday. Stored as text because SharePoint has no list-of-numbers column. */
    OperatingDays: lista(eq.diasUteis)
  }))
);

/* Maintenance downtime becomes a list of its own: there are several periods per machine.
   A downtime starts planned (already blocking the calendar) and is closed with the record of
   what was done — this list is where each rig's last and next maintenance come from. */
const manutencoes = [];
estado.equipamentos.forEach((eq) => {
  (eq.manutencao || []).forEach((m) => {
    manutencoes.push({
      Title: eq.id + ' ' + m.inicio, EquipmentId: eq.id,
      StartDate: m.inicio, EndDate: m.fim, MaintenanceType: m.tipo || 'PREVENTIVA',
      Reason: m.motivo || '', MaintenanceStatus: m.situacao || 'PLANEJADA',
      WhatWasDone: m.oQueFoiFeito || '', CarriedOutBy: m.responsavel || ''
    });
  });
});
arquivos['TC_Manutencoes'] = csv(
  'TC_Manutencoes',
  manutencoes);

/* Inventory of instruments and sensors. The calibration plan lives on the instrument
   itself (last calibration, interval and due date); each certificate issued goes into
   TC_Calibracoes. */
arquivos['TC_Instrumentos'] = csv(
  'TC_Instrumentos',
  (estado.instrumentos || []).map((i) => ({
    Title: i.id, LegacyCode: i.codigoAntigo || '', InstrumentName: i.nome,
    Sector: i.setor || '', Station: i.local || '', Backup: simNao(i.backup),
    Brand: i.marca || '', Model: i.modelo || '', Serial: i.serie || '',
    WorkingRange: i.faixa || '', Resolution: i.resolucao || '',
    InstrumentStatus: i.situacao, Active: simNao(i.ativo),
    IntervalMonths: i.periodicidadeMeses || 12,
    LastCalibration: i.ultimaCalibracao || '', NextCalibration: i.proximaCalibracao || '',
    LastResult: i.ultimoResultado || '', Certificate: i.certificado || '',
    Laboratory: i.laboratorio || '', Notes: i.observacao || ''
  }))
);

/* One record per certificate: the history an audit asks for, and what makes it possible to
   prove the instrument was within validity on the date of the test. */
const calibracoes = [];
(estado.instrumentos || []).forEach((i) => {
  (i.historico || []).forEach((c) => {
    calibracoes.push({
      Title: i.id + ' ' + c.data, InstrumentId: i.id, CalibrationDate: c.data,
      Result: c.resultado, NextCalibration: c.proximaCalibracao || '',
      Certificate: c.certificado || '', Laboratory: c.laboratorio || '',
      CarriedOutBy: c.responsavel || '', Notes: c.observacao || ''
    });
  });
});
arquivos['TC_Calibracoes'] = csv(
  'TC_Calibracoes',
  calibracoes);

arquivos['TC_Pecas'] = csv(
  'TC_Pecas',
  estado.pecas.map((p) => ({
    Title: p.id, PartTypeName: p.nome, Description: p.descricao || '',
    CostPerSample: p.custoAmostra || 0
  }))
);

/* The hourly rate is not a procedure column: it is a single test centre parameter, in the
   TC_Parametros list. */
arquivos['TC_Procedimentos'] = csv(
  'TC_Procedimentos',
  estado.testes.map((t) => ({
    Title: t.id, ProcedureName: t.nome, Standard: t.norma || '', Revision: t.revisao || '',
    SystemEnd: t.area, EquipmentGroups: lista(t.equipamentoGrupos), Customers: lista(t.clientes),
    SetupHours: t.horasSetup || 0, TestHours: t.horasEnsaio || 0, ReportingHours: t.horasReport || 0,
    Samples: t.amostras || 1, ConsumablesCost: t.custoInsumos || 0,
    Description: t.descricao || ''
  }))
);

/* CompletionDate, SignOffDate, Status and ReworkRounds are the record of what actually
   happened — they feed the dashboard indicators (tests carried out in the month and right
   first time). The last four columns are filled in by the scheduling engine. */
arquivos['TC_Demandas'] = csv(
  'TC_Demandas',
  (estado.demandas || []).map((d) => ({
    Title: d.id, ProcedureId: d.testeId, PartTypeId: d.pecaId, CustomerId: d.clienteId,
    Project: d.projeto || '', PartNumber: d.partNumber || '', LTI: d.lti || '',
    LTIClassification: d.tipoLti, Priority: d.prioridade, Quantity: d.quantidade,
    SamplesAvailableFrom: d.dataAmostras || '', DueDate: d.prazo || '', ForcedStart: d.inicioFixo || '',
    Notes: d.observacao || '', Status: d.status,
    CompletionDate: d.dataConclusao || '', SignOffDate: d.dataRelatorio || '',
    ReworkRounds: d.relatorioCorrecoes || 0,
    PlannedStart: '', PlannedEnd: '', AllocatedEquipment: '', BlockingReason: ''
  }))
);

arquivos['TC_Cotacoes'] = csv(
  'TC_Cotacoes',
  (estado.cotacoes || []).map((c) => ({
    Title: c.numero, CustomerId: c.clienteId, Project: c.projeto || '',
    PartNumber: c.partNumber || '', LTI: c.lti || '', RequestedBy: c.solicitante || '',
    PlannedExecution: c.previsaoExecucao || '', Status: c.status,
    Notes: c.observacao || '', CreatedOn: c.criadoEm || ''
  }))
);

/* The line items keep the price frozen at the moment of the quote: changing the catalogue
   later must not rewrite a budget already delivered. */
const itens = [];
(estado.cotacoes || []).forEach((c) => {
  (c.itens || []).forEach((i) => {
    itens.push({
      Title: c.numero + ' / ' + i.testeId, QuoteNumber: c.numero, ProcedureId: i.testeId,
      Name: i.nome, Revision: i.revisao || '', Standard: i.norma || '',
      BillableHours: i.horasFaturaveis, HourlyRate: i.hourlyRate,
      HoursCost: i.custoHoras, ConsumablesCost: i.custoInsumos,
      UnitCost: i.custoUnitario, Samples: i.amostras, Total: i.total
    });
  });
});
arquivos['TC_CotacaoItens'] = csv(
  'TC_CotacaoItens',
  itens
);

/* Workflow history: one row per move, for requests and quotes. It is the trail of who moved
   what and when. */
const historico = [];
[['Demanda', estado.demandas || []], ['Cotacao', estado.cotacoes || []]].forEach(([tipo, lista]) => {
  lista.forEach((registro) => {
    (registro.historico || []).forEach((h, i) => {
      const chave = registro.numero || registro.id;
      historico.push({
        Title: chave + ' #' + (i + 1), RecordType: tipo, Record: chave,
        MovedOn: h.em, FromStatus: h.de, ToStatus: h.para, Role: h.perfil || '',
        Note: h.nota || ''
      });
    });
  });
});
arquivos['TC_Historico'] = csv('TC_Historico', historico);

/* Documents attached to requests and to instruments. What goes here is the reference —
   name, link and who attached it — not the file: that already lives in the SharePoint
   library, and the Link column is what points at it. */
const documentos = [];
[['Demanda', estado.demandas || []], ['Instrumento', estado.instrumentos || []]]
  .forEach(([alvo, registros]) => {
    registros.forEach((registro) => {
      (registro.documentos || []).forEach((d) => {
        documentos.push({
          Title: d.id, AttachedTo: alvo, Record: registro.numero || registro.id,
          DocumentType: d.tipo, DocumentName: d.nome, Link: d.link, LinkKind: d.local || '',
          CalibrationId: d.refId || '', AttachedOn: d.anexadoEm || '', Role: d.perfil || '',
          Notes: d.observacao || ''
        });
      });
    });
  });
arquivos['TC_Documentos'] = csv(
  'TC_Documentos',
  documentos);

fs.mkdirSync(destino, { recursive: true });
console.log('Data source: ' + origem);
Object.keys(arquivos).forEach((nome) => {
  const arquivo = path.join(destino, nome + '.csv');
  fs.writeFileSync(arquivo, arquivos[nome]);
  const registros = arquivos[nome].trim().split('\r\n').length - 1;
  console.log('dist/listas/' + nome + '.csv  ' + registros + ' record(s)');
});
