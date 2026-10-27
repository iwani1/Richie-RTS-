# Entity-relationship model

The app stores these as arrays inside one JSON document (schema version 34; PostgreSQL keeps them in
typed tables, migration `020` being the latest). This diagram is the **target relational schema** that a PostgreSQL build would implement. Fields are simplified; `id` columns are UUIDs.

```mermaid
erDiagram
  USER {
    uuid id PK
    text email UK
    text full_name
    text role
    bool active
    uuid driver_id FK
    uuid client_id FK
    uuid passenger_id FK
    text password_hash
    text password_salt
  }
  VEHICLE_CATEGORY {
    uuid id PK
    text name UK
  }
  SHIFT {
    uuid id PK
    text name UK
    time start_time
    time end_time
  }
  CLIENT {
    uuid id PK
    text name UK
    text status
    text contact_name
    text contact_email
  }
  VEHICLE {
    uuid id PK
    text registration UK
    uuid category_id FK
    int seat_capacity
    text status
  }
  DRIVER {
    uuid id PK
    text full_name
    text licence_number UK
    date licence_expiry
    text status
  }
  RENTAL {
    uuid id PK
    text reference UK
    uuid client_id FK
    uuid category_id FK
    uuid vehicle_id FK
    uuid driver_id FK
    date start_date
    date end_date
    text status
  }
  ROUTE {
    uuid id PK
    text reference UK
    uuid client_id FK
    uuid shift_id FK
    uuid category_id FK
    text direction
    text status
  }
  CONTRACT {
    uuid id PK
    text reference UK
    uuid client_id FK
    uuid replaces_id FK
    date start_date
    date end_date
    text status
    text created_by
  }
  CONTRACT_ROUTE {
    uuid contract_id FK
    uuid route_id FK
  }
  ROUTE_DAY {
    uuid route_id FK
    smallint weekday
  }
  ROUTE_STOP {
    uuid id PK
    uuid route_id FK
    int sequence
    text name
    time scheduled_time
  }
  PASSENGER {
    uuid id PK
    uuid client_id FK
    uuid route_id FK
    uuid stop_id FK
    text full_name
    text employee_ref
    text phone
    text status
  }
  TRIP {
    uuid id PK
    text reference UK
    uuid route_id FK
    date service_date
    uuid vehicle_id FK
    uuid driver_id FK
    text status
    text origin
    timestamptz started_at
    int threshold_snapshot
  }
  TRIP_STOP_LOG {
    uuid id PK
    uuid trip_id FK
    uuid route_stop_id FK
    time actual_time
  }
  BOARDING {
    uuid id PK
    uuid trip_id FK
    uuid passenger_id FK
    uuid stop_id FK
    text outcome
  }
  BOOKING {
    uuid id PK
    text reference UK
    uuid trip_id FK
    uuid passenger_id FK
    uuid client_id FK
    date service_date
    text status
    timestamptz created_at
  }
  AUDIT_ENTRY {
    uuid id PK
    uuid actor_id FK
    text action
    text entity
    text entity_id
    timestamptz at
  }

  VEHICLE_CATEGORY ||--o{ VEHICLE : classifies
  VEHICLE_CATEGORY ||--o{ RENTAL : requested_as
  VEHICLE_CATEGORY ||--o{ ROUTE : requires
  CLIENT ||--o{ RENTAL : books
  CLIENT ||--o{ ROUTE : served_by
  CLIENT ||--o{ CONTRACT : agreed_with
  CONTRACT ||--o{ CONTRACT_ROUTE : covers
  ROUTE ||--o{ CONTRACT_ROUTE : named_in
  CONTRACT o|--o| CONTRACT : replaces
  CLIENT ||--o{ PASSENGER : employs
  SHIFT o|--o{ ROUTE : scheduled_in
  VEHICLE o|--o{ RENTAL : assigned_to
  DRIVER o|--o{ RENTAL : assigned_to
  ROUTE ||--o{ ROUTE_DAY : operates_on
  ROUTE ||--|{ ROUTE_STOP : has
  ROUTE ||--o{ TRIP : generates
  ROUTE o|--o{ PASSENGER : rides
  ROUTE_STOP o|--o{ PASSENGER : pickup_at
  TRIP o|--o| VEHICLE : run_by
  TRIP o|--o| DRIVER : driven_by
  TRIP ||--o{ TRIP_STOP_LOG : records
  ROUTE_STOP ||--o{ TRIP_STOP_LOG : measured_at
  TRIP ||--o{ BOARDING : records
  TRIP ||--o{ BOOKING : carries
  PASSENGER ||--o{ BOOKING : holds_seat
  CLIENT ||--o{ BOOKING : booked_by
  PASSENGER ||--o{ BOARDING : boards
  USER ||--o{ AUDIT_ENTRY : performs
```

