-- V1: one certified calendar-month proposal, up to 31 inclusive civil days.
-- Additive CHECK expansion only: existing immutable proposals and RLS retained.
BEGIN;
ALTER TABLE public.schedule_engine_generated_schedules
  DROP CONSTRAINT schedule_engine_generated_date_range;
ALTER TABLE public.schedule_engine_generated_schedules
  ADD CONSTRAINT schedule_engine_generated_date_range
  CHECK (end_date >= start_date AND end_date < start_date + 31);
COMMIT;
