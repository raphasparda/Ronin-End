# ADR 0009: Deploy em mesma origem com Caddy e Docker Compose

- Status: aceito
- Data: 2026-09-16

## Contexto
VPS Linux de entrada (1–2 vCPU, 2 GB RAM) com domínio próprio (decisão do cliente), instalação em ≤ 30 min, HTTPS automático, banco inacessível pela internet, retorno automático após reboot, sem CORS (ADR 0002). Desenvolvimento no Windows com Postgres via docker-compose.

## Decisão
- **Dev:** `docker-compose.yml` sobe só o PostgreSQL 18 (volume nomeado montado em `/var/lib/postgresql`, que é o caminho exigido pela imagem 18). API (`tsx watch`, porta 3000) e web (Vite, 5173) rodam no host; Vite faz proxy de `/api` para `http://localhost:3000`. O script de init cria `kanban_test`.
- **Produção:** `infra/docker-compose.prod.yml` com `postgres`, `api` (imagem Node 24 alpine; entrypoint aplica migrations e inicia) e `caddy` (serve o `dist/` do ronin-web copiado na imagem, faz `reverse_proxy /api/* api:3000`, gzip/zstd, headers de segurança e CSP). Alvo confirmado pelo cliente: VPS Linux com domínio próprio, HTTPS automático (Let's Encrypt) pelo Caddy.
- Só o Caddy publica portas (80/443, com redirecionamento HTTP para HTTPS). Postgres, API e `backup` ficam na rede interna do compose; o Postgres **nunca** declara `ports:` (o Docker ignora o UFW em portas publicadas). UFW no host libera só 22/80/443.
- Todos os serviços com `restart: unless-stopped` e healthchecks; Docker habilitado no boot. O app volta sozinho após reboot da VPS.
- Backup fora da VPS pelo container `backup` (ADR 0013).
- `TRUST_PROXY=true` na API para `request.ip` correto.

## Alternativas
- Nginx + certbot: mais configuração manual de certificado.
- API servindo os estáticos (`@fastify/static`): possível, mas mistura responsabilidades e ainda exigiria TLS na frente.
- Origens separadas (`app.` e `api.`): exige CORS com credenciais e cookie cross-site.

## Consequências
- Uma única URL pública; cookies `__Host-` funcionam.
- Documentação de instalação, atualização e backup (`pg_dump`) entra no MVP (Fatia 10).
