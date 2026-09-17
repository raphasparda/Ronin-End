# Ronin API

Backend do Ronin: quadros de tarefas para uma equipe pequena de software, com backend e dados próprios. Fastify 5 + PostgreSQL 18 + Drizzle, em TypeScript (Node 24).

Este repositório (workspace pnpm) contém:

- a **API** na raiz (`src/`, `test/`, `drizzle/`);
- o pacote **`@raphasparda/ronin-shared`** (`packages/shared`): contratos Zod e regras de domínio usados pela API e pelo web, publicável no GitHub Packages;
- o **PostgreSQL local de desenvolvimento** (`scripts/dev-db`), sem Docker e sem admin;
- a documentação de produto, arquitetura e operação (`docs/`).

O front-end (React + Vite) e os testes E2E ficam no repositório irmão **ronin-web**.

Público deste README: quem vai rodar, testar ou desenvolver o Ronin na própria máquina.

## Como rodar

Precisa só de **Node.js 24** e **pnpm 10** (`npm i -g pnpm@10`, sem admin). Não precisa de Docker, de PostgreSQL instalado nem de senha nenhuma.

Os dois repositórios ficam lado a lado na mesma pasta, com os nomes de pasta `ronin-api` e `ronin-web` (o web usa `../ronin-api`):

```powershell
git clone https://github.com/raphasparda/Ronin-End.git ronin-api
git clone https://github.com/raphasparda/Ronin-front.git ronin-web
```

```text
<pasta>/
├─ ronin-api/   (este: raphasparda/Ronin-End)
└─ ronin-web/   (raphasparda/Ronin-front)
```

1. Neste repositório: `pnpm install` e `pnpm dev`.
2. Em outro terminal, no ronin-web: `pnpm install` e `pnpm dev`.
3. Abra <http://127.0.0.1:5310>.

Instale o ronin-api primeiro: o ronin-web liga o `@raphasparda/ronin-shared` direto desta pasta (`link:../ronin-api/packages/shared`).

