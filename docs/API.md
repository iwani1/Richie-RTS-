# API

There is no REST resource API. The browser holds no database and cannot write one: it sends a
**command intent** and receives the snapshot it is allowed to see. That is the whole surface, and it
is deliberately small — every rule lives in one place, one endpoint is one place to test, and a role
cannot be widened by finding an endpoint nobody thought about (brief §5.1, §5.3, §5.10).

Everything that acts with a session is same-origin only. A request whose `Origin` does not match the
host is refused with `403` and a generic message before any work happens (`src/server/api.ts`,
`sameOrigin`). The one exception is `/api/enquiry`, which holds no session and is meant to be posted
from the company's own website (WEB-01, below).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/session` | none (returns what is visible) | Who am I, does the installation still need its first administrator, and the scoped snapshot |
| `POST` | `/api/auth/login` | none | Sign in; sets the session cookie |
| `POST` | `/api/auth/logout` | cookie | Sign out; clears the cookie |
| `POST` | `/api/setup` | none, first run only | Create the first administrator |
| `POST` | `/api/commands` | cookie | Every state change |
| `GET` | `/api/enquiry` | none | The vehicle types the public form offers, and a signed time-trap token (WEB-01) |
| `POST` | `/api/enquiry` | none, throttled | Record a public enquiry as a draft request; answers with a reference and nothing else (WEB-01) |
| `GET` | `/api/health` | none | Database reachability and migration state, for a monitor |

Responses are JSON and always `no-store`. The shape of a failure is the same everywhere:

```json
{ "ok": false, "message": "Please correct the highlighted fields.", "errors": { "startDate": "Enter the start date." } }
```

`message` is written for the operator, not for a log. `errors` is keyed by field name and is what a
form puts beside its inputs. Status codes: `400` malformed or invalid, `401` not signed in, `403` not
permitted or cross-site, `404` not found, `409` a state transition or conflict was refused, `429` rate
limited, `503` the database could not be read.

---

## `GET /api/session`

```json
{
  "ok": true,
  "setupRequired": false,
  "user": { "id": "…", "fullName": "Ama Mensah", "email": "ama@example.test", "role": "administrator", "active": true, "driverId": null, "clientId": null, "primaryContact": false },
  "database": { "schemaVersion": 11, "users": [], "vehicles": [], "…": [] },
  "auditTotal": 412
}
```

- `database` is **the database as this role may see it**, not the database. A finance session does
  not contain passengers, documents, accounts or the audit log; a driver session contains only that
  driver's record, trips and vehicles (D-60, `src/server/visibility.ts`).
- Credentials (`passwordHash`, `passwordSalt`) are removed on the way out, always.
- `audit` is trimmed to the most recent 500 rows; `auditTotal` is the true count.
- `setupRequired` is `true` only while no account exists.

## `POST /api/auth/login`

```json
{ "email": "ama@example.test", "password": "…" }
```

`200` with the same body shape as `/api/session`, and an `httpOnly`, `sameSite=lax`, signed cookie.
A wrong password, an unknown account and a malformed body all return `400`
`{"ok": false, "message": "Incorrect email or password."}` — the caller learns nothing about which
accounts exist. Repeated failures return `429` after the throttle trips; the counter is per account
(which cannot be forged) and, when a trusted proxy is declared, also per address.

## `POST /api/auth/logout`

No body. Clears the cookie and returns `{ "ok": true }`.

## `POST /api/setup`

```json
{ "fullName": "Ama Mensah", "email": "ama@example.test", "password": "…" }
```

Creates the first administrator and signs them in. Refuses once any account exists — the refusal is in
the service layer (`setup_administrator`), not in the route.

## `POST /api/commands`

```json
{ "type": "record_payment", "input": { "invoiceId": "…", "amount": "500.00", "method": "Cash", "paidOn": "2026-06-01", "externalReference": "", "note": "" } }
{ "type": "record_refund",  "input": { "invoiceId": "…", "amount": "200.00", "method": "Bank transfer", "paidOn": "2026-06-01", "externalReference": "TRF-1", "reason": "Service not delivered" } }

// Taking money off an invoice: the amount is stated before tax, and the tax comes from the invoice.
{ "type": "issue_credit_note", "input": { "invoiceId": "…", "issuedOn": "2026-06-04", "amount": "1000.00", "description": "One day not operated", "reason": "Vehicle broke down" } }
{ "type": "void_credit_note", "id": "…", "reason": "Issued against the wrong invoice" }

// Spending that is not a repair (D-93). Filed by the day the money was spent, never edited.
{ "type": "record_expense", "input": { "incurredOn": "2026-06-05", "category": "Fuel", "description": "Diesel, Kumasi depot", "payee": "Total Filling Station", "amount": "320.50", "method": "Cash", "receiptReference": "RCPT-0091", "receiptHeld": true, "notes": "" } }
{ "type": "void_expense", "id": "…", "reason": "Receipt already recorded against EXP-2026-0001" }
```

