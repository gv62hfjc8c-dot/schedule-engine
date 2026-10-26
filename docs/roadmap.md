# Roadmap

## Ponto 1 — Calendário operacional

Estado: **fechado**

- [x] horário semanal editável;
- [x] dias fechados;
- [x] exceções por data;
- [x] resolução do horário efetivo de uma data;
- [x] calendário contínuo sem janela global;
- [x] testes básicos;
- [x] interface em formato de painel;
- [x] seleção de horas por dropdown;
- [x] persistência automática através da aplicação.

### Melhorias futuras não bloqueantes

- múltiplos intervalos por dia na interface;
- validação adicional de intervalos inválidos ou sobrepostos;
- controlo de permissões na aplicação consumidora.

## Ponto 2 — Pessoas

Estado: **fechado**

- [x] modelo mínimo `Person`;
- [x] identificador estável;
- [x] nome;
- [x] estado ativa/arquivada;
- [x] criação;
- [x] edição de nome;
- [x] arquivo sem eliminação física;
- [x] reativação;
- [x] filtro de pessoas ativas;
- [x] testes básicos;
- [x] interface de gestão;
- [x] persistência automática.

## Ponto 3 — Disponibilidade

Estado: **fechado**

- [x] disponibilidade semanal por pessoa;
- [x] zero intervalos significa indisponível;
- [x] exceções por data;
- [x] resolução da disponibilidade efetiva de uma data;
- [x] verificação se um intervalo está totalmente dentro da disponibilidade;
- [x] disponibilidade tratada como hard constraint;
- [x] interseção com o calendário operacional;
- [x] bloqueio de disponibilidade em dias de operação fechada;
- [x] horas de disponibilidade limitadas ao horário operacional;
- [x] interface em separador próprio;
- [x] seleção de pessoa ativa;
- [x] persistência automática;
- [x] migração automática do estado persistido v1 para v2;
- [x] testes básicos.

### Fora do Ponto 3

- férias;
- baixas;
- ausências tipificadas;
- horas semanais máximas;
- descanso entre períodos;
- preferências;
- cobertura necessária;
- geração de horários.

## Ponto 4 — Regras de trabalho e turnos contínuos

Estado: **fechado**

- [x] duração padrão de turno configurável;
- [x] ausência de duração tratada como configuração incompleta;
- [x] um turno diário é um único intervalo contínuo;
- [x] turnos repartidos ficam fora do modelo atual;
- [x] cálculo de turno de abertura;
- [x] cálculo de turno de fecho;
- [x] validação contra o calendário operacional;
- [x] validação contra disponibilidade da pessoa;
- [x] operação com interrupções não pode ser atravessada por um turno contínuo;
- [x] dias mais curtos do que a duração padrão ajustam o turno ao funcionamento disponível;
- [x] interface própria;
- [x] persistência automática;
- [x] migração automática v2 → v3;
- [x] testes básicos.

### Fora do Ponto 4

- número mínimo de pessoas na abertura;
- número mínimo de pessoas no fecho;
- cobertura ao longo do dia;
- contratos e horas semanais;
- pausas;
- descanso entre dias;
- preferências;
- geração automática de horários.

## Ponto 5 — Requisitos mínimos de presença

Estado: **fechado (2026-10-26)**

- [x] três mínimos obrigatórios: abertura, durante a operação, fecho;
- [x] mínimos inteiros não negativos e independentes, aplicados em janelas de 30 minutos;
- [x] configuração 1 / 2 / 1 válida e sobreposição de extremos em dias curtos;
- [x] mínimos são limites inferiores, nunca tetos nem objetivos de pessoal exato;
- [x] padrão semanal com dias fechados isentos de exigência;
- [x] exceções por data substituem integralmente o padrão;
- [x] zero explícito é diferente de não configurado;
- [x] exceções duplicadas e requisitos incoerentes detetados;
- [x] validador de presença sobre turnos contínuos propostos;
- [x] validador percorre a operação completa e deteta lacunas intermédias;
- [x] pré-verificação de pessoas disponíveis em cada parte do dia, sem afirmar viabilidade global;
- [x] mesmas pessoas podem satisfazer abertura e fecho num dia curto;
- [x] interface em cartões compactos;
- [x] persistência v4 com migração dos estados v1, v2 e v3;
- [x] testes básicos de domínio e persistência;
- [x] CI de testes, typecheck e build nos PRs.

### Fora do Ponto 5

- estudo de afluência;
- curva de cobertura por intervalos horários;
- maximização da sobreposição no período central;
- geração de turnos e atribuições;
- contratos, horas semanais e pausas;
- validação integral de viabilidade do horário.

