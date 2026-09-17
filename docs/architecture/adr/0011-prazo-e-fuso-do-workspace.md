# ADR 0011: Prazos em UTC interpretados no fuso do workspace

- Status: aceito
- Data: 2026-09-16

## Contexto
Prazo é data com hora opcional; salvo em UTC e exibido no fuso do workspace (padrão `America/Sao_Paulo`). Navegadores dos membros podem estar em fusos diferentes.

## Decisão
- Entrada: `{ date: "YYYY-MM-DD", time: "HH:mm" | null }` no fuso do workspace; o servidor converte com `@date-fns/tz`.
- Armazenamento: `due_at timestamptz` + `due_has_time boolean`. Sem hora → `23:59:59.999` do dia no fuso do workspace.
- Exibição sempre no fuso do workspace (não do navegador), com `@date-fns/tz` no front.
- Estado do prazo por função pura compartilhada `getDueState` (concluído, sem prazo, atrasado, vencendo ≤ 24h, agendado), usada na face do card, no filtro e em Meus cards.

## Alternativas
- Guardar `date` puro para prazos sem hora: exigiria dois caminhos de comparação.
- Usar o fuso do navegador: membros em fusos diferentes veriam estados diferentes.

## Consequências
- Mudar o fuso do workspace não reescreve `due_at` já salvo (a hora "absoluta" é preservada); prazos só-data podem aparecer em outro dia se o fuso mudar muito. Aceitável e raro.
