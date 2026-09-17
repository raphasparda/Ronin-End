# Ronin — Kanban da equipe: escopo do MVP

> Documento de produto. As decisões de stack e deploy tomadas pelo cliente estão registradas em "Decisões confirmadas". Os detalhes técnicos ficam em `docs/architecture/` e o visual no design system do ronin-web (`docs/design/`).
> Status: rascunho v3 (2026-09-17). Autor: Raphael Sparda.
> v2: gamificação removida (entrou por engano, vinha de outro projeto do cliente); visual colorido estilo Monday; deploy em VPS; cor por lista e prioridade do card incluídas.
> v3: seção 11 acrescentada com o escopo da **Fatia 11** (capa do card no Cloudflare R2 e cards restritos), mais as decisões 9 e 10 do cliente. As seções 0 a 10 continuam valendo como estão: descrevem o MVP entregue.

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

---

# 11. Fatia 11 — Capa do card e cards restritos

> Escrito em 2026-09-17, depois do MVP (fatias 1–10) já em produção. Duas funções, uma fatia. As duas decisões do cliente estão fechadas (itens 9 e 10 de "Decisões confirmadas") e **não voltam à mesa**: capa enviada do computador e guardada no Cloudflare R2 em bucket privado, com URL assinada de curta duração; card restrito continua aparecendo no quadro com título e cadeado.
> Numeração: as stories seguem nos épicos **E** (capa) e **F** (restrição); as regras de negócio seguem em **RN20**; os requisitos não funcionais complementam a seção 7; as decisões do cliente seguem em **9** e **10**.

## 11.0 Perguntas em aberto (com suposição padrão)

| # | Pergunta | Suposição padrão em vigor | O que muda se for diferente |
|---|----------|---------------------------|-----------------------------|
| S6 | A restrição vale só para o card? | **Sim.** Não existe quadro nem lista restrita nesta fatia (quadros privados continuam em V2, seção 8). | Restringir um quadro inteiro é outro modelo de permissão e outra fatia. |
| S7 | Existe "solicitar acesso" para quem vê o cadeado? | **Não.** A pessoa fala com quem participa do card ou com um Admin. | Um botão "Pedir acesso" cria notificação, fila de pedidos e resposta. Fica para depois. |
| S8 | Qual o tempo de validade da URL assinada da capa? | **15 minutos**, renovada na leitura do quadro/detalhe. | Mais tempo = janela maior se o link vazar; menos tempo = mais renovações. Faixa aceitável: 5 a 60 min, a cargo do architect. |
| S9 | Limite de tamanho da capa? | **5 MB** por imagem, formatos JPEG, PNG e WebP. | Limite maior consome mais rápido os 10 GB do plano gratuito do R2 e pesa no quadro. |
| S10 | Quantas pessoas cabem na lista de acesso? | **Sem limite próprio**: no máximo o tamanho da equipe (S2, ~20 pessoas). | Nada muda no modelo. |
| S11 | Quem paga/opera a conta do Cloudflare R2 (bucket, credenciais, região, plano)? | **O cliente**, com bucket dedicado ao Ronin e credenciais com permissão só nesse bucket. | Se o cliente não quiser conta externa, a alternativa é guardar no disco da VPS — muda a arquitetura e o backup. **Confirmar antes de começar a fatia.** |
| S12 | A capa entra no backup? | **Sim**, o bucket tem versionamento/retenção próprios ou cópia no mesmo plano de backup (detalhe de operação). | Sem isso, restaurar o banco devolve cards com capa quebrada. |

## 11.1 Contexto e problema

Depois de algumas semanas de uso real, apareceram dois pedidos:

**a) "O quadro é um muro de texto."** Cards de trabalho visual (peça gráfica, tela de site, print de bug) só se distinguem pelo título. A equipe abre um por um para lembrar do que se trata. Frequência: diária, em quadros de design e de marketing. O que fazem hoje: colam link de nuvem externa na descrição — quebra, exige login de outro serviço e ninguém vê nada de relance. Isso contraria o princípio 1 ("leitura de relance").

**b) "Nem tudo pode ser de todo mundo."** Hoje todo usuário ativo lê e edita todos os quadros (RN05, Decisão 1). Existem poucos assuntos sensíveis (salário, desligamento, proposta comercial, dado de cliente) que precisam ficar entre duas ou três pessoas. Hoje a saída é não registrar no Ronin — a tarefa some do fluxo da equipe. Frequência: baixa (alguns cards por mês), impacto alto.

**Proposta de valor da fatia:** dar cara ao card (capa) sem depender de serviço externo no meio do caminho, e permitir guardar o assunto sensível **dentro** da ferramenta, sem transformar o Ronin em um sistema de permissões. O card restrito continua ocupando seu lugar no quadro, com cadeado: a equipe sabe que existe trabalho ali, sem ver o conteúdo.

**Princípios que continuam valendo:** equipe pequena, ferramenta pequena (nada de papéis novos nem de matriz de permissão por quadro); atualizar sem atrito; cor/ícone nunca sozinhos (o cadeado tem texto acessível).

## 11.2 Conceitos novos no domínio

