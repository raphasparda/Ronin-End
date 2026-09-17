# Kanban: arquitetura do MVP

> Status: v1.1 (2026-09-16). Autor: Raphael Sparda.
> v1.2: alinhado ao `scope.md` v2: sem gamificação; cor por lista (paleta fixa); prioridade do card; reabrir vai para o topo; operação em VPS (banco fechado, backup fora da VPS, volta após reboot).
> v1.3: CSP restrita na API e `no-store` em toda resposta (§6.7); `text/plain` recusado com `415 UNSUPPORTED_MEDIA_TYPE` (§6.3).
> v1.4: §5 implementado para as fatias 2–9 (migrations `0001`–`0007`): FK composta de I6, `CHECK`s extras, trigger append-only da atividade e índices de FK para cascatas (§5.1.1).
> v1.5: revisão de segurança: reserva atômica de tentativa no login e na troca de senha e limites de rota (§6.4), revogação dos tokens de quem perde o papel (§6.5), logs de erro de banco sem valores (§6.7), configuração fail-closed `NODE_ENV` × `APP_ORIGIN` e requisitos do deploy (§3, §6.8). Detalhes em `api.md` §18.5.
> Fonte de requisitos: `docs/product/scope.md` (inclui "Decisões confirmadas pelo cliente").
> Documentos irmãos: `api.md` (contrato REST), `plan.md` (plano de implementação), `adr/` (decisões).

Este documento é normativo: quando disser "deve", o engenheiro implementa assim. Quando algo não estiver aqui nem em `api.md`, siga o ADR correspondente ou registre um novo ADR antes de decidir.

---

## 1. Visão geral

Monólito modular em TypeScript, autohospedado, uma instância = um workspace (uma equipe de até ~20 pessoas).

```mermaid
flowchart LR
  subgraph Navegador
    WEB["ronin-web<br/>React + Vite (SPA)<br/>TanStack Query, polling"]
  end
  subgraph Servidor["Servidor (Docker)"]
    CADDY["Caddy<br/>HTTPS, arquivos estáticos,<br/>proxy /api"]
    API["ronin-api<br/>Fastify (monólito modular)"]
    PG[("PostgreSQL 18")]
  end
  SHARED["@raphasparda/ronin-shared (ronin-api/packages/shared)<br/>schemas Zod, códigos de erro,<br/>regras puras (estado do prazo)"]

  WEB -- "HTTPS mesma origem<br/>cookie de sessão httpOnly" --> CADDY
  CADDY -- "/api/*" --> API
  CADDY -- "/* (SPA estática)" --> WEB
  API -- "Drizzle (pg)" --> PG
  SHARED -. importado por .-> WEB
  SHARED -. importado por .-> API
```

- **Mesma origem** em dev e produção: nada de CORS. Em dev, o Vite faz proxy de `/api` para a API. Em produção, o Caddy serve a SPA e faz proxy de `/api` (ADR 0009).
- **Sem tempo real**: o front recarrega por foco da aba e polling (ADR 0006).
- **Sem BaaS, sem serviços externos, sem CDN**: fontes e assets são servidos pela própria instância.
- **Processo único da API** (sem réplicas no MVP). Isso permite jobs de manutenção por `setInterval` e rate limit em memória. Se um dia houver réplicas, revisar ADR 0001.

## 2. Stack e dependências

Versões: fixar a última estável compatível no momento da Fatia 0 e registrar no lockfile. As versões principais abaixo são mínimas.

| Camada | Escolha | Por quê |
|--------|---------|---------|
| Runtime | Node.js 24 LTS | LTS atual; `fetch`, `crypto.randomBytes`, `node:test` não necessário. |
| Gerenciador | pnpm 10 (workspaces) | Padrão da casa; rápido e estrito no Windows. |
| Linguagem | TypeScript 5.x `strict` | Padrão. |
| API | Fastify 5 | Padrão da casa; `inject()` para testes sem rede. |
| Validação | Zod 4 + `fastify-type-provider-zod` (versão compatível com Zod 4) | Um schema serve para validar entrada, serializar saída (remove campos não declarados) e gerar OpenAPI. |
| OpenAPI | `@fastify/swagger` + `@fastify/swagger-ui` (só fora de produção) | Contrato navegável gerado dos schemas. |
| Cookies | `@fastify/cookie` | Sessão por cookie. |
| Headers | `@fastify/helmet` | Headers de segurança na API. |
| Rate limit | `@fastify/rate-limit` (memória) | Limite geral e de rotas de token. Bloqueio de login é persistido no banco (seção 6.4). |
| Hash de senha | `@node-rs/argon2` (Argon2id) | Binários pré-compilados para Windows/Linux, sem node-gyp (ADR 0003). |
| Ordenação | `fractional-indexing` | Chaves de posição sem renumerar vizinhos (ADR 0004). |
| Banco | PostgreSQL 18 (imagem `postgres:18-alpine`) | Padrão. |
| ORM | `drizzle-orm` + `drizzle-kit` + driver `pg` | Padrão; migrations SQL versionadas. |
| Datas | `date-fns` + `@date-fns/tz` | Conversão com fuso IANA do workspace, leve. |
| Front build | Vite 7 + React 19 | SPA; não há necessidade de SSR/SEO (app autenticado). |
| Rotas front | `react-router` 7 (modo biblioteca, `createBrowserRouter`) | Maduro, simples. |
| Estado servidor | TanStack Query 5 | Cache, polling, updates otimistas com rollback. |
| Estilo | Tailwind CSS 4 com tokens em `src/styles/globals.css` (ronin-web) (`@theme` + variáveis CSS) | Decisão do cliente. |
| Drag and drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Suporte a teclado e toque, acessível, maduro. |
| Markdown | `react-markdown` + `remark-gfm` (sem `rehype-raw`) | Render sem HTML cru, seguro contra XSS (ADR 0007). |
| Fontes | `@fontsource/*` (self-hosted) | Sem CDN externo (LGPD). |
| Testes | Vitest, Testing Library, MSW (mocks HTTP no front), Playwright + `@axe-core/playwright` | Padrão da casa; MSW permite o front avançar antes da API. |
| Lint/format | ESLint (flat config, `typescript-eslint`) + Prettier | Padrão. |
| Build API | `tsup` (bundle da API incluindo `@raphasparda/ronin-shared`) | Um artefato JS para a imagem Docker. |
| Dev API | `tsx watch` | Roda TS direto no Windows sem build. |
| Backup | `pg_dump` + `restic` (container `backup` em produção) | Backup criptografado, incremental e com retenção para destino fora da VPS (ADR 0013). |

Proibido: Supabase, Firebase, PocketBase ou qualquer BaaS; login social; analytics/telemetria de terceiros; CDNs externos.

## 3. Estrutura do monorepo

> Atualização (2026-09-17): o código foi dividido em dois repositórios, `ronin-api` (API na raiz + `packages/shared`) e `ronin-web` (SPA na raiz + `e2e/`). Os caminhos `apps/api/...` abaixo valem hoje na raiz do ronin-api, e `apps/web/...` na raiz do ronin-web. Decisão e detalhes: [ADR 0014](adr/0014-dois-repositorios-e-shared-publicado.md).

