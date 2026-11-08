-- PR47-17: trusted atomic official approvals and partial revisions.
-- Client roles NEVER receive EXECUTE on this CAS RPC.
-- A complete ledger must first be established by a separate verified import;
-- unsafe all-years bootstrap was disabled by the prior migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.commit_schedule_engine_approved_ledger(
  p_owner_id uuid,
  p_expected_version bigint,
  p_next_payload jsonb,
  p_operation text,
  p_record_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  old_payload jsonb;
  saved_owner uuid;
  expected_status text;
BEGIN
  IF p_owner_id IS NULL OR p_expected_version IS NULL OR
     p_expected_version < 0 OR p_next_payload IS NULL OR
     pg_catalog.jsonb_typeof(p_next_payload)<>'object' OR
     p_operation NOT IN ('approve','replace','cancel','revise') OR
     nullif(p_record_id,'') IS NULL OR
     p_next_payload->>'version'<>(p_expected_version+1)::text OR
     p_next_payload->>'complete'<>'true' OR
     pg_catalog.jsonb_typeof(p_next_payload->'records')<>'array'
  THEN RAISE EXCEPTION 'Invalid official-ledger mutation'; END IF;

  expected_status:=CASE WHEN p_operation='cancel' THEN 'cancelled' ELSE 'approved' END;
  IF NOT EXISTS(
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_next_payload->'records') AS r
    WHERE r->>'id'=p_record_id AND r->>'status'=expected_status
  ) THEN RAISE EXCEPTION 'Official schedule record is absent from proposed snapshot'; END IF;

  SELECT payload INTO old_payload
    FROM public.schedule_engine_approved_ledgers
    WHERE owner_id=p_owner_id AND ledger_version=p_expected_version
    FOR UPDATE;
  IF old_payload IS NULL THEN RETURN false; END IF;
  IF old_payload->'timeZone' IS DISTINCT FROM p_next_payload->'timeZone' OR
     old_payload->'coverage' IS DISTINCT FROM p_next_payload->'coverage' OR
     old_payload->>'complete'<>'true'
  THEN RAISE EXCEPTION 'Official-ledger coverage and time zone are immutable'; END IF;

  UPDATE public.schedule_engine_approved_ledgers
    SET ledger_version=p_expected_version+1,
        payload=p_next_payload,updated_at=now()
    WHERE owner_id=p_owner_id AND ledger_version=p_expected_version
    RETURNING owner_id INTO saved_owner;
  IF saved_owner IS NULL THEN RETURN false; END IF;

  INSERT INTO public.schedule_engine_approved_ledger_history
    (owner_id,ledger_version,payload,operation,approved_record_id)
  VALUES(p_owner_id,p_expected_version+1,p_next_payload,p_operation,p_record_id);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION
  public.commit_schedule_engine_approved_ledger(uuid,bigint,jsonb,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.commit_schedule_engine_approved_ledger(uuid,bigint,jsonb,text,text)
  TO service_role;
COMMIT;
