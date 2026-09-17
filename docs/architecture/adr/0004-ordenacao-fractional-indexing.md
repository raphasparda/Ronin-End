# ADR 0004: Ordenação de listas, cards e itens por fractional indexing

- Status: aceito
- Data: 2026-09-16

## Contexto
Listas, cards e itens de checklist são reordenados por arrastar e por "Mover para…". A ordem é a mesma para todos (RN07). Há risco de "card pulando" e posições duplicadas com edições concorrentes.

## Decisão
- Coluna `position text COLLATE "C"` com chaves da biblioteca `fractional-indexing` (`generateKeyBetween`). Mover um item grava **apenas** a linha dele.
- O cliente envia posição relativa (`Placement`: `start`, `end` ou `after: id`), nunca a chave. O servidor calcula a chave:
  1. Em transação, bloqueia a linha pai (`SELECT ... FOR UPDATE` no quadro para listas, na(s) lista(s) para cards, no checklist para itens). Com duas listas, bloqueia em ordem de id (evita deadlock).
  2. `start`: entre `null` e a menor posição ativa; `end`: entre a maior e `null`; `after X`: entre `X.position` e a próxima posição ativa maior. O próprio item é excluído do cálculo.
  3. `X` inexistente, arquivado, de outro pai ou igual ao item → `409 INVALID_PLACEMENT`.
- Índice único parcial `(parent_id, position) WHERE archived_at IS NULL` (itens de checklist: sem parcial). Itens restaurados recebem nova chave no fim.
- Se a chave gerada passar de 64 caracteres, rebalancear todos os irmãos do pai na mesma transação com `generateNKeysBetween(null, null, n)`.
- No front, ordenar com comparação binária (`a < b`), nunca `localeCompare`. Posição temporária otimista é gerada no cliente só para exibição.

## Alternativas
- Inteiros com renumeração: grava N linhas por movimento e conflita mais.
- Float/decimal entre vizinhos: perde precisão após muitas inserções no mesmo ponto.
- Lista encadeada (prev/next): consultas de leitura mais caras e reparos difíceis.

## Consequências
- Movimentos concorrentes no mesmo pai são serializados pelo lock (latência desprezível no porte).
- Colação `"C"` é obrigatória; esquecê-la quebra a ordem. O customType `textC` do Drizzle evita o erro e há teste cobrindo ordem com chaves de maiúsculas/minúsculas.
