# ADR 0007: Descrição e comentários em Markdown renderizado sem HTML

- Status: aceito
- Data: 2026-09-16

## Contexto
Descrição do card aceita formatação básica (negrito, listas, links, código) e links devem abrir em nova aba sem `opener`. Requisito de proteção contra XSS.

## Decisão
- O servidor guarda **texto Markdown cru**; não gera nem armazena HTML.
- O front renderiza com `react-markdown` + `remark-gfm`, **sem** `rehype-raw` (HTML embutido é exibido como texto), com `urlTransform` padrão (bloqueia `javascript:`, `data:` etc.) e componente `a` com `target="_blank" rel="noopener noreferrer"`. Imagens não são renderizadas (componente `img` vira link).
- Edição por `textarea` com abas "Escrever/Visualizar". Comentários usam o mesmo renderizador.
- CSP `script-src 'self'` como segunda camada.

## Alternativas
- Editor WYSIWYG (TipTap/ProseMirror) com HTML sanitizado (DOMPurify): mais pesado, exige sanitização no servidor e no cliente.
- Texto puro: não atende "formatação básica".

## Consequências
- Não há HTML armazenado para sanitizar; o risco de XSS fica concentrado em uma configuração de componente, coberta por teste (`<script>`, `javascript:` e `<img onerror>` não executam).
- Usuários precisam de sintaxe Markdown básica; a UI mostra uma dica curta.
