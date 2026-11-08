# PR #47 — Auditoria de consistência e reforço de invariantes

Base: `main` depois do PR #46, commit `1467136`.
**Esta é uma implementação em revisão, não uma validação funcional nem uma aprovação para merge.**
Os 23 pontos originais misturavam defeitos concretos, riscos, dívida técnica e funcionalidades deliberadamente ainda fora de âmbito. Um ponto "pendente" não foi corrigido nem pode ser dado como terminado.

| Nº | Observação | Estado PR #47 | Justificação / seguimento |
|---|---|---|---|
| 01 | Documentação desatualizada | Consolidado no E | README, arquitetura e roadmap distinguem versão estável PR46, alterações propostas PR47, experiência histórica e limites atuais; decisões/changelog históricos são preservados sem reescrever factos passados |
| 02 | Ausência de turno apresentada como folga | Corrigido | Vista mensal passa a dizer "Sem turno"; resumo diário mostra "Por planear" |
| 03 | API de aprovações antiga ativa no Supabase | Desativação técnica publicada, verificação HTTP pendente | Em 08/11/2026 foi publicada a Edge Function inerte `official-schedules` v6 (`verify_jwt=true`), que devolve 410; fonte v5 arquivada em 13 ficheiros para rollback. Confirmados metadados e fonte publicada, mas ainda falta ensaio HTTP autenticado e avaliação de consumidores externos |
| 04 | Importação de browser para conta nova sem confirmar titularidade | Corrigido no adaptador | Consentimento explícito associado à conta; estado cloud mantém precedência |
| 05 | Migrações Git ≠ objetos implantados | Nove versões alinhadas no Git e Supabase; integração real verificada | Quatro históricas + cinco migrações PR47 publicadas (`20261108124759`, `20261108124844`, `20261108141507`, `20261108142521`, `20261108144725`); CI aplica esquema limpo em PostgreSQL 17. Gravação CAS e RLS ensaiados em transações reais revertidas; testes HTTP do serviço oficial pendentes |
| 06 | Calendário agrega dias de propostas diferentes | Isolamento de propostas implementado (C) | Vista por ID de proposta usa apenas um snapshot; panorama mantém propostas independentes com alertas de sobreposição e mistura, sem validar a combinação como escala oficial |
| 07 | Limite de 40h usado como alvo pelo otimizador | Implementado no B (opt-in) | Contrato semanal por pessoa é limite hard; objetivo semanal é soft; sem campos prevalece o comportamento PR41 (40h). Horas extraordinárias não são inferidas |
| 08 | Falta de certificação independente após otimizações | Corrigido | `certifyFinalGeneratedSchedule` examina trabalho, cobertura, elegibilidade, período, dias obrigatórios e jornadas curtas |
| 09 | Jornada curta conflita com refeição obrigatória | Corrigido | Jornada integral significa presença do início ao fim e admite refeição legal, que continua a ser validada |
| 10 | Disponibilidade vs obrigação de trabalhar | Separado no B | Introduzidas datas obrigatórias explícitas por colaborador, independentes da disponibilidade; a opção global existente mantém semântica e valor original |
| 11 | Editor substituía silenciosamente intervalos adicionais | Editor completo acrescentado na preparação de testes | Agora é possível criar, alterar e remover todos os períodos nos padrões/ exceções de operação e disponibilidade; valida sobreposições e limites de funcionamento, com regressões automáticas |
| 12 | Exceções duplicadas por data | Corrigido preventivamente | Novas datas livres, bloqueio ao alterar para data repetida e aviso para duplicados históricos |
| 13 | Validação superficial de snapshots persistidos | Reforçado (C) | Validação de estrutura e metadados; registos incompatíveis isolados da consulta de leitura parcial, com erro visível e estado incerto apenas nas datas afetadas; leitura estrita continua a falhar fechada |
| 14 | Fecho do navegador durante gravação | Mitigado e retry idempotente (C) | Alerta de saída, ID estável por tentativa, reenvio com o mesmo UUID e confirmação de conteúdo se o servidor devolveu conflito 409; não garante conclusão quando o browser é encerrado à força |
| 15 | Fuso horário divergente entre partes da aplicação | Implementado no B | Fuso IANA único e persistido opcionalmente no estado v4, default legado Azores; calendário, gerador e cálculo visual de horas efetivas passam a usá-lo; arquivo mantém fuso do snapshot |
| 16 | Conflito de escrita deixa utilizador bloqueado | CAS real ensaiado; UX entre separadores ainda a aceitar | Fila sequencial, reconciliação de escritas disjuntas, bloqueio de conflitos incompatíveis e identidade por sessão. Ensaio real em `BEGIN/ROLLBACK` provou que escrita com revisão obsoleta é rejeitada (`40001`) e não altera a revisão; teste visual Safari em dois separadores permanece por confirmar |
| 17 | Aprovação oficial ausente da UI | Infraestrutura publicada, aprovação deliberadamente bloqueada sem história | Edge Function `official-schedules-v2` **v1 ACTIVE** com `verify_jwt=true` e CORS; versão antiga `official-schedules` v6 continua 410. Domínio, revisão, ledger por CAS e inicialização verificada instalados. Flag de aprovações na UI fica desativada; horários externos de 2026 não importados, logo não é seguro aprovar e falta aceitação HTTP real |
| 18 | Ciclos de 28 dias vs limite do gerador de 14 | Implementado em núcleo, UI e PostgreSQL; teste Safari pendente | `test:four-week` certifica 28 dias em conjunto e rejeita 29; a migração `20261108124759` está aplicada, preservou as quatro propostas e a UI PR47 aceita até 28 dias. Falta aceitação funcional de um ciclo real maior |
| 19 | `Person` sem contratos e perfis avançados | Requisitos V0 implementados; ocorrências oficiais dependem do ponto 17 | Limite semanal hard, objetivo soft, dias obrigatórios, ausências por data `unavailableWorkDates` e `qualificationTags` editáveis na UI. Cobertura por qualificação e ausência como hard constraint têm regressões; vínculos contratuais tipificados não foram especificados |
| 20 | Avisos de segurança Supabase | RPC real corrigido, aviso Auth ainda pendente | Migração `20261108124844` aplicada. Função pública `SECURITY INVOKER`, interna privada `SECURITY DEFINER`; auditor já não reporta exposição da função. A proteção contra palavras-passe comprometidas continua desativada e requer intervenção Auth/possivelmente plano pago |
| 21 | Experiências antigas no repositório | Limpeza seletiva implementada no E | Removidas 3 interfaces experimentais desligadas, eliminados laboratórios inacessíveis do wrapper do gerador; código de domínio e testes de aprovação mantidos; novo teste de arquitetura impede regressões |
| 22 | Terminologia antiga na interface | Corrigido | Gravação Supabase e menções ao PR41 atualizadas |
| 23 | Invariantes sem regressões dedicadas | CI completo e RLS de duas contas reais em SQL; aceite parcialmente | Testes de motor, PostgreSQL, revisões, JWT/HTTP simulados, CORS e recovery passam. Contas reais A/B guardaram configurações e propostas separadas no Safari; com `SET LOCAL ROLE authenticated` e `auth.uid()` do titular, a base real mostra apenas 1 proposta em A e 3 em B. Faltam JWTs HTTP independentes, stress e aceitação visual específica para 28 dias, aborto de gravação e dois separadores |

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

