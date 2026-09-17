# @raphasparda/ronin-shared

Contratos da API do Ronin (schemas Zod de requisição e resposta, códigos de erro) e regras de domínio puras (prazo, prioridade, paleta, ordenação, conclusão, filtro do quadro, Meus cards, progresso de checklist). Usado pela API (este repositório, via workspace) e pelo web (repositório `ronin-web`).

## Entradas

| Import                                    | Conteúdo                                                     |
| ----------------------------------------- | ------------------------------------------------------------ |
| `@raphasparda/ronin-shared`               | schemas, tipos inferidos, erros e regras de domínio          |
| `@raphasparda/ronin-shared/test-fixtures` | exemplos válidos de respostas, só para testes e handlers MSW |

## Como é empacotado

- Neste repositório, `exports` aponta para a fonte TypeScript (`src/`). A API, o Vitest, o `tsc` e o web ligado por `link:` leem a fonte direto, sem build.
- `pnpm pack` / `pnpm publish` rodam o `prepack` (tsup: ESM + `.d.ts` em `dist/`) e trocam `exports`/`types` pelos de `publishConfig`, que apontam para `dist/`. O tarball só contém `dist/`, `package.json` e este README.
- Registro: GitHub Packages (`publishConfig.registry`). Dependência de runtime: `zod` 4.

## Instalação (GitHub Packages)

O escopo é o dono dos repositórios no GitHub (`raphasparda`), exigência do GitHub Packages. Para instalar fora do workspace:

```ini
# .npmrc do projeto
@raphasparda:registry=https://npm.pkg.github.com
# ~/.npmrc do usuário (nunca commitar): token com read:packages
//npm.pkg.github.com/:_authToken=<PAT>
```

```powershell
pnpm add @raphasparda/ronin-shared
```

Publicação e renomeação: `docs/ops/shared-package.md` do ronin-api (`raphasparda/Ronin-End`).
