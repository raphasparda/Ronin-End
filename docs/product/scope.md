# Ronin — Kanban da equipe: escopo do MVP

> Documento de produto. As decisões de stack e deploy tomadas pelo cliente estão registradas em "Decisões confirmadas". Os detalhes técnicos ficam em `docs/architecture/` e o visual no design system do ronin-web (`docs/design/`).
> Status: rascunho v2 (2026-09-16). Autor: Raphael Sparda.
> v2: gamificação removida (entrou por engano, vinha de outro projeto do cliente); visual colorido estilo Monday; deploy em VPS; cor por lista e prioridade do card incluídas.

## 0. Perguntas em aberto (com suposição padrão)

As quatro perguntas da v1 foram respondidas pelo cliente. Veja "Decisões confirmadas" no fim do documento (itens 1 a 4).

Suposições em vigor, que não travam o time (confirmar com o cliente quando der):

| # | Suposição padrão | O que muda se for diferente |
|---|------------------|-----------------------------|
| S1 | **Uma instância = um workspace (uma equipe).** | Vários workspaces exigem isolamento de dados e troca de workspace na interface. Fica para depois. |
| S2 | Porte: equipe de até 5 pessoas no início (confirmado pelo cliente), com folga para até ~20 usuários, 50 quadros ativos e 1.000 cards por quadro. | Um porte maior pode antecipar paginação e tempo real. |
| S3 | Interface só em pt-BR, com fuso padrão America/Sao_Paulo. | i18n fica para depois. |
| S4 | Prioridade do card com 4 níveis fixos (Baixa, Média, Alta, Urgente), cada um com cor fixa. | Níveis personalizados por quadro se aproximam de "campos personalizados", que ficam para depois. |
| S5 | A preferência de alternar o tema no cabeçalho continua valendo, agora com as cores vivas do estilo Monday. Tema claro é o padrão. | Se o cliente quiser só um tema, sai um item pequeno de design. |

---

## 1. Contexto e problema

O cliente quer uma ferramenta de gestão de tarefas em quadros, no estilo Trello, ClickUp ou Monday, para ele e a equipe. Ela vai rodar em uma **VPS própria, com domínio próprio e backend próprio**.

**Problema real.** As ferramentas SaaS resolvem o fluxo básico (quadro, colunas, cards), mas:
- os dados ficam com terceiros, e o cliente quer controle total (já recusou BaaS por segurança);
- vêm cheias de funções que uma equipe pequena não usa (automações, gantt, dezenas de views), o que deixa o dia a dia pesado.

**O que fazem hoje (suposição):** usam uma ferramenta SaaS gratuita ou listas soltas (planilha, chat). As tarefas se perdem em conversas, não fica claro quem é o responsável e os prazos vencem sem ninguém ver.

**Frequência:** uso diário. Cada membro abre a ferramenta várias vezes por dia para ver o que tem para fazer e atualizar o andamento.

**Proposta de valor do MVP:** um kanban simples, rápido e **colorido** (fácil de ler de relance, como o Monday), com dados próprios. Ele responde três perguntas: *o que eu tenho que fazer?*, *em que pé está cada coisa?* e *quem está com o quê?*.

**Princípios de produto** (guiam o que entra e como a interface se comporta):

1. **Leitura de relance.** Situação, urgência e responsável aparecem numa olhada no quadro.
2. **Equipe pequena, ferramenta pequena.** Cada função precisa se justificar para uma equipe de até cinco pessoas; o resto fica para depois.
3. **Dados da equipe, servidor da equipe.** Auto-hospedado, sem serviços de terceiros no caminho dos dados.
4. **Atualizar sem atrito.** Criar, mover e concluir um card leva segundos.
5. **Sem mecânica de pressão.** Nada de gamificação ou comparação entre pessoas.
6. **Cor nunca sozinha.** Prioridade, prazo e status da lista sempre têm texto ou ícone além da cor (RN17).

## 2. Personas

