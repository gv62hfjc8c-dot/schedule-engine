-- PR47-17: no-cost history-integrity acceptance in disposable PostgreSQL.
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
 WHERE ns.nspname='public' AND c.relkind='r'
 AND c.relname=ANY(ARRAY[
  'schedule_engine_history_sources','schedule_engine_history_day_facts',
  'schedule_engine_history_verifications'])
 AND c.relrowsecurity;
 IF n<>3 THEN RAISE EXCEPTION 'Historical RLS expected 3 tables; got %',n; END IF;
 IF has_function_privilege('service_role',
   'public.initialize_schedule_engine_approved_ledger(uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Legacy all-years empty official ledger bootstrap is still callable'; END IF;
 IF has_table_privilege('authenticated','public.schedule_engine_history_sources','INSERT') OR
    has_table_privilege('authenticated','public.schedule_engine_history_day_facts','INSERT') OR
    has_table_privilege('authenticated','public.schedule_engine_history_verifications','INSERT') OR
    has_table_privilege('authenticated','public.schedule_engine_history_sources','UPDATE') OR
    has_table_privilege('authenticated','public.schedule_engine_history_day_facts','UPDATE') OR
    has_table_privilege('authenticated','public.schedule_engine_history_verifications','DELETE')
 THEN RAISE EXCEPTION 'Client can forge or modify historical records'; END IF;
 IF NOT has_table_privilege('authenticated','public.schedule_engine_history_sources','SELECT')
 THEN RAISE EXCEPTION 'Authenticated owner cannot read historic sources'; END IF;
END $$;
-- Server-owned synthetic import: a source covering the year does not
-- magically make each civil day a verified fact.
INSERT INTO public.schedule_engine_history_sources
(owner_id,source_id,source_kind,source_label,source_sha256,time_zone,first_date,last_date)
VALUES
('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'externally_approved','Synthetic 2026 roster',repeat('a',64),'Atlantic/Azores',
 '2026-01-01','2026-11-30'),
('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'worked','Independent synthetic source',repeat('b',64),'Atlantic/Azores',
 '2026-01-01','2026-11-30');
INSERT INTO public.schedule_engine_history_day_facts
(owner_id,source_id,person_id,work_date,shifts,occurrence_type)
VALUES
('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'a','2026-11-02','[]'::jsonb,'day_off'),
('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'b','2026-11-02','[]'::jsonb,'holiday');
DO $$
BEGIN
 IF (SELECT count(*) FROM public.schedule_engine_history_day_facts)<>2
 THEN RAISE EXCEPTION 'Unexpected historical day fact count'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_engine_history_verifications)
 THEN RAISE EXCEPTION 'Importing a file must never auto-attest its completeness'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.schedule_engine_history_sources)<>1
 OR (SELECT count(*) FROM public.schedule_engine_history_day_facts)<>1
 THEN RAISE EXCEPTION 'Account A history RLS leaking or missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_engine_history_sources
   WHERE owner_id='22222222-2222-4222-8222-222222222222')
 THEN RAISE EXCEPTION 'Account A can inspect account B history'; END IF;
 BEGIN
   INSERT INTO public.schedule_engine_history_verifications
     (owner_id,source_id,person_id,first_date,last_date,verifier_version)
   VALUES(
     '11111111-1111-4111-8111-111111111111',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a',
     '2026-01-01','2026-11-30','browser-forgery');
   RAISE EXCEPTION 'Browser forged historical verification';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.schedule_engine_history_sources)<>1
 OR (SELECT count(*) FROM public.schedule_engine_history_day_facts)<>1
 THEN RAISE EXCEPTION 'Account B history RLS leaking or missing'; END IF;
END $$;
RESET ROLE;

-- The classification is enforceable in PostgreSQL, not only in the UI.
DO $$
DECLARE
  classification_count integer;
BEGIN
  SELECT count(*) INTO classification_count
    FROM public.schedule_engine_history_day_facts
   WHERE occurrence_type IN ('day_off','holiday');
  IF classification_count <> 2 THEN
    RAISE EXCEPTION 'Historical day classifications not persisted';
  END IF;

  BEGIN
    INSERT INTO public.schedule_engine_history_day_facts
      (owner_id,source_id,person_id,work_date,shifts,occurrence_type)
    VALUES
      ('11111111-1111-4111-8111-111111111111',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'a','2026-11-03','[]'::jsonb,'worked');
    RAISE EXCEPTION 'Accepted worked with zero shifts';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.schedule_engine_history_day_facts
      (owner_id,source_id,person_id,work_date,shifts,occurrence_type)
    VALUES
      ('11111111-1111-4111-8111-111111111111',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'a','2026-11-03','[{"start":"08:00","end":"12:00"}]'::jsonb,
       'vacation');
    RAISE EXCEPTION 'Accepted vacation with work shifts';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.schedule_engine_history_day_facts
      (owner_id,source_id,person_id,work_date,shifts,occurrence_type)
    VALUES
      ('11111111-1111-4111-8111-111111111111',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'a','2026-11-03','[]'::jsonb,'not_employed');
    RAISE EXCEPTION 'Accepted absence-before-employment as a fact';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.schedule_engine_history_day_facts
      (owner_id,source_id,person_id,work_date,shifts)
    VALUES
      ('11111111-1111-4111-8111-111111111111',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'a','2026-11-03','[]'::jsonb);
    RAISE EXCEPTION 'Accepted an unclassified historical fact';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
END $$;