| Conceito | Definição |
|----------|-----------|
| **Capa (cover)** | Uma imagem por card, enviada do computador da pessoa, guardada no Cloudflare R2 em bucket privado. Aparece na face do card (no quadro) e no detalhe do card. |
| **Visibilidade do card** | `equipe` (padrão) ou `restrito`. |
| **Lista de acesso** | Pessoas que podem abrir um card restrito. Tem no mínimo uma pessoa. Admins ativos têm acesso implícito e não aparecem na lista. |
| **Card bloqueado (para mim)** | Card restrito do qual eu não faço parte. Aparece no quadro com título e cadeado e não abre. |

## 11.3 Objetivos e métricas de sucesso

| Objetivo | Métrica | Meta (3 semanas após a entrega) |
|----------|---------|----------------------------------|
| Reconhecer o card de relance | Cards de trabalho visual com capa nos quadros de design/marketing | ≥ 60% dos cards novos desses quadros |
| Trazer o assunto sensível para dentro da ferramenta | Cards restritos criados | ≥ 1 por semana, e o gestor diz que parou de usar conversa solta para esses temas |
| **Nenhum vazamento** | Conteúdo de card restrito visível (tela, API, notificação, filtro, contador) para quem não tem acesso | **0**, com bateria de testes automatizados verde (11.10) |
| Não pesar o quadro | Tempo de abertura de um quadro com 50 capas | ≤ 2,5 s na rede da equipe (hoje: ≤ 2 s sem capa) |
| Upload sem atrito | Tempo do "escolher arquivo" até a capa aparecer, com 5 MB | ≤ 5 s, com barra de progresso desde o primeiro segundo |

## 11.4 User stories e critérios de aceite

### Épico E. Capa do card

**E1 [Fatia 11]. Adicionar capa.** Como membro, quero enviar uma imagem do meu computador como capa do card, para reconhecer o card de relance.
- Dado que estou no detalhe de um card sem capa e tenho acesso a ele, quando clico em "Adicionar capa" e escolho um arquivo JPEG, PNG ou WebP de até 5 MB, então vejo o progresso do envio e, ao terminar, a capa aparece no detalhe e na face do card no quadro.
- Dado que o envio está em andamento, quando fecho o detalhe do card, então o envio continua e o resultado aparece quando volto (ou o erro vira toast).
- Dado um arquivo de formato não aceito (GIF, SVG, HEIC, PDF, vídeo, arquivo renomeado para `.png`), quando tento enviar, então nada é guardado e vejo "Formato não aceito. Use JPEG, PNG ou WebP.".
- Dado um arquivo acima de 5 MB, quando tento enviar, então nada é guardado e vejo "A imagem tem 8,2 MB. O limite é 5 MB.".
- Dado que o envio falhou (rede, servidor, R2 fora), então o card continua sem capa, vejo "Não foi possível enviar a capa. Tente de novo." e o botão continua disponível.
- A ação fica registrada na atividade do card ("adicionou a capa").

**E2 [Fatia 11]. Ver a capa.** Como membro, quero ver a capa na face do card e no detalhe, para identificar o card sem abrir.
- Dado um card com capa, quando abro o quadro, então vejo a imagem no topo da face do card, com proporção fixa (recorte pelo centro), sem esticar nem distorcer, e acima das etiquetas.
- Dado um card com capa, quando abro o detalhe, então vejo a imagem em tamanho maior no topo, antes do título.
- Dado que a imagem não carrega (link expirado, falha de rede), então aparece um espaço neutro com "Não foi possível carregar a capa." e a opção de recarregar; o resto do card funciona normalmente.
- A face do card **não** baixa o arquivo original: a versão usada no quadro tem no máximo ~640 px de largura (como isso é feito fica com o architect).
- Na face do card a imagem é decorativa (`alt=""`, o título já identifica o card); no detalhe, o texto alternativo é "Capa do card".

**E3 [Fatia 11]. Trocar e remover a capa.** Como membro, quero trocar ou remover a capa, para corrigir a imagem errada.
- Dado um card com capa, quando envio outra imagem, então a nova substitui a anterior e o arquivo antigo é apagado do R2.
- Dado um card com capa, quando clico em "Remover capa", então vejo a confirmação "Remover a capa deste card? A imagem é apagada e não dá para desfazer."; ao confirmar, a capa some do detalhe e da face do card e o arquivo é apagado.
- Cancelar a confirmação não muda nada.
- Trocar e remover ficam registrados na atividade do card.

**E4 [Fatia 11]. Quem pode mexer na capa.** Como equipe, queremos que só quem pode editar o card mexa na capa, para não haver surpresa.
- Dado um card visível para a equipe, então qualquer membro ativo pode adicionar, trocar e remover a capa.
- Dado um card restrito, então só quem está na lista de acesso (e os Admins) pode adicionar, trocar ou remover a capa; para os demais, o card sequer abre.
- Dado um quadro arquivado, então a capa pode ser vista mas não alterada (mesma regra de qualquer conteúdo em quadro arquivado).

**E5 [Fatia 11]. A capa não vaza.** Como equipe, queremos que a imagem de um card restrito só chegue a quem tem acesso.
- Dado um card restrito com capa, quando alguém sem acesso abre o quadro, então a face do card mostra só título e cadeado, **sem imagem e sem qualquer indicação de que existe capa**, e a API não devolve nenhuma URL da imagem para essa pessoa.
- Dado um endereço assinado da capa, quando ele é usado depois do prazo de validade, então o acesso é recusado pelo armazenamento.
- O endereço do arquivo nunca é público, nunca é gravado no banco e nunca aparece em log.

