-- 009 — cancelling a payment recorded in error (FIN-03, D-88)
--
-- Migration 003 made a recorded payment immutable: amount, date, method and external reference are
-- frozen, and the only thing that moves is the verification status, forwards. That is right for a
-- payment that happened. It left no lawful way out of the ordinary mistake — the operator typed the
-- amount against the wrong invoice, or recorded a bank transfer that was later reversed — so the
-- invoice asked for money the office never received and the only fix was a hand-written row.
--
-- This adds one more fact to a payment: it was cancelled, when, and why. Deliberately *not* a fourth
-- value of `status`: the status answers "how far has this been checked?", and a cancelled payment
-- has not stopped being verified, it has stopped being true. Keeping them apart means a verification
-- step can never be mistaken for a cancellation, and a cancelled payment cannot be un-cancelled by
-- advancing it.
--
-- Nothing here restates the balance. `amount_paid` on the invoice is recomputed by the service from
-- the payments that still count, using the same helper the screens and the reports use.

alter table payment add column if not exists void_reason text;
alter table payment add column if not exists voided_at   timestamptz;

-- A cancellation is a pair: the moment and the reason. One without the other is a row nobody can
-- explain a year later.
alter table payment drop constraint if exists payment_void_has_reason;
alter table payment
  add constraint payment_void_has_reason
  check (
    (voided_at is null and void_reason is null)
    or (voided_at is not null and void_reason is not null and length(void_reason) > 0)
  );

comment on column payment.void_reason is
  'Why this payment was cancelled. Null while the payment stands (D-88).';
comment on column payment.voided_at is
  'When this payment was cancelled. Null while the payment stands (D-88).';

-- ---------------------------------------------------------------- the one-way door

-- Everything that was frozen stays frozen. The only new move is null -> set on the two cancellation
-- columns, once: a cancelled payment that could be un-cancelled would quietly restore money the
-- office had decided it never received, and the next report would show it with no trace of the
-- reversal. The verification ladder is unchanged — cancelling does not change the status.
create or replace function payment_frozen() returns trigger
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
    raise exception 'A recorded payment is immutable: cancel it and record the correct one.'
      using errcode = '23514';
  end if;

  if new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason then
    if old.voided_at is not null then
      raise exception 'A cancelled payment stays cancelled; record the money again if it was real.'
        using errcode = '23514';
    end if;
    if new.voided_at is null then
      raise exception 'Cancelling a payment records when it was cancelled, not only why.'
        using errcode = '23514';
    end if;
  end if;

  if new_rank < old_rank then
    raise exception 'Payment status only moves forward: recorded, verified, reconciled.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function payment_frozen() is
  'A payment is written once. Its verification status only moves forward, and it can be cancelled once, with a reason and a time (D-88).';