## Key relationships

| Relationship | Rule |
|---|---|
| Route to stops | One route has two or more ordered stops. Stop names are unique within a route. Times never decrease along the route. |
| Route to trips | One **scheduled** trip per route per service date. Scheduled trips are generated only on the route's operating weekdays, inside its start and end dates. An **ad hoc** trip (\`origin = 'adhoc'\`) may exist on any date, including a date the route does not operate, and may sit beside a cancelled scheduled run; it carries a written reason (D-82). |
| Passenger to route | A passenger has at most one route and one pickup stop (a limit; see OPEN_QUESTIONS Q-30). The stop must belong to that route, and the route must belong to the passenger's client. |
| Trip to boardings | One boarding record per rider expected on the trip: every active roster passenger **and** every booking on that run that still holds a seat (`confirmed` or `offered`, D-85). Inactive roster members are excluded; a cancelled or rejected booking is not expected aboard. |
| Trip to bookings | A booking names one rider's seat on one run. It is **not** a roster row: the roster is how a client's staff travel every day, and a booking covers the seat that has to be named — a visitor, a new hire, somebody from a sister company (D-83). Capacity is `vehicle.seat_capacity − active roster on the route − confirmed/offered bookings`, checked in the booking command. |
| Booking to passenger | One live booking per rider per run. A rider who is already on that run's route roster is refused, because the roster already holds their seat. A booking that holds a seat is also a row on the run's manifest, so its rider receives a boarding outcome like any roster rider. |
| Contract to client and routes | A contract belongs to one client and names the routes in scope; every named route must already belong to that client. Its dates are a closed term or open-ended (`end_date` null), and the end date is never before the start. |
| Contract to contract | Two **live** contracts may not cover the same day for one client (a suspended or terminated one does not block). A renewal names the contract it replaces (`replaces_id`) and must still start after that contract ends — naming it does not waive the overlap rule. |
| Contract to bookings | A booking request is refused when the covering contract is not `active`, or when the last one ended before the service date and nothing replaced it. A client with no contract on file is not blocked. |
| Trip to vehicle and driver | Set at assignment, required at dispatch. The vehicle must be in the route's category and status Available. The driver's licence must be valid on the service date. |

## Unique constraints

| Table | Constraint |
|---|---|
| USER | `email` unique (normalised lower-case) |
| VEHICLE | `registration` unique after removing spaces and hyphens, upper-cased |
| VEHICLE_CATEGORY, SHIFT | `name` unique (case-insensitive) |
| CLIENT | `name` unique (case-insensitive) |
| DRIVER | `licence_number` unique (upper-cased) |
| RENTAL | `reference` unique |
| ROUTE | `reference` unique |
| CONTRACT | `reference` unique and shaped `CT-nnnn`; `end_date >= start_date` where set; status one of `draft`, `pending_approval`, `active`, `suspended`, `terminated` (**`expired` is never stored** — it is derived from `end_date`, D-95) |
| ROUTE_STOP | `(route_id, sequence)` unique |
| PASSENGER | `(client_id, employee_ref)` unique where `employee_ref <> ''` |
| TRIP | `(route_id, service_date)` unique **where `origin = 'schedule'`** (migration 006); `reference` unique; `origin` is one of `schedule`, `adhoc` |
| BOARDING | `(trip_id, passenger_id)` unique |
| BOOKING | `reference` unique; `(trip_id, passenger_id)` unique **where `status in ('requested','confirmed','waitlisted','offered')`** (migration 007), so a refused or cancelled rider may ask for the seat again while a duplicate live seat is impossible |

