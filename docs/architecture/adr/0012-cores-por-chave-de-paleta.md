# ADR 0012: Cores de listas e etiquetas por chave de paleta; prioridade com níveis fixos

- Status: aceito
- Data: 2026-09-16

## Contexto
O cliente quer um visual colorido estilo Monday (`scope.md` v2, Decisão 6). Listas têm cor (funcionam como "status"), etiquetas têm cor, e cards têm prioridade opcional com 4 níveis de cor fixa. Não pode haver seletor de cor livre (RN15), e nenhuma informação pode depender só de cor (RN17). Há tema claro (padrão) e escuro, com meta WCAG 2.2 AA.

## Decisão
- Banco e API guardam só uma **chave**: enum `palette_color` (`gray`, `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple`, `magenta`; a ordem do enum é a ordem da paleta), usado em `lists.color` e `labels.color` (ambos obrigatórios).
- Lista nova sem cor informada recebe a próxima cor depois da cor da última lista ativa (cíclico). Quadro novo: `blue`, `orange`, `green`. A regra fica em `packages/shared/src/domain/palette.ts` (`nextPaletteColor`).
- Prioridade: enum `card_priority` (`low`, `medium`, `high`, `urgent`), coluna `cards.priority` nula por padrão. Não afeta a ordem manual; só pesa em "Meus cards".
- Valores visuais só em `src/styles/globals.css` do ronin-web, por tema: `--palette-<cor>-bg|fg|border` e `--priority-<nivel>-bg|fg`. Prioridade e lista sempre acompanhadas de texto.

## Alternativas
- Hex livre: não garante contraste nem se adapta ao tema escuro (viola RN15).
- Campo "status" separado das listas: duplicaria informação (rejeitado no escopo).
- Níveis de prioridade por quadro: aproxima de campos personalizados (V2).

## Consequências
- O designer ajusta os tons sem migration nem mudança de API; basta manter contraste AA.
- Mudar o conjunto de chaves da paleta exige migration (estender o enum), schema Zod e tokens nos dois temas.