```
kanban/
├─ apps/
│  ├─ api/                         # @kanban/api
│  │  ├─ src/
│  │  │  ├─ server.ts              # entrypoint: lê env, buildApp(), listen
│  │  │  ├─ app.ts                 # buildApp(opts): registra plugins e módulos (usado nos testes)
│  │  │  ├─ config/env.ts          # schema Zod das variáveis de ambiente
│  │  │  ├─ db/
│  │  │  │  ├─ client.ts           # Pool pg + drizzle()
│  │  │  │  ├─ schema/             # um arquivo por agregado (users.ts, boards.ts, cards.ts ...)
│  │  │  │  ├─ types.ts            # customType textC (text COLLATE "C")
│  │  │  │  └─ migrate.ts          # aplica migrations (usado no deploy e nos testes)
│  │  │  ├─ plugins/
│  │  │  │  ├─ errors.ts           # setErrorHandler / setNotFoundHandler -> envelope de erro
│  │  │  │  ├─ session.ts          # lê cookie, carrega request.user, decorators requireAuth/requireAdmin
│  │  │  │  ├─ csrf.ts             # checagem Origin + header em métodos mutáveis
│  │  │  │  ├─ rate-limit.ts
│  │  │  │  ├─ openapi.ts
│  │  │  │  └─ maintenance.ts      # jobs de limpeza por setInterval
│  │  │  ├─ lib/
│  │  │  │  ├─ app-error.ts        # class AppError(code, status, message, details?)
│  │  │  │  ├─ password.ts         # hash/verify Argon2id
│  │  │  │  ├─ tokens.ts           # randomToken(), sha256()
│  │  │  │  ├─ ordering.ts         # computePosition() com lock do pai
│  │  │  │  └─ time.ts             # conversões com fuso do workspace
│  │  │  └─ modules/
│  │  │     ├─ setup/  auth/  me/  users/  admin/
│  │  │     ├─ boards/ lists/ cards/ labels/ checklists/ comments/
│  │  │     ├─ activity/           # recordActivity(tx, ...) e leitura
│  │  │     ├─ notifications/      # notify(tx, ...) e rotas
│  │  │     └─ completion/         # serviço único de concluir/reabrir (ADR 0010)
│  │  │        (cada módulo: routes.ts + service.ts; testes em *.test.ts ao lado)
│  │  ├─ drizzle/                  # migrations SQL geradas (commitadas)
│  │  ├─ test/                     # setup global (migrate, truncate), factories, helpers de login
│  │  ├─ drizzle.config.ts
│  │  └─ Dockerfile                # (Fatia 10)
│  └─ web/                         # @kanban/web
│     ├─ src/
│     │  ├─ main.tsx
│     │  ├─ router.tsx
│     │  ├─ styles/globals.css     # Tailwind + tokens (temas claro e escuro)
│     │  ├─ lib/                   # api-client.ts, query-client.ts, dates.ts, theme.ts
│     │  ├─ components/ui/         # Button, Input, Dialog, Menu, Toast, Badge, Switch...
│     │  ├─ components/layout/     # AppHeader (com slide de tema), RequireAuth
│     │  ├─ features/
│     │  │  ├─ setup/ auth/ profile/ admin/
│     │  │  ├─ boards/             # home de quadros, arquivados
│     │  │  ├─ board/              # quadro, listas, cards, DnD, filtro, "Mover para…"
│     │  │  ├─ card-detail/        # modal/rota do card, checklists, comentários, atividade
│     │  │  ├─ my-cards/  notifications/
│     │  └─ test/                  # setup do Vitest, handlers MSW
│     ├─ e2e/                      # Playwright
│     ├─ index.html
│     └─ vite.config.ts
├─ packages/
│  └─ shared/                      # @raphasparda/ronin-shared
│     └─ src/
│        ├─ index.ts
│        ├─ errors.ts              # ErrorCode (union) + envelope
│        ├─ schemas/               # common.ts, auth.ts, users.ts, boards.ts, lists.ts, cards.ts ...
│        └─ domain/                # due-state.ts, palette.ts, priority.ts, constants.ts (+ *.test.ts)
├─ infra/
│  ├─ postgres/init/01-test-db.sql # cria kanban_test no container de dev
│  ├─ postgres/local-setup.sql     # alternativa: role e bancos no Postgres nativo (idempotente)
│  ├─ Caddyfile                    # (Fatia 10)
│  └─ docker-compose.prod.yml      # (Fatia 10)
├─ scripts/
│  ├─ dev.mjs                     # pnpm dev: banco local + api + web
│  ├─ db-dev.mjs                  # pnpm db:dev: só o banco local
│  └─ dev-db/postgres.mjs         # PostgreSQL local de dev (embedded-postgres + pg_ctl), dados em .data/
├─ docs/
├─ .github/workflows/ci.yml
├─ docker-compose.yml              # dev (alternativa): só PostgreSQL
├─ .env.example
├─ .gitattributes                  # * text=auto eol=lf
├─ .editorconfig  .nvmrc  .npmrc
├─ package.json  pnpm-workspace.yaml  tsconfig.base.json
└─ eslint.config.js  prettier.config.js
```

Regras de dependência:
- `apps/web` e `apps/api` importam `@raphasparda/ronin-shared`. `shared` não importa nada dos apps e não depende de Node nem de DOM (só `zod` e `fractional-indexing` se preciso).
- `@raphasparda/ronin-shared` é consumido **como fonte TS** (`"exports": { ".": "./src/index.ts" }`). Vite, Vitest e tsx entendem TS; o build da API (tsup) empacota o shared com `noExternal: ['@raphasparda/ronin-shared']`.
- Dentro da API, módulos só conversam por funções exportadas do `service.ts` de outro módulo. Rotas nunca importam `db/schema` de outro módulo diretamente para escrever. Mudanças de `status` do card só acontecem via `modules/completion`.

Windows (ambiente do cliente):
- Scripts em `package.json` não usam sintaxe de shell POSIX (`&&` é ok; nada de `rm -rf`, `export VAR=`). Use `rimraf` se precisar limpar, e `.env` carregado por `process.loadEnvFile()` (Node 24) no `config/env.ts`.
- `.gitattributes` força LF para evitar diffs e quebras em scripts de container.
- Banco de dev sem Docker e sem admin: `pnpm dev` sobe um PostgreSQL 18 do próprio projeto (pacote `embedded-postgres`) em `127.0.0.1:5433`, com dados em `.data/postgres` (gitignored). A 5432 fica livre para um Postgres nativo. Detalhes em `docs/ops/setup-local.md`.
- Web de dev fixo em `127.0.0.1:5310` (`strictPort`): a 5173 é usada por outro projeto na máquina do cliente.

Scripts de raiz (contrato comum a todo o projeto):

| Script | Faz |
|--------|-----|
| `pnpm dev` | sobe o PostgreSQL local (5433), espera responder, aplica as migrations e sobe `api` (tsx watch, porta 3000) e `web` (Vite, porta 5310); Ctrl+C derruba tudo |
| `pnpm dev:app` | só `api` e `web` em paralelo (banco por conta de quem roda) |
| `pnpm db:dev` | só o PostgreSQL local, em primeiro plano (idempotente) |
| `pnpm db:up` / `pnpm db:down` | alternativa Docker: `docker compose up -d postgres` / `docker compose down` |
| `pnpm db:generate` | `drizzle-kit generate` (ronin-api) |
| `pnpm db:migrate` | aplica migrations no `DATABASE_URL` |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | em todos os pacotes |
| `pnpm test:e2e` | Playwright (ronin-web) |
| `pnpm build` | build de `web` (estático) e `api` (tsup) |

Variáveis de ambiente (`.env.example`):

| Variável | Exemplo dev | Notas |
|----------|-------------|-------|
| `DATABASE_URL` | `postgres://kanban:kanban@127.0.0.1:5433/kanban` | banco local do `pnpm dev`; nativo usa 5432 |
| `TEST_DATABASE_URL` | `postgres://kanban:kanban@127.0.0.1:5433/kanban_test` | usado pelo Vitest da API; o globalSetup sobe o banco local se não responder e aplica as migrations |
| `DATABASE_POOL_MAX` | `10` | conexões máximas do pool `pg` da API (1–100, padrão 10) |
| `POSTGRES_PORT` | `5433` | porta do host no docker-compose (alternativa Docker) |
| `PORT` | `3000` | API |
| `HOST` | `127.0.0.1` | interface de escuta da API (padrão `127.0.0.1`; no container de produção use `0.0.0.0`) |
| `APP_ORIGIN` | `http://127.0.0.1:5310` | origem pública; usada no CSRF e para montar links de convite/reset. `https://` só com `NODE_ENV=production`, e produção exige `https://` (a API não sobe com a combinação errada, §6.8) |
| `NODE_ENV` | `development` | `production` liga cookie `Secure`/`__Host-` e desliga Swagger UI. **O Dockerfile de produção (Fatia 10) deve fixar `ENV NODE_ENV=production`** |
| `TRUST_PROXY` | `false` | atrás do Caddy, IP real em `request.ip`. **Fatia 10: restringir à sub-rede/IP do proxy** (não `true`), senão quem alcança a API forja `X-Forwarded-For` e escapa do bloqueio por IP e dos limites de rota (§6.8) |
| `LOG_LEVEL` | `info` | |

## 4. Modelo de domínio

```mermaid
classDiagram
  Workspace "1" -- "*" User
  Workspace "1" -- "*" Board
  User "1" -- "*" Session
  Board "1" -- "*" List
  Board "1" -- "*" Label
  List "1" -- "*" Card
  Card "*" -- "*" User : assignees
  Card "*" -- "*" Label
  Card "1" -- "*" Checklist
  Checklist "1" -- "*" ChecklistItem
  Card "1" -- "*" Comment
  Card "1" -- "*" CardActivity
  User "1" -- "*" Notification
```