## Indexes

- `TRIP (service_date, status)` for the daily board.
- `TRIP (vehicle_id, service_date)` and `TRIP (driver_id, service_date)` for conflict checks.
- `RENTAL (status, start_date, end_date)` for availability checks.
- `AUDIT_ENTRY (entity, entity_id)` and `AUDIT_ENTRY (at DESC)`.
- `PASSENGER (client_id, status)`.
- `BOOKING (service_date, status)` for the day's seat view, and `BOOKING (client_id)` for a client contact's own scope.
- `CONTRACT (client_id)`, `CONTRACT (end_date)` for the renewal watch, and `CONTRACT (status)`.

## Contracts

`db/migrations/015_contracts.sql`. The row keeps the fields a query joins on and the whole transcribed
agreement in a `data` column, the same shape as the other documents in this build:

```
CONTRACT
  id, reference ('CT-0001'), client_id, start_date, end_date (null = open-ended),
  status, created_by, created_at, updated_at,
  data -> clientName, serviceType, routeIds[], weekdays[], shiftIds[], vehicleCategoryId,
          pricingModel, billingFrequency, paymentTerms, serviceLevelTargets, notes,
          replacesId, history[]
```

`contract_frozen()` refuses any change to those terms once the row is `active`, `suspended` or
`terminated` (the status may still move, and its history grows); `contract_no_delete()` refuses every
delete. Both read the terms from `data`, so a column added later has to be named in the trigger — that
is deliberate: a new term should be a decision, not an oversight.

## Compliance documents

```mermaid
erDiagram
  VEHICLE ||--o{ COMPLIANCE_DOCUMENT : "owner (xor)"
  DRIVER  ||--o{ COMPLIANCE_DOCUMENT : "owner (xor)"
  COMPLIANCE_DOCUMENT {
    uuid id PK
    text owner_type          "vehicle | driver"
    uuid owner_id            "FK to vehicles.id or drivers.id"
    uuid document_type_id    "settings.documentTypes entry"
    text document_number
    date issued_date         "nullable"
    date expiry_date
    text notes
  }
```

`COMPLIANCE_DOCUMENT.owner_id` is polymorphic (vehicle or driver), so the foreign key is
enforced by the service layer rather than a single SQL FK. There is no `document_type` table
in this build: the catalogue lives in `settings.documentTypes` (id, name, appliesTo: vehicle |
driver | both, required: boolean) and is company-configured with no seeded values (Q-16). A type
with `required: true` refuses assignment while it is missing or lapsed on the day of the work
(D-76). A document type in use by any record cannot be removed. Owner and `document_type_id` are immutable after creation;
`document_number`, `issued_date`, `expiry_date` and `notes` are editable (D-27).

Distinct from `drivers.licence_expiry`, which continues to gate trip and rental assignment.

`settings.maintenance` holds the service intervals (one per vehicle category) and one switch,
`blockOnOverdueService`, which decides whether an overdue routine service refuses work or is only
reported (D-75). It is a setting rather than a column on the vehicle because the rule is the
company's, not the vehicle's; the vehicle's own state is on `VEHICLE.status`, which an incident
changes when a defect takes it off the road.

Two other catalogues live in settings rather than in their own tables: `settings.workTypes` (what a
work order is for) and `settings.costCategories` (what a recorded cost was for). A work order and a
cost entry store the name they were given, so renaming a catalogue entry never rewrites history
(D-78).

`Trip.origin` is a column rather than a value inside the row's JSON because a database constraint has
to read it: migration 006 replaced the whole-table unique index with a partial one, so the rule "one
scheduled run per route per day" survives while an emergency run can still be created (D-82). The
reason for an ad hoc run stays in the row's data, because nothing queries it.

