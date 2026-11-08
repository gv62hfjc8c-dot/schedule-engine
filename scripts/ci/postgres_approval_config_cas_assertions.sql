-- PR47-16/17: deterministic transactional rehearsal of the privileged
-- state-revision lock, official ledger version CAS and historical audit.
DO $$
BEGIN
 IF has_function_privilege('authenticated',
  'public.commit_schedule_engine_approved_ledger_v2(uuid,bigint,jsonb,text,text,bigint)',
  'EXECUTE') OR
    has_function_privilege('anon',
  'public.commit_schedule_engine_approved_ledger_v2(uuid,bigint,jsonb,text,text,bigint)',
  'EXECUTE')
 THEN RAISE EXCEPTION 'Browser can invoke privileged official mutation'; END IF;
 IF NOT has_function_privilege('service_role',
  'public.commit_schedule_engine_approved_ledger_v2(uuid,bigint,jsonb,text,text,bigint)',
  'EXECUTE')
 THEN RAISE EXCEPTION 'Trusted API cannot atomically certify configuration'; END IF;
END $$;

INSERT INTO public.schedule_engine_states(owner_id,revision,payload)
VALUES('33333333-3333-4333-8333-333333333333',1,
  '{"version":4,"people":[{"id":"a","name":"Synthetic A","active":true}],
    "availabilities":[],"weeklyOperatingHours":{},"exceptions":[],
    "workRules":{},"weeklyPresenceRequirements":{},
    "presenceExceptions":[]}'::jsonb);

DO $$
DECLARE
  next_ledger jsonb:='{"version":2,"timeZone":"Atlantic/Azores",
    "coverage":{"startDate":"2026-01-01","endDate":"2026-12-31"},
    "complete":true,"records":[{"id":"revision-2","status":"approved"}]}'::jsonb;
  saved boolean;
  first_history bigint;
BEGIN
 SELECT count(*) INTO first_history
 FROM public.schedule_engine_approved_ledger_history
 WHERE owner_id='33333333-3333-4333-8333-333333333333';

 saved:=public.commit_schedule_engine_approved_ledger_v2(
   '33333333-3333-4333-8333-333333333333',
   1,next_ledger,'revise','revision-2',0);
 IF saved THEN RAISE EXCEPTION 'Accepted stale operational revision 0'; END IF;

 UPDATE public.schedule_engine_states SET revision=2
 WHERE owner_id='33333333-3333-4333-8333-333333333333';

 saved:=public.commit_schedule_engine_approved_ledger_v2(
   '33333333-3333-4333-8333-333333333333',
   1,next_ledger,'revise','revision-2',1);
 IF saved THEN RAISE EXCEPTION 'Accepted stale operational revision 1'; END IF;

 IF (SELECT count(*) FROM public.schedule_engine_approved_ledger_history
   WHERE owner_id='33333333-3333-4333-8333-333333333333')<>first_history
 THEN RAISE EXCEPTION 'A failed state CAS wrote official history'; END IF;

 saved:=public.commit_schedule_engine_approved_ledger_v2(
   '33333333-3333-4333-8333-333333333333',
   1,next_ledger,'revise','revision-2',2);
 IF saved IS NOT TRUE THEN RAISE EXCEPTION 'Correct state revision failed'; END IF;

 IF (SELECT ledger_version FROM public.schedule_engine_approved_ledgers
   WHERE owner_id='33333333-3333-4333-8333-333333333333')<>2 OR
    (SELECT count(*) FROM public.schedule_engine_approved_ledger_history
     WHERE owner_id='33333333-3333-4333-8333-333333333333')<>first_history+1
 THEN RAISE EXCEPTION 'Approved state revision CAS did not commit atomically'; END IF;

 saved:=public.commit_schedule_engine_approved_ledger_v2(
   '33333333-3333-4333-8333-333333333333',
   1,next_ledger,'revise','revision-2',2);
 IF saved THEN RAISE EXCEPTION 'Ledger CAS allowed a duplicate revision'; END IF;
END $$;
