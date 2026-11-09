-- PR49: date-effective verification. The previous initializer treated every
-- person in the current state as employed on every date of the archive.
-- Replacing the function is safe because no verified ledger is bootstrapped
-- in the live database. Never assume a blank day prior to hiring is a day off.
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
  outside_contract_count bigint;
  candidate jsonb;
BEGIN
  IF p_owner_id IS NULL OR nullif(p_time_zone,'') IS NULL OR
     length(p_time_zone)>100 OR
     p_first_date IS NULL OR p_last_date IS NULL OR
     p_last_date<p_first_date OR p_last_date>p_first_date+3650
  THEN RAISE EXCEPTION 'Invalid historical ledger scope'; END IF;

  SELECT payload->'people' INTO state_people
    FROM public.schedule_engine_states
   WHERE owner_id=p_owner_id;
  IF state_people IS NULL OR pg_catalog.jsonb_typeof(state_people)<>'array' OR
     pg_catalog.jsonb_array_length(state_people)=0
  THEN RAISE EXCEPTION 'Cannot attest historical work without personnel'; END IF;

  -- All people potentially affecting certification need explicit dated
  -- employment relationships. No absent array may mean "always employed".
  IF EXISTS(
    SELECT 1 FROM pg_catalog.jsonb_array_elements(state_people) p
    WHERE nullif(p->>'id','') IS NULL OR
      pg_catalog.jsonb_typeof(p->'employmentPeriods') IS DISTINCT FROM 'array' OR
      pg_catalog.jsonb_array_length(
        CASE WHEN pg_catalog.jsonb_typeof(p->'employmentPeriods')='array'
        THEN p->'employmentPeriods' ELSE '[]'::jsonb END)=0
  ) THEN RAISE EXCEPTION 'Explicit employment periods required for every person'; END IF;

  IF EXISTS(
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(state_people) p
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(p->'employmentPeriods') period
     WHERE pg_catalog.jsonb_typeof(period)<>'object'
        OR period->>'startDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        OR NOT (period ? 'endDate')
        OR (period->'endDate' <> 'null'::jsonb AND
            period->>'endDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  ) THEN RAISE EXCEPTION 'Invalid employment period structure'; END IF;

  -- Invalid civil calendar values are rejected by PostgreSQL date casts.
  IF EXISTS(
    SELECT 1 FROM pg_catalog.jsonb_array_elements(state_people) p
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(p->'employmentPeriods') period
    WHERE (period->>'endDate')::date < (period->>'startDate')::date
  ) THEN RAISE EXCEPTION 'Employment end precedes entry'; END IF;

  IF EXISTS(
    SELECT 1 FROM pg_catalog.jsonb_array_elements(state_people) p
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(p->'employmentPeriods')
      WITH ORDINALITY a(value, ordinal)
    JOIN LATERAL pg_catalog.jsonb_array_elements(p->'employmentPeriods')
      WITH ORDINALITY b(value, ordinal) ON a.ordinal < b.ordinal
    WHERE (a.value->>'startDate')::date <=
          coalesce((b.value->>'endDate')::date,'infinity'::date)
      AND (b.value->>'startDate')::date <=
          coalesce((a.value->>'endDate')::date,'infinity'::date)
  ) THEN RAISE EXCEPTION 'Overlapping employment periods'; END IF;

  -- A recorded historical shift/absence outside an employment interval
  -- is an import conflict and cannot be silently counted as verified.
  WITH people AS (
    SELECT p->>'id' person_id,p->'employmentPeriods' periods
    FROM pg_catalog.jsonb_array_elements(state_people) p
  )
  SELECT count(*) INTO outside_contract_count
  FROM public.schedule_engine_history_day_facts f
  JOIN people p ON p.person_id=f.person_id
  WHERE f.owner_id=p_owner_id AND
    f.work_date BETWEEN p_first_date AND p_last_date AND
    NOT EXISTS(
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p.periods) ep
      WHERE (ep->>'startDate')::date <= f.work_date AND
        ((ep->>'endDate') IS NULL OR (ep->>'endDate')::date >= f.work_date)
    );
  IF outside_contract_count<>0 THEN
    RAISE EXCEPTION 'Historical occurrences outside employment: %',outside_contract_count;
  END IF;

  -- Only employee-days inside a real relationship need historical evidence.
  WITH people AS (
    SELECT p->>'id' person_id,p->'employmentPeriods' periods
    FROM pg_catalog.jsonb_array_elements(state_people) p
  ), days AS (
    SELECT d::date work_date
    FROM pg_catalog.generate_series(p_first_date,p_last_date,'1 day'::interval) d
  ), eligible AS (
    SELECT p.person_id,d.work_date FROM people p CROSS JOIN days d
    WHERE EXISTS(
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p.periods) ep
      WHERE (ep->>'startDate')::date <= d.work_date AND
        ((ep->>'endDate') IS NULL OR (ep->>'endDate')::date >= d.work_date)
    )
  )
  SELECT count(*) INTO missing_count FROM eligible e
  WHERE NOT EXISTS(
    SELECT 1 FROM public.schedule_engine_history_day_facts f
    JOIN public.schedule_engine_history_sources s
      ON s.owner_id=f.owner_id AND s.source_id=f.source_id
    JOIN public.schedule_engine_history_verifications v
      ON v.owner_id=f.owner_id AND v.source_id=f.source_id
     AND v.person_id=f.person_id
     AND f.work_date BETWEEN v.first_date AND v.last_date
    WHERE f.owner_id=p_owner_id AND s.time_zone=p_time_zone
      AND f.person_id=e.person_id AND f.work_date=e.work_date
  );
  IF missing_count<>0 THEN
    RAISE EXCEPTION 'Incomplete verified employment history: % eligible person-days unknown',missing_count;
  END IF;

  WITH people AS (
    SELECT p->>'id' person_id,p->'employmentPeriods' periods
    FROM pg_catalog.jsonb_array_elements(state_people) p
  ), attested AS (
    SELECT f.person_id,f.work_date,count(DISTINCT f.source_id) as sources
    FROM public.schedule_engine_history_day_facts f
    JOIN public.schedule_engine_history_sources s
      ON s.owner_id=f.owner_id AND s.source_id=f.source_id
    JOIN public.schedule_engine_history_verifications v
      ON v.owner_id=f.owner_id AND v.source_id=f.source_id
     AND v.person_id=f.person_id
     AND f.work_date BETWEEN v.first_date AND v.last_date
    JOIN people p ON p.person_id=f.person_id
    WHERE f.owner_id=p_owner_id AND s.time_zone=p_time_zone
      AND f.work_date BETWEEN p_first_date AND p_last_date
      AND EXISTS(
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p.periods) ep
        WHERE (ep->>'startDate')::date <= f.work_date AND
          ((ep->>'endDate') IS NULL OR (ep->>'endDate')::date >= f.work_date)
      )
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
  IF existing_payload IS NULL THEN
    RAISE EXCEPTION 'Official ledger missing after initialization'; END IF;
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
