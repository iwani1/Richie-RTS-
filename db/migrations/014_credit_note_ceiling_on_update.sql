-- 014 — the credit-note ceiling must not count the row being written (D-86)
--
-- `credit_note_within_invoice()` is a BEFORE INSERT check, and records are saved with one
-- `insert … on conflict (id) do update` statement. PostgreSQL fires BEFORE INSERT row triggers for
-- those rows even when the row ends up being updated, so this check also runs when an existing credit
-- note is changed — for example when it is voided.
--
-- In that case the row being written is still in the table as `issued`, so it is counted as "already
-- credited" against itself. Voiding a 3,000 credit on a 3,450 invoice would be refused with
-- "Credit of 3000.00 exceeds the 450.00 left", which is the opposite of what voiding does: it gives
-- the headroom back. It passed the first time it was tried only because the credit in that test was
-- small enough (1,150 of 3,450) for the doubled figure to still fit — the kind of bug a fixture
-- accidentally hides.
--
-- A void credit note took nothing off the bill, and the row being written is never part of what has
-- already been credited, so both are excluded here.

create or replace function credit_note_within_invoice() returns trigger
language plpgsql as $$
declare
  invoice_total  numeric(14,2);
  invoice_status text;
  already        numeric(14,2);
begin
  -- A void credit note took nothing off the bill, so it occupies none of the headroom and cannot be
  -- measured against it.
  if new.status <> 'issued' then
    return new;
  end if;

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
     and status = 'issued'
     and id <> new.id;

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
