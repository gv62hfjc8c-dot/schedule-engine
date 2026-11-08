-- Validates schema AFTER the 4 historic migrations and the PR47 28-day
-- additive upgrade. Fail hard if any invariant regresses.
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n
 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
 WHERE ns.nspname='public' AND c.relkind='r' AND
   c.relname=ANY(ARRAY[
     'schedule_engine_states','schedule_engine_state_history',
     'schedule_engine_generated_schedules',
     'schedule_engine_approved_ledgers','schedule_engine_approved_ledger_history'])
   AND c.relrowsecurity;
 IF n<>5 THEN RAISE EXCEPTION 'RLS tables expected 5, found %',n; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint WHERE conname='schedule_engine_generated_date_range'
     AND pg_get_constraintdef(oid) LIKE '%(start_date + 28)%'
 ) THEN RAISE EXCEPTION '28-day archive CHECK not installed'; END IF;
 IF has_function_privilege('anon','public.save_schedule_engine_state(bigint,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'anonymous RPC execution exposed'; END IF;
 IF NOT has_function_privilege('authenticated','public.save_schedule_engine_state(bigint,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'authenticated RPC unavailable'; END IF;
 IF has_function_privilege('authenticated',
       'public.commit_schedule_engine_approved_ledger(uuid,bigint,jsonb,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'direct approval function exposed to browser'; END IF;
 IF has_column_privilege('authenticated','public.schedule_engine_generated_schedules','created_at','INSERT')
 THEN RAISE EXCEPTION 'client can forge archive timestamps'; END IF;
END $$;

-- A signed-in user can create and query only their own configuration, and
-- stale CAS revisions cannot silently overwrite.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',false);
SELECT public.save_schedule_engine_state(0,
  '{"version":4,"people":[],"availabilities":[],"weeklyOperatingHours":{},
    "exceptions":[],"workRules":{},"weeklyPresenceRequirements":{},
    "presenceExceptions":[]}'::jsonb);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.schedule_engine_states)<>1
 THEN RAISE EXCEPTION 'Owner cannot read own state'; END IF;
 BEGIN
 PERFORM public.save_schedule_engine_state(0,
   '{"version":4,"people":[],"availabilities":[],"weeklyOperatingHours":{},
     "exceptions":[],"workRules":{},"weeklyPresenceRequirements":{},
     "presenceExceptions":[]}'::jsonb);
 RAISE EXCEPTION 'Stale CAS was accepted';
 EXCEPTION WHEN serialization_failure THEN NULL;
 END;
END $$;
SELECT set_config('request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',false);
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.schedule_engine_states)
 THEN RAISE EXCEPTION 'Cross-account state read detected'; END IF;
END $$;
RESET ROLE;

-- The proposed 28-day archive range is valid; 29 is not.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',false);
INSERT INTO public.schedule_engine_generated_schedules(
  id,owner_id,start_date,end_date,time_zone,payload
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  '2026-11-02','2026-11-29','Atlantic/Azores',
  '{"schemaVersion":1,"validationScope":"user_attested_no_external_shifts",
    "shifts":[],"people":[],"configuration":{},
    "startDate":"2026-11-02","endDate":"2026-11-29",
    "timeZone":"Atlantic/Azores"}'::jsonb
);
DO $$
BEGIN
 BEGIN
   INSERT INTO public.schedule_engine_generated_schedules(
     id,owner_id,start_date,end_date,time_zone,payload
   ) VALUES (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '11111111-1111-4111-8111-111111111111',
    '2026-11-02','2026-11-30','Atlantic/Azores',
    '{"schemaVersion":1,"validationScope":"user_attested_no_external_shifts",
      "shifts":[],"people":[],"configuration":{},
      "startDate":"2026-11-02","endDate":"2026-11-30",
      "timeZone":"Atlantic/Azores"}'::jsonb
   );
   RAISE EXCEPTION '29-day range was accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
RESET ROLE;
