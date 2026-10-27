-- 021 — a quotation is a document with a number (RNT-04, D-117)
--
-- `reference_counter` holds one row per numbering series, and a check constraint lists which names it
-- may hold. `quotation` is a new series: every issued quotation now carries QUO-0001, a customer can
-- quote it back, and a renewal keeps the number with a higher revision.
--
-- It is a migration of its own rather than an edit to `012`, because migrations are applied once and
-- recorded — a database that already ran `012` would never see a change made inside it. The same
-- mistake this constraint exists to catch was made once already, for refunds and expenses, and
-- `references.integration.test.ts` now walks every series in `REFERENCE_SERIES` and inserts a counter
-- for it, so a series added without widening this list fails in CI.
--
-- Nothing else changes in PostgreSQL. The quotation itself lives inside the rental document, which is
-- stored whole in `rental.data`; its figures, number, revision, terms and validity are read and written
-- with the rental.

alter table reference_counter drop constraint if exists reference_counter_scope_check;
alter table reference_counter
  add constraint reference_counter_scope_check
  check (scope in (
    'rental',
    'quotation',
    'route',
    'trip',
    'incident',
    'workOrder',
    'contract',
    'invoice',
    'creditNote',
    'payment',
    'refund',
    'expense',
    'booking'
  ));

comment on column reference_counter.period is
  'The year for financial documents (invoice, creditNote, payment, refund, expense); "all" for every '
  'other series, including quotations, which run continuously so a renewal keeps its number.';
