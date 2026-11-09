-- PR #47: allow ONE globally certified four-week proposal (up to 28 civil days).
-- Applied to Supabase schedule-engine on 2026-11-08, verified CHECK < 28 and 4 existing proposals retained. Additive CHECK
-- expansion: never alters existing archive rows or their UUIDs.
BEGIN;
ALTER TABLE public.schedule_engine_generated_schedules
  DROP CONSTRAINT schedule_engine_generated_date_range;
ALTER TABLE public.schedule_engine_generated_schedules
  ADD CONSTRAINT schedule_engine_generated_date_range
  CHECK (end_date >= start_date AND end_date < start_date + 28);
COMMIT;
