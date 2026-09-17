# Pacote `@raphasparda/ronin-shared` (GitHub Packages)

Contratos Zod e regras de domínio usados pela API (este repositório, `raphasparda/Ronin-End`) e pelo web (`raphasparda/Ronin-front`). Código em `packages/shared`.

## Como o pacote funciona

| Contexto                 | O que é lido                     | Como                                                                           |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------ |
| API (este repositório)   | fonte TS (`packages/shared/src`) | `"@raphasparda/ronin-shared": "workspace:*"`; o `tsup` da API embute no bundle |
| ronin-web local (padrão) | fonte TS, pela pasta irmã        | `"@raphasparda/ronin-shared": "link:../ronin-api/packages/shared"`             |
| ronin-web pelo registro  | `dist/` (ESM + `.d.ts`)          | `"@raphasparda/ronin-shared": "^0.1.0"` + `.npmrc` e token                     |

- `package.json` do shared: `exports` aponta para `src/` (`.` e `./test-fixtures`). Em `pnpm pack`/`pnpm publish`, o pnpm troca `exports` e `types` pelos de `publishConfig`, que apontam para `dist/`.
- `prepack` roda `tsup` (`packages/shared/tsup.config.ts`): gera `dist/index.js`, `dist/test-fixtures.js` e os `.d.ts`.
- `files: ["dist"]`: o tarball só leva `dist/`, `package.json` e `README.md`.
- `publishConfig.registry`: `https://npm.pkg.github.com`. Dependência de runtime: `zod` 4.
- Escopo: o GitHub Packages só aceita pacotes npm com escopo igual ao **dono** do repositório, em minúsculas. O dono é `raphasparda`, daí `@raphasparda/...`. O `.npmrc` dos dois repositórios já aponta o escopo para o registro (`@raphasparda:registry=https://npm.pkg.github.com`), sem token.

Build e conferência local:

```powershell
pnpm shared:build                                   # dist/ em packages/shared
pnpm shared:pack                                    # raphasparda-ronin-shared-0.1.0.tgz na raiz (ignorado pelo git)
tar -tzf raphasparda-ronin-shared-0.1.0.tgz         # deve listar só package/dist/*, package.json e README.md
```

## 1. Publicar uma versão

1. Ajuste `version` em `packages/shared/package.json` (semver: contrato quebrado = major; campo/rota nova = minor; correção = patch). Registre no `CHANGELOG.md`.
2. Commit e merge na `main`.
3. Crie e envie a tag **igual à versão**:

   ```powershell
   git tag shared-v0.1.0
   git push origin shared-v0.1.0
   ```

4. O workflow `publish-shared.yml` confere escopo e tag, roda os testes do shared e publica com o `GITHUB_TOKEN` (permissão `packages: write`; nenhum segredo a cadastrar). O pacote aparece em _Packages_ do perfil `raphasparda`, ligado ao repositório `Ronin-End`.

Também dá para rodar pelo botão _Run workflow_ (sem tag, publica a versão do `package.json`). Uma versão já publicada não pode ser sobrescrita: suba a versão.

Publicação manual (emergência), com um PAT clássico com `write:packages`, a partir da raiz deste repositório:

```powershell
$env:NODE_AUTH_TOKEN = '<PAT>'
pnpm --filter "./packages/shared" publish --no-git-checks
```

com um `.npmrc` **de usuário** (`~/.npmrc`, nunca no repositório) contendo `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`.

## 2. Consumir pelo registro no ronin-web

Por padrão o web usa `link:` (pasta irmã). Para usar a versão publicada (ex.: CI sem checkout da API, deploy do web isolado):

1. No `package.json` do ronin-web: `"@raphasparda/ronin-shared": "^0.1.0"`.
2. O `.npmrc` do ronin-web já tem `@raphasparda:registry=https://npm.pkg.github.com`.
3. Token (o GitHub Packages exige autenticação até para ler):
   - local: PAT clássico com `read:packages`; no `~/.npmrc` de usuário, `//npm.pkg.github.com/:_authToken=<PAT>` (ou `pnpm config set //npm.pkg.github.com/:_authToken <PAT>`). Nunca commite o token;
   - GitHub Actions: `actions/setup-node` com `registry-url: https://npm.pkg.github.com` e `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` + `permissions: packages: read` (o pacote é do mesmo dono). Se o pacote não estiver visível para o repositório, use um segredo com PAT `read:packages`.
4. `pnpm install` e commite o lockfile.

Com o pacote do registro, os tipos e o JS vêm de `dist/`; o `server.fs.allow` e o `dedupe` do `vite.config.ts` continuam inofensivos. Para voltar ao modo local, restaure `"link:../ronin-api/packages/shared"` e rode `pnpm install`.

## 3. Renomear o pacote (se o dono mudar)

Se os repositórios forem transferidos para outro dono (ex.: uma organização), o escopo precisa mudar junto. Com os dois repositórios lado a lado e a árvore limpa:

```powershell
cd ronin-api
node scripts/rename-shared-package.mjs @<novo-dono>/ronin-shared --web ../ronin-web --dry-run   # lista o que muda
node scripts/rename-shared-package.mjs @<novo-dono>/ronin-shared --web ../ronin-web
pnpm install
pnpm lint; pnpm typecheck; pnpm test; pnpm build
cd ../ronin-web
pnpm install
pnpm lint; pnpm typecheck; pnpm test; pnpm build
```

O script lê o nome atual em `packages/shared/package.json` e o troca (e `@<escopo-antigo>:registry` por `@<escopo-novo>:registry`) em todos os arquivos de texto versionados dos dois repositórios: `package.json`, `.npmrc`, imports, `tsup.config.ts` e `vite.config.ts`, READMEs e docs. Não mexe no lockfile (o `pnpm install` atualiza). Revise o `git diff` (textos como este, que citam o dono, precisam de revisão manual), publique a nova versão com o novo nome e commite nos dois repositórios.

## Riscos e custos

- GitHub Packages: gratuito para repositórios públicos; para privados, armazenamento e banda entram na cota da conta (o pacote tem ~15 KB compactado, custo desprezível).
- Pacote privado exige token até para leitura, inclusive no CI e no build do web.
- Mudança de contrato precisa de versão nova do shared antes de o web (modo registro) poder usá-la.
