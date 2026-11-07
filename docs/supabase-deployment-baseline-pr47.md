# PR #47 / Checkpoint D — Estado real do Supabase e recuperação

**Observação (2026-11-07):** auditoria exclusivamente de leitura; nenhuma
migração, alteração de Auth, eliminação de dados ou publicação de Edge Function
foi executada neste checkpoint.

**Instância observada:** projeto `schedule-engine`, região `eu-west-1`,
PostgreSQL 17.11. O núcleo de scheduling continua independente do Supabase.
A `main` do repositório mantém a baseline do PR #46 (`1467136`); todas
as alterações deste documento estão na branch do PR #47.

## 1. Relações e dados

| Relação public | RLS | Registos observados | Fluxo atual |
|---|---|---:|---|
| `schedule_engine_states` | Ativo | 1 | Configuração da aplicação |
| `schedule_engine_state_history` | Ativo | 216 | Revisões históricas de configuração |
| `schedule_engine_generated_schedules` | Ativo | 4 | Arquivo de propostas **não aprovadas** |
| `schedule_engine_approved_ledgers` | Ativo | 0 | Legado / fora da UI atual |
| `schedule_engine_approved_ledger_history` | Ativo | 0 | Legado / fora da UI atual |

Na data da vistoria, os quatro snapshots pertenciam à classe
`user_attested_no_external_shifts`. O esquema da base também permite a classe
legada `official_approved_context`, introduzida nos PRs anteriores, mas esta
não é um contexto aceite nem aprovado pelo fluxo ativo de propostas.

**Não fazer alterações aos dados para resolver esta divergência.** Um snapshot
com metadados antigos deve ser examinado separadamente, sem ser reclassificado
como proposta recente.

## 2. Permissões verificadas no PostgreSQL

- As cinco tabelas têm RLS ativo; leitura de cada proprietário por
  `auth.uid() = owner_id`.
- `states` e `state_history`: `authenticated` apenas faz SELECT direto.
  A gravação da configuração usa o RPC autenticado de controlo de revisão.
- `generated_schedules`: SELECT e INSERT restrito às colunas
  `id, owner_id, start_date, end_date, time_zone, payload`. A data
  `created_at` vem do servidor. Sem UPDATE/DELETE pelo browser.
- `approved_ledgers` e respetivo histórico: SELECT por proprietário,
  sem INSERT/UPDATE/DELETE direto por utilizador autenticado.
- As funções privilegiadas antigas
  `initialize_schedule_engine_approved_ledger` e
  `commit_schedule_engine_approved_ledger` **não concedem EXECUTE a
  `anon` nem a `authenticated`**.
- `public.save_schedule_engine_state(bigint,jsonb)` é `SECURITY DEFINER`,
  exige utilizador autenticado não anónimo, usa `search_path` vazio,
  `auth.uid()` e controlo de revisão. `anon` não a executa;
  `authenticated` **pode executá-la intencionalmente**. Revogar-lhe
  o privilégio sem substituição bloquearia a configuração da aplicação.

O último item constitui um **aviso de superfície privilegiada**, não prova
por si só uma exploração. Qualquer migração futura para uma implementação
`SECURITY INVOKER` / esquema interno deve ser ensaiada num ambiente
isolado e preservar atomicidade, proprietário e histórico antes da publicação.

## 3. Divergência de migrações

O Git corrente mantém três ficheiros ativos de migração:
- `20261025_schedule_engine_state_v0.sql` — baseline inicial, aplicada
  historicamente fora do registo de migrações atual;
- `20261026_schedule_engine_approved_ledgers_v0.sql` — protótipo de
  ledger anterior, **não é o esquema oficial atual**;
- `20261102120000_generated_schedule_proposals.sql` — proposta imutável.

O historial **realmente registado** na instância é:

| Versão no Supabase | Nome |
|---|---|
| 20261102125810 | `generated_schedule_proposals` |
| 20261103100427 | `trusted_approved_schedule_ledger` |
| 20261103101604 | `approved_context_proposals` |
| 20261103104023 | `partial_schedule_revisions` |

Os horários e IDs dos ficheiros originais diferem dos IDs registados no
servidor. As três migrações do antigo PR #43 foram preservadas, **apenas
como arquivo histórico**, em `supabase/rollback/pr43-migration-lineage/`;
não foram reinseridas na pasta ativa `supabase/migrations/`, para não
reativar automaticamente um fluxo de aprovação retirado do produto.

Consequência: **não executar `supabase db push` contra a instância real**
com esta árvore sem uma reconciliação verificada de IDs, SQL e dependências.
A simples cópia das migrações antigas para os nomes atuais não certifica a
reprodutibilidade. A próxima etapa que envolva DDL terá primeiro de criar
e verificar um baseline num ambiente isolado, sem copiar dados privados.

Diferenças já confirmadas:
- O CHECK SQL de `generated_schedules` aceita
  `official_approved_context` além do âmbito atual da UI.
- `approved_ledger_history.operation` aceita `revise`, mas a função
  SQL publicada `commit_schedule_engine_approved_ledger` valida somente
  `approve`, `replace` e `cancel`. A Edge Function antiga pode enviar
  `revise`: **a funcionalidade histórica não é coerente e não deve ser
  considerada operacionalmente certificada**.
- A migração original do ledger tem estrutura e métodos diferentes dos
  objetos oficiais herdados.