**P1. Raphael, dono/gestor (Admin).**
Montou a equipe e a instância. Cria quadros, convida pessoas, distribui tarefas e acompanha prazos. Também executa tarefas.
*Jobs:* "Quero ver rápido o que está atrasado, o que é urgente e quem está com o quê." "Quero colocar alguém na equipe sem depender de ninguém."

**P2. Membro da equipe (Member).**
Executa as tarefas e atualiza o andamento. Não administra a instância.
*Jobs:* "Quero abrir e ver só o que é meu, por prazo e prioridade." "Quero registrar o progresso sem burocracia."

(Não há persona de cliente externo ou convidado no MVP.)

## 3. Conceitos do domínio

| Conceito | Definição no MVP |
|----------|------------------|
| **Instância / Workspace** | Uma instalação do sistema, que equivale a uma equipe. Guarda usuários e quadros. |
| **Usuário** | Conta com nome, e-mail e senha (auth própria). Pertence ao workspace. |
| **Papel** | `Admin`: gerencia membros e convites e pode excluir de vez quadros, cards e comentários. `Member`: cria e edita quadros, listas e cards. O primeiro usuário da instância vira Admin. |
| **Quadro (board)** | Conjunto de listas. Tem nome e pode ser arquivado. Tem no máximo uma lista marcada como "de conclusão". |
| **Lista (coluna)** | Coluna ordenável dentro de um quadro, com **cor** escolhida de uma paleta fixa. Funciona como o "status" do card, no estilo Monday. Pode ser renomeada, reordenada, recolorida e arquivada. |
| **Card** | Unidade de trabalho: título, descrição (texto com formatação básica), responsáveis (0..n), prazo (data, com hora opcional), **prioridade** (opcional), etiquetas, checklists, comentários, estado (`aberto`/`concluído`) e arquivado (sim/não). |
| **Prioridade** | Nível opcional do card: Baixa, Média, Alta ou Urgente. Cada nível tem uma cor fixa e um rótulo em texto. |
| **Atribuição** | Vínculo entre o card e os responsáveis. Gera notificação para quem foi atribuído. |
| **Prazo** | Data de entrega. Pode estar "vencendo" (em até 24h), "atrasado" ou "concluído". |
| **Etiqueta (label)** | Nome e cor viva (da paleta), definidos **por quadro**. |
| **Checklist** | Lista de itens marcáveis dentro do card. Mostra o progresso (x/y) na face do card. |
| **Comentário** | Texto de um usuário no card. O autor pode editar e excluir o seu. |
| **Conclusão** | Evento em que o card passa de `aberto` para `concluído`, com data e autor registrados. Pode ser desfeito com "reabrir". |
| **Atividade** | Registro automático e imutável das mudanças do card (criado, movido, atribuído, prazo ou prioridade alterados, concluído, reaberto…). |
| **Notificação** | Aviso **dentro do app** (sino) para eventos que afetam o usuário. Sem e-mail ou push no MVP. |

## 4. Objetivos e métricas de sucesso

| Objetivo | Métrica | Meta (4 semanas após implantar) |
|----------|---------|----------------------------------|
| Substituir a ferramenta/planilha atual | Equipe usando só o app para tarefas | 100% dos membros ativos em ≥ 4 dias por semana |
| Responsabilidade clara | % de cards abertos com pelo menos um responsável | ≥ 80% |
| Prazos e urgências visíveis | Cards atrasados ou urgentes percebidos a tempo | Qualitativo: o gestor diz que "não é mais pego de surpresa" |
| Uso sem atrito | Tempo para criar um card simples | ≤ 10 s (criação rápida inline) |
| Operação na VPS | Tempo para subir a instância com domínio e HTTPS seguindo a documentação | ≤ 30 min |

> As métricas vêm de conversa com o cliente e de consultas no próprio banco. **Não entra telemetria externa nem analytics de terceiros.**

## 5. User stories e critérios de aceite

