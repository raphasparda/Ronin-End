# ADR 0015: Visibilidade do card (`team`/`restricted`) e payload bloqueado

- Status: aceito
- Data: 2026-09-17
- Fatia 11

## Contexto

Até a Fatia 10 vale a decisão 1 do cliente: todo usuário ativo lê e edita todos os quadros e todos os cards (RN05). O cliente pediu agora **cards restritos**: um card pode ficar visível só para um conjunto de pessoas, mantendo o resto do quadro compartilhado. As regras vieram fechadas:

- o card tem `visibility: 'team' | 'restricted'` e uma lista de pessoas com acesso;
- quem não tem acesso **continua vendo o card no quadro**, com o título e um cadeado, e não pode abrir, editar, comentar nem mover;
- **Admin sempre vê tudo**.

Restrições técnicas: o payload do quadro (`GET /api/boards/:boardId`) precisa continuar em 6 consultas, sem N+1, para 500 cards em ≤ 2 s (Render Free, Neon Free); e a serialização da API descarta campos não declarados no schema, o que só protege se o schema do card bloqueado for **outro tipo**, e não o mesmo com campos nulos.

## Decisão

**Modelo.** Enum `card_visibility ('team','restricted')`, coluna `cards.visibility not null default 'team'` (todo o acervo existente vira `team` sem backfill) e tabela `card_viewers (card_id, user_id, added_by, created_at)` com PK `(card_id, user_id)` e índice em `(user_id)`.

**Regra de acesso** (uma função só, `canAccessCard`, em `src/modules/cards/access.ts`):

```
acesso = visibility = 'team'  OU  ator.role = 'admin'  OU  existe card_viewers(card, ator)
```

A mesma regra existe em três formas, todas no mesmo arquivo: a função pura (usada pelo shared/front para esconder botões), o `assertCardAccess` (lança `403 CARD_RESTRICTED`) e o predicado SQL `cardAccessCondition(actor)`, reaproveitado por toda listagem. Nada de repetir a condição em cada rota.

**Onde a checagem entra.** Toda mutação de card, checklist, comentário, etiqueta e responsável já passa por `lockCard()` (`modules/cards/service.ts`), que é o ponto único de lock (quadro → listas → card). A checagem entra **dentro do `lockCard`**, depois do 404 e antes do `409 BOARD_ARCHIVED`, o que mantém a ordem de `api.md` §3 (404 → 403 → 409) e cobre por construção qualquer rota nova que use o lock. As leituras de card (`GET /api/cards/:cardId`, `/activity`) chamam `assertCardAccess` direto.

**Payload bloqueado.** Onde o card aparece em lista (payload do quadro e arquivados), quem não tem acesso recebe **outro objeto**, não uma versão nula do card:

```ts
type LockedCard = { id, listId, position, title, locked: true };
```

Nada além disso: sem etiquetas, responsáveis, prazo, prioridade, contadores, descrição, capa, status ou `archivedAt`. O array de cards passa a ser uma união discriminada por `locked` (`CardSummary` ganha `locked: false`), então o serializer do Fastify garante o corte mesmo se o serviço errar. Em SQL, as consultas de agregados, etiquetas e responsáveis recebem também o predicado de acesso: os dados do card bloqueado não chegam nem a sair do banco.

`GET /api/me/cards` e as notificações **filtram** (não bloqueiam): um card que a pessoa não pode abrir não serve como item de trabalho nem como aviso.

**Manutenção da lista de acesso.** `PUT /api/cards/:cardId/visibility` e `PUT|DELETE /api/cards/:cardId/viewers/:userId`, disponíveis para quem tem acesso ao card (RN05 continua valendo dentro do círculo de acesso). Ao restringir, o ator e os responsáveis atuais viram viewers na mesma transação; atribuir alguém a um card restrito também o torna viewer. Voltar para `team` apaga as linhas de `card_viewers`.

## Alternativas

- **Esconder o card de quem não tem acesso.** Menos vazamento (nem o título sai), mas o cliente quer o cadeado visível: a equipe precisa saber que existe trabalho ali. Também confundiria contagens e posições no quadro. Recusada por decisão do cliente.
- **Mesmo schema com campos nulos** (`labels: [], dueAt: null, ...`). Um `null` esquecido em qualquer camada vira vazamento silencioso, e o cliente não distingue "sem prazo" de "não posso ver". A união discriminada falha fechado.
- **Responder 404 no card restrito.** Coerente com "não existe para você", mas o quadro já revela a existência; `403 CARD_RESTRICTED` permite mensagem específica na UI.
- **Acesso implícito por responsável** (responsável vê sem estar na lista). Faria toda consulta olhar duas tabelas. Preferimos materializar: atribuir insere o viewer.
- **Visibilidade por quadro** (quadros privados, V2 do escopo). Não atende o pedido: a restrição é de um card dentro de um quadro compartilhado. As duas coisas podem coexistir depois.

## Consequências

- O payload do quadro continua em 6 consultas: a regra vira um `EXISTS` correlacionado na consulta principal, servido pela PK de `card_viewers`.
- Quem perde o acesso a um card deixa de ver as notificações dele (elas não são apagadas; voltam se o acesso voltar).
- `PATCH /api/lists/:listId { isDoneList: true }` conclui **todos** os cards abertos da lista, inclusive restritos que o ator não vê: é ação de lista e RN12 não pode quebrar. É a única exceção documentada à regra de acesso; está em `api.md` §18.7.
- Quem restringe um card e se remove da lista perde o acesso (só Admin ou outro viewer devolve). A UI avisa antes; a API não cria regra de "último viewer", porque Admin sempre alcança o card.
- O front precisa tratar dois formatos de card na mesma lista; o filtro do quadro só encontra card bloqueado por texto do título (ele não tem os outros campos).
- Mudar a regra de acesso é mudar um arquivo (`access.ts`); os testes de autorização passam a ter uma matriz própria (ator × papel × visibilidade × viewer).
