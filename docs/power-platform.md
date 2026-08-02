# Testing Center nas ferramentas oficiais: SharePoint + Power Platform

A TI não vai provisionar App Service e banco, e não quer assumir suporte de código próprio.
Isso não é um beco sem saída: as ferramentas oficiais da empresa — SharePoint, Microsoft 365
e Power Apps — dão conta desta plataforma, e num modelo em que **a área de testes é dona da
ferramenta**, não a TI. É o caminho do *citizen developer*, e é para exatamente este caso que
a Power Platform existe.

O que muda de verdade: a manutenção passa a ser feita em ferramentas que a empresa já
suporta, o login e as permissões vêm do Microsoft 365, e ninguém precisa revisar código de
servidor porque não há servidor.

## A arquitetura

```
SharePoint Lists            os dados, num só lugar, com permissão e histórico
        ▲
        │
Power App (canvas)          catálogo, demandas e cotações — o que a equipe usa todo dia
        │
Power Automate              numeração de cotação, avisos, exportação, recálculo do plano
        │
Office Script (TypeScript)  o motor de planejamento e o cálculo de custo
```

**SharePoint Lists como banco de dados.** Cada entidade vira uma lista: procedimentos,
clientes, equipamentos, peças, demandas, cotações e itens de cotação. É um banco de dados
de verdade para este porte — colunas tipadas, histórico de versões, permissão por lista, e
integração nativa com Power Apps, Power Automate, Power BI e Excel. Um proprietário de site
cria tudo sem pedir nada à TI.

**Power App como interface.** É onde o engenheiro de produto abre a demanda e pede cotação, e
o engenheiro de testes mantém o catálogo. Ele é publicado e compartilhado pelo Microsoft 365:
quem abre já está autenticado, com MFA, e o desligamento de funcionário é automático.

**Permissões de verdade, enfim.** Aqui elas deixam de ser orientação de tela. As listas têm
permissão do SharePoint, e os dois perfis viram dois grupos do Microsoft 365: *Engenharia de
Produto* (lê o catálogo, cria demanda e cotação) e *Engenharia de Testes* (edita catálogo e
cadastros, vê os KPIs). O que a pessoa pode fazer passa a ser garantido pela plataforma, não
sugerido pela interface.

## O ponto honesto: o planejamento

Catálogo, demandas e cotações são cadastro e formulário — o Power Apps faz isso bem e rápido.

O que **não** traduz bem para Power Fx é o motor de planejamento: alocação gulosa dia a dia,
escolha da unidade que libera mais cedo dentro do grupo Burner ou MTS, ensaio que ocupa duas
bancadas ao mesmo tempo, calendário e manutenção de cada equipamento. É um algoritmo, e Power
Fx é uma linguagem de fórmula — sem recursão, com limites de delegação, e onde um laço sobre
centenas de combinações fica lento e ilegível.

A saída é não reescrevê-lo: **Office Scripts roda TypeScript dentro do Microsoft 365** e pode
ser chamado por um fluxo do Power Automate. O motor que já existe (`src/scheduler.js`, coberto
por 93 testes) migra praticamente como está. O fluxo lê as demandas e os equipamentos das
listas, chama o script, e grava de volta em cada demanda a data de início, a de fim, o
equipamento alocado ou o motivo do bloqueio. Roda a cada nova demanda e uma vez por dia.

Assim o Power App não precisa saber planejar: ele lê o resultado já calculado, que é o que a
tela mostra hoje.

**O Gantt** é o outro ponto de atenção: não existe controle nativo de Gantt no Power Apps.
As opções são um **Power BI** embutido (o visual de Gantt existe, e Power BI lê listas do
SharePoint direto) ou uma galeria desenhada à mão no Power App — funciona, mas fica mais
simples do que o de hoje. Minha recomendação é Power BI: além do Gantt, entrega os KPIs do
centro de testes sem trabalho extra.

## O que já está pronto

**O esquema das listas e os dados.** `node ferramentas/exportar-listas.js` gera, em
`dist/listas/`, um CSV por lista, já com os 73 procedimentos, os 9 clientes, os 11
equipamentos e as 5 peças — mais demandas e cotações, se você exportar um backup seu.

