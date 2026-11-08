-- PR #46: restore the historically defined immutable proposals schema.
-- Idempotent for installations that already applied the earlier PR #42 migration.
-- This table stores user-generated candidates only. It must NEVER be used
-- as authoritative approved shift context by the scheduling engine.
create table if not exists public.schedule_engine_generated_schedules (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  time_zone text not null check (length(time_zone) between 1 and 100),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint schedule_engine_generated_date_range
    check (end_date >= start_date and end_date < start_date + 14),
  constraint schedule_engine_generated_payload_shape
    check (
      jsonb_typeof(payload) = 'object'
      and payload ->> 'schemaVersion' = '1'
      and payload ->> 'validationScope' = 'user_attested_no_external_shifts'
      and jsonb_typeof(payload -> 'shifts') = 'array'
      and jsonb_typeof(payload -> 'people') = 'array'
      and jsonb_typeof(payload -> 'configuration') = 'object'
      and payload ->> 'startDate' = start_date::text
      and payload ->> 'endDate' = end_date::text
      and payload ->> 'timeZone' = time_zone
    )
);

create index if not exists schedule_engine_generated_by_owner_recent
  on public.schedule_engine_generated_schedules(owner_id, created_at desc, id desc);

alter table public.schedule_engine_generated_schedules enable row level security;
revoke all on table public.schedule_engine_generated_schedules
  from public, anon, authenticated;

-- Grants are intentionally column-scoped for INSERT: the database, never the
-- browser, sets created_at. There are NO UPDATE or DELETE grants or policies.
grant select on table public.schedule_engine_generated_schedules to authenticated;
grant insert (id, owner_id, start_date, end_date, time_zone, payload)
  on public.schedule_engine_generated_schedules to authenticated;

drop policy if exists "generated_schedules_owner_read"
  on public.schedule_engine_generated_schedules;
create policy "generated_schedules_owner_read"
  on public.schedule_engine_generated_schedules
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "generated_schedules_owner_insert"
  on public.schedule_engine_generated_schedules;
create policy "generated_schedules_owner_insert"
  on public.schedule_engine_generated_schedules
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

notify pgrst, 'reload schema';
