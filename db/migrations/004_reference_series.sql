-- 004 — every reference comes from a counter (audit D-03)
--
-- Migration 003 gave invoices and payments a numbered series in reference_counter, keyed per scope
-- and per year. Rentals, routes, trips, incidents and work orders were still numbered from
-- `records.length + 1`, which collides between concurrent commands and reissues a printed number
-- after a restore or a delete.
--
-- Two changes, one table:
--   * the scope check learns the five record types;
--   * the period check accepts `all` for series that do not restart each year.
--
-- Nothing is backfilled here on purpose. The allocator recovers a missing counter from the highest
-- reference already in its table (src/tms/references.ts, `highestIssued`), so a database that
-- predates this migration continues its series correctly the first time it writes — and a migration
-- that guessed the numbers would be a second, wrong source of truth.

alter table reference_counter drop constraint if exists reference_counter_scope_check;
alter table reference_counter
  add constraint reference_counter_scope_check
  check (scope in ('rental', 'route', 'trip', 'incident', 'workOrder', 'invoice', 'payment'));

alter table reference_counter drop constraint if exists reference_counter_period_check;
alter table reference_counter
  add constraint reference_counter_period_check
  check (period ~ '^([0-9]{4}|all)$');

-- The counters of the continuously numbered series. A row per series at zero is not created: an
-- absent counter and a zero counter mean the same thing to the allocator, and an absent one is
-- corrected by `highestIssued` rather than trusted.
comment on column reference_counter.period is
  'YYYY for invoices and payments; all for rentals, routes, trips, incidents and work orders';

-- A series only ever moves forwards.
--
-- The repository comment claimed the check constraint guaranteed this, and it did not: `last >= 0`
-- permits any value that is not negative. An import of an older backup (or a hand-edited row) could
-- set a series back and have the next record reissued a number that was already printed. A printed
-- number that appears twice is worse than a gap, so the database refuses the rewind outright rather
-- than trusting the caller.
--
-- This guards UPDATE, which is what the snapshot writer and the importer do. `npm run db:restore`
-- truncates and reloads instead, on purpose: restoring an older backup is an explicit decision to
-- return the whole installation to an earlier moment, and refusing it would make the documented
-- recovery path unusable.
create or replace function reference_counter_no_rewind() returns trigger as $$
begin
  if new.last < old.last then
    raise exception 'reference series %.% cannot move backwards (% -> %)', old.scope, old.period, old.last, new.last
      using errcode = '23514',
            constraint = 'reference_counter_no_rewind';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger reference_counter_no_rewind_trg
  before update on reference_counter
  for each row execute function reference_counter_no_rewind();
