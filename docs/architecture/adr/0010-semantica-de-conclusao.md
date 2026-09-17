# ADR 0010: Semântica única de conclusão (botão e lista "Concluído")

- Status: aceito (revisado 2026-09-16 conforme `scope.md` v2: sem gamificação; reabrir vai para o topo)
- Data: 2026-09-16

## Contexto
Decisão do cliente: mover para a lista de conclusão **ou** clicar em "Concluir" é o mesmo evento, registrado com data e autor. O escopo v2 fixa: na lista de conclusão o card está sempre concluído (RN12); tirar de lá reabre; "Reabrir" pelo botão leva o card ao topo da primeira lista ativa não-conclusão; quadro sem lista de conclusão conclui/reabre pelo botão sem mover o card.

## Decisão
Um único serviço (`modules/completion`), chamado por `complete`, `reopen`, `move`, `restore` de card e pela marcação de lista, na mesma transação e com o card bloqueado:
1. `complete` em card aberto: registra `completed_at`/`completed_by` e move para o fim da lista de conclusão (se houver e o card não estiver nela). Sem lista de conclusão, o card fica onde está.
2. `reopen` em card concluído: reabre, limpa `completed_*` e, se o card está na lista de conclusão, move para o **topo** da primeira lista ativa não-conclusão (menor posição). Fora dela, fica onde está.
3. `move` de card aberto para lista de conclusão: conclui. `move` de card concluído **saindo** da lista de conclusão para lista comum (mesmo quadro ou outro): reabre, na posição pedida. Nos demais casos só move.
4. Criar card diretamente na lista de conclusão é recusado (`409 LIST_IS_DONE_LIST`).
5. Marcar uma lista como de conclusão conclui os cards abertos não arquivados que estão nela (ator = quem marcou; UI confirma antes). Desmarcar ou arquivar a lista não reabre ninguém.
6. Restaurar card aberto cuja lista é de conclusão também o conclui.
7. `complete`/`reopen` repetidos são no-op idempotentes.

## Alternativas
- Reabrir pelo botão mantendo o card na lista "Concluído": viola RN12.
- Bloquear a marcação de lista com cards abertos (409): mais atrito para o usuário; concluir em massa com confirmação é mais natural e não tem efeito colateral agora que não existe gamificação.
- Criar card já concluído na lista de conclusão: mistura criação e conclusão num único evento e confunde o histórico.

## Consequências
- Invariante garantida: card em lista de conclusão ativa está sempre `completed`. O inverso não vale (card concluído pelo botão em quadro sem lista de conclusão, ou após desmarcar a lista).
- Teste de matriz cobre: status × lista origem (conclusão/comum) × lista destino (conclusão/comum) × mesmo/outro quadro × quadro com/sem lista de conclusão, além de marcação de lista e restauração.