Legenda de prioridade: **MVP** (entra) · **V2** (depois).

### Épico A. Instância, contas e equipe

**A1 [MVP]. Configuração inicial.** Como Admin, quero criar a primeira conta na instância nova, para começar a usar sem mexer no banco.
- Dado uma instância sem usuários, quando acesso o app, então vejo a tela de configuração inicial (nome do workspace, meu nome, e-mail e senha).
- Dado que concluí a configuração, então minha conta é criada como `Admin` e a tela de configuração não aparece mais para ninguém.

**A2 [MVP]. Convidar membro.** Como Admin, quero gerar um link de convite, para colocar alguém na equipe.
- Dado que sou Admin, quando gero um convite (com e-mail opcional e papel), então recebo um link de uso único que vale por 7 dias.
- Dado um link válido, quando a pessoa abre o link e informa nome, e-mail e senha, então a conta é criada com o papel do convite e o link deixa de valer.
- Dado um link expirado, usado ou revogado, quando a pessoa abre o link, então vê "convite inválido" e nenhuma conta é criada.
- Dado que sou Member, então não vejo a opção de convidar.
- Não existe cadastro público aberto.

**A3 [MVP]. Login e logout.** Como usuário, quero entrar com e-mail e senha, para acessar meus quadros.
- Dado credenciais válidas, quando faço login, então entro no app e a sessão continua ativa entre visitas até eu sair ou ela expirar.
- Dado credenciais inválidas, então vejo uma mensagem genérica ("e-mail ou senha incorretos"), sem revelar se o e-mail existe.
- Dado 5 tentativas erradas seguidas para o mesmo e-mail ou IP, então novas tentativas ficam bloqueadas por alguns minutos.
- Quando faço logout, então a sessão é invalidada no servidor.

**A4 [MVP]. Redefinir senha sem e-mail.** Como Admin, quero gerar um link de redefinição para um membro, para destravar quem esqueceu a senha.
- Dado que sou Admin, quando gero o link de redefinição de um usuário, então recebo um link de uso único que vale por 24h.
- Quando o usuário define a nova senha pelo link, então todas as sessões anteriores dele são encerradas.

**A5 [MVP]. Gerenciar membros.** Como Admin, quero ver os membros, mudar o papel e desativar contas, para manter a equipe em ordem.
- Dado que sou Admin, quando desativo um membro, então ele não consegue mais entrar e as sessões dele são encerradas. Os cards, comentários e atividades dele continuam, com o nome visível.
- Não é possível desativar ou rebaixar o último Admin ativo.

**A6 [MVP]. Meu perfil.** Como usuário, quero mudar meu nome e minha senha, para manter minha conta atualizada.
- Trocar a senha pede a senha atual.

### Épico B. Quadros e listas

**B1 [MVP]. Criar quadro.** Como membro, quero criar um quadro, para organizar um projeto ou área.
- Quando crio um quadro com nome, então ele aparece para todos os membros e já vem com as listas "A fazer" (azul), "Fazendo" (laranja) e "Concluído" (verde). A última é marcada como lista de conclusão. Os nomes das cores são ilustrativos; a paleta final é do design.

**B2 [MVP]. Listar quadros.** Como membro, quero ver todos os quadros ativos, para entrar no que preciso.
- A página inicial mostra os quadros ativos. Os arquivados ficam em uma seção separada e podem ser restaurados.

**B3 [MVP]. Gerenciar listas.** Como membro, quero criar, renomear, reordenar, colorir e arquivar listas, para refletir meu fluxo.
- A ordem das listas é salva e aparece igual para todos.
- Uma lista nova recebe a próxima cor da paleta. Posso trocar a cor por outra da paleta fixa, e a mudança aparece para todos.
- Ao arquivar uma lista, os cards dela saem do quadro junto com ela e voltam se a lista for restaurada.
- Quando marco uma lista como "de conclusão", então a marcação sai da lista anterior (no máximo uma por quadro).

