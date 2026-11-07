-- PR #43 partial absence revisions are additional immutable ledger events.
-- The event contains a complete revalidated replacement snapshot, including
-- incident reason, affected dates and the unchanged original shift history.
alter table public.schedule_engine_approved_ledger_history
  drop constraint if exists schedule_engine_approved_ledger_history_operation_check;
alter table public.schedule_engine_approved_ledger_history
  add constraint schedule_engine_approved_ledger_history_operation_check
  check (operation in ('approve','replace','cancel','revise'));
