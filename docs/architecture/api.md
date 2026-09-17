# Kanban: contrato da API REST (MVP)

> Status: v1.3 (2026-09-16; v1.2 alinhou ao `scope.md` v2: sem gamificação, cor por lista, prioridade do card, reabrir para o topo; v1.3 adicionou `415 UNSUPPORTED_MEDIA_TYPE`; v1.4 (2026-09-17) fechou ambiguidades ao implementar os schemas das Fatias 2 a 9, ver §18). Complementa `overview.md`. Os schemas Zod em `packages/shared/src/schemas/` são a fonte da verdade em código e devem refletir exatamente este documento. Mudança de contrato = atualizar este arquivo no mesmo PR.

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

// Posição relativa entre irmãos ativos (não arquivados) do destino.
type Placement =
  | { type: 'start' }
  | { type: 'end' }
  | { type: 'after'; id: Uuid };   // id de um irmão ativo no destino, diferente do próprio item

// Prazo na entrada, no fuso do workspace
type DueInput = { date: string /* YYYY-MM-DD */; time: string | null /* HH:mm 24h */ };

type SessionUser = { id: Uuid; name: string; email: string; role: Role };
type Workspace = { name: string; timezone: string };

// Visão pública de usuário (listas, avatares, atribuição). Sem e-mail.
type UserSummary = { id: Uuid; name: string; role: Role; status: UserStatus; anonymized: boolean };

type Board = { id: Uuid; name: string; archivedAt: IsoDateTime | null; createdAt: IsoDateTime; updatedAt: IsoDateTime };

type List = { id: Uuid; boardId: Uuid; name: string; position: string; isDoneList: boolean; color: PaletteColor; archivedAt: IsoDateTime | null };

type Label = { id: Uuid; boardId: Uuid; name: string; color: PaletteColor };

// Face do card (payload do quadro)
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
| 409 | `CONFLICT` | violação de unicidade não mapeada |
| 410 | `TOKEN_INVALID` | token de convite/reset inexistente, expirado, usado ou revogado (mensagem: "Convite inválido." / "Link de redefinição inválido.") |
| 413 | `PAYLOAD_TOO_LARGE` | corpo > 256 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | corpo com `Content-Type` diferente de `application/json` (inclui `text/plain`) |
| 429 | `TOO_MANY_ATTEMPTS` | bloqueio de login (header `Retry-After` em segundos) |
| 429 | `RATE_LIMITED` | rate limit geral/rotas de token (`Retry-After`) |
| 500 | `INTERNAL_ERROR` | inesperado |
| 503 | `SERVICE_UNAVAILABLE` | health com banco fora |

Regras transversais aplicadas por todas as rotas de conteúdo:
- Recurso de quadro arquivado: leitura ok; mutação → `409 BOARD_ARCHIVED` (exceto `restore` e `DELETE` do quadro).
- Ordem de checagem: autenticação (401) → CSRF (403) → validação (400) → existência (404) → permissão (403) → estado (409).

## 4. Saúde e setup

### `GET /api/health` · Pública
200 `{ status: 'ok', db: 'ok' }` · 503 `SERVICE_UNAVAILABLE`.

### `GET /api/setup/status` · Pública
200 `{ needsSetup: boolean }` (true se não há usuários).

### `POST /api/setup` · Pública · rate limit 5/15min/IP
Body `{ workspaceName: string, timezone?: string /* default America/Sao_Paulo */, name: string, email: string, password: string }`
- Transação com `pg_advisory_xact_lock`; se já há usuário → `409 SETUP_ALREADY_DONE`.
- Cria/atualiza `workspace`, cria usuário `admin`, cria sessão (Set-Cookie).
201 `{ user: SessionUser, workspace: Workspace }`.

## 5. Autenticação

### `POST /api/auth/login` · Pública
Body `{ email, password }` (password aqui: 1–256, para não revelar política).
- Bloqueios: `overview.md` §6.4. Sem usuários → `404 SETUP_REQUIRED`.
- Falha (e-mail inexistente, senha errada, usuário desativado/anonimizado) → `401 INVALID_CREDENTIALS`.
200 `{ user: SessionUser, workspace: Workspace }` + Set-Cookie.

### `POST /api/auth/logout` · Auth
Apaga a sessão atual e o cookie. 204. Sem sessão também retorna 204 (idempotente; CSRF ainda exigido).

### `GET /api/auth/me` · Auth
200 `{ user: SessionUser, workspace: Workspace }`.

### `POST /api/auth/invites/lookup` · Pública · rate limit 10/15min/IP
Body `{ token }`. 200 `{ email: string | null, role: Role, expiresAt }` · 410 `TOKEN_INVALID`.

### `POST /api/auth/invites/accept` · Pública · rate limit 10/15min/IP
Body `{ token, name, email, password }`
- Consome o token na mesma transação da criação do usuário (papel do convite).
- Convite com e-mail e e-mail diferente → `409 INVITE_EMAIL_MISMATCH`. E-mail já existe → `409 EMAIL_TAKEN` (token **não** é consumido).
201 `{ user: SessionUser, workspace: Workspace }` + Set-Cookie.

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

### `GET /api/me/cards` · Auth
Cards `open`, não arquivados, em lista e quadro não arquivados, com o usuário entre os responsáveis. Ordenados por `dueAt ASC NULLS LAST`, depois prioridade (`urgent`, `high`, `medium`, `low`, sem prioridade), depois `createdAt ASC`. O agrupamento (Atrasados/Vencendo/Com prazo/Sem prazo) é feito no front com `getDueState`, preservando essa ordem dentro de cada grupo (D1).
200 `{ cards: Array<CardSummary & { boardName: string; listName: string; listColor: PaletteColor }> }`.

