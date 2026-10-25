-- 015 — contracts: the paper behind a corporate account (CLI-02, D-95)
--
-- A client record said that a company existed. Nothing said what had been agreed with it, for which
-- days, over which routes or until when — so "is this account still ours?" could only be answered by
-- finding the file. This table is that file, transcribed: the term, the service, the routes and shifts
-- in scope, and the pricing and payment terms exactly as they were signed.
--
-- Two invariants, on the same principle as every other document in this schema:
--   * **terms are frozen once the contract is active.** Drafting and approval are ordinary edits; a
--     signed term that can be edited afterwards is worth nothing when it is the thing being argued
--     about. A renegotiated agreement is a new numbered contract that names the one it replaced.
--   * **contracts are never deleted** (brief 5.9). Terminating keeps the record, because the question
--     "what did we agree in March?" must still be answerable in December.
--
-- Expiry is deliberately *not* a stored value: a date passing is not an event a person records, and a
-- stored "expired" would be wrong between nightly runs. `contractStateOf()` derives it from end_date.

create table if not exists contract (
  id                  text primary key,
  reference           text not null unique check (reference ~ '^CT-[0-9]{3,}$'),
  client_id           text not null references client (id) on delete restrict,
  start_date          date not null,
  -- An open-ended agreement has no renewal date, and the column says so rather than storing a
  -- sentinel date that a report would later count.
  end_date            date,
  status              text not null check (status in ('draft', 'pending_approval', 'active', 'suspended', 'terminated')),
  created_by          text not null,
  created_at          timestamptz not null,
  updated_at          timestamptz not null,
  data                jsonb not null,
  constraint contract_term_ordered check (end_date is null or end_date >= start_date)
);

create index if not exists contract_client_idx on contract (client_id);
create index if not exists contract_end_idx on contract (end_date);
create index if not exists contract_status_idx on contract (status);

-- ---------------------------------------------------------------- immutability

create or replace function contract_frozen() returns trigger
language plpgsql as $$
begin
  -- Once a contract is agreed, its **terms** are the thing that was signed and cannot be edited: the
  -- client, the term, the service, the routes and shifts, and the pricing and payment wording. The
  -- status may still move (suspended, resumed, terminated), and its own history grows with it.
  if old.status in ('active', 'suspended', 'terminated') then
    if new.reference              is distinct from old.reference
    or new.client_id              is distinct from old.client_id
    or new.start_date             is distinct from old.start_date
    or new.end_date               is distinct from old.end_date
    or (new.data -> 'clientName')          is distinct from (old.data -> 'clientName')
    or (new.data -> 'serviceType')         is distinct from (old.data -> 'serviceType')
    or (new.data -> 'routeIds')            is distinct from (old.data -> 'routeIds')
    or (new.data -> 'weekdays')            is distinct from (old.data -> 'weekdays')
    or (new.data -> 'shiftIds')            is distinct from (old.data -> 'shiftIds')
    or (new.data -> 'vehicleCategoryId')   is distinct from (old.data -> 'vehicleCategoryId')
    or (new.data -> 'pricingModel')        is distinct from (old.data -> 'pricingModel')
    or (new.data -> 'billingFrequency')    is distinct from (old.data -> 'billingFrequency')
    or (new.data -> 'paymentTerms')        is distinct from (old.data -> 'paymentTerms')
    or (new.data -> 'serviceLevelTargets') is distinct from (old.data -> 'serviceLevelTargets')
    or (new.data -> 'notes')               is distinct from (old.data -> 'notes') then
      raise exception 'An approved contract is not rewritten: draft a new one that names it (D-95).'
        using errcode = '23514';
    end if;
  end if;

  if old.status = 'terminated' and new.status <> 'terminated' then
    raise exception 'A terminated contract stays terminated; service resumes under a new contract.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists contract_frozen_trg on contract;
create trigger contract_frozen_trg before update on contract
for each row execute function contract_frozen();

create or replace function contract_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Contracts are never deleted; terminate them instead (brief 5.9).';
end;
$$;

drop trigger if exists contract_no_delete_trg on contract;
create trigger contract_no_delete_trg before delete on contract
for each row execute function contract_no_delete();

-- ---------------------------------------------------------------- numbering
--
-- A contract takes its number from `reference_counter`, so the scope list has to include it. This is
-- the constraint that cost a release once already (012): adding a series to the application and
-- forgetting the list fails only where there is a real database.

alter table reference_counter drop constraint if exists reference_counter_scope_check;
alter table reference_counter
  add constraint reference_counter_scope_check
  check (scope in (
    'rental',
    'route',
    'trip',
    'incident',
    'workOrder',
    'booking',
    'contract',
    'invoice',
    'creditNote',
    'payment',
    'refund',
    'expense'
  ));

comment on table contract is
  'A corporate agreement: term, service, routes and shifts in scope, and the signed pricing and payment terms (D-95).';
