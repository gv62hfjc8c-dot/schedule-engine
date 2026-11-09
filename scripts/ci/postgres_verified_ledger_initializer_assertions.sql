-- PR47-17: the ONLY allowed official bootstrap requires exact person/day facts
-- and trusted verification; no year-spanning empty default.
DO $$
BEGIN
 IF has_function_privilege('authenticated',
  'public.initialize_schedule_engine_verified_ledger(uuid,text,date,date)','EXECUTE')
 OR has_function_privilege('anon',
  'public.initialize_schedule_engine_verified_ledger(uuid,text,date,date)','EXECUTE')
 THEN RAISE EXCEPTION 'Browser can initialize a forged official ledger'; END IF;
 IF NOT has_function_privilege('service_role',
  'public.initialize_schedule_engine_verified_ledger(uuid,text,date,date)','EXECUTE')
 THEN RAISE EXCEPTION 'Trusted verified bootstrap unavailable'; END IF;
END $$;
INSERT INTO auth.users(id)VALUES('44444444-4444-4444-8444-444444444444');
INSERT INTO public.schedule_engine_states(owner_id,revision,payload)
VALUES('44444444-4444-4444-8444-444444444444',1,
 '{"version":4,"people":[
   {"id":"a","name":"A","active":true},
   {"id":"b","name":"B","active":true}],
   "availabilities":[],"weeklyOperatingHours":{},"exceptions":[],
   "workRules":{},"weeklyPresenceRequirements":{},
   "presenceExceptions":[]}'::jsonb);
INSERT INTO public.schedule_engine_history_sources
(owner_id,source_id,source_kind,source_label,source_sha256,
 time_zone,first_date,last_date)
VALUES('44444444-4444-4444-8444-444444444444',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'externally_approved','Synthetic verified roster',repeat('c',64),
 'Atlantic/Azores','2026-11-02','2026-11-03');
INSERT INTO public.schedule_engine_history_verifications
(owner_id,source_id,person_id,first_date,last_date,verifier_version)
VALUES
('44444444-4444-4444-8444-444444444444',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'a','2026-11-02','2026-11-03','test-v1'),
('44444444-4444-4444-8444-444444444444',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'b','2026-11-02','2026-11-03','test-v1');
INSERT INTO public.schedule_engine_history_day_facts
(owner_id,source_id,person_id,work_date,shifts,occurrence_type)
VALUES
('44444444-4444-4444-8444-444444444444',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','a','2026-11-02','[]','day_off'),
('44444444-4444-4444-8444-444444444444',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','a','2026-11-03','[]','day_off'),
('44444444-4444-4444-8444-444444444444',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','b','2026-11-02','[]','day_off');
DO $$
BEGIN
 BEGIN
  PERFORM public.initialize_schedule_engine_verified_ledger(
    '44444444-4444-4444-8444-444444444444',
    'Atlantic/Azores','2026-11-02','2026-11-03');
  RAISE EXCEPTION 'Bootstrapped with a missing person-day';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM = 'Bootstrapped with a missing person-day' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.schedule_engine_approved_ledgers
    WHERE owner_id='44444444-4444-4444-8444-444444444444')
 THEN RAISE EXCEPTION 'Rejected bootstrap unexpectedly wrote a ledger'; END IF;
END $$;
INSERT INTO public.schedule_engine_history_day_facts
(owner_id,source_id,person_id,work_date,shifts,occurrence_type)
VALUES('44444444-4444-4444-8444-444444444444',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','b','2026-11-03','[]','day_off');
DO $$
DECLARE initialized jsonb;
BEGIN
 initialized:=public.initialize_schedule_engine_verified_ledger(
   '44444444-4444-4444-8444-444444444444',
   'Atlantic/Azores','2026-11-02','2026-11-03');
 IF initialized->>'complete'<>'true' OR initialized->>'version'<>'0'
    OR initialized->'coverage'->>'startDate'<>'2026-11-02'
    OR initialized->'coverage'->>'endDate'<>'2026-11-03'
 THEN RAISE EXCEPTION 'Verified ledger initialization shape wrong'; END IF;
END $$;
