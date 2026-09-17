# Changelog

Todas as mudanças relevantes do Ronin ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). O projeto ainda não tem versão publicada: tudo abaixo está em "Unreleased" (não lançado) até o deploy da Fatia 10.

## [Unreleased]

Entrega das Fatias 0 a 9 do MVP, na branch `feat/mvp-fatias-2-9`. A Fatia 10 (produção em VPS, backup e revisão final) ainda está pendente: veja [`docs/ops/known-issues.md`](docs/ops/known-issues.md).

### Fatia 11: cards restritos e capa do card (backend)

- **Cards restritos** ([ADR 0015](docs/architecture/adr/0015-visibilidade-do-card-e-payload-bloqueado.md)): card com `visibility: 'team' | 'restricted'` e lista de acesso (`card_viewers`). Quem não tem acesso continua vendo o card no quadro **só com título e cadeado** (`LockedCard`) e recebe `403 CARD_RESTRICTED` em qualquer rota daquele card. Admin sempre vê tudo. A regra mora num arquivo só (`modules/cards/access.ts`) e entra dentro do `lockCard()`, que toda mutação de card, checklist, comentário, etiqueta e responsável já usava.
- Rotas novas: `PUT /api/cards/:cardId/visibility` e `PUT|DELETE /api/cards/:cardId/viewers/:userId`. Restringir inclui o ator e os responsáveis atuais; atribuir alguém a um card restrito dá acesso na mesma transação; tirar o acesso de um responsável é recusado (RN32); anonimizar uma conta a tira de todas as listas (RN38).
- "Meus cards" e as notificações (lista e contador de não lidas) **omitem** cards sem acesso, sem apagar nada: o acesso de volta traz a notificação de volta.
- **Capa do card** ([ADR 0016](docs/architecture/adr/0016-capas-no-cloudflare-r2-com-urls-assinadas.md)): imagem enviada do computador direto para o Cloudflare R2 (bucket privado) em três passos — `POST /api/cards/:cardId/cover/upload-url`, `PUT` no R2 e `PUT /api/cards/:cardId/cover`, que confere o objeto (`HEAD` + 16 primeiros bytes) antes de gravar. `DELETE /api/cards/:cardId/cover` remove imagem e linha. JPEG, PNG, WebP e AVIF, até 5 MB.
- Leitura por URL assinada de curta duração (10 a 15 min, arredondada em janelas de 5 min para o polling do quadro não invalidar o cache do navegador), gerada localmente: o payload do quadro continua em 6 consultas.
- Cliente do R2 próprio (`src/lib/r2.ts`, SigV4 com `node:crypto` e `fetch`), sem SDK e sem dependência nova. Recurso **opcional e tudo ou nada**: sem as variáveis `R2_*`, `features.cardCovers` é `false`, `cover` sai `null` e as rotas de capa respondem `503 COVER_STORAGE_UNAVAILABLE` — o resto do app não muda.
- Migration `0008_card_visibility_and_covers`: enum `card_visibility`, `cards.visibility` (todo card existente continua `team`), tabelas `card_viewers` e `card_covers` e cinco tipos novos de atividade.
- Respostas de setup, login, aceite de convite e `auth/me` passam a trazer `features`.

### Deploy no Render e Neon