### 4.1 Invariantes (o servidor garante; os testes cobrem)

| # | Invariante | Onde é garantida |
|---|-----------|------------------|
| I1 | Existe exatamente 1 linha em `workspace`. Setup só roda com 0 usuários. | `CHECK (id = 1)`; `pg_advisory_xact_lock` no setup |
| I2 | E-mail único, minúsculo, sem espaços. | Zod normaliza (`trim().toLowerCase()`); `UNIQUE (email)` |
| I3 | Sempre ≥ 1 Admin ativo (RN03). | service admin, dentro de transação com `SELECT ... FOR UPDATE` nos admins |
| I4 | Quadro tem 0 ou 1 lista de conclusão (RN06). | índice único parcial `lists(board_id) WHERE is_done_list` |
| I5 | Posições únicas entre irmãos ativos (RN07). | índice único parcial + lock da linha pai (ADR 0004) |
| I6 | Card pertence a 1 lista; `cards.board_id` = `lists.board_id` da lista. | service de cards (sempre atualiza os dois juntos) |
| I7 | `status = 'completed'` ⇔ `completed_at`, `completed_by` não nulos. | `CHECK` |
| I8 | Transições `open ⇄ completed` são serializadas por card e aplicadas por um único serviço. Card na lista de conclusão está sempre `completed` (RN12). | `modules/completion` + `SELECT ... FOR UPDATE` no card (ADR 0010) |
| I9 | Cor de lista e de etiqueta é sempre uma chave da paleta (nunca hex livre) (RN15). Prioridade é um dos 4 níveis fixos ou nula (RN16). | enums `palette_color` e `card_priority` + schemas Zod (ADR 0012) |
| I10 | Quadro arquivado é somente leitura (exceto restaurar e excluir). | `assertBoardWritable(tx, boardId)` em toda mutação de conteúdo |
| I11 | Não se cria nem se move card para lista arquivada. | service de cards |
| I12 | Atividade é append-only. | não há rota de update/delete; só cascata ao excluir card/quadro |

### 4.2 Regras de conclusão (C9, RN11–RN14) — ver ADR 0010

Um único serviço `completion.service` aplica transições. Tudo roda na mesma transação da ação que as dispara, com o card bloqueado (`SELECT ... FOR UPDATE`).

| Ação | Condição | Efeito |
|------|----------|--------|
| `POST /cards/:id/complete` | card `open` | status `completed`, `completed_at = now()`, `completed_by = ator`; se o quadro tem lista de conclusão e o card não está nela, move para o **fim** dela; atividade `card_completed` (e `card_moved` se mudou de lista). Quadro sem lista de conclusão: o card fica onde está. |
| `POST /cards/:id/complete` | card já `completed` | no-op, 200, `completionChange: null`. |
| `POST /cards/:id/reopen` | card `completed` | status `open`, limpa `completed_*`; se o card está na lista de conclusão, move para o **topo** (`placement: start`) da primeira lista ativa não-conclusão do quadro (menor `position`); se não existir outra lista ativa, fica onde está; atividade `card_reopened` (e `card_moved` se mudou). Card fora da lista de conclusão (ou quadro sem ela): fica onde está. |
| `POST /cards/:id/reopen` | card já `open` | no-op, 200. |
| `POST /cards/:id/move` | card `open` e lista destino `is_done_list` | move e **conclui** (mesmos efeitos do complete, sem mover de novo). |
| `POST /cards/:id/move` | card `completed`, lista **origem** `is_done_list` e destino **não** `is_done_list` (mesmo quadro ou outro) | move para onde o usuário pediu e **reabre** (RN12). |
| `POST /cards/:id/move` | demais casos (inclusive card concluído pelo botão, fora de lista de conclusão, movido entre listas comuns) | só move; status não muda. |
| `POST /lists/:id/cards` | lista é de conclusão | recusado: `409 LIST_IS_DONE_LIST` (a UI não mostra "Adicionar card" nessa lista). |
| `PATCH /lists/:id { isDoneList: true }` | lista tem cards `open` não arquivados | na mesma transação, **conclui** cada um (ator = quem marcou; atividade `card_completed` por card), mantendo as posições. Garante RN12. A UI confirma antes: "N cards abertos nesta lista serão marcados como concluídos". |
| `PATCH /lists/:id { isDoneList: false }` ou marcar outra lista | qualquer | cards já concluídos continuam concluídos. |
| Arquivar lista de conclusão | qualquer | a marcação `is_done_list` é removida; status dos cards não muda. |
| `POST /cards/:id/restore` | lista original é de conclusão e card `open` | restaura no fim e **conclui** (RN12). |
| Arquivar, restaurar (demais casos) ou excluir card | qualquer | não altera `status` nem `completed_*`. |

### 4.3 Prazo e fuso (C5) — ver ADR 0011

- `workspace.timezone` IANA, padrão `America/Sao_Paulo`.
- O cliente envia `{ date: "YYYY-MM-DD", time: "HH:mm" | null }` sempre **no fuso do workspace**. O servidor converte e grava `due_at timestamptz` (UTC) + `due_has_time boolean`. Sem hora: `due_at` = `23:59:59.999` daquele dia no fuso do workspace.
- A resposta devolve `dueAt` (ISO UTC) e `dueHasTime`. O front exibe no fuso do workspace (não do navegador).
- Estado do prazo (`packages/shared/src/domain/due-state.ts`, `getDueState({ status, dueAt }, now)`): `completed` se card concluído; `none` se sem prazo; `overdue` se `now > dueAt`; `due_soon` se `dueAt − now ≤ 24h`; senão `scheduled`. Mesma função no front (face do card, filtro, Meus cards).

## 5. Modelo de dados (PostgreSQL)

Convenções:
- Tabelas e colunas em `snake_case`; TS em `camelCase` (mapeado pelo Drizzle).
- PK `uuid DEFAULT gen_random_uuid()` (exceto onde indicado). Datas `timestamptz`, sempre UTC.
- `position` usa o customType `textC` (DDL `text COLLATE "C"`), obrigatório para a ordenação binária das chaves fracionárias. No JS, comparar posições com `<`/`>`, **nunca** `localeCompare`.
- Usuários **nunca** são excluídos (apenas desativados/anonimizados), então FKs para `users` são `ON DELETE RESTRICT` (violação: SQLSTATE `23001`, não `23503`).
- Enums como `pgEnum`.

Enums: `user_role ('admin','member')`, `user_status ('active','deactivated')`, `auth_token_kind ('invite','password_reset')`, `card_status ('open','completed')`, `palette_color ('gray','red','orange','yellow','green','cyan','blue','purple','magenta')` (ordem do enum = ordem da paleta; usado por listas e etiquetas; valores visuais em tokens CSS, ADR 0012), `card_priority ('low','medium','high','urgent')`, `notification_type ('card_assigned','card_commented')`, `activity_type` (lista na seção 5.3).

### 5.1 Tabelas

**workspace**
| coluna | tipo | regra |
|--------|------|-------|
| id | smallint PK | default 1; `CHECK (id = 1)` (`workspace_singleton_check`) |
| name | text not null | 1–100 (`CHECK char_length`) |
| timezone | text not null | default `'America/Sao_Paulo'`; `CHECK <> ''` (IANA validado na API) |
| created_at, updated_at | timestamptz not null | default now() |

**users**
| coluna | tipo | regra |
|--------|------|-------|
| id | uuid PK | default `gen_random_uuid()` |
| email | text null | `UNIQUE` (`users_email_unique`); `CHECK email = lower(btrim(email))` e 3–254 (impede duplicata por maiúsculas); null só após anonimização |
| name | text not null | 1–80 (`CHECK`) |
| password_hash | text null | null só após anonimização |
| role | user_role not null | |
| status | user_status not null | default `active` |
| anonymized_at | timestamptz null | |
| password_changed_at | timestamptz not null | default now() |
| created_at, updated_at | timestamptz not null | default now() (`updated_at` também atualizado pelo Drizzle) |

`CHECK`s de ciclo de vida: `users_credentials_present_check` (não anonimizado ⇒ `email` e `password_hash` presentes) e `users_anonymized_check` (anonimizado ⇒ `email` e `password_hash` nulos e `status = 'deactivated'`; impede reativar). Dados pessoais (LGPD): `email`, `name`, `password_hash`.