### Épico F. Cards restritos

**F1 [Fatia 11]. Restringir um card.** Como membro, quero limitar quem abre um card, para tratar de assunto sensível dentro da ferramenta.
- Dado um card visível para a equipe ao qual tenho acesso, quando abro "Quem pode ver este card" e escolho "Restrito a pessoas específicas", então a lista já vem com **o criador do card, os responsáveis atuais e eu** e o card passa a ser restrito ao salvar.
- Dado que restringi o card, então vejo o aviso de que o card continua aparecendo no quadro para todo mundo, com título e cadeado.
- Dado um card restrito, quando escolho "Visível para a equipe", então a restrição cai, a lista de acesso é apagada e todos voltam a abrir o card.
- As duas ações ficam registradas na atividade do card, com autor e data.

**F2 [Fatia 11]. Gerenciar a lista de pessoas.** Como quem participa do card, quero adicionar e remover pessoas, para manter o acesso certo.
- Dado um card restrito ao qual tenho acesso, então posso adicionar qualquer usuário **ativo** e remover quem está na lista.
- Dado que tento remover alguém que é responsável pelo card, então a remoção é recusada com "{Nome} é responsável por este card. Remova a pessoa dos responsáveis antes de tirar o acesso.".
- Dado que sou a única pessoa na lista, então não consigo me remover: "A lista precisa ter pelo menos uma pessoa. Adicione alguém ou torne o card visível para a equipe.".
- Dado que quero sair de um card com outras pessoas na lista, quando confirmo "Sair do card", então perco o acesso na hora, o diálogo fecha e só um Admin (ou quem ficou) pode me devolver o acesso.
- Dado que sou Admin, então abro e altero a lista de qualquer card restrito, mesmo sem estar nela, e vejo "Você vê este card porque é administrador.".
- Toda adição e remoção entra na atividade do card.

**F3 [Fatia 11]. O cadeado no quadro.** Como membro sem acesso, quero entender que existe um card ali sem ver o conteúdo, para não achar que o quadro está errado.
- Dado um card restrito ao qual não tenho acesso, quando abro o quadro, então vejo o card **na posição dele, na lista dele**, com o **título** e um **cadeado**, e nada mais: sem capa, etiquetas, prioridade, prazo, responsáveis, contador de checklist, contador de comentários e sem indicação de descrição.
- Quando clico nesse card, então nada abre e vejo "Card restrito. Só quem está na lista de acesso pode abrir.".
- O card bloqueado não é arrastável, não tem menu de ações rápidas e não oferece "Concluir", "Mover para…" nem "Arquivar".
- No teclado, o card é focável e o leitor de tela anuncia "Card restrito: {título}. Você não tem acesso.".
- Dado que tento qualquer ação pela API (abrir, editar, mover, comentar, arquivar, ver histórico, atribuir), então recebo 403 e nenhum dado do card.

**F4 [Fatia 11]. Nada vaza nas outras telas.** Como equipe, queremos que o card bloqueado não apareça por outro caminho.
- **Filtros do quadro:** um card bloqueado só pode ser encontrado pelo filtro de **texto do título**; qualquer outro filtro ativo (responsável, etiqueta, prioridade, prazo) o esconde, porque quem filtra não pode saber esses valores. O contador "N de M cards" conta os bloqueados como cards visíveis do quadro.
- **Busca por texto:** no quadro, a busca casa só pelo título (já visível). Quando existir busca global entre quadros (V2), cards bloqueados ficam de fora dela.
- **Meus cards:** nunca aparece card bloqueado — todo responsável de card restrito tem acesso (F5).
- **Notificações:** só quem tem acesso recebe notificação de um card restrito. Notificação de um card ao qual a pessoa perdeu o acesso não aparece na lista nem conta como não lida; o registro não é apagado, e volta a aparecer se o acesso voltar.
- **Histórico de atividade:** o histórico do card só existe dentro do card; sem acesso, não há como chegar nele (403 na rota).
- **Itens arquivados:** um card restrito arquivado aparece na lista de arquivados com título, pílula "Arquivado" e cadeado, sem a lista de origem; [Restaurar] e [Excluir] ficam desabilitados para quem não tem acesso (Admin faz as duas).
- Nenhuma dessas telas recebe do servidor qualquer campo do card além de id, quadro, lista, posição e título: o corte é **no servidor**, não na interface.

**F5 [Fatia 11]. Atribuir dá acesso.** Como gestor, quero que atribuir alguém a um card restrito já dê acesso a essa pessoa, para não criar tarefa que o responsável não consegue abrir.
- Dado um card restrito, quando atribuo alguém que não está na lista, então a pessoa é adicionada à lista de acesso na mesma ação, recebe a notificação de atribuição e consegue abrir o card.
- A interface avisa: "{Nome} foi adicionada aos responsáveis e ganhou acesso a este card.".
- Dado que removo alguém dos responsáveis, então o acesso **continua** (a pessoa segue acompanhando a discussão); tirar o acesso é uma ação separada e explícita.
- Só usuários ativos podem ser atribuídos (regra que já existe em C4), logo só usuários ativos entram por esse caminho.

