-- 013 — the refund ceiling must not count the row being written (D-92)
--
-- `refund_within_due()` was written as a BEFORE INSERT check: at the moment a refund is first
-- recorded, its amount must not exceed `paid + credited − invoice total − already refunded`.
--
-- Two things it did not know:
--
--   1. Records are saved with one `insert … on conflict (id) do update` statement, and PostgreSQL
--      fires BEFORE INSERT row triggers for those rows, even when the row ends up being updated. So
--      the check also runs when an existing refund is changed — including when it is cancelled.
--
--   2. When it runs that way, the row being written is still in the table in its old state, so the
--      "already refunded" sum counts the refund against itself. Cancelling a 1,150 refund on an
--      invoice owing 1,150 back was refused with "Refund of 1150.00 exceeds the 0.00 owed back",
--      which is the opposite of what cancelling means: it gives the headroom back.
--
-- A cancelled refund gave nothing back, so it needs no headroom, and the row being written is never
-- part of what has already been paid out. Both are fixed here. The trigger stays on INSERT, because
-- the save path reaches it either way, and the cancellation itself is governed by `refund_frozen()`.

create or replace function refund_within_due() returns trigger
language plpgsql as $$
declare
  invoice_total  numeric(14,2);
  invoice_status text;
  received       numeric(14,2);
  credited       numeric(14,2);
  refunded       numeric(14,2);
begin
  -- A refund that is already cancelled (or being cancelled now) gave no money back, so it occupies
  -- none of the headroom and cannot be measured against it.
  if new.status <> 'paid' then
    return new;
  end if;

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
    from refund where invoice_id = new.invoice_id and status = 'paid' and id <> new.id;

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

-- ---------------------------------------------------------------- cancellation is final
--
-- The same save path means a cancelled refund is written with the same statement as everything else.
-- `refund_frozen()` already refused to un-cancel one; it did not refuse rewriting *why* or *when*.
-- An explanation that can be edited later is worth nothing to the person reading the file a year on,
-- so the pair is frozen once set — the rule the payment cancellation has carried since 009.

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
