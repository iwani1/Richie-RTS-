-- 008 — credit notes: the only way to take money off an invoice (FIN-02, D-86)
--
-- An issued invoice is immutable. It cannot be edited down, and it cannot be voided once a payment
-- has been recorded against it (migration 003, trigger invoice_frozen). That left the office with no
-- lawful way to handle the ordinary case: the customer was overcharged, a service was not delivered,
-- or a goodwill discount was agreed after the document went out. This table is that way.
--
-- A credit note is its own numbered document against exactly one invoice. It has its own lines, its
-- own reason and its own date, and it reduces what the invoice asks for. It never touches the payment
-- rows: money that arrived is a fact, and a fact is not edited to make a balance agree.
--
-- Two invariants the database can hold on its own:
--   * credits never exceed the invoice's own total — checked by trigger `credit_note_within_invoice`
--     under a row lock on the invoice, so two simultaneous credits cannot each see the same room;
--   * a credit note is frozen once issued, and voiding one requires a reason.
--
-- The service layer adds what a row cannot know: the lines must add up to the stated total, and the
-- currency must match the invoice's.

create table if not exists credit_note (
  id            text primary key,
  reference     text not null unique check (reference ~ '^CN-[0-9]{4}-[0-9]{4,}$'),
  invoice_id    text not null references invoice (id) on delete restrict,
  client_id     text references client (id) on delete set null,
  customer_name text not null,
  currency_code text not null check (length(currency_code) > 0),
  subtotal      numeric(14,2) not null check (subtotal >= 0),
  total         numeric(14,2) not null check (total > 0),
  reason        text not null check (length(reason) > 0),
  issued_on     date not null,
  status        text not null check (status in ('issued', 'void')),
  void_reason   text,
  voided_at     timestamptz,
  created_by    text not null,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  data          jsonb not null,
  constraint credit_note_tax_within_total check (subtotal <= total),
  constraint credit_note_void_has_reason check (status <> 'void' or (void_reason is not null and length(void_reason) > 0))
);

create index if not exists credit_note_invoice_idx on credit_note (invoice_id);
create index if not exists credit_note_issued_idx on credit_note (issued_on);

-- One credit note can cover one invoice many times, so there is no unique key on invoice_id: a
-- wrong amount is corrected by voiding that note and issuing the next one, not by reusing a number.

-- ---------------------------------------------------------------- the ceiling

create or replace function credit_note_within_invoice() returns trigger
language plpgsql as $$
declare
  invoice_total  numeric(14,2);
  invoice_status text;
  already        numeric(14,2);
begin
  -- Lock the invoice row first: two credits issued at the same moment must queue here, or both
  -- would read the same free headroom and together overshoot the bill.
  select total, status
    into invoice_total, invoice_status
    from invoice
   where id = new.invoice_id
     for update;

  if not found then
    raise exception 'Credit note % refers to an invoice that does not exist.', new.reference
      using errcode = '23503';
  end if;

  if invoice_status = 'void' then
    raise exception 'Invoice % is void; there is nothing left to credit.', new.invoice_id
      using errcode = '23514';
  end if;

  select coalesce(sum(total), 0)
    into already
    from credit_note
   where invoice_id = new.invoice_id
     and status = 'issued';

  -- The ceiling is the invoice's own total, not what is still unpaid. A credit issued against an
  -- invoice that is already paid in full is a refund: the bill drops below the cash received and the
  -- difference is owed back. That is an ordinary thing to do (a service was cancelled after payment),
  -- and the service layer states the refund on the invoice instead of hiding it. Crediting more than
  -- the invoice ever asked for is not ordinary, and is refused here.
  if already + new.total > invoice_total then
    raise exception 'Credit of % exceeds the % left on invoice % (total %, already credited %)',
      new.total, invoice_total - already, new.invoice_id, invoice_total, already
      using errcode = '23514',
            constraint = 'credit_note_within_invoice';
  end if;

  return new;
end;
$$;

drop trigger if exists credit_note_within_invoice_trg on credit_note;
create trigger credit_note_within_invoice_trg before insert on credit_note
for each row execute function credit_note_within_invoice();

-- Voiding a credit note gives its headroom back, so the trigger above only sees live rows and runs
-- on insert alone. Reactivating a void note is not a thing the application offers, and the frozen
-- trigger below refuses the change of numbers that would make it necessary.

-- ---------------------------------------------------------------- immutability

create or replace function credit_note_frozen() returns trigger
language plpgsql as $$
begin
  if new.reference     is distinct from old.reference
  or new.invoice_id    is distinct from old.invoice_id
  or new.client_id     is distinct from old.client_id
  or new.customer_name is distinct from old.customer_name
  or new.currency_code is distinct from old.currency_code
  or new.subtotal      is distinct from old.subtotal
  or new.total         is distinct from old.total
  or new.reason        is distinct from old.reason
  or new.issued_on     is distinct from old.issued_on
  or new.created_by    is distinct from old.created_by
  or new.created_at    is distinct from old.created_at
  or (new.data -> 'lines')    is distinct from (old.data -> 'lines')
  or (new.data -> 'taxLines') is distinct from (old.data -> 'taxLines') then
    raise exception 'An issued credit note is immutable: void it and issue the next one instead.';
  end if;
  -- A void is a one-way door. Un-voiding would silently restore a discount the office had decided to
  -- withdraw, and the credit would reappear on the next report with no trace of the reversal.
  if old.status = 'void' and new.status <> 'void' then
    raise exception 'A void credit note stays void; issue a new one.';
  end if;
  return new;
end;
$$;

drop trigger if exists credit_note_frozen_trg on credit_note;
create trigger credit_note_frozen_trg before update on credit_note
for each row execute function credit_note_frozen();

create or replace function credit_note_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Credit notes are never deleted; void them instead (brief 5.9).';
end;
$$;

drop trigger if exists credit_note_no_delete_trg on credit_note;
create trigger credit_note_no_delete_trg before delete on credit_note
for each row execute function credit_note_no_delete();

-- ---------------------------------------------------------------- voiding a credited invoice

-- An invoice can be voided only while nothing has happened to it. Migration 003 refused a void once a
-- payment existed; a credit note is the other thing that can happen to one, and voiding an invoice that
-- has been credited would leave a live credit note standing against a document the system now reports
-- as never having counted. The service says the same thing in a sentence; this makes it true even for a
-- restore or a hand-written row.
create or replace function invoice_frozen() returns trigger
language plpgsql as $$
declare
  live_credits int;
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
  if new.status = 'void' and old.status <> 'void' then
    if old.amount_paid > 0 then
      raise exception 'An invoice with payments cannot be voided.';
    end if;
    select count(*) into live_credits from credit_note where invoice_id = old.id and status = 'issued';
    if live_credits > 0 then
      raise exception 'An invoice with a credit note cannot be voided: void the credit note instead.';
    end if;
  end if;
  return new;
end;
$$;

comment on function invoice_frozen() is
  'An issued invoice never changes; it can only be voided, and only while no payment and no live credit note stands against it (D-86).';

-- ---------------------------------------------------------------- numbering

alter table reference_counter drop constraint if exists reference_counter_scope_check;
alter table reference_counter
  add constraint reference_counter_scope_check
  check (scope in ('rental', 'route', 'trip', 'incident', 'workOrder', 'invoice', 'creditNote', 'payment', 'booking'));

comment on column reference_counter.period is
  'YYYY for invoices, credit notes and payments; all for rentals, routes, trips, incidents, work orders and bookings';