## Checkpoint E — manutenção, dependências e documentação (implementado na branch PR #47)

### Limpeza seletiva com recuperação pelo Git

- `src/components/ScheduleGeneratorPanel.tsx` foi reduzido a um wrapper do **único gerador condicionado ativo**. Os laboratórios PR17/18/19 que ocupavam centenas de linhas e não eram renderizados pela aplicação foram retirados.
- Removidos da branch os componentes de demonstração desligados `src/components/ApprovedContextIntegrationLab.tsx`, `src/components/DailyGeneratorPanel.tsx` e `src/components/PeriodGeneratorPanel.tsx`.
- Os módulos de domínio `src/utils/approvedSchedules.ts`, `src/application/executeApprovedScheduleCommand.ts`, `src/persistence/supabaseApprovedLedgerRepository.ts` e respetivos testes continuam disponíveis. Não foram reativados nem eliminados.
- `scripts/architectureBoundaryTest.mjs` percorre os imports reais a partir de `src/main.tsx`, verifica que a interface não importa os módulos de aprovação experimentais e que o núcleo do scheduling não depende de React/browser/persistência.
- Todo o conteúdo eliminado mantém-se no histórico do PR Git; o rollback da branch está protegido por `safety/pr46-baseline`.

### Correções de segurança do ambiente npm