**B4 [MVP]. Renomear e arquivar quadro.** Como membro, quero renomear e arquivar quadros, para manter a lista limpa.
- Só o Admin pode **excluir** um quadro de forma definitiva, com confirmação digitando o nome.

### Épico C. Cards

**C1 [MVP]. Criação rápida.** Como membro, quero criar um card digitando só o título no fim de uma lista, para registrar a tarefa em segundos.
- Quando digito o título e aperto Enter, então o card é criado no fim da lista e o campo continua aberto para o próximo.
- Título vazio não cria card.

**C2 [MVP]. Detalhe do card.** Como membro, quero abrir o card e editar título, descrição, responsáveis, prazo, prioridade e etiquetas, para registrar o contexto.
- A descrição aceita formatação básica (negrito, listas, links, código). Links abrem em nova aba com proteção contra `opener`.
- A face do card mostra: título, marca de cor da lista atual, prioridade (cor e texto), etiquetas, avatares/iniciais dos responsáveis, prazo com estado (normal, vencendo, atrasado, concluído), progresso do checklist e contador de comentários.

**C3 [MVP]. Mover card.** Como membro, quero arrastar o card entre listas e dentro delas, para atualizar o andamento.
- Quando solto o card em outra posição, então a nova ordem é salva e aparece para todos na próxima atualização.
- Existe uma alternativa sem arrastar: a ação "Mover para…" (quadro, lista e posição), usável pelo teclado e no celular.
- Se o salvamento falhar, o card volta para a posição original e aparece uma mensagem de erro.

**C4 [MVP]. Atribuir responsáveis.** Como gestor, quero atribuir um ou mais membros ao card, para deixar claro quem faz.
- Só é possível atribuir usuários ativos do workspace.
- Quando atribuo alguém que não sou eu, então essa pessoa recebe uma notificação.

**C5 [MVP]. Prazo.** Como membro, quero definir um prazo, para saber o que está vencendo.
- Se o card está aberto e o prazo passou, aparece como "atrasado". Se faltam até 24h, aparece como "vencendo". Se o card está concluído, aparece como "concluído", sem alerta.
- Datas são salvas em UTC e mostradas no fuso configurado do workspace (padrão America/Sao_Paulo).

**C6 [MVP]. Etiquetas.** Como membro, quero criar etiquetas com nome e cor no quadro e aplicá-las aos cards, para categorizar.
- A cor vem da mesma paleta viva do produto.
- Excluir uma etiqueta tira ela de todos os cards do quadro (com confirmação).

**C7 [MVP]. Checklist.** Como membro, quero adicionar checklists com itens marcáveis, para quebrar a tarefa em passos.
- É possível adicionar, editar, marcar/desmarcar, reordenar e excluir itens.
- O progresso (x/y) aparece na face do card.
- Marcar todos os itens **não** conclui o card de forma automática.

**C8 [MVP]. Comentários.** Como membro, quero comentar no card, para discutir sem sair do contexto.
- Os comentários aparecem em ordem cronológica, com autor e data.
- O autor pode editar (fica a marca "editado") e excluir o próprio comentário. O Admin pode excluir qualquer um.
- Quando alguém comenta, então os responsáveis pelo card (menos o autor) recebem notificação.

**C9 [MVP]. Concluir e reabrir.** Como membro, quero concluir um card, para registrar a entrega.
- Quando movo o card para a lista de conclusão **ou** clico em "Concluir", então o estado vira `concluído`, a data e o autor da conclusão são registrados na atividade e o card vai para a lista de conclusão (se o quadro tiver uma).
- Quando tiro um card concluído da lista de conclusão, então o estado volta a `aberto` e a reabertura fica registrada na atividade.
- Quando clico em "Reabrir" em um card que está na lista de conclusão, então o estado volta a `aberto` e o card vai para o topo da primeira lista ativa que não é de conclusão.
- Um quadro sem lista de conclusão ainda permite "Concluir" e "Reabrir" pelo botão, e o card fica onde está.

