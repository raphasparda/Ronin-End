# ADR 0002: Sessão server-side em cookie httpOnly e proteção CSRF

- Status: aceito
- Data: 2026-09-16

## Contexto
Auth própria por e-mail/senha. Requisitos: sessão que expira, invalidação no logout, troca/redefinição de senha e desativação; proteção contra XSS roubando credenciais e contra CSRF. Front e API ficam na mesma origem (ADR 0009).

## Decisão
- Sessão opaca guardada no Postgres (`sessions`), com token aleatório de 32 bytes no cookie e apenas o SHA-256 no banco.
- Cookie `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` e prefixo `__Host-` em produção.
- Expiração ociosa de 14 dias e absoluta de 30 dias; `last_seen_at` atualizado no máximo a cada 5 min.
- Usuário e papel recarregados do banco a cada request (mudança de papel ou desativação valem na hora).
- CSRF em métodos mutáveis: `Origin` deve ser igual a `APP_ORIGIN` (ou `Sec-Fetch-Site: same-origin` se `Origin` ausente) **e** header `X-Ronin-Csrf: 1` obrigatório; corpo só JSON. Sem CORS habilitado.

## Alternativas
- JWT de acesso + refresh rotativo: exige lista de revogação para cumprir "invalidar sessões", mais peças móveis e nenhum ganho para um único servidor.
- Token no `localStorage`: exposto a XSS.
- Token CSRF sincronizador (double submit): funciona, mas com `SameSite=Lax`, checagem de `Origin` e header customizado (que força preflight cross-origin, recusado por não haver CORS) a proteção é equivalente com menos estado.

## Consequências
- Uma consulta indexada por request para validar sessão (aceitável no porte).
- Revogação é imediata e simples (`DELETE FROM sessions WHERE user_id = ...`).
- Clientes não-navegador precisam enviar `Origin` e o header; não há API pública para terceiros no MVP.
