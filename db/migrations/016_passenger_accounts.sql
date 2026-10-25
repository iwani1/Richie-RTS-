-- 016 — passenger accounts: a rider who can see its own journeys (PAX-01, D-97)
--
-- Until now the only people outside the company who could sign in were corporate contacts: one
-- client, its roster, its rentals. A rider — the employee who actually stands at the stop — had no
-- account, so "is my seat confirmed?" and "did the bus come?" were answered by ringing the office.
--
-- A passenger account is bound to one row of `passenger`, the same way a driver account is bound to
-- one `driver` and a client contact to one `client`. The binding is a single column, and the service
-- layer refuses an account with no link and refuses two accounts on one rider.
--
-- Two things this migration has to do beyond adding the column:
--
--   1. **widen the role check.** `app_user.role` was created with a CHECK listing the five roles
--      that existed in migration 001. Adding a role to the application without widening the
--      constraint fails at insert time, on the one path (Postgres) the tests actually exercise. The
--      list below is 001's list plus 'passenger', in the same order, so a reader comparing the two
--      files sees exactly one change.
--
--   2. **create the uniqueness index fresh.** The old `app_user_client_uq` was dropped in 005 (a
--      client may have several contacts), so it is not a template for this one: a rider has one
--      account, and that is what the index enforces.
--
-- The column is nullable, because the five original roles have no rider, and a partial index keeps
-- those rows out of the uniqueness rule.

alter table app_user drop constraint if exists app_user_role_check;
alter table app_user add constraint app_user_role_check
  check (role in ('administrator','operations','finance','driver','client_contact','passenger'));

alter table app_user add column if not exists passenger_id text;

create unique index if not exists app_user_passenger_uq
  on app_user (passenger_id) where passenger_id is not null;