## 7. Usuários

### `GET /api/users` · Auth
Todos os usuários (ativos, desativados e anonimizados), ordenados por nome. Usado para nomes/iniciais e seletor de responsáveis (a UI só oferece `status = 'active'`).
200 `{ users: UserSummary[] }`. **Sem e-mail.**

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

### `GET /api/boards?archived=false|true` · Auth
Padrão `archived=false`; só os valores `true` e `false` são aceitos (outro → 400). Ordem: `name ASC` (collation pt-BR no JS: o front pode reordenar com `localeCompare('pt-BR')`).
200 `{ boards: Board[] }`.

### `POST /api/boards` · Auth
Body `{ name }`. Cria quadro e listas "A fazer", "Fazendo", "Concluído" (esta com `isDoneList: true`), com cores `blue`, `orange` e `green`.
201 `{ board: Board, lists: List[] }`.

### `GET /api/boards/:boardId` · Auth
Payload do quadro (arquivado também pode ser lido):
200
```ts
{
  board: Board;
  lists: List[];          // só não arquivadas, por position
  cards: CardSummary[];   // não arquivados, de listas não arquivadas, por (listId, position)
  labels: Label[];        // por name
}
```
Implementação: 5 consultas (board, lists, cards com agregados `checklist`/`commentCount` via subconsultas agrupadas, `card_labels` do quadro, `card_assignees` do quadro). Sem N+1.

### `PATCH /api/boards/:boardId` · Auth
Body `{ name }`. `BOARD_ARCHIVED` se arquivado. 200 `{ board }`.

### `POST /api/boards/:boardId/archive` · Auth — 200 `{ board }` (idempotente)
### `POST /api/boards/:boardId/restore` · Auth — 200 `{ board }` (idempotente)

### `DELETE /api/boards/:boardId` · Admin
Body `{ confirmName: string }` (comparação exata após trim). Diferente → `400 CONFIRMATION_MISMATCH`. Exclusão definitiva com cascata. 204.

### `GET /api/boards/:boardId/archived` · Auth
200 `{ lists: List[] /* arquivadas, por archivedAt desc */, cards: Array<CardSummary & { listName: string; listArchived: boolean }> /* arquivados individualmente, por archivedAt desc */ }`.

## 10. Listas

### `POST /api/boards/:boardId/lists` · Auth
Body `{ name, color?: PaletteColor /* default: próxima cor da paleta após a cor da última lista ativa (cíclico) */, placement?: Placement /* default { type: 'end' } */ }`. 201 `{ list: List }`.

### `PATCH /api/lists/:listId` · Auth
Body `{ name?: string, isDoneList?: boolean, color?: PaletteColor }` (ao menos um). Valor fora da paleta → 400.
- `isDoneList: true`: na mesma transação desmarca a lista de conclusão anterior do quadro. Lista arquivada → `409 LIST_ARCHIVED`.
- `isDoneList: true` com cards abertos não arquivados na lista: todos são concluídos na mesma transação (ator = usuário; atividade por card), para manter RN12. Desmarcar não reabre ninguém (overview §4.2).
200 `{ lists: List[], completedCardIds: Uuid[] }` — **todas** as listas ativas do quadro (a marcação pode ter mudado em outra) e os cards concluídos por esta ação (`[]` se nenhum).

### `POST /api/lists/:listId/move` · Auth
Body `{ placement: Placement }` (dentro do mesmo quadro). 200 `{ list: List }`.

### `POST /api/lists/:listId/archive` · Auth
Arquiva; se era lista de conclusão, `isDoneList` vira `false`. Os cards somem do payload do quadro (sem mudar o próprio `archivedAt`). Idempotente. 200 `{ list }`.

### `POST /api/lists/:listId/restore` · Auth
Restaura no **fim** do quadro (nova `position`); cards voltam com as posições que tinham. Idempotente. 200 `{ list }`.

## 11. Cards

### `POST /api/lists/:listId/cards` · Auth
Body `{ title }`. Cria no fim da lista. Lista arquivada → `LIST_ARCHIVED`; lista de conclusão → `LIST_IS_DONE_LIST`. Atividade `card_created`.
201 `{ card: CardSummary }`.

### `GET /api/cards/:cardId` · Auth
200 `{ card: CardDetail }`. Card arquivado também é retornado.

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
Adiciona responsável. Usuário inexistente → 404; não ativo → `409 USER_NOT_ACTIVE`. Se novo: atividade `card_assignee_added` e notificação `card_assigned` para o usuário (se ≠ ator). Idempotente (já atribuído: sem atividade/notificação).
200 `{ assigneeIds: Uuid[] }`.

### `DELETE /api/cards/:cardId/assignees/:userId` · Auth
Remove (qualquer status de usuário). Se existia: atividade `card_assignee_removed`. Idempotente. 200 `{ assigneeIds: Uuid[] }`.

### `PUT /api/cards/:cardId/labels/:labelId` · Auth
Etiqueta de outro quadro → `409 LABEL_BOARD_MISMATCH`. Idempotente. 200 `{ labelIds: Uuid[] }`.

### `DELETE /api/cards/:cardId/labels/:labelId` · Auth
Idempotente. 200 `{ labelIds: Uuid[] }`.

### `GET /api/cards/:cardId/activity` · Auth
Até 500 itens, mais recentes primeiro. 200 `{ activities: Activity[] }`.

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
| excluir quadro, excluir card | | | x | |
| editar comentário | | | | x |
| excluir comentário | | | x | x |
| notificações (só as próprias) | | x | | |

## 17. Testes de contrato obrigatórios (QA)

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