O `pnpm dev` daqui cria o `.env` (se não existir), sobe um PostgreSQL 18 local do próprio projeto na porta 5433 (dados em `.data/postgres`), aplica as migrations pendentes e então sobe a API em watch na porta 3000 (<http://127.0.0.1:3000/api/health>). **Ctrl+C** derruba tudo, inclusive o banco. A primeira execução leva alguns segundos a mais para criar o banco.

O web roda na porta **5310** (a 5173 é de outro projeto na máquina do cliente) e faz proxy de `/api` para `127.0.0.1:3000`. A API só aceita mutações com `Origin` igual ao `APP_ORIGIN` (`http://127.0.0.1:5310`); por isso o servidor de dev do web redireciona `localhost:5310` para `127.0.0.1:5310`.

Detalhes, problemas comuns e como zerar o banco: [`docs/ops/setup-local.md`](docs/ops/setup-local.md). Problemas conhecidos (travamentos do Node no Windows, bloqueios de login em testes): [`docs/ops/known-issues.md`](docs/ops/known-issues.md).

## Status

- **Fatias 0 a 9 do MVP: implementadas**, com testes de API, de componentes e E2E (Playwright, no ronin-web), e CI no GitHub Actions nos dois repositórios.
- **Fatia 10 (produção): pendente.** Ainda não existem Dockerfile, Caddyfile, compose de produção, backup nem documentação de instalação na VPS. Não exponha esta versão na internet. Os bloqueios de segurança apontados para o deploy estão em [`docs/ops/known-issues.md`](docs/ops/known-issues.md#4-bloqueios-do-deploy-fatia-10).
- Há uma decisão de produto pendente sobre o bloqueio de login por e-mail (mesmo documento).
- Divisão do monorepo em ronin-api e ronin-web: [ADR 0014](docs/architecture/adr/0014-dois-repositorios-e-shared-publicado.md).

Histórico de entregas: [`CHANGELOG.md`](CHANGELOG.md).

## O que o Ronin faz hoje

### Equipe e acesso

- Configuração inicial da instância: a primeira pessoa cria a equipe e vira Admin.
- Login e logout com e-mail e senha. Bloqueio temporário após tentativas erradas.
- Convite por link (vale 7 dias, uso único), com e-mail opcional e papel (Admin ou Membro). Não há cadastro público.
- Redefinição de senha por link gerado pelo Admin (vale 24 h, uso único), sem e-mail.
- Administração de membros: mudar papel, desativar, reativar e anonimizar conta desativada (LGPD). Sempre existe pelo menos um Admin ativo.
- Perfil: trocar o próprio nome e a senha.
- Nome da equipe e fuso horário ajustáveis pelo Admin.

### Quadros e listas

- Todos os membros veem e editam todos os quadros.
- Quadro novo já vem com "A fazer", "Fazendo" e "Concluído" (esta marcada como lista de conclusão).
- Listas com cor de uma paleta fixa: criar, renomear, trocar cor, reordenar (arrastando ou pelo menu), arquivar e restaurar.
- Arquivar e restaurar quadros. Só o Admin exclui um quadro de vez, digitando o nome para confirmar.

### Cards

- Criação rápida: digite o título no fim da lista e aperte Enter.
- Arrastar e soltar entre listas e dentro delas, ou "Mover para…" (quadro, lista e posição), que funciona pelo teclado e no celular.
- Detalhe do card com título, descrição em Markdown (sem HTML cru) e histórico de atividade.
- Concluir e reabrir: pelo botão ou movendo para a lista de conclusão. Reabrir um card que está na lista de conclusão leva ele ao topo da primeira lista ativa.
- Arquivar e restaurar cards. Só o Admin exclui um card de vez.

### Campos do card

- Responsáveis (um ou mais membros ativos).
- Prazo com data e hora opcional, com estado "vencendo" (até 24 h), "atrasado" ou "concluído".
- Prioridade opcional: Baixa, Média, Alta ou Urgente, sempre com cor e texto.
- Etiquetas por quadro, com nome e cor da paleta.
- Filtro do quadro por responsável, etiqueta, prioridade, prazo e texto do título. O filtro fica na URL e vale só para quem filtrou.

### Checklists e comentários

- Vários checklists por card, com itens marcáveis e reordenáveis. O progresso (x/y) aparece na face do card. Marcar todos os itens não conclui o card.
- Comentários em Markdown. O autor edita (marca "editado") e exclui os próprios. O Admin exclui qualquer um.

### Notificações

- Sino no cabeçalho com contador de não lidas.
- Avisos quando alguém atribui você a um card e quando comentam em um card em que você é responsável. Ninguém é notificado da própria ação.
- Clicar abre o card e marca como lida. Há "marcar todas como lidas".
- Só dentro do app: sem e-mail e sem push.

### Meus cards

- Todos os cards abertos atribuídos a você, em todos os quadros, agrupados em Atrasados, Vencendo (24 h), Com prazo e Sem prazo.
- Ordem por prazo e depois por prioridade. Cada item mostra quadro e lista de origem.

### Temas e uso no celular

- Tema claro (padrão) e escuro, alternados pelo botão no cabeçalho. A escolha fica salva no navegador.
- Layout responsivo com navegação inferior no celular. Arrastar e soltar é garantido só no desktop.

Não há tempo real: o quadro recarrega a cada 30 s, ao voltar para a aba e depois de cada ação. Escopo completo e o que ficou para depois: [`docs/product/scope.md`](docs/product/scope.md).

## Primeiro uso

### 1. Criar o primeiro Admin

Com o banco vazio e o web rodando (ronin-web, `pnpm dev`), <http://127.0.0.1:5310> abre a tela **Configurar a equipe**. Preencha nome da equipe, seu nome, e-mail, senha (mínimo 10 caracteres, diferente do e-mail) e fuso horário, e clique em **Criar conta e começar**. Essa conta é Admin, e a tela de configuração não aparece mais para ninguém.

O envio desse formulário tem limite de 5 tentativas a cada 15 minutos por IP (veja [`docs/ops/known-issues.md`](docs/ops/known-issues.md#3-limites-de-requisição-que-aparecem-em-testes)).

### 2. Convidar pessoas

1. No cabeçalho, abra **Administração** → aba **Convites** → **Novo convite**.
2. Informe o e-mail (opcional; se preencher, só esse e-mail usa o convite) e o papel.
3. Clique em **Criar convite** e copie o **Link do convite**. O link aparece uma única vez.
4. Envie o link por um canal privado. A pessoa abre o link, informa nome, e-mail e senha e já entra logada.

Para testar sozinho na mesma máquina, abra o link em uma **janela anônima** ou em outro navegador. Aceitar o convite na janela em que o Admin está logado troca a sessão para a conta nova.

Em desenvolvimento, os links usam `http://127.0.0.1:5310`, então só funcionam na própria máquina.

### 3. Redefinir a senha de alguém (sem e-mail)

1. **Administração** → aba **Membros**.
2. No menu de ações (três pontos) da pessoa, clique em **Gerar link de redefinição de senha**.
3. Copie o link e envie por um canal privado. Ele vale 24 h e só pode ser usado uma vez.
4. A pessoa abre o link e define a nova senha. Todas as sessões antigas dela são encerradas.

Gerar um novo link cancela o anterior. Quem sabe a própria senha troca em **Meu perfil** (menu do usuário, no canto do cabeçalho).

## Comandos úteis

Rode na raiz do repositório (PowerShell ou qualquer terminal).

| Comando                             | Faz                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`                          | banco local (5433), migrations e API em watch (3000)                       |
| `pnpm dev:api`                      | só a API em watch (banco por sua conta)                                    |
| `pnpm db:dev`                       | só o banco local, em primeiro plano (Ctrl+C para parar)                    |
| `pnpm db:migrate`                   | aplica as migrations pendentes em `DATABASE_URL` (idempotente)             |
| `pnpm db:generate`                  | gera migration a partir do schema (drizzle-kit)                            |
| `pnpm db:up` / `pnpm db:down`       | sobe/derruba o Postgres do `docker-compose.yml` (alternativa com Docker)   |
| `pnpm test`                         | testes do shared (com cobertura) e da API (sobe o banco local se precisar) |
| `pnpm test:api`                     | só os testes da API                                                        |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                                                                     |
| `pnpm typecheck`                    | TypeScript da API e do shared                                              |
| `pnpm format` / `pnpm format:check` | Prettier                                                                   |
| `pnpm build`                        | `dist/` do shared (ESM + `.d.ts`) e `dist/server.js` da API                |
| `pnpm start`                        | roda o build da API (`node dist/server.js`)                                |
| `pnpm shared:pack`                  | gera o tarball publicável do `@raphasparda/ronin-shared` (só `dist/`)      |

Os E2E rodam no ronin-web (`pnpm test:e2e` lá), que usa este repositório para subir o banco `kanban_e2e`, aplicar as migrations e iniciar a API na porta 3100 (web na 5320).

## Banco de dados

### Padrão: PostgreSQL local do projeto (sem Docker, sem admin)

O pacote npm `embedded-postgres` traz os binários oficiais do PostgreSQL 18 para Windows, Linux e macOS. Os scripts do repositório criam e controlam um cluster só deste projeto:

- endereço `127.0.0.1:5433` (não conflita com um Postgres nativo na 5432), usuário/senha `kanban`/`kanban` (**somente desenvolvimento**);
- bancos `kanban` (app) e `kanban_test` (testes), criados se faltarem; `kanban_e2e` é criado pelo `pnpm test:e2e` do ronin-web;
- dados em `.data/postgres` e log em `.data/postgres.log` (pasta ignorada pelo git).

Se o banco já estiver respondendo no `DATABASE_URL` (por exemplo, `pnpm db:dev` em outro terminal, Docker ou Postgres nativo), o `pnpm dev` reaproveita e não o derruba ao sair. Antes de subir a API, o `pnpm dev` sempre aplica as migrations pendentes.

### Alternativa: Docker

```powershell
pnpm db:up     # sobe postgres:18-alpine na porta POSTGRES_PORT (5433 no .env.example)
pnpm db:down   # para e remove o container (os dados ficam no volume)
```

Não rode junto com o banco local: os dois usam a 5433. Com o container de pé, o `pnpm dev` detecta e reaproveita. O banco `kanban_test` é criado por `infra/postgres/init/01-test-db.sql` apenas na primeira subida do volume.

### Alternativa: PostgreSQL nativo

Exige a senha do superusuário `postgres`. Com o PostgreSQL 18 rodando na 5432, execute uma vez, na raiz do repositório:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -U postgres -d postgres -f infra/postgres/local-setup.sql
```

O script é idempotente: cria o role `kanban` (senha `kanban`) e os bancos `kanban` e `kanban_test`. Depois, troque a porta para **5432** em `DATABASE_URL` e `TEST_DATABASE_URL` no `.env`.

## Testes

`pnpm test` roda os testes do `@raphasparda/ronin-shared` (cobertura mínima de 95% em `domain/`) e depois os da API. Os testes de integração da API usam `TEST_DATABASE_URL`: se ele não responder e apontar para `127.0.0.1`, o setup global do Vitest (`test/global-setup.ts`) sobe o banco local sozinho e o para no final. Em seguida aplica as migrations em `kanban_test`; testes de banco usam `useTestDatabase()` (`test/db.ts`), que trunca as tabelas antes de cada teste. Se o `pnpm dev` ou o `pnpm db:dev` já estiverem rodando, o banco é reaproveitado.

CI (GitHub Actions: lint, typecheck, testes, build e verificação do pacote): [`docs/ops/ci.md`](docs/ops/ci.md).

## Pacote `@raphasparda/ronin-shared`

- Aqui dentro, a API usa a fonte TS pelo workspace (`workspace:*`); nada a buildar no dia a dia.
- O ronin-web usa `link:../ronin-api/packages/shared` localmente, ou a versão publicada no GitHub Packages.
- Publicação: tag `shared-v<versão>` dispara `.github/workflows/publish-shared.yml`.
- O escopo `@raphasparda` é o dono dos repositórios no GitHub (exigência do GitHub Packages); o `.npmrc` já aponta esse escopo para `https://npm.pkg.github.com`. Se o dono mudar: `node scripts/rename-shared-package.mjs @<novo-dono>/ronin-shared --web ../ronin-web`.

Passo a passo (renomear, publicar, trocar o web para a versão do registro com `.npmrc` e token): [`docs/ops/shared-package.md`](docs/ops/shared-package.md).

## Estrutura de pastas

```text
src/               API Fastify: módulos, plugins, config e schema do banco
test/              setup global do Vitest (banco), helpers de app, login e fixtures
drizzle/           migrations SQL geradas (commitadas)
packages/shared/   @raphasparda/ronin-shared: contratos Zod e regras de domínio (publicável)
scripts/           pnpm dev, pnpm db:dev, PostgreSQL local e renomeação do pacote shared
infra/postgres/    scripts SQL das alternativas Docker e Postgres nativo
docs/              produto, arquitetura (ADRs) e operação
```

## Documentação

| Documento                                                        | Conteúdo                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`docs/product/scope.md`](docs/product/scope.md)                 | escopo do MVP, histórias, regras de negócio, fora de escopo        |
| [`docs/architecture/overview.md`](docs/architecture/overview.md) | arquitetura, modelo de dados, segurança, deploy planejado          |
| [`docs/architecture/api.md`](docs/architecture/api.md)           | contrato da API REST e decisões de implementação (§18)             |
| [`docs/architecture/plan.md`](docs/architecture/plan.md)         | plano de implementação por fatias                                  |
| [`docs/architecture/adr/`](docs/architecture/adr/)               | decisões de arquitetura (ADRs)                                     |
| [`docs/ops/setup-local.md`](docs/ops/setup-local.md)             | ambiente local em detalhe e problemas comuns                       |
| [`docs/ops/ci.md`](docs/ops/ci.md)                               | pipelines do GitHub Actions                                        |
| [`docs/ops/shared-package.md`](docs/ops/shared-package.md)       | build, escopo, publicação e consumo do `@raphasparda/ronin-shared` |
| [`docs/ops/known-issues.md`](docs/ops/known-issues.md)           | problemas conhecidos, limites e pendências do deploy               |

Design (cores, tokens, telas) fica no ronin-web (`docs/design/`).

Com a API rodando em desenvolvimento, a documentação OpenAPI interativa fica em <http://127.0.0.1:3000/api/docs> (ou <http://127.0.0.1:5310/api/docs> pelo proxy do web).

## Convenções

- Finais de linha LF (`.gitattributes`, `.editorconfig`). Scripts do `package.json` não usam sintaxe de shell POSIX, para funcionar no PowerShell.
- `.env` nunca é commitado; toda variável nova entra no `.env.example` com comentário.
- Mudança de contrato: altere `docs/architecture/api.md` e `packages/shared` no mesmo PR; publique nova versão do shared se o web consumir pelo registro.
