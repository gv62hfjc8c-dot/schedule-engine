# PR #47 — Auditoria de consistência e reforço de invariantes

Base: `main` depois do PR #46, commit `1467136`.
**Esta é uma implementação em revisão, não uma validação funcional nem uma aprovação para merge.**
Os 23 pontos originais misturavam defeitos concretos, riscos, dívida técnica e funcionalidades deliberadamente ainda fora de âmbito. Um ponto "pendente" não foi corrigido nem pode ser dado como terminado.

| Nº | Observação | Estado PR #47 | Justificação / seguimento |
|---|---|---|---|
| 01 | Documentação desatualizada | Atualizado parcialmente | README, arquitetura, roadmap, guia Supabase; histórico mantém-se histórico |
| 02 | Ausência de turno apresentada como folga | Corrigido | Vista mensal passa a dizer "Sem turno"; resumo diário mostra "Por planear" |
| 03 | API de aprovações antiga ativa no Supabase | Pendente — infraestrutura | Não eliminar/desativar Edge Function `official-schedules` ou dados sem plano de rollback; não pertence à UI ativa |
| 04 | Importação de browser para conta nova sem confirmar titularidade | Corrigido no adaptador | Consentimento explícito associado à conta; estado cloud mantém precedência |
| 05 | Migrações Git ≠ objetos implantados | Pendente — reconciliação | Exportar DDL, documentar migrações reais e definir instalação reproduzível antes de operar em produção |
| 06 | Calendário agrega dias de propostas diferentes | Mitigado, não resolvido estruturalmente | Aviso explícito quando múltiplos snapshots; proveniência por dia; ainda falta um plano operacional único validado |
| 07 | Limite de 40h usado como alvo pelo otimizador | Implementado no B (opt-in) | Contrato semanal por pessoa é limite hard; objetivo semanal é soft; sem campos prevalece o comportamento PR41 (40h). Horas extraordinárias não são inferidas |
| 08 | Falta de certificação independente após otimizações | Corrigido | `certifyFinalGeneratedSchedule` examina trabalho, cobertura, elegibilidade, período, dias obrigatórios e jornadas curtas |
| 09 | Jornada curta conflita com refeição obrigatória | Corrigido | Jornada integral significa presença do início ao fim e admite refeição legal, que continua a ser validada |
| 10 | Disponibilidade vs obrigação de trabalhar | Separado no B | Introduzidas datas obrigatórias explícitas por colaborador, independentes da disponibilidade; a opção global existente mantém semântica e valor original |
| 11 | Editor substituía silenciosamente intervalos adicionais | Corrigido | Modificação do primeiro intervalo preserva restantes; editor multi-intervalos completo continua pendente |
| 12 | Exceções duplicadas por data | Corrigido preventivamente | Novas datas livres, bloqueio ao alterar para data repetida e aviso para duplicados históricos |
| 13 | Validação superficial de snapshots persistidos | Reforçado | Verifica forma v4, semana completa, intervalos, regras de trabalho e fuso; validação de políticas e versões evolutivas continua necessária |
| 14 | Fecho do navegador durante gravação | Mitigado | Alerta de saída durante pedido pendente; não há garantia em encerramento forçado do browser |
| 15 | Fuso horário divergente entre partes da aplicação | Implementado no B | Fuso IANA único e persistido opcionalmente no estado v4, default legado Azores; calendário, gerador e cálculo visual de horas efetivas passam a usá-lo; arquivo mantém fuso do snapshot |
| 16 | Conflito de escrita deixa utilizador bloqueado | Mitigado | Em falha após hidratação, permite exportar configuração local pendente; não realiza merge concorrente automático |
| 17 | Aprovação oficial ausente da UI | Sem mudança intencional | Decisão explícita do rollback; reintroduzir exigiria uma nova fronteira confiável e contrato de aprovação |
| 18 | Ciclos de 28 dias vs limite do gerador de 14 | Modelo implementado, geração de 28 dias pendente | Ciclo fixo com âncora operacional, quatro subperíodos de sete dias, compatível com meses de 5 semanas e anos bissextos; gerador continua limitado a 14 dias até prova de capacidade |
| 19 | `Person` sem contratos e perfis avançados | Parcial (B) | Adicionados limite contratual semanal, objetivo semanal e datas obrigatórias; qualificações/funções e ausências continuam fora do modelo até requisitos concretos |
| 20 | Avisos de segurança Supabase | Pendente — configuração de serviço | `SECURITY DEFINER` de estado é intencional e autenticado; avaliar proteção de palavras-passe comprometidas e configuração real |
| 21 | Experiências antigas no repositório | Pendente — inventário e remoção seletiva | Não eliminar módulos antes de auditar importações, testes e dependências do histórico |
| 22 | Terminologia antiga na interface | Corrigido | Gravação Supabase e menções ao PR41 atualizadas |
| 23 | Invariantes sem regressões dedicadas | Reforçado | `consistencyAuditTest.ts` integrado em `npm test`; ensaios manuais completos e carga ficam para fase de validação |

