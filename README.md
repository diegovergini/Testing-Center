# Testing Center

Gestão da validação de produto e processo de **sistemas de exaustão**: catálogo de ensaios
por cliente (com custo e tempo de execução) e planejamento automático de bancada a partir da
confirmação da necessidade de cada ensaio.

A página responde a três perguntas do dia a dia:

1. **O que cada cliente exige?** — todo procedimento, sob qual norma, para qual peça e em
   qual fase do projeto.
2. **Quanto custa e quanto demora?** — custo de setup, custo por amostra e horas de bancada,
   por ensaio e consolidado por cliente, por fase e por tipo de equipamento.
3. **Quando cabe na agenda?** — ao confirmar a necessidade, o ensaio é alocado sozinho na
   primeira janela livre do equipamento compatível, respeitando a data em que a peça fica
   disponível.

## Como rodar

Não há dependências nem build obrigatório — é HTML, CSS e JavaScript puros.

```bash
npm start          # sobe um servidor estático em http://localhost:8080
npm test           # 19 testes do planejador (node:test)
npm run build      # gera dist/index.html, página única autocontida
```

Também funciona abrindo `index.html` direto no navegador. O build gera dois arquivos:

- `dist/index.html` — página completa autocontida (CSS e JS embutidos). Abre do disco,
  publica em qualquer estático, vai por e-mail.
- `dist/artifact.html` — o mesmo conteúdo sem `<!doctype>`/`<html>`/`<head>`/`<body>`, para
  hospedagens que embrulham o arquivo no próprio esqueleto.

O layout é responsivo: em telas estreitas o cabeçalho compacta, os filtros vão a duas
colunas, a barra de confirmação ancora no rodapé e tabelas e Gantt rolam dentro do próprio
container — a página nunca rola de lado.

Os dados ficam no `localStorage` do navegador. **Exportar base** / **Importar** movem a base
entre máquinas em JSON; **Restaurar** volta à base de exemplo.

## As cinco telas

| Tela | Para quê |
|---|---|
| **Catálogo por cliente** | 81 ensaios (6 clientes × 23 procedimentos-base) com norma, peças, fases, equipamento, duração e custo. Modo **Lista** para filtrar e selecionar; modo **Matriz** para ler procedimento × cliente de uma vez. Seleção múltipla → *Confirmar necessidade*. |
| **Necessidades confirmadas** | Cada ensaio confirmado, com amostras, disponibilidade da peça, data-alvo e prioridade editáveis. Qualquer alteração replaneja na hora. |
| **Planejamento** | Gantt por unidade de equipamento, com fins de semana, paradas de manutenção e marcador de hoje. Abaixo, a lista dos ensaios que estouram a data-alvo ou não acharam janela. |
| **Equipamentos** | Capacidade simultânea, jornada (h/dia), regime de dias úteis e paradas programadas. Alterar aqui reprograma tudo o que depende da unidade. |
| **Visão gerencial** | Carteira por cliente (catálogo disponível × necessidade confirmada), custo por fase e horas por tipo de equipamento. |

## Modelo de dados

**Cliente** → Stellantis, Volkswagen, GM, Toyota, Scania, Mercedes-Benz. Cada um tem fator de
custo e de duração próprios (pesados custam e demoram mais).

**Tipo de peça** → coletor, catalisador, DPF/GPF, SCR, silencioso, tubulação, junta flexível,
ponteira, suportes, isolamento, sensores, sistema completo.

**Fase do projeto** → Conceito/Protótipo, DV, PV, PPAP e Série/Auditoria.

**Procedimento-base** (`assets/js/10-seed.js`) descreve o ensaio em si: peças aplicáveis, tipo
de equipamento, duração de uma corrida, quantas amostras cabem por corrida, custo de setup e
custo por amostra. A **matriz por cliente** diz quais procedimentos aquele cliente exige, sob
qual norma e em quais fases — é a expansão dessas duas estruturas que gera o catálogo.

**Equipamento** é a unidade física. Vários equipamentos podem ser do mesmo tipo (`BDT-01` e
`BDT-02` são bancadas de durabilidade térmica) e o planejador escolhe entre eles. Cada unidade
tem capacidade simultânea, jornada em horas/dia, regime de dias úteis e paradas de manutenção.

**Demanda** é a necessidade confirmada: ensaio do catálogo + projeto + peça + fase + número de
amostras + data em que a peça fica disponível + data-alvo do gate + prioridade.

## Regras do planejador

`assets/js/20-scheduler.js` — guloso, *earliest-finish-first*, determinístico:

1. A fila é ordenada por **prioridade** (Crítica → Baixa), depois **data-alvo**, depois
   **disponibilidade da peça**, depois ID.
2. Nº de corridas = `ceil(amostras / amostras por corrida)`. Horas totais e custo escalam com
   isso: `custo = setup × corridas + custo por amostra × amostras`.
3. Dias produtivos = `ceil(horas / horas por dia da unidade)` — a mesma duração ocupa menos
   dias corridos numa bancada 24/7 do que numa que roda 8 h/dia.
4. O ensaio **não pode começar antes de a peça estar disponível**.
5. Procura-se a primeira sequência de dias produtivos com vaga livre. Dias não elegíveis
   (fim de semana em unidade de dias úteis, parada de manutenção) **pausam** o ensaio e
   empurram a data-fim — os dias corridos aumentam, os dias produtivos não.
6. Entre as unidades compatíveis, vence a que **termina mais cedo**; empate resolve pelo
   início mais cedo.
7. Sem janela dentro do horizonte (540 dias) ou sem unidade do tipo exigido, a demanda vai
   para a lista de pendências com o motivo — nunca é alocada fora da restrição.

Terminar depois da data-alvo **não** impede a alocação: o ensaio é agendado e marcado como
atrasado, porque o gerente precisa ver o atraso, não escondê-lo.

## Estrutura

```
index.html                    página (carrega os scripts em ordem)
assets/css/styles.css         tema claro/escuro
assets/js/00-util.js          datas em UTC, moeda pt-BR, agrupamentos
assets/js/10-seed.js          clientes, peças, fases, equipamentos, procedimentos, matriz
assets/js/20-scheduler.js     algoritmo de alocação (sem dependência de DOM)
assets/js/30-store.js         estado, persistência e replanejamento automático
assets/js/40-views.js         renderização das cinco telas
assets/js/50-app.js           navegação, eventos, exportação CSV/JSON
tests/scheduler.test.js       19 testes do planejador
build.js                      gera dist/index.html autocontido
```

`00-util.js` e `20-scheduler.js` funcionam tanto como script de navegador quanto como módulo
CommonJS, e é por isso que o planejador pode ser testado no Node sem navegador.

## Limites conhecidos

- A granularidade do plano é o **dia**, não a hora. Para ensaios de semanas isso é o certo;
  para ensaios de 4 h significa que a bancada fica marcada pelo dia inteiro.
- Uma parada de manutenção **pausa** o ensaio em vez de invalidá-lo. Para ensaios em que a
  interrupção reprova a corrida (fadiga térmica, por exemplo), o plano é otimista.
- Não há calendário de feriados nem turnos; a jornada é uma média de horas/dia por unidade.
- Não há disponibilidade de pessoas — só de equipamento e de peça.
- A base é local ao navegador. Para uso por várias pessoas ao mesmo tempo é preciso um
  backend; o `exportar`/`importar` cobre o caso de uma pessoa em várias máquinas.
