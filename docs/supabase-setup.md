# Supabase — configuração e arquivo do Schedule Engine

> Estado revisto durante o **PR #47 / Checkpoint D**. O produto ativo
> usa configuração persistente e propostas geradas imutáveis. Os serviços
> de aprovação oficiais dos PRs antigos **não fazem parte da interface
> atual** e continuam isolados enquanto não for tomada uma decisão
> explícita sobre a infraestrutura. Consultar
> [baseline técnica](supabase-deployment-baseline-pr47.md) antes de
> qualquer migração ou publicação.

## Princípio de arquitetura

O Supabase guarda o estado e o arquivo de propostas. O motor de scheduling
funciona independentemente do armazenamento e das rotas HTTP.

O servidor Vite é apenas o ambiente de desenvolvimento da interface.
Uma proposta gerada e guardada **não está oficialmente aprovada**.

## Instalação limpa — reprodução do contrato de base de dados

O PR #47 mantém **quatro migrações históricas** e duas migrações de
2026-11-08 com identificadores correspondentes ao Supabase publicado. Estes scripts foram reconstruídos a partir das
linhagens históricas e **ensaiados numa instância PostgreSQL 17
descartável no CI**, com stubs de autenticação: não são um dump
byte a byte da instância de produção.

1. Criar um projeto Supabase de teste independente.
2. Aplicar/reconciliar por ordem os scripts disponíveis em
   `supabase/migrations/`:
   - `20261102125810_generated_schedule_proposals.sql`
     (inclui as tabelas/configuração anteriores ao histórico remoto
     e o arquivo originalmente limitado a 14 dias);
   - `20261103100427_trusted_approved_schedule_ledger.sql`;
   - `20261103101604_approved_context_proposals.sql`;
   - `20261103104023_partial_schedule_revisions.sql`;
   - `20261108124759_pr47_four_week_proposals.sql`
     (aumenta o limite do CHECK do arquivo para 28 dias);
   - `20261108124844_pr47_state_rpc_private_schema.sql`
     (move a implementação privilegiada da gravação para esquema privado).
3. A presença de estruturas legadas do ledger **não ativa** aprovação
   oficial na UI. As funções privilegiadas legadas não recebem EXECUTE
   do papel `authenticated`.
4. Em **Authentication → Users**, criar a conta permanente e confirmar
   o email, quando necessário.
5. Usar o URL e a **publishable key** do projeto; nunca inserir
   `service_role` ou secret keys no frontend.
6. Configurar `.env.local`:

   ```env
   VITE_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SUA_CHAVE_PUBLICA
   # A branch PR47 suporta 28 dias após aplicar as migrações acima.
   ```

7. Reiniciar Vite para ler as variáveis e executar os testes de geração,
   arquivo, recuperação e duas contas.

**Na instância Schedule Engine, as migrações de 28 dias e RPC privado
já foram aplicadas e verificadas em 08/11/2026.** O CHECK atual é
`end_date < start_date + 28`. Não executar `supabase db push` nem
`migration repair` sem comparar o histórico: os seis IDs presentes no
repositório já constam do registo Supabase. Outras instalações exigem
aplicar as migrações antes de disponibilizar a nova interface.

A refatoração da RPC de configuração foi aplicada na migração
`20261108124844_pr47_state_rpc_private_schema.sql` e ensaiada em
PostgreSQL descartável. O script de deployment permanece em
`supabase/deployment/pr47_state_rpc_private_schema.sql` e o rollback
está em `supabase/rollback/pr47_state_rpc_public_restore.sql`.

## Primeira migração dos dados do browser

- A aplicação consulta primeiro o estado da conta autenticada no Supabase.
- Quando o estado remoto existe, este tem prioridade e não é substituído
  automaticamente pelos dados do navegador.
- Se a conta não possui estado e existem dados locais legados, é
  **necessária confirmação explícita da titularidade** antes da importação.
  O histórico local pode não identificar a conta de origem.
- Os dados locais e respetivas cópias não são apagados pelo importador.
- O estado e o histórico são escritos atomicamente com controlo de revisão
  no RPC `save_schedule_engine_state`.
- Em caso de concorrência, o adaptador tenta uma **conciliação conservadora
  em três versões**, fundindo apenas alterações independentes. Edições
  simultâneas incompatíveis ao mesmo campo continuam a bloquear a gravação;
  é possível exportar o estado pendente e, com confirmação, recarregar
  o estado remoto sem sobrescrever outras alterações.

A quantidade de colaboradores migrados depende dos dados reais dessa
conta. Não existe uma exigência fixa de três colaboradores.

## Segurança e permissões

- `schedule_engine_states`: configuração da conta, revisão atual.
- `schedule_engine_state_history`: histórico das alterações da conta.
- `schedule_engine_generated_schedules`: snapshots append-only de
  propostas, com SELECT e INSERT restrito às colunas necessárias.
- RLS ativo em todas estas tabelas. Cada conta autenticada tem acesso
  apenas aos seus registos.
- O browser não tem UPDATE ou DELETE sobre propostas, nem permissões
  diretas de escrita nas tabelas de configuração.
- Atualmente `public.save_schedule_engine_state` é `SECURITY INVOKER`
  no esquema público, com `EXECUTE` apenas para `authenticated`.
  `schedule_engine_private.save_state_impl` mantém `SECURITY DEFINER`,
  identidade do proprietário e CAS. O auditor Supabase deixou de reportar
  exposição direta de `SECURITY DEFINER`. A gravação real via Safari
  ainda tem de ser confirmada.
- A autorização entre membros da mesma organização ainda não existe.
  Dados continuam segregados por proprietário individual.
- Não incluir service keys, secrets, passwords, backups privados ou
  payloads reais de colaboradores no Git.

## Arquivo de horários

Ao gerar uma proposta válida, a aplicação envia um snapshot completo,
que fica imutável no Supabase. As consultas posteriores não regeneram
turnos nem substituem versões antigas. O calendário distingue propostas
independentes e pode fixar uma única versão para evitar falsa continuidade.

Quando existirem registos incompatíveis, a interface assinala
explicitamente que o arquivo está parcialmente ilegível, sem apresentar
esses registos como horários válidos.

## Auditoria, backup e recuperação

- Reexecutar a auditoria **read-only**
  `supabase/audit/pr47_checkpoint_d_readonly.sql` e as verificações
  `supabase/audit/pr47_checkpoint_d_assertions.sql` após alterações
  de DDL, RLS ou funções. Estas são consultas, não migrações.
- O código exato da Edge Function legada publicada foi arquivado em
  `supabase/rollback/official-schedules-v5/`. Isso **não** é um backup
  dos dados nem das definições de autenticação.
- Antes de alterações de produção, verificar cópias restauráveis da
  base de dados e um plano de reversão da Edge Function.
- A desativação inerte preparada em
  `supabase/deployment/official-schedules-disabled/` **não está
  publicada** e exige decisão específica após a análise de dependências.
- Os avisos do Security Advisor e as diferenças entre Git e Supabase
  estão identificados em
  `docs/supabase-deployment-baseline-pr47.md`.

## Validação antes de qualquer merge

Os testes de regressão e de contrato de segurança são executados em CI;
não substituem os testes de RLS e persistência com contas reais.

A validação final deverá incluir carregamento de configurações e
propostas após reinício, preservação de snapshots, isolamento entre
contas, resolução de conflitos e auditoria dos grants e políticas
instaladas. A `main` e `safety/pr46-baseline` continuam a ser o
ponto de regresso até à aprovação final do PR #47.
