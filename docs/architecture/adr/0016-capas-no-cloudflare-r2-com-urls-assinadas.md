# ADR 0016: Capa do quadro no Cloudflare R2, com upload direto e URLs assinadas de leitura

- Status: aceito (revisto em 2026-09-17: a capa é do **quadro**, não do card)
- Data: 2026-09-17
- Fatia 11

## Revisão de 2026-09-17

A primeira versão desta ADR dava capa ao **card**. O cliente corrigiu o alvo: a capa é do **quadro**
(tile da home e topo da tela do quadro). O mecanismo é o mesmo, trocando `card` por `board`:
`board_covers` no lugar de `card_covers`, chave `covers/<boardId>/<32 base64url>`, rotas
`POST|PUT|DELETE /api/boards/:boardId/cover*` e `features.boardCovers` na sessão. Como cada quadro
tem no máximo uma capa, o volume no bucket cai de "uma imagem por card" para "uma por quadro", o que
folga ainda mais a cota do plano gratuito. Migration `0009`; histórico do desenho de card em
`api.md` §18.7.

## Contexto

O cliente quer **capa de imagem no quadro**: uma imagem escolhida do computador, mostrada no tile da home e no topo da tela do quadro. O escopo do MVP deixou anexos para a V2 justamente por causa do storage (`scope.md` §8), mas a decisão do cliente para a Fatia 11 fecha o meio: **Cloudflare R2, bucket privado, leitura por URLs assinadas de curta duração geradas pela API**, para que a imagem de um card restrito (ADR 0015) não vaze.

Restrições que pesam na escolha:

- A API roda no Render Free: **512 MB de RAM**, uma instância, hibernação após ~15 min e cold start de até um minuto (`docs/ops/deploy-render.md` §8). Bytes de imagem passando pelo processo competem com o resto.
- O Render Free não tem disco persistente, e o Neon Free tem 0,5 GB: a imagem não pode ficar nem em disco nem no banco.
- A instância precisa **continuar funcionando sem R2 configurado** (o recurso desliga, o app não quebra).
- O limite de corpo da API é 256 KB (`413 PAYLOAD_TOO_LARGE`), pensado para JSON.

## Decisão

**1. Upload direto do navegador para o R2, com URL pré-assinada (PUT), e confirmação na API.**

```
front                          API                              R2
  │  POST /boards/:id/cover/upload-url { contentType, sizeBytes }
  │ ─────────────────────────────►  (checa acesso, quadro ativo, tipo e tamanho)
  │ ◄───────────────────────────── { uploadUrl, objectKey, expiresAt }
  │  PUT uploadUrl (bytes da imagem, Content-Type assinado)  ────────────────►
  │  PUT /boards/:id/cover { objectKey, width, height }
  │ ─────────────────────────────►  HEAD do objeto + 16 primeiros bytes ─────►
  │ ◄───────────────────────────── { board } (grava, apaga a capa anterior)
```

A URL de upload vale 5 minutos e assina `content-type` e `content-length`: o navegador não consegue enviar outro tipo nem outro tamanho sem invalidar a assinatura. Na confirmação, a API **reconfere** com um `HEAD` (tamanho e `Content-Type` gravados) e lê os **16 primeiros bytes** (GET com `Range`) para validar a assinatura do formato (JPEG, PNG, WebP, AVIF). Objeto que não passa é apagado e a rota responde `409 COVER_UPLOAD_INVALID`.

Alternativa descartada: **upload através da API** (`multipart/form-data`, a API repassa ao R2). Exigiria `@fastify/multipart`, limite de corpo diferente por rota e buffer/stream de vários MB em uma instância de 512 MB que também serve o quadro inteiro; num cold start, o primeiro upload pagaria o boot mais a transferência dobrada (cliente → Render → R2). O ganho seria validar os bytes antes de gravar — que a confirmação com `HEAD` + magic bytes cobre em quase toda a superfície, com dois requests baratos.

**2. Leitura por URL assinada de curta duração, com validade "quantizada".**

O bucket é privado; nada é público. A API assina um GET por objeto e devolve em `cover.url` dentro da listagem de quadros e do payload do quadro. Assinar é HMAC local (sem chamada de rede), então nem uma home com dezenas de quadros custa I/O.

O vencimento é **arredondado para janelas de 5 minutos** e a validade é de 15 minutos a partir do início da janela (validade efetiva entre 10 e 15 min). Assim a mesma URL é gerada por 5 minutos seguidos: o polling de 30 s do quadro não muda a string, o cache do navegador funciona e a imagem não pisca a cada refetch. A URL assinada também carrega `response-cache-control: private, max-age=600`.

