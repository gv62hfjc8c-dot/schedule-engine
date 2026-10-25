# Supabase — Persistência V0 do Schedule Engine

## Objetivo

Manter colaboradores, disponibilidades, calendário, regras e mínimos de
presença **fora do browser e fora do servidor Vite**. O Vite na porta 5173
passa a ser apenas a interface; a base de dados é PostgreSQL no Supabase.

Esta integração é independente do motor. O domínio continua a utilizar
`StateRepository`.

## Configurar o projeto Supabase

1. Abre <https://supabase.com/dashboard> e cria um **projeto novo**
   chamado, por exemplo, `schedule-engine`. Não reutilizes a base de
   outro produto.
2. No SQL Editor, executa o ficheiro
   `supabase/migrations/20261025_schedule_engine_state_v0.sql`.
3. Em **Authentication → Users**, cria a tua conta de acesso com email
   e palavra-passe (conta permanente; confirma o email se pedido).
4. Em **Project Settings → API Keys**, copia **a publishable key**
   (`sb_publishable_...`), **nunca** uma secret key ou service_role key.
5. Em **Project Settings → Data API**, copia o URL do projeto
   (`https://<project-ref>.supabase.co`).
6. Na raiz do checkout local, cria `.env.local`:

   ```env
   VITE_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_SUA_CHAVE_PUBLICA
   ```

   Usa apenas os dois valores públicos. O ficheiro está no `.gitignore`.
7. Na primeira abertura da branch de integração, inicia sessão com a
   conta criada. **Não é necessário iniciar outro servidor.**
   Se o Vite já estiver ativo, a alteração de variáveis de ambiente
   pode exigir o reinício do **mesmo** processo para as carregar.

## Migração dos dados existentes

- A primeira leitura verifica **primeiro** se já existem dados na cloud
  para o utilizador autenticado.
- Se existirem, são carregados sem ler nem importar dados do navegador.
- Se não existirem, importa-se automaticamente o estado local v4 já
  guardado no `localStorage`.
- Se a lista de pessoas estiver vazia nesse estado, o importador tenta
  recuperar pessoas dos backups locais e da chave histórica v1.
- O `localStorage` original permanece inalterado. Não é apagado no
  processo de migração.
- A migração e cada gravação são transações PostgreSQL protegidas por
  revisão, não apenas um `upsert` sem validação.

**Verificação após autenticação:** os 3 colaboradores deverão aparecer.
Muda um campo, espera a indicação de que foi guardado, atualiza a página
e confirma os valores. Depois valida em **Table Editor →
schedule_engine_states**, onde deverá existir uma linha do teu utilizador,
`revision >= 1` e `payload.people` com os 3 colaboradores.

## Segurança e modelo de dados V0

- `schedule_engine_states`: 1 `jsonb` por utilizador com `revision`.
- `schedule_engine_state_history`: histórico de estados completos.
- RLS ativo nas duas tabelas; cada utilizador lê só os seus registos.
- Nenhuma escrita direta é permitida às contas autenticadas. A função
  `save_schedule_engine_state` valida utilizador, formato, revisão e
  protege contra remoção acidental de todos os colaboradores.
- Não existe partilha entre utilizadores neste V0. Uma organização com
  várias pessoas a editar o mesmo conjunto de dados exigirá um modelo
  de organizações/permissões diferente.
- A chave pública pode estar no frontend porque **RLS + Auth** protegem
  os dados. Nunca expor `secret`, `service_role` ou passwords no Git.

## Estado de validação

Os testes automáticos simulam API, revisões, conflitos, sessões e migração.
Sem projeto Supabase real configurado, **não** validam ainda a execução
da migration nem a aplicação das políticas RLS na cloud.

Antes de merge na branch P5 ou `main`:

1. SQL criado com sucesso num Supabase real.
2. Conta autenticada e dados locais migrados exatamente uma vez.
3. Três colaboradores preservados, além de regras/horários.
4. Alterações sobrevivem a refresh, encerramento do Vite e reabertura.
5. Dois separadores não sobrescrevem alterações um do outro.
6. Conta B não consegue consultar ou editar os dados da conta A.
7. Dados do browser continuam presentes e intactos após migração.

Os backups da plataforma e a exportação independente ainda precisam de
ser especificados antes de disponibilizar a aplicação em produção.
