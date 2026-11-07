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

## Instalação nova — apenas o fluxo atual

1. Criar um projeto Supabase **dedicado** ao Schedule Engine.
2. Rever e aplicar, pela ordem, os SQL necessários ao fluxo ativo,
   num projeto novo e vazio:
   - `supabase/migrations/20261025_schedule_engine_state_v0.sql`
     (configuração e histórico);
   - `supabase/migrations/20261102120000_generated_schedule_proposals.sql`
     (arquivo imutável de propostas).
3. **Não aplicar automaticamente** a migração antiga
   `20261026_schedule_engine_approved_ledgers_v0.sql` apenas para
   configurar a aplicação atual: é código legado, separado do arquivo de
   propostas. A pasta de migrações ainda contém material histórico.
4. Em **Authentication → Users**, criar a conta permanente e confirmar
   o email, quando necessário.
5. Obter o URL e a **publishable key** do projeto em Settings. Não
   utilizar secret keys nem `service_role` no navegador.
6. Configurar a raiz do projeto local, num ficheiro ignorado pelo Git:

   ```env
   VITE_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SUA_CHAVE_PUBLICA
   ```

7. Reiniciar o processo Vite existente apenas quando necessário para
   carregar as variáveis e iniciar sessão.

**Importante:** a instalação histórica atualmente usada no desenvolvimento
tem um registo de migrações diferente dos nomes existentes no Git e possui
objetos antigos de aprovação. Não executar `supabase db push` contra esse
projeto até concluir uma reconciliação testada em ambiente isolado. O
Checkpoint D não altera essa base de dados.

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
- Erros de revisão ou de sessão impedem gravações silenciosas e devem ser
  resolvidos antes de retomar a edição.

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
- `save_schedule_engine_state` tem `SECURITY DEFINER` e
  `EXECUTE` autenticado **por desenho**, mantendo verificação explícita
  de identidade e revisão; revogar este privilégio sem um substituto
  funcional deixaria a gravação indisponível.
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
  `supabase/audit/pr47_checkpoint_d_readonly.sql` após alterações
  de DDL, RLS ou funções.
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
