-- 019 — the branches and offices of a customer (CLI-01, D-102)
--
-- A corporate customer is not one address. It is a head office that receives the bill and the depots
-- or plants that its staff are collected from, and the office already calls them something ("Tema
-- depot", "Head office, Industrial Area"). Held as free text on the client record, the same place
-- gets typed three ways and a run cannot say which office it served.
--
-- Three invariants the database holds by itself:
--   * **one branch name per customer** — compared on the trimmed, lower-cased name, so "Tema depot"
--     and "tema  depot" cannot both exist and a picker is never ambiguous;
--   * **a branch belongs to a customer** — the foreign key, so a branch cannot outlive its customer;
--   * **a closed branch keeps its row** — closing sets the status. Trip records and invoices that
--     named that office are still on file, and deleting the branch would leave them pointing at
--     nothing. Nothing in this table is deleted except by a backup restore.

create table if not exists client_location (
  id           text primary key,
  client_id    text not null references client (id),
  name         text not null check (length(btrim(name)) between 1 and 80),
  address      text not null default '' check (length(address) <= 300),
  phone        text not null default '' check (length(phone) <= 40),
  contact_name text not null default '' check (length(contact_name) <= 80),
  status       text not null check (status in ('active', 'closed')),
  created_at   timestamptz not null,
  updated_at   timestamptz not null,
  -- The whole record, as the application works with it. The columns above are what the database
  -- can check and index; this is what it hands back.
  data         jsonb not null
);

-- The comparison is the application's own: case is ignored and so is *any* run of spaces, not just
-- the spaces at the ends. "Tema  depot" (two spaces, as a hurried typist writes it) is the same
-- branch as "Tema depot", and a picker must not be able to offer both.
create unique index if not exists client_location_name_uq
  on client_location (client_id, regexp_replace(btrim(lower(name)), '\s+', ' ', 'g'));

create index if not exists client_location_client_idx on client_location (client_id);

comment on table client_location is
  'Branches and offices of a customer (CLI-01). A closed branch keeps its row and its address.';
comment on column client_location.name is
  'What the office calls this branch: "Head office", "Tema depot". One name per customer.';