**C10 [MVP]. Arquivar card.** Como membro, quero arquivar cards, para limpar o quadro sem perder o histórico.
- Os cards arquivados podem ser consultados e restaurados pelo quadro. A exclusão definitiva é só do Admin.

**C11 [MVP]. Filtro no quadro.** Como membro, quero filtrar o quadro por responsável, etiqueta, prioridade, prazo (atrasado, vencendo, sem prazo) e texto do título, para achar o que importa.
- O filtro vale só para a minha visualização e mostra de forma clara que há um filtro ativo.

**C12 [MVP]. Histórico de atividade.** Como gestor, quero ver o histórico do card, para entender o que aconteceu.
- Ficam registrados: criação, mudança de título, movimentação entre listas, atribuir/remover responsável, mudança de prazo e de prioridade, conclusão/reabertura, arquivamento/restauração. Cada registro tem autor e data.
- A atividade não pode ser editada nem excluída pela interface.

**C13 [MVP]. Prioridade.** Como gestor, quero marcar a prioridade de um card, para a equipe ver de relance o que é mais urgente.
- Posso escolher Baixa, Média, Alta, Urgente ou deixar sem prioridade (padrão).
- A prioridade aparece na face do card com cor **e** texto, sem depender só da cor.
- Mudar a prioridade não mexe na posição do card na lista (a ordem continua manual).

### Épico D. Visão pessoal e notificações

**D1 [MVP]. Meus cards.** Como membro, quero uma tela com todos os cards abertos atribuídos a mim, em todos os quadros, para saber o que fazer hoje.
- Grupos: Atrasados · Vencendo (24h) · Com prazo · Sem prazo.
- Dentro de cada grupo, a ordem é por prazo e depois por prioridade (Urgente primeiro).
- Cada item mostra o quadro e a lista de origem (com a cor da lista), mostra a prioridade e abre o detalhe do card.

**D2 [MVP]. Notificações no app.** Como membro, quero ser avisado quando algo me afeta, para não depender de alguém me chamar.
- Eventos: fui atribuído a um card; comentaram em um card em que sou responsável.
- O ícone de notificações mostra quantas não foram lidas. Clicar em uma notificação abre o card e marca como lida. Há a opção "marcar todas como lidas".
- Não há notificação de prazo no MVP, porque "Meus cards" já mostra isso sem precisar de job agendado.

## 6. Regras de negócio

**Contas e acesso**
- RN01. Não existe cadastro público. Só é possível entrar na instância por convite ou pela configuração inicial.
- RN02. O e-mail é único na instância, sem diferenciar maiúsculas e minúsculas.
- RN03. Deve existir sempre pelo menos um Admin ativo.
- RN04. Usuário desativado não faz login. O conteúdo dele continua, com o nome visível.
- RN05. Todo usuário ativo lê e edita todos os quadros não excluídos (Decisão 1). Ações destrutivas definitivas (excluir quadro, card ou comentário de terceiros) são só do Admin.

**Quadros, listas e cards**
- RN06. Cada quadro tem 0 ou 1 lista de conclusão.
- RN07. A ordem de listas e cards é definida pelo usuário e é a mesma para todos.
- RN08. Arquivar é reversível. Excluir é definitivo, só o Admin faz, e pede confirmação.
- RN09. Um card pertence a exatamente uma lista. Mover entre quadros é permitido, e as etiquetas que não existem no quadro de destino são removidas (com aviso).
- RN10. Se dois usuários editam o mesmo campo, vale a última gravação (*last write wins*). Não há bloqueio de edição no MVP.

**Conclusão** (Decisão 3)
- RN11. "Concluir" é o evento em que o card passa de `aberto` para `concluído`, seja pelo botão ou movendo para a lista de conclusão. Os dois caminhos geram o mesmo registro (data e autor) na atividade.
- RN12. Na lista de conclusão, um card fica sempre `concluído`. Tirar o card de lá o reabre, e reabrir pelo botão tira o card de lá (C9).
- RN13. Concluir de novo um card reaberto gera um novo registro. O histórico guarda todas as conclusões e reaberturas.
- RN14. Card concluído não aparece em "Meus cards" e não mostra alerta de prazo.