- A auditoria do **lockfile anterior** identificou 7 dependências vulneráveis: 4 avisos altos e 3 moderados, em ferramentas de desenvolvimento/transitivos. A auditoria apenas das dependências de produção tinha resultado 0.
- O Vite foi atualizado da série 5.4 para a série 6.4 corrigida, com `vite@6.4.5` **fixado no package-lock**. O lockfile foi regenerado em CI por `npm install --package-lock-only` e `npm audit fix --package-lock-only` e integrado na branch, sem conceder ao CI permissões de escrita no GitHub.
- Na verificação CI após a atualização, `npm ci`, `npm run audit:dependencies`, `npm test`, `npm run typecheck` e `npm run build` passaram. A auditoria completa **e a de produção** devolveram **0 avisos** no momento dessa execução (run `42376580211`).
- O novo `scripts/npmDependencyAudit.mjs` utiliza `npm audit --json` e bloqueia CI se houver vulnerabilidades **moderadas, altas ou críticas** em qualquer dependência; falha também se o relatório não puder ser obtido. Não mascara falhas de rede como ausência de problemas.
- Não foi feita uma migração de React nem uma atualização ampla de dependências de runtime, porque o objetivo é reduzir riscos sem alterar desnecessariamente a interface aprovada.

### Documentação operacional

- README reescrito para o produto atual (interface mensal/diária, 14 dias de geração, snapshots não aprovados, regras individuais e ciclos apenas contabilísticos).
- `docs/architecture.md` atualizado com o grafo de camadas e separação entre estado atual e etapas históricas.
- `docs/roadmap.md` identificado como percurso histórico; próximo passo passa a ser a auditoria final de regressão do PR #47, não a ativação automática de aprovação.
- `docs/supabase-setup.md` e baseline de segurança já tinham sido alinhados no Checkpoint D.

**Limites:** a limpeza não converte o domínio de aprovação antiga em funcionalidade ativa. A atualização Vite foi validada em Linux/CI; a aceitação Safari e a auditoria de ponta a ponta ainda são tarefas do Checkpoint F. As pendências externas do Supabase mantêm-se separadas e não devem ser assinaladas como resolvidas neste checkpoint.

## Checkpoint F — auditoria de regressão automatizada (implementado na branch PR #47)

**Verificações e correções efetivamente concluídas:**