Some commands also take `id`, `reason`, `to`, `kind` or `csv` at the top level instead of inside
`input` (for example `{ "type": "void_invoice", "id": "…", "reason": "Wrong customer" }`). Passwords
are accepted only for `create_user` and `reset_user_password`, as `password`; the server hashes them
with Argon2id and never accepts a hash from the browser.

A successful command returns the **new scoped snapshot**, so the caller never needs a second read:

```json
{ "ok": true, "message": "PAY-2026-0001 recorded. INV-2026-0001 outstanding: GHS 2450.00.", "database": { "…": [] }, "auditTotal": 413 }
```

### Command catalogue

| Area | Types |
|---|---|
| Accounts and settings | `setup_administrator`, `record_sign_in`, `create_user`, `update_user`, `reset_user_password`, `update_settings` |
| Fleet | `create_vehicle`, `update_vehicle`, `transition_vehicle`, `create_driver`, `update_driver`, `record_odometer`, `void_odometer` |
| Clients and rentals | `create_client`, `update_client`, `create_client_location`, `update_client_location`, `create_contract`, `update_contract`, `advance_contract`, `create_rental`, `update_rental`, `quote_rental`, `requote_rental`, `confirm_rental`, `assign_rental`, `start_rental`, `complete_rental`, `decline_rental`, `cancel_rental` |
| Routes and trips | `create_route`, `update_route`, `generate_trips`, `assign_trip`, `dispatch_trip`, `start_trip`, `record_trip_stop`, `complete_trip`, `cancel_trip`, `correct_trip_record` |
| Roster | `create_passenger`, `update_passenger` |
| Incidents and maintenance | `create_incident`, `update_incident`, `advance_incident`, `add_incident_cost`, `remove_incident_cost`, `create_work_order`, `update_work_order`, `advance_work_order`, `add_work_order_cost`, `remove_work_order_cost` |
| Documents | `create_document`, `update_document` |
| Money | `issue_rental_invoice`, `void_invoice`, `record_payment`, `advance_payment`, `void_payment`, `issue_credit_note`, `void_credit_note`, `record_refund`, `void_refund`, `record_expense`, `void_expense` |
| Data | `import_records` (CSV, vehicles / drivers / clients), `record_backup_export` |

The catalogue is `KNOWN_COMMAND_TYPES` in `src/tms/commandTypes.ts`; a test compares it against every
module's command list, so a command a screen offers cannot be one this route refuses (D-89).

Two commands exist in the domain but are **not** reachable over HTTP:

- `setup_administrator` — only from `/api/setup`, which refuses once an account exists;
- `import_backup` — restore is a server-side operation (`npm run db:restore`), because a
  client-supplied database would overwrite every row and every credential.

### Permissions

The route pre-checks the permission for the commands whose permission differs from the obvious one
(`update_settings`, `create_user`, `update_user`, `reset_user_password`, `record_backup_export`,
`issue_rental_invoice`, `void_invoice`, `record_payment`, `advance_payment`, `void_payment`,
`issue_credit_note`, `void_credit_note`, `record_refund`, `void_refund`, `record_expense`,
`void_expense`, `create_contract`, `update_contract`, `advance_contract`), and every command checks
again inside the service with the real actor. The full matrix is in `docs/PERMISSIONS.md`.

### Errors worth knowing

| What you sent | What comes back |
|---|---|
| A command name not in the catalogue | `400 Unknown command.` |
| A valid command your role may not run | `403 Not permitted.` (boundary) or `403` with `Not permitted: your role lacks invoices:issue.` (service) |
| A state change the record cannot make | `409` with a sentence naming the current state, e.g. `A rental cannot be completed from status "draft".` |
| A guard that needs a setting nobody supplied | `409` naming the setting, e.g. `Blocked: quotation settings are incomplete. An administrator must set: deposit percentage.` |

## `GET /api/profile` (AUTH-05)

The signed-in account's own record and its last ten sign-ins. There is no id in the request, so this
endpoint cannot be pointed at somebody else; managing another person's account is `POST /api/commands`
(`users:update`).