Dois jeitos de criar as listas:

1. **Pela interface**, sem instalar nada: em cada lista, *Nova lista > Do CSV*. Rápido, mas o
   SharePoint adivinha os tipos e costuma criar tudo como texto — datas e números precisam ser
   corrigidos depois.
2. **Com o script** `ferramentas/provisionar-listas.ps1` (módulo PnP.PowerShell, permissão de
   proprietário do site), que cria as listas com os tipos certos. Depois é só colar os CSVs na
   visualização em grade de cada lista.

### As listas

| Lista | Guarda | Registros hoje |
|---|---|---|
| `TC_Parametros` | Hourly rate do centro de testes e sua vigência | 1 |
| `TC_Clientes` | Código, nome e segmento | 9 |
| `TC_Equipamentos` | Bancadas, grupo, posições, regime e calendário | 11 |
| `TC_Manutencoes` | Paradas programadas por equipamento | 0 |
| `TC_Pecas` | Tipos de peça e custo por amostra | 5 |
| `TC_Procedimentos` | O catálogo: norma, revisão, horas, insumos, bancada | 73 |
| `TC_Demandas` | A necessidade confirmada e o resultado do planejamento | 0 |
| `TC_Cotacoes` | Cabeçalho do orçamento | 0 |
| `TC_CotacaoItens` | Itens com o preço congelado na data da cotação | 0 |
| `TC_Historico` | Uma linha por passagem de fluxo: de, para, quem, quando, nota | 0 |

A coluna `Title` guarda o código do registro (`TP-GM-01`, `CLI-GM`, `COT-2026-0001`), que é
como as listas se referenciam entre si.

Campos de vários valores — os clientes que exigem um procedimento, os grupos de bancada que
ele ocupa ao mesmo tempo — ficam numa coluna de texto separados por `; `.

## Os fluxos na Power Platform

Os dois fluxos (`src/fluxo.js`) traduzem-se bem para lá, e é onde a Power Platform brilha:

* **Estados e permissão de passagem**: o Power App mostra os botões conforme o grupo do
  Entra a que a pessoa pertence — a mesma regra de hoje, agora garantida pela plataforma.
* **Avisos por e-mail**: um fluxo do Power Automate dispara em cada passagem. O cliente
  recebe quando o relatório é enviado ou a cotação é validada; o centro de testes recebe
  quando uma demanda é aberta ou uma correção é pedida. Isso é o que a versão de hoje não
  tem como fazer.
* **Aprovações nativas**: validar relatório e aprovar cotação podem virar uma ação de
  aprovação do Power Automate, respondida do Outlook ou do Teams, sem abrir o app.
* **Histórico**: cada passagem vira um item numa lista `TC_Historico` (registro, de, para,
  quem, quando, nota) — o mesmo conteúdo que a versão atual guarda embutido.

## O caminho

1. **Criar o site e as listas** e carregar os CSVs. Sem código; você faz sozinho.
2. **Power App v1**: catálogo (consulta e edição), nova demanda, lista de demandas. Já
   substitui a planilha e já dá o compartilhamento que falta hoje.
3. **Planejamento**: Office Script com o motor atual + fluxo do Power Automate que grava o
   resultado nas demandas.
4. **Cotações**: tela de cotação, numeração automática por fluxo e exportação para Excel
   (aqui fica mais simples que hoje — o Power Automate gera o arquivo).
5. **Power BI**: Gantt e KPIs do centro de testes.

Do passo 2 em diante eu escrevo tudo: as fórmulas do Power App tela a tela, o Office Script,
os fluxos e o modelo do Power BI. O que eu não consigo fazer daqui é clicar no seu tenant —
criar o site, importar o app e publicar continua sendo você, e eu te passo o passo a passo.

## Enquanto isso

A cópia da equipe (`dist/testing-center-equipe.html`, veja o README) continua valendo: é
publicável hoje numa biblioteca do SharePoint e já mostra os mesmos dados para todo mundo, em
modo consulta. Ela não conflita com nada aqui — some no dia em que o Power App entrar.
