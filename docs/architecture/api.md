# Kanban: contrato da API REST (MVP)

> Status: v1.14 (2026-09-17; v1.2 alinhou ao `scope.md` v2: sem gamificação, cor por lista, prioridade do card, reabrir para o topo; v1.3 adicionou `415 UNSUPPORTED_MEDIA_TYPE`; v1.4 (2026-09-17) fechou ambiguidades ao implementar os schemas das Fatias 2 a 9, ver §18; v1.5 registrou decisões do backend das Fatias 2 e 3, §18.1; v1.6 registrou decisões do backend da Fatia 4, §18.2; v1.7 registrou decisões do backend das Fatias 5 e 6, §18.3; v1.8 registrou decisões do backend das Fatias 7, 8 e 9, §18.4; v1.9 registrou as correções da revisão de segurança, §18.5; v1.10 (2026-09-17) adicionou o código de configuração do setup, `requiresSetupToken` e `403 SETUP_TOKEN_INVALID`, §18.6; v1.11 (2026-09-17) abriu a Fatia 11: visibilidade do card com payload bloqueado e capa de imagem no Cloudflare R2, §18.7; v1.12 (2026-09-17) registrou as decisões do backend da Fatia 11, §18.8; **v1.13 (2026-09-17) moveu a restrição e a capa da Fatia 11 do card para o QUADRO, a pedido do cliente: §2, §3, §9, §11, §15, §16 e §18.9 — §18.7 e §18.8 ficam como histórico**; v1.14 acrescentou a foto de perfil, §6, §7 e §18.10). Complementa `overview.md`. Os schemas Zod em `packages/shared/src/schemas/` são a fonte da verdade em código e devem refletir exatamente este documento. Mudança de contrato = atualizar este arquivo no mesmo PR.

## 1. Convenções

- Base: `/api`. JSON UTF-8. Campos em `camelCase`.
- IDs: UUID (string). Parâmetro de rota com UUID inválido → `400 VALIDATION_ERROR`.
- Datas: ISO 8601 UTC (`2026-09-16T14:03:00.000Z`). Exceção: entrada de prazo (`DueInput`) em data/hora local do workspace.
- Strings de entrada passam por `trim()`; limites de tamanho valem após o trim.
- Autenticação: cookie de sessão (ver `overview.md` §6). Toda rota exige sessão, salvo as marcadas **Pública**.
- Métodos mutáveis (`POST`, `PATCH`, `PUT`, `DELETE`) exigem `Origin` igual a `APP_ORIGIN` e header `X-Kanban-Csrf: 1`; senão `403 CSRF_REJECTED`.
- Sucesso sem corpo: `204`. Criação: `201` com o recurso.
- Ações idempotentes de "estado" usam `PUT`/`DELETE` em sub-recursos (responsáveis, etiquetas) e `POST /.../archive|restore|complete|reopen`, que retornam `200` mesmo se já estiverem no estado pedido.
- Sem paginação no MVP, exceto notificações (§15). Limites de porte: `overview.md` / scope §0.
- Respostas são serializadas pelo schema declarado: campos não declarados são descartados (proteção contra vazamento).

Legenda de permissão: **Pública** · **Auth** (qualquer usuário ativo) · **Admin** · **Autor**.

## 2. Tipos compartilhados

```ts
type Uuid = string;
type IsoDateTime = string;

type Role = 'admin' | 'member';
type UserStatus = 'active' | 'deactivated';
type CardStatus = 'open' | 'completed';
// Chaves da paleta (valores visuais nos tokens CSS). Usada por listas e etiquetas.
type PaletteColor = 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'magenta';
type CardPriority = 'low' | 'medium' | 'high' | 'urgent';   // cores fixas no front (RN16)
// Fatia 11: 'team' = todo usuário ativo vê (padrão, RN05); 'restricted' = só Admins e a lista de
// pessoas com acesso (`viewerIds`) do **quadro**. ADR 0015.
type BoardVisibility = 'team' | 'restricted';

// Posição relativa entre irmãos ativos (não arquivados) do destino.
type Placement =
  | { type: 'start' }
  | { type: 'end' }
  | { type: 'after'; id: Uuid };   // id de um irmão ativo no destino, diferente do próprio item

// Prazo na entrada, no fuso do workspace
type DueInput = { date: string /* YYYY-MM-DD */; time: string | null /* HH:mm 24h */ };

// `avatarUpdatedAt`: quando a foto foi enviada, ou null sem foto. Versiona a URL do avatar (§7).
type SessionUser = { id: Uuid; name: string; email: string; role: Role; avatarUpdatedAt: IsoDateTime | null };
type Workspace = { name: string; timezone: string };

// Recursos ligados nesta instância (dependem de configuração, não de papel). Fatia 11.
// `boardCovers` é false quando a instância não tem R2 configurado (ADR 0016).
type Features = { boardCovers: boolean };

// Visão pública de usuário (listas, avatares, atribuição). Sem e-mail.
type UserSummary = { id: Uuid; name: string; role: Role; status: UserStatus; anonymized: boolean; avatarUpdatedAt: IsoDateTime | null };

// Capa do quadro (Fatia 11, ADR 0016). `url` é assinada e de curta duração (validade entre 10 e
// 15 min, ver §18.7 item 55). `width`/`height` são os do arquivo enviado, informados pelo cliente,
// e servem só para reservar o espaço na tela.
type BoardCover = { url: string; width: number | null; height: number | null; expiresAt: IsoDateTime };

// Quadro que a pessoa pode abrir.
type Board = {
  locked: false;
  id: Uuid; name: string;
  visibility: BoardVisibility;
  cover: BoardCover | null;                    // null sem capa ou com R2 desligado
  archivedAt: IsoDateTime | null; createdAt: IsoDateTime; updatedAt: IsoDateTime;
};

// Quadro restrito visto por quem não tem acesso (ADR 0015). São **todos** os campos: nada de
// capa, visibilidade, datas ou contadores.
type LockedBoard = { id: Uuid; name: string; locked: true };

// Item de `GET /api/boards`: união discriminada por `locked`.
type BoardListItem = Board | LockedBoard;

// Quadro aberto com a lista de acesso (ordem de inclusão; vazia quando visibility = 'team').
type BoardDetail = Board & { viewerIds: Uuid[] };

type List = { id: Uuid; boardId: Uuid; name: string; position: string; isDoneList: boolean; color: PaletteColor; archivedAt: IsoDateTime | null };

type Label = { id: Uuid; boardId: Uuid; name: string; color: PaletteColor };

// Face do card (payload do quadro). O acesso é decidido no quadro (ADR 0015): quem lê o payload
// enxerga todos os cards dele.
type CardSummary = {
  id: Uuid; boardId: Uuid; listId: Uuid;
  title: string; position: string;
  status: CardStatus; completedAt: IsoDateTime | null;
  dueAt: IsoDateTime | null; dueHasTime: boolean;
  priority: CardPriority | null;
  labelIds: Uuid[]; assigneeIds: Uuid[];
  checklist: { done: number; total: number };  // soma de todos os checklists
  commentCount: number;
  hasDescription: boolean;
  archivedAt: IsoDateTime | null;
};

type ChecklistItem = { id: Uuid; checklistId: Uuid; text: string; position: string; isChecked: boolean; checkedBy: Uuid | null; checkedAt: IsoDateTime | null };
type Checklist = { id: Uuid; cardId: Uuid; title: string; createdAt: IsoDateTime; items: ChecklistItem[] /* ordenados por position */ };

type Comment = { id: Uuid; cardId: Uuid; authorId: Uuid; body: string; editedAt: IsoDateTime | null; createdAt: IsoDateTime };

type CardDetail = CardSummary & {
  description: string;
  completedBy: Uuid | null;
  createdBy: Uuid; createdAt: IsoDateTime; updatedAt: IsoDateTime;
  board: { id: Uuid; name: string; archived: boolean };
  list: { id: Uuid; name: string; color: PaletteColor; isDoneList: boolean; archived: boolean };
  checklists: Checklist[];      // ordem de criação
  comments: Comment[];          // ordem cronológica crescente
};

// União discriminada por `type`: cada tipo tem seu formato de `data` (overview.md §5.3).
type Activity = { id: Uuid; cardId: Uuid; actorId: Uuid; type: ActivityType; data: ActivityData[type]; createdAt: IsoDateTime };
// card_due_changed.data.hasTime = dueHasTime do novo prazo (false quando `to` é null)

// Resultado de mutações que podem concluir/reabrir
type CardMutationResult = {
  card: CardSummary;
  completionChange: 'completed' | 'reopened' | null;
  removedLabelIds: Uuid[];      // só em move entre quadros; [] caso contrário
};
```

Limites de entrada (Zod):

| Campo | Regra |
|-------|-------|
| `email` | e-mail válido, ≤ 254, normalizado `trim().toLowerCase()` |
| `password` / `newPassword` | 10–256 caracteres (sem trim) |
| `user.name` | 1–80 |
| `workspace.name`, `board.name`, `list.name` | 1–100 |
| `workspace.timezone` | presente em `Intl.supportedValuesOf('timeZone')` |
| `card.title` | 1–500, sem quebras de linha (substituídas por espaço) |
| `card.description` | 0–20.000 |
| `label.name` | 1–50 |
| `checklist.title` | 1–200 |
| `checklistItem.text` | 1–500 |
| `comment.body` | 1–10.000 |
| `token` | 43 caracteres base64url |
| `cover.contentType` | um de `image/jpeg`, `image/png`, `image/webp`, `image/avif` |
| `cover.sizeBytes` | inteiro de 1 a 5.242.880 (5 MiB) |
| `cover.objectKey` | `covers/<boardId>/<32 caracteres base64url>`, com o `boardId` da própria rota |
| `cover.width` / `cover.height` | inteiro de 1 a 20.000, ou ausente |

