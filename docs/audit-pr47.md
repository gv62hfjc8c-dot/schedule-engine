# PR #47 — Auditoria de consistência e reforço de invariantes

Base: `main` depois do PR #46, commit `1467136`.
**Esta é uma implementação em revisão, não uma validação funcional nem uma aprovação para merge.**
Os 23 pontos originais misturavam defeitos concretos, riscos, dívida técnica e funcionalidades deliberadamente ainda fora de âmbito. Um ponto "pendente" não foi corrigido nem pode ser dado como terminado.

| Nº | Observação | Estado PR #47 | Justificação / seguimento |
|---|---|---|---|
| 01 | Documentação desatualizada | Atualizado parcialmente | README, arquitetura, roadmap, guia Supabase; histórico mantém-se histórico |
| 02 | Ausência de turno apresentada como folga | Corrigido | Vista mensal passa a dizer "Sem turno"; resumo diário mostra "Por planear" |
| 03 | API de aprovações antiga ativa no Supabase | Preparação segura D; serviço ainda ativo | Preservado o bundle publicado v5 com 13 ficheiros e hash de release; preparado endpoint inerte 410, **não publicado**. Desativação só após análise de clientes e validação de recuperação |
| 04 | Importação de browser para conta nova sem confirmar titularidade | Corrigido no adaptador | Consentimento explícito associado à conta; estado cloud mantém precedência |
| 05 | Migrações Git ≠ objetos implantados | Inventário e linhagem guardados (D); reconciliação ainda pendente | Guardada baseline real (tabelas, policies, grants, functions, constraints, índices, IDs de migração). As 3 migrações antigas PR43 estão em rollback, fora da pasta executável. Falta validar reconstituição em staging |
| 06 | Calendário agrega dias de propostas diferentes | Isolamento de propostas implementado (C) | Vista por ID de proposta usa apenas um snapshot; panorama mantém propostas independentes com alertas de sobreposição e mistura, sem validar a combinação como escala oficial |
| 07 | Limite de 40h usado como alvo pelo otimizador | Implementado no B (opt-in) | Contrato semanal por pessoa é limite hard; objetivo semanal é soft; sem campos prevalece o comportamento PR41 (40h). Horas extraordinárias não são inferidas |
| 08 | Falta de certificação independente após otimizações | Corrigido | `certifyFinalGeneratedSchedule` examina trabalho, cobertura, elegibilidade, período, dias obrigatórios e jornadas curtas |
| 09 | Jornada curta conflita com refeição obrigatória | Corrigido | Jornada integral significa presença do início ao fim e admite refeição legal, que continua a ser validada |
| 10 | Disponibilidade vs obrigação de trabalhar | Separado no B | Introduzidas datas obrigatórias explícitas por colaborador, independentes da disponibilidade; a opção global existente mantém semântica e valor original |
| 11 | Editor substituía silenciosamente intervalos adicionais | Corrigido | Modificação do primeiro intervalo preserva restantes; editor multi-intervalos completo continua pendente |
| 12 | Exceções duplicadas por data | Corrigido preventivamente | Novas datas livres, bloqueio ao alterar para data repetida e aviso para duplicados históricos |
| 13 | Validação superficial de snapshots persistidos | Reforçado (C) | Validação de estrutura e metadados; registos incompatíveis isolados da consulta de leitura parcial, com erro visível e estado incerto apenas nas datas afetadas; leitura estrita continua a falhar fechada |
| 14 | Fecho do navegador durante gravação | Mitigado e retry idempotente (C) | Alerta de saída, ID estável por tentativa, reenvio com o mesmo UUID e confirmação de conteúdo se o servidor devolveu conflito 409; não garante conclusão quando o browser é encerrado à força |
| 15 | Fuso horário divergente entre partes da aplicação | Implementado no B | Fuso IANA único e persistido opcionalmente no estado v4, default legado Azores; calendário, gerador e cálculo visual de horas efetivas passam a usá-lo; arquivo mantém fuso do snapshot |
| 16 | Conflito de escrita deixa utilizador bloqueado | Mitigado | Em falha após hidratação, permite exportar configuração local pendente; não realiza merge concorrente automático |
| 17 | Aprovação oficial ausente da UI | Sem mudança intencional | Decisão explícita do rollback; reintroduzir exigiria uma nova fronteira confiável e contrato de aprovação |
| 18 | Ciclos de 28 dias vs limite do gerador de 14 | Modelo implementado, geração de 28 dias pendente | Ciclo fixo com âncora operacional, quatro subperíodos de sete dias, compatível com meses de 5 semanas e anos bissextos; gerador continua limitado a 14 dias até prova de capacidade |
| 19 | `Person` sem contratos e perfis avançados | Parcial (B) | Adicionados limite contratual semanal, objetivo semanal e datas obrigatórias; qualificações/funções e ausências continuam fora do modelo até requisitos concretos |
| 20 | Avisos de segurança Supabase | Auditados; 2 ajustes externos pendentes (D) | Função de estado mantém EXECUTE autenticado, pois é usada pela UI, mas é proprietária/revisada; avisos: SECURITY DEFINER exposto e proteção de palavras-passe comprometidas desativada. Refatoração e definição Auth exigem staging/operador |
| 21 | Experiências antigas no repositório | Pendente — inventário e remoção seletiva | Não eliminar módulos antes de auditar importações, testes e dependências do histórico |
| 22 | Terminologia antiga na interface | Corrigido | Gravação Supabase e menções ao PR41 atualizadas |
| 23 | Invariantes sem regressões dedicadas | Reforçado (A+B+C+D) | Regressões de motor, políticas, arquivo, e agora teste offline de credenciais, grants previstos, bundle Edge v5 e script SQL read-only; testes reais de Auth/RLS continuam pendentes |

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

