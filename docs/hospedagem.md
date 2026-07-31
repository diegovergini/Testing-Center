# Hospedagem e controle de acesso

Este documento existe para ser encaminhado à TI. Ele descreve o que a plataforma é, o que
ela precisa para virar uma aplicação corporativa multiusuário, e o que dá para fazer hoje
enquanto essa decisão não sai.

## O que existe hoje

Uma aplicação web estática de arquivo único: HTML, CSS e JavaScript, **sem framework, sem
build e sem nenhuma dependência externa em tempo de execução** — nenhuma requisição sai do
navegador. Roda em qualquer servidor de arquivos estáticos, inclusive numa biblioteca do
SharePoint.

O estado (catálogo de procedimentos, demandas, planejamento, cotações) é gravado no
`localStorage` do navegador de cada usuário. Consequência: **os dados não são
compartilhados**. Cada pessoa tem a sua cópia.

A tela "Perfis e permissões" define quem vê e quem edita cada janela, mas isso é orientação
de interface, não controle de acesso: sem servidor, qualquer pessoa troca o próprio perfil
no seletor da barra lateral e o dado está inteiro no navegador dela.

## Etapa 1 — hoje, sem provisionamento (já implementada)

`node build.js` gera `dist/testing-center-equipe.html`, com um instantâneo dos dados
embutido no próprio arquivo e a aplicação em modo somente leitura. Publicado numa biblioteca
do SharePoint ou num compartilhamento de rede, a equipe inteira passa a enxergar o mesmo
catálogo, o mesmo planejamento e as mesmas cotações.

Limites, ditos com clareza: **um editor e muitos leitores**, e os dados são de quando o
instantâneo foi gerado. Não resolve duas pessoas registrando demanda ao mesmo tempo.

Não exige nada da TI além de um local para publicar o arquivo.

## Etapa 2 — a plataforma multiusuário

### Recomendação: Azure App Service + Entra ID + PostgreSQL

O ponto central: **não construir cadastro de usuário e senha próprio.** A autenticação do
App Service ("Easy Auth") integrada ao Entra ID resolve login, MFA, expiração de sessão e
desligamento de funcionário sem uma linha de código de autenticação — e entrega ao aplicativo
a identidade do usuário, que a plataforma precisa de qualquer forma para registrar quem abriu
cada demanda e cada cotação.

Recursos a provisionar:

| Recurso | Proposta | Para quê |
|---|---|---|
| App Service (Linux) | plano B1 ou equivalente | Serve a aplicação e a API |
| Azure Database for PostgreSQL Flexible Server | Burstable B1ms, menor armazenamento | Dados compartilhados |
| Registro de aplicativo no Entra ID | tenant da empresa | Login corporativo (Easy Auth) |
| Grupos de segurança | 2 grupos | Mapeiam os perfis da aplicação |

Configuração pedida:

* **Autenticação**: Easy Auth com Entra ID, exigindo autenticação para todas as rotas
  (sem acesso anônimo). Restrita a contas do tenant da empresa.
* **Perfis por grupo**: dois grupos de segurança, um para *Engenheiro de Produto* (abre
  demandas e pede cotações) e outro para *Engenheiro de Testes* (mantém catálogo e
  cadastros, opera o laboratório, vê os KPIs). A aplicação lê a associação de grupo do token
  e aplica a permissão no servidor — o seletor de perfil da interface deixa de existir.
* **Rede**: se a política exigir, restringir a acesso interno/VPN. A aplicação funciona
  igual atrás de acesso privado.
* **Região**: preferencialmente Brazil South, pela latência e por manter o dado no país.
* **Backup**: o padrão do PostgreSQL Flexible Server atende; o volume de dados é pequeno
  (dezenas de MB por ano, ordem de grandeza).

### Confidencialidade dos dados

A plataforma armazena **especificações de ensaio de montadoras** — GM, Ford, Stellantis,
Volkswagen, Hyundai, Nissan, RSA — normalmente cobertas por acordo de confidencialidade com
cada cliente, além de custos internos de laboratório e hora-homem.

Por isso a recomendação é o tenant Azure da empresa, e **não** um serviço de nuvem externo
contratado por fora (Supabase, Firebase, Vercel e similares), ainda que tecnicamente mais
rápidos de colocar no ar. Vale a TI confirmar se há requisito de classificação de dados,
retenção ou registro de auditoria a atender.

### Esforço de desenvolvimento

A persistência está isolada em um único arquivo (`src/store.js`); o motor de planejamento, o
cálculo de custo e todas as telas não sabem de onde os dados vêm. A migração é:

1. API REST (Node) para catálogo, clientes, equipamentos, peças, demandas e cotações.
2. Esquema no PostgreSQL e carga inicial a partir do backup JSON atual.
3. `src/store.js` reescrito para falar com a API em vez do `localStorage`.
4. Permissões aplicadas **no servidor**, a partir dos grupos do Entra.
5. Registro de autoria e data em demandas e cotações, aproveitando a identidade do login.

Ordem de grandeza: alguns dias de desenvolvimento, mais o tempo de provisionamento da TI.
Nenhuma reescrita da aplicação.

## Perguntas para a TI

1. É possível provisionar um App Service e um PostgreSQL no tenant da empresa? Qual o
   processo e o prazo?
2. Quem cria o registro de aplicativo no Entra ID e os dois grupos de segurança?
3. Há restrição de região, classificação de dado ou exigência de auditoria aplicável?
4. A aplicação deve ficar acessível só na rede interna/VPN ou também fora?
5. Enquanto isso: onde publicar o arquivo HTML da etapa 1 — biblioteca do SharePoint da
   equipe ou compartilhamento de rede?
