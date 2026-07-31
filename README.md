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

Gerar os arquivos de distribuição:

```bash
node build.js
```

## Publicar para a equipe

Os dados vivem no `localStorage` **do navegador de cada pessoa**. Hospedar o arquivo, por si
só, não compartilha nada: dez pessoas abrindo o mesmo endereço veriam dez planejamentos
independentes. Enquanto não existir servidor, o compartilhamento é feito por instantâneo.

1. Quem mantém o centro de testes clica em **Exportar backup** e salva o JSON como
   `dados/instantaneo.json`.
2. `node build.js` gera **`dist/testing-center-equipe.html`** com esses dados embutidos.
3. Esse arquivo vai para onde a equipe alcança — biblioteca do SharePoint, pasta de rede,
   servidor web interno. É um HTML único, sem instalação e sem dependência externa.

Na cópia da equipe a aplicação lê do instantâneo embutido, **ignora o `localStorage` e não
grava nada**: todo mundo vê exatamente os mesmos dados, e a barra lateral mostra a data
daquele instantâneo para ninguém decidir em cima de um planejamento vencido sem perceber.
Nenhuma janela é editável — os botões de criar, editar e confirmar necessidade não aparecem,
e o seletor de perfil continua servindo para escolher o recorte de telas que se quer ver.

Atualizar é repetir os três passos. Sem `dados/instantaneo.json` o build sai com o catálogo
de partida, o que serve para demonstrar a plataforma.

O instantâneo carrega dados reais — hora-homem, custo de insumos, demandas e cotações.
Decida conscientemente se ele deve ser versionado junto com o código ou ficar fora do
repositório.

Isto é uma etapa, não o destino: um editor e muitos leitores. Vários usuários editando ao
mesmo tempo exige dados compartilhados, login e permissão de verdade. Dois caminhos avaliados:

* [docs/power-platform.md](docs/power-platform.md) — **o caminho escolhido**: SharePoint Lists
  como banco, Power App como interface, Office Script com o motor de planejamento atual. Só
  ferramentas oficiais da empresa, com a área de testes como dona da ferramenta.
  `node ferramentas/exportar-listas.js` já gera os CSVs de carga das listas.
* [docs/hospedagem.md](docs/hospedagem.md) — Azure App Service + Entra ID + PostgreSQL.
  Tecnicamente melhor, mas depende de provisionamento e de a TI assumir suporte de código.

## As três restrições do planejamento

Quando você confirma a necessidade de um teste, o motor procura a primeira janela livre
respeitando, nesta ordem:

1. **Disponibilidade da peça** — nenhum ensaio começa antes da data de chegada das amostras,
   informada na própria demanda (o mesmo tipo de peça chega em datas diferentes conforme o
   cliente e o programa).
2. **Disponibilidade do equipamento** — cada equipamento tem um número de posições em
   paralelo, um calendário (dias da semana e horas por dia, ou regime contínuo 24 h) e
   janelas de manutenção. Um ensaio nunca atravessa uma parada programada. O procedimento
   pede um **grupo** de bancada, e o planejamento escolhe dentro dele a unidade que libera
   mais cedo. Um procedimento pode ocupar **mais de um grupo ao mesmo tempo**: aí a janela
   precisa estar livre em todos simultaneamente, e o ritmo é ditado pela bancada de turno
   mais curto — 500 h num dinamômetro 24 h/dia levam 21 dias sozinhas, mas 63 se o ensaio
   também prender uma bancada de 8 h/dia.
3. **Fila** — demandas são ordenadas por prioridade, depois por prazo do cliente, depois por
   ordem de criação. Uma demanda com data de início forçada reserva a posição antes de todas.

A duração em dias sai das horas do procedimento divididas pelo regime do equipamento:
um ensaio de 72 h ocupa 3 dias numa câmara contínua e 9 dias numa bancada de 8 h/dia.
Dias não úteis dentro da janela continuam ocupando a posição, porque a peça segue montada.

## Telas

