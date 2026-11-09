-- After applying the staged migration on a disposable DB, public is
-- INVOKER, internal owner-scoped implementation is DEFINER.
DO $$
BEGIN
 IF (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n
   ON n.oid=p.pronamespace WHERE n.nspname='public'
   AND p.proname='save_schedule_engine_state')
 THEN RAISE EXCEPTION 'Public API RPC still SECURITY DEFINER'; END IF;
 IF NOT (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n
   ON n.oid=p.pronamespace WHERE n.nspname='schedule_engine_private'
   AND p.proname='save_state_impl')
 THEN RAISE EXCEPTION 'Private writer is not protected'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',false);
SELECT public.save_schedule_engine_state(1,
  '{"version":4,"people":[],"availabilities":[],"weeklyOperatingHours":{},
    "exceptions":[],"workRules":{"standardShiftDurationMinutes":240},
    "weeklyPresenceRequirements":{},"presenceExceptions":[]}'::jsonb);
DO $$
BEGIN
 IF (SELECT revision FROM public.schedule_engine_states)<>2
 THEN RAISE EXCEPTION 'Public invoker wrapper failed CAS'; END IF;
 IF (SELECT count(*) FROM public.schedule_engine_state_history)<>2
 THEN RAISE EXCEPTION 'Private RPC failed history'; END IF;
END $$;
RESET ROLE;
-- Restore the PRE-PR47 public RPC as a rehearsal.
-- Script runner applies rollback SQL next and checks it is DEFINER again.
