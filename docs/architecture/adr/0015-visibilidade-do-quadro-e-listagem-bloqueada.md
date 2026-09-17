# ADR 0015: Visibilidade do quadro (`team`/`restricted`) e listagem bloqueada

- Status: aceito (revisto em 2026-09-17: o alvo passou do **card** para o **quadro**)
- Data: 2026-09-17
- Fatia 11

## Revisão de 2026-09-17

A primeira versão desta ADR aplicava a restrição ao **card**. Depois da implementação, o cliente
corrigiu o alvo: quem é restrito é o **quadro** inteiro. O desenho foi mantido peça por peça — regra
única de acesso, tipo próprio para o objeto bloqueado, 403 em vez de 404, filtro (não bloqueio) onde
o card é "meu trabalho" — trocando `cards` por `boards`:

| Antes (card) | Agora (quadro) |
|--------------|----------------|
| `cards.visibility`, `card_viewers` | `boards.visibility`, `board_viewers` |
| `LockedCard { id, listId, position, title, locked }` no payload do quadro | `LockedBoard { id, name, locked }` em `GET /api/boards` |
| `403 CARD_RESTRICTED` nas rotas do card | `403 BOARD_RESTRICTED` nas rotas do quadro, das listas, dos cards e do conteúdo deles |
| `409 CARD_NOT_RESTRICTED` | `409 BOARD_NOT_RESTRICTED` |
| lista inicial = ator + criador + responsáveis | lista inicial = ator + criador do quadro (não existe "responsável de quadro") |
| atribuir dá acesso (RN31/RN32) | não se aplica: o acesso é do quadro e quem atribui já está dentro |
| atividades `card_visibility_changed`, `card_viewer_added`, `card_viewer_removed` | nenhuma: o histórico é por card e o quadro não tem tela de histórico (`api.md` §18.9 item 75) |
| exceção da RN12 em `PATCH /lists/:id { isDoneList: true }` | não existe mais: quem marca a lista já tem acesso ao quadro inteiro |

Migration `0009` cria as estruturas do quadro e derruba as do card. O texto abaixo está atualizado;
o histórico do desenho de card está em `api.md` §18.7 e §18.8.

## Contexto

Até a Fatia 10 vale a decisão 1 do cliente: todo usuário ativo lê e edita todos os quadros e todos os cards (RN05). O cliente pediu **quadros restritos**: um quadro pode ficar visível só para um conjunto de pessoas, mantendo o resto da instância compartilhado. As regras vieram fechadas:

- o quadro tem `visibility: 'team' | 'restricted'` e uma lista de pessoas com acesso;
- quem não tem acesso **continua vendo o quadro na home**, com o nome e um cadeado, e não pode abrir, editar, comentar nem mover nada dele;
- **Admin sempre vê tudo**.

Restrições técnicas: o payload do quadro (`GET /api/boards/:boardId`) precisa continuar em 6 consultas, sem N+1, para 500 cards em ≤ 2 s (Render Free, Neon Free); e a serialização da API descarta campos não declarados no schema, o que só protege se o schema do quadro bloqueado for **outro tipo**, e não o mesmo com campos nulos.

## Decisão

**Modelo.** Enum `board_visibility ('team','restricted')`, coluna `boards.visibility not null default 'team'` (todo o acervo existente vira `team` sem backfill) e tabela `board_viewers (board_id, user_id, added_by, created_at)` com PK `(board_id, user_id)` e índice em `(user_id)`.

**Regra de acesso** (uma função só, `canAccessBoard`, em `src/modules/boards/access.ts`):

```
acesso = visibility = 'team'  OU  ator.role = 'admin'  OU  existe board_viewers(quadro, ator)
```

A mesma regra existe em três formas, todas no mesmo arquivo: a função pura (usada pelo shared/front para esconder botões), o `assertBoardAccess` (lança `403 BOARD_RESTRICTED`) e o predicado SQL `boardAccessCondition(actor)`, reaproveitado por toda listagem. Nada de repetir a condição em cada rota.

