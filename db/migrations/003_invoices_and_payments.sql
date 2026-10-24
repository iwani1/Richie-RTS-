-- 003 — invoices and manual payments (brief FIN-02, FIN-03, invariants 5.4 and 5.6)
--
-- Two new records, and the guarantees the brief asks of them at the database level, because the
-- service layer's checks are a good error message and the constraints are the guarantee:
--
--   * an issued invoice cannot be edited: identity, dates, lines and totals are frozen by trigger;
--     only its status, its amount paid and its void note may move;
--   * a second invoice for the same billable event is impossible (partial unique index, so a voided
--     invoice does not block re-invoicing the corrected service);
--   * a payment is written once; only verification/reconciliation status may advance, and it may
--     only advance forwards;
--   * the same external reference cannot be recorded twice against one invoice (a bank slip or a
--     MoMo transaction id is the idempotency key, brief 5.4 and 5.8);
--   * money is numeric(14,2) and amount_paid can never exceed the total.
--
-- Numbers come from reference_counter, which allocates per scope and per year inside the writing
-- transaction (brief 5.6: references come from the database, not from an array length).

create table reference_counter (
  scope   text    not null check (scope in ('invoice', 'payment')),
  period  text    not null check (period ~ '^[0-9]{4}$'),
  last    integer not null default 0 check (last >= 0),
  primary key (scope, period)
);

create table invoice (
  id             text primary key,
  reference      text not null unique check (reference ~ '^INV-[0-9]{4}-[0-9]{4,}$'),
  kind           text not null default 'rental' check (kind in ('rental')),
  rental_id      text references rental (id) on delete restrict,
  client_id      text references client (id) on delete set null,
  customer_name  text not null,
  currency_code  text not null,
  subtotal       numeric(14,2) not null check (subtotal >= 0),
  total          numeric(14,2) not null check (total >= 0),
  amount_paid    numeric(14,2) not null default 0 check (amount_paid >= 0),
  status         text not null check (status in ('issued', 'part_paid', 'paid', 'void')),
  billable_event text not null,
  issued_on      date not null,
  due_on         date not null,
  created_at     timestamptz not null,
  updated_at     timestamptz not null,
  data           jsonb not null,
  constraint invoice_paid_within_total check (amount_paid <= total),
  constraint invoice_dates_ordered check (due_on >= issued_on),
  constraint invoice_currency_present check (length(currency_code) > 0)
);

-- One live invoice per billable event. Void keeps its number and its record, but stops blocking a
-- corrected invoice for the same service.
create unique index invoice_billable_event_uq on invoice (billable_event) where status <> 'void';
create index invoice_status_idx on invoice (status);
create index invoice_issued_idx on invoice (issued_on);
create index invoice_rental_idx on invoice (rental_id);

create table payment (
  id                 text primary key,
  reference          text not null unique check (reference ~ '^PAY-[0-9]{4}-[0-9]{4,}$'),
  invoice_id         text not null references invoice (id) on delete restrict,
  amount             numeric(14,2) not null check (amount > 0),
  currency_code      text not null,
  method             text not null check (length(method) > 0),
  paid_on            date not null,
  external_reference text not null default '',
  status             text not null check (status in ('recorded', 'verified', 'reconciled')),
  recorded_by        text not null,
  recorded_at        timestamptz not null,
  data               jsonb not null
);

-- The idempotency key (§5.4): one external reference, one payment, per invoice.
create unique index payment_external_reference_uq
  on payment (invoice_id, external_reference)
  where external_reference <> '';
create index payment_invoice_idx on payment (invoice_id);
create index payment_paid_idx on payment (paid_on);

-- ---------------------------------------------------------------- immutability triggers

create function invoice_frozen() returns trigger
language plpgsql as $$
begin
  if new.reference      is distinct from old.reference
  or new.kind           is distinct from old.kind
  or new.rental_id      is distinct from old.rental_id
  or new.client_id      is distinct from old.client_id
  or new.customer_name  is distinct from old.customer_name
  or new.currency_code  is distinct from old.currency_code
  or new.subtotal       is distinct from old.subtotal
  or new.total          is distinct from old.total
  or new.billable_event is distinct from old.billable_event
  or new.issued_on      is distinct from old.issued_on
  or new.due_on         is distinct from old.due_on
  or new.data -> 'lines'    is distinct from old.data -> 'lines'
  or new.data -> 'taxLines' is distinct from old.data -> 'taxLines' then
    raise exception 'An issued invoice is immutable: void it and record a correction instead.';
  end if;
  -- amount_paid is derived from the payment rows by the service layer. The database cannot compare
  -- it to the sum here without ordering every insert to satisfy it, so it enforces the two
  -- invariants it can: the total is never exceeded, and a paid invoice is never voided.
  if new.status = 'void' and old.status <> 'void' and old.amount_paid > 0 then
    raise exception 'An invoice with payments cannot be voided.';
  end if;
  return new;
end;
$$;

create trigger invoice_frozen_trg before update on invoice
for each row execute function invoice_frozen();

create function invoice_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Invoices are never deleted; void them instead (brief 5.9).';
end;
$$;

create trigger invoice_no_delete_trg before delete on invoice
for each row execute function invoice_no_delete();

create function payment_frozen() returns trigger
language plpgsql as $$
declare
  old_rank int := case old.status when 'recorded' then 1 when 'verified' then 2 else 3 end;
  new_rank int := case new.status when 'recorded' then 1 when 'verified' then 2 else 3 end;
begin
  if new.reference          is distinct from old.reference
  or new.invoice_id         is distinct from old.invoice_id
  or new.amount             is distinct from old.amount
  or new.currency_code      is distinct from old.currency_code
  or new.method             is distinct from old.method
  or new.paid_on            is distinct from old.paid_on
  or new.external_reference is distinct from old.external_reference
  or new.recorded_by        is distinct from old.recorded_by
  or new.recorded_at        is distinct from old.recorded_at
  or (new.data -> 'amount') is distinct from (old.data -> 'amount') then
    raise exception 'A recorded payment is immutable: record an adjusting entry instead.';
  end if;
  if new_rank < old_rank then
    raise exception 'Payment status only moves forward: recorded, verified, reconciled.';
  end if;
  return new;
end;
$$;

create trigger payment_frozen_trg before update on payment
for each row execute function payment_frozen();

create function payment_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Payments are never deleted; verify or correct with a new entry (brief 5.4).';
end;
$$;

create trigger payment_no_delete_trg before delete on payment
for each row execute function payment_no_delete();
