-- 011 — spending that is not a repair (FIN-05, D-93)
--
-- Every recorded cost had to hang off an incident or a work order, so the system could hold
-- maintenance costs and nothing else. Fuel, tolls, a permit, rent and a driver's allowance had
-- nowhere to go. A month's "costs recorded" therefore meant "maintenance recorded", which is the
-- most flattering possible reading of a transport business's spending.
--
-- This table is an expense: a fact typed from a receipt. It carries a number (EXP-YYYY-NNNN), the day
-- the money was spent, the category from the company's own list, who was paid, the number on the
-- paper receipt and whether that paper is actually held. A figure nobody can produce a receipt for is
-- a weaker fact, and the report says so instead of pretending otherwise.
--
-- Two invariants the database holds on its own:
--   * a recorded expense is frozen — the only move is voiding it once, with a reason, so a report
--     built on a figure can always be explained afterwards;
--   * expenses are never deleted (brief 5.9).

create table if not exists expense (
  id                text primary key,
  reference         text not null unique check (reference ~ '^EXP-[0-9]{4}-[0-9]{4,}$'),
  incurred_on       date not null,
  category          text not null default '',
  description       text not null check (length(description) > 0),
  payee             text not null default '',
  amount            numeric(14,2) not null check (amount > 0),
  currency_code     text not null check (length(currency_code) > 0),
  method            text not null default '',
  receipt_reference text not null default '',
  receipt_held      boolean not null default false,
  status            text not null check (status in ('recorded', 'void')),
  void_reason       text,
  voided_at         timestamptz,
  recorded_by       text not null,
  recorded_at       timestamptz not null,
  updated_at        timestamptz not null,
  data              jsonb not null,
  constraint expense_void_has_reason
    check (status <> 'void' or (void_reason is not null and length(void_reason) > 0)),
  -- A receipt number without the claim that the paper is held is ordinary; the other way round is
  -- the slip the service refuses, and the table refuses it too.
  constraint expense_held_has_reference
    check (not receipt_held or length(receipt_reference) > 0)
);

create index if not exists expense_incurred_idx on expense (incurred_on);
create index if not exists expense_category_idx on expense (category);

-- ---------------------------------------------------------------- immutability

create or replace function expense_frozen() returns trigger
language plpgsql as $$
begin
  if new.reference         is distinct from old.reference
  or new.incurred_on       is distinct from old.incurred_on
  or new.category          is distinct from old.category
  or new.description       is distinct from old.description
  or new.payee             is distinct from old.payee
  or new.amount            is distinct from old.amount
  or new.currency_code     is distinct from old.currency_code
  or new.method            is distinct from old.method
  or new.receipt_reference is distinct from old.receipt_reference
  or new.receipt_held      is distinct from old.receipt_held
  or new.recorded_by       is distinct from old.recorded_by
  or new.recorded_at       is distinct from old.recorded_at
  or (new.data -> 'amount') is distinct from (old.data -> 'amount') then
    raise exception 'A recorded expense is immutable: void it and record the correct one.'
      using errcode = '23514';
  end if;

  if old.status = 'void' and new.status <> 'void' then
    raise exception 'A void expense stays void; record the spending again if it was real.'
      using errcode = '23514';
  end if;

  -- A void is a fact with a reason and a time. Once set, neither is rewritten: "why did we write this
  -- off?" is the question an auditor asks a year later, and an editable answer is worth nothing.
  if old.status = 'void'
     and (new.void_reason is distinct from old.void_reason or new.voided_at is distinct from old.voided_at) then
    raise exception 'A void expense stays cancelled: its reason and the time it was voided are not rewritten.'
      using errcode = '23514';
  end if;

  if new.status = 'void' and old.status <> 'void' and new.voided_at is null then
    raise exception 'Voiding an expense records when it was voided, not only why.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists expense_frozen_trg on expense;
create trigger expense_frozen_trg before update on expense
for each row execute function expense_frozen();

create or replace function expense_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Expenses are never deleted; void them instead (brief 5.9).';
end;
$$;

drop trigger if exists expense_no_delete_trg on expense;
create trigger expense_no_delete_trg before delete on expense
for each row execute function expense_no_delete();

comment on table expense is
  'Money spent that is not a repair, numbered EXP-YYYY-NNNN, with the receipt it came from (D-93).';