**sessions**
| coluna | tipo | regra |
|--------|------|-------|
| id | text PK | SHA-256 (hex) do token do cookie; o token em si nunca é gravado. `CHECK id ~ '^[0-9a-f]{64}$'` |
| user_id | uuid FK users not null | `ON DELETE CASCADE`; índice `sessions_user_id_idx` |
| created_at | timestamptz not null | default now() |
| last_seen_at | timestamptz not null | default now() |
| idle_expires_at | timestamptz not null | `last_seen_at + 14 dias` (calculado na API) |
| absolute_expires_at | timestamptz not null | `created_at + 30 dias` (calculado na API) |

**auth_tokens** (convites e redefinições)
| coluna | tipo | regra |
|--------|------|-------|
| id | uuid PK | |
| kind | auth_token_kind | |
| token_hash | text not null | `UNIQUE` (`auth_tokens_token_hash_unique`); SHA-256 hex (`CHECK ~ '^[0-9a-f]{64}$'`) |
| email | text null | convite: e-mail opcional (se preenchido, o aceite exige esse e-mail); normalizado como `users.email` (`CHECK`) |
| role | user_role null | convite: obrigatório; redefinição: nulo (`CHECK`) |
| target_user_id | uuid FK users null | redefinição: obrigatório; convite: nulo (`CHECK`) |
| created_by | uuid FK users not null | |
| expires_at | timestamptz not null | convite +7 dias; reset +24h |
| used_at | timestamptz null | |
| used_by_user_id | uuid FK users null | só com `used_at` preenchido (`CHECK`; pode ser gravado depois, na mesma transação) |
| revoked_at | timestamptz null | |
| created_at | timestamptz not null | default now() |

`CHECK`s: `auth_tokens_invite_check`, `auth_tokens_password_reset_check` (redefinição também sem `email`), `auth_tokens_email_normalized_check`, `auth_tokens_used_by_check`, `auth_tokens_token_hash_sha256_check`. Índice parcial `auth_tokens_target_user_id_idx (target_user_id) WHERE target_user_id IS NOT NULL`.

**auth_throttle**
| coluna | tipo | regra |
|--------|------|-------|
| key | text PK | `email:<email>` ou `ip:<ip>`; `CHECK key ~ '^(email\|ip):.+$'` |
| failures | integer not null | default 0; `CHECK >= 0` |
| window_started_at | timestamptz not null | default now() |
| locked_until | timestamptz null | |

Sem índice além da PK: toda leitura/escrita do login é por `key`; a limpeza diária varre uma tabela pequena.

**boards**
| coluna | tipo | regra |
|--------|------|-------|
| id | uuid PK | |
| name | text not null | 1–100 |
| archived_at | timestamptz null | |
| created_by | uuid FK users not null | |
| created_at, updated_at | timestamptz | |

**lists**
| coluna | tipo | regra |
|--------|------|-------|
| id | uuid PK | |
| board_id | uuid FK boards | `ON DELETE CASCADE` |
| name | text not null | 1–100 |
| position | textC not null | |
| is_done_list | boolean not null | default false |
| color | palette_color not null | cor da coluna/status (estilo Monday). Lista criada sem cor recebe a **próxima cor da paleta** depois da cor da última lista ativa do quadro (cíclico; quadro sem listas ativas → primeira). Listas padrão do quadro novo: "A fazer" `blue`, "Fazendo" `orange`, "Concluído" `green`. |
| archived_at | timestamptz null | |
| created_at, updated_at | timestamptz | |

Índices: `UNIQUE (board_id, position) WHERE archived_at IS NULL`; `UNIQUE (board_id) WHERE is_done_list`; `(board_id)`; `UNIQUE (id, board_id)` (alvo da FK composta de `cards`). `CHECK`s: nome 1–100, `position <> ''`, `NOT (is_done_list AND archived_at IS NOT NULL)` (arquivar exige desmarcar no mesmo `UPDATE`).

**cards**
| coluna | tipo | regra |
|--------|------|-------|
| id | uuid PK | |
| board_id | uuid FK boards | `ON DELETE CASCADE`; índice |
| list_id | uuid not null | FK composta `(list_id, board_id) → lists (id, board_id)` `ON DELETE CASCADE` (`cards_list_board_fk`): garante I6 no banco; mover entre quadros atualiza as duas colunas no mesmo `UPDATE` |
| title | text not null | 1–500, sem `\r`/`\n` |
| description | text not null | default `''`; até 20.000 (Markdown) |
| position | textC not null | |
| status | card_status not null | default `open` |
| completed_at | timestamptz null | |
| completed_by | uuid FK users null | |
| due_at | timestamptz null | |
| due_has_time | boolean not null | default false; `true` exige `due_at` (`CHECK`) |
| priority | card_priority null | `null` = sem prioridade (padrão). Não afeta `position` (RN16). |
| archived_at | timestamptz null | |
| created_by | uuid FK users | |
| created_at, updated_at | timestamptz | |

Índices: `UNIQUE (list_id, position) WHERE archived_at IS NULL`; `(board_id)`; `(list_id)`; `(due_at) WHERE status = 'open' AND archived_at IS NULL`. `CHECK cards_completion_check`: `(status = 'completed' AND completed_at IS NOT NULL AND completed_by IS NOT NULL) OR (status = 'open' AND completed_at IS NULL AND completed_by IS NULL)` (reabrir limpa os dois campos).

**card_assignees**: `card_id` (FK cascade), `user_id` (FK), `assigned_by` (FK), `created_at`. PK `(card_id, user_id)`; índice `(user_id)`.

**labels**: `id`, `board_id` (FK cascade), `name` text 1–50, `color` palette_color not null, `created_at`, `updated_at`. Índice `(board_id)`.

**card_labels**: `card_id` (FK cascade), `label_id` (FK cascade). PK `(card_id, label_id)`; índice `(label_id)`.

**checklists**: `id`, `card_id` (FK cascade), `title` 1–200, `created_at`, `updated_at`. Ordem: `created_at, id`. Índice `(card_id, created_at, id)`.

**checklist_items**: `id`, `checklist_id` (FK cascade), `text` 1–500, `position` textC, `is_checked` bool default false, `checked_by` uuid FK null, `checked_at` null, `created_at`, `updated_at`. `UNIQUE (checklist_id, position)`. `CHECK`: marcado ⇔ `checked_by` e `checked_at` preenchidos.

**comments**: `id`, `card_id` (FK cascade), `author_id` (FK), `body` 1–10.000 (Markdown), `edited_at` null, `created_at`. Índice `(card_id, created_at)`.

**card_activities**: `id`, `card_id` (FK cascade), `board_id` (FK cascade), `actor_id` (FK), `type` activity_type, `data` jsonb not null default `'{}'` (`CHECK jsonb_typeof = 'object'`), `created_at`. Índices `(card_id, created_at)` e `(board_id)`. Trigger `card_activities_append_only` recusa `UPDATE` (SQLSTATE `23001`); `DELETE` só pelas cascatas.

**notifications**: `id`, `user_id` (destinatário, FK), `type` notification_type, `card_id` (FK cascade), `actor_id` (FK), `comment_id` (FK comments `ON DELETE SET NULL`) null, `read_at` null, `created_at`. Índices `(user_id, created_at DESC)`, `(user_id) WHERE read_at IS NULL`, `(card_id)`, `(comment_id) WHERE comment_id IS NOT NULL`. `CHECK`s: `user_id <> actor_id` (RN18) e `type = 'card_commented' OR comment_id IS NULL`.

Ordenação por prioridade (Meus cards): `urgent` > `high` > `medium` > `low` > `null`, via `CASE` na consulta (mesmo ranking exportado por `packages/shared/src/domain/priority.ts` para o front).

### 5.1.1 Implementado: diagrama ER e índices

Schema Drizzle em `src/db/schema/` (`workspace.ts`, `users.ts`, `auth.ts`, `boards.ts`, `cards.ts`, `labels.ts`, `checklists.ts`, `comments.ts`, `notifications.ts`, todos exportados por `index.ts`); SQL em `drizzle/`. Todas as tabelas do MVP (fatias 1–9) já existem:

| Migration | Tarefa | Conteúdo |
|-----------|--------|----------|
| `0000_auth_core` | 1.2 | `workspace`, `users`, `sessions`, `auth_throttle` |
| `0001_auth_tokens` | 2.2 | enum `auth_token_kind`; `auth_tokens` |
| `0002_boards_lists` | 3.2 | enum `palette_color`; `boards`, `lists` |
| `0003_cards_activities` | 4.2 | enums `card_status`, `activity_type`; `cards`, `card_activities` |
| `0004_card_activities_append_only` | 4.2 | trigger que recusa `UPDATE` em `card_activities` (SQL customizado via `drizzle-kit generate --custom`) |
| `0005_assignees_labels_priority` | 5.2 | enum `card_priority`; `cards.priority`; `card_assignees`, `labels`, `card_labels` |
| `0006_checklists_comments` | 6.2 | `checklists`, `checklist_items`, `comments` |
| `0007_notifications` | 7.2 | enum `notification_type`; `notifications` |