**F6 [Fatia 11]. Restrição segue o card.** Como membro, quero que a restrição acompanhe o card, para não perder o controle ao reorganizar o quadro.
- Dado um card restrito, quando o movo entre listas ou para outro quadro, então ele continua restrito, com a mesma lista de acesso; só quem tem acesso consegue movê-lo.
- Dado um quadro arquivado, então cards restritos continuam com cadeado para quem não tem acesso, e a visibilidade e a lista não podem ser alteradas enquanto o quadro estiver arquivado.
- Dado que um Admin exclui em definitivo o quadro ou o card, então o card restrito, a lista de acesso, o histórico e a capa (arquivo no R2) vão junto.

**F7 [Fatia 11]. Ações de lista e de quadro continuam funcionando.** Como equipe, queremos que um card restrito não trave a organização do quadro.
- Dado que marco uma lista como "de conclusão" e ela tem cards abertos, então **todos** são concluídos, inclusive os restritos aos quais não tenho acesso (a regra RN12 não pode ser quebrada). A confirmação conta esses cards ("3 cards abertos nesta lista serão marcados como concluídos") e nada do conteúdo deles é revelado.
- Arquivar/restaurar uma lista, excluir uma etiqueta do quadro e excluir o quadro (Admin) valem também para cards restritos, pelo mesmo motivo.
- A atividade de cada card restrito registra quem disparou a ação.

**F8 [Fatia 11]. Ciclo de vida das pessoas.** Como Admin, quero que desativar e anonimizar contas não deixe card órfão nem dado pendurado.
- Dado que desativo um usuário, então ele permanece na lista de acesso dos cards restritos (não entra no app de qualquer forma) e volta a ter acesso se for reativado.
- Dado que anonimizo um usuário (ação irreversível, LGPD), então ele sai de todas as listas de acesso.
- Dado que a lista de um card restrito ficou vazia por causa de uma anonimização, então o card **continua restrito** e só Admins conseguem abrir; ao abrir, o Admin vê "Este card restrito está sem pessoas. Adicione alguém ou torne o card visível para a equipe.".
- Usuário desativado ou anonimizado não aparece no seletor de pessoas.

**F9 [Fatia 11]. Perder o acesso com o card aberto.** Como membro, quero entender o que aconteceu se o acesso for retirado enquanto eu estou no card.
- Dado que estou com o detalhe aberto e alguém me tira do card, quando o app atualiza (polling, foco da aba ou próxima ação), então o diálogo fecha, volto ao quadro e vejo "Você não tem mais acesso a este card.".
- Rascunhos não enviados (comentário, descrição) são descartados; nada é enviado depois da perda de acesso.

## 11.5 Regras de negócio

**Capa do card**
- RN20. Um card tem **no máximo uma** capa. O arquivo é enviado do computador da pessoa e fica no Cloudflare R2 em **bucket privado** (Decisão 9). Não existe URL pública nem CDN aberta.
- RN21. Formatos aceitos: **JPEG, PNG e WebP**. O servidor confere o **conteúdo real** do arquivo (assinatura/decodificação), não a extensão nem o `Content-Type` declarado. Qualquer outro formato é recusado, inclusive SVG (risco de script) e GIF animado.
- RN22. Tamanho máximo: **5 MB** por imagem. Limite coerente com os 10 GB do plano gratuito do R2 (ver risco de custo em 11.10).
- RN23. Adicionar, trocar e remover a capa é permitido a quem pode editar o card (RN29). Enviar uma capa nova substitui a anterior e **apaga** o arquivo antigo. Remover apaga o arquivo e não tem "desfazer".
- RN24. A imagem só é entregue por **URL assinada de curta duração** (S8), emitida na leitura, para quem tem acesso ao card. A URL não é gravada no banco e não aparece em log.
- RN25. Excluir o card ou o quadro (cascata) apaga também o arquivo no R2, na hora ou por rotina de limpeza em até 24 h. **Arquivar não apaga nada.** Não pode sobrar objeto órfão no bucket.
- RN26. A capa de um card restrito só é entregue a quem tem acesso. Para quem não tem, o card bloqueado **não mostra imagem nem sinaliza que existe capa**.