`Vehicle.fuelType`, `ownership`, `ownerName` and `usualDriverId` sit in the row's data too (schema 27,
D-107). None of them is queried by the database: `ownership` is deliberately **null** when nobody has
recorded it, because a default of "owned" would put a hired bus on the company's asset list.
`usualDriverId` names a `drivers.id`, and nothing in the database enforces it — the check happens
where the form and the importer meet (`readVehicleDetail`), because a dangling id must produce a
sentence a person can act on rather than a constraint violation.

`Vehicle.photo` is the same shape and for a sharper reason (schema 28, D-108): the record holds
`storedName`, `originalName`, `mimeType`, `byteSize`, `sha256`, `uploadedBy` and `uploadedAt`, and the
**bytes are not in the database at all**. They sit in `VEHICLE_PHOTO_DIR` (`data/vehicle-photos` by
default), named `vhcl_<36 hex>.<ext>` by the server. A photograph in a `bytea` column would make every
nightly dump carry every picture of every bus, so a backup that used to take seconds would grow without
bound and a restore would drag the fleet along with the figures. One picture per vehicle — the field
holds one object, so a replacement is a replacement rather than a second row — and removing it clears
the field while the file stays in the folder, because the retention question (Q-18) is still open and
nothing here deletes a file on the strength of a screen action. The receipts' folder (`RECEIPT_DIR`,
D-100) is deliberately a different one: the two kinds of file are kept for different reasons and hold
different names (`rcpt_…` and `vhcl_…`).

`DocumentReminder` (schema 29, D-110) is a collection in the snapshot rather than a table, because
nothing queries it: it is read beside the document it answers, and it is append-only — a second person
taking the same renewal on adds a row and the newest for the current `expiryDate` is the live one. The
`expiryDate` is copied onto the acknowledgement on purpose. An acknowledgement that hung off the
document alone would survive a mistyped renewal, and silence the reminder it was meant to answer; with
the date on the row, changing the date is what re-raises it.

`Booking.history` is embedded on the booking rather than kept in a table of its own: it is written
once with the change it describes, never edited, and read whole beside the booking (BKG-06).

`Trip.corrections` and `Trip.rosterChanges` are embedded on the trip rather than kept in tables of
their own: both are append-only notes about one run (a corrected fact; a rider added, removed or
moved while that run was under way), read with the run and never queried across runs. Each entry
carries its own id, timestamp and author, so the record explains itself without a join (D-73, D-79).

`Trip.delays` is embedded for the same reason (DSP-04, D-105): each entry is one statement — how many
minutes behind the timetable the run is, why, when it was said and by whom — and the list is
append-only. A later entry is the delay getting worse or the run catching up, never an edit of the
earlier one, because the question a client asks afterwards is what was known at the time. Schema 26;
`migrate()` fills an empty list for runs written before it, and no SQL migration was needed.

## Exclusion constraints (no-double-booking)

These need the `btree_gist` extension. They are the database form of the overlap rules that the service enforces in code today. Neither is enforced by the current browser build.

```sql
-- Trip resource overlap: a vehicle or driver cannot run two live trips whose time windows overlap on a day.
-- window_start and window_end are the first and last stop times on the service date.
ALTER TABLE trip ADD CONSTRAINT trip_vehicle_no_overlap
  EXCLUDE USING gist (
    vehicle_id WITH =,
    tsrange(service_date + window_start, service_date + window_end) WITH &&
  ) WHERE (status IN ('planned', 'dispatched', 'in_progress') AND vehicle_id IS NOT NULL);

ALTER TABLE trip ADD CONSTRAINT trip_driver_no_overlap
  EXCLUDE USING gist (
    driver_id WITH =,
    tsrange(service_date + window_start, service_date + window_end) WITH &&
  ) WHERE (status IN ('planned', 'dispatched', 'in_progress') AND driver_id IS NOT NULL);

-- Rental vehicle overlap: whole-day ranges.
ALTER TABLE rental ADD CONSTRAINT rental_vehicle_no_overlap
  EXCLUDE USING gist (
    vehicle_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status IN ('confirmed', 'dispatched') AND vehicle_id IS NOT NULL);
```

Cross-module clashes (a vehicle on a rental and a trip on the same day) cannot be expressed as one constraint across two tables. The recommended design is a `resource_reservation` table (`resource_id`, `resource_type`, `during tsrange`, `source`) with one exclusion constraint per resource type. Both trips and rentals would write to it.