## Checkpoint A — integridade do motor (implementado na branch PR #47)

- Introduzida uma barreira final independente que certifica disponibilidade, pessoas ativas, cobertura sem contar refeições, regras de descanso, limites diários/semanais, dias obrigatórios e jornada integral curta.
- A preparação de turnos para dias curtos passou a distinguir **tempo de presença** de **trabalho efetivo**, permitindo uma pausa válida dentro de uma jornada integral.
- Corrigidas três partes do processo: geração diária de candidatos de jornada curta com refeição opcional, reequilíbrio de dias curtos e reparação de dias obrigatórios sem turno.
- Regressões adicionadas para jornadas de 7h (6h efetivas + 1h de refeição), jornadas de 9h (8h efetivas + 1h de refeição) e dia curto de 7h obrigatório mesmo quando os mínimos de cobertura são zero.
- Testes de domínio, `npm run typecheck` e `npm run build` aprovados no GitHub Actions do commit `0a0170890c8bc236287f9440150ef7e6505e4bc8` (run `42314911389`).
- A `main` permanece inalterada, em `1467136e081087aa724875176c6de70428175249` (PR #46). Criada a branch de segurança `safety/pr46-baseline` apontada para esse commit, sem abrir outro Pull Request.

**Limites:** o Checkpoint A reforça a validade das propostas mas não introduz contratos individuais, novos ciclos de 28 dias nem a aprovação oficial. Estes aspetos permanecem como decisões de domínio e arquitetura dos checkpoints seguintes.

## Checkpoint B — contrato, obrigatoriedade, fuso e ciclos (implementado na branch PR #47)

- **Contrato semanal hard:** `Person.weeklyContractMinutes` limita a carga da pessoa por semana civil (segunda–domingo), incluindo turnos externos conhecidos. É independente do máximo semanal global; aplica-se o menor dos dois.
- **Alvo semanal soft:** `Person.weeklyTargetMinutes` orienta apenas a fase de distribuição e extensão de turnos; cobertura pode exigir mais do que o objetivo, mas nunca exceder o máximo hard. Dados antigos sem estes campos mantêm o alvo e limite globais atuais.
- **Dias obrigatórios explícitos:** `Person.requiredWorkDates` cria obrigações por pessoa, mesmo quando a opção global de transformar disponibilidade em dia obrigatório está desligada. Dias sem disponibilidade ou operação fechada nunca são declarados válidos por engano.
- **Fuso horário operacional:** a configuração v4 aceita opcionalmente `operationTimeZone` (IANA), pré-definido em `Atlantic/Azores` para dados anteriores. O gerador lê o fuso da operação e deixa de ter fuso independente. O calendário usa o mesmo fuso para identificar o dia atual e as durações efetivas usam instantes reais, rejeitando ambiguidades DST. Propostas já guardadas preservam o seu próprio fuso.
- **Ciclos contabilísticos de 28 dias:** `cycleAnchorDate` é opcional; `accountingCycleForDate` calcula ciclos independentes dos meses e permite consultar os limites na interface mensal. Esta camada é **contabilística**, não combina propostas nem afirma ter gerado 28 dias válidos.
- **Compatibilidade:** dados v4 e snapshots históricos sem novos campos continuam válidos; nenhuma migração destrutiva ou operação Supabase neste checkpoint.
- **Testes:** `src/schedulingModelCheckpointTest.ts` verifica limites contratuais, objetivos soft, dias obrigatórios, transições de horário de verão/inverno, datas de ciclo anteriores/posteriores à âncora, ano bissexto e estado v4 legado.

**Fronteiras ainda deliberadamente pendentes:** o gerador continua com limite de 14 dias, sem pesquisa/certificação contínua de 28 dias; não existem remuneração, horas extraordinárias, competências ou vínculo contratual tipificado. Introduzir estas dimensões sem regras concretas seria especulativo.

## Critérios antes de qualquer merge

1. `npm test`, `npm run typecheck` e `npm run build` aprovados em CI.
2. Validar que o gerador mantém resultados legalmente válidos nos cenários reais já utilizados.
3. Conferir que a nova proteção de importação não altera contas com estado Supabase já existente.
4. Testar manualmente recuperação de snapshots e aviso de propostas diferentes.
5. Testar edição de configurações históricas com múltiplos intervalos.
6. Confirmar que o PR não altera nem apaga dados ou Edge Functions em produção.

## Decisões que NÃO foram tomadas implicitamente

- Não converter propostas em escalas aprovadas.
- Não inventar contratos ou objetivos individuais para colaboradores existentes; os novos campos são opcionais e configurados explicitamente.
- Não elevar o limite de 14 para 28 dias sem dimensionar o algoritmo.
- Não modificar o fuso horário de snapshots já guardados: o fuso persistido na operação aplica-se apenas a novas gerações.
- Não desativar endpoints antigos sem conhecer dependências e possuir rollback.
- Não classificar `sem turno` como `folga`.

A conversa MASTER continua a ser apenas um logbook de alterações validadas. Este documento é um registo de auditoria em PR aberto, não um registo de conclusões no MASTER.
