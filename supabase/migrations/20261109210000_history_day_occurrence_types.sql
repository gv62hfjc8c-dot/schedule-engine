-- Classify every explicitly recorded historical day without guessing from
-- an absent row or from zero shifts. No data import is performed here.
--
-- Valid kinds:
-- worked   = actual work; one or more shift objects
-- day_off  = explicitly marked rest day (yellow empty Excel cell)
-- vacation = explicitly marked vacation (F in source Excel)
-- holiday  = non-working holiday for an employee on the team
--
-- No row means UNKNOWN, including days before employment starts.
-- Existing unclassified rows cannot be assigned a meaning safely; fail
-- rather than silently converting them to day_off or holiday.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.schedule_engine_history_day_facts LIMIT 1) THEN
    RAISE EXCEPTION 'History occurrence migration requires an explicit classification of existing day facts before proceeding';
  END IF;
END
$$;

ALTER TABLE public.schedule_engine_history_day_facts
  ADD COLUMN occurrence_type text NOT NULL;

ALTER TABLE public.schedule_engine_history_day_facts
  ADD CONSTRAINT schedule_engine_history_occurrence_type
    CHECK (occurrence_type IN ('worked','day_off','vacation','holiday'));

ALTER TABLE public.schedule_engine_history_day_facts
  ADD CONSTRAINT schedule_engine_history_occurrence_shift_consistency
    CHECK (
      (occurrence_type = 'worked' AND jsonb_array_length(shifts) > 0)
      OR
      (occurrence_type IN ('day_off','vacation','holiday')
        AND jsonb_array_length(shifts) = 0)
    );

COMMENT ON COLUMN public.schedule_engine_history_day_facts.occurrence_type IS
  'Actual historical occurrence: worked, day_off, vacation or holiday. An absent fact is unknown; never infer off-duty or employment.';

COMMIT;