## 3. Erros

Envelope: `{ "error": { "code": ErrorCode, "message": string, "details"?: { path: string, message: string }[] } }`.

| HTTP | code | Quando |
|------|------|--------|
| 400 | `VALIDATION_ERROR` | corpo, query ou parâmetro inválido (com `details`) |
| 400 | `CONFIRMATION_MISMATCH` | nome digitado não confere ao excluir quadro |
| 400 | `PASSWORD_INCORRECT` | senha atual errada na troca de senha |
| 401 | `UNAUTHENTICATED` | sem sessão válida |
| 401 | `INVALID_CREDENTIALS` | login falhou (mensagem genérica: "E-mail ou senha incorretos.") |
| 403 | `FORBIDDEN` | papel/autoria insuficiente |
| 403 | `CSRF_REJECTED` | Origin/header CSRF ausente ou inválido |
| 403 | `BOARD_RESTRICTED` | quadro `restricted` e o usuário não é Admin nem está na lista de acesso (mensagem: "Você não tem acesso a este quadro.") |
| 403 | `SETUP_TOKEN_INVALID` | setup com `SETUP_TOKEN` configurado e `setupToken` ausente ou errado (mensagem: "Código de configuração inválido.") |
| 404 | `NOT_FOUND` | recurso inexistente (ou notificação de outro usuário) |
| 404 | `SETUP_REQUIRED` | rota que exige instância configurada chamada antes do setup (login) |
| 409 | `SETUP_ALREADY_DONE` | setup com usuários existentes |
| 409 | `EMAIL_TAKEN` | e-mail já cadastrado |
| 409 | `INVITE_EMAIL_MISMATCH` | convite com e-mail fixo e e-mail diferente no aceite |
| 409 | `LAST_ADMIN` | rebaixar/desativar o último Admin ativo |
| 409 | `CANNOT_TARGET_SELF` | Admin desativando/anonimizando/rebaixando a si mesmo |
| 409 | `USER_NOT_DEACTIVATED` | anonimizar usuário ativo |
| 409 | `USER_ANONYMIZED` | reativar, gerar reset ou mudar papel de anonimizado |
| 409 | `USER_NOT_ACTIVE` | atribuir usuário desativado; gerar link de redefinição para usuário desativado (não anonimizado) |
| 409 | `BOARD_ARCHIVED` | mutação de conteúdo em quadro arquivado |
| 409 | `LIST_ARCHIVED` | criar/mover card para lista arquivada; restaurar card de lista arquivada |
| 409 | `LIST_IS_DONE_LIST` | criar card direto na lista de conclusão |
| 409 | `INVALID_PLACEMENT` | `placement.after.id` não é irmão ativo no destino (ou é o próprio item) |
| 409 | `LABEL_BOARD_MISMATCH` | aplicar etiqueta de outro quadro |
| 409 | `BOARD_NOT_RESTRICTED` | mexer na lista de acesso de um quadro com `visibility: 'team'` |
| 409 | `COVER_UPLOAD_INVALID` | confirmação de capa cujo objeto não existe no R2, está acima do limite, tem outro `Content-Type` ou não começa com a assinatura de uma imagem aceita |
| 409 | `CONFLICT` | violação de unicidade não mapeada |
| 410 | `TOKEN_INVALID` | token de convite/reset inexistente, expirado, usado ou revogado (mensagem: "Convite inválido." / "Link de redefinição inválido.") |
| 413 | `PAYLOAD_TOO_LARGE` | corpo > 256 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | corpo com `Content-Type` diferente de `application/json` (inclui `text/plain`) |
| 429 | `TOO_MANY_ATTEMPTS` | bloqueio de login (header `Retry-After` em segundos) |
| 429 | `RATE_LIMITED` | rate limit geral/rotas de token (`Retry-After`) |
| 500 | `INTERNAL_ERROR` | inesperado |
| 503 | `SERVICE_UNAVAILABLE` | health com banco fora |
| 503 | `COVER_STORAGE_UNAVAILABLE` | rota de capa com R2 não configurado ou fora do ar (mensagem: "As capas de quadro não estão disponíveis agora.") |

Regras transversais aplicadas por todas as rotas de conteúdo:
- Recurso de quadro arquivado: leitura ok; mutação → `409 BOARD_ARCHIVED` (exceto `restore` e `DELETE` do quadro).
- Ordem de checagem: autenticação (401) → CSRF (403) → validação (400) → existência (404) → permissão (403) → estado (409). Em toda rota de quadro, lista, card, comentário, checklist, etiqueta e responsável, `403 BOARD_RESTRICTED` (acesso ao quadro) vem antes de `403 FORBIDDEN` (papel) e de qualquer 409.

## 4. Saúde e setup

### `GET /api/health` · Pública
200 `{ status: 'ok', db: 'ok' }` · 503 `SERVICE_UNAVAILABLE`.

### `GET /api/setup/status` · Pública
200 `{ needsSetup: boolean, requiresSetupToken: boolean }`. `needsSetup`: true se não há usuários. `requiresSetupToken`: true se a instância tem `SETUP_TOKEN` configurado (sempre em produção); a tela de setup então pede o código de configuração.

### `POST /api/setup` · Pública · rate limit 5/15min/IP
Body `{ workspaceName: string, timezone?: string /* default America/Sao_Paulo */, name: string, email: string, password: string, setupToken?: string /* até 200 caracteres */ }`
- Com `SETUP_TOKEN` configurado: `setupToken` ausente ou diferente → `403 SETUP_TOKEN_INVALID`, checado antes de consultar o banco e de gerar o hash da senha (comparação em tempo constante). Sem `SETUP_TOKEN` (desenvolvimento local), o campo é ignorado. Tentativas erradas contam no rate limit da rota.
- Transação com `pg_advisory_xact_lock`; se já há usuário → `409 SETUP_ALREADY_DONE`.
- Cria/atualiza `workspace`, cria usuário `admin`, cria sessão (Set-Cookie).
201 `{ user: SessionUser, workspace: Workspace, features: Features }`.

## 5. Autenticação

### `POST /api/auth/login` · Pública
Body `{ email, password }` (password aqui: 1–256, para não revelar política).
- Bloqueios: `overview.md` §6.4. Sem usuários → `404 SETUP_REQUIRED`.
- Falha (e-mail inexistente, senha errada, usuário desativado/anonimizado) → `401 INVALID_CREDENTIALS`.
200 `{ user: SessionUser, workspace: Workspace, features: Features }` + Set-Cookie.

### `POST /api/auth/logout` · Auth
Apaga a sessão atual e o cookie. 204. Sem sessão também retorna 204 (idempotente; CSRF ainda exigido).

### `GET /api/auth/me` · Auth
200 `{ user: SessionUser, workspace: Workspace, features: Features }`.

### `POST /api/auth/invites/lookup` · Pública · rate limit 10/15min/IP
Body `{ token }`. 200 `{ email: string | null, role: Role, expiresAt }` · 410 `TOKEN_INVALID`.

### `POST /api/auth/invites/accept` · Pública · rate limit 10/15min/IP
Body `{ token, name, email, password }`
- Consome o token na mesma transação da criação do usuário (papel do convite).
- Convite com e-mail e e-mail diferente → `409 INVITE_EMAIL_MISMATCH`. E-mail já existe → `409 EMAIL_TAKEN` (token **não** é consumido).
201 `{ user: SessionUser, workspace: Workspace, features: Features }` + Set-Cookie.

### `POST /api/auth/password-resets/lookup` · Pública · rate limit 10/15min/IP
Body `{ token }`. 200 `{ userName: string, expiresAt }` · 410 `TOKEN_INVALID` (também se o usuário alvo não está ativo).

### `POST /api/auth/password-resets/complete` · Pública · rate limit 10/15min/IP
Body `{ token, password }`
- Senha igual ao e-mail do usuário alvo → `400 VALIDATION_ERROR` com `details[].path = 'password'` (checagem no servidor, pois o e-mail não vem no corpo).
- Consome o token, grava hash, `password_changed_at = now()`, apaga **todas** as sessões do usuário. Não cria sessão.
204 · 410 `TOKEN_INVALID`.

## 6. Eu (usuário da sessão)

### `PATCH /api/me` · Auth
Body `{ name }`. 200 `{ user: SessionUser }`.

### `POST /api/me/password` · Auth
Body `{ currentPassword, newPassword }`. `currentPassword` segue a regra do login (1–256); `newPassword` segue a política de cadastro e não pode ser igual ao e-mail da sessão (`400 VALIDATION_ERROR` em `newPassword`, checagem no servidor).
- Senha atual errada → `400 PASSWORD_INCORRECT` (conta para o throttle por e-mail).
- Grava hash; apaga todas as sessões do usuário **exceto a atual**.
204.

### `PUT /api/me/avatar` · Auth
Body `{ contentType: 'image/webp' | 'image/jpeg' | 'image/png'; data: string /* base64 */ }`. A imagem vai **em JSON** porque a API não aceita outro `Content-Type` (overview §6.3); o front recorta um quadrado de 256 px e comprime antes de enviar.
- Máximo 128 KB **depois** de decodificar (`AVATAR_MAX_BYTES`); acima disso, `400 VALIDATION_ERROR` em `data`.
- Os primeiros bytes têm que casar com o `contentType` (assinatura do arquivo) → senão `400 VALIDATION_ERROR` em `data`.
- Substitui a foto anterior (uma por usuário) e atualiza `avatarUpdatedAt`.
200 `{ user: SessionUser }`.

### `DELETE /api/me/avatar` · Auth
Apaga a foto e zera `avatarUpdatedAt`. Idempotente (sem foto também responde 204).
204.

