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


-- PR47: no-cost RLS rehearsal with two synthetic identities in disposable CI.
-- This is a database-role isolation test, NOT a real Supabase Auth/API test.
-- The two UUIDs only exist in scripts/ci/postgres_supabase_stub.sql.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',false);
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.schedule_engine_generated_schedules)
 THEN RAISE EXCEPTION 'Proposal from account A leaked to account B'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_engine_state_history)
 THEN RAISE EXCEPTION 'State history from account A leaked to account B'; END IF;
 BEGIN
   INSERT INTO public.schedule_engine_generated_schedules(
     id,owner_id,start_date,end_date,time_zone,payload
   ) VALUES (
     'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
     '11111111-1111-4111-8111-111111111111',
     '2026-11-02','2026-11-02','Atlantic/Azores',
     '{"schemaVersion":1,"validationScope":"user_attested_no_external_shifts",
       "shifts":[],"people":[],"configuration":{},
       "startDate":"2026-11-02","endDate":"2026-11-02",
       "timeZone":"Atlantic/Azores"}'::jsonb
   );
   RAISE EXCEPTION 'Cross-account proposal INSERT was allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
INSERT INTO public.schedule_engine_generated_schedules(
 id,owner_id,start_date,end_date,time_zone,payload
) VALUES(
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 '22222222-2222-4222-8222-222222222222',
 '2026-11-02','2026-11-02','Atlantic/Azores',
 '{"schemaVersion":1,"validationScope":"user_attested_no_external_shifts",
   "shifts":[],"people":[],"configuration":{},
   "startDate":"2026-11-02","endDate":"2026-11-02",
   "timeZone":"Atlantic/Azores"}'::jsonb
);
SELECT public.save_schedule_engine_state(0,
 '{"version":4,"people":[],"availabilities":[],"weeklyOperatingHours":{},
   "exceptions":[],"workRules":{},"weeklyPresenceRequirements":{},
   "presenceExceptions":[]}'::jsonb);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.schedule_engine_states) <> 1
 OR (SELECT count(*) FROM public.schedule_engine_state_history) <> 1
 OR (SELECT count(*) FROM public.schedule_engine_generated_schedules) <> 1
 THEN RAISE EXCEPTION 'Account B sees an unexpected state/archive row count'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.schedule_engine_states) <> 1
 OR (SELECT count(*) FROM public.schedule_engine_state_history) <> 1
 OR (SELECT count(*) FROM public.schedule_engine_generated_schedules) <> 1
 THEN RAISE EXCEPTION 'Account A sees an unexpected state/archive row count'; END IF;
END $$;
RESET ROLE;

-- Seed hypothetical official snapshots as the database owner, then verify
-- both ledger and history SELECT RLS without exposing client-side writes.
INSERT INTO public.schedule_engine_approved_ledgers(owner_id,ledger_version,payload)
VALUES
 ('11111111-1111-4111-8111-111111111111',0,
  '{"version":0,"records":[],"coverage":{},"complete":true}'::jsonb),
 ('22222222-2222-4222-8222-222222222222',0,
  '{"version":0,"records":[],"coverage":{},"complete":true}'::jsonb);
INSERT INTO public.schedule_engine_approved_ledger_history(
  owner_id,ledger_version,payload,approved_record_id,operation
) VALUES
 ('11111111-1111-4111-8111-111111111111',1,
  '{"version":1,"records":[],"coverage":{},"complete":true}'::jsonb,
  'test-a','approve'),
 ('22222222-2222-4222-8222-222222222222',1,
  '{"version":1,"records":[],"coverage":{},"complete":true}'::jsonb,
  'test-b','approve');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.schedule_engine_approved_ledgers)<>1
 OR (SELECT count(*) FROM public.schedule_engine_approved_ledger_history)<>1
 THEN RAISE EXCEPTION 'Account A official ledger RLS isolation failed'; END IF;
 BEGIN
   UPDATE public.schedule_engine_approved_ledgers
   SET updated_at=now()
   WHERE owner_id='11111111-1111-4111-8111-111111111111';
   RAISE EXCEPTION 'Authenticated browser can modify official ledger';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
SELECT set_config('request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.schedule_engine_approved_ledgers)<>1
 OR (SELECT count(*) FROM public.schedule_engine_approved_ledger_history)<>1
 THEN RAISE EXCEPTION 'Account B official ledger RLS isolation failed'; END IF;
END $$;
RESET ROLE;
