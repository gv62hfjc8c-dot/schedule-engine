-- PR #47: allow ONE globally certified four-week proposal (up to 28 civil days).
-- Requires a verified migration rehearsal before release. Additive CHECK
-- expansion: never alters existing archive rows or their UUIDs.
BEGIN;
ALTER TABLE public.schedule_engine_generated_schedules
  DROP CONSTRAINT schedule_engine_generated_date_range;
ALTER TABLE public.schedule_engine_generated_schedules
  ADD CONSTRAINT schedule_engine_generated_date_range
  CHECK (end_date >= start_date AND end_date < start_date + 28);
COMMIT;