Note: the Phase 0 brief refers to "section 5.1" for the exclusion constraints. That section is not in the uploaded text. The constraints above are what this build implements and what it would need in PostgreSQL.

## Phase 8 service intervals and odometer readings

```mermaid
erDiagram
  VEHICLE_CATEGORY ||--o| SERVICE_SCHEDULE : has
  VEHICLE ||--o{ ODOMETER_READING : reported_by
  VEHICLE ||--o{ WORK_ORDER : maintained_by

  SERVICE_SCHEDULE {
    uuid category_id PK
    int interval_km
    int interval_days
    int remind_lead_km
    int remind_lead_days
  }
  ODOMETER_READING {
    uuid id PK
    uuid vehicle_id FK
    int reading_km
    date reading_date
    text status
    text void_reason
  }
```

- `service_schedule.category_id` is a unique FK to `vehicle_category(id)` with
  `CHECK (interval_km IS NOT NULL OR interval_days IS NOT NULL)`.
- `work_order.resets_service_interval` plus `work_order.completed_at` identify the service anchor
  (`WHERE resets_service_interval AND completed_at IS NOT NULL`).
- Hand-entered readings must never go backwards for a vehicle; in PostgreSQL this needs a
  per-vehicle lock or monotonic check rather than a plain unique constraint.

## Phase 9 expired-quote revisions

The browser schema keeps the current quotation on `rental.quote` and prior immutable snapshots
in `rental.quoteHistory[]`. A relational schema should split this into:

```mermaid
erDiagram
  RENTAL ||--o{ RENTAL_QUOTE : revisions
  RENTAL_QUOTE ||--|{ RENTAL_QUOTE_LINE : contains
  RENTAL {
    uuid id PK
    uuid current_quote_id FK
  }
  RENTAL_QUOTE {
    uuid id PK
    uuid rental_id FK
    text reference
    int revision_number
    text terms
    bool driver_included
    text currency_code
    text pricing_basis
    numeric subtotal
    numeric deposit_percent
    numeric deposit_required
    date valid_until
    timestamptz quoted_at
    text quoted_by
  }
```

`reference` is the quotation's own number (RNT-04, D-117): drawn from `reference_counter` under the
`quotation` scope and shared by every revision of the same document, so `QUO-0001` revision 2 is the
second version of one sheet, not a second sheet. `terms` are copied onto each revision as the company's
terms stood when it was issued.

Unique `(rental_id, revision_number)` and unique `reference`; quote and line snapshots are immutable. The initial
quote is revision 1; each permitted renewal creates revision N+1 and keeps the previous
snapshot, so the current quote count equals history length + 1.

**The journey a request asked for (RNT-01, D-119).** `rental.plan` is the pair to `rental.run`: the two
clock times, the stops in the order the vehicle calls, luggage, special needs, the contact for the day
and the channel the request arrived through. Relationally it belongs on the rental as a one-to-one
row, because a request has one plan:

```mermaid
erDiagram
  RENTAL ||--o| RENTAL_PLAN : "asks for"
  RENTAL_PLAN {
    uuid id PK
    uuid rental_id FK
    time departure_time
    time return_time
    text luggage
    text special_needs
    text trip_contact_name
    text trip_contact_phone
    text source
  }
  RENTAL_PLAN ||--o{ RENTAL_PLAN_STOP : "calls at"
  RENTAL_PLAN_STOP {
    uuid id PK
    uuid plan_id FK
    integer position
    text place
  }
```

`position` is what keeps the stops in the order the customer gave them; the duration is **not** a
column, because it is the difference between the two times and the two dates, and a stored copy could
drift. `source` is nullable: a request whose origin nobody recorded says so rather than being filed
under the phone by default.

**The run a hire actually had (RNT-07, D-118).** In the browser schema this is one object on the
rental, `rental.run`: departure and return instants, two odometer readings, the distance and its source
(`odometer` or `entered`), the damage note, the customer's feedback, and who recorded it. Relationally
it belongs on the rental as a one-to-one row, because a hire has one run:

