-- PR #43: the official ledger is separate from user-submitted proposals.
-- No browser role can initialize or mutate authoritative approved schedules.
create table if not exists public.schedule_engine_approved_ledgers (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  ledger_version bigint not null check (ledger_version >= 0),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  constraint schedule_engine_official_ledger_shape check (
    jsonb_typeof(payload) = 'object' and
    jsonb_typeof(payload -> 'records') = 'array' and
    payload ->> 'version' = ledger_version::text and
    jsonb_typeof(payload -> 'coverage') = 'object' and
    payload ->> 'complete' = 'true'
  )
);
create table if not exists public.schedule_engine_approved_ledger_history (
  owner_id uuid not null references auth.users(id) on delete cascade,
  ledger_version bigint not null check (ledger_version >= 1),
  payload jsonb not null,
  approved_record_id text not null,
  operation text not null check (operation in ('approve', 'replace', 'cancel')),
  committed_at timestamptz not null default now(),
  primary key (owner_id, ledger_version)
);

alter table public.schedule_engine_approved_ledgers enable row level security;
alter table public.schedule_engine_approved_ledger_history enable row level security;
revoke all on table public.schedule_engine_approved_ledgers
  from public, anon, authenticated;
revoke all on table public.schedule_engine_approved_ledger_history
  from public, anon, authenticated;
grant select on public.schedule_engine_approved_ledgers to authenticated;
grant select on public.schedule_engine_approved_ledger_history to authenticated;

create policy "official_ledger_owner_read" on
  public.schedule_engine_approved_ledgers for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "official_history_owner_read" on
  public.schedule_engine_approved_ledger_history for select to authenticated
  using ((select auth.uid()) = owner_id);

-- The trusted Edge Function alone can call this RPC. The transaction
-- records a verified empty official-app ledger, never declaring that
-- non-application work elsewhere does not exist.
create or replace function public.initialize_schedule_engine_approved_ledger(
  p_owner_id uuid, p_time_zone text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  current_payload jsonb;
begin
  if p_owner_id is null or p_time_zone is null or
    length(p_time_zone) < 1 or length(p_time_zone) > 100 then
    raise exception 'Invalid official-ledger initialization arguments';
  end if;
  insert into public.schedule_engine_approved_ledgers
    (owner_id, ledger_version, payload)
  values
    (p_owner_id, 0,
      pg_catalog.jsonb_build_object(
        'version', 0,
        'timeZone', p_time_zone,
        'coverage', pg_catalog.jsonb_build_object(
          'startDate', '2020-01-01',
          'endDate', '2100-12-31'
        ),
        'complete', true,
        'records', pg_catalog.jsonb_build_array()
      )
    )
  on conflict (owner_id) do nothing;
  select payload into current_payload
  from public.schedule_engine_approved_ledgers where owner_id=p_owner_id;
  return current_payload;
end;
$$;
revoke all on function public.initialize_schedule_engine_approved_ledger(uuid,text)
  from public, anon, authenticated;
grant execute on function public.initialize_schedule_engine_approved_ledger(uuid,text)
  to service_role;

-- Optimistic concurrency control. Only trusted code may persist a domain-
-- validated next snapshot. A stale or raced version returns false.
create or replace function public.commit_schedule_engine_approved_ledger(
  p_owner_id uuid,
  p_expected_version bigint,
  p_next_payload jsonb,
  p_operation text,
  p_record_id text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  saved_owner uuid;
begin
  if p_owner_id is null or p_expected_version is null or
     p_expected_version < 0 or p_next_payload is null or
     pg_catalog.jsonb_typeof(p_next_payload) <> 'object' or
     p_operation not in ('approve','replace','cancel') or
     nullif(p_record_id,'') is null or
     p_next_payload ->> 'version' <> (p_expected_version+1)::text or
     p_next_payload ->> 'complete' <> 'true' or
     pg_catalog.jsonb_typeof(p_next_payload->'records') <> 'array'
  then
    raise exception 'Invalid official-ledger mutation';
  end if;
  update public.schedule_engine_approved_ledgers
    set ledger_version=p_expected_version+1,
        payload=p_next_payload,
        updated_at=now()
  where owner_id=p_owner_id and ledger_version=p_expected_version
  returning owner_id into saved_owner;
  if saved_owner is null then return false; end if;

  insert into public.schedule_engine_approved_ledger_history
    (owner_id,ledger_version,payload,operation,approved_record_id)
  values (p_owner_id,p_expected_version+1,p_next_payload,p_operation,p_record_id);
  return true;
end;
$$;
revoke all on function public.commit_schedule_engine_approved_ledger(uuid,bigint,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.commit_schedule_engine_approved_ledger(uuid,bigint,jsonb,text,text)
  to service_role;
notify pgrst, 'reload schema';
