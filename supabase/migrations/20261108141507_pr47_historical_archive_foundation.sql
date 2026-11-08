-- PR #47 / point 17: additive historical source and per-person/day evidence.
-- Importing 2026 shifts is deliberately deferred. NO old hours or days off
-- are inferred; these tables remain empty until trusted import verification.
BEGIN;

CREATE TABLE IF NOT EXISTS public.schedule_engine_history_sources (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_kind text NOT NULL
    CHECK (source_kind IN ('planned','externally_approved','worked')),
  source_label text NOT NULL CHECK (length(btrim(source_label)) BETWEEN 1 AND 160),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  time_zone text NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 100),
  first_date date NOT NULL,
  last_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_engine_history_source_range
    CHECK (first_date <= last_date),
  PRIMARY KEY (owner_id,source_id)
);
CREATE INDEX IF NOT EXISTS schedule_engine_history_sources_owner_dates
  ON public.schedule_engine_history_sources(owner_id,first_date,last_date);

-- An explicit day record can have zero shifts: only that is evidence of
-- "no work". Lack of a row means UNKNOWN, never off-duty.
CREATE TABLE IF NOT EXISTS public.schedule_engine_history_day_facts (
  owner_id uuid NOT NULL,
  source_id uuid NOT NULL,
  person_id text NOT NULL CHECK (length(btrim(person_id)) BETWEEN 1 AND 200),
  work_date date NOT NULL,
  shifts jsonb NOT NULL CHECK (jsonb_typeof(shifts)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id,source_id,person_id,work_date),
  FOREIGN KEY (owner_id,source_id)
    REFERENCES public.schedule_engine_history_sources(owner_id,source_id)
    ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS schedule_engine_history_facts_owner_person_date
  ON public.schedule_engine_history_day_facts(owner_id,person_id,work_date);

-- Separate verification evidence; a file upload or JSON boolean does not
-- certify the completeness of any period.
CREATE TABLE IF NOT EXISTS public.schedule_engine_history_verifications (
  owner_id uuid NOT NULL,
  source_id uuid NOT NULL,
  person_id text NOT NULL CHECK (length(btrim(person_id)) BETWEEN 1 AND 200),
  first_date date NOT NULL,
  last_date date NOT NULL,
  verifier_version text NOT NULL
    CHECK (length(btrim(verifier_version)) BETWEEN 1 AND 64),
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,source_id,person_id,first_date,last_date),
  FOREIGN KEY (owner_id,source_id)
    REFERENCES public.schedule_engine_history_sources(owner_id,source_id)
    ON DELETE RESTRICT,
  CONSTRAINT schedule_engine_history_verified_range
    CHECK (first_date<=last_date)
);
CREATE INDEX IF NOT EXISTS schedule_engine_history_verifications_owner_person
  ON public.schedule_engine_history_verifications(owner_id,person_id,first_date,last_date);

ALTER TABLE public.schedule_engine_history_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_engine_history_day_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_engine_history_verifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.schedule_engine_history_sources
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.schedule_engine_history_day_facts
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.schedule_engine_history_verifications
  FROM PUBLIC,anon,authenticated;

GRANT SELECT ON public.schedule_engine_history_sources TO authenticated;
GRANT SELECT ON public.schedule_engine_history_day_facts TO authenticated;
GRANT SELECT ON public.schedule_engine_history_verifications TO authenticated;

CREATE POLICY history_source_owner_read
  ON public.schedule_engine_history_sources FOR SELECT TO authenticated
  USING ((SELECT auth.uid())=owner_id);
CREATE POLICY history_facts_owner_read
  ON public.schedule_engine_history_day_facts FOR SELECT TO authenticated
  USING ((SELECT auth.uid())=owner_id);
CREATE POLICY history_verification_owner_read
  ON public.schedule_engine_history_verifications FOR SELECT TO authenticated
  USING ((SELECT auth.uid())=owner_id);

-- Trusted importer only; no public RPC, no authenticated browser writes.
GRANT SELECT,INSERT ON public.schedule_engine_history_sources TO service_role;
GRANT SELECT,INSERT ON public.schedule_engine_history_day_facts TO service_role;
GRANT SELECT,INSERT ON public.schedule_engine_history_verifications TO service_role;

-- Remove an unsafe legacy capability. Its old implementation asserted that
-- the whole 2020–2100 range was completely known, despite missing real 2026
-- schedules. Existing published v6 Edge endpoint is inert (HTTP 410).
-- Future activation MUST use a separately verified historical snapshot.
REVOKE EXECUTE ON FUNCTION
  public.initialize_schedule_engine_approved_ledger(uuid,text)
  FROM service_role;
CREATE OR REPLACE FUNCTION public.initialize_schedule_engine_approved_ledger(
  p_owner_id uuid,p_time_zone text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  RAISE EXCEPTION 'Official ledger bootstrap disabled: verified historical context required'
    USING ERRCODE='P0001';
END;
$$;
REVOKE ALL ON FUNCTION
  public.initialize_schedule_engine_approved_ledger(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