### `GET /api/me/cards` · Auth
Cards `open`, não arquivados, em lista e quadro não arquivados, com o usuário entre os responsáveis **e em quadro acessível a ele** (card de quadro restrito sem acesso é omitido, não bloqueado: ADR 0015). Ordenados por `dueAt ASC NULLS LAST`, depois prioridade (`urgent`, `high`, `medium`, `low`, sem prioridade), depois `createdAt ASC`. O agrupamento (Atrasados/Vencendo/Com prazo/Sem prazo) é feito no front com `getDueState`, preservando essa ordem dentro de cada grupo (D1).
200 `{ cards: Array<CardSummary & { boardName: string; listName: string; listColor: PaletteColor }> }`.

## 7. Usuários

### `GET /api/users` · Auth
Todos os usuários (ativos, desativados e anonimizados), ordenados por nome. Usado para nomes/iniciais e seletor de responsáveis (a UI só oferece `status = 'active'`).
200 `{ users: UserSummary[] }`. **Sem e-mail.**

### `GET /api/users/:userId/avatar` · Auth
Foto de perfil de qualquer usuário: é o `src` do avatar na interface. Resposta **binária** (`Content-Type` do arquivo), com `ETag` e `Cache-Control: private, max-age=86400` — a única rota sem `no-store`, porque a interface versiona a URL com `?v=<avatarUpdatedAt>` e uma foto nova muda a URL. `If-None-Match` igual → 304.
200 (imagem) · 304 · 404 `NOT_FOUND` (usuário sem foto ou inexistente).

## 8. Administração (tudo **Admin**)

### `GET /api/admin/users`
200 `{ users: Array<UserSummary & { email: string | null; createdAt: IsoDateTime }> }`.

### `PATCH /api/admin/users/:userId`
Body `{ role: Role }`. Rebaixar o último admin ativo → `409 LAST_ADMIN`; a si mesmo → `409 CANNOT_TARGET_SELF`; anonimizado → `409 USER_ANONYMIZED`.
200 `{ user: UserSummary & { email; createdAt } }`.

### `POST /api/admin/users/:userId/deactivate`
Não pode a si mesmo (`CANNOT_TARGET_SELF`) nem o último admin ativo (`LAST_ADMIN`). Apaga sessões e revoga resets pendentes. Idempotente. 200 `{ user }`.

### `POST /api/admin/users/:userId/reactivate`
Anonimizado → `409 USER_ANONYMIZED`. Idempotente. 200 `{ user }`.

### `POST /api/admin/users/:userId/anonymize`
Body `{ confirm: true }`. Exige desativado (`409 USER_NOT_DEACTIVATED`); não a si mesmo. Efeitos: `overview.md` §5.2. 200 `{ user }`.

### `POST /api/admin/users/:userId/password-reset-links`
Anonimizado → `409 USER_ANONYMIZED` (checado primeiro); desativado → `409 USER_NOT_ACTIVE`. Revoga resets pendentes do alvo e cria novo (24h).
201 `{ url: string, expiresAt: IsoDateTime }` — URL `APP_ORIGIN/redefinir-senha#token=...`, exibida uma única vez.

### `GET /api/admin/invites`
200 `{ invites: Array<{ id; email: string | null; role: Role; createdBy: Uuid; createdAt; expiresAt; state: 'pending' | 'used' | 'expired' | 'revoked'; usedByUserId: Uuid | null }> }`, mais recentes primeiro, últimos 30 dias + pendentes.

### `POST /api/admin/invites`
Body `{ email?: string | null, role: Role }` (ausente = `null`; string vazia é e-mail inválido, o formulário envia `null`). Se `email` já pertence a um usuário → `409 EMAIL_TAKEN`.
201 `{ invite: <mesmo item acima>, url: string }` — URL `APP_ORIGIN/convite#token=...`, exibida uma única vez.

### `DELETE /api/admin/invites/:inviteId`
Revoga (se pendente). Idempotente. 204.

### `PATCH /api/admin/workspace`
Body `{ name?, timezone? }` (ao menos um). 200 `{ workspace: Workspace }`.

## 9. Quadros

> **Acesso ao quadro (Fatia 11, ADR 0015).** `boards.visibility` é `team` (padrão, RN05) ou
> `restricted`. Tem acesso a um quadro `restricted` quem está em `viewerIds` **mais todo Admin**.
> Quem não tem acesso vê o quadro na listagem como `LockedBoard` (id, nome e cadeado) e recebe
> `403 BOARD_RESTRICTED` em **toda** rota do quadro, das listas dele, dos cards dele e do conteúdo
> dos cards (comentários, checklists, etiquetas, responsáveis, atividade). A checagem é uma função
> só (`modules/boards/access.ts`), chamada de dentro do `lockBoard()`/`lockCard()` que todas as
> mutações já usam.

### `GET /api/boards?archived=false|true` · Auth
Padrão `archived=false`; só os valores `true` e `false` são aceitos (outro → 400). Ordem: `name ASC` (collation pt-BR no JS: o front pode reordenar com `localeCompare('pt-BR')`).
200 `{ boards: BoardListItem[] }` — quadro restrito sem acesso entra como `LockedBoard` (`{ id, name, locked: true }`), na mesma ordem por nome. Nada além disso: sem capa, visibilidade, datas ou contadores.

### `POST /api/boards` · Auth
Body `{ name }`. Cria quadro e listas "A fazer", "Fazendo", "Concluído" (esta com `isDoneList: true`), com cores `blue`, `orange` e `green`. O quadro nasce `visibility: 'team'`.
201 `{ board: BoardDetail, lists: List[] }`.

### `GET /api/boards/:boardId` · Auth
Payload do quadro (arquivado também pode ser lido). Quadro restrito sem acesso → `403 BOARD_RESTRICTED`.
200
```ts
{
  board: BoardDetail;     // com visibility, cover assinada e viewerIds
  lists: List[];          // só não arquivadas, por position
  cards: CardSummary[];   // não arquivados, de listas não arquivadas, por (listId, position)
  labels: Label[];        // por name
}
```
Implementação: 6 consultas (board com `LEFT JOIN board_covers`, lists, cards com agregados `checklist`/`commentCount` via subconsultas agrupadas, `card_labels` do quadro, `card_assignees` do quadro, labels). Sem N+1 (§18.3, item 31). Quadro restrito custa uma consulta a mais (a lista de acesso) e, para quem não é Admin, mais uma (a checagem do viewer). Capa: `cover.url` assinada na hora, sem ida ao R2.

### `PATCH /api/boards/:boardId` · Auth
Body `{ name }`. `BOARD_ARCHIVED` se arquivado. 200 `{ board: BoardDetail }`.

### `POST /api/boards/:boardId/archive` · Auth — 200 `{ board: BoardDetail }` (idempotente)
### `POST /api/boards/:boardId/restore` · Auth — 200 `{ board: BoardDetail }` (idempotente)

### `DELETE /api/boards/:boardId` · Admin
Body `{ confirmName: string }` (comparação exata após trim). Diferente → `400 CONFIRMATION_MISMATCH`. Exclusão definitiva com cascata (inclui lista de acesso e capa; o objeto sai do R2 depois do commit). 204.

### `GET /api/boards/:boardId/archived` · Auth
200 `{ lists: List[] /* arquivadas, por archivedAt desc */, cards: Array<CardSummary & { listName: string; listArchived: boolean }> /* arquivados individualmente, por archivedAt desc */ }`.
Quadro restrito sem acesso → `403 BOARD_RESTRICTED`.

### `PUT /api/boards/:boardId/visibility` · Auth
Body `{ visibility: BoardVisibility }`. Idempotente (mesmo valor → 200 sem mudança).
- `'restricted'`: na mesma transação, o **ator** e o **criador do quadro** entram em `viewerIds` (RN30). Criador anonimizado fica de fora (RN38). Não existe "responsável de quadro": o resto da equipe entra pela rota de viewers.
- `'team'`: apaga a lista de acesso (`viewerIds` volta a `[]`).
- Ordem: 400 → 404 → `403 BOARD_RESTRICTED` → `409 BOARD_ARCHIVED`.
200 `{ board: BoardDetail }`.

### `PUT /api/boards/:boardId/viewers/:userId` · Auth
Adiciona à lista de acesso. Quadro `team` → `409 BOARD_NOT_RESTRICTED`. Usuário inexistente → 404; não ativo (inclusive anonimizado) → `409 USER_NOT_ACTIVE`. Idempotente.
200 `{ viewerIds: Uuid[] }` (ordem de inclusão: `created_at`, depois `user_id`).

### `DELETE /api/boards/:boardId/viewers/:userId` · Auth
Remove da lista de acesso (qualquer status de usuário), inclusive a si mesmo — quem se remove perde o acesso ao quadro na hora (a UI confirma antes). Quadro `team` → `409 BOARD_NOT_RESTRICTED`. Idempotente. Não existe regra de "último viewer": Admin sempre alcança o quadro.
200 `{ viewerIds: Uuid[] }`.

### `POST /api/boards/:boardId/cover/upload-url` · Auth · rate limit 30/5min/usuário
Pede a URL de upload direto para o R2 (ADR 0016). Não grava nada.
Body `{ contentType: string, sizeBytes: number }` (limites na tabela de §2).
- R2 não configurado ou fora do ar → `503 COVER_STORAGE_UNAVAILABLE`.
- Ordem: 400 → 404 → `403 BOARD_RESTRICTED` → `409 BOARD_ARCHIVED` → 503.
200 `{ uploadUrl: string, objectKey: string, expiresAt: IsoDateTime, headers: Record<string,string> }` — a URL vale 5 minutos; `headers` traz o `Content-Type` que o `PUT` no R2 precisa repetir (o `Content-Length` é assinado com `sizeBytes` e o navegador o envia sozinho).

