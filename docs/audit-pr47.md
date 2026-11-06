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
| 07 | Limite de 40h usado como alvo pelo otimizador | Pendente — decisão de domínio | Separar hard maximum, carga contratual e alvo soft por pessoa; não alterar silenciosamente resultados atuais |
| 08 | Falta de certificação independente após otimizações | Corrigido | `certifyFinalGeneratedSchedule` examina trabalho, cobertura, elegibilidade, período, dias obrigatórios e jornadas curtas |
| 09 | Jornada curta conflita com refeição obrigatória | Corrigido | Jornada integral significa presença do início ao fim e admite refeição legal, que continua a ser validada |
| 10 | Disponibilidade vs obrigação de trabalhar | Sem mudança intencional | `requireShiftsOnAvailableDays` permanece opt-in explícito; futura separação por contrato/escala |
| 11 | Editor substituía silenciosamente intervalos adicionais | Corrigido | Modificação do primeiro intervalo preserva restantes; editor multi-intervalos completo continua pendente |
| 12 | Exceções duplicadas por data | Corrigido preventivamente | Novas datas livres, bloqueio ao alterar para data repetida e aviso para duplicados históricos |
| 13 | Validação superficial de snapshots persistidos | Reforçado | Verifica forma v4, semana completa, intervalos, regras de trabalho e fuso; validação de políticas e versões evolutivas continua necessária |
| 14 | Fecho do navegador durante gravação | Mitigado | Alerta de saída durante pedido pendente; não há garantia em encerramento forçado do browser |
| 15 | Fuso horário divergente entre partes da aplicação | Pendente — modelo de dados | Requer configuração de fuso por operação, migração de estado e semântica consistente de durações |
| 16 | Conflito de escrita deixa utilizador bloqueado | Mitigado | Em falha após hidratação, permite exportar configuração local pendente; não realiza merge concorrente automático |
| 17 | Aprovação oficial ausente da UI | Sem mudança intencional | Decisão explícita do rollback; reintroduzir exigiria uma nova fronteira confiável e contrato de aprovação |
| 18 | Ciclos de 28 dias vs limite do gerador de 14 | Pendente — arquitetura/algoritmo | Alteração exige validação de capacidade e contexto em janelas maiores; não mudar apenas constante |
| 19 | `Person` sem contratos e perfis avançados | Pendente — domínio | Definir contrato, carga, função e qualificações apenas quando os requisitos forem concretizados |
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

## Critérios antes de qualquer merge

1. `npm test`, `npm run typecheck` e `npm run build` aprovados em CI.
2. Validar que o gerador mantém resultados legalmente válidos nos cenários reais já utilizados.
3. Conferir que a nova proteção de importação não altera contas com estado Supabase já existente.
4. Testar manualmente recuperação de snapshots e aviso de propostas diferentes.
5. Testar edição de configurações históricas com múltiplos intervalos.
6. Confirmar que o PR não altera nem apaga dados ou Edge Functions em produção.

## Decisões que NÃO foram tomadas implicitamente

- Não converter propostas em escalas aprovadas.
- Não inventar contratos ou objetivos individuais de horas.
- Não elevar o limite de 14 para 28 dias sem dimensionar o algoritmo.
- Não modificar o fuso horário da operação sem um modelo persistido explícito.
- Não desativar endpoints antigos sem conhecer dependências e possuir rollback.
- Não classificar `sem turno` como `folga`.

A conversa MASTER continua a ser apenas um logbook de alterações validadas. Este documento é um registo de auditoria em PR aberto, não um registo de conclusões no MASTER.