```mermaid
erDiagram
  RENTAL ||--o| RENTAL_RUN : "is worked by"
  RENTAL_RUN {
    uuid id PK
    uuid rental_id FK
    timestamptz departed_at
    timestamptz returned_at
    numeric odometer_start_km
    numeric odometer_end_km
    numeric distance_km
    text distance_source
    text damage_notes
    text feedback
    uuid recorded_by_user_id FK
    timestamptz recorded_at
  }
```

`CHECK (returned_at IS NULL OR departed_at IS NULL OR returned_at >= departed_at)` states the one rule
the application also states, and `distance_source` is nullable because a hire with no distance has no
source either. The balance is **not** stored here: it is computed from the invoice for the rental and
the payments against it, so a stored copy could not disagree with the document the customer holds.

**The customer's answer to a quotation (RNT-05, D-116).** In the browser schema this is one object on
the rental, `rental.acceptance`, holding the person, the time, the channel (`client_portal` or `office`),
the quotation's `quotedAt`, its total, its deposit and a note. The figures are **copied**, deliberately:
an acceptance is a statement about one specific quotation, so the record must not follow a later
revision. Relationally it belongs on the revision, not on the rental:

```mermaid
erDiagram
  RENTAL_QUOTE ||--o| RENTAL_ACCEPTANCE : "is answered by at most one"
  RENTAL_ACCEPTANCE {
    uuid id PK
    uuid rental_quote_id FK
    text accepted_by_name
    uuid accepted_by_user_id FK
    text channel
    timestamptz accepted_at
    numeric total
    numeric deposit_required
    text currency_code
    text note
  }
```

`UNIQUE (rental_quote_id)` is the rule that a quotation is answered once; a revision nobody accepted
simply has no row. Storing the total and deposit as well as the foreign key is deliberate redundancy:
it keeps the agreement readable in a backup and in an export that has lost the quote table.

## Phase 16 invoices and payments (implemented in `db/migrations/003_invoices_and_payments.sql`, extended by `008_credit_notes.sql`, `009_payment_cancellations.sql` and `010_refunds.sql`; expenses in `011_expenses.sql`)

```mermaid
erDiagram
  RENTAL ||--o{ INVOICE : "bills the completion"
  CLIENT ||--o{ INVOICE : "may be the account"
  INVOICE ||--o{ PAYMENT : "is paid by"
  INVOICE ||--o{ CREDIT_NOTE : "is corrected by (D-86)"
  INVOICE ||--o{ REFUND : "is paid back by (D-92)"
  REFERENCE_COUNTER ||--o{ INVOICE : "allocates INV-nnnn-yyyy"
  REFERENCE_COUNTER ||--o{ PAYMENT : "allocates PAY-nnnn-yyyy"
  REFERENCE_COUNTER ||--o{ CREDIT_NOTE : "allocates CN-nnnn-yyyy"
  REFERENCE_COUNTER ||--o{ REFUND : "allocates REF-nnnn-yyyy"
  REFERENCE_COUNTER ||--o{ EXPENSE : "allocates EXP-nnnn-yyyy"

  INVOICE {
    text id PK
    text reference UK "INV-YYYY-NNNN"
    text kind "rental (1A)"
    text rental_id FK
    text client_id FK
    text customer_name
    text currency_code
    numeric subtotal "14,2"
    numeric total "14,2, >= subtotal"
    numeric amount_paid "14,2, <= total"
    text status "issued|part_paid|paid|void"
    text billable_event "one live invoice per event"
    date issued_on
    date due_on ">= issued_on"
    jsonb data "lines, taxLines, notes, void reason"
  }

  PAYMENT {
    text id PK
    text reference UK "PAY-YYYY-NNNN"
    text invoice_id FK
    numeric amount "14,2, > 0"
    text currency_code
    text method
    date paid_on
    text external_reference
    text status "recorded|verified|reconciled"
    text recorded_by
    timestamptz recorded_at
    text void_reason "null while it stands (D-88)"
    timestamptz voided_at "one-way; refuses being cleared"
    jsonb data
  }

  CREDIT_NOTE {
    text id PK
    text reference UK "CN-YYYY-NNNN"
    text invoice_id FK "the invoice it corrects"
    text client_id FK
    text customer_name
    text currency_code
    numeric subtotal "14,2"
    numeric total "14,2, > 0, <= the invoice total"
    text reason
    date issued_on
    text status "issued|void"
    text void_reason
    timestamptz voided_at
    text created_by
    jsonb data "lines, taxLines (the invoice's own snapshot)"
  }

  EXPENSE {
    text id PK
    text reference UK "EXP-YYYY-NNNN"
    text incurred_on "the day the money left"
    text category "a Settings category, or blank"
    text description
    text payee "who was paid"
    numeric amount "14,2, > 0"
    text currency_code
    text method "a configured method, or blank"
    text receipt_reference "the number on the paper"
    boolean receipt_held "the paper is in the file"
    text status "recorded|void"
    text void_reason "never edited; voided once (D-93)"
    timestamptz voided_at
    text recorded_by
    timestamptz recorded_at
    jsonb data "notes, receipt facts"
  }

  REFERENCE_COUNTER {
    text scope PK "invoice|creditNote|payment|refund|expense|… (012)"
    text period PK "YYYY|all"
    integer last
  }
```