## Ponto 6 — Gerador de horários V0

Estado: **em desenvolvimento**

### Etapa 6.1 — Gerador diário puro

- [x] entrada explícita e resultado tipificado com diagnósticos;
- [x] candidatos determinísticos de um turno contínuo por pessoa ativa e por dia;
- [x] duração padrão preservada, exceto em períodos operacionais mais curtos;
- [x] pesquisa discreta de 15 minutos mais limites horários exatos, com limite de nós;
- [x] seleção progressiva por número mínimo de pessoas, sem otimização da equidade;
- [x] verificação independente de cobertura e disponibilidade antes de publicar solução;
- [x] distinguir input inválido, capacidade insuficiente, pesquisa sem solução e limite atingido;
- [x] testes de domínio (dias longos, curtos, partidos, arquivo, casos impossíveis na grelha);
- [x] executar CI, typecheck e build do núcleo;
- [x] interface experimental para selecionar uma data e visualizar turnos e conflitos;
- [x] simulação efémera: nunca guardar turnos nem alterar configurações no Supabase;
- [x] ignorar resultados anteriores quando mudam data, pessoas ou regras;
- [x] validar manualmente a interface com dados reais: capacidade insuficiente, sem solução com turnos de 8h, horário válido para sábado de 4h e recuperação dos requisitos após remoção de exceção;

### Etapa 6.2 — Gerador de períodos V0

