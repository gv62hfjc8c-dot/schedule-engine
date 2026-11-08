-- PR47-16/17: block an official approval if operational configuration
-- changed between trusted validation and the final ledger write.
-- A row-level FOR SHARE lock holds the state revision stable for the
-- remainder of the same PostgreSQL transaction as the ledger CAS/history.
BEGIN;
CREATE OR REPLACE FUNCTION public.commit_schedule_engine_approved_ledger_v2(
  p_owner_id uuid,
  p_expected_version bigint,
  p_next_payload jsonb,
  p_operation text,
  p_record_id text,
  p_expected_state_revision bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_current_revision bigint;
BEGIN
  IF p_owner_id IS NULL OR p_operation IS NULL OR
     (p_operation <> 'cancel' AND
       (p_expected_state_revision IS NULL OR p_expected_state_revision < 1))
  THEN RAISE EXCEPTION 'Invalid operation or configuration revision';
  END IF;

  IF p_operation <> 'cancel' THEN
    SELECT revision INTO v_current_revision
    FROM public.schedule_engine_states
    WHERE owner_id=p_owner_id
    FOR SHARE;

    IF NOT FOUND OR v_current_revision <> p_expected_state_revision
      THEN RETURN false;
    END IF;
  END IF;

  RETURN public.commit_schedule_engine_approved_ledger(
    p_owner_id,p_expected_version,p_next_payload,p_operation,p_record_id
  );
END;
$$;
REVOKE ALL ON FUNCTION
  public.commit_schedule_engine_approved_ledger_v2(uuid,bigint,jsonb,text,text,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.commit_schedule_engine_approved_ledger_v2(uuid,bigint,jsonb,text,text,bigint)
  TO service_role;
-- Retire the older service-only RPC. The new SECURITY DEFINER wrapper owns
-- its internal invocation, but no external service may skip state revision CAS.
REVOKE ALL ON FUNCTION
  public.commit_schedule_engine_approved_ledger(uuid,bigint,jsonb,text,text)
  FROM service_role;
COMMIT;
