# ADR 0014: Dois repositórios (ronin-api e ronin-web) e contratos publicados no GitHub Packages

- Status: aceito
- Data: 2026-09-17
- Substitui parcialmente: [ADR 0001](0001-monolito-modular-monorepo-pnpm.md) (só a parte do monorepo; a API continua um monólito modular)

## Contexto

O cliente decidiu separar o monorepo (`apps/api`, `apps/web`, `packages/shared`) em dois repositórios, para que API e web tenham ciclos de revisão, permissões e CI próprios. Os contratos Zod (`@raphasparda/ronin-shared`) continuam sendo a fonte da verdade entre os dois lados e não podem ser duplicados.

## Decisão

- **ronin-api** (workspace pnpm): API na raiz (`src`, `test`, `drizzle`), `packages/shared`, `scripts/` (PostgreSQL local de dev), `infra/`, docs de arquitetura, produto e operação. A API consome o shared pelo workspace (`workspace:*`), lendo a fonte TS; o `tsup` da API embute o shared no bundle.
- **ronin-web**: SPA na raiz (`src`, `public`, `e2e`) e docs de design.
- **`@raphasparda/ronin-shared`** vira pacote publicável no GitHub Packages, versão inicial `0.1.0`:
  - no repositório, `exports` aponta para `src/` (sem build no dia a dia);
  - `pnpm pack`/`publish` roda `tsup` (ESM + `.d.ts`) e troca `exports`/`types` pelos de `publishConfig` (apontando para `dist/`); `files: ["dist"]`;
  - subpath `@raphasparda/ronin-shared/test-fixtures` para os exemplos usados pelos handlers MSW do web;
  - publicação pelo workflow `publish-shared.yml` em tags `shared-v*`.
- **ronin-web consome o shared de dois jeitos**:
  - local (padrão): `"@raphasparda/ronin-shared": "link:../ronin-api/packages/shared"` (symlink para a fonte TS; mudanças no shared aparecem na hora no Vite, Vitest e `tsc`);
  - registro: `"@raphasparda/ronin-shared": "^0.1.0"` com `.npmrc` apontando o escopo para `https://npm.pkg.github.com` (`docs/ops/shared-package.md`).
- **E2E** fica no ronin-web e sobe a API do repositório irmão (`RONIN_API_DIR`, padrão `../ronin-api`): usa `scripts/dev-db/postgres.mjs` do ronin-api para o banco `kanban_e2e`, `pnpm run db:migrate` e `tsx src/server.ts`. Portas 3100 (API) e 5320 (web).

## Por que `link:` e não `file:`

`file:` copia o pacote respeitando `files` (só `dist/`), exigindo build e reinstalação a cada mudança, e coloca o código em `node_modules`, onde o Vitest não transforma TypeScript. `link:` cria um symlink para a pasta real: Vite, Vitest e `tsc` tratam o shared como código-fonte. Custos aceitos: o ronin-api precisa estar clonado ao lado e com `pnpm install` feito (o `zod` do shared vem de lá; o Vite usa `resolve.dedupe` para ter uma cópia só), e o `server.fs.allow` do Vite inclui a pasta real do shared.

## Consequências

- Mudança de contrato atravessa dois PRs (ronin-api e ronin-web). Para o web em produção/CI via registro, a ordem é: publicar nova versão do shared, depois atualizar a versão no web.
- O CI do ronin-web faz checkout do ronin-api (token de leitura se o repositório for privado).
- O pacote se chama `@raphasparda/ronin-shared`: o GitHub Packages exige escopo igual ao dono dos repositórios (`raphasparda/Ronin-End` e `raphasparda/Ronin-front`). Se o dono mudar, renomear com `scripts/rename-shared-package.mjs` e publicar de novo. Os pacotes privados `@kanban/api` e `@kanban/web` mantêm o nome antigo (nunca são publicados).
