# ADR 0006: Atualização entre usuários por polling e foco da aba

- Status: aceito
- Data: 2026-09-16

## Contexto
O escopo não exige tempo real no MVP; aceita recarga ao abrir, ao focar a aba e periódica (30–60 s), com last write wins.

## Decisão
- TanStack Query com `refetchOnWindowFocus` e `refetchInterval` só com aba visível: quadro e detalhe do card 30 s; Meus cards e contador de notificações 60 s.
- Polling do quadro pausado durante drag e mutações de movimento pendentes; atualização otimista com rollback.
- Um endpoint de payload único por quadro para que o refetch seja uma requisição.

## Alternativas
- WebSocket/SSE: conexões persistentes, reconexão, config de proxy e fan-out; custo alto sem demanda comprovada.
- Long polling ou ETag por quadro: otimização possível depois (ETag/`updated_at` agregado) sem mudar o contrato.

## Consequências
- Até 30 s de atraso para ver mudanças de outros. Com ~20 usuários, a carga é ~1 req/s no pior caso.
- Migrar para SSE no futuro pode reaproveitar as mesmas query keys (invalidar ao receber evento).
