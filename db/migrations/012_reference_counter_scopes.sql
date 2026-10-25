-- 012 — every numbering series the application can allocate (D-92, D-93)
--
-- `reference_counter` holds one row per series, and a check constraint lists which names it may hold.
-- That list was last written in `008_credit_notes.sql`, before refunds and expenses existed. Both new
-- features allocate their number from the counter, so both were refused by the database — a 400 on the
-- screen reading "A value was rejected by the database", with nothing wrong in the service.
--
-- It went unnoticed because the counter is only consulted where there is a database: every unit test
-- runs against the JSON snapshot, where numbering is a pure function. The refund flow had no
-- PostgreSQL test at all, and the expense flow's first one found it. `references.integration.test.ts`
-- now walks `REFERENCE_SERIES` and inserts a counter for every series, so adding a series without
-- widening this constraint fails in CI rather than in front of a finance officer.
--
-- A migration of its own, rather than an edit to `010` or `011`: migrations are applied once and
-- recorded, so a database that already ran them would never see a change made inside them.

alter table reference_counter drop constraint if exists reference_counter_scope_check;
alter table reference_counter
  add constraint reference_counter_scope_check
  check (scope in (
    'rental',
    'route',
    'trip',
    'incident',
    'workOrder',
    'booking',
    'invoice',
    'creditNote',
    'payment',
    'refund',
    'expense'
  ));