**Cards restritos**
- RN27. Todo card tem visibilidade `equipe` (padrão) ou `restrito`. Card restrito tem lista de acesso com **pelo menos uma pessoa**.
- RN28. Tem acesso a um card restrito quem está na lista **mais todo Admin ativo** (acesso implícito; o Admin não ocupa vaga na lista). Isso mantém a regra da casa de que o Admin resolve qualquer situação (RN05) e evita card que ninguém mais consegue destravar.
- RN29. **Quem pode editar o card pode restringi-lo e mudar a lista de acesso.** Em card visível para a equipe, isso é qualquer usuário ativo (RN05); em card restrito, é quem está na lista, mais os Admins. *Por quê:* a restrição é um atributo do conteúdo, como prazo ou etiqueta — criar um papel novo ("dono do card") ou exigir Admin para cada ajuste travaria o dia a dia de uma equipe de cinco pessoas e contraria o princípio 2. O contrapeso é que **toda** mudança fica na atividade do card e o Admin sempre consegue reverter.
- RN30. Ao restringir, a lista inicial é **criador do card + responsáveis atuais + quem está restringindo**. *Por quê:* são exatamente as pessoas que já viram o card e têm contexto; começar com a lista vazia obrigaria a montar tudo à mão e arriscaria trancar o próprio autor para fora.
- RN31. **Atribuir alguém a um card restrito adiciona a pessoa à lista de acesso**, na mesma transação. *Por quê:* ser responsável por algo que não se pode abrir é um beco sem saída — a notificação de atribuição levaria a um cadeado. Quem atribui já podia editar a lista (RN29), então a ação não dá poder novo a ninguém; só evita um passo esquecível.
- RN32. **Invariante: todo responsável de um card restrito está na lista de acesso.** Tirar o acesso de um responsável é recusado; primeiro se remove a atribuição. Isso é o que garante que "Meus cards" nunca mostre card bloqueado.
- RN33. Remover alguém dos responsáveis **não** tira o acesso. *Por quê:* a pessoa pode seguir acompanhando a discussão; tirar acesso em silêncio, junto com outra ação, surpreende (princípio de microcopy: ninguém deve ser surpreendido).
- RN34. Quem não tem acesso vê o card no quadro com **título e cadeado** e nada mais (Decisão 10). O servidor recusa com 403 qualquer rota daquele card: detalhe, edição, capa, comentários, checklists, responsáveis, etiquetas, mover, concluir, arquivar, atividade.
- RN35. A restrição pertence ao card e **viaja com ele** entre listas e entre quadros. Arquivar o quadro não muda a restrição e impede alterá-la (quadro arquivado é somente leitura).
- RN36. Ações do contêiner continuam valendo sobre cards restritos sem acesso: marcar lista como de conclusão (conclui todos, para manter RN12), arquivar/restaurar lista, excluir etiqueta do quadro e excluir o quadro (Admin). Nenhuma delas revela conteúdo do card; no máximo, um número.
- RN37. Só usuários **ativos** podem ser adicionados à lista de acesso.
- RN38. Usuário **desativado** permanece nas listas (não entra no app) e recupera o acesso se for reativado. Usuário **anonimizado** sai de todas as listas. Se a lista ficar vazia, o card continua restrito e fica acessível só a Admins, com aviso na interface.
- RN39. Mudanças de visibilidade, de lista de acesso e de capa entram na **atividade do card**, com autor e data, e só são legíveis por quem tem acesso.
- RN40. Notificação de um card ao qual a pessoa não tem mais acesso **não é listada nem contada** como não lida (filtro na leitura, não exclusão). Se o acesso voltar, ela volta a aparecer.
- RN41. Filtros e busca: no quadro, um card bloqueado só casa com o filtro de **texto do título**; qualquer outro filtro ativo o esconde. Na busca global entre quadros (quando existir, V2), cards bloqueados ficam de fora.

## 11.6 O que a pessoa sem acesso vê, tela por tela

| Onde | O que aparece | O que **nunca** aparece |
|------|---------------|-------------------------|
| Quadro (face do card) | Card na posição e na lista corretas, com título + ícone de cadeado + rótulo acessível "Card restrito" | Capa, etiquetas, prioridade, prazo, responsáveis, checklist, comentários, marca de descrição, menu de ações, arrastar |
| Clique no card | Mensagem "Card restrito. Só quem está na lista de acesso pode abrir." | Detalhe, edição, comentários, histórico |
| Filtros do quadro | O card entra na contagem de cards do quadro/lista; casa apenas pelo texto do título | Qualquer resultado por responsável, etiqueta, prioridade ou prazo |
| Busca por texto | No quadro, casa pelo título (já visível) | Busca global (V2) não inclui cards bloqueados |
| Meus cards | Nada (por RN32, não existe responsável sem acesso) | — |
| Notificações | Nada sobre esse card | Notificação antiga do card fica oculta e fora do contador enquanto o acesso não existir |
| Histórico de atividade | Nada (o histórico só existe dentro do card) | — |
| Itens arquivados | Linha com título, pílula "Arquivado" e cadeado; [Restaurar] e [Excluir] desabilitados | Lista de origem, etiquetas, qualquer outro campo |
| Ao ser atribuída ao card | Passa a ter acesso (RN31): vê tudo e recebe a notificação normal | — |
| API | 403 em qualquer rota do card; no payload do quadro, só `id`, `boardId`, `listId`, `position`, `title` e a marca de bloqueado | Qualquer outro campo do card |

## 11.7 Casos de borda e ciclo de vida

| Situação | Comportamento |
|----------|---------------|
| Pessoa é desativada | Continua na lista; sem login, sem acesso na prática. Reativação devolve o acesso. |
| Pessoa é anonimizada | Sai de todas as listas de acesso (LGPD). Cards, comentários e atividade continuam, com "Usuário removido". |
| Lista de acesso fica vazia (anonimização) | Card continua restrito; só Admins abrem; aviso na interface para o Admin resolver. |
| Card restrito movido para outro quadro | Restrição e lista de acesso vão junto. Etiquetas que não existem no destino são removidas, como já acontece (RN09). |
| Quadro arquivado | Cadeado continua; visibilidade e lista não podem ser alteradas (quadro arquivado é somente leitura). Capas continuam visíveis para quem tem acesso, mas não podem ser trocadas. |
| Quadro/card excluído pelo Admin | Tudo é apagado, inclusive lista de acesso e arquivo da capa no R2. |
| Lista marcada como "de conclusão" com card restrito aberto dentro | O card é concluído junto (RN36); o autor da ação fica na atividade do card. |
| Excluir etiqueta do quadro | A contagem "7 cards" pode incluir cards restritos que quem exclui não enxerga. Aceito: revela um número, nunca conteúdo. |
| Última pessoa da lista tenta sair | Recusado (RN27). |
| Pessoa se remove de um card com outras pessoas | Permitido, com confirmação explícita; perde o acesso na hora. |
| Duas pessoas editam a lista ao mesmo tempo | Vale a última gravação (RN10), como no resto do produto; a atividade mostra as duas ações. |
| Card restrito com capa | Capa só para quem tem acesso; o card bloqueado não mostra imagem nem sinal de que ela existe. |
| Upload interrompido / aba fechada no meio | Nada é gravado; nenhum objeto órfão fica no bucket (rotina de limpeza cuida de restos). |
| Mesmo arquivo enviado duas vezes | Gera dois objetos distintos; o antigo é apagado ao ser substituído. |