| Tela | Para quê |
| --- | --- |
| **Cotações** | Orçamentos pedidos pela engenharia de produto: escolhe-se os testes, a plataforma monta a tabela de custos, arquiva e exporta em Excel. |
| **Catálogo de testes** | Todos os procedimentos por área (Hot End / Cold End) e cliente, com revisão vigente, horas de bancada e custo estimado. É daqui que se confirma a necessidade de um teste. |
| **Demandas** | Fila de testes confirmados com o nº da LTI, projeto, part number, a janela calculada, folga contra o prazo, custo e status. Exporta CSV. |
| **Planejamento** | Gantt por equipamento e posição, com ocupação, paradas de manutenção e destaque para o que fura o prazo. |
| **Painel** | Custo e horas por cliente, por fase e por área; próximos 30 dias; pontos de atenção. |
| **Clientes** | Quem exige a validação, com procedimentos obrigatórios, peças e custo confirmado de cada um. |
| **Equipamentos** | Capacidade instalada: grupo, posições, calendário e paradas. É restrição de agenda, não de custo. |
| **Peças e amostras** | Os tipos de peça que o laboratório ensaia, com o custo unitário da amostra e o consumo acumulado. |
| **Perfis e permissões** | Matriz de quem vê e quem edita cada janela. |

## Perfis e permissões

Dois perfis usam a plataforma:

* **Engenheiro de Produto** — cliente interno. Pede cotações e abre demandas de teste. Vê o
  catálogo e o planejamento, mas não os altera; não acessa cadastros nem os KPIs.
* **Engenheiro de Testes** — mantém o catálogo e os cadastros, opera o laboratório e
  acompanha os KPIs. Acessa tudo.

| Janela | Produto | Testes |
| --- | --- | --- |
| Catálogo de testes | ver | ver + editar |
| Cotações | ver + editar | ver + editar |
| Demandas | ver + editar | ver + editar |
| Planejamento | ver | ver + editar |
| Painel (KPIs) | — | ver + editar |
| Clientes, Equipamentos, Peças | — | ver + editar |
| Perfis e permissões | — | ver + editar |

A matriz é editável em *Perfis e permissões*, e marcar **editar** liga **ver** junto.
Quem está sem permissão de edição vê a janela com um selo de somente leitura e sem os
botões de ação.

> **Isto não é controle de acesso.** Sem servidor, o perfil é uma escolha da própria
> interface: organiza o trabalho e evita edição acidental, mas quem abrir o console ou o
> backup JSON alcança tudo. Autenticação de verdade exige um back-end — é a mesma troca do
> `src/store.js` por uma API descrita em *Dados*.

## Cotações

O engenheiro de produto informa a LTI, o cliente, o projeto, o part number, o solicitante e
a previsão de execução; escolhe os procedimentos e, para cada um, quantas amostras vai
ensaiar. A plataforma monta a tabela com o custo de cada teste — horas, hourly rate,
insumos, custo unitário, amostras e total — e a soma geral.

**A quantidade de amostras multiplica o custo do procedimento**, porque cada amostra é uma
execução na bancada. O campo já vem com o número padrão do procedimento no catálogo.

Como a lista de procedimentos cresce, o quadro *testes a cotar* tem três filtros que se
combinam: busca livre (nome, código, norma), **cliente** (mostra os procedimentos exigidos
por ele mais os padrão do laboratório) e **LTI** (mostra os procedimentos já demandados sob
aquela ordem de serviço). Eles começam neutros, e o que já foi marcado continua visível
mesmo que o filtro mude — nada sai da conta sem você ver.

Cada cotação recebe um número sequencial (`COT-2026-0001`), fica arquivada na plataforma com
um status (em elaboração, enviada, aprovada, recusada) e sai em **Excel** (`.xlsx` de
verdade, gerado sem dependências).

**Os preços ficam congelados na cotação.** Mudar o hourly rate no catálogo depois não
reescreve um orçamento já entregue — a cotação guarda a cópia dos valores do dia em que foi
gerada, inclusive a revisão do procedimento.

## Fases de projeto

São três: **DV** (Design Validation), **PV** (Process Validation) e **VAVE** (revalidação
após mudança de material, processo ou custo).