Constraints and triggers:

- `invoice_billable_event_uq` — partial unique index on `billable_event` `WHERE status <> 'void'`, so
  a service is billed once but a voided invoice can be replaced.
- `payment_external_reference_uq` — partial unique index on `(invoice_id, external_reference)`
  `WHERE external_reference <> ''`: the idempotency key a retried bank slip needs (brief 5.4, 5.8).
- `invoice_frozen_trg` — refuses any change to reference, kind, rental, client, customer, currency,
  subtotal, total, billable event, dates or the `lines`/`taxLines` JSON, and refuses to void an
  invoice with payments.
- `payment_frozen_trg` — refuses any change to the financial fields, refuses a status move backwards,
  and allows the cancellation pair (`void_reason`, `voided_at`) to be set **once** and never cleared
  (`009_payment_cancellations.sql`, D-88); `payment_void_has_reason` refuses one without the other.
- `invoice_no_delete_trg`, `payment_no_delete_trg` — delete is never allowed (brief 5.9).
- **`credit_note` (migration `008_credit_notes.sql`, D-86).** A credit note is the only way money comes
  off an issued invoice. `credit_note_within_invoice_trg` locks the invoice row and refuses an insert
  whose total would push the sum of live credits past the invoice's own total, so two simultaneous
  credit notes cannot each see the same room; `credit_note_frozen_trg` makes the document immutable and
  refuses to un-void one; `credit_note_no_delete_trg` refuses a delete. `credit_note_void_has_reason`
  is a check constraint, not a courtesy. Note that the ceiling is the invoice total and **not** what is
  still unpaid: crediting an invoice that is already paid is a refund, and `paid + credited − total`
  is reported as a refund due rather than netted away (`src/tms/creditNotes.ts`).
- **`refund` (migration `010_refunds.sql`, D-92).** Money actually paid back. `refund_within_due_trg`
  locks the invoice and refuses an amount greater than `live payments + live credits − invoice total −
  live refunds`, so the same over-credit cannot be paid out twice; `refund_void_has_reason` is a check
  constraint; `refund_frozen_trg` keeps the financial fields immutable and allows the cancellation to be
  set once; `refund_no_delete_trg` refuses a delete. A refund does **not** change `payment`, and the
  invoice's `amount_paid` is untouched by it.
- **Ceilings on update (`013`, `014`, D-94).** `credit_note_within_invoice()` and `refund_within_due()`
  run on INSERT, and records are saved with one `insert … on conflict (id) do update`, so they also ran
  when a row was voided or cancelled — and counted that row against itself. Both now ignore a row that
  is not live and exclude the row being written from the sum.
