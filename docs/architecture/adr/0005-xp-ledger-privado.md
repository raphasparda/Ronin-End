# ADR 0005: XP como ledger append-only e privado

- Status: **removido** (2026-09-16)
- Data original: 2026-09-16

## Motivo da remoção
Decisão do cliente: este projeto **não tem gamificação**. XP, nível, sequência e as regras associadas vieram de outro projeto por engano.

## Efeito
- Não existem tabela `xp_ledger`, coluna `cards.active_xp_grant_id`, módulo `xp`, rota `GET /api/me/progress`, curva de nível, cálculo de sequência, teste de vazamento de XP nem regra de ESLint associada.
- Concluir/reabrir continua existindo, sem XP (ADR 0010).
- A anonimização de conta (LGPD) continua, sem etapa de XP (`overview.md` §5.2).

Não reintroduzir sem novo ADR e decisão explícita do cliente.
