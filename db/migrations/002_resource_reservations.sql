-- 002 — resource reservations: the brief's §5.1 invariant, enforced by PostgreSQL
--
-- One row per (resource, period) that a vehicle or driver is committed to. The exclusion
-- constraint is the authority on double-booking: application-level friendly errors are a
-- convenience, the constraint is the correctness guarantee. Two concurrent confirmations cannot
-- both commit, even across processes, because PostgreSQL serialises the index insert.
--
-- Periods are dateranges because the domain model schedules by service date (rentals have a
-- start/end date, trips a service date). Intra-day overlap for two trips on the same vehicle is
-- still checked by the service layer; widening this to tstzrange is tracked in PROGRESS.md.

create table resource_reservation (
  id             text primary key,
  resource_type  text not null check (resource_type in ('vehicle','driver')),
  resource_id    text not null,
  period         daterange not null,
  source_type    text not null check (source_type in ('rental','trip')),
  source_id      text not null,
  source_ref     text not null default '',
  active         boolean not null default true,
  constraint resource_period_valid check (not isempty(period)),
  constraint resource_reservation_uq unique (resource_type, resource_id, source_type, source_id),
  exclude using gist (resource_type with =, resource_id with =, period with &&) where (active)
);

create index resource_reservation_source_idx on resource_reservation (source_type, source_id);
