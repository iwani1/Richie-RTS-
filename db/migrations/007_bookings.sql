-- 007 — bookings: one rider's seat on one run (BKG-01..06, D-83)
--
-- A booking is not a roster entry. The roster is how a client's staff travel every day; a booking
-- names the seat that has to be named (a visitor, a new hire before the roster is updated). Seats are
-- counted as roster + live bookings, so both are stored, and only the booking has this table.
--
-- The duplicate rule of BKG-02 lives here as well as in the service layer: one live booking per
-- rider per run. Cancelled and rejected rows keep their history and are excluded, so a rider may be
-- refused, then request the seat again.

create table if not exists booking (
  id           text primary key,
  reference    text not null unique,
  trip_id      text not null references trip (id) on delete cascade,
  passenger_id text not null references passenger (id) on delete cascade,
  client_id    text not null references client (id) on delete cascade,
  service_date date not null,
  status       text not null,
  created_at   timestamptz not null,
  updated_at   timestamptz not null,
  data         jsonb not null
);

create unique index if not exists booking_trip_passenger_uq
  on booking (trip_id, passenger_id)
  where status in ('requested', 'confirmed', 'waitlisted', 'offered');

create index if not exists booking_date_idx on booking (service_date, status);
create index if not exists booking_client_idx on booking (client_id);