1. **Indicadores semanais coerentes:** `src/utils/weeklyWorkSummary.ts` aplica o limite individual hard, o objetivo semanal soft e minutos efetivos reais no fuso da proposta. A vista do gerador já não apresenta 40h como objetivo universal e distingue défice e excesso face ao alvo. Transições DST que não permitam medir horas de forma inequívoca não são apresentadas como números certificados.
2. **Panorama e painel com a mesma classificação:** `archiveDayState` unifica os estados `loading`, `failed`, `unknown`, `outside-proposal`, `closed`, `proposal` e `unplanned`. Na ausência de confirmação do arquivo, o calendário/painel não anunciam folgas nem ausências definitivas; a gestão diária fica bloqueada quando o estado não pode ser confirmado.
3. **Prova rápida de falta de capacidade:** o limite superior de capacidade semanal soma **hard caps por pessoa**; a cobertura requerida é medida em tempo efetivamente decorrido no fuso IANA, não em horas de relógio de uma transição DST. Caso a hora seja ambígua/inexistente, não é produzida uma prova falsa de inviabilidade.
4. **Obrigações no contexto exterior:** datas obrigatórias explicitamente configuradas dentro do intervalo exterior declarado completo são confrontadas com os turnos conhecidos. A confirmação de «sem turnos exteriores» contraditória com um dia obrigatório é rejeitada. A certificação independente aplica a mesma regra.
5. **Gravação de configurações:** revisões Supabase associadas ao proprietário autenticado; leituras e gravações verificam novamente a identidade após respostas assíncronas. Gravações rápidas da mesma sessão são serializadas, sem retirar o controlo de conflitos CAS entre abas.
6. **Sessões Supabase:** logout local imediato, impedindo uma resposta atrasada de renovação de reabrir a sessão terminada ou um logout antigo de apagar uma sessão nova. Regressões adicionadas para ambos os casos.
7. **Testes:** `src/finalRegressionCheckpointTest.ts` certifica indicadores, DST e estados de arquivo. `src/finalSchedulingMatrixTest.ts` verifica **12 cenários determinísticos**, repetibilidade e ausência de publicação de turnos parciais: **4 gerados e certificados independentemente, 8 rejeitados sem atribuições**, incluindo 3 limites de pesquisa. A matriz exige explicitamente resultados gerados e rejeitados, impedindo aprovação vazia. A suite de persistência e a de modelos ganharam cenários de concorrência, troca de conta, capacidade pessoal, DST e obrigações exteriores.
8. **Validação técnica:** `npm ci`, `npm run audit:dependencies`, `npm test`, `npm run typecheck` e `npm run build` aprovados no GitHub Actions **42381720471**, commit `3e45bb8985c9a70ab0c0013af1a469642e69c02d`. O npm audit reportou zero avisos nessa execução.

### Portas de aceitação antes do merge (ainda pendentes de execução humana)

| Área | Verificação manual no Safari | Critério de aceitação |
|---|---|---|
| Estado inicial e login | Sair e entrar novamente na mesma conta | Configuração e último horário arquivado recuperados sem gerar outra vez |
| Operação e contratos | Alterar fuso, âncora de ciclo, limite e objetivo individuais | Valores mantidos após atualizar página; meta semanal coerente com cada contrato |
| Gerador | Repetir cenários reais: jornadas 5h/7h/9h, cobertura, refeição e descanso | Horário válido só quando todas as hard constraints passam |
| Contexto exterior | Declarar dia obrigatório fora do período e ausência de turnos | Rejeição explícita, sem arquivar proposta enganadora |
| Calendário mensal | Consultar propostas sobrepostas e fixar uma versão anterior | Dias fora da proposta não são preenchidos por snapshots diferentes |
| Gestão diária | Pesquisar, filtrar, selecionar pessoas em várias páginas e regressar | Seleção e resumo mantêm o comportamento aprovado em PR45 |
| Resiliência | Simular indisponibilidade de arquivo/recarregar | Nenhum «por planear», «folga» ou zero de colaboradores é dado como confirmado |
| Persistência | Alterar duas vezes a configuração rapidamente e recarregar | Última edição preservada; erros apresentados sem overwrite silencioso |
| Segurança/contas | Confirmar RLS com duas contas distintas num ambiente de teste | Sem leitura/gravação cruzada de pessoas, configurações ou propostas |

**Limites explícitos:** a suite não demonstra ótima distribuição global, não verifica uma geração contínua de 28 dias (limite atual 14), não transforma propostas em escalas aprovadas e não garante que a geração encontre toda e qualquer solução viável. Transições DST extremas e desempenho com equipas muito grandes exigem ensaios adicionais. A validação Safari e a validação de RLS entre contas reais **não foram executadas neste checkpoint**. Os avisos externos identificados no Checkpoint D continuam pendentes; nenhuma tabela, Edge Function ou configuração Auth foi alterada.

## Preparação de aceitação — capacidade real de testar (PR #47)

