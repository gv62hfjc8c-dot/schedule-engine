-- PR47-17: service-only revised official ledger writes, tested in CI.
DO $$
BEGIN
 IF has_function_privilege('authenticated',
  'public.commit_schedule_engine_approved_ledger(uuid,bigint,jsonb,text,text)','EXECUTE')
 OR has_function_privilege('anon',
  'public.commit_schedule_engine_approved_ledger(uuid,bigint,jsonb,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Official mutation RPC exposed to browsers'; END IF;
 IF NOT has_function_privilege('service_role',
  'public.commit_schedule_engine_approved_ledger(uuid,bigint,jsonb,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Trusted service has no CAS commit capability'; END IF;
END $$;
INSERT INTO auth.users(id)VALUES('33333333-3333-4333-8333-333333333333');
INSERT INTO public.schedule_engine_approved_ledgers(
  owner_id,ledger_version,payload
)VALUES('33333333-3333-4333-8333-333333333333',0,
'{"version":0,"timeZone":"Atlantic/Azores",
  "coverage":{"startDate":"2026-01-01","endDate":"2026-12-31"},
  "complete":true,"records":[]}'::jsonb);
DO $$
DECLARE ok boolean;
  next jsonb:='{"version":1,"timeZone":"Atlantic/Azores",
    "coverage":{"startDate":"2026-01-01","endDate":"2026-12-31"},
    "complete":true,"records":[{"id":"revision-1","status":"approved"}]}'::jsonb;
BEGIN
 ok:=public.commit_schedule_engine_approved_ledger(
   '33333333-3333-4333-8333-333333333333',0,next,'revise','revision-1');
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'Trusted partial revision was not committed'; END IF;
 IF (SELECT ledger_version FROM public.schedule_engine_approved_ledgers
     WHERE owner_id='33333333-3333-4333-8333-333333333333')<>1
 OR (SELECT count(*) FROM public.schedule_engine_approved_ledger_history
     WHERE owner_id='33333333-3333-4333-8333-333333333333'
       AND operation='revise')<>1
 THEN RAISE EXCEPTION 'Atomic revision history is missing'; END IF;
 ok:=public.commit_schedule_engine_approved_ledger(
   '33333333-3333-4333-8333-333333333333',0,next,'revise','revision-1');
 IF ok IS NOT FALSE THEN RAISE EXCEPTION 'Stale official revision CAS succeeded'; END IF;
 BEGIN
  PERFORM public.commit_schedule_engine_approved_ledger(
    '33333333-3333-4333-8333-333333333333',1,
    '{"version":2,"timeZone":"Europe/Lisbon",
      "coverage":{"startDate":"2026-01-01","endDate":"2026-12-31"},
      "complete":true,"records":[{"id":"revision-2","status":"approved"}]}'::jsonb,
    'revise','revision-2');
  RAISE EXCEPTION 'Official ledger switched its timezone';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM = 'Official ledger switched its timezone' THEN RAISE; END IF;
 END;
END $$;