**3. Chave do objeto inadivinhável e amarrada ao quadro.**

`covers/<boardId>/<32 caracteres base64url>` (24 bytes de `crypto.randomBytes`). O prefixo por quadro dá varredura barata de órfãos e a amarração é garantida no banco por `CHECK` que compara a chave com o `board_id` da linha. Como a confirmação só aceita chave com o prefixo do próprio quadro e o objeto só existe se a API assinou o PUT, não é preciso guardar estado de "upload pendente".

**4. Ciclo de vida dos objetos.**

| Evento | Efeito no R2 |
|--------|--------------|
| Trocar a capa | grava a nova, apaga a anterior na mesma transação lógica (após o commit) |
| Remover a capa / excluir o quadro | apaga o objeto |
| Upload iniciado e nunca confirmado | fica órfão; a limpeza diária (`plugins/maintenance.ts`) lista `covers/`, compara com `board_covers` e apaga o que não tem linha e tem mais de 24 h (é o que também recolhe as antigas capas de card, migration `0009`) |

A exclusão no R2 nunca desfaz a transação do banco: se o `DELETE` do objeto falhar, registra-se no log e o objeto vira órfão, colhido pela limpeza.

**5. Sem SDK da AWS: assinatura SigV4 própria em `src/lib/r2.ts`.**

O que precisamos é presign de `PUT`/`GET`, `HEAD`, `DELETE` e `ListObjectsV2` — tudo alcançável com URLs assinadas por query string e `fetch`. São ~150 linhas com `node:crypto`, sem dependência nova. `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` acrescentariam alguns MB ao bundle do `tsup` e tempo de boot em um serviço que **hiberna e acorda o tempo todo**, para usar 5 operações. Fica registrado como caminho de saída se um dia precisarmos de multipart, retomada ou replicação.

**6. Recurso opcional, fail-closed na configuração.**

As variáveis `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` e `R2_SECRET_ACCESS_KEY` são opcionais, mas **tudo ou nada** (`config/env.ts` recusa subir com parte delas). Sem R2: `features.boardCovers = false` nas respostas de sessão, o front não mostra "Adicionar capa", `cover` sai sempre `null` e as rotas de capa respondem `503 COVER_STORAGE_UNAVAILABLE`. Nada mais muda — quadro, cards e o resto do app seguem iguais.

## Alternativas

- **Imagem no PostgreSQL (`bytea`)**: simples e transacional, mas come os 0,5 GB do Neon Free, engorda backup e dump e faz a API servir bytes.
- **Disco do Render**: não existe no plano Free (e o serviço é efêmero).
- **Bucket público com chave inadivinhável**: dispensaria assinar, mas uma URL de quadro restrito vazada valeria para sempre. Contraria a decisão do cliente.
- **Proxy de leitura pela API** (`GET /api/boards/:id/cover` lendo do R2 e repassando): autorização por request e mesma origem (sem mexer na CSP), ao custo de todo byte de imagem passar pela instância Free e nunca ser cacheado pelo navegador com proveito. Fica anotado como plano B se as URLs assinadas incomodarem.
- **Thumbnails no servidor** (`sharp`): binário pesado, memória e CPU que o Free não tem. O redimensionamento é feito **no navegador** antes do upload (máx. 1600 px no maior lado), o que também reduz o tráfego.
- **`image/svg+xml` e `image/gif`**: SVG é HTML executável (XSS se um dia for servido em outra origem) e GIF animado pesa; ambos ficam fora da lista de tipos aceitos.

## Consequências

- Aparece o **primeiro serviço externo no caminho dos dados**, o que contraria o princípio "dados da equipe, servidor da equipe" do escopo. É decisão explícita do cliente, limitada a imagens de capa; o `scope.md` e o risco ficam registrados.
- A CSP do front (ronin-web) precisa de `img-src` com o host do R2, e o bucket precisa de regra de CORS permitindo `PUT` a partir do `APP_ORIGIN`. Sem isso, o upload falha no navegador.
- Uma URL assinada compartilhada dá acesso à imagem por até 15 minutos, inclusive de quadro restrito. Risco aceito em troca do custo zero de proxy; mitigado pelo TTL curto.
- A API passa a ter uma dependência de rede opcional: toda chamada ao R2 tem timeout curto (5 s) e falha vira `503 COVER_STORAGE_UNAVAILABLE`, nunca 500.
- Custo: R2 Free cobre 10 GB de armazenamento e as classes de operação de sobra para uma equipe pequena; não há custo de egresso. Com uma capa por quadro (e não por card), o consumo é irrisório.