### `PUT /api/boards/:boardId/cover` · Auth
Confirma o upload e passa a ser a capa do quadro.
Body `{ objectKey: string, width?: number, height?: number }`.
- `objectKey` fora do prefixo `covers/<boardId>/` → `400 VALIDATION_ERROR` com `details[0].path = "objectKey"`.
- A API confere no R2: objeto existe, `Content-Length` ≤ 5 MiB, `Content-Type` na lista e os 16 primeiros bytes com assinatura do formato declarado. Falhou → o objeto é apagado e a resposta é `409 COVER_UPLOAD_INVALID`.
- Capa anterior (se houver) é apagada do R2 depois do commit.
- Ordem: 400 → 404 → `403 BOARD_RESTRICTED` → `409 BOARD_ARCHIVED` → 503 → `409 COVER_UPLOAD_INVALID`.
200 `{ board: BoardDetail }`.

### `DELETE /api/boards/:boardId/cover` · Auth
Remove a capa (linha e objeto). Idempotente (sem capa → 200 sem mudança). Com R2 fora do ar, a linha **não** é apagada e a resposta é `503 COVER_STORAGE_UNAVAILABLE`.
200 `{ board: BoardDetail }`.

## 10. Listas

### `POST /api/boards/:boardId/lists` · Auth
Body `{ name, color?: PaletteColor /* default: próxima cor da paleta após a cor da última lista ativa (cíclico) */, placement?: Placement /* default { type: 'end' } */ }`. 201 `{ list: List }`.

### `PATCH /api/lists/:listId` · Auth
Body `{ name?: string, isDoneList?: boolean, color?: PaletteColor }` (ao menos um). Valor fora da paleta → 400.
- `isDoneList: true`: na mesma transação desmarca a lista de conclusão anterior do quadro. Lista arquivada → `409 LIST_ARCHIVED`.
- `isDoneList: true` com cards abertos não arquivados na lista: todos são concluídos na mesma transação (ator = usuário; atividade por card), para manter RN12. Desmarcar não reabre ninguém (overview §4.2).
200 `{ lists: List[], completedCardIds: Uuid[] }` — **todas** as listas ativas do quadro (a marcação pode ter mudado em outra) e os cards concluídos por esta ação (`[]` se nenhum). Em quadro restrito sem acesso, a rota responde `403 BOARD_RESTRICTED` como qualquer outra mutação de lista.

### `POST /api/lists/:listId/move` · Auth
Body `{ placement: Placement }` (dentro do mesmo quadro). 200 `{ list: List }`.

### `POST /api/lists/:listId/archive` · Auth
Arquiva; se era lista de conclusão, `isDoneList` vira `false`. Os cards somem do payload do quadro (sem mudar o próprio `archivedAt`). Idempotente. 200 `{ list }`.

### `POST /api/lists/:listId/restore` · Auth
Restaura no **fim** do quadro (nova `position`); cards voltam com as posições que tinham. Idempotente. 200 `{ list }`.

## 11. Cards

> **Acesso ao card (Fatia 11, ADR 0015).** O card **não** tem visibilidade própria: quem decide é o quadro (§9). Toda rota desta seção (e as de checklists, comentários, etiquetas e responsáveis do card) checa o acesso ao quadro do card logo depois do 404 e antes de qualquer 409 → `403 BOARD_RESTRICTED`. A checagem é uma função só (`modules/boards/access.ts`), chamada de dentro do `lockCard()` que todas as mutações já usam. Em quadro `team` vale a RN05 (todo usuário ativo lê e edita). Mover um card **para** um quadro restrito sem acesso também é `403 BOARD_RESTRICTED`.

### `POST /api/lists/:listId/cards` · Auth
Body `{ title }`. Cria no fim da lista. Lista arquivada → `LIST_ARCHIVED`; lista de conclusão → `LIST_IS_DONE_LIST`. Atividade `card_created`.
201 `{ card: CardSummary }`.

### `GET /api/cards/:cardId` · Auth
200 `{ card: CardDetail }`. Card arquivado também é retornado. Card de quadro restrito sem acesso → `403 BOARD_RESTRICTED` (não 404: o quadro aparece na home com o cadeado).

### `PATCH /api/cards/:cardId` · Auth
Body `{ title?: string, description?: string, due?: DueInput | null, priority?: CardPriority | null }` (ao menos um). `due: null` remove o prazo; `priority: null` remove a prioridade. Prioridade não altera `position`.
- Atividades: `card_title_changed` se título mudou; `card_due_changed` se `dueAt`/`dueHasTime` mudou; `card_priority_changed` se a prioridade mudou. Descrição não gera atividade.
- `DueInput` inválido (data inexistente, hora fora de 00:00–23:59) → 400.
200 `{ card: CardDetail }`.

### `POST /api/cards/:cardId/move` · Auth
Body `{ toListId: Uuid, placement: Placement }`.
- Destino arquivado (lista ou quadro) → `409 LIST_ARCHIVED` / `BOARD_ARCHIVED`. Card arquivado → `409 CONFLICT`.
- Lock: listas origem e destino (`SELECT ... FOR UPDATE` em ordem de id).
- Entre quadros: atualiza `board_id`, remove `card_labels` de etiquetas que não são do quadro destino (retorna `removedLabelIds`). Responsáveis permanecem.
- Atividade `card_moved` se a lista mudou.
- Regras de conclusão automáticas (`overview.md` §4.2): card aberto que entra na lista de conclusão é concluído; card concluído que sai da lista de conclusão é reabrido (fica na posição pedida). Demais movimentos não mudam o status.
200 `CardMutationResult`.

### `POST /api/cards/:cardId/complete` · Auth
Conclui; se o quadro tem lista de conclusão, move o card para o fim dela; sem lista de conclusão, o card fica onde está.
200 `CardMutationResult` (no-op se já concluído: `completionChange: null`). Card arquivado → `409 CONFLICT`.

### `POST /api/cards/:cardId/reopen` · Auth
Reabre; se o card está na lista de conclusão, move para o **topo** da primeira lista ativa não-conclusão (se não houver, fica). Fora dela ou sem lista de conclusão, fica onde está.
200 `CardMutationResult` (no-op se já aberto). Card arquivado → `409 CONFLICT`.

### `POST /api/cards/:cardId/archive` · Auth
Atividade `card_archived`. Idempotente. 200 `{ card: CardSummary }`.

### `POST /api/cards/:cardId/restore` · Auth
Restaura no **fim** da lista original. Lista arquivada → `409 LIST_ARCHIVED`. Atividade `card_restored`. Se a lista é de conclusão e o card está aberto, também conclui (`card_completed`). Idempotente. 200 `{ card: CardSummary }`.

### `DELETE /api/cards/:cardId` · Admin
Exclusão definitiva (cascata). 204.

### `PUT /api/cards/:cardId/assignees/:userId` · Auth
Adiciona responsável. Usuário inexistente → 404; não ativo → `409 USER_NOT_ACTIVE`. Se novo: atividade `card_assignee_added` e notificação `card_assigned` para o usuário (se ≠ ator). Idempotente (já atribuído: sem atividade/notificação). Atribuir **não** mexe em acesso: o acesso é do quadro e quem atribui já está dentro dele (§18.9 item 70).
200 `{ assigneeIds: Uuid[] }`.

### `DELETE /api/cards/:cardId/assignees/:userId` · Auth
Remove (qualquer status de usuário). Se existia: atividade `card_assignee_removed`. Idempotente. 200 `{ assigneeIds: Uuid[] }`.

### `PUT /api/cards/:cardId/labels/:labelId` · Auth
Etiqueta de outro quadro → `409 LABEL_BOARD_MISMATCH`. Idempotente. 200 `{ labelIds: Uuid[] }`.

### `DELETE /api/cards/:cardId/labels/:labelId` · Auth
Idempotente. 200 `{ labelIds: Uuid[] }`.

### `GET /api/cards/:cardId/activity` · Auth
Até 500 itens, mais recentes primeiro. 200 `{ activities: Activity[] }` · 403 `BOARD_RESTRICTED`.

## 12. Etiquetas

### `POST /api/boards/:boardId/labels` · Auth
Body `{ name, color: PaletteColor }`. 201 `{ label: Label }`.

### `PATCH /api/labels/:labelId` · Auth
Body `{ name?, color? }` (ao menos um). 200 `{ label }`.

### `DELETE /api/labels/:labelId` · Auth
Remove de todos os cards (cascata). A confirmação é da UI. 204.

## 13. Checklists

### `POST /api/cards/:cardId/checklists` · Auth
Body `{ title }` (UI sugere "Checklist"). 201 `{ checklist: Checklist }`.

### `PATCH /api/checklists/:checklistId` · Auth — Body `{ title }` → 200 `{ checklist }`
### `DELETE /api/checklists/:checklistId` · Auth — 204 (itens em cascata)

### `POST /api/checklists/:checklistId/items` · Auth
Body `{ text }`. Cria no fim. 201 `{ item: ChecklistItem }`.

### `PATCH /api/checklist-items/:itemId` · Auth
Body `{ text?, isChecked? }` (ao menos um). Marcar grava `checkedBy`/`checkedAt`; desmarcar limpa. Não gera atividade nem altera o status do card. 200 `{ item }`.

### `POST /api/checklist-items/:itemId/move` · Auth
Body `{ placement: Placement }` (mesmo checklist). 200 `{ item }`.

### `DELETE /api/checklist-items/:itemId` · Auth — 204

## 14. Comentários

### `POST /api/cards/:cardId/comments` · Auth
Body `{ body }`. Notificação `card_commented` para cada responsável ativo do card, exceto o autor. 201 `{ comment: Comment }`.

### `PATCH /api/comments/:commentId` · Autor
Body `{ body }`. Outro usuário (inclusive Admin) → `403 FORBIDDEN`. Grava `editedAt`. 200 `{ comment }`.

### `DELETE /api/comments/:commentId` · Autor ou Admin
204.

## 15. Notificações