Depois do Checkpoint F foi realizada uma verificação de **testabilidade**,
não uma nova aprovação funcional.

- Verificou-se que o editor de carga contratual, objetivo soft e dias
  obrigatórios **já existia** na interface em
  **Regras → Carga contratual e objetivos**. Qualquer indicação anterior
  de que seria impossível testar esses campos no Safari estava incorreta.
- Foi criado `src/components/IntervalListEditor.tsx`, com operações
  validadas em `src/utils/intervalEditing.ts`, que permite criar,
  alterar e remover múltiplos intervalos em **operação semanal**,
  **exceções operacionais**, **disponibilidade semanal** e
  **exceções de disponibilidade**. A validação impede sobreposições
  e, para disponibilidade, intervalos fora do funcionamento. Remover
  um intervalo inválido herdado continua permitido para recuperação.
- A suite `src/intervalEditorAcceptanceTest.ts` verifica divisão de
  jornadas, preservação dos restantes intervalos, rejeição de
  sobreposição, limites, fecho e integração com funções reais do domínio.
- Foi adicionado `scripts/checkRlsTwoAccounts.mjs`, um verificador
  **apenas de leitura** para **duas contas de staging**, sem permissões
  privilegiadas. Não é executado automaticamente em CI porque exige
  contas reais; `npm run test:rls-script-syntax` verifica sintaxe
  sem credenciais ou ligação remota.
- O protocolo explícito está em
  **[docs/pr47-acceptance.md](pr47-acceptance.md)**: passos Safari,
  resultados esperados, evidência e critérios de bloqueio de merge.
  Os ensaios de corrupção e respostas perdidas são feitos em mocks
  automatizados em vez de alterar snapshots reais.
- **Nenhum caso manual Safari nem isolamento entre duas contas reais
  é considerado PASS nesta preparação.** Continuam a aguardar execução.

Sem alterações destrutivas no Supabase; `main` e
`safety/pr46-baseline` mantêm-se estáveis.

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


## Operação Supabase em 08/11/2026 — função legada

- Após autorização expressa para corrigir os pontos, foi publicada `official-schedules` v6, substituindo a implementação anterior por resposta HTTP 410, com `verify_jwt=true`.
- Projeto: `schedule-engine` (`zuczsheoixuwienbkprz`); SHA256 do bundle publicado: `c75be37b56e18f7783c5c0855ba4af81245a848b751069058cbfd5885750ec58`.
- Confirmados por leitura Supabase o número da versão, o modo JWT e o conteúdo integral do único `index.ts` publicado.
- **Não realizado:** chamada HTTP autenticada à função; análise de consumidores externos; teste de rollback em ambiente isolado.
- A versão v5 original permanece arquivada em `supabase/rollback/official-schedules-v5/`; reimplantação pode recuperar o endpoint caso se confirme dependência legítima.
- Nenhuma tabela ou registo foi apagado nesta operação. Esta alteração operacional foi feita fora de uma migração e deve ser incluída no inventário de deployment.


## Execução de testes sem branch paga — 08/11/2026

- Foram reutilizados os jobs `validate` e `migration-contract` no GitHub Actions, com PostgreSQL 17 temporário e duas identidades sintéticas; **não foi criada nem cobrada nenhuma branch de desenvolvimento Supabase**.
- Em `8d6bb69`, o workflow `42481514857` concluiu com `success` depois de ampliar `scripts/ci/postgres_migration_assertions.sql` para testar o isolamento entre duas contas em estados, históricos, propostas e ledgers, além de recusar escrita cruzada.
- O CI também faz migração limpa, exercício da RPC privada, verificação do histórico/CAS e ensaio de rollback; essas provas são sintéticas e **não equivalem a autenticação real GoTrue nem à API Supabase**.
- Os 23 pontos continuam sujeitos às portas de aceitação descritas em `docs/pr47-acceptance.md`. O ensaio real de duas contas ficará BLOCKED enquanto não houver ambiente de testes seguro sem custo; não se justifica introduzir dados fictícios na instância operacional para forçar um PASS.


