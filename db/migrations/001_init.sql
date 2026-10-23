-- 001 — initial schema (Phase 1A foundation)
--
-- Design note (see docs/DECISIONS.md D-50):
--   Each entity is one table. Identity, status, foreign keys, dates and money that the
--   constraints, reports or audit depend on are real typed columns. The full domain object is
--   also kept in `data jsonb` so the pure command layer can round-trip without a 200-field
--   mapper; the typed columns are projections of it and are always written together with it.
--   Splitting the nested value objects (quote lines, trip stops, boardings, response logs) into
--   child tables is tracked in PROGRESS.md as Phase 1A follow-up.
--
-- Conventions: ids are text (the app's own uuid/random ids), timestamps are timestamptz in UTC,
-- money is NUMERIC(14,2) (never floating point, per brief §5.4).

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- schema_migrations is created by scripts/migrate.ts before this file runs.

-- ---------------------------------------------------------------- users
create table app_user (
  id             text primary key,
  full_name      text not null,
  email          text not null unique,
  role           text not null check (role in ('administrator','operations','finance','driver','client_contact')),
  active         boolean not null default true,
  driver_id      text,
  client_id      text,
  password_hash  text not null,
  password_salt  text not null,
  created_at     timestamptz not null,
  updated_at     timestamptz not null,
  data           jsonb not null
);
-- ONE account per record: the service layer asserts this, the database enforces it.
create unique index app_user_driver_uq on app_user (driver_id) where driver_id is not null;
create unique index app_user_client_uq on app_user (client_id) where client_id is not null;

-- ---------------------------------------------------------------- fleet
create table vehicle (
  id            text primary key,
  registration  text not null,
  category_id   text not null,
  make          text not null,
  model         text not null,
  seat_capacity integer not null check (seat_capacity > 0),
  status        text not null check (status in ('available','maintenance','out_of_service','retired','in_service')),
  notes         text not null default '',
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  data          jsonb not null
);
-- Plates are unique regardless of spacing and case: "GT 1234-24" == "gt1234 24".
create unique index vehicle_registration_uq on vehicle (upper(regexp_replace(registration, '[\s-]', '', 'g')));

create table driver (
  id              text primary key,
  full_name       text not null,
  phone           text not null,
  licence_number  text not null,
  licence_expiry  date not null,
  status          text not null,
  created_at      timestamptz not null,
  updated_at      timestamptz not null,
  data            jsonb not null
);
create unique index driver_licence_uq on driver (upper(licence_number));

create table client (
  id            text primary key,
  name          text not null,
  contact_name  text not null default '',
  contact_phone text not null default '',
  contact_email text not null default '',
  status        text not null,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  data          jsonb not null
);
create unique index client_name_uq on client (lower(name));

create table compliance_document (
  id                text primary key,
  owner_type        text not null check (owner_type in ('vehicle','driver')),
  owner_id          text not null,
  document_type_id  text not null,
  document_number   text not null default '',
  issued_date       date,
  expiry_date       date not null,
  notes             text not null default '',
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  data              jsonb not null
);
create index compliance_document_owner_idx on compliance_document (owner_type, owner_id);
create index compliance_document_expiry_idx on compliance_document (expiry_date);

create table odometer_reading (
  id            text primary key,
  vehicle_id    text not null references vehicle (id) on delete restrict,
  reading_km    integer not null check (reading_km >= 0),
  reading_date  date not null,
  status        text not null check (status in ('current','void')),
  note          text not null default '',
  void_reason   text,
  created_at    timestamptz not null,
  created_by    text not null default '',
  data          jsonb not null
);
create index odometer_vehicle_idx on odometer_reading (vehicle_id, reading_date desc);
-- Readings cannot go backwards for a vehicle (D-32): a partial unique index cannot express
-- "greater than every previous", so a trigger enforces monotonicity.
create or replace function odometer_monotonic() returns trigger as $$
declare latest integer;
begin
  if new.status <> 'current' then return new; end if;
  select max(reading_km) into latest
    from odometer_reading
   where vehicle_id = new.vehicle_id and status = 'current' and id <> new.id;
  if latest is not null and new.reading_km < latest then
    raise exception 'odometer reading % is below the latest recorded reading % for vehicle % (code OD-001)',
      new.reading_km, latest, new.vehicle_id;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger odometer_monotonic_trg before insert or update on odometer_reading
  for each row execute function odometer_monotonic();

-- ---------------------------------------------------------------- rentals
create table rental (
  id                   text primary key,
  reference            text not null unique,
  client_id            text references client (id) on delete set null,
  customer_name        text not null,
  customer_phone       text not null default '',
  customer_email       text not null default '',
  purpose              text not null default '',
  pickup_location      text not null default '',
  dropoff_location     text not null default '',
  start_date           date not null,
  end_date             date not null,
  passengers           integer not null check (passengers > 0),
  vehicle_category_id  text not null,
  driver_required      boolean not null default false,
  status               text not null,
  assigned_vehicle_id  text references vehicle (id) on delete set null,
  assigned_driver_id   text references driver (id) on delete set null,
  -- Money that reports and invoices depend on (brief §5.4). The dated quote/invoice detail stays
  -- in data until the line-item tables land.
  quote_subtotal       numeric(14,2),
  deposit_required     numeric(14,2),
  deposit_amount       numeric(14,2),
  invoice_total        numeric(14,2),
  currency_code        text,
  created_at           timestamptz not null,
  updated_at           timestamptz not null,
  data                 jsonb not null,
  constraint rental_dates_ordered check (end_date >= start_date)
);
create index rental_status_idx on rental (status);
create index rental_dates_idx on rental (start_date, end_date);
create index rental_client_idx on rental (client_id);

-- ---------------------------------------------------------------- staff busing
create table bus_route (
  id                   text primary key,
  reference            text not null unique,
  name                 text not null,
  client_id            text not null references client (id) on delete restrict,
  direction            text not null,
  shift_id             text,
  vehicle_category_id  text not null,
  start_date           date not null,
  end_date             date,
  status               text not null,
  created_at           timestamptz not null,
  updated_at           timestamptz not null,
  data                 jsonb not null
);
create index bus_route_client_idx on bus_route (client_id);

create table passenger (
  id            text primary key,
  client_id     text not null references client (id) on delete restrict,
  full_name     text not null,
  employee_ref  text not null default '',
  phone         text not null default '',
  route_id      text references bus_route (id) on delete set null,
  stop_id       text,
  status        text not null,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  data          jsonb not null
);
create unique index passenger_ref_uq on passenger (client_id, upper(employee_ref)) where employee_ref <> '';
create index passenger_client_idx on passenger (client_id);

create table trip (
  id           text primary key,
  reference    text not null unique,
  route_id     text not null references bus_route (id) on delete restrict,
  service_date date not null,
  status       text not null,
  vehicle_id   text references vehicle (id) on delete set null,
  driver_id    text references driver (id) on delete set null,
  dispatched_at timestamptz,
  started_at   timestamptz,
  completed_at timestamptz,
  cancel_reason text,
  created_at   timestamptz not null,
  updated_at   timestamptz not null,
  data         jsonb not null
);
-- One trip per route per service date: generation is idempotent, and the database says so.
create unique index trip_route_date_uq on trip (route_id, service_date);
create index trip_date_status_idx on trip (service_date, status);

-- ---------------------------------------------------------------- logistics
create table incident (
  id            text primary key,
  reference     text not null unique,
  type          text not null,
  severity      text not null,
  vehicle_id    text references vehicle (id) on delete set null,
  trip_id       text references trip (id) on delete set null,
  reported_date date not null,
  status        text not null,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  data          jsonb not null
);
create index incident_status_idx on incident (status);

create table work_order (
  id             text primary key,
  reference      text not null unique,
  vehicle_id     text not null references vehicle (id) on delete restrict,
  incident_id    text references incident (id) on delete set null,
  title          text not null,
  status         text not null,
  cost_total     numeric(14,2) not null default 0,
  created_at     timestamptz not null,
  updated_at     timestamptz not null,
  data           jsonb not null
);
create index work_order_vehicle_idx on work_order (vehicle_id, status);

-- ---------------------------------------------------------------- settings (single row)
create table app_settings (
  id          text primary key default 'singleton' check (id = 'singleton'),
  updated_at  timestamptz not null default now(),
  data        jsonb not null
);

-- ---------------------------------------------------------------- audit (append-only)
create table audit_entry (
  id          text primary key,
  at          timestamptz not null,
  actor_id    text,
  actor_name  text not null,
  action      text not null,
  entity      text not null,
  entity_id   text not null,
  summary     text not null
);
create index audit_at_idx on audit_entry (at desc);
create index audit_entity_idx on audit_entry (entity, entity_id);

-- Tamper-evidence at the database level (brief §5.7, audit finding M-03): the application never
-- updates or deletes audit rows, and now it cannot.
create or replace function audit_append_only() returns trigger as $$
begin
  raise exception 'audit_entry is append-only: % is not permitted (code AUD-001)', tg_op;
end;
$$ language plpgsql;
create trigger audit_append_only_trg before update or delete on audit_entry
  for each row execute function audit_append_only();