A fase **não** classifica o procedimento — qualquer teste do catálogo pode ser executado em
qualquer fase. Ela classifica a LTI que abre a demanda.

Dados salvos por versões anteriores, que usavam Conceito, PPAP e Série, são convertidos ao
carregar: Conceito vira DV, PPAP vira PV e Série vira VAVE.

## Catálogo, equipamentos e peças

O catálogo de partida traz os procedimentos por cliente, transcritos da especificação de
cada um com nome, norma e revisão 1: **11 da GM** (`TP-GM-01` a `TP-GM-11`), **30 da
Stellantis** (`TP-STL-01` a `TP-STL-30`), **11 da Ford** (`TP-FRD-01` a `TP-FRD-11`) e
**4 da Volkswagen** (`TP-VW-01` a `TP-VW-04`), **9 da Hyundai** (`TP-HYU-01` a
`TP-HYU-09`), **4 da RSA** (`TP-RSA-01` a `TP-RSA-04`) e **4 da Nissan**
(`TP-NIS-01` a `TP-NIS-04`).
No cadastro de clientes, `CLI-FRD` é a Ford e `CLI-FOR` é a Forvia Faurecia — empresas
diferentes. Os demais campos — equipamento, horas, hourly rate, insumos, área e amostras —
chegam em branco para o engenheiro de testes preencher: até isso acontecer o procedimento
aparece marcado como *sem equipamento* e com custo R$ 0, e uma demanda sobre ele fica
bloqueada no planejamento com o motivo *procedimento sem equipamento definido*.

O **catálogo** guarda o procedimento com sua **revisão vigente** (`Rev. 01`), a norma, a área
do sistema, os equipamentos que ele ocupa, as horas (setup, ensaio e report), o hourly rate e
o custo de insumos. A revisão acompanha o
procedimento em toda a aplicação — tabela, demanda, Gantt e CSV — para não restar dúvida sobre
qual versão foi executada.

Os **equipamentos** são as bancadas reais do laboratório: Burner 1/2/3, Shaker, MTS 1/2/3/4,
LMS / PTA, ColdFlow e Dynamometer. Cada um tem posições em paralelo e calendário — são
restrições de agenda, não de custo.

Unidades que fazem a mesma coisa ficam num **grupo**: `Burner` reúne as três, `MTS` as
quatro. O procedimento pede o grupo, nunca a unidade — quem escolhe a máquina é o
planejamento, sempre a que libera mais cedo (empate no início vai para a que termina antes).
Assim três ensaios de Burner rodam em paralelo nas três unidades, e o quarto emenda na
primeira que vagar. Uma bancada sem grupo definido forma um grupo só dela.

Um procedimento pode marcar vários grupos: o ensaio então reserva uma unidade de cada e
aparece em todas as linhas correspondentes do Gantt.

As **peças** são tipos genéricos — Hot End, Canning, Cold End, Muffler e Component. Não
pertencem a um cliente nem a uma área: qualquer cliente pode trazer amostra de qualquer tipo.
Da peça vem só o custo unitário da amostra; a data de chegada é da demanda.

## LTI (ordem de serviço)

Toda demanda carrega o número da LTI que a abriu e uma classificação:

* **DV, PV ou VAVE** — entra no planejamento normalmente: reserva bancada, disputa fila por
  prioridade e prazo, e aparece no Gantt.
* **Cotação** — é orçamento, ainda não é serviço confirmado. O custo e a duração são
  calculados do mesmo jeito, para dar o valor a cotar, mas a demanda não reserva bancada,
  não aparece no Gantt e não conta como "sem janela" no painel.

Quando uma LTI de cotação vira serviço de fato, basta editar a demanda e trocar a
classificação para DV, PV ou VAVE — ela entra na fila e recebe uma janela no próximo
recálculo do planejamento.

Além da LTI, a demanda registra o **projeto** e o **part number** da peça ensaiada. O campo
de projeto sugere os projetos já usados, para o mesmo programa não virar três grafias, e o
nome do projeto acompanha o procedimento na barra do Gantt.