Estado: **integrado na main (PR #12; 2026-10-26)**

- [x] orquestração pura do gerador diário num intervalo inclusivo de datas civis;
- [x] até 14 dias consecutivos, com verificação de datas inválidas e ordem cronológica;
- [x] exceções diárias de calendário, disponibilidade e presença respeitadas;
- [x] resultados e diagnósticos por data, sem ocultar sucessos ou falhas;
- [x] publicação atómica: um período incompleto nunca disponibiliza turnos parciais;
- [x] indicação explícita de `daily_only`: não certifica descanso, horas semanais ou justiça distributiva;
- [x] testes de dias fechados, exceções, falhas parciais, ano bissexto, ano novo e DST;
- [x] CI verde e testes locais do núcleo;
- [x] interface experimental de vários dias, com resumo e diagnóstico por data;
- [x] resultados apresentados apenas quando todos os dias passam na validação diária;
- [x] alternância entre gerador diário e gerador de períodos sem alterar o estado persistido;
- [x] validação funcional com dados reais: semana incompleta (0/1/6), diagnóstico de segunda-feira, domingo fechado, período válido sábado/domingo (1/1/0) com exceção temporária, e recuperação após remover exceção (0/1/1), sem publicação parcial;

### Etapa 6.3 — Refeição, descanso e limites de trabalho

Estado: **núcleo integrado na main (PRs #13–#15), UI experimental condicionada à confirmação de contexto em desenvolvimento**

Regras acordadas:
- [x] 8h padrão = 8h de trabalho efetivo, excluindo refeição;
- [x] refeição obrigatória quando há **mais de 6h efetivas**;
- [x] refeição de 60 minutos, início após 3h a 5h efetivas, inclusive;
- [x] refeição não conta para o trabalho efetivo nem para a cobertura;
- [x] descanso mínimo de 11h entre jornadas;
- [x] máximos de 8h efetivas diárias e 40h semanais;
- [x] semana de segunda-feira a domingo, incluindo turnos fora do período pedido;
- [x] nenhuma ultrapassagem automática / exceção aos limites nesta versão.

Primeiro incremento técnico:
- [x] tipos aditivos de turno datado com pausa de refeição e configuração explícita;
- [x] cálculo de intervalos efetivos, excluindo a refeição;
- [x] validação pura de refeição, limites diários/semanais e descanso entre dias;
- [x] contexto de trabalho completo obrigatório para certificar um período;
- [x] fuso IANA explícito, descanso medido em tempo real e rejeição de horas locais ambíguas/inexistentes;
- [x] testes dos limiares, semanas partidas, transições de calendário e falta de contexto;
- [x] CI aprovado e testes locais do validador de trabalho confirmados;
- [x] validador independente de cobertura que exclui a pausa e preserva os cortes de presença anteriores;
- [x] testes de cobertura de refeições simultâneas/desfasadas, mínimos 1/2/1, dias curtos, requisitos sobrepostos e regressão de turnos sem pausa;
- [x] testes locais `npm run test:work-constraints` e `npm run test:work-coverage` confirmados pelo utilizador;
- [x] gerador diário **isolado** que pesquisa turnos e posições de refeição em conjunto;
- [x] regra de 8h efetivas + 1h de refeição e encurtamento explícito para operação curta;
- [x] cobertura reavaliada durante cada pausa e validação final independente;
- [x] pesquisa determinística, limitada e resultados atómicos, com diagnósticos de capacidade;
- [x] testes de refeições desfasadas, mínimo central 1/2/1, dias curtos, configuração, limites e regressão;
- [x] gerador multi-dia **isolado** que retrocede para turnos alternativos quando uma escolha diária impede os dias seguintes;
- [x] validação de 11h de descanso e 40h semanais **durante** a pesquisa, incluindo turnos anteriores e posteriores ao período;
- [x] contexto exterior explicitamente completo obrigatório (semanas inteiras e dias adjacentes);
- [x] orçamento de pesquisa global em todos os dias; nunca publicar soluções parciais;
- [x] validação final independente de regras de trabalho, depois de cobertura diária com refeições;
- [x] testes de backtracking real, horas semanais anteriores/posteriores, domingo/segunda, refeições e contexto desconhecido;
- [x] execução local de `npm run test:constrained-period-generator` confirmada pelo utilizador;
- [x] interface experimental P6.3 independente dos modos V0 anteriores, com entrada explícita de datas e fuso IANA;
- [x] confirmação obrigatória de **ausência de outros turnos exteriores** nas datas necessárias para descanso e limites semanais;
- [x] sem confirmação, sem contexto: botão de geração bloqueado e nenhuma escala publicada;
- [x] teste unitário do adaptador de confirmação, datas de fronteira e regras inválidas;
- [x] turnos com refeições visíveis apenas quando a solução global for validada no cenário declarado;
- [x] validar manualmente a interface P6.3: sem confirmação bloqueia; cobertura insuficiente diagnosticada (dias 26 e 31/10); cenário temporário 1/1/1 gerou turno de 09:00–13:00 sem refeição e foi revertido pelo utilizador;
- [ ] definir fonte de turnos aprovados (incluindo externos) antes de permitir validação de escalas efetivas sem hipótese de contexto vazio;
- [ ] definir migração de regras P6.3 para configuração persistida só quando necessária.

**Atenção:** o novo gerador de período P6.3 só certifica regras globais quando
`status: "generated"` **e** quando o contexto exterior ao período está confirmado.
O gerador na interface ainda é anterior ao P6.3; não certifica
refeições, descanso ou horas semanais.

### Etapa 6.4 — Núcleo de horários aprovados

Estado: **modelo e operações puras implementadas (PR #17); persistência pendente**

Primeiro incremento — sem Supabase nem interface:
- [x] separar proposta gerada de escala **aprovada**, sem aprovação automática;
- [x] ledger explícito com versão, fuso IANA e intervalo confirmado de conhecimento de compromissos;
- [x] horários ativos com ID único e reserva de **todo o período civil**, incluindo dias sem turnos;
- [x] aprovação atómica com nova verificação de operação, disponibilidade, pessoas ativas, cobertura, refeições, limites de 8h/40h e descanso de 11h;
- [x] cancelamento com histórico preservado e remoção de compromissos ativos;
- [x] substituição atómica do mesmo período, validando a nova solução antes de desativar a anterior;
- [x] consultas ao ledger para preparar o contexto exterior completo do gerador P6.3, recusando períodos ocupados;
- [x] validação de versões esperadas para futuras escritas concorrentes no armazenamento;
- [x] testes de transições, conflitos, reversões atómicas, contexto incompleto e imutabilidade;
- [ ] validar o teste do núcleo no Mac;
- [ ] escolher/rever contrato de persistência de escalas aprovadas e modelo de autorização;
- [ ] integrar persistência com transações e proteção de concorrência real;
- [ ] integrar aprovação/cancelamento/substituição na interface após validação funcional.

**Invariante:** o ledger somente pode declarar `complete: true` quando o
repositório/adaptador tiver confirmação de TODOS os compromissos aprovados
no intervalo de contexto. Um ledger vazio não prova ausência de trabalho.
Cancelar uma escala remove o compromisso mas **não certifica cobertura**.

### Limites explícitos V0

- Pesquisa discreta de duração fixa: não encontrar solução não prova impossibilidade global.
- Não existem turnos repartidos nem atribuições multi-dia.
- O gerador **legado** ainda não aplica as regras P6.3; o novo núcleo experimental valida horas semanais e descanso entre dias apenas quando recebe contexto exterior completo.
- A interface de geração é apenas uma simulação, sem gravação dos turnos.

## Próximo passo

Validar localmente as transições P6.4 e confirmar CI. Depois definir persistência fiável das escalas aprovadas, incluindo controlo de concorrência e origem verificável da cobertura do ledger antes de integrar ações de aprovação na interface.