## 11.8 Requisitos não funcionais (complemento da seção 7)

**Segurança**
- A decisão de acesso é sempre do **servidor**, em toda rota do card e em toda consulta que devolve card (payload do quadro, arquivados, Meus cards, notificações, atividade). A interface só desenha o que recebeu.
- Ordem de resposta: card restrito sem acesso responde **403**, não 404 — a existência e o título já são públicos no quadro por decisão do cliente, e 404 confundiria com card excluído.
- Bucket **privado**, sem acesso anônimo, credenciais restritas a esse bucket, chaves de objeto **não adivinháveis** (nada de `/cards/{id}.png` previsível).
- O servidor valida tipo e tamanho do arquivo **antes** de confirmar a capa. Se o envio for direto do navegador para o R2, a API confirma tamanho e tipo reais do objeto antes de gravar a referência.
- A imagem é servida sempre como download/imagem estática, sem execução (sem SVG; cabeçalhos de tipo e `nosniff` no armazenamento).
- URL assinada com validade curta (S8) e sem registro em log.

**Privacidade / LGPD**
- A capa pode conter dado pessoal (print de conversa, documento). Vale o mesmo tratamento dos demais dados: bucket privado, exclusão junto com o card e cobertura no plano de backup (S12).
- Sair da equipe (anonimização) tira a pessoa das listas de acesso.
- O conteúdo de card restrito não entra em nenhum log.

**Performance**
- O quadro com 50 capas abre em ≤ 2,5 s: a face do card usa versão reduzida (~640 px), com `loading="lazy"` e dimensões reservadas para não deslocar o layout.
- Emitir as URLs assinadas do payload do quadro não pode virar N+1 nem chamada externa por card.
- Calcular o acesso não pode degradar o payload do quadro (uma consulta a mais, no máximo).

**Acessibilidade**
- O cadeado tem texto acessível ("Card restrito") — cor e ícone nunca sozinhos (RN17).
- Capa na face do card é decorativa (`alt=""`); no detalhe, "Capa do card".
- O campo de arquivo é alcançável por teclado, com rótulo visível, e o progresso é anunciado (`aria-live`).
- O card bloqueado é focável e anuncia que não tem acesso, em vez de ser um link morto.

## 11.9 MVP da fatia / Depois / Fora de escopo

**Entra na Fatia 11**

| Item | Por quê |
|------|---------|
| Uma capa por card (JPEG/PNG/WebP, 5 MB), na face e no detalhe, com trocar e remover | É o pedido do cliente e resolve a leitura de relance. |
| Armazenamento em R2 privado com URL assinada curta | Decisão 9. Mantém o dado fora do disco da VPS sem abrir o arquivo para a internet. |
| Versão reduzida para a face do card | Sem isso, o quadro estoura o requisito de 2,5 s. |
| Visibilidade do card (equipe/restrito) + lista de acesso | Decisão 10. |
| Cadeado no quadro, 403 no servidor, corte de campos no payload | É o coração da função; sem o corte no servidor, nada disso vale. |
| Atribuir dá acesso (RN31) e invariante responsável ⊆ lista (RN32) | Evita card sem saída e fecha o vazamento em "Meus cards". |
| Atividade das mudanças de visibilidade, acesso e capa | Contrapeso de "qualquer um pode restringir" (RN29). |
| Bateria de testes de vazamento (11.10) | É a definição de pronto desta fatia. |

**Depois (V2+)**
1. Texto alternativo próprio para a capa (campo de descrição da imagem).
2. Botão "Pedir acesso" no card bloqueado, com notificação para quem tem acesso.
3. Colar imagem da área de transferência (Ctrl+V) e recorte/posicionamento da capa.
4. Capa por cor sólida (sem imagem), como alternativa barata.
5. Galeria de anexos do card (continua sendo o item 2 da lista "Depois" da seção 8, agora com o R2 já disponível).
6. Restrição no nível de quadro (junto com "quadros privados", item 6 da seção 8).
7. Relatório para o Admin com todos os cards restritos da instância.

**Fora de escopo desta fatia (não confundir com o que está acima)**
- **Galeria de anexos** e **múltiplas imagens por card**: esta fatia entrega **uma** imagem, que é capa. Anexos são outro modelo (lista, nomes, tipos variados, antivírus, cota).
- **Edição de imagem** (recorte, giro, filtro, redimensionar à mão): a capa usa recorte automático pelo centro.
- **Capa no tile do quadro** na página inicial: fora; o tile continua como está.
- Esconder o card bloqueado do quadro, ou esconder o título: contraria a Decisão 10.
- Papel novo ("dono do card"), permissão por lista, permissão de somente leitura, compartilhamento externo por link.
- Comentário/checklist restrito dentro de card aberto: a restrição é do card inteiro.
- Auditoria de quem olhou o card ou baixou a capa.