As fatias 8 e 9 não têm migration: a conclusão usa as colunas de 4.2 e "Meus cards" usa `card_assignees_user_id_idx`.

```mermaid
erDiagram
  workspace {
    smallint id PK "CHECK id = 1"
    text name
    text timezone
  }
  users {
    uuid id PK
    text email UK "null só anonimizado"
    text name
    text password_hash "null só anonimizado"
    user_role role
    user_status status
    timestamptz anonymized_at
  }
  sessions {
    text id PK "sha256 hex do token"
    uuid user_id FK
    timestamptz idle_expires_at
    timestamptz absolute_expires_at
  }
  auth_throttle {
    text key PK "email:... ou ip:..."
    integer failures
    timestamptz locked_until
  }
  auth_tokens {
    uuid id PK
    auth_token_kind kind
    text token_hash UK "sha256 hex"
    text email "convite, opcional"
    user_role role "convite"
    uuid target_user_id FK "reset"
    uuid created_by FK
    uuid used_by_user_id FK
    timestamptz expires_at
    timestamptz used_at
    timestamptz revoked_at
  }
  boards {
    uuid id PK
    text name
    uuid created_by FK
    timestamptz archived_at
  }
  lists {
    uuid id PK
    uuid board_id FK
    text name
    textC position
    boolean is_done_list "0..1 por quadro"
    palette_color color
    timestamptz archived_at
  }
  cards {
    uuid id PK
    uuid board_id FK
    uuid list_id FK "FK composta com board_id"
    text title
    text description
    textC position
    card_status status
    timestamptz completed_at
    uuid completed_by FK
    timestamptz due_at
    boolean due_has_time
    card_priority priority "nula"
    uuid created_by FK
    timestamptz archived_at
  }
  card_activities {
    uuid id PK
    uuid card_id FK
    uuid board_id FK
    uuid actor_id FK
    activity_type type
    jsonb data
    timestamptz created_at
  }
  card_assignees {
    uuid card_id PK,FK
    uuid user_id PK,FK
    uuid assigned_by FK
  }
  labels {
    uuid id PK
    uuid board_id FK
    text name
    palette_color color
  }
  card_labels {
    uuid card_id PK,FK
    uuid label_id PK,FK
  }
  checklists {
    uuid id PK
    uuid card_id FK
    text title
    timestamptz created_at
  }
  checklist_items {
    uuid id PK
    uuid checklist_id FK
    text text
    textC position
    boolean is_checked
    uuid checked_by FK
    timestamptz checked_at
  }
  comments {
    uuid id PK
    uuid card_id FK
    uuid author_id FK
    text body
    timestamptz edited_at
  }
  notifications {
    uuid id PK
    uuid user_id FK "destinatário"
    notification_type type
    uuid card_id FK
    uuid actor_id FK
    uuid comment_id FK "SET NULL"
    timestamptz read_at
  }
  users ||--o{ sessions : "CASCADE"
  users ||--o{ auth_tokens : "RESTRICT"
  users ||--o{ boards : "cria (RESTRICT)"
  boards ||--o{ lists : "CASCADE"
  boards ||--o{ cards : "CASCADE"
  lists ||--o{ cards : "CASCADE (list_id, board_id)"
  boards ||--o{ labels : "CASCADE"
  boards ||--o{ card_activities : "CASCADE"
  cards ||--o{ card_activities : "CASCADE"
  users ||--o{ card_activities : "ator (RESTRICT)"
  cards ||--o{ card_assignees : "CASCADE"
  users ||--o{ card_assignees : "RESTRICT"
  cards ||--o{ card_labels : "CASCADE"
  labels ||--o{ card_labels : "CASCADE"
  cards ||--o{ checklists : "CASCADE"
  checklists ||--o{ checklist_items : "CASCADE"
  cards ||--o{ comments : "CASCADE"
  users ||--o{ comments : "autor (RESTRICT)"
  users ||--o{ notifications : "destinatário (RESTRICT)"
  cards ||--o{ notifications : "CASCADE"
  comments |o--o{ notifications : "SET NULL"
```

| Índice | Consulta que justifica |
|--------|------------------------|
| `workspace_pkey (id)` | leitura da instância única (setup/status, fuso) |
| `users_pkey (id)` | join da sessão com o usuário a cada request |
| `users_email_unique (email)` | login e convite por e-mail; garante unicidade (NULLs distintos permitem vários anonimizados) |
| `sessions_pkey (id)` | lookup da sessão pelo hash do cookie a cada request |
| `sessions_user_id_idx (user_id)` | `DELETE FROM sessions WHERE user_id = $1` (troca/redefinição de senha, desativação, anonimização) e a própria FK em cascata |
| `auth_throttle_pkey (key)` | leitura/upsert do contador por e-mail e por IP no login |
| `auth_tokens_token_hash_unique (token_hash)` | lookup e consumo atômico do convite/reset pelo hash |
| `auth_tokens_target_user_id_idx (target_user_id) WHERE NOT NULL` | revogar resets pendentes do usuário; anonimização apaga os tokens alvo |
| `lists_board_position_active_unique (board_id, position) WHERE archived_at IS NULL` | I5; payload do quadro (`board_id = $1 AND archived_at IS NULL ORDER BY position`); `computePosition` |
| `lists_board_done_list_unique (board_id) WHERE is_done_list` | I4/RN06; "qual é a lista de conclusão do quadro" (move/complete) |
| `lists_board_id_idx (board_id)` | `GET /boards/:id/archived` (listas arquivadas) e cascata de `DELETE boards` (o parcial não cobre arquivadas) |
| `lists_id_board_id_unique (id, board_id)` | alvo obrigatório da FK composta `cards_list_board_fk` (I6) |
| `cards_list_position_active_unique (list_id, position) WHERE archived_at IS NULL` | I5; `computePosition` de cards; ordenação por lista |
| `cards_board_id_idx (board_id)` | payload do quadro (500 cards em 0,7 ms medido), arquivados do quadro, cascata |
| `cards_list_id_idx (list_id)` | verificação/cascata da FK composta (inclui arquivados); concluir abertos da lista ao marcá-la como de conclusão |
| `cards_due_at_open_idx (due_at) WHERE status = 'open' AND archived_at IS NULL` | consultas por prazo de cards abertos (Meus cards, alertas) |
| `card_activities_card_id_created_at_idx (card_id, created_at)` | `GET /cards/:id/activity` e cascata ao excluir card |
| `card_activities_board_id_idx (board_id)` | cascata de `DELETE boards` (sem ele, varredura da maior tabela do sistema) |
| `card_assignees_pkey (card_id, user_id)` | payload/detalhe (`card_id = ANY(...)`), idempotência do `PUT`, cascata do card |
| `card_assignees_user_id_idx (user_id)` | Meus cards (`user_id = $me`); 3.360 atribuições em 10.000 cards: 5 ms medido |
| `labels_board_id_idx (board_id)` | payload do quadro e cascata |
| `card_labels_pkey (card_id, label_id)` | payload/detalhe, idempotência, cascata do card |
| `card_labels_label_id_idx (label_id)` | excluir etiqueta remove de todos os cards (cascata) |
| `checklists_card_id_created_at_idx (card_id, created_at, id)` | detalhe (ordem de criação), contagem `checklist {done,total}` do payload, cascata |
| `checklist_items_checklist_position_unique (checklist_id, position)` | I5; itens ordenados; `computePosition`; cascata |
| `comments_card_id_created_at_idx (card_id, created_at)` | detalhe em ordem cronológica, `commentCount`, cascata |
| `notifications_user_id_created_at_idx (user_id, created_at DESC)` | listagem com cursor `before` |
| `notifications_user_id_unread_idx (user_id) WHERE read_at IS NULL` | contador de não lidas (polling 60 s) e "ler todas" |
| `notifications_card_id_idx (card_id)` | cascata ao excluir card/quadro |
| `notifications_comment_id_idx (comment_id) WHERE NOT NULL` | `ON DELETE SET NULL` ao excluir comentário |