## 4. Edge Function antiga

Serviço: `official-schedules`, **ACTIVE**, versão 5, `verify_jwt=true`.

Hash de publicação reportado pelo Supabase:
`8cc1967656a0c62d7c6cbbf8ddd309ab52c942e0bb501fc0f1b0c4e3124e2649`.

Foram arquivados os **13 ficheiros efetivamente devolvidos pelo Supabase**
(107 295 caracteres em conjunto), com a mesma disposição de imports, em
`supabase/rollback/official-schedules-v5/`. Este é o pacote de **código
publicado**, não uma cópia dos dados da base de dados nem uma garantia de
recuperação de variáveis secretas.

A alternativa de desativação não destrutiva foi preparada em
`supabase/deployment/official-schedules-disabled/index.ts`: responde
`410` sem aceder à base de dados. **Não está publicada**.

Não desativar o serviço sem confirmar utilização externa e sem preparar um
plano de reversão. A ausência de botões de aprovação na interface atual
não demonstra por si só que nenhum cliente externo utilize o endpoint.

### Procedimento para uma futura desativação, caso seja aprovada

1. Confirmar a inexistência de clientes dependentes e consultar logs
   de invocações. Não tratar a ausência de tráfego recente como prova.
2. Validar previamente a reinstalação do bundle v5 num ambiente isolado,
   mantendo `verify_jwt=true`, permissões e dependências originais.
3. Confirmar existência e restauro de um backup dos dados **por mecanismo
   separado do Git**, incluindo as 216 revisões de configuração. Não
   incluir IDs de pessoas ou JSON de clientes no repositório.
4. Guardar a referência e o estado da versão publicada. Só então decidir
   a publicação da implementação inerte com `verify_jwt=true`.
5. Se houver impacto, **republicar os 13 ficheiros preservados**, com
   entrypoint `supabase/functions/official-schedules/index.ts` e
   `verify_jwt=true`; validar autenticação e disponibilidade após a
   publicação. Não é necessário eliminar tabelas para fazer rollback
   desta alteração de Edge Function.
6. Reexecutar a auditoria SQL exclusivamente de leitura.

**Nota:** o bundle v5 usa módulos importados da árvore `src/` guardada
juntamente com a função. Não republicar apenas o `index.ts`; a reposição
exige o pacote completo.

## 5. Avisos atuais e decisão

O Security Advisor devolveu:

1. `authenticated_security_definer_function_executable` no RPC de
   configuração. **Pendente de refatoração segura**; não corrigir
   revogando o EXECUTE necessário à aplicação.
2. `auth_leaked_password_protection`: proteção de palavras-passe
   comprometidas desativada. Configuração manual de Supabase Auth,
   disponível conforme o plano e as opções do projeto. Não existe ação
   apropriada nesta integração para a ativar sem intervenção no painel.

O Performance Advisor não devolveu avisos nesta observação. O resultado
é pontual e deverá ser repetido depois de quaisquer alterações.

Documentação:
- https://supabase.com/docs/guides/observability/advisors?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/auth/password-security

## 6. Verificação repetível e CI

- `supabase/audit/pr47_checkpoint_d_readonly.sql` contém inventário
  **apenas SELECT**: tabelas, RLS, policies, grants efetivos, funções,
  constraints, índices, versões de migração, totais e classes de snapshots.
- `scripts/supabaseSecurityContractTest.mjs` corre offline em `npm test`:
  verifica contracts explícitos das migrações, ausência de credenciais
  privilegiadas na UI, conjunto completo dos 13 ficheiros de recuperação,
  substituição inerte e que a auditoria não introduz SQL de escrita.

Os testes offline **não atestam o estado real** nem substituem os resultados
read-only obtidos no Supabase. A auditoria de segurança deve voltar a ser
executada após qualquer DDL/deploy.

## 7. Rollback da PR #47

- **Antes do merge:** usar a `main` e o ponto Git
  `safety/pr46-baseline`, ambos em
  `1467136e081087aa724875176c6de70428175249`.
- **Depois do merge:** reverter o commit de integração com um novo commit,
  sem reescrever o histórico.
- **Até agora:** nenhuma alteração de dados, DDL, Auth ou Edge Function
  foi publicada pelo Checkpoint D. Por isso, o rollback do Checkpoint D,
  nesta fase, é somente uma reversão do Git.
- **Futuro:** uma migração ou alteração de configurações externas só tem
  rollback garantido se as cópias/restauros correspondentes tiverem sido
  verificados **antes** da operação. Um snapshot de código não recupera
  configurações Auth nem dados apagados.

## Pendências controladas

- Definir e executar reconciliação num ambiente de staging isolado, depois
  de uma decisão sobre manter ou retirar o legado de aprovações.
- Validar de forma prática backup/restauro de esquema e dados antes de
  qualquer DDL na instância real.
- Decidir se a Edge Function de aprovações deve ser desativada.
- Avaliar migração segura do RPC de configuração para um schema interno
  com superfície pública `SECURITY INVOKER`, preservando o contrato.
- Ativar proteção de palavras-passe comprometidas quando o plano e as
  permissões o permitirem.
- Rever dependências do projeto e respetivos avisos `npm audit` no
  Checkpoint E.

O MASTER deverá incluir apenas ações que tenham sido concluídas e
verificadas, e não as pendências desta auditoria.
