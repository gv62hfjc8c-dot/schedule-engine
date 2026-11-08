-- PR47-17: re-enable official ledger initialization ONLY from verified
-- person/day historical evidence, never by asserting 2020–2100 empty.
-- This service-role-only RPC is not callable from browser client roles.
BEGIN;
CREATE OR REPLACE FUNCTION public.initialize_schedule_engine_verified_ledger(
  p_owner_id uuid,p_time_zone text,p_first_date date,p_last_date date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  state_people jsonb;
  existing_payload jsonb;
  missing_count bigint;
  duplicate_count bigint;
  candidate jsonb;
BEGIN
  IF p_owner_id IS NULL OR nullif(p_time_zone,'') IS NULL OR
     length(p_time_zone)>100 OR
     p_first_date IS NULL OR p_last_date IS NULL OR
     p_last_date<p_first_date OR
     p_last_date>p_first_date+3650
  THEN RAISE EXCEPTION 'Invalid historical ledger scope'; END IF;

  SELECT payload->'people' INTO state_people
    FROM public.schedule_engine_states
    WHERE owner_id=p_owner_id;
  IF state_people IS NULL OR
     pg_catalog.jsonb_typeof(state_people)<>'array' OR
     pg_catalog.jsonb_array_length(state_people)=0
  THEN RAISE EXCEPTION 'Cannot attest historical work without personnel'; END IF;
  IF EXISTS(
    SELECT 1 FROM pg_catalog.jsonb_array_elements(state_people) p
    WHERE nullif(p->>'id','') IS NULL
  ) THEN RAISE EXCEPTION 'Invalid personnel identifiers in trusted config'; END IF;

  -- Every person/date must have exactly one trusted source fact, including
  -- a literal [] when known not to have worked. Verification must match
  -- the SAME source and cover the SAME date.
  WITH people AS (
    SELECT DISTINCT p->>'id' person_id
    FROM pg_catalog.jsonb_array_elements(state_people) p
  ), days AS (
    SELECT d::date work_date
    FROM pg_catalog.generate_series(p_first_date,p_last_date,'1 day'::interval) d
  ), proven AS (
    SELECT f.person_id,f.work_date
    FROM public.schedule_engine_history_day_facts f
    JOIN public.schedule_engine_history_sources s
      ON s.owner_id=f.owner_id AND s.source_id=f.source_id
    JOIN public.schedule_engine_history_verifications v
      ON v.owner_id=f.owner_id AND v.source_id=f.source_id
     AND v.person_id=f.person_id
     AND f.work_date BETWEEN v.first_date AND v.last_date
    WHERE f.owner_id=p_owner_id AND s.time_zone=p_time_zone
      AND f.work_date BETWEEN p_first_date AND p_last_date
    GROUP BY f.person_id,f.work_date
  )
  SELECT count(*) INTO missing_count
  FROM people CROSS JOIN days
  WHERE NOT EXISTS(SELECT 1 FROM proven
    WHERE proven.person_id=people.person_id
      AND proven.work_date=days.work_date);
  IF missing_count<>0 THEN
    RAISE EXCEPTION 'Incomplete verified history: % person-days unknown',missing_count;
  END IF;

  WITH attested AS (
    SELECT f.person_id,f.work_date,count(DISTINCT f.source_id) as sources
    FROM public.schedule_engine_history_day_facts f
    JOIN public.schedule_engine_history_sources s
      ON s.owner_id=f.owner_id AND s.source_id=f.source_id
    JOIN public.schedule_engine_history_verifications v
      ON v.owner_id=f.owner_id AND v.source_id=f.source_id
     AND v.person_id=f.person_id
     AND f.work_date BETWEEN v.first_date AND v.last_date
    WHERE f.owner_id=p_owner_id AND s.time_zone=p_time_zone
      AND f.work_date BETWEEN p_first_date AND p_last_date
    GROUP BY f.person_id,f.work_date
  )
  SELECT count(*) INTO duplicate_count FROM attested WHERE sources<>1;
  IF duplicate_count<>0 THEN
    RAISE EXCEPTION 'Conflicting historical sources need reconciliation';
  END IF;

  candidate:=pg_catalog.jsonb_build_object(
    'version',0,'timeZone',p_time_zone,
    'coverage',pg_catalog.jsonb_build_object(
      'startDate',p_first_date::text,'endDate',p_last_date::text),
    'complete',true,'records',pg_catalog.jsonb_build_array()
  );
  INSERT INTO public.schedule_engine_approved_ledgers
    (owner_id,ledger_version,payload)
  VALUES (p_owner_id,0,candidate)
  ON CONFLICT (owner_id) DO NOTHING;
  SELECT payload INTO existing_payload
  FROM public.schedule_engine_approved_ledgers WHERE owner_id=p_owner_id;
  IF existing_payload IS NULL THEN RAISE EXCEPTION 'Official ledger missing after initialization'; END IF;
  RETURN existing_payload;
END;
$$;
REVOKE ALL ON FUNCTION
  public.initialize_schedule_engine_verified_ledger(uuid,text,date,date)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.initialize_schedule_engine_verified_ledger(uuid,text,date,date)
  TO service_role;
COMMIT;