Não criados de propósito: índices em `sessions.idle_expires_at`/`absolute_expires_at`, `auth_throttle.window_started_at`, `auth_tokens.expires_at` e `notifications.read_at` (só a limpeza diária usa); índices em FKs para `users` (`created_by`, `completed_by`, `actor_id`, `author_id`, `checked_by`, `assigned_by`, `used_by_user_id`), porque usuários nunca são excluídos; índice em `boards.name` (poucos quadros). Reavaliar com `EXPLAIN (ANALYZE, BUFFERS)` se algo ficar lento. O teste `catalog.test.ts` falha se surgir FK (exceto para `users`) sem índice.

Integridade reforçada no banco (além do mínimo descrito acima): FK composta de I6; `CHECK` de conclusão nos dois sentidos; lista de conclusão nunca arquivada; `due_has_time` exige `due_at`; título sem quebra de linha; item marcado ⇔ autor/data; notificação nunca para o próprio ator (RN18); campos de convite e reset mutuamente exclusivos; trigger append-only na atividade.

Observações para o backend:
- Rebalanceamento (ADR 0004): os índices únicos de posição não são `DEFERRABLE`, e o PostgreSQL checa unicidade linha a linha, até dentro de um único `UPDATE`. Regravar os irmãos pode colidir com uma chave antiga ainda presente. Faça em duas etapas na mesma transação (primeiro chaves temporárias garantidamente distintas, ex. `'~' || id`, depois as finais).
- Aceite de convite: `used_by_user_id` pode ser gravado depois de `used_at` na mesma transação (o `CHECK` só exige `used_at` quando `used_by_user_id` existe).
- Arquivar a lista de conclusão exige `is_done_list = false` no mesmo `UPDATE`.
- Mover card entre quadros: `list_id` e `board_id` no mesmo `UPDATE` (a FK composta recusa o contrário).

Infra: `db/client.ts` (`createPool` com `max` = `DATABASE_POOL_MAX`, `createDb` = `drizzle()` com o schema), `db/types.ts` (`textC`, `createdAt`, `updatedAt`), `db/migrate.ts` (`runMigrations(url)` com advisory lock; CLI `pnpm db:migrate`). Testes: `test/global-setup.ts` migra `TEST_DATABASE_URL`; `test/db.ts` expõe `describeDb`, `useTestDatabase()` (`truncateAll()` antes de cada teste; descobre tabelas novas sozinho), `pgErrorOf()` e `pgError()`; `src/db/test-fixtures.ts` tem inserções mínimas usadas pelos testes de schema (`src/db/schema/*.test.ts`).

### 5.2 Ciclo de vida e exclusões

| Evento | Efeito no banco |
|--------|-----------------|
| Excluir quadro (Admin) | `DELETE boards` → cascata em listas, cards, etiquetas, checklists, comentários, atividades, notificações. |
| Excluir card (Admin) | cascata do card (responsáveis, etiquetas, checklists, comentários, atividades, notificações). |
| Desativar usuário | `status='deactivated'`; apaga sessões; revoga redefinições pendentes. Atribuições permanecem. |
| Anonimizar (só desativado) | `name='Usuário removido'`, `email=NULL`, `password_hash=NULL`, `anonymized_at=now()`; apaga sessões, tokens alvo, notificações recebidas e o throttle do e-mail; tira o e-mail dos convites ligados a ele. Cards, comentários e atividades permanecem, exibindo "Usuário removido". Irreversível; não pode reativar (LGPD). |
| Manutenção diária (`plugins/maintenance.ts`, a cada 24h e no boot; ligada por padrão só em produção, api.md §18.4 item 40) | apaga notificações lidas há > 90 dias (RN19), sessões expiradas, `auth_throttle` sem lock e com janela > 1h, `auth_tokens` expirados/usados/revogados há > 30 dias (e criados há > 30 dias). |

### 5.3 Atividade (C12)

`activity_type` e formato de `data` (schema Zod em `packages/shared/src/schemas/activity.ts`):

| type | data |
|------|------|
| `card_created` | `{ listId, listName }` |
| `card_title_changed` | `{ from, to }` |
| `card_moved` | `{ fromListId, fromListName, toListId, toListName, fromBoardId, fromBoardName, toBoardId, toBoardName }` (só quando muda de lista; reordenar na mesma lista não gera) |
| `card_assignee_added` | `{ userId }` |
| `card_assignee_removed` | `{ userId }` |
| `card_due_changed` | `{ from: string|null, to: string|null, hasTime: boolean }` |
| `card_priority_changed` | `{ from: CardPriority|null, to: CardPriority|null }` |
| `card_completed` | `{}` |
| `card_reopened` | `{}` |
| `card_archived` / `card_restored` | `{}` |

Nomes são "fotografados" em `data` para o histórico continuar legível. Nome de usuário é resolvido na leitura (anonimização se reflete).

## 6. Autenticação, sessão e CSRF

### 6.1 Senhas (ADR 0003)
- Argon2id via `@node-rs/argon2`: `memoryCost: 19456` (KiB), `timeCost: 2`, `parallelism: 1`, `outputLen: 32`. Parâmetros em `lib/password.ts`.
- Política: 10 a 256 caracteres, sem regra de composição; não pode ser igual ao e-mail. Schema `passwordSchema` no shared.
- Login com e-mail inexistente ou usuário inativo/anonimizado executa `verify` contra um hash fictício fixo (tempo constante) e responde igual a senha errada.

