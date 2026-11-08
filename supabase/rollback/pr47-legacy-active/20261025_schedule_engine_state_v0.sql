-- Schedule Engine: persistence V0 on Supabase PostgreSQL.
-- Run in the SQL Editor of a dedicated Supabase project.
-- Run once; subsequent changes should use versioned migrations.
-- IMPORTANT: never expose service_role credentials to the browser.

create table if not exists public.schedule_engine_states (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  revision bigint not null default 1 check (revision >= 1),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.schedule_engine_state_history (
  owner_id uuid not null references auth.users (id) on delete cascade,
  revision bigint not null check (revision >= 1),
  payload jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (owner_id, revision)
);

-- No direct browser writes: all writes pass through an atomic RPC below.
alter table public.schedule_engine_states enable row level security;
alter table public.schedule_engine_state_history enable row level security;

revoke all on public.schedule_engine_states from public, anon, authenticated;
revoke all on public.schedule_engine_state_history from public, anon, authenticated;
grant select on public.schedule_engine_states to authenticated;
grant select on public.schedule_engine_state_history to authenticated;

drop policy if exists "Select own Schedule Engine state"
  on public.schedule_engine_states;
create policy "Select own Schedule Engine state"
  on public.schedule_engine_states
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Select own Schedule Engine history"
  on public.schedule_engine_state_history;
create policy "Select own Schedule Engine history"
  on public.schedule_engine_state_history
  for select to authenticated
  using ((select auth.uid()) = owner_id);

-- Optimistic concurrency is enforced INSIDE the database, not in React.
-- In particular, two tabs may never silently overwrite one another.
create or replace function public.save_schedule_engine_state(
  p_expected_revision bigint,
  p_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_revision bigint;
  v_previous jsonb;
  v_next_revision bigint;
begin
  if v_owner is null or
     coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'É necessário iniciar sessão com uma conta permanente.'
      using errcode = '28000';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Revisão inválida.' using errcode = '22023';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload ->> 'version' <> '4'
     or jsonb_typeof(p_payload -> 'people') <> 'array'
     or jsonb_typeof(p_payload -> 'availabilities') <> 'array'
     or jsonb_typeof(p_payload -> 'weeklyOperatingHours') <> 'object'
     or jsonb_typeof(p_payload -> 'exceptions') <> 'array'
     or jsonb_typeof(p_payload -> 'workRules') <> 'object'
     or jsonb_typeof(p_payload -> 'weeklyPresenceRequirements') <> 'object'
     or jsonb_typeof(p_payload -> 'presenceExceptions') <> 'array' then
    raise exception 'Formato de dados incompatível (é necessário v4).'
      using errcode = '22023';
  end if;

  if octet_length(p_payload::text) > 2000000 then
    raise exception 'Estado excede 2 MB.' using errcode = '22023';
  end if;

  -- Transaction-scoped, user-scoped lock also serializes first insert.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner::text, 0)
  );

  select revision, payload
    into v_revision, v_previous
    from public.schedule_engine_states
    where owner_id = v_owner
    for update;

  if not found then
    if p_expected_revision <> 0 then
      raise exception 'Conflito de revisão: a base foi alterada.'
        using errcode = '40001';
    end if;

    insert into public.schedule_engine_states
      (owner_id, revision, payload)
    values (v_owner, 1, p_payload);
    v_next_revision := 1;
  else
    if v_revision <> p_expected_revision then
      raise exception 'Conflito de revisão: a base foi alterada.'
        using errcode = '40001';
    end if;

    if jsonb_array_length(v_previous -> 'people') > 0
       and jsonb_array_length(p_payload -> 'people') = 0 then
      raise exception 'A gravação iria apagar todos os colaboradores.'
        using errcode = '22023';
    end if;

    if v_previous = p_payload then
      return v_revision;
    end if;

    update public.schedule_engine_states
      set revision = revision + 1,
          payload = p_payload,
          updated_at = now()
      where owner_id = v_owner
      returning revision into v_next_revision;
  end if;

  insert into public.schedule_engine_state_history
    (owner_id, revision, payload)
  values (v_owner, v_next_revision, p_payload);

  return v_next_revision;
end;
$$;

revoke all on function public.save_schedule_engine_state(bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_schedule_engine_state(bigint, jsonb)
  to authenticated;

comment on function public.save_schedule_engine_state(bigint, jsonb) is
  'Atomic, owner-scoped, version-checked Schedule Engine state update.';