## 11.10 Riscos e testes de aceite obrigatórios

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| **Vazamento pelo payload do quadro** (card bloqueado devolvido inteiro e escondido só no front) | Média | Alto | O corte é feito na consulta do servidor; teste de contrato compara o JSON recebido com a lista fechada de campos permitidos. |
| **Vazamento por contador** (checklist, comentários, "N de M cards", contagem de etiqueta, "Meus cards") | Média | Alto | Card bloqueado não devolve contador nenhum; testes cobrem cada contador. Contagens de contêiner (etiqueta, lista) revelam no máximo um número — aceito e documentado. |
| **Vazamento por notificação** (comentário em card que a pessoa perdeu acesso) | Média | Alto | Notificação filtrada na leitura pelo acesso atual (RN40); teste específico. |
| **Vazamento por rota da API esquecida** (checklist, etiqueta, mover, atividade, capa) | Média | Alto | Checagem de acesso centralizada em um único ponto do módulo de cards; teste que percorre **todas** as rotas de card e exige 403 para quem não tem acesso (teste tabelado, quebra ao surgir rota nova). |
| **Vazamento pela URL assinada** (link colado em chat, guardado em log ou em cache) | Média | Médio | Validade curta (S8), bucket privado, URL fora de log e fora do banco; a interface nunca expõe "copiar link da imagem". |
| **Upload malicioso** (SVG com script, arquivo renomeado, imagem-bomba) | Média | Alto | Validação do conteúdo real, lista fechada de formatos, limite de 5 MB e de dimensões, servir sempre como imagem estática com `nosniff`. |
| **Custo/cota do R2** (10 GB do plano gratuito; 5 MB × 2.000 capas = 10 GB) | Média | Médio | Limite de 5 MB, versão reduzida para o quadro, exclusão real ao remover/excluir card e acompanhamento do uso. Se apertar, reduzir o limite por imagem. |
| **Objeto órfão no bucket** (card excluído, upload interrompido, troca de capa) | Alta | Baixo | Exclusão na mesma ação + rotina de limpeza que varre objetos sem card correspondente. |
| **Restrição usada para esconder trabalho da equipe** | Baixa | Médio | Admin vê tudo; toda mudança fica na atividade; a função é apresentada como exceção, não como padrão. |
| **Pessoa tranca a si mesma fora do card** | Média | Baixo | Confirmação explícita ao sair; lista nunca fica vazia por ação de usuário; Admin devolve o acesso. |
| **Título do card restrito revela o assunto** | Média | Médio | Decisão do cliente (o card continua visível). A interface avisa no painel de restrição: "O título continua visível para a equipe." |

**Testes que precisam existir (definição de pronto da fatia)**
1. Payload do quadro, para quem não tem acesso: card bloqueado traz **só** `id`, `boardId`, `listId`, `position`, `title` e a marca de bloqueado.
2. Teste tabelado: toda rota de card (detalhe, `PATCH`, mover, concluir, reabrir, arquivar, restaurar, comentários, checklists, responsáveis, etiquetas, atividade, capa) responde **403** para quem não tem acesso, e 200 para quem tem.
3. Admin abre e altera qualquer card restrito.
4. Atribuir alguém a card restrito adiciona à lista de acesso, na mesma transação (falha na atribuição não deixa acesso solto).
5. Tirar o acesso de um responsável é recusado; depois de remover a atribuição, é permitido.
6. "Meus cards" nunca devolve card bloqueado (teste com card restrito e responsável fora da lista, montado direto no banco para simular inconsistência).
7. Notificação de card sem acesso não aparece na lista nem no contador de não lidas; volta quando o acesso volta.
8. Filtro: com filtro de responsável/etiqueta/prioridade/prazo ativo, cards bloqueados somem; com filtro de texto, casam pelo título.
9. Arquivados: card restrito aparece bloqueado e não pode ser restaurado nem excluído por quem não tem acesso.
10. Marcar lista como "de conclusão" conclui também cards restritos sem acesso, sem devolver conteúdo deles.
11. Mover card restrito entre quadros preserva restrição e lista de acesso.
12. Anonimizar usuário tira da lista; lista vazia mantém o card restrito e acessível só a Admins.
13. Capa: formatos aceitos e recusados (incluindo `.png` que na verdade é SVG), limite de 5 MB, substituição apaga o arquivo antigo, remoção apaga o arquivo.
14. Capa de card restrito: a API não devolve URL nenhuma para quem não tem acesso.
15. URL assinada expira e deixa de servir a imagem.
16. Excluir card e excluir quadro apagam os arquivos no R2.
17. E2E: uma pessoa sem acesso vê o cadeado no quadro, clica, recebe a mensagem e não consegue arrastar o card; depois de ser atribuída, abre o card normalmente.
18. Acessibilidade (axe): quadro com card bloqueado e detalhe com capa, sem violação "serious/critical", nos dois temas.

## 11.11 Microcopy (pt-BR)

Tom: direto, em "você", sem exclamação; erro = o que aconteceu + o que fazer (design system, seção 14 de `screens.md`).