### 6.2 Sessão (ADR 0002)
- Token: 32 bytes de `crypto.randomBytes`, base64url, enviado só no cookie. No banco: `sessions.id = sha256(token)`.
- Cookie: nome `__Host-kanban_sid` em produção (`Secure`), `kanban_sid` em dev (http://localhost); `HttpOnly`, `SameSite=Lax`, `Path=/`, sem `Domain`, `Max-Age` = 30 dias.
- Por request (`plugins/session.ts`, hook `onRequest`): busca sessão por hash com join em `users`; válida se `idle_expires_at > now`, `absolute_expires_at > now` e `users.status='active'`. Caso contrário, apaga o cookie e segue sem usuário. Se `last_seen_at` tem mais de 5 min, atualiza `last_seen_at` e `idle_expires_at`.
- `request.user = { id, name, email, role }` carregado do banco a cada request: mudança de papel vale na hora.
- Rotas autenticadas por padrão: o plugin registra um hook global que exige usuário, exceto rotas marcadas com `config: { public: true }` (health, setup, login, logout, lookup/aceite de convite, lookup/uso de reset, `/api/docs` fora de produção) e 404. O hook é `preParsing` (não `preHandler`, que roda depois da validação) para cumprir a ordem 401 → 403 CSRF → 400 de api.md §3; o CSRF (`plugins/csrf.ts`) é outro `preParsing` logo depois. O rate limit geral roda no `onRequest` da rota, entre a carga da sessão e essas checagens. `requireAdmin` é `preHandler` de rota (403 de permissão vem depois da validação).
- Invalidação: logout (sessão atual); troca de senha (todas as outras sessões do usuário); redefinição por link, desativação e anonimização (todas).
- Login cria nova sessão (nunca reaproveita token), prevenindo fixação.

### 6.3 CSRF (ADR 0002)
Para todo método diferente de `GET`/`HEAD`/`OPTIONS` em `/api/*`, `plugins/csrf.ts` exige:
1. Header `Origin` igual a `APP_ORIGIN`. Se ausente, aceitar só se `Sec-Fetch-Site: same-origin`. Senão `403 CSRF_REJECTED`.
2. Header `X-Kanban-Csrf: 1`. Ausente → `403 CSRF_REJECTED`.
3. Corpo, quando existir, com `Content-Type: application/json`. O parser padrão de `text/plain` do Fastify é removido em `buildApp()`, então qualquer outro tipo é recusado com `415 UNSUPPORTED_MEDIA_TYPE`.

Somado a `SameSite=Lax` e à ausência de CORS, isso bloqueia formulários e fetch de outras origens. `GET` nunca altera estado. O `api-client` do front envia o header sempre.

### 6.4 Limites de tentativa
| Alvo | Regra | Resposta |
|------|-------|----------|
| Login por e-mail | 5 falhas em 15 min → bloqueio de 15 min (persistido em `auth_throttle`); sucesso zera. Janela vencida ou bloqueio terminado recomeçam a contagem. `currentPassword` errada na troca de senha conta na mesma chave | `429 TOO_MANY_ATTEMPTS` + `Retry-After` |
| Login por IP | 20 falhas em 15 min → bloqueio de 15 min; sucesso não conta nem zera | idem |
| `POST /api/auth/login` | 30 req / min por IP (`@fastify/rate-limit`) | `429 RATE_LIMITED` |
| `POST /api/me/password` | 10 req / 15 min por usuário | `429 RATE_LIMITED` |
| Lookup/aceite de convite e reset | 10 req / 15 min por IP (`@fastify/rate-limit`) | `429 RATE_LIMITED` |
| Setup | 5 req / 15 min por IP | `429 RATE_LIMITED` |
| Geral autenticado | 600 req / min por usuário | `429 RATE_LIMITED` |

Atomicidade (`api.md` §18.5, itens 41 e 42): a tentativa é **reservada antes do Argon2** com um upsert que incrementa e devolve o contador (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`), e a decisão usa o valor devolvido. Proibido o padrão "checa bloqueio → verifica senha → grava falha": uma rajada paralela inteira passa pela checagem antes da primeira falha ser gravada. Ordem: e-mail, depois IP. Sucesso apaga o e-mail e devolve a reserva do IP; senha certa na troca de senha devolve a reserva do e-mail.

Nota: o escopo cita "5 tentativas para o mesmo e-mail ou IP". Para IP usamos 20 porque a equipe tende a compartilhar o mesmo IP (escritório/NAT); 5 por IP bloquearia todos por um erro de um. O bloqueio por e-mail mantém 5.

### 6.5 Convites e redefinição (ADR 0008)
- Token: 32 bytes aleatórios base64url; banco guarda só SHA-256. Retornado **uma vez** na criação, já como URL.
- URLs com token no **fragmento** (não vai para logs de servidor/proxy nem `Referer`): `${APP_ORIGIN}/convite#token=<t>` e `${APP_ORIGIN}/redefinir-senha#token=<t>`. A SPA lê o fragmento, limpa com `history.replaceState` e envia o token no corpo JSON.
- Uso único: consumo com `UPDATE auth_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING *` na mesma transação da criação da conta/troca de senha.
- Gerar novo reset para um usuário revoga os resets pendentes dele.
- Rebaixar um Admin para Member, desativar ou anonimizar revoga, na mesma transação, os convites e resets **pendentes criados por ele** (`created_by`): um Admin removido não deixa links válidos para trás (`api.md` §18.5 item 43).

### 6.6 Autorização
- Todos os usuários ativos leem e editam todos os quadros (decisão 1 do cliente).
- Somente Admin: rotas `/api/admin/*`, `DELETE /api/boards/:id`, `DELETE /api/cards/:id`, excluir comentário de terceiros.
- Autor: editar comentário (só o autor, nem Admin edita), excluir comentário (autor ou Admin).
- Sem IDOR relevante porque tudo é compartilhado, **exceto** notificações (filtradas por `user_id = request.user.id`; notificação de outro → 404) e e-mails de colegas (só Admin vê).
- Checagem sempre no servidor; a UI apenas esconde botões.

### 6.7 Headers e demais proteções
- API (`plugins/security-headers.ts`): `@fastify/helmet` com defaults, exceto a CSP, que é restrita porque a API só responde JSON: `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. A Swagger UI (`/api/docs`, só fora de produção) usa a CSP própria do pacote (`staticCSP`). `Cache-Control: no-store` em todas as respostas do processo da API (que só atende `/api/*`), inclusive erros e 404.
- Caddy (produção): `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, `Strict-Transport-Security`, `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` restritiva.
- XSS: Markdown renderizado com `react-markdown` sem HTML cru; links com `target="_blank" rel="noopener noreferrer"`; `urlTransform` padrão (bloqueia `javascript:`) (ADR 0007). Nunca usar `dangerouslySetInnerHTML`.
- SQL injection: só query builder do Drizzle ou `sql` template com parâmetros; proibido concatenar string em SQL.
- Erros de banco nos logs: o serializer de `err` (`logger.ts`) loga `DrizzleQueryError`/`DatabaseError` só com tipo, query sem `params`, SQLSTATE, constraint e frames do stack; nunca `message`/`detail`, que carregam valores (e-mail, hash) (`api.md` §18.5 item 45).
- Logs (pino): `redact` de `req.headers.cookie`, `res.headers["set-cookie"]`, `*.password`, `*.currentPassword`, `*.newPassword`, `*.token`. Não logar corpo de requisição. Logar `reqId`, rota, status, duração, `userId`.

### 6.8 Configuração fail-closed e requisitos do deploy (Fatia 10)
- `config/env.ts` recusa subir com `NODE_ENV=production` e `APP_ORIGIN` em `http://`, ou com `APP_ORIGIN` em `https://` fora de produção. O `NODE_ENV` controla cookie `Secure`/`__Host-`, `/api/docs` e os parâmetros do Argon2: esquecer a variável em produção precisa falhar na inicialização, não degradar em silêncio.
- O **Dockerfile de produção deve definir `ENV NODE_ENV=production`** (não depender só do compose ou do `.env` do servidor).
- **`TRUST_PROXY` deve ser restrito à sub-rede/IP do Caddy.** Hoje a variável é booleana; a Fatia 10 passa a aceitar lista de IPs/CIDR e repassa ao `trustProxy` do Fastify. Com `true`, qualquer cliente que alcance a porta da API forja `X-Forwarded-For` e anula o bloqueio por IP e os limites de rota. A API também só deve escutar na rede interna do compose.

## 7. Atualização entre usuários (ADR 0006)

| Tela | Query | Polling | Outros gatilhos |
|------|-------|---------|-----------------|
| Quadro | `['board', boardId]` | 30 s, só com aba visível | foco da aba, após qualquer mutação no quadro |
| Detalhe do card | `['card', cardId]` | 30 s | foco; após mutação |
| Atividade do card | `['card-activity', cardId]` | sem polling | ao abrir a aba "Atividade" e após mutação |
| Lista de quadros | `['boards', {archived}]` | sem polling | foco |
| Meus cards | `['my-cards']` | 60 s | foco |
| Notificações (contador) | `['notifications-unread']` | 60 s | foco |
| Usuários | `['users']` | `staleTime` 5 min | |

Regras:
- `refetchIntervalInBackground: false`, `refetchOnWindowFocus: true`.
- Enquanto um drag está ativo ou existe mutação de movimento pendente, o polling do quadro é pausado (`enabled`/`refetchInterval` condicionais) e `cancelQueries` é chamado no `onMutate`.
- Formulários do detalhe mantêm estado local; dados do polling só sobrescrevem campos **não sujos** (evita apagar o que o usuário digita).
- Movimento: update otimista no cache (`position` temporária gerada com `generateKeyBetween` no cliente só para ordenar), rollback no `onError` com toast "Não foi possível mover o card", e `invalidateQueries(['board', id])` no `onSettled`.
- Last write wins (RN10); sem ETag no MVP.

## 8. Tratamento de erros

Envelope único (schema `errorResponseSchema` no shared):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Mensagem em pt-BR para exibir", "details": [ { "path": "title", "message": "Obrigatório" } ] } }
```

- API: serviços lançam `AppError(code, httpStatus, message, details?)`. `plugins/errors.ts` converte: `AppError` → envelope; erro de validação Zod → `400 VALIDATION_ERROR` com `details`; violação de unicidade Postgres (`23505`) não tratada → `409 CONFLICT`; 404 de rota → `NOT_FOUND`; qualquer outro → `500 INTERNAL_ERROR` com mensagem genérica (stack só no log).
- Tabela completa de códigos em `api.md` §3; a union `ErrorCode` vive em `packages/shared/src/errors.ts` e front e back usam a mesma.
- Front: `api-client.ts` lança `ApiError { status, code, message, details }`. Tratamento global no `QueryClient`:
  - `401 UNAUTHENTICATED` → limpa cache e redireciona para `/login?next=<rota>`.
  - `403` → toast "Você não tem permissão para isso".
  - `429` → toast com o tempo de `Retry-After`.
  - `5xx`/rede → toast "Algo deu errado. Tente de novo."
  - `VALIDATION_ERROR` → formulários mapeiam `details[].path` para os campos.
- Mensagens para o usuário em pt-BR, sem detalhes internos.

## 9. Frontend (diretrizes)

- Rotas: `/setup`, `/login`, `/convite`, `/redefinir-senha`, `/` (quadros), `/quadros/arquivados`, `/b/:boardId`, `/b/:boardId/c/:cardId` (detalhe como diálogo sobre o quadro; URL compartilhável), `/meus-cards`, `/perfil`, `/admin/membros`, `/admin/convites`, `/admin/workspace`.
- Boot: `GET /api/setup/status`; se `needsSetup` → `/setup`. Senão `GET /api/auth/me`; 401 → `/login`.
- Tokens: `globals.css` define variáveis semânticas (`--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-accent`, `--color-danger`, `--color-warning`, `--color-success`, `--color-border`) e, para cada chave da paleta (`gray`, `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple`, `magenta`), o trio `--palette-<cor>-bg`, `--palette-<cor>-fg` e `--palette-<cor>-border`, e, para cada prioridade, `--priority-<nivel>-bg|fg` (cores fixas), em `:root[data-theme="light"]` (**padrão**, S5) e `:root[data-theme="dark"]`, expostas ao Tailwind por `@theme inline`. Visual colorido estilo Monday (decisão do cliente): listas e etiquetas usam a paleta; raio, sombra, tipografia e valores finais vêm do design system (`docs/design/design-system.md` no ronin-web). Contraste AA obrigatório em todas as combinações `fg` sobre `bg`.
- Cor da lista: cabeçalho/faixa da coluna usa `--palette-<color>-*`. Seletor de cor no menu da lista (amostras com nome acessível, ex. "Azul"). A face do card mostra a marca de cor da lista atual; Meus cards mostra o nome da lista com a cor.
- Prioridade: selo na face do card com cor **e** texto ("Urgente", "Alta", "Média", "Baixa"); nada quando `null`. Seletor no detalhe. A cor nunca é a única pista de informação (RN17).
- Tema: slide (switch com `role="switch"`) no cabeçalho, persistido em `localStorage`, aplicado antes do primeiro paint por script inline **externo** (`/theme-init.js`, para respeitar a CSP).
- Filtro do quadro (C11) roda no cliente sobre o payload do quadro; estado na query string (`?responsavel=...&etiqueta=...&prioridade=urgent,high&prazo=overdue&q=...`; prioridade aceita também `none`) e indicador visível "Filtro ativo · Limpar".
- DnD: `@dnd-kit` com `PointerSensor` (ativação por distância 5px) e `KeyboardSensor`; no toque, DnD não é garantido. "Mover para…" em menu do card: seleciona quadro, lista e posição (1..n+1), converte em `placement`.
- Concluir/reabrir: após `complete`/`move`/`reopen` com `completionChange` não nulo, anunciar via `aria-live="polite"` ("Card concluído" / "Card reaberto").
- Responsivo básico: listas em rolagem horizontal com snap no mobile; detalhe do card em tela cheia abaixo de 640px.

## 10. Observabilidade e operação

- `GET /api/health` → `{ status: "ok", db: "ok" }` (faz `SELECT 1`; 503 se falhar).
- Logs JSON do pino para stdout (Docker coleta).
- Migrations: `drizzle-kit generate` gera SQL em `drizzle/` (commitado; revisar o SQL antes). Em produção, o container da API roda `node dist/migrate.js && node dist/server.js`.
- Deploy (ADR 0009): VPS Linux de entrada (1–2 vCPU, 2 GB RAM) com Docker Engine + Compose plugin. `infra/docker-compose.prod.yml` com `postgres`, `api`, `caddy`, `backup`. Domínio próprio, HTTPS automático (Let's Encrypt via Caddy), HTTP redireciona para HTTPS.
- Rede: só o Caddy publica portas (80/443). **O Postgres não tem `ports:`** (acessível só na rede interna do compose). Firewall do host (UFW) liberando apenas 22, 80 e 443; SSH só por chave. Documentar que o Docker ignora o UFW para portas publicadas, por isso o banco nunca publica porta.
- Reboot: serviço `docker` habilitado no systemd; todos os containers com `restart: unless-stopped`; `api` com `depends_on: { postgres: { condition: service_healthy } }`. Teste de aceite: `sudo reboot` e `/api/health` responde sem intervenção.
- Recursos: Postgres com `shared_buffers=256MB`, `max_connections=30`; pool `pg` da API com `max=10`; limites de memória por container no compose.
- Backup (ADR 0013): container `backup` com `pg_dump -Fc` diário às 03:00 (horário de São Paulo) e envio criptografado com **restic** para repositório **fora da VPS** (S3 compatível, Backblaze B2 ou SFTP, configurado por variáveis). Retenção: 7 diários, 4 semanais, 6 mensais. Falha é registrada no log do container e o comando `backup-check` retorna erro se o último sucesso tiver mais de 26 h. Restauração documentada (`restic restore` + `pg_restore`) e **testada** em ambiente limpo antes do go-live.

## 11. Estratégia de testes

| Camada | Ferramenta | O que cobre | Onde |
|--------|-----------|-------------|------|
| Domínio puro | Vitest | `getDueState` (limites 24h, sem hora, concluído), `nextPaletteColor`, ranking de prioridade, schemas Zod (normalização de e-mail, limites) | `packages/shared/src/**/*.test.ts` |
| API integração (principal) | Vitest + `app.inject()` + Postgres real (`kanban_test`) | Toda rota: sucesso, validação, 401, 403, CSRF, conflitos. Matriz de conclusão/reabertura (ADR 0010). Ordenação concorrente. Revogação de sessões. | `src/modules/**/*.test.ts` |
| Front componentes | Vitest + Testing Library + MSW | Face do card (estados de prazo com texto), filtro, rollback do movimento otimista, formulários com erros de validação, "Mover para…" por teclado | `src/**/*.test.tsx` (ronin-web) |
| E2E | Playwright (Chromium no CI; Firefox/WebKit localmente antes do release) | Fluxos críticos (lista em `plan.md` Fatia 10) | `e2e/` (ronin-web) |
| Acessibilidade | `@axe-core/playwright` | zero violações "serious/critical" nas telas principais nos dois temas | E2E |

Infra de teste da API:
- `vitest.config.ts` da API: `globalSetup` aplica migrations em `TEST_DATABASE_URL`; `fileParallelism: false`; `beforeEach` roda `TRUNCATE ... RESTART IDENTITY CASCADE` em todas as tabelas (exceto a de migrations).
- Argon2 nos testes: `lib/password.ts` aceita parâmetros reduzidos quando `NODE_ENV=test` (`memoryCost: 1024, timeCost: 1`) para velocidade. Produção nunca usa esse caminho.
- Helpers em `test/`: `createTestApp()`, `factories` (`createUser`, `createBoard`, `createCard`...), `loginAs(user)` → retorna headers com cookie + `Origin` + `X-Kanban-Csrf`.
- Relógio: serviços recebem `now` via `request.server.clock()` (decorator substituível nos testes) para testar prazos, expirações e limpeza.

CI (`.github/workflows/ci.yml`): job único em `ubuntu-latest` com serviço `postgres:18-alpine`; passos `pnpm install --frozen-lockfile` → `lint` → `typecheck` → `test` → `build` → `test:e2e` (sobe API + `vite preview` com proxy). Artefatos do Playwright em falha.

## 12. Requisitos não funcionais: como são atendidos

| Requisito (scope §7, v2) | Atendimento |
|----------------------|-------------|
| Hash forte | Argon2id (6.1) |
| Sessão expira e é invalidada | 6.2 |
| Limite de tentativas | 6.4 |
| Autorização no servidor com testes | 6.6 + 11 |
| XSS / CSRF / SQLi | 6.7, 6.3 |
| Tokens aleatórios, uso único, hash | 6.5 |
| HTTPS automático, HTTP → HTTPS | Caddy (10) |
| Banco não exposto; só portas necessárias | compose sem `ports` no Postgres + UFW (10) |
| Backup fora da VPS com restauração testada | restic (10, ADR 0013) |
| Volta após reboot | `restart: unless-stopped` + healthchecks (10) |
| VPS de entrada (2 GB) | processo único, pool pequeno, tuning do Postgres (10) |
| Dados mínimos, sem terceiros | 2, 6.7 (CSP `'self'`), fontes self-hosted |
| Anonimização de conta (LGPD) | 5.2 |
| Logs sem conteúdo | 6.7 |
| Quadro 500 cards ≤ 2 s | payload único do quadro com 5 consultas indexadas (api.md §9); sem N+1; gzip no Caddy |
| Mover otimista ≤ 500 ms | 7; lock só das listas envolvidas |
| Meus cards ≤ 1 s | uma consulta por `card_assignees(user_id)` + índices; ordenação por prazo e prioridade no SQL |
| Atualização sem tempo real | 7 |
| WCAG 2.2 AA, alternativa ao arrastar | 9 + axe no E2E |
| Instalação ≤ 30 min, migrations, backup, health | 10 + Fatia 10 |
