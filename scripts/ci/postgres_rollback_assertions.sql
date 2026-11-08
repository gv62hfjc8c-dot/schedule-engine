DO $$
BEGIN
 IF NOT (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n
   ON n.oid=p.pronamespace WHERE n.nspname='public'
   AND p.proname='save_schedule_engine_state')
 THEN RAISE EXCEPTION 'Rollback did not restore the published DEFINER RPC'; END IF;
 IF NOT has_function_privilege('authenticated',
   'public.save_schedule_engine_state(bigint,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Rollback removed required authenticated execute'; END IF;
 IF has_function_privilege('anon',
   'public.save_schedule_engine_state(bigint,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Rollback granted access to anon'; END IF;
END $$;
-- The exact rollback intentionally does not delete the private implementation:
-- removing it is a separate optional cleanup after clients are verified.
