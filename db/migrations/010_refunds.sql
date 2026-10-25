-- 010 — money going back out to a customer (FIN-03, D-92)
--
-- A credit note states that money is owed back; nothing recorded the day the office actually paid it.
-- In practice a refund was booked as a plain expense, which lost the customer, the invoice and the
-- reason, and made the month's cash-out look like spending on the business. The ledger then could not
-- tell a refund from a repair.
--
-- This table is a refund: the mirror of a payment, with its own number, its own date, its own method
-- and a required reason. Money that arrived is one table; money that went back is another. They are
-- never the same row with a negative sign, because a negative payment would still be counted as money
-- received by everything that sums the payments table.
--
-- Two invariants the database holds on its own:
--   * refunds never exceed what is owed back — paid + credited − invoice total − refunded so far —
--     checked by trigger under a row lock on the invoice, so two simultaneous refunds cannot each
--     see the same headroom and pay the same money out twice;
--   * a refund is frozen once recorded, and cancelling one requires a reason and happens once.

create table if not exists refund (
  id                 text primary key,
  reference          text not null unique check (reference ~ '^REF-[0-9]{4}-[0-9]{4,}$'),
  invoice_id         text not null references invoice (id) on delete restrict,
  client_id          text references client (id) on delete set null,
  customer_name      text not null,
  currency_code      text not null check (length(currency_code) > 0),
  amount             numeric(14,2) not null check (amount > 0),
  method             text not null check (length(method) > 0),
  paid_on            date not null,
  -- Copied out of the JSON snapshot so a refund can be found by the bank's own reference. Empty is
  -- allowed and is not unique: not every transfer carries one.
  external_reference text not null default '',
  reason             text not null check (length(reason) > 0),
  status             text not null check (status in ('paid', 'void')),
  void_reason        text,
  voided_at          timestamptz,
  recorded_by        text not null,
  recorded_at        timestamptz not null,
  updated_at         timestamptz not null,
  data               jsonb not null,
  constraint refund_void_has_reason
    check (status <> 'void' or (void_reason is not null and length(void_reason) > 0))
);

create index if not exists refund_invoice_idx on refund (invoice_id);
create index if not exists refund_paid_idx on refund (paid_on);

-- ---------------------------------------------------------------- the ceiling

create or replace function refund_within_due() returns trigger
language plpgsql as $$
declare
  invoice_total  numeric(14,2);
  invoice_status text;
  received       numeric(14,2);
  credited       numeric(14,2);
  refunded       numeric(14,2);
begin
  -- Lock the invoice first: two refunds recorded at the same moment must queue here, or both would
  -- read the same headroom and together pay back more than the customer is owed.
  select total, status
    into invoice_total, invoice_status
    from invoice
   where id = new.invoice_id
     for update;

  if not found then
    raise exception 'Refund % refers to an invoice that does not exist.', new.reference
      using errcode = '23503';
  end if;

  if invoice_status = 'void' then
    raise exception 'Invoice % is void; no money can be paid back against it.', new.invoice_id
      using errcode = '23514';
  end if;

  -- A cancelled payment never arrived, so it cannot fund a refund (D-88); a void credit note took
  -- nothing off the bill, so it cannot create one (D-86); a cancelled refund gave nothing back.
  select coalesce(sum(amount), 0) into received
    from payment where invoice_id = new.invoice_id and voided_at is null;
  select coalesce(sum(total), 0) into credited
    from credit_note where invoice_id = new.invoice_id and status = 'issued';
  select coalesce(sum(amount), 0) into refunded
    from refund where invoice_id = new.invoice_id and status = 'paid';

  if new.amount > received + credited - invoice_total - refunded then
    raise exception 'Refund of % exceeds the % owed back on invoice % (paid %, credited %, total %, already refunded %)',
      new.amount, received + credited - invoice_total - refunded, new.invoice_id,
      received, credited, invoice_total, refunded
      using errcode = '23514',
            constraint = 'refund_within_due';
  end if;

  return new;
end;
$$;

drop trigger if exists refund_within_due_trg on refund;
create trigger refund_within_due_trg before insert on refund
for each row execute function refund_within_due();

-- ---------------------------------------------------------------- immutability

create or replace function refund_frozen() returns trigger
language plpgsql as $$
begin
  if new.reference          is distinct from old.reference
  or new.invoice_id         is distinct from old.invoice_id
  or new.client_id          is distinct from old.client_id
  or new.customer_name      is distinct from old.customer_name
  or new.currency_code      is distinct from old.currency_code
  or new.amount             is distinct from old.amount
  or new.method             is distinct from old.method
  or new.paid_on            is distinct from old.paid_on
  or new.external_reference is distinct from old.external_reference
  or new.reason             is distinct from old.reason
  or new.recorded_by        is distinct from old.recorded_by
  or new.recorded_at        is distinct from old.recorded_at
  or (new.data -> 'amount') is distinct from (old.data -> 'amount') then
    raise exception 'A recorded refund is immutable: cancel it and record the correct one.'
      using errcode = '23514';
  end if;

  if old.status = 'void' and new.status <> 'void' then
    raise exception 'A cancelled refund stays cancelled; record the money again if it was really paid.'
      using errcode = '23514';
  end if;

  -- Once cancelled, neither the reason nor the time it was cancelled is rewritten: an editable
  -- explanation is worth nothing a year later. The same rule the payment cancellation carries (009).
  if old.status = 'void'
     and (new.void_reason is distinct from old.void_reason or new.voided_at is distinct from old.voided_at) then
    raise exception 'A cancelled refund stays cancelled; its reason and time are not rewritten.'
      using errcode = '23514';
  end if;

  if new.status = 'void' and old.status <> 'void' and new.voided_at is null then
    raise exception 'Cancelling a refund records when it was cancelled, not only why.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists refund_frozen_trg on refund;
create trigger refund_frozen_trg before update on refund
for each row execute function refund_frozen();

create or replace function refund_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Refunds are never deleted; cancel them instead (brief 5.9).';
end;
$$;

drop trigger if exists refund_no_delete_trg on refund;
create trigger refund_no_delete_trg before delete on refund
for each row execute function refund_no_delete();

comment on table refund is
  'Money paid back to a customer against an invoice, numbered REF-YYYY-NNNN (D-92).';