```ts
type Notification = {
  id: Uuid;
  type: 'card_assigned' | 'card_commented';
  actorId: Uuid;
  card: { id: Uuid; title: string; boardId: Uuid; boardName: string };
  commentId: Uuid | null;
  readAt: IsoDateTime | null;
  createdAt: IsoDateTime;
};
```

Notificação de card em quadro restrito a que o usuário perdeu o acesso é **omitida** da listagem e do `unreadCount` (o título do card e o nome do quadro sairiam na resposta). Ela não é apagada: volta a aparecer se o acesso voltar (ADR 0015).

### `GET /api/notifications?limit=30&before=<IsoDateTime>` · Auth
Só do usuário da sessão, mais recentes primeiro. `limit` 1–100 (default 30). `before` = `createdAt` do último item da página anterior.
200 `{ notifications: Notification[], unreadCount: number, nextBefore: IsoDateTime | null }`.

### `GET /api/notifications/unread-count` · Auth
200 `{ unreadCount: number }`.

### `POST /api/notifications/:notificationId/read` · Auth
De outro usuário → `404 NOT_FOUND`. Idempotente. 204.

### `POST /api/notifications/read-all` · Auth
204.

## 16. Matriz de permissões (resumo)

| Recurso / ação | Pública | Auth | Admin | Autor |
|----------------|:------:|:----:|:-----:|:-----:|
| health, setup, login, lookup/aceite de convite, lookup/uso de reset | x | | | |
| me, me/password, me/cards (só a si) | | x | | |
| users (sem e-mail) | | x | | |
| admin/* | | | x | |
| boards/lists/cards/labels/checklists: ler, criar, editar, mover, arquivar, restaurar | | x | | |
| quadro `restricted` (e tudo dentro dele): ler, editar, comentar, mover, mudar visibilidade e lista de acesso | | x (só quem está na lista de acesso) | x (sempre) | |
| capa do quadro (pedir URL, confirmar, remover) | | x (com acesso ao quadro) | | |
| excluir quadro, excluir card | | | x | |
| editar comentário | | | | x |
| excluir comentário | | | x | x |
| notificações (só as próprias) | | x | | |

## 17. Testes de contrato obrigatórios

Para cada rota: sucesso; `401` sem sessão (exceto públicas); `403 CSRF_REJECTED` em mutação sem header ou com `Origin` estranho; `400` com corpo inválido; `404` com id inexistente; `403` quando a matriz restringe; os `409` listados na rota. Além disso, os testes de regra de negócio listados em `plan.md`.

## 18. Decisões de contrato fechadas na implementação dos schemas (v1.4)

Registradas ao implementar `packages/shared` para as Fatias 2 a 9. Os schemas seguem estas escolhas.

1. **`{ user }` de `deactivate`, `reactivate` e `anonymize`** tem o mesmo formato de `PATCH /api/admin/users/:userId`: `UserSummary & { email: string | null; createdAt }` (`adminUserResponseSchema`). O documento dizia só `{ user }`.
2. **"Ao menos um campo"** vale para todo `PATCH` com campos opcionais: além de listas e cards, `PATCH /api/admin/workspace`, `PATCH /api/labels/:labelId` e `PATCH /api/checklist-items/:itemId`. Corpo vazio (ou só com campos desconhecidos, que são descartados) → `400 VALIDATION_ERROR`.
3. **`Activity.data`** é união discriminada por `type` (overview.md §5.3), não `Record<string, unknown>`. Em `card_due_changed`, `hasTime` é o `dueHasTime` do novo prazo (`false` quando `to` é `null`).
4. **Link de redefinição para usuário anonimizado**: §3 citava `USER_ANONYMIZED` e §8 citava `USER_NOT_ACTIVE`. Como anonimizado também está desativado, a checagem de anonimização vem primeiro (`USER_ANONYMIZED`); desativado não anonimizado → `USER_NOT_ACTIVE`.
5. **Senha ≠ e-mail** vale em setup, aceite de convite, redefinição por link e troca de senha. Nos dois últimos o e-mail não está no corpo: o servidor usa `isPasswordSameAsEmail` (shared) e responde `400 VALIDATION_ERROR` com `details[].path` no campo da senha.
6. **Token malformado** (diferente de 43 caracteres base64url) → `400 VALIDATION_ERROR`, não `410`. A UI de `/convite` e `/redefinir-senha` trata 400 e 410 igualmente como "link inválido".
7. **Query strings**: `archived` aceita só `true`/`false`; `limit` de notificações é inteiro 1–100 (padrão 30). Datas de resposta são sempre ISO UTC com `Z`: o backend converte `Date` com `toISOString()` antes de responder (o serializer valida com o schema via `safeEncode`).
8. **`POST /api/admin/invites`**: `email` ausente vira `null`; string vazia é inválida.

### 18.1 Decisões fechadas na implementação do backend das Fatias 2 e 3 (v1.5)

Nenhuma muda schema; todas detalham comportamento que o documento deixava em aberto.

9. **Ordem de checagem em `/api/*admin*`**: o papel é exigido por um `preHandler` do plugin, então Member recebe `403 FORBIDDEN` **antes** do 404 (não revela se o id existe). Nas demais rotas vale a ordem do §3 (404 → 403); em `DELETE /api/boards/:boardId` a ordem é 404 → 403 → `400 CONFIRMATION_MISMATCH`.
10. **`POST /api/me/password`**: além de `400 PASSWORD_INCORRECT` (que conta no bloqueio por e-mail do login), com o e-mail bloqueado responde `429 TOO_MANY_ATTEMPTS` + `Retry-After`, antes de verificar a senha atual. A checagem "nova senha = e-mail" vem antes das duas.
11. **`POST /api/auth/invites/accept` com sessão no navegador**: a sessão anterior é apagada e a nova é criada (mesmo comportamento do login). Consumo, criação do usuário e sessão são uma transação: `409 EMAIL_TAKEN` por corrida no `UNIQUE` também devolve o token ao estado pendente.
12. **Rate limit das rotas de token** (10 req / 15 min por IP) é contado **por rota** (lookup e aceite/uso têm contadores separados).
13. **`DELETE /api/admin/invites/:inviteId`**: id que não é convite (ex.: token de redefinição) → 404. Convite já usado, expirado ou revogado → 204 sem alterar nada.
14. **`PATCH /api/admin/users/:userId`**: mesmo papel → 200 no-op (inclusive para si mesmo); `CANNOT_TARGET_SELF` só quando o papel mudaria. `LAST_ADMIN` é garantido com lock dos Admins ativos; pela API ele só aparece em operações concorrentes (o ator é sempre um Admin ativo diferente do alvo).
15. **Listas**: `PATCH /api/lists/:listId` com `name`/`color` é aceito em lista arquivada (só `isDoneList: true` → `409 LIST_ARCHIVED`); `POST /api/lists/:listId/move` de lista arquivada → `409 LIST_ARCHIVED`. Toda mutação de lista (inclusive `archive`/`restore`) em quadro arquivado → `409 BOARD_ARCHIVED`.
16. **`PATCH /api/lists/:listId { isDoneList: true }`** já conclui os cards abertos (tarefa 8.2 antecipada no `modules/completion`): só quando a lista **passa** a ser de conclusão; remarcar a mesma lista responde `completedCardIds: []`. `completedCardIds` vem ordenado por id.
17. **Payload do quadro** (`GET /api/boards/:boardId`) já traz cards (com agregados, `labelIds`, `assigneeIds`) e `labels` reais, lidos num snapshot `REPEATABLE READ` somente leitura. Ordem de `assigneeIds`: por data de atribuição; de `labelIds`: por nome da etiqueta.

### 18.2 Decisões fechadas na implementação do backend da Fatia 4 (v1.6)

Nenhuma muda schema.

18. **Ordem das checagens em `POST /api/cards/:cardId/move`**: 400 → 404 (card, depois lista destino) → `409 BOARD_ARCHIVED` (quadro do card, depois quadro destino) → `409 LIST_ARCHIVED` (lista destino) → `409 CONFLICT` (card arquivado) → `409 INVALID_PLACEMENT`. Em `POST /api/lists/:listId/cards`: 404 → `BOARD_ARCHIVED` → `LIST_ARCHIVED` → `LIST_IS_DONE_LIST`.
19. **Ordem das atividades numa mesma ação**: `card_moved` antes de `card_completed`/`card_reopened`; `card_restored` antes de `card_completed`. O `created_at` é estritamente crescente por card (`greatest(now, último + 1 µs)`), então `GET /api/cards/:cardId/activity` (`created_at DESC`) respeita a ordem de gravação mesmo no mesmo milissegundo. `card_moved` entre quadros grava `board_id` do quadro destino.
20. **`POST /api/cards/:cardId/restore`** de card não arquivado → 200 sem mudança, checado **antes** de `LIST_ARCHIVED` (`BOARD_ARCHIVED` vem antes de ambos). `archive`/`restore` em quadro arquivado → `409 BOARD_ARCHIVED` mesmo quando seriam no-op.
21. **`PATCH /api/cards/:cardId`** é aceito em card arquivado (só quadro arquivado → 409). Campos iguais aos atuais não geram atividade nem alteram `updatedAt`.
22. **`DELETE /api/cards/:cardId`**: 404 → 403 (Member) → `409 BOARD_ARCHIVED` (quadro arquivado é somente leitura, I10; a exceção de §3 vale só para excluir o **quadro**).
23. **`removedLabelIds`** vem ordenado por id. Responsáveis permanecem no move entre quadros.
24. **Locks das mutações de card**: quadros envolvidos `FOR SHARE` (por id) → listas envolvidas `FOR UPDATE` (por id) → card `FOR UPDATE`. Arquivar/excluir o quadro (`FOR UPDATE`) espera a ação terminar; cards do mesmo quadro só se serializam pelas listas. Se o card mudou de lista entre a leitura e o lock, a transação é refeita (até 5 vezes).

### 18.3 Decisões fechadas na implementação do backend das Fatias 5 e 6 (v1.7)

Nenhuma muda schema.

25. **Responsáveis** (`PUT|DELETE /api/cards/:cardId/assignees/:userId`): ordem 400 → 404 (card, depois usuário) → `409 BOARD_ARCHIVED` → `409 USER_NOT_ACTIVE` (só no `PUT`; anonimizado também é `USER_NOT_ACTIVE`). Usuário já atribuído → 200 sem atividade, mesmo que tenha sido desativado depois. `DELETE` com usuário inexistente → 404. `assigneeIds` por ordem de atribuição. Atividades: `card_assignee_added`/`card_assignee_removed` com `{ userId }`, só quando algo muda.
26. **Etiquetas**: nomes não são únicos no quadro. `POST /api/boards/:boardId/labels`, `PATCH` e `DELETE /api/labels/:labelId`: 404 → `409 BOARD_ARCHIVED`; valores iguais no `PATCH` → 200 sem gravar. Etiquetas não geram atividade.
27. **Etiqueta no card**: ordem 400 → 404 (card, depois etiqueta) → `409 BOARD_ARCHIVED` → `409 LABEL_BOARD_MISMATCH` (só no `PUT`). `DELETE` de etiqueta de outro quadro → 200 no-op com os `labelIds` atuais. `labelIds` por nome da etiqueta.
28. **Card arquivado** aceita responsáveis, etiquetas, checklists/itens e comentários (como o `PATCH` do card, item 21); só quadro arquivado → 409.
29. **Checklists e itens**: toda mutação 400 → 404 → `409 BOARD_ARCHIVED` (→ `409 INVALID_PLACEMENT` no `move`: `after` de outro checklist, inexistente ou o próprio item). Marcar item já marcado mantém `checkedBy`/`checkedAt` originais; desmarcar limpa os dois. Valores iguais → 200 sem gravar. Nenhuma ação de checklist gera atividade ou muda o status do card. Checklists no detalhe: `createdAt`, depois `id`.
30. **Comentários**: `PATCH`/`DELETE` na ordem 400 → 404 → 403 → `409 BOARD_ARCHIVED` (não autor recebe 403 mesmo em quadro arquivado). `PATCH` com o mesmo corpo (após `trim`) → 200 sem alterar `editedAt`. O corpo é guardado como texto Markdown cru (só `trim`), sem sanitizar nem gerar HTML (ADR 0007).
31. **Payload do quadro**: 6 consultas (o §9 listava 5 e omitia `labels`); teste garante que o número não cresce com cards, etiquetas e responsáveis.
32. **Ganchos de notificação**: `onAssigned` (atribuição nova) e `onCommented` (comentário novo) em `src/modules/notifications/hooks.ts`, chamados na transação da ação e hoje sem efeito. A tarefa 7.3 aplica lá a regra de não autonotificar e só destinatários ativos.
33. **Locks**: quadro `FOR SHARE` → card `FOR UPDATE` → checklist → item / comentário (`FOR UPDATE`). Atribuir bloqueia o usuário alvo `FOR SHARE` (desativar em paralelo espera). Criar/editar/excluir etiqueta: quadro `FOR SHARE` → etiqueta `FOR UPDATE`.

### 18.4 Decisões fechadas na implementação do backend das Fatias 7, 8 e 9 (v1.8)

Nenhuma muda schema.

34. **Destinatários de notificação**: `card_assigned` vai para o atribuído; `card_commented` vai para os **responsáveis** do card (o criador não entra, D2). Em ambos: nunca o ator (RN18, também `CHECK` no banco) e só usuários `active` não anonimizados, avaliados na transação da ação com `FOR SHARE` nos destinatários (desativar/anonimizar em paralelo não deixa notificação para conta anonimizada). Excluir o comentário mantém a notificação com `commentId: null`; excluir card/quadro apaga em cascata.
35. **Paginação de notificações** (`GET /api/notifications`): ordem `createdAt DESC, id DESC`; `before` exclusivo. Para o cursor só por `createdAt` não pular itens do mesmo instante na borda, a página inclui **todas** as notificações do instante do último item (só nesse empate a página passa de `limit`). `nextBefore` é o `createdAt` do último item quando existem itens mais antigos; senão `null` (inclusive quando a página termina exatamente no último item). `unreadCount` e a página vêm do mesmo snapshot.
36. **Ler notificação**: `POST /api/notifications/:notificationId/read` já lida mantém o `readAt` original (204). Ordem: 401 → 403 CSRF → 400 → 404 (inexistente ou de outro usuário). `read-all` só afeta as não lidas do usuário da sessão.
37. **`complete`/`reopen`**: ordem 400 → 404 → `409 BOARD_ARCHIVED` → `409 CONFLICT` (card arquivado, **mesmo** se já estiver no estado pedido) → no-op 200. Card numa lista arquivada (não arquivado individualmente) é aceito, como no `move`. "Primeira lista ativa não-conclusão" = menor `position` entre as listas ativas. Card aberto que já está na lista de conclusão (estado legado) é concluído sem mover. `card_moved` (mesmo quadro, nomes fotografados) antes de `card_completed`/`card_reopened`; `removedLabelIds` é sempre `[]`. Locks como no `move` (§18.2 item 24); o destino é conferido depois dos locks e a transação é refeita se mudou (10 `complete` concorrentes → 1 `card_completed`).
38. **Anonimizar** (`POST /api/admin/users/:userId/anonymize`): ordem 400 → 403 (Member, antes do 404) → 404 → `409 CANNOT_TARGET_SELF` → já anonimizado (200 no-op, mesmo `{ user }`) → `409 USER_NOT_DEACTIVATED`. `LAST_ADMIN` não se aplica (o alvo já está desativado). Efeitos na mesma transação: nome "Usuário removido", `email`/`password_hash` nulos, `anonymized_at`; apaga sessões, links de redefinição do usuário, notificações **recebidas** e a linha `auth_throttle` do e-mail; tira o e-mail dos convites ligados a ele (aceito por ele ou com o e-mail dele; se algum ainda estivesse pendente, é revogado). Cards, responsáveis, comentários, atividades e notificações que ele gerou para outros permanecem. O e-mail fica livre para novo convite.
39. **Meus cards** (`GET /api/me/cards`): desempate final por `id`. Três consultas (faces com agregados, etiquetas, responsáveis) num snapshot `REPEATABLE READ`; os pares de etiquetas/responsáveis (também no payload do quadro e em arquivados) só leem cards do escopo. 1.000 cards atribuídos: bem abaixo de 1 s no teste.
40. **Manutenção** (`plugins/maintenance.ts`): roda no `onReady` e a cada 24 h, **ligada por padrão só em `production`** (em dev o `tsx watch` reinicia a cada gravação; nos testes `runMaintenance` é chamado com relógio controlado; `buildApp({ maintenance })` força). Apaga: notificações com `readAt` há mais de 90 dias (não lidas nunca); sessões com expiração ociosa ou absoluta vencida; `auth_throttle` sem bloqueio vigente e janela iniciada há mais de 1 h; `auth_tokens` criados há mais de 30 dias e expirados/usados/revogados há mais de 30 dias (continuam no histórico de convites até lá).

### 18.5 Correções da revisão de segurança (v1.9)

Nenhuma muda schema nem migration. Rotas afetadas: `POST /api/auth/login`, `POST /api/me/password`, `PATCH /api/admin/users/:userId`, `POST /api/admin/users/:userId/deactivate` e `/anonymize`.

41. **Bloqueio de login sem corrida** (`modules/auth/throttle.ts`): a tentativa é **reservada antes do Argon2** num único `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` por chave (a linha fica travada; requisições paralelas na mesma chave são serializadas). Chave bloqueada: não estende o bloqueio e o contador sobe só até `max + 1`. Tentativa permitida ⇔ contador resultante `<= max`; a que atinge `max` ainda é verificada e aciona o bloqueio. Com isso, 30 logins paralelos com senha errada no mesmo e-mail fazem no máximo 5 verificações (o resto recebe `429 TOO_MANY_ATTEMPTS`); antes, a checagem de bloqueio e a gravação da falha ficavam separadas pelo Argon2 e a rajada inteira passava.
    - **Ordem no login**: e-mail primeiro, depois IP. E-mail recusado → 429 sem tocar no IP. IP recusado → devolve a reserva do e-mail → 429.
    - **Semântica mantida**: senha errada (ou usuário inexistente/inativo, com o hash fictício) mantém as duas reservas = falha. Sucesso apaga a linha do e-mail e **devolve** a reserva do IP (`failures - 1`; bloqueio desfeito se cair abaixo de 20), então o IP continua somando só falhas e o sucesso não zera as falhas do IP.
    - **Troca de senha** (`POST /api/me/password`): mesma reserva na chave do e-mail antes de verificar `currentPassword`. Errada: a reserva fica (falha) → `400 PASSWORD_INCORRECT`; bloqueada: `429 TOO_MANY_ATTEMPTS`; certa: a reserva é devolvida (a troca não zera nem soma no e-mail, como antes).
    - Imprecisão aceita: se a tentativa que atingiu o limite for depois devolvida (sucesso na 20ª do IP, ou 5ª do e-mail barrada pelo IP) e, nesses milissegundos, outra requisição tiver sido recusada por esse bloqueio, o contador fica 1 acima do real até a janela vencer.
42. **Limites de rota** (`plugins/rate-limit.ts`, em memória, `429 RATE_LIMITED` + `Retry-After`): `POST /api/auth/login` 30 req/min por IP; `POST /api/me/password` 10 req/15 min por usuário (por IP sem sessão). Contam antes da validação do corpo e substituem o limite geral nessas rotas. São a primeira barreira contra rajadas; o bloqueio persistido do item 41 continua valendo entre instâncias.
43. **Tokens de quem perde o poder de emiti-los**: rebaixar Admin para Member (`PATCH /api/admin/users/:userId`), desativar e anonimizar revogam (`revoked_at = now`), **na mesma transação**, os convites e links de redefinição **pendentes** (não usados, não revogados, não expirados) com `created_by` = alvo. Usados, expirados e já revogados não mudam; tokens de outros Admins também não. Mudar para o mesmo papel é no-op (não revoga). Regra que falha (`LAST_ADMIN`) desfaz tudo.
44. **Configuração fail-closed** (`config/env.ts`): `NODE_ENV=production` exige `APP_ORIGIN` em `https://` (erro em `APP_ORIGIN`); `APP_ORIGIN` em `https://` com `NODE_ENV` diferente de `production` (inclusive ausente, que vira `development`) é erro (em `NODE_ENV`), porque indica produção sem cookie `Secure`/`__Host-`, com `/api/docs` exposto. Dev local segue em `http://127.0.0.1:5310`. Requisitos do deploy em `overview.md` §6.8.
45. **Erros de banco nos logs** (`logger.ts`, serializer de `err`): `DrizzleQueryError` sai só com `type`, `query` (sem `params`), `code` e `constraint` da causa, `stack` só com os frames e `cause` higienizada; `DatabaseError` do `pg` sai com `code`, `constraint`, `table`, `routine` e frames, sem `message`, `detail` (ex.: `Key (email)=(...)`), `where` etc. Os demais erros mantêm `type`, `message`, `stack` e propriedades próprias, mas `message`/`stack` são só do próprio erro (o serializer padrão do pino concatena os das causas) e a `cause` passa pelo mesmo serializer.

### 18.6 Código de configuração do setup (v1.10)

Preparação do deploy público (`docs/ops/deploy-render.md`). Muda o contrato de `GET /api/setup/status` e `POST /api/setup`; sem migration.

46. **Setup protegido por código** (`modules/setup`, `config/env.ts`): enquanto não existe usuário, quem chegasse primeiro à instância publicada viraria Admin. A variável `SETUP_TOKEN` (16 a 200 caracteres) passa a ser **obrigatória com `NODE_ENV=production`** (a API não sobe sem ela, como na regra do `https://`, `overview.md` §6.8) e opcional fora de produção.
    - `GET /api/setup/status` ganha `requiresSetupToken: boolean` (`true` quando `SETUP_TOKEN` está configurado, mesmo depois do setup). O valor do código nunca sai na resposta.
    - `POST /api/setup` ganha `setupToken?: string` (máximo 200 caracteres, sem `trim`; acima disso `400 VALIDATION_ERROR` em `setupToken`). Com `SETUP_TOKEN` configurado, ausente ou errado → `403 SETUP_TOKEN_INVALID` ("Código de configuração inválido."), **antes** do atalho de `SETUP_ALREADY_DONE` e do Argon2id. A comparação calcula SHA-256 dos dois lados e usa `crypto.timingSafeEqual` (tamanho e conteúdo não vazam pelo tempo).
    - O rate limit da rota (5 req/15 min por IP) continua valendo e conta as tentativas com código errado. `setupToken` entra no `redact` dos logs.
    - Sem `SETUP_TOKEN` (dev local, testes, E2E): comportamento anterior, `requiresSetupToken: false`.

### 18.7 Fatia 11: cards restritos e capa do card (v1.11) — **histórico, substituído pela §18.9**

> **Superado em 2026-09-17 (v1.13).** O cliente corrigiu o alvo da fatia: a restrição e a capa são
> do **quadro**, não do card. Os itens 47 a 58 valem como histórico do desenho anterior; o que está
> em vigor é a §18.9, e a migration `0009` derruba as estruturas de card descritas aqui.

Decisões fechadas ao desenhar a Fatia 11 (ADR 0015 e ADR 0016). Mudam schema e exigem migration (`0008`).

**Visibilidade (ADR 0015)**

47. **Um lugar só decide acesso.** `modules/cards/access.ts` exporta a função pura (`canAccessCard`), o `assertCardAccess` (`403 CARD_RESTRICTED`) e o predicado SQL (`cardAccessCondition`). O `lockCard()` de `modules/cards/service.ts` — usado por cards, checklists, comentários, etiquetas e responsáveis — passa a receber o ator e chamar o `assertCardAccess` **depois** do 404 do card e **antes** do `409 BOARD_ARCHIVED`, mantendo a ordem 404 → 403 → 409 e cobrindo por construção toda rota que use o lock. Rotas de leitura (`GET /api/cards/:cardId`, `/activity`) chamam o mesmo assert. A checagem roda sobre a linha **bloqueada**: restringir o card em paralelo não deixa passar mutação.
48. **Payload bloqueado é outro tipo, não um card com nulos.** `LockedCard = { id, listId, position, title, locked: true }`; `CardSummary` ganha `locked: false` e as listas passam a ser união discriminada (`BoardCard`). O serializer do Fastify corta qualquer campo extra. Além disso, no payload do quadro e em arquivados, as subconsultas de `checklist`/`commentCount` e as consultas de `card_labels`/`card_assignees` recebem o predicado de acesso: dado de card bloqueado não sai do banco. `CardMutationResult.card` é sempre `CardSummary` (quem mutou tem acesso).
49. **Filtrar, não bloquear, onde o card é "meu trabalho"**: `GET /api/me/cards` e a listagem/contador de notificações omitem cards sem acesso. A ordem e a paginação (cursor `before`) continuam calculadas depois do filtro, então `unreadCount` e a página saem do mesmo snapshot e não divergem.
50. **Responsável de card restrito é sempre viewer.** `PUT /api/cards/:cardId/assignees/:userId` insere a pessoa em `card_viewers` na mesma transação (atividade `card_viewer_added` além de `card_assignee_added`). Remover o responsável **não** remove o acesso: só `DELETE .../viewers/:userId` remove. Restringir um card (`PUT .../visibility`) inclui o ator e os responsáveis atuais; voltar para `team` apaga a lista inteira.
51. **Exceção única à regra de acesso:** `PATCH /api/lists/:listId { isDoneList: true }` conclui os cards abertos da lista **inclusive os restritos que o ator não vê** (RN12 não pode quebrar por causa de uma restrição). `completedCardIds` pode, portanto, conter ids de cards bloqueados — ids que a pessoa já vê no quadro. Nenhum outro campo desses cards é exposto. Arquivar/restaurar/excluir a **lista** ou o **quadro** segue a mesma lógica: são ações de contêiner, não de card.
52. **Atividades novas**: `card_visibility_changed` (`{ from, to }`), `card_viewer_added` (`{ userId }`), `card_viewer_removed` (`{ userId }`), `card_cover_changed` (`{}`) e `card_cover_removed` (`{}`). Só são lidas por quem tem acesso ao card (a rota de atividade responde 403).
53. **Compatibilidade**: `cards.visibility` nasce `not null default 'team'`, então todo o acervo continua visível para a equipe e nenhum cliente antigo quebra por falta de campo. Um front que ignore `locked` mostraria um card sem dados — por isso `locked` é obrigatório nos dois lados da união.

**Capa (ADR 0016)**

54. **Upload em três passos** (`POST .../cover/upload-url` → `PUT` direto no R2 → `PUT .../cover`). A URL assinada de escrita vale 5 min e assina `content-type` e `content-length`: não dá para enviar outro tipo nem outro tamanho. A confirmação refaz a checagem com `HEAD` e lê 16 bytes com `Range` para validar a assinatura do formato; o que não passa é apagado e vira `409 COVER_UPLOAD_INVALID`. Não existe estado de "upload pendente" no banco: a chave só pode ter sido criada por uma URL que a API assinou para aquele card.
55. **URL de leitura com janela fixa.** O vencimento é arredondado para o início da janela de 5 minutos e vale 15 min a partir dali (validade efetiva de 10 a 15 min). Assim a string não muda entre os refetches de 30 s do quadro, o cache do navegador funciona e a imagem não pisca. A assinatura é HMAC local (sem ida ao R2) e inclui `response-cache-control: private, max-age=600`. `cover.expiresAt` informa o vencimento para o front decidir refetch.
56. **Chave**: `covers/<cardId>/<32 caracteres base64url>` (24 bytes aleatórios), com `CHECK` no banco amarrando a chave ao `card_id` da linha. Trocar a capa apaga o objeto anterior; excluir card ou quadro apaga o objeto; upload nunca confirmado vira órfão e é apagado pela limpeza diária (lista o prefixo `covers/`, compara com `card_covers`, apaga o que não tem linha e tem mais de 24 h). Falha ao apagar no R2 nunca desfaz a transação do banco: só log e órfão.
57. **Recurso opcional e tudo-ou-nada.** Sem as quatro variáveis do R2, `features.cardCovers` é `false`, `cover` é sempre `null` e as rotas de capa respondem `503 COVER_STORAGE_UNAVAILABLE`. `features` entra nas respostas de `POST /api/setup`, `POST /api/auth/login` e `GET /api/auth/me` (mesmo schema de sessão), porque é o que a SPA já lê no boot.
58. **Tipos aceitos**: `image/jpeg`, `image/png`, `image/webp`, `image/avif`; máximo de 5 MiB. Sem SVG (HTML executável) e sem GIF (animação pesada). O front reduz a imagem para no máximo 1600 px no maior lado antes de enviar; o limite do servidor continua valendo de qualquer forma.

### 18.8 Fatia 11: decisões do backend no nível do card (v1.12) — **histórico, substituído pela §18.9**

> **Superado em 2026-09-17 (v1.13)**, junto com a §18.7. Os itens 59 a 68 descrevem o backend da
> primeira versão da fatia (restrição e capa no card). O que vale hoje está na §18.9; os itens que
> continuam verdadeiros no nível do quadro estão repetidos lá.

Fechadas ao implementar a fatia. Nada aqui muda o desenho de §18.7: são detalhes que o front e a próxima pessoa do backend precisam saber.

59. **Ator em todo contexto de card.** `CardActionContext` passou a ser `{ actor: { id, role }, now, coverStorage }` (idem `ChecklistActionContext`), e `lockCard(tx, cardId, { actor, ... })` chama `assertCardAccess` sobre a linha já bloqueada. Rotas que antes só passavam o `actorId` (etiquetas, checklists, comentários, exclusão de card) agora passam o usuário da sessão inteiro. Nenhuma rota nova de card consegue "esquecer" a checagem: ela mora no lock.
60. **Ordem de `viewerIds`**: `created_at`, depois `user_id` (mesma regra de `assigneeIds`). Inclusões no mesmo instante saem em ordem estável, mas não necessariamente na ordem em que foram pedidas.
61. **Responsável não perde acesso (RN32)**: `DELETE /api/cards/:cardId/viewers/:userId` de quem é responsável responde `409 CONFLICT` com "{Nome} é responsável por este card. Remova a pessoa dos responsáveis antes de tirar o acesso." Nenhum `ErrorCode` novo foi criado: o par (409, mensagem) basta para a UI, e a lista de códigos fica estável para o front.
62. **Ao restringir, entram o ator, o criador do card e os responsáveis atuais** (RN30 do `scope.md`, confirmada pelo produto em 2026-09-17; as primeiras versões de §11 e da ADR 0015 citavam só o ator e os responsáveis). São as pessoas que já viram o card e têm contexto; começar sem o criador trancaria o autor para fora do próprio card quando outra pessoa restringe. Criador **anonimizado** não entra (RN38: conta anonimizada não fica em lista de acesso); criador desativado entra, como qualquer responsável desativado, e recupera o acesso se for reativado.
63. **Anonimizar tira das listas (RN38)**: `POST /api/admin/users/:userId/anonymize` apaga as linhas de `card_viewers` da pessoa, na mesma transação. Desativar **não** apaga nada. Card cuja lista ficou vazia continua restrito e só Admin abre.
64. **`objectKey` fora do prefixo do card → `400 VALIDATION_ERROR`** com `details[0].path = "objectKey"`, antes de qualquer ida ao R2. O formato também é garantido pelo `CHECK` do banco (I14), então nem uma falha de código grava chave de outro card.
65. **As idas ao R2 ficam fora da transação que bloqueia o card.** A confirmação checa acesso e estado numa transação curta somente leitura (404 → 403 → 409), faz `HEAD` + `Range` sem transação aberta e só então abre a transação que bloqueia o card, grava e registra a atividade. Assim uma rede lenta não segura o lock do card por até 10 s.
66. **URL de leitura**: janela de 5 min (`COVER_READ_WINDOW_MS`), validade de 15 min a partir do início da janela e cache em memória de até 500 entradas (`objectKey|janela`). `cover.expiresAt` é o fim da validade da janela corrente, então o front sabe quando refazer a leitura. O cache é por processo e não precisa de invalidação: a janela vira sozinha.
67. **`features` vem da configuração, não do papel**: `appFeatures(app)` devolve `{ cardCovers: app.coverStorage !== null }`, e `app.coverStorage` é `null` quando faltam as variáveis do R2. As respostas de setup, login, **aceite de convite** e `auth/me` trazem o mesmo objeto.
68. **Limpeza**: `runMaintenance` devolve também `coverObjects` (órfãos apagados). Sem R2, é sempre `0`; erro de rede na varredura vira log e não interrompe as outras limpezas.

### 18.9 Fatia 11 refeita: restrição e capa no **quadro** (v1.13)

O cliente corrigiu o alvo da fatia depois da implementação: restringir e dar capa a **quadros**, não
a cards. A migration `0009` cria as estruturas do quadro e derruba as do card. Substitui §18.7 e
§18.8; as ADRs 0015 e 0016 foram revistas no mesmo sentido.

69. **Um lugar só decide acesso, agora no quadro.** `modules/boards/access.ts` exporta a função pura
    (`canAccessBoard`), o `assertBoardAccess` (`403 BOARD_RESTRICTED`) e o predicado SQL
    (`boardAccessCondition`). `lockBoard()`/`lockWritableBoard()` (quadro e listas) e `lockCard()`
    (cards, checklists, comentários, etiquetas, responsáveis) chamam o assert sobre a **linha já
    bloqueada**, depois do 404 e antes de qualquer 409. `POST /api/lists/:listId/cards` checa
    explicitamente (o card ainda não existe, então não passa pelo `lockCard`). `move` entre quadros
    checa os **dois** quadros. Uma rota nova de conteúdo só escapa se não usar nenhum dos locks.
70. **O card não tem mais visibilidade, lista de acesso nem capa.** Saíram `cards.visibility`,
    `card_viewers`, `card_covers`, as rotas `PUT /api/cards/:cardId/visibility`,
    `PUT|DELETE /api/cards/:cardId/viewers/:userId` e as três de capa do card, o `LockedCard`/
    `BoardCard` do payload, os erros `CARD_RESTRICTED`/`CARD_NOT_RESTRICTED` e os cinco tipos de
    atividade `card_visibility_*`/`card_viewer_*`/`card_cover_*`. Atribuir responsável voltou a ser
    só atribuir (a RN31/RN32 do card não existe mais: o acesso é do quadro).
71. **Quadro bloqueado é outro tipo, não um quadro com nulos.** `LockedBoard = { id, name, locked }`;
    `Board` ganha `locked: false`, `visibility` e `cover`; `GET /api/boards` passa a ser união
    discriminada. O serializer do Fastify corta qualquer campo extra. `GET /api/boards/:boardId`,
    `/archived` e toda mutação respondem `403 BOARD_RESTRICTED` — o quadro não abre, então não existe
    "card bloqueado dentro de quadro aberto".
72. **Payload do quadro continua em 6 consultas**: o quadro e a capa vêm num `LEFT JOIN` só. Quadro
    restrito custa +1 (a lista de acesso da resposta) e, para quem não é Admin, +1 (o `EXISTS` de
    `board_viewers` do assert). Teste garante o número.
73. **Filtrar, não bloquear, onde o card é "meu trabalho"**: `GET /api/me/cards` e a
    listagem/contador de notificações omitem cards de quadros sem acesso (predicado correlacionado
    por `cards.board_id`, servido pela PK de `board_viewers`).
74. **Lista inicial ao restringir: ator + criador do quadro** (RN30 adaptada). Não existe
    "responsável de quadro"; quem mais precisar entra por
    `PUT /api/boards/:boardId/viewers/:userId`. Criador anonimizado fica de fora (RN38); criador
    desativado entra e recupera o acesso se for reativado. Anonimizar apaga as linhas de
    `board_viewers` da pessoa, como antes fazia com `card_viewers`.
75. **Quadro restrito não gera atividade.** A tabela de histórico é `card_activities` (por card) e o
    produto não tem tela de histórico de quadro, então mudanças de visibilidade, de lista de acesso
    e de capa **não** geram registro: a alternativa seria uma tabela nova (`board_activities`) e uma
    tela para ela, fora do pedido. Fica anotado como item de V2 caso o cliente peça auditoria.
76. **Ordem dos erros nas rotas de capa**: 400 (chave fora do prefixo) → 404 → `403 BOARD_RESTRICTED`
    → `409 BOARD_ARCHIVED` → 503 → `409 COVER_UPLOAD_INVALID`. O `DELETE` também checa acesso e
    estado **antes** do 503, então quem não tem acesso nunca descobre se a instância tem R2.
77. **`features.boardCovers`** substitui `features.cardCovers` nas respostas de setup, login, aceite
    de convite e `auth/me`. O resto do bloco de R2 (variáveis tudo-ou-nada, janela de 5 min da URL
    assinada, validade de 15 min, cache em memória, varredura de órfãos em 24 h) continua igual —
    inclusive o prefixo `covers/`, agora com o `boardId` no lugar do `cardId`. Como a varredura
    apaga todo objeto sob `covers/` sem linha em `board_covers` e com mais de 24 h, os arquivos das
    antigas capas de card são recolhidos sozinhos depois do deploy.

### 18.10 Foto de perfil (v1.14)

Muda schema: migration `0010_user_avatars`.

78. **Onde ficam os bytes**: tabela `user_avatars` (`user_id` PK → `users` `ON DELETE CASCADE`, `content_type`, `bytes` `bytea`, `updated_at`), com `CHECK` de tipo e de tamanho (1–128 KB), fora de `users` para que nenhum `SELECT` de usuário carregue imagem. Diferente da capa do quadro (R2, ADR 0016), a foto **não** usa armazenamento externo: são 128 KB por pessoa, o backup do banco já os leva junto, e assim o avatar funciona em instância sem R2 configurado.
79. **Versão espelhada em `users.avatar_updated_at`** (nulo sem foto), gravada na mesma transação dos bytes: sessão, `GET /api/users` e administração devolvem `avatarUpdatedAt` sem join nem bytes. O front monta `/api/users/:id/avatar?v=<avatarUpdatedAt>`; a URL muda quando a foto muda, e por isso essa rota pode ser cacheada.
80. **Recorte e compressão no cliente** (`src/lib/avatar-file.ts` no `ronin-web`): quadrado central, 256 px, WebP com qualidade decrescente e JPEG como reserva (navegador que não codifica WebP), até caber em 128 KB. O servidor não decodifica imagem — confere tamanho e assinatura do arquivo (PNG, JPEG e o cabeçalho `RIFF`/`WEBP`) e devolve sempre com `X-Content-Type-Options: nosniff`.
81. **Anonimizar apaga a foto** (LGPD): a linha de `user_avatars` cai na mesma transação e `avatar_updated_at` volta a nulo.