```json
{ "ok": true,
  "user": { "id": "…", "fullName": "Ama Mensah", "email": "ama@…", "role": "operations", "active": true },
  "signIns": [ { "at": "2026-06-02T08:15:00.000Z" } ] }
```

Sign-ins come from the append-only audit table (`action = 'auth:sign_in'`). No address or device is
recorded, and the response does not pretend otherwise.

## `POST /api/profile` (AUTH-05)

Two actions, both about the caller's own account, both `sameOrigin`-checked.

| Body | Effect | Notes |
|---|---|---|
| `{"action":"details","fullName":"…","email":"…"}` | `update_profile` | Email must be unique; audited as `users:update_profile`. |
| `{"action":"password","currentPassword":"…","newPassword":"…"}` | Verifies the current password, hashes the new one (Argon2id), runs `change_own_password`, then re-seals the session | Throttled on the account; audited as `users:change_password`. Every other session for the account stops working, because the session cookie carries a digest of the password hash. |

Errors use the same shape as `/api/commands`: `400` with `{ errors: { field: message } }`, `401` when
signed out, `403` for a cross-origin POST, `429` after repeated wrong current passwords.

## `GET /api/enquiry` and `POST /api/enquiry` (WEB-01)

The only unauthenticated write in the application, and the only endpoint that is not same-origin
restricted: it exists to be embedded in the company's existing website, which will not share this
origin. It is safe to expose because it carries no session and gives nothing back.

`GET` — what the form needs to render:

```json
{ "ok": true, "token": "1780000000.…", "categories": [ { "id": "…", "name": "Coaster" } ], "open": true }
```

`token` is `<unix seconds>.<HMAC-SHA256>`, signed with `SESSION_SECRET`
(`src/server/enquiryToken.ts`). A submission is accepted only when the token is at least 3 seconds old
and less than 2 hours old.

`POST` — one enquiry:

```json
{ "token": "1780000000.…", "customerName": "Akosua Boateng", "customerPhone": "+233 24 123 4567",
  "customerEmail": "", "organization": "", "purpose": "Wedding party transport",
  "pickupLocation": "East Legon", "dropoffLocation": "Aburi",
  "startDate": "2026-07-01", "endDate": "2026-07-02", "passengers": "18",
  "vehicleCategoryId": "…", "notes": "" }
```

Success is `200` with exactly three keys — `ok`, `message`, `reference` — and nothing else:

```json
{ "ok": true, "message": "Thank you. Your request is recorded as RR-0007, and the office will call +233 24 123 4567 to confirm it.", "reference": "RR-0007" }
```

What it creates is a **draft** rental request with no client, no vehicle, no quote and no money, plus
an audit entry (`rentals:enquiry`, actor `System`) and a note that says it came from the public form.
The office still quotes and confirms it.

Guard rails, in the order they are applied: a honeypot field that answers `200` and writes nothing;
the signed time-trap (`400`); eight enquiries per address per ten minutes (`429` with
`retryAfterSeconds`); then field validation from the same rules the desk form uses (`400` with
`errors`). Every free-text field has a length ceiling. `TRUST_PROXY=1` must be set for the throttle to
use `x-forwarded-for`, exactly as for sign-in (audit F-02).

The page is `/enquiry`; `/enquiry?embed=1` is the variant to frame. It is the only path that may be
framed — `next.config.ts` gives it `frame-ancestors *` and omits `X-Frame-Options`, while every other
path keeps `frame-ancestors 'none'`.

## `GET /api/health`

```json
{ "ok": true, "service": "richie-tms", "database": "PostgreSQL 16.4, migrations: 001_init.sql, 002_resource_reservations.sql, 003_invoices_and_payments.sql", "time": "2026-10-24T09:00:00.000Z" }
```

In production the `database` field is only `"reachable"` or `"not reachable"`: the version and
extension list are useful at the terminal and mildly useful to a stranger (audit F-17). A failing
database returns `503`, which is what a monitor should alert on. Used by
`SETUP_AND_DEPLOYMENT.md` §10.

## What is deliberately absent

- No token API, no CORS, and no public write endpoint beyond `/api/enquiry`, which holds no session
  and returns no records: a browser cannot be tricked into posting a command from another site, and
  no third party can read anything.
- No pagination parameters: the snapshot is scoped and the screens filter locally. This is a stated
  limit (`PROGRESS.md`, "Not started"), not an oversight.
- No webhooks or provider callbacks. When FIN-04 arrives it will need its own signature check and an
  idempotency key before it touches this catalogue.