**Cadeado no card**
- Rótulo acessível da face: "Card restrito: {título}. Você não tem acesso."
- Ao clicar/tocar: "Card restrito. Só quem está na lista de acesso pode abrir. Fale com quem participa do card ou com um administrador."
- Dica ao tentar arrastar: "Card restrito. Você não pode mover este card."
- Em itens arquivados (botões desabilitados): "Você não tem acesso a este card."

**Painel "Quem pode ver este card"**
- Título: "Quem pode ver este card"
- Opção 1: "Visível para a equipe" · ajuda: "Todos os membros podem abrir, editar e comentar."
- Opção 2: "Restrito a pessoas específicas" · ajuda: "Só quem estiver na lista (e os administradores) pode abrir o card."
- Aviso fixo quando restrito: "O card continua aparecendo no quadro para todo mundo, com o título e um cadeado. Evite informação sensível no título."
- Lista: "{Nome}" + selo "Responsável" quando for o caso + botão "Remover acesso de {Nome}".
- Botão: "+ Adicionar pessoa" · campo: "Buscar pessoa"
- Rodapé informativo: "Administradores sempre têm acesso."
- Sucesso ao restringir: "Card restrito. {N} pessoas têm acesso."
- Sucesso ao liberar: "Card visível para a equipe."
- Sucesso ao adicionar: "{Nome} agora tem acesso a este card."
- Sucesso ao remover: "{Nome} não tem mais acesso a este card."
- Para o Admin fora da lista: "Você vê este card porque é administrador."
- Aviso de lista vazia (só Admin vê): "Este card restrito está sem pessoas. Adicione alguém ou torne o card visível para a equipe."

**Erros e confirmações da restrição**
- Responsável: "{Nome} é responsável por este card. Remova a pessoa dos responsáveis antes de tirar o acesso."
- Última pessoa: "A lista precisa ter pelo menos uma pessoa. Adicione alguém ou torne o card visível para a equipe."
- Sair do card (confirmação): "Tirar o seu acesso a este card? Você não vai mais conseguir abrir o card, e só quem ficou na lista ou um administrador pode devolver o acesso." · [Cancelar] [Sair do card]
- Perda de acesso com o card aberto: "Você não tem mais acesso a este card."
- Ao atribuir alguém em card restrito: "{Nome} foi adicionada aos responsáveis e ganhou acesso a este card."
- Quadro arquivado: "Este quadro está arquivado. Restaure o quadro para mudar quem vê este card."

**Capa**
- Botões: "Adicionar capa" · "Trocar capa" · "Remover capa"
- Área de envio: "Arraste uma imagem aqui ou escolha um arquivo" · ajuda: "JPEG, PNG ou WebP, até 5 MB."
- Enviando: "Enviando capa… {N}%" · botão "Cancelar envio"
- Sucesso: "Capa adicionada." / "Capa trocada." / "Capa removida."
- Confirmação de remoção: "Remover a capa deste card? A imagem é apagada e não dá para desfazer." · [Cancelar] [Remover capa]
- Erro de formato: "Formato não aceito. Use JPEG, PNG ou WebP."
- Erro de tamanho: "A imagem tem {X} MB. O limite é 5 MB."
- Arquivo ilegível: "Não conseguimos ler esta imagem. Tente outro arquivo."
- Falha de envio: "Não foi possível enviar a capa. Tente de novo."
- Falha ao exibir: "Não foi possível carregar a capa." + [Recarregar]
- Sem permissão (quadro arquivado): "Este quadro está arquivado. Restaure o quadro para mudar a capa."
- Texto alternativo: face do card, vazio (decorativa); detalhe, "Capa do card".

**Filtros**
- Nota no rodapé do painel de filtros, quando houver card bloqueado no quadro: "Cards restritos aos quais você não tem acesso não entram nos filtros de responsável, etiqueta, prioridade e prazo."

## Decisões confirmadas pelo cliente (2026-09-16)
1. Visibilidade: todos os membros veem todos os quadros no MVP (quadros privados depois).
2. E-mail: sem SMTP. Convite e redefinição de senha por link gerado pelo Admin.
3. Conclusão: mover para a lista marcada "Concluído" OU clicar em "Concluir". É o mesmo evento, registrado na atividade.
4. Celular: responsivo básico com "Mover para…"; arrastar e soltar garantido só no desktop.
5. Sem gamificação neste projeto (nada de XP, níveis, sequências, rankings ou recompensas).
6. Visual colorido estilo Monday: cores vivas por lista/status e etiquetas. A paleta e os detalhes ficam com o design.
7. Deploy em VPS Linux com domínio próprio e HTTPS automático.
8. Backend próprio confirmado (Node/Fastify + PostgreSQL + Drizzle, auth própria com e-mail e senha). Nunca BaaS (Supabase/Firebase/PocketBase).

### Novas decisões (2026-09-17, Fatia 11)
9. **Capa do card:** imagem enviada do computador da pessoa e guardada no **Cloudflare R2, em bucket privado**; a API devolve **URL assinada de curta duração**. A capa aparece na face do card e no detalhe do card. (Isso não reabre o item "Anexos" da seção 8: anexos continuam para depois.)
10. **Cards restritos:** o card pode ser "visível para a equipe" (padrão) ou "restrito", com uma lista de pessoas. Para quem não tem permissão, o card **continua aparecendo no quadro, com o título e um cadeado**, e não abre (sem detalhe, sem edição, sem comentários, sem mover). Administradores sempre veem tudo.
