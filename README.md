# Testing Center

Gestão da validação de produto e processo de sistemas de exaustão: catálogo de testes
físicos com custo e tempo de execução, e planejamento automático da bancada a partir da
confirmação de necessidade de cada teste.

O ciclo é o seguinte:

```
Catálogo de testes ──► "Confirmar necessidade" ──► Demanda ──► Planejamento (Gantt)
   custo e duração         LTI, cliente, peça,       fila por      alocado no equipamento
   por procedimento        classificação, prazo      prioridade    respeitando as restrições
```

## Como rodar

Aplicação estática, sem build e sem dependências:

```bash
npm run serve        # http://localhost:8080
```

Qualquer servidor de arquivos estáticos serve (`python3 -m http.server`, Nginx, GitHub Pages).
Abrir o `index.html` direto pelo sistema de arquivos também funciona, mas alguns navegadores
bloqueiam o `localStorage` em `file://` e os dados não persistem — prefira servir por HTTP.

Testes do motor de planejamento:

```bash
npm test
```

## As três restrições do planejamento

Quando você confirma a necessidade de um teste, o motor procura a primeira janela livre
respeitando, nesta ordem:

1. **Disponibilidade da peça** — nenhum ensaio começa antes da data de chegada do lote de
   amostras cadastrada em *Peças e amostras*.
2. **Disponibilidade do equipamento** — cada equipamento tem um número de posições em
   paralelo, um calendário (dias da semana e horas por dia, ou regime contínuo 24 h) e
   janelas de manutenção. Um ensaio nunca atravessa uma parada programada.
3. **Fila** — demandas são ordenadas por prioridade, depois por prazo do cliente, depois por
   ordem de criação. Uma demanda com data de início forçada reserva a posição antes de todas.

A duração em dias sai das horas do procedimento divididas pelo regime do equipamento:
um ensaio de 72 h ocupa 3 dias numa câmara contínua e 9 dias numa bancada de 8 h/dia.
Dias não úteis dentro da janela continuam ocupando a posição, porque a peça segue montada.

## Telas

| Tela | Para quê |
| --- | --- |
| **Catálogo de testes** | Todos os procedimentos por área (Hot End / Cold End), fase de projeto e cliente, com horas de bancada e custo estimado. É daqui que se confirma a necessidade de um teste. |
| **Demandas** | Fila de testes confirmados com o nº da LTI, a janela calculada, folga contra o prazo, custo e status. Exporta CSV. |
| **Planejamento** | Gantt por equipamento e posição, com ocupação, paradas de manutenção e destaque para o que fura o prazo. |
| **Painel** | Custo e horas por cliente, por fase e por área; próximos 30 dias; pontos de atenção. |
| **Clientes** | Quem exige a validação, com procedimentos obrigatórios, peças e custo confirmado de cada um. |
| **Equipamentos** | Capacidade instalada: posições, calendário, custo-hora e paradas. |
| **Peças e amostras** | Quando as amostras chegam, quantas existem e quantas já estão comprometidas. |

## Fases de projeto

São três: **DV** (validação de projeto com protótipos), **PV** (validação com peças de
ferramental definitivo) e **VAVE** (revalidação após mudança de material, processo ou custo).
Cada procedimento marca em quais fases se aplica.

Dados salvos por versões anteriores, que usavam Conceito, PPAP e Série, são convertidos ao
carregar: Conceito vira DV, PPAP vira PV e Série vira VAVE.

## LTI (ordem de serviço)

Toda demanda carrega o número da LTI que a abriu e uma classificação:

* **DV, PV ou VAVE** — entra no planejamento normalmente: reserva bancada, disputa fila por
  prioridade e prazo, e aparece no Gantt. O número da LTI é obrigatório.
* **Cotação** — é orçamento, ainda não é serviço confirmado. O custo e a duração são
  calculados do mesmo jeito, para dar o valor a cotar, mas a demanda não reserva bancada,
  não aparece no Gantt e não conta como "sem janela" no painel. O número da LTI é opcional,
  já que uma cotação pode não ter ordem de serviço ainda.

Quando uma LTI de cotação vira serviço de fato, basta editar a demanda e trocar a
classificação para DV, PV ou VAVE — ela entra na fila e recebe uma janela no próximo
recálculo do planejamento.

## Modelo de custo

```
custo do ensaio = custo base do procedimento      (mão de obra, instrumentação, insumos)
                + horas × custo-hora do equipamento (setup + ensaio)
                + amostras × custo unitário da peça
```

Os três componentes são editáveis: o custo base no catálogo, o custo-hora em Equipamentos e
o custo da amostra em Peças.

## Dados

O estado fica no `localStorage` do navegador. O catálogo que vem junto (20 procedimentos,
13 equipamentos, 9 peças, 6 clientes) é um ponto de partida realista para ser substituído
pelos dados reais do laboratório — tudo é editável pela interface.

* **Exportar backup** grava um JSON com todo o estado.
* **Importar backup** restaura esse JSON, inclusive em outra máquina.
* **Restaurar padrão** volta ao catálogo de exemplo e apaga as demandas.

Como não há servidor, o backup é o mecanismo de compartilhamento entre pessoas. Se mais de
um usuário precisar enxergar o mesmo planejamento ao mesmo tempo, o passo natural é trocar
o `src/store.js` por uma API — o restante do código não depende de onde os dados moram.

## Organização do código

```
index.html            carrega os scripts na ordem; sem bundler
assets/styles.css     tema claro/escuro
src/util.js           datas em UTC, moeda, escape de HTML
src/data.js           catálogo inicial (clientes, equipamentos, testes, peças)
src/scheduler.js      motor de alocação e cálculo de custo — sem dependência de DOM
src/store.js          estado, persistência e CRUD
src/ui.js             modal, notificações, etiquetas
src/views/*.js        uma tela por arquivo
build.js              gera as versões de arquivo único em dist/
src/app.js            navegação e recálculo do planejamento
tests/                testes do motor (node:test)
```

`src/scheduler.js` é puro e roda também no Node, por isso as regras de alocação são
cobertas por testes: capacidade em paralelo, manutenção, fim de semana, prioridade, prazo,
início forçado e cálculo de custo.
