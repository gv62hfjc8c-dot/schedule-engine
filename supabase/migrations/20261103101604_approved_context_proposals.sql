-- PR #47: historical validationScope amendment (not activated in UI).
-- PR43: distinguish explicitly empty simulation context from proposals
-- generated against an authoritative approved-ledger revision.
alter table public.schedule_engine_generated_schedules
  drop constraint schedule_engine_generated_payload_shape;

alter table public.schedule_engine_generated_schedules
  add constraint schedule_engine_generated_payload_shape check (
    jsonb_typeof(payload) = 'object'
    and payload ->> 'schemaVersion' = '1'
    and payload ->> 'validationScope' in (
      'user_attested_no_external_shifts',
      'official_approved_context'
    )
    and (
      (payload ->> 'validationScope' = 'user_attested_no_external_shifts'
        and not (payload ? 'approvedContextVersion'))
      or
      (payload ->> 'validationScope' = 'official_approved_context'
        and jsonb_typeof(payload -> 'approvedContextVersion') = 'number'
        and (payload ->> 'approvedContextVersion') ~ '^[0-9]+$'
        and (payload ->> 'approvedContextVersion')::numeric >= 0)
    )
    and jsonb_typeof(payload -> 'shifts') = 'array'
    and jsonb_typeof(payload -> 'people') = 'array'
    and jsonb_typeof(payload -> 'configuration') = 'object'
    and payload ->> 'startDate' = start_date::text
    and payload ->> 'endDate' = end_date::text
    and payload ->> 'timeZone' = time_zone
  );