- **`expense` (migration `011_expenses.sql`, D-93).** Money spent that is not a repair. Checks:
  `reference ~ '^EXP-[0-9]{4}-[0-9]{4,}$'`, `amount > 0`, `status in ('recorded','void')`,
  `expense_void_has_reason` (a void carries a reason and a time), `expense_held_has_reference` (the
  paper cannot be held without a number printed on it). `expense_frozen_trg` refuses any change to the
  reference, date, category, description, payee, amount, currency, method, receipt facts or who
  recorded it, makes the void one-way, and requires `voided_at` with the reason; `expense_no_delete_trg`
  refuses a delete. Indexes `expense_incurred_idx` and `expense_category_idx` keep the period and
  category reports cheap.
- **`receipt_file` (migration `017_receipt_scans.sql`, Q-51, D-100).** The index to a scanned copy of a
  receipt; the image itself sits in a folder on the office machine (`RECEIPT_DIR`), never in the
  database. Checks: `stored_name ~ '^rcpt_[A-Za-z0-9._-]{8,80}$'` (the name is the server's, never a
  person's), `mime_type in (pdf/jpeg/png/webp)`, `byte_size` between 1 and 2 MB, a 64-character
  `sha256`, `status in ('attached','removed')`, a removed scan carries a reason and a time. The partial
  unique index `receipt_file_attached_uq` allows **one scan on file per expense**; `superseded_by_id`
  points at the scan that replaced this one and is deferred so a replacement can be written in one
  transaction. `receipt_file_frozen_trg` refuses any change to the file it indexes and makes a removal
  one-way; `receipt_file_no_delete_trg` refuses a delete, so the file stays in the folder for its three
  years and the register can still say a receipt was once filed.
- **`client` billing details (migration `018_customer_details.sql`, CUS-01, D-101).** Five columns:
  `reference` (the office's own customer code, nullable, `client_reference_uq` unique on
  `lower(btrim(reference))` **where the trimmed value is not empty**, so any number of customers may
  have no code and none may share one), `client_type` (`client_type_check`: `organisation`,
  `individual` or NULL — a blank is a fact the office has not stated, not a default), `billing_address`,
  `tin`, `notes`. `invoice` gains `buyer_address` and `buyer_tin`, **written once at issue** from the
  customer record and never updated afterwards; a walk-in invoice leaves both empty. Every added column
  defaults to empty, so an existing row migrates without an edit.
- **`client_location` (migration `019_client_locations.sql`, CLI-01, D-102).** The branches and offices
  of a customer: `client_id` (foreign key to `client`), `name` (1–80 characters, what the office calls
  it), `address`, `phone`, `contact_name` and `status` (`client_location_status_check`: `active` or
  `closed`). `client_location_name_uq` is unique on `(client_id, regexp_replace(btrim(lower(name)), '\s+', ' ', 'g'))`,
  so one customer cannot have two branches with the same name — case is folded and so is any run of
  spaces, which is the same comparison the form makes. Nothing deletes a branch: a
  closed one keeps its row and its address, because the trips and documents that named that office are
  still on file. `client` also gains `registration_number` and `registered_on` in the same migration —
  the certificate, when the office holds one, and blank when it does not.
- **`driver` licence classes (migration `020_driver_licence_classes.sql`, FLT-04, D-103).** Two text
  arrays, both defaulting to empty: `licence_classes` (the codes printed on the licence, upper-cased)
  and `qualifications` (certificates as the office names them). The classes are not a check
  constraint over a fixed list — the codes come off the paper, and which of them covers which of the
  company's vehicles is declared per vehicle category in `app_settings`, not in the schema. Empty
  means "not recorded", and an assignment to a category that declares classes is refused while the
  driver's list is empty.
- **Route stops (RTE-01, D-104).** A stop is not a table: it lives inside its route's `data` record,
  as `{ id, name, scheduledTime, landmark, digitalAddress, latitude, longitude }`. The four direction
  fields arrived in schema 25 and are optional; `migrate()` fills them for older routes. Nothing in
  the database constrains them, and the shape of a Ghana Post GPS address is checked in
  `src/tms/stops.ts` where the form and the command meet — the report is a sentence a person can act
  on, which a check constraint cannot give.
- `reference_counter` is written by the same transaction that writes the document, so two writers
  cannot allocate the same number.
