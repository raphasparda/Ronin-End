# ADR 0003: Hash de senha com Argon2id via @node-rs/argon2

- Status: aceito
- Data: 2026-09-16

## Contexto
Requisito de hash forte e adaptativo. O desenvolvimento acontece em Windows e a produção em container Linux; dependências nativas que exigem node-gyp/compilador costumam quebrar no Windows.

## Decisão
- Argon2id com parâmetros OWASP: `memoryCost 19456 KiB`, `timeCost 2`, `parallelism 1`.
- Biblioteca `@node-rs/argon2` (Rust/napi, binários pré-compilados para win32-x64, linux-x64 musl/glibc e arm64).
- Parâmetros reduzidos só com `NODE_ENV=test`.
- Login com usuário inexistente executa `verify` contra hash fictício para manter tempo de resposta constante.

## Alternativas
- `argon2` (node-argon2): também boa, mas historicamente mais atrito de build nativo no Windows.
- `bcrypt`: aceitável, porém limita senha a 72 bytes e é menos resistente a GPU.
- `crypto.scrypt` nativo: sem dependência, mas Argon2id é a recomendação atual.

## Consequências
- Login custa ~50–100 ms de CPU por tentativa, mitigado por rate limit.
- Hashes são autodescritivos (PHC string): parâmetros podem subir no futuro com rehash no login.