**Cores e prioridade** (Decisão 6)
- RN15. As cores de listas e etiquetas vêm de uma **paleta fixa** definida pelo design. Não existe seletor de cor livre, para manter contraste e acessibilidade.
- RN16. Os níveis de prioridade são fixos (Baixa, Média, Alta, Urgente) e o campo é opcional. A prioridade não altera a ordem manual dos cards no quadro. Ela só pesa na ordenação de "Meus cards" (D1).
- RN17. Nenhuma informação depende só de cor: prioridade, prazo e status (lista) também aparecem em texto ou ícone.

**Notificações**
- RN18. Ninguém recebe notificação de uma ação feita por si mesmo.
- RN19. Notificações lidas com mais de 90 dias podem ser apagadas automaticamente.

## 7. Requisitos não funcionais

**Segurança** (backend e auth próprios, exposto na internet com domínio próprio)
- Senhas guardadas com hash forte e adaptativo (algoritmo a cargo do architect). Nunca guardar nem registrar em log a senha em texto puro.
- Sessão com expiração, invalidada no logout, na troca ou redefinição de senha e na desativação da conta.
- Limite de tentativas de login, de uso de convites e de redefinição de senha.
- Autorização checada **no servidor** em toda rota, com testes automatizados.
- Proteção contra XSS na descrição e nos comentários (sanitizar o conteúdo formatado), CSRF (conforme o modelo de sessão) e injeção de SQL.
- Tokens de convite e redefinição aleatórios, de uso único, com expiração, guardados como hash.
- **HTTPS obrigatório**, com certificado emitido e renovado de forma automática (Decisão 7). HTTP redireciona para HTTPS. Cookies de sessão só trafegam por conexão segura.
- Só as portas necessárias ficam expostas na VPS. O banco de dados não fica acessível pela internet.

**Privacidade / LGPD**
- Dados pessoais mínimos: nome, e-mail e hash de senha. Sem telemetria ou analytics de terceiros e sem fontes/CDNs externos que rastreiem o usuário (a escolha técnica fica com o architect).
- O Admin consegue **anonimizar** um usuário desativado (nome vira "Usuário removido", e-mail é apagado), mantendo a integridade dos cards e comentários.
- Logs do servidor sem conteúdo de cards nem dados sensíveis.

**Performance** (para o porte de S2)
- Quadro com 500 cards abre em ≤ 2 s em uma rede comum. Mover um card aparece na tela na hora (atualização otimista) e é confirmado em ≤ 500 ms.
- "Meus cards" em ≤ 1 s.
- Precisa rodar bem em uma VPS de entrada (ex.: 1–2 vCPU, 2 GB de RAM), com app e banco na mesma máquina.

**Atualização entre usuários**
- Sem tempo real no MVP. Os dados recarregam ao abrir o quadro, ao voltar o foco para a aba e periodicamente (ex.: a cada 30–60 s) com o quadro aberto. Last write wins é aceitável (RN10).

**Acessibilidade**
- WCAG 2.2 nível AA como meta. O **visual colorido estilo Monday** tem que manter contraste de texto AA sobre as cores vivas de listas, etiquetas e prioridades (RN15, RN17).
- Toda ação de arrastar tem alternativa sem arrastar (C3), conforme o critério 2.5.7.
- Navegação completa por teclado, foco visível e rótulos em ícones.

**Operação (VPS Linux com domínio próprio)**
- Instalação documentada em uma VPS Linux limpa, com domínio apontado e HTTPS automático, reproduzível em ≤ 30 min.
- Migrações de banco versionadas e aplicadas no deploy.
- Backup automático do PostgreSQL, com cópia **fora da VPS**, e restauração documentada e testada pelo menos uma vez.
- Health check simples para monitoramento. O app volta sozinho depois de um reboot da VPS.
- Procedimento de atualização de versão documentado.

