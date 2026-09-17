# ADR 0013: Backup do PostgreSQL fora da VPS com restic

- Status: aceito
- Data: 2026-09-16

## Contexto
`scope.md` v2 exige backup automático com cópia **fora da VPS** e restauração documentada e testada. A VPS é de entrada (2 GB de RAM), com app e banco na mesma máquina. Um backup só local se perde junto com a VPS.

## Decisão
- Container `backup` no `infra/docker-compose.prod.yml` (imagem baseada em `postgres:18-alpine` + `restic` + `supercronic`), na rede interna, sem portas publicadas.
- Todo dia às 03:00 (America/Sao_Paulo): `pg_dump -Fc` para arquivo temporário, `restic backup` para o repositório remoto, `restic forget --prune --keep-daily 7 --keep-weekly 4 --keep-monthly 6`, e `restic check` semanal.
- Destino configurável por variáveis (`RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, credenciais): S3 compatível, Backblaze B2 ou SFTP para outro servidor. Dados criptografados no cliente pelo restic.
- Monitoramento: script `backup-check` retorna erro se o último sucesso tiver mais de 26 h (para cron/monitor externo); falhas vão para o log do container.
- Restauração documentada em `docs/operations/backup.md` (`restic restore` → `pg_restore --clean` em banco novo) e ensaiada numa VM limpa antes do go-live e depois a cada 6 meses.
- A senha do repositório restic fica guardada **fora da VPS** pelo cliente (sem ela o backup é irrecuperável).

## Alternativas
- `pg_dump` + `rclone`: não traz criptografia, deduplicação e retenção integradas.
- Snapshot do provedor da VPS: útil como camada extra, mas fica no mesmo provedor e não é portátil.
- Backup físico/PITR (pgBackRest, WAL-G): mais robusto, mas complexo demais para o porte; revisitar se a perda aceitável ficar menor que 24 h.

## Consequências
- RPO de até 24 h e RTO estimado de ~30 min (subir stack + restaurar).
- O cliente precisa contratar/indicar o destino externo (ponto em aberto de operação, não bloqueia o desenvolvimento).
