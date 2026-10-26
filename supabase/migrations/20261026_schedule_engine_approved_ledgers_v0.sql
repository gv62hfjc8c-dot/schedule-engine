-- P6.4: approved schedule ledger, separate from the existing v4 app state.
-- REVIEW this migration before applying it to a dedicated Supabase project.
-- It creates new objects only; no existing state/people/availability is changed.
--
-- Trust boundary: the domain constraints are revalidated by the TS core
-- before persistence. SQL below enforces owner scope, CAS/version/history,
-- immutable scope and explicit context attestation, NOT the full work rules.
-- Production server-authoritative domain validation is a separate step.

create table if not exists public.schedule_engine_approved_ledgers (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  ledger_version bigint not null check (ledger_version >= 0),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.schedule_engine_approved_ledger_history (
  owner_id uuid not null references auth.users (id) on delete cascade,
  ledger_version bigint not null check (ledger_version >= 0),
  payload jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (owner_id, ledger_version)
);

alter table public.schedule_engine_approved_ledgers enable row level security;
alter table public.schedule_engine_approved_ledger_history enable row level security;

-- Clients can SELECT only their own snapshots, never write either table.
revoke all on public.schedule_engine_approved_ledgers from public, anon, authenticated;
revoke all on public.schedule_engine_approved_ledger_history from public, anon, authenticated;
grant select on public.schedule_engine_approved_ledgers to authenticated;
grant select on public.schedule_engine_approved_ledger_history to authenticated;

drop policy if exists "Select own approved Schedule Engine ledger"
  on public.schedule_engine_approved_ledgers;
create policy "Select own approved Schedule Engine ledger"
  on public.schedule_engine_approved_ledgers
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Select own approved Schedule Engine ledger history"
  on public.schedule_engine_approved_ledger_history;
create policy "Select own approved Schedule Engine ledger history"
  on public.schedule_engine_approved_ledger_history
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create or replace function public.save_schedule_engine_approved_ledger(
  p_expected_version bigint,
  p_payload jsonb,
  p_attest_complete boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_current_version bigint;
  v_current_payload jsonb;
  v_new_version bigint;
  v_bootstrap boolean;
begin
  if v_owner is null or
     coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'É necessário iniciar sessão com uma conta permanente.'
      using errcode = '28000';
  end if;

  -- -1 is an explicit first-insert sentinel. 0 and higher are CAS versions.
  if p_expected_version is null or p_expected_version < -1 then
    raise exception 'Versão esperada inválida.' using errcode = '22023';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or
     jsonb_typeof(p_payload -> 'version') <> 'number' or
     jsonb_typeof(p_payload -> 'complete') <> 'boolean' or
     jsonb_typeof(p_payload -> 'records') <> 'array' or
     jsonb_typeof(p_payload -> 'coverage') <> 'object' or
     jsonb_typeof(p_payload -> 'timeZone') <> 'string' or
     coalesce(p_payload ->> 'version', '') !~ '^(0|[1-9][0-9]*)$' then
    raise exception 'Formato de ledger aprovado inválido.'
      using errcode = '22023';
  end if;
  if octet_length(p_payload::text) > 4000000 then
    raise exception 'Ledger excede 4 MB.' using errcode = '22023';
  end if;

  -- Catch overflow, invalid dates and malformed timezones before writes.
  v_new_version := (p_payload ->> 'version')::bigint;
  if nullif(p_payload ->> 'timeZone', '') is null or
     not exists (
       select 1 from pg_catalog.pg_timezone_names
       where name = p_payload ->> 'timeZone'
     ) then
    raise exception 'Fuso horário IANA inválido.'
      using errcode = '22023';
  end if;
  if coalesce((p_payload #>> '{coverage,startDate}') ~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false) = false or
     coalesce((p_payload #>> '{coverage,endDate}') ~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false) = false then
    raise exception 'Intervalo de cobertura inválido.'
      using errcode = '22023';
  end if;

  if (p_payload #>> '{coverage,startDate}')::date >
     (p_payload #>> '{coverage,endDate}')::date then
    raise exception 'Datas de cobertura invertidas.'
      using errcode = '22023';
  end if;

  -- Owner-scoped advisory lock serializes concurrent first inserts too.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner::text || '/approved-ledger', 0)
  );

  select ledger_version, payload
    into v_current_version, v_current_payload
    from public.schedule_engine_approved_ledgers
    where owner_id = v_owner
    for update;

  v_bootstrap := not found;
  if v_bootstrap then
    -- Initialization cannot silently assert that unknown days are free.
    if p_expected_version <> -1 or v_new_version <> 0 or
       p_payload -> 'complete' <> 'false'::jsonb or
       jsonb_array_length(p_payload -> 'records') <> 0 then
      raise exception 'Inicialização exige versão zero, contexto incompleto e zero registos.'
        using errcode = '40001';
    end if;
    insert into public.schedule_engine_approved_ledgers
      (owner_id, ledger_version, payload)
    values (v_owner, 0, p_payload);
  else
    if p_expected_version <> v_current_version or
       v_new_version <> v_current_version + 1 then
      raise exception 'Conflito de versão no ledger de horários aprovados.'
        using errcode = '40001';
    end if;

    -- A timezone/coverage change requires an explicit migration/import
    -- with independent proof that all existing commitments are accounted for.
    if p_payload -> 'timeZone' <> v_current_payload -> 'timeZone' or
       p_payload -> 'coverage' <> v_current_payload -> 'coverage' then
      raise exception 'Fuso e intervalo do ledger são imutáveis nesta versão.'
        using errcode = '22023';
    end if;

    -- Completing a ledger is an EXPLICIT trust operation, not an inferred
    -- consequence of a zero-row query. Future adapters must acquire
    -- operator attestation or a verified import before sending true.
    if v_current_payload -> 'complete' = 'false'::jsonb and
       p_payload -> 'complete' = 'true'::jsonb and
       p_attest_complete is distinct from true then
      raise exception 'É necessária confirmação explícita do contexto completo.'
        using errcode = '22023';
    end if;

    update public.schedule_engine_approved_ledgers
      set ledger_version = v_new_version,
          payload = p_payload,
          updated_at = now()
      where owner_id = v_owner;
  end if;

  insert into public.schedule_engine_approved_ledger_history
    (owner_id, ledger_version, payload)
  values (v_owner, v_new_version, p_payload);

  return v_new_version;
end;
$$;

revoke all on function public.save_schedule_engine_approved_ledger(
  bigint, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.save_schedule_engine_approved_ledger(
  bigint, jsonb, boolean
) to authenticated;

comment on function public.save_schedule_engine_approved_ledger(
  bigint, jsonb, boolean
) is
  'Owner-scoped CAS write and immutable history for approved-ledger snapshots; domain constraints must be validated by a trusted scheduling service before production approvals.';