**Compatibilidade**
- Últimas 2 versões de Chrome, Edge, Firefox e Safari. Responsivo básico (Decisão 4).

## 8. MVP / Depois / Fora de escopo

Critério de priorização: **valor** para uma equipe pequena no uso diário × **esforço** × **risco** (segurança e complexidade que não dá para desfazer).

### MVP

| Item | Por quê |
|------|---------|
| Configuração inicial, convite por link, login/logout, redefinição de senha pelo Admin, gerenciar membros (A1–A6) | Sem isso não há uso em equipe. O link manual dispensa SMTP (Decisão 2). |
| Quadros, listas e lista de conclusão (B1–B4) | É o núcleo do produto. |
| Cards com responsáveis, prazo, etiquetas, checklist, comentários, concluir/reabrir, arquivar (C1–C10) | O conjunto mínimo que faz a equipe trocar de ferramenta. Cada item é barato e depende só do próprio card. |
| **Cor por lista** (B3) | **Barato:** um campo de cor escolhido de paleta fixa, sem tela nova. **Útil:** entrega o visual de "status colorido" do Monday (Decisão 6) sem criar um campo de status separado, que duplicaria as listas. |
| **Prioridade do card com cores** (C13) | **Barato:** um campo com 4 valores fixos, que reaproveita o filtro (C11) e a ordenação de "Meus cards" (D1). **Útil:** responde "o que é urgente?" de relance, que o prazo sozinho não responde. Níveis personalizados ficam para depois. |
| Arrastar e soltar com alternativa "Mover para…" | O kanban não funciona sem isso. A alternativa é exigência de acessibilidade e cobre o celular. |
| Filtro no quadro (C11) | Custo baixo (pode rodar no cliente) e valor alto quando o quadro cresce. |
| Atividade do card (C12) | Custo baixo quando gravada junto com cada mutação. Dá rastreabilidade ao gestor e serve de base para as notificações. |
| "Meus cards" (D1) | É a resposta a "o que eu faço hoje?". Uma consulta só. Substitui notificações de prazo e views extras. |
| Notificações no app: atribuição e comentário (D2) | Custo moderado e valor alto. Sem e-mail e sem jobs agendados. |
| Deploy documentado em VPS com HTTPS automático e backup | Decisão 7. Sem isso o produto não entra em uso real com segurança. |

**Itens do estilo Monday avaliados e deixados de fora do MVP:**
- *Cor ou ícone por quadro:* barato, mas o valor é só estético. Vai para V2.
- *Campo "status" separado das listas:* duplicaria a informação que a lista colorida já dá e criaria dúvida sobre qual dos dois vale. Não entra.
- *View em tabela/grade (a cara do Monday):* é uma segunda interface inteira de edição. Esforço médio a alto. Vai para V2.
- *Colunas ou campos personalizados:* esforço e risco de modelo de dados altos. Vai para V2+.

### Depois (V2+), em ordem sugerida

1. **Tempo real (WebSocket/SSE).** Com até cerca de 20 usuários, recarregar ao focar a aba mais um polling leve resolve. Tempo real traz conexões persistentes, reconexão e conflitos. Entra se a equipe reclamar de dados desatualizados.
2. **Anexos.** Exigem storage na VPS, limite de tamanho, checagem de tipo, backup de arquivos e trazem risco de upload malicioso. No MVP, colar links na descrição cobre a maior parte.
3. **Menções (@usuário) em comentários, com notificação.** Barato, mas não essencial. Bom primeiro item da V2.
4. **View em tabela estilo Monday** e depois calendário. Gantt fica por último.
5. **Notificações por e-mail e lembrete de prazo** (precisam de SMTP e de jobs agendados).
6. **Quadros privados e membros por quadro.**
7. Cor ou ícone por quadro; níveis de prioridade personalizados.
8. Busca global entre quadros; modelos de quadro; cards recorrentes.
9. Campos personalizados, dependências entre cards, estimativa.
10. Várias instâncias ou workspaces na mesma instalação.
11. Exportar e importar (JSON/CSV; importar do Trello).