**Onde a checagem entra.** Toda mutação de quadro e de lista passa por `lockBoard()`/`lockWritableBoard()` (`modules/boards/service.ts`); toda mutação de card, checklist, comentário, etiqueta e responsável passa por `lockCard()` (`modules/cards/service.ts`), que já bloqueia os quadros envolvidos (`FOR SHARE`) antes das listas e do card. A checagem entra **dentro desses locks**, depois do 404 e antes do `409 BOARD_ARCHIVED`, o que mantém a ordem de `api.md` §3 (404 → 403 → 409) e cobre por construção qualquer rota nova que use um dos locks. As leituras (`GET /api/boards/:id`, `/archived`, `GET /api/cards/:cardId`, `/activity`) chamam `assertBoardAccess` direto. Criar card é o único caso sem lock de card (o card ainda não existe) e chama o assert explicitamente.

**Listagem bloqueada.** Em `GET /api/boards`, quem não tem acesso recebe **outro objeto**, não uma versão nula do quadro:

```ts
type LockedBoard = { id, name, locked: true };
```

Nada além disso: sem capa, visibilidade, datas, contadores ou cores de lista. O array de quadros passa a ser uma união discriminada por `locked` (`Board` ganha `locked: false`), então o serializer do Fastify garante o corte mesmo se o serviço errar. O quadro bloqueado não abre, então nenhum card, etiqueta ou comentário dele chega a ser consultado.

`GET /api/me/cards` e as notificações **filtram** (não bloqueiam): um card de quadro que a pessoa não pode abrir não serve como item de trabalho nem como aviso.

**Manutenção da lista de acesso.** `PUT /api/boards/:boardId/visibility` e `PUT|DELETE /api/boards/:boardId/viewers/:userId`, disponíveis para quem tem acesso ao quadro (RN05 continua valendo dentro do círculo de acesso). Ao restringir, o ator e o criador do quadro viram viewers na mesma transação (criador anonimizado fica de fora, RN38). Voltar para `team` apaga as linhas de `board_viewers`.

## Alternativas

- **Esconder o quadro de quem não tem acesso.** Menos vazamento (nem o nome sai), mas o cliente quer o cadeado visível: a equipe precisa saber que existe trabalho ali. Recusada por decisão do cliente.
- **Mesmo schema com campos nulos** (`cover: null, visibility: null, ...`). Um `null` esquecido em qualquer camada vira vazamento silencioso, e o cliente não distingue "sem capa" de "não posso ver". A união discriminada falha fechado.
- **Responder 404 no quadro restrito.** Coerente com "não existe para você", mas a listagem já revela a existência; `403 BOARD_RESTRICTED` permite mensagem específica na UI.
- **Restrição por card** (o desenho anterior desta ADR). Protege menos e custa mais: a regra precisa entrar em toda consulta que devolve card, os contadores e agregados viram superfície de vazamento e o front passa a lidar com dois formatos de card na mesma lista. Com o quadro como unidade, o corte é numa fronteira que já existe.
- **Permissão por lista** ou papel novo ("dono do quadro"). Mais matriz de permissão do que uma equipe de cinco pessoas precisa (princípio 2 do escopo).

## Consequências

- O payload do quadro continua em 6 consultas (quadro e capa vêm num `LEFT JOIN` só); quadro restrito custa +1 pela lista de acesso da resposta e, para quem não é Admin, +1 pelo `EXISTS` de `board_viewers`.
- Quem perde o acesso a um quadro deixa de ver as notificações dos cards dele (elas não são apagadas; voltam se o acesso voltar) e esses cards somem de "Meus cards".
- Quem restringe um quadro e se remove da lista perde o acesso (só Admin ou outro viewer devolve). A UI avisa antes; a API não cria regra de "último viewer", porque Admin sempre alcança o quadro.
- O front precisa tratar dois formatos na lista de quadros (`Board` e `LockedBoard`); dentro do quadro nada muda, porque quem entrou tem acesso a tudo.
- Mudar a regra de acesso é mudar um arquivo (`access.ts`); os testes de autorização têm uma matriz própria (ator × papel × visibilidade × viewer × rota, incluindo listas, cards e conteúdo).
- Mudanças de visibilidade e de lista de acesso **não** entram em nenhum histórico: o registro é por card e o quadro não tem tela de atividade. Se o cliente pedir auditoria, entra uma tabela `board_activities` numa fatia própria.
