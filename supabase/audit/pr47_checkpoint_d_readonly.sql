-- PR #47 / Checkpoint D — read-only introspection of the deployed schema.
-- SAFETY: SELECT statements only. Do NOT replace these with DDL or
-- run DROP/TRUNCATE/DELETE/ALTER against the live Schedule Engine.
-- Run with SQL Editor on the intended Supabase project, then compare with
-- docs/supabase-deployment-baseline-pr47.md. No user payloads are returned.

-- 1. Inventory: all Schedule Engine public relations and RLS.
select c.relname as relation_name,
  c.relkind as relation_kind,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  pg_get_userbyid(c.relowner) as table_owner
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname like 'schedule_engine_%'
  and c.relkind in ('r','p','v','m')
order by c.relname;

-- 2. Authorization: policy predicates, commands and role scope.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname='public' and tablename like 'schedule_engine_%'
order by tablename, policyname;

-- 3. Actual effective grants (includes inherited privileges).
select 'states' as object_name,
  has_table_privilege('authenticated','public.schedule_engine_states','SELECT') as can_read,
  has_table_privilege('authenticated','public.schedule_engine_states','INSERT') as can_insert,
  has_table_privilege('authenticated','public.schedule_engine_states','UPDATE') as can_update,
  has_table_privilege('authenticated','public.schedule_engine_states','DELETE') as can_delete
union all
select 'state_history',
  has_table_privilege('authenticated','public.schedule_engine_state_history','SELECT'),
  has_table_privilege('authenticated','public.schedule_engine_state_history','INSERT'),
  has_table_privilege('authenticated','public.schedule_engine_state_history','UPDATE'),
  has_table_privilege('authenticated','public.schedule_engine_state_history','DELETE')
union all
select 'generated',
  has_table_privilege('authenticated','public.schedule_engine_generated_schedules','SELECT'),
  has_table_privilege('authenticated','public.schedule_engine_generated_schedules','INSERT'),
  has_table_privilege('authenticated','public.schedule_engine_generated_schedules','UPDATE'),
  has_table_privilege('authenticated','public.schedule_engine_generated_schedules','DELETE')
union all
select 'approved',
  has_table_privilege('authenticated','public.schedule_engine_approved_ledgers','SELECT'),
  has_table_privilege('authenticated','public.schedule_engine_approved_ledgers','INSERT'),
  has_table_privilege('authenticated','public.schedule_engine_approved_ledgers','UPDATE'),
  has_table_privilege('authenticated','public.schedule_engine_approved_ledgers','DELETE')
union all
select 'approved_history',
  has_table_privilege('authenticated','public.schedule_engine_approved_ledger_history','SELECT'),
  has_table_privilege('authenticated','public.schedule_engine_approved_ledger_history','INSERT'),
  has_table_privilege('authenticated','public.schedule_engine_approved_ledger_history','UPDATE'),
  has_table_privilege('authenticated','public.schedule_engine_approved_ledger_history','DELETE');

-- 4. Immutable proposal insert permissions are column-scoped, not table-wide.
select column_name, privilege_type
from information_schema.column_privileges
where table_schema='public'
  and table_name='schedule_engine_generated_schedules'
  and grantee='authenticated'
  and privilege_type in ('INSERT','UPDATE','DELETE')
order by column_name, privilege_type;

-- 5. Functions and RPC grants: do not revoke the active state RPC blindly.
select p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  p.proconfig::text as security_settings,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as signed_in_can_execute
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'save_schedule_engine_state',
    'initialize_schedule_engine_approved_ledger',
    'commit_schedule_engine_approved_ledger',
    'save_schedule_engine_approved_ledger'
  )
order by p.proname;

-- 6. Schema invariants and supporting indexes, without exposing user rows.
select c.conrelid::regclass::text as relation_name,
  c.conname as constraint_name, c.contype as constraint_type,
  pg_get_constraintdef(c.oid) as constraint_definition
from pg_constraint c
join pg_class t on t.oid=c.conrelid
join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public' and t.relname like 'schedule_engine_%'
order by relation_name, constraint_name;

select tablename, indexname, indexdef
from pg_indexes
where schemaname='public' and tablename like 'schedule_engine_%'
order by tablename,indexname;

-- 7. Migration registry; filenames in Git and deployed IDs may differ.
select version,name
from supabase_migrations.schema_migrations
order by version;

-- 8. Aggregate counts only, never inspect owner IDs or private JSON.
select
  (select count(*) from public.schedule_engine_states) as settings,
  (select count(*) from public.schedule_engine_state_history) as settings_history,
  (select count(*) from public.schedule_engine_generated_schedules) as generated_proposals,
  (select count(*) from public.schedule_engine_approved_ledgers) as official_ledgers,
  (select count(*) from public.schedule_engine_approved_ledger_history) as official_history;

-- 9. Scope-only aggregate. Official-context historical candidates must not
-- silently be misrepresented as empty-context certified proposals.
select payload->>'validationScope' as snapshot_scope, count(*) as proposals
from public.schedule_engine_generated_schedules
group by 1 order by 1;
