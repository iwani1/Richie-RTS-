-- 006 — a run can exist outside the schedule (DSP-03, D-82)
--
-- 001 made "one trip per route per service date" a database rule, which is right for generation and
-- wrong for an emergency: if the bus breaks down before the first stop, the run is cancelled and the
-- office still has to get those people to work today. Until now there was no legal way to do it — the
-- second run for the same route and date was refused by this index.
--
-- The rule is narrowed, not dropped: a *scheduled* run is still one per route per date, enforced by a
-- partial unique index. An ad hoc run carries its own written reason (in the row's data), may sit
-- beside the day's scheduled run, and is the only way to serve a date the route does not operate.
--
-- Existing rows are all scheduled, which is what the default says.

alter table trip add column if not exists origin text not null default 'schedule';

drop index if exists trip_route_date_uq;

create unique index trip_route_date_uq on trip (route_id, service_date) where origin = 'schedule';

alter table trip drop constraint if exists trip_origin_known;
alter table trip add constraint trip_origin_known check (origin in ('schedule', 'adhoc'));