## Atualização verificada na instância — 08/11/2026

- A migração de 28 dias foi aplicada no Supabase com versão **20261108124759** e `CHECK (end_date >= start_date AND end_date < start_date + 28)` confirmado por leitura independente; **4 propostas** continuam presentes.
- A migração de segurança da RPC foi aplicada com versão **20261108124844**. `public.save_schedule_engine_state` deixou de ser `SECURITY DEFINER`; `schedule_engine_private.save_state_impl` mantém a validação de proprietário e o controlo de revisão. A função pública permanece autorizada apenas para `authenticated`, não para `anon`.
- A verificação dos avisos de segurança Supabase passou de **2 para 1**; permanece exclusivamente o aviso de proteção de palavras-passe comprometidas. A documentação Supabase indica que esta opção está disponível **no plano Pro e superior**.
- A UI da branch PR47 foi ajustada para aceitar 28 dias, sem depender de feature flag; a instalação noutras instâncias exige aplicar primeiro as migrações correspondentes. CI e Safari da nova UI ainda devem ser confirmados.
- Não foram eliminados registos nem feita aprovação oficial. **Atualização de aceitação Safari em 08/11/2026:** duas contas de teste autenticadas; dados locais antigos recusados por omissão; nova opção de começar vazia funcionou; colaborador A1 persistiu na conta A após reload; B1 persistiu na conta B, sem mostrar A1. Leitura SQL read-only confirmou 1 conta apenas A1, 1 apenas B1, 0 ambas; persistência e segregação por proprietário confirmadas em armazenamento. Falta prova RLS cruzada com JWTs reais, teste inverso A e arquivo de propostas em cada conta.


## Verificação transacional não destrutiva da RPC em Supabase

- Após a migração do RPC privado, foi executado um ensaio com `SET LOCAL ROLE authenticated` e identidade de titular obtida da própria tabela, usando a configuração existente e a revisão corrente como payload idêntico.
- `public.save_schedule_engine_state` devolveu a revisão existente; o ensaio foi envolvido em `BEGIN`/`ROLLBACK`, sem confirmar transação e sem modificar o estado.
- Esta prova verifica percurso de permissões e idempotência da RPC no PostgreSQL real, **não** substitui um token Supabase Auth real nem valida duas sessões concorrentes via HTTP.


## Fecho consolidado — 08/11/2026 (após testes A/B)

- **API nova publicada:** `official-schedules-v2` v1 ativa, `verify_jwt=true`, imports locais resolvidos, CORS de `OPTIONS` ensaiado em CI; `official-schedules` v6 anterior mantém-se inerte. O deploy não reativou aprovações no browser, pois falta o histórico externo anterior.
- **RLS real de duas contas:** consultas com papel `authenticated`, identidades A/B e transações `ROLLBACK` retornaram 1 estado/1 proposta para A e 1 estado/3 propostas para B. O utilizador confirmou a persistência após recarregar; não surgiram dados cruzados.
- **Conflito CAS real:** uma alteração transitória na conta fictícia A foi aceite com revisão atual e a repetição com revisão obsoleta foi rejeitada (`40001`); a transação foi integralmente revertida. Nenhuma configuração real foi modificada.
- **Sem falsa aprovação:** no Supabase continuam zero ledgers oficiais e zero dias de histórico importado. O mecanismo só poderá aprovar depois da importação e comprovação do contexto relevante; o utilizador decidiu adiar essa importação.
- **Limitação externa:** `auth_leaked_password_protection` continua a ser o único aviso do Security Advisor. O plano gratuito não disponibiliza a respetiva proteção; não foi ativado serviço pago nem criada infraestrutura adicional.
- **Sem provas indevidas:** confirmação HTTP autenticada de Edge v1/v2, execução Safari de 28 dias, cenário de fecho forçado e conflito simultâneo no navegador, e stress maior continuam pendentes. Não rotular os 23 pontos como encerrados enquanto faltar a respetiva evidência.