## Checkpoint C — propostas sobrepostas, arquivo e recuperação (implementado na branch PR #47)

- **Dois modos de consulta claramente separados:** o panorama mensal continua a mostrar a proposta mais recente por dia, mas identifica quando há várias fontes/versões e avisa que essa composição não foi certificada. A partir de um dia é possível **fixar um único snapshot por ID**, impedindo que dias de outras propostas sejam apresentados na mesma vista.
- **Versões anteriores:** a escolha de uma versão fixa essa proposta no calendário; é possível regressar ao panorama sem apagar ou modificar registos. O conteúdo dos turnos, equipa e configuração continua a ser lido do snapshot original.
- **Arquivo parcialmente ilegível:** `listBetweenDetailed` devolve propostas verificadas e os metadados dos registos incompatíveis; a interface mostra um aviso e não interpreta datas potencialmente afetadas como «por planear» ou «folga». A consulta estrita `listBetween` continua a rejeitar um arquivo incompleto.
- **Paginação sem deslocamentos:** ordenação por `created_at DESC, id DESC`, com cursor composto; evita perder propostas antigas ou repetir registos quando novos horários são inseridos durante a leitura. Não existem eliminações nem alterações às políticas RLS.
- **Gravação e retry seguros:** um UUID é criado por proposta gerada; as tentativas posteriores utilizam o mesmo identificador. Um erro 409 só é interpretado como confirmação da gravação se a consulta autenticada devolver o **mesmo snapshot**; conteúdos divergentes são recusados. Novas gerações geram novos IDs.
- **Regressões:** `src/archiveConsistencyCheckpointTest.ts` cobre propostas sobrepostas, foco por ID, versões imutáveis, resposta de rede perdida após commit, 211 propostas paginadas, inserção concorrente, registos corrompidos e mudança de sessão. `src/generatedSchedulePersistenceTest.ts` foi adaptado à paginação por cursor.

**Limites:** não foi criada uma escala operacional consolidada a partir de propostas diferentes. O sistema permanece **append-only, com propostas não aprovadas**. A leitura parcial é explicitamente identificada e não certifica a ausência de horários em datas incertas. Encerramento forçado do navegador, interrupção de rede e volume extremo de arquivo necessitam de acompanhamento operacional adicional.

## Checkpoint D — Supabase, segurança e plano de recuperação (implementado no Git PR #47)

**Âmbito efetivamente concluído:**
- Leitura do esquema real da instância: 5 tabelas RLS; 1 estado de configuração, 216 revisões de estado, 4 propostas, 0 ledgers aprovados e 0 eventos oficiais, **no momento da vistoria**.
- Grants de escrita diretos inexistentes para o browser sobre estados e ledgers; INSERT da tabela de propostas só em colunas autorizadas. Funções privilegiadas de aprovação sem EXECUTE `anon` ou `authenticated`.
- Confirmada divergência de migrações entre Git e Supabase (4 versões no registo remoto vs 3 ficheiros no Git). Linhagem SQL do PR43 arquivada fora da pasta de migrações ativas, para impedir reativação acidental.
- A Edge Function antiga `official-schedules` v5 foi recuperada do servidor em **13 ficheiros**, guardados em `supabase/rollback/official-schedules-v5/` e identificados por manifesto/hashes. Tem `verify_jwt=true`. A alternativa inerte em `supabase/deployment/official-schedules-disabled/index.ts` está **preparada mas não publicada**.
- Confirmada incompatibilidade histórica: a Edge Function aceita pedidos de `revise` mas o RPC SQL de commit só permite `approve`, `replace`, `cancel`; não há registos oficiais na instância analisada.
- Criado o inventário exclusivamente SELECT `supabase/audit/pr47_checkpoint_d_readonly.sql` e a baseline `docs/supabase-deployment-baseline-pr47.md`. O ficheiro `supabase/audit/pr47_checkpoint_d_assertions.sql` devolveu **10 PASS em 10 verificações read-only** sobre o estado publicado. A incompatibilidade do `revise` antigo permanece WARN.
- Novo teste offline `scripts/supabaseSecurityContractTest.mjs`, executado por `npm test`, que verifica restrições previstas do SQL, ausência de credenciais privilegiadas no frontend, bundle de rollback e proibição de DDL no inventário.
- `docs/supabase-setup.md` alinhado com o produto atual, incluindo importação legada com consentimento e instruções seguras para instalações novas.

**Pendências explícitas, que não podem ser declaradas concluídas por alterações só no Git:**
1. Desativação do serviço de aprovações antigo — requer avaliação de dependências externas e publicação controlada.
2. Reconciliação dos IDs/SQL das migrações — requer validação num ambiente isolado e backup de dados restaurável.
3. Aviso do `SECURITY DEFINER` acessível ao papel `authenticated` — função ativa e necessária; refatorar sem quebrar o RPC atómico requer testes de staging.
4. Proteção de palavras-passe comprometidas — definição da plataforma que precisa de acesso ao Auth Dashboard/planos compatíveis.
5. Verificar recuperação de schema/dados e Edge Function antes de alterar a instância real.

**Sem produção alterada:** nenhuma migration, DDL, DML, Auth setting ou Edge Function foi aplicada/publicada no Checkpoint D. A `main` e `safety/pr46-baseline` continuam como fallback. Os guardrails offline não garantem por si só o estado real do Supabase.

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
