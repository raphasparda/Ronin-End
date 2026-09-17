# ADR 0008: Convites e redefinição de senha por links gerados pelo Admin

- Status: aceito
- Data: 2026-09-16

## Contexto
Sem SMTP (decisão do cliente). O Admin gera links e os envia por fora (WhatsApp, Slack). Tokens precisam ser aleatórios, de uso único, com expiração e guardados como hash.

## Decisão
- Tabela única `auth_tokens` (`kind`: `invite` | `password_reset`). Token de 32 bytes (base64url), apenas SHA-256 no banco; URL exibida uma única vez ao Admin.
- Validade: convite 7 dias; redefinição 24 h. Nova redefinição revoga as pendentes do mesmo usuário. Convites podem ser revogados.
- Token no **fragmento** da URL (`/convite#token=...`, `/redefinir-senha#token=...`): não chega a logs do proxy/servidor nem ao `Referer`. A SPA lê, limpa o fragmento e envia no corpo JSON.
- Consumo atômico (`UPDATE ... WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING`) na mesma transação que cria a conta ou troca a senha.
- Rate limit de 10 req/15 min por IP nas rotas de lookup/uso.
- Redefinição encerra todas as sessões do usuário e não faz login automático; aceite de convite faz login.

## Alternativas
- Token no path ou query string: vaza em logs de acesso e histórico de proxy.
- Senha temporária definida pelo Admin: o Admin conheceria a senha do membro.
- Token assinado (JWT) sem estado: não garante uso único sem tabela.

## Consequências
- Quem tem o link tem o acesso até expirar; o Admin deve enviar por canal privado (dica na UI).
- Se SMTP for adotado depois, o mesmo mecanismo é reaproveitado, trocando só a entrega.
