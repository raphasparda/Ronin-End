# CI (GitHub Actions) do ronin-api

Workflows:

| Arquivo                                | Quando roda                                 | O que faz                                                                                         |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`             | todo `pull_request` e `push` na `main`      | lint, typecheck, testes (shared + API), build, verificação do pacote                              |
| `.github/workflows/publish-shared.yml` | tag `shared-v*` (ou manual, _Run workflow_) | publica `@raphasparda/ronin-shared` no GitHub Packages ([`shared-package.md`](shared-package.md)) |

Um push novo na mesma branch/PR cancela a execução anterior do CI (`concurrency`). No CI o `GITHUB_TOKEN` só tem `contents: read`; no publish, `contents: read` + `packages: write`.

Os E2E (Playwright) ficam no **ronin-web**: o CI de lá faz checkout deste repositório e sobe esta API (veja `docs/ops/ci.md` do ronin-web).

## Job `checks`

checkout → pnpm (versão do `packageManager`) → Node do `.nvmrc` com cache do store → cria `kanban_test` → `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` (API + shared) → `pnpm test` (shared com cobertura, depois API) → `pnpm build` (`dist/` do shared + `dist/server.js` e `dist/migrate.js`) → `pnpm pack` do shared e checagem do conteúdo do tarball (tem `dist/index.js` e `dist/index.d.ts`; não tem `src/` nem testes). Tempo esperado: ~5 min.

O job tem seu próprio serviço `postgres:18-alpine` (usuário/senha/banco `kanban`, porta 5432 do runner, healthcheck `pg_isready`). Os steps só começam depois que o serviço fica saudável.

Para bloquear merge: em _Settings → Branches → Branch protection rules_ (ou _Rulesets_) da `main`, exigir o check **Lint, typecheck, testes e build**.

## Banco no CI

O CI **nunca** sobe o PostgreSQL embutido (`embedded-postgres`, usado no dev local). Motivos: o serviço do GitHub já é um Postgres 18 real, e o binário do `postgres` se recusa a rodar como root no Linux.

Isso é garantido pela variável `DEV_DB_EXTERNAL_ONLY=true`, lida por `scripts/dev-db/postgres.mjs` (usado pelo globalSetup do Vitest da API e pelo `e2e/run.mjs` do ronin-web):

- banco respondendo: reaproveita (tipo `external`), cria os bancos que faltarem e aplica as migrations;
- banco fora do ar: falha na hora com `PostgreSQL em 127.0.0.1:5432 não responde (DEV_DB_EXTERNAL_ONLY=true ...)`, sem procurar binários nem tentar `initdb`/`pg_ctl`.

Sem a variável (dev local), o comportamento é o de sempre ([`setup-local.md`](setup-local.md)).

## Variáveis de ambiente (nível do workflow)

| Variável               | Valor no CI                                           | Quem usa                                             |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `DEV_DB_EXTERNAL_ONLY` | `true`                                                | `scripts/dev-db/postgres.mjs`                        |
| `DATABASE_URL`         | `postgres://kanban:kanban@127.0.0.1:5432/kanban`      | validação de env da API                              |
| `TEST_DATABASE_URL`    | `postgres://kanban:kanban@127.0.0.1:5432/kanban_test` | Vitest da API (sem ela, testes de banco são pulados) |
| `APP_ORIGIN`           | `http://127.0.0.1:5310`                               | validação de env da API                              |
| `LOG_LEVEL`            | `warn`                                                | API                                                  |

Não há segredos no CI: as credenciais acima são de um banco descartável que só existe durante o job. Nada de `NODE_ENV` global.

O banco `kanban_test` é criado explicitamente por `docker exec <serviço> psql` (o `postgres.mjs` também o criaria, mas assim uma falha de permissão aparece num step próprio).

## Reproduzir localmente (Windows)

Não é preciso Docker. Para rodar os mesmos passos contra o banco local de dev:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test          # sobe/reaproveita o Postgres local (5433) e usa kanban_test
pnpm build
pnpm shared:pack   # gera raphasparda-ronin-shared-<versão>.tgz na raiz (ignorado pelo git); confira com tar -tzf
```

Para simular o modo do CI contra um Postgres já rodando (Docker na 5432, por exemplo), defina as variáveis da tabela na sessão (`$env:DEV_DB_EXTERNAL_ONLY='true'`, `$env:TEST_DATABASE_URL='postgres://kanban:kanban@127.0.0.1:5432/kanban_test'` etc.).

Validar o YAML sem push: baixe o [actionlint](https://github.com/rhysd/actionlint/releases) (zip `windows_amd64`, sem instalação) e rode `actionlint .github/workflows/ci.yml .github/workflows/publish-shared.yml`.

## Falhas comuns

- **`ERR_PNPM_OUTDATED_LOCKFILE`**: `package.json` mudou sem atualizar o `pnpm-lock.yaml`. Rode `pnpm install` localmente e commite o lockfile.
- **`não responde (DEV_DB_EXTERNAL_ONLY=true ...)`**: o serviço Postgres não subiu; veja o log do step "Initialize containers".
- **"O tarball do shared contém fonte ou testes"**: alguém mexeu em `files` ou `publishConfig` de `packages/shared/package.json`.
- **Publish: "Escopo diferente do dono"**: o repositório mudou de dono e o pacote não foi renomeado; veja [`shared-package.md`](shared-package.md#3-renomear-o-pacote-se-o-dono-mudar).
- **Versão do pnpm/Node**: vêm de `packageManager` (package.json) e `.nvmrc`. Mude lá, nunca no workflow.
