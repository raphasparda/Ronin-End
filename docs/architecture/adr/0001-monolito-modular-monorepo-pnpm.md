# ADR 0001: Monólito modular em monorepo pnpm

- Status: aceito
- Data: 2026-09-16

## Contexto
MVP para uma equipe de até ~20 pessoas, autohospedado, com backend e auth próprios (sem BaaS). Front e back precisam compartilhar contratos. O ambiente de desenvolvimento do cliente é Windows.

## Decisão
- Monorepo pnpm workspaces: `apps/api` (Fastify), `apps/web` (React + Vite SPA), `packages/shared` (schemas Zod, códigos de erro, regras puras).

> Atualização (2026-09-17): o monorepo foi dividido em dois repositórios (`ronin-api` e `ronin-web`), mantendo o monólito modular na API. Ver [ADR 0014](0014-dois-repositorios-e-shared-publicado.md).
- A API é um monólito modular em **um único processo**, com módulos por contexto (`auth`, `boards`, `cards`, `completion`...). Módulos só se comunicam pelos `service.ts` exportados.
- `@raphasparda/ronin-shared` é consumido como fonte TypeScript (sem etapa de build); a API é empacotada com `tsup` incluindo o shared.
- SPA (Vite) em vez de Next.js: app 100% autenticado, sem necessidade de SSR/SEO, e servir estático simplifica o deploy.

## Alternativas
- Microsserviços ou API + worker separados: complexidade operacional sem ganho no porte atual.
- Next.js (full-stack): acopla front e API e dificulta manter Fastify como backend único; SSR não agrega.
- Repositórios separados: contratos divergiriam.

## Consequências
- Um deploy, um processo de API, um banco. Jobs de manutenção rodam por `setInterval` e rate limit fica em memória.
- Se houver mais de uma réplica da API no futuro, será preciso mover rate limit e jobs para o banco ou para um agendador (novo ADR).