### Fora de escopo (não planejado)

- **Gamificação de qualquer tipo** (pontos, níveis, sequências, rankings, recompensas). Decisão 5.
- **Supabase, Firebase, PocketBase ou qualquer BaaS**, e login social. Decisão 8: backend e auth próprios.
- Automações/regras (estilo Butler do Trello ou automações do Monday). Esforço e risco altos para uma equipe pequena.
- Controle de tempo (time tracking), faturamento, CRM.
- App nativo mobile e modo offline.
- Multi-tenant SaaS, cobrança, planos.
- Integrações de terceiros (Slack, GitHub etc.) no primeiro ciclo.

## 9. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| **Auth própria com falha de segurança** (sessão, reset, convite), agravada pela exposição na internet | Média | Alto | Seguir os requisitos da seção 7, usar bibliotecas consolidadas para hash e sessão, testes de autorização, limite de tentativas e uma revisão de segurança dedicada antes de colocar em produção. |
| **VPS mal operada** (backup só na mesma máquina, certificado que não renova, banco exposto, sistema sem atualização) | Média | Alto | Documentação de deploy, backup fora da VPS e HTTPS automático fazem parte da definição de pronto. Checklist de hardening básico da VPS. |
| **Visual colorido prejudica a leitura** (contraste ruim, "carnaval" de cores) | Média | Médio | Paleta fixa validada para contraste AA (RN15), informação nunca só por cor (RN17), design define a hierarquia. |
| **Arrastar e soltar com bugs de ordenação** (posições conflitantes, card "pulando") | Média | Médio | O architect define uma estratégia de ordenação robusta. Rollback visual quando dá erro. Recarregar a lista depois de mover. |
| **Crescimento de escopo** ("igual ao ClickUp/Monday") | Alta | Alto | Este documento fecha o MVP. Qualquer item novo entra em "Depois" e precisa de repriorização explícita. |
| **Edições concorrentes sem tempo real** | Baixa (equipe pequena) | Baixo | Last write wins, recarga ao focar a aba e atividade para rastrear. |

## 10. Definição de pronto do MVP

- Todas as stories marcadas **[MVP]** com os critérios de aceite passando.
- Testes automatizados de autorização e das regras de conclusão/reabertura (RN11–RN14).
- Instância rodando em VPS Linux com domínio próprio, HTTPS automático e backup fora da VPS com restauração testada.
- Documentação de instalação, atualização (migrações) e backup/restauração.
- Checagem de acessibilidade básica (teclado, contraste da paleta, alternativa ao arrastar).
- Uma semana de uso real pelo cliente com a equipe, sem bugs bloqueantes.

## Decisões confirmadas pelo cliente (2026-09-16)
1. Visibilidade: todos os membros veem todos os quadros no MVP (quadros privados depois).
2. E-mail: sem SMTP. Convite e redefinição de senha por link gerado pelo Admin.
3. Conclusão: mover para a lista marcada "Concluído" OU clicar em "Concluir". É o mesmo evento, registrado na atividade.
4. Celular: responsivo básico com "Mover para…"; arrastar e soltar garantido só no desktop.
5. Sem gamificação neste projeto (nada de XP, níveis, sequências, rankings ou recompensas).
6. Visual colorido estilo Monday: cores vivas por lista/status e etiquetas. A paleta e os detalhes ficam com o design.
7. Deploy em VPS Linux com domínio próprio e HTTPS automático.
8. Backend próprio confirmado (Node/Fastify + PostgreSQL + Drizzle, auth própria com e-mail e senha). Nunca BaaS (Supabase/Firebase/PocketBase).