## Campos obrigatórios

Os dois formulários exigem preenchimento completo, para não entrar demanda nem procedimento
pela metade:

* **Novo procedimento** — todos os campos. A única exceção é *exigido pelos clientes*:
  deixar em branco é o que marca o procedimento como padrão do laboratório, válido para
  todos os clientes. O código também é verificado contra duplicidade.
* **Confirmar necessidade de teste** — todos os campos, exceto *forçar início*, que existe
  justamente para o caso excepcional de fixar uma data na mão.

## Modelo de custo

```
custo do procedimento = (horas de setup + ensaio + report) × hourly rate
                      + custo de insumos

custo da demanda      = custo do procedimento
                      + amostras × custo unitário da peça
```

**O hourly rate é um valor só, do centro de testes**, não um campo de cada procedimento: ele
não varia por ensaio, só é reajustado uma vez por ano. Fica no estado da aplicação
(`hourlyRate` e `hourlyRateVigencia`) e se altera num campo único, no indicador *Hourly rate*
do catálogo — o reajuste reprecifica os 73 procedimentos de uma vez. É a taxa cheia do
laboratório, e por isso o equipamento não tem custo-hora próprio: a mesma hora não pode ser
cobrada duas vezes.

Horas e custo de insumos ficam no procedimento; o custo unitário da amostra, no tipo de peça.

**Cotação arquivada não é reprecificada.** Cada item guarda o hourly rate do dia em que foi
cotado, então o reajuste do ano seguinte não reescreve orçamento já entregue.

**Horas de report contam no custo, mas não na agenda.** Elaborar o relatório é trabalho de
mesa: entra na fatura, não prende a bancada. Quem define a janela no Gantt é setup + ensaio.

## Dados

O estado fica no `localStorage` do navegador. O catálogo que vem junto (73 procedimentos,
11 equipamentos, 5 tipos de peça, 9 clientes) é um ponto de partida — tudo é editável pela
interface.

**Mudança de catálogo.** `TC.data.CATALOGO_VERSAO` marca a versão do catálogo de partida.
Quando esse número sobe, quem já tinha dados salvos no navegador recebe os procedimentos
novos na próxima carga (`migrar()` em `src/store.js`):

* **Aditivo, da versão 2 em diante.** Procedimentos que ainda não existem entram; os que já
  estão no catálogo ficam como estão, com as horas, o hourly rate e a bancada que já foram
  preenchidos. Nada que o usuário cadastrou é sobrescrito.
* **Substituição, apenas até a versão 2.** Dados anteriores a ela carregam o catálogo de
  exemplo, de vários clientes, que sai inteiro; as demandas dos procedimentos que deixaram
  de existir são descartadas, porque sem procedimento não têm custo nem bancada.

Em qualquer caso, cotações arquivadas ficam intactas (têm preço congelado) e os cadastros de
equipamento, peça, cliente e as permissões não são tocados — só o cliente exigido por um
procedimento novo é acrescentado, se ainda não estiver na lista.

* **Exportar backup** grava um JSON com todo o estado.
* **Importar backup** restaura esse JSON, inclusive em outra máquina.
* **Restaurar padrão** volta ao catálogo de partida e apaga as demandas.

Como não há servidor, o backup é o mecanismo de compartilhamento entre pessoas. Se mais de
um usuário precisar enxergar o mesmo planejamento ao mesmo tempo, o passo natural é trocar
o `src/store.js` por uma API — o restante do código não depende de onde os dados moram.

## Organização do código

```
index.html            carrega os scripts na ordem; sem bundler
assets/styles.css     tema claro/escuro
src/util.js           datas em UTC, moeda, escape de HTML
docs/hospedagem.md    onde hospedar e como controlar acesso (documento para a TI)
src/data.js           catálogo inicial (clientes, equipamentos, testes, peças)
src/scheduler.js      motor de alocação e cálculo de custo — sem dependência de DOM
src/permissoes.js     perfil em uso e o que ele vê/edita
src/xlsx.js           gerador de .xlsx (ZIP + XML) sem dependências
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
