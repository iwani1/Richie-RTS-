-- 018 — the customer record a document needs (CUS-01)
--
-- `client` was a name, three contact fields and a status. That is enough to ring somebody and not
-- enough to bill them: an invoice has to carry the buyer's address and, for a company that has one,
-- its tax identification number, or the customer cannot claim the tax and has to ask for a corrected
-- document. The code the office already uses to identify the customer had nowhere to be written down
-- either, so two people called "Harbour Logistics" were distinguished only by whoever answered.
--
-- Everything added here is **allowed to be blank**. An existing customer has no code, no classified
-- type and no billing details until somebody supplies them, and inventing "organisation" for every
-- row would be a fact nobody stated. The screen shows a blank as "not recorded", which is the truth.
--
-- `client_type` carries the brief's organisation/individual distinction. It is nullable for the same
-- reason, and the check below is written so that NULL passes while any other value must be one of the
-- two.
--
-- The two invoice columns are the buyer's details **as they were on the day the invoice was issued**.
-- They are copied from the client record rather than read from it when the document is printed:
-- a customer who moves premises in July must not silently change the address on a January invoice,
-- for the same reason the tax lines are snapshotted rather than recalculated.

alter table client add column if not exists reference       text not null default '';
alter table client add column if not exists client_type     text;
alter table client add column if not exists billing_address text not null default '';
alter table client add column if not exists tin             text not null default '';
alter table client add column if not exists notes           text not null default '';

alter table client drop constraint if exists client_type_check;
alter table client add constraint client_type_check
  check (client_type is null or client_type in ('organisation', 'individual'));

-- A customer code identifies one customer. Two rows cannot share one, and the comparison ignores
-- case and stray spaces the way the rest of the register does.
create unique index if not exists client_reference_uq
  on client (lower(btrim(reference))) where btrim(reference) <> '';

alter table invoice add column if not exists buyer_address text not null default '';
alter table invoice add column if not exists buyer_tin     text not null default '';

comment on column client.reference is
  'The code the office already uses for this customer (CUS-01). Blank when they have none.';
comment on column client.tin is
  'Tax identification number, printed on invoices issued to this customer (CUS-01).';
comment on column invoice.buyer_address is
  'The buyer''s billing address as it was when the invoice was issued — copied, never re-read (CUS-01).';