- `render.yaml` (documental) do Web Service `ronin-api`: plano Free, região Virginia, Node 24, build com `pnpm build`, start com `pnpm start:prod` e health check em `/api/health`. Guia em [`docs/ops/deploy-render.md`](docs/ops/deploy-render.md): arquitetura com Static Site e rewrite de `/api/*`, Neon com `sslmode=require`, variáveis, primeiro acesso, limites do plano gratuito e a limitação do `TRUST_PROXY` atrás do proxy do Render.
- Setup inicial protegido por código: variável `SETUP_TOKEN` (16 a 200 caracteres), obrigatória com `NODE_ENV=production`. `GET /api/setup/status` informa `requiresSetupToken`; `POST /api/setup` aceita `setupToken` e, sem o código certo, responde `403 SETUP_TOKEN_INVALID` ("Código de configuração inválido."). Novo código de erro no `@raphasparda/ronin-shared` ([`api.md` §18.6](docs/architecture/api.md#186-código-de-configuração-do-setup-v110)).
- `TRUST_PROXY` aceita, além de `true`/`false`, número de saltos (ex.: `1`) e lista de IPs/CIDRs separados por vírgula.
- Migrations em produção sem `tsx`: o build gera `dist/migrate.js` (pasta `drizzle/` do diretório atual ou `MIGRATIONS_DIR`), e `pnpm start:prod` aplica as migrations antes de subir a API.

### Alterado

- Monorepo dividido em dois repositórios, com histórico preservado ([ADR 0014](docs/architecture/adr/0014-dois-repositorios-e-shared-publicado.md)): **ronin-api** (`raphasparda/Ronin-End`: API na raiz, `packages/shared`, banco local de dev, docs de produto, arquitetura e operação) e **ronin-web** (`raphasparda/Ronin-front`: SPA, E2E e docs de design).
- `@raphasparda/ronin-shared` 0.1.0 (antes `@kanban/shared`) publicável no GitHub Packages: build com tsup (ESM + `.d.ts`), `exports` com subpath `./test-fixtures`, workflow `publish-shared.yml` em tags `shared-v*`. Escopo igual ao dono dos repositórios no GitHub (`raphasparda`).
- `pnpm dev` deste repositório sobe só banco, migrations e API; o web roda com `pnpm dev` no ronin-web.
- CI da API sem o job de E2E (que passou para o ronin-web) e com verificação do conteúdo do tarball do shared.

### Adicionado

#### Base e ambiente de desenvolvimento

- Monorepo pnpm com `apps/api` (Fastify 5 + Drizzle + PostgreSQL 18), `apps/web` (React 19 + Vite + Tailwind 4) e `packages/shared` (contratos Zod e regras de domínio).
- `pnpm dev` sobe um PostgreSQL local do projeto (porta 5433, sem Docker e sem admin), aplica as migrations e sobe API (3000) e web (5310).
- Redirecionamento automático de `localhost:5310` para `127.0.0.1:5310` no servidor de desenvolvimento.
- Documentação OpenAPI em `/api/docs` (só fora de produção).
- Migrations versionadas em `drizzle/`.

#### Equipe e acesso

- Configuração inicial: a primeira conta cria a equipe e vira Admin.
- Login e logout com sessão em cookie `HttpOnly`, expiração ociosa e absoluta, e proteção CSRF.
- Senhas com Argon2id.
- Convites por link de uso único (7 dias), com e-mail opcional e papel.
- Redefinição de senha por link gerado pelo Admin (24 h), sem e-mail; encerra todas as sessões da pessoa.
- Administração de membros: mudar papel, desativar, reativar e gerar link de redefinição, com garantia de pelo menos um Admin ativo.
- Anonimização de conta desativada (LGPD), mantendo cards, comentários e histórico com "Usuário removido".
- Perfil (nome e senha) e ajustes da equipe (nome e fuso horário).

#### Quadros e listas

- Quadros com listas padrão "A fazer", "Fazendo" e "Concluído".
- Listas com cor da paleta fixa: criar, renomear, trocar cor, reordenar, arquivar e restaurar.
- Uma lista de conclusão por quadro.
- Arquivar e restaurar quadros; exclusão definitiva só pelo Admin, com confirmação pelo nome.

#### Cards

- Criação rápida no fim da lista.
- Arrastar e soltar entre listas e quadros, com atualização otimista e rollback em erro, e alternativa "Mover para…" pelo teclado.
- Detalhe do card com descrição em Markdown seguro (sem HTML cru, links com `noopener`).
- Concluir e reabrir pelo botão ou pela lista de conclusão, registrados no histórico.
- Arquivar e restaurar cards; exclusão definitiva só pelo Admin.
- Histórico de atividade imutável (criação, título, movimentação, responsáveis, prazo, prioridade, conclusão, arquivamento).

#### Campos, checklists e comentários

- Responsáveis, prazo (data e hora opcional, com estados "vencendo" e "atrasado"), prioridade (Baixa, Média, Alta, Urgente) e etiquetas por quadro.
- Filtro do quadro por responsável, etiqueta, prioridade, prazo e título, salvo na URL.
- Checklists com itens marcáveis e reordenáveis e progresso na face do card.
- Comentários em Markdown; o autor edita e exclui, o Admin exclui qualquer um.

#### Notificações e Meus cards

- Notificações no app para atribuição e comentário em card em que a pessoa é responsável, sem autonotificação, com contador, paginação e "marcar todas como lidas".
- Página "Meus cards" com os cards abertos atribuídos à pessoa, agrupados por estado do prazo e ordenados por prazo e prioridade.
- Limpeza periódica em produção de notificações lidas antigas, sessões expiradas, contadores de tentativa e tokens velhos.

#### Interface

- Tema claro (padrão) e escuro com as cores da logo, alternado no cabeçalho e aplicado sem piscar.
- Layout responsivo com navegação inferior no celular.

#### Testes e CI

- Testes de integração da API contra PostgreSQL real, testes de componentes com MSW e testes de domínio.
- E2E com Playwright e checagem de acessibilidade com axe, em banco isolado `kanban_e2e`, cobrindo os fluxos das Fatias 1 a 9 (inclusive dois usuários).
- Workflow do GitHub Actions com lint, typecheck, testes, build e E2E ([`docs/ops/ci.md`](docs/ops/ci.md)).

### Segurança

- Bloqueio de login sem condição de corrida: a tentativa é reservada de forma atômica no banco antes de verificar a senha. Uma rajada de 30 logins paralelos com senha errada faz no máximo 5 verificações. Vale também para a senha atual na troca de senha.
- Limites por rota: login com 30 requisições por minuto por IP e troca de senha com 10 a cada 15 minutos por usuário.
- Rebaixar, desativar ou anonimizar um Admin revoga, na mesma transação, os convites e links de redefinição pendentes criados por ele.
- Configuração fail-closed: a API não sobe com `NODE_ENV=production` e `APP_ORIGIN` em `http://`, nem com `APP_ORIGIN` em `https://` fora de produção.
- Logs sem dados sensíveis: erros de banco saem sem valores de parâmetros nem mensagens com e-mail ou hash; cookies, senhas e tokens são omitidos.
- Na interface: redirecionamento pós-login (`?next=`) aceita só caminhos internos.

### Corrigido

- Quadro sem estouro de largura no celular.
- Popovers ancorados à tela, sem fechar ao rolar.
- "Desfazer" em Meus cards devolve o card à posição original.
- Botão Fechar acessível e foco preso de forma robusta no detalhe do card.
- Aviso ao excluir comentário e "Mover para…" sem ids temporários.
- Rollback de movimento por card e atualização dos caches de usuários e de Meus cards.
- Textos da interface com linguagem neutra de gênero.

Detalhes técnicos das decisões: [`docs/architecture/api.md`](docs/architecture/api.md) §18.
