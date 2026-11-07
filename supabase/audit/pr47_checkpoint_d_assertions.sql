-- Schedule Engine PR #47 / Checkpoint D
-- Read-only PASS/FAIL/WARN verification. No DDL, DML, secret or user payload.
-- Run this after the read-only inventory. A PASS is not a proof of isolation
-- across two real client sessions, nor a substitute for backup validation.
with checks as (
  select '01_five_expected_tables'::text as check_name,
    (select count(*)=5 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r'
       and c.relname in (
         'schedule_engine_states','schedule_engine_state_history',
         'schedule_engine_generated_schedules','schedule_engine_approved_ledgers',
         'schedule_engine_approved_ledger_history')) as pass,
    'Expected five persistent Schedule Engine tables'::text as details
  union all
  select '02_rls_enabled',
    (select count(*)=5 and bool_and(c.relrowsecurity) from pg_class c
     join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r'
       and c.relname in (
         'schedule_engine_states','schedule_engine_state_history',
         'schedule_engine_generated_schedules','schedule_engine_approved_ledgers',
         'schedule_engine_approved_ledger_history')),
    'All five tables require row-level security'
  union all
  select '03_owner_scoped_read_policies',
    (select count(distinct tablename)=5 from pg_policies
     where schemaname='public' and cmd='SELECT'
       and tablename in (
         'schedule_engine_states','schedule_engine_state_history',
         'schedule_engine_generated_schedules','schedule_engine_approved_ledgers',
         'schedule_engine_approved_ledger_history')
       and roles::text like '%authenticated%'
       and qual like '%auth.uid%'
       and qual like '%owner_id%'),
    'Each table has an owner-scoped SELECT policy'
  union all
  select '04_no_direct_state_writes',
    not (
      has_table_privilege('authenticated','public.schedule_engine_states','INSERT') or
      has_table_privilege('authenticated','public.schedule_engine_states','UPDATE') or
      has_table_privilege('authenticated','public.schedule_engine_states','DELETE') or
      has_table_privilege('authenticated','public.schedule_engine_state_history','INSERT') or
      has_table_privilege('authenticated','public.schedule_engine_state_history','UPDATE') or
      has_table_privilege('authenticated','public.schedule_engine_state_history','DELETE')),
    'Browser cannot modify configuration tables except via secured RPC'
  union all
  select '05_generated_proposals_column_insert',
    has_column_privilege('authenticated','public.schedule_engine_generated_schedules','id','INSERT') and
    has_column_privilege('authenticated','public.schedule_engine_generated_schedules','payload','INSERT') and
    not has_column_privilege('authenticated','public.schedule_engine_generated_schedules','created_at','INSERT') and
    not has_table_privilege('authenticated','public.schedule_engine_generated_schedules','UPDATE') and
    not has_table_privilege('authenticated','public.schedule_engine_generated_schedules','DELETE'),
    'Proposals append only and server timestamps cannot be forged by client'
  union all
  select '06_no_direct_approval_writes',
    not (
      has_table_privilege('authenticated','public.schedule_engine_approved_ledgers','INSERT') or
      has_table_privilege('authenticated','public.schedule_engine_approved_ledgers','UPDATE') or
      has_table_privilege('authenticated','public.schedule_engine_approved_ledgers','DELETE') or
      has_table_privilege('authenticated','public.schedule_engine_approved_ledger_history','INSERT') or
      has_table_privilege('authenticated','public.schedule_engine_approved_ledger_history','UPDATE') or
      has_table_privilege('authenticated','public.schedule_engine_approved_ledger_history','DELETE')),
    'Legacy approved ledgers cannot be written directly by browser'
  union all
  select '07_approval_privileged_rpcs_closed',
    not has_function_privilege('anon',
      'public.initialize_schedule_engine_approved_ledger(uuid,text)','EXECUTE') and
    not has_function_privilege('authenticated',
      'public.initialize_schedule_engine_approved_ledger(uuid,text)','EXECUTE') and
    not has_function_privilege('anon',
      'public.commit_schedule_engine_approved_ledger(uuid,bigint,jsonb,text,text)','EXECUTE') and
    not has_function_privilege('authenticated',
      'public.commit_schedule_engine_approved_ledger(uuid,bigint,jsonb,text,text)','EXECUTE'),
    'Old approval RPC functions are not directly accessible to browser roles'
  union all
  select '08_state_rpc_intentional_auth_only',
    not has_function_privilege('anon',
      'public.save_schedule_engine_state(bigint,jsonb)','EXECUTE') and
    has_function_privilege('authenticated',
      'public.save_schedule_engine_state(bigint,jsonb)','EXECUTE'),
    'Active state RPC is authenticated; do not revoke without replacement'
  union all
  select '09_state_rpc_fixed_search_path',
    (select p.prosecdef and exists(
       select 1 from unnest(p.proconfig) as cfg(setting)
       where cfg.setting = 'search_path=""'
     ) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='save_schedule_engine_state'
     and pg_get_function_identity_arguments(p.oid)='p_expected_revision bigint, p_payload jsonb'),
    'SECURITY DEFINER state RPC retains explicit fixed search_path'
  union all
  select '10_generated_owner_insert_policy',
    exists(select 1 from pg_policies
     where schemaname='public' and tablename='schedule_engine_generated_schedules'
       and cmd='INSERT' and roles::text like '%authenticated%'
       and with_check like '%auth.uid%' and with_check like '%owner_id%'),
    'Proposal INSERT must check owner in RLS'
)
select check_name,
  case when pass is true then 'PASS' else 'FAIL' end as result,
  details
from checks
order by check_name;

-- Historical drift is informational, not a silent conversion:
select 'legacy_approval_revision_parity' as check_name,
  case when (select pg_get_functiondef(p.oid) like '%''revise''%'
             from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and
             p.proname='commit_schedule_engine_approved_ledger')
       then 'REVIEW' else 'WARN' end as result,
  'An old Edge Function may request revise while the privileged commit RPC may not permit it' as details;

-- Changes to settings, Edge deployments, and Auth password-protection are
-- NOT included in these SQL checks and still require separate confirmation.
