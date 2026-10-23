# Richie Transport Services — Transport Management Ledger

Staff busing, bus rentals and staff logistics in one operational application.

> **This build is a browser-local prototype.** It has no server and no database: the
> application state lives in the browser's `localStorage`. That means authorisation, the
> permission matrix, own-record scope and the audit trail all run in the same JavaScript
> context as the person using them. **Do not enter real personal data** (drivers,
> passengers, client contacts) into this build. See `audit/AUDIT-REPORT.md` finding **C-01**
> for the detail and `docs/ARCHITECTURE.md` ("Deployment reality") for the limits.

## Run it

```bash
npm ci
npm run dev       # http://localhost:5173
npm run check     # typecheck, lint, tests with coverage thresholds, build
```

The production build is one self-contained file: `dist/index.html` (about 574 kB, 155 kB gzip).

First run creates the administrator account in the browser. Nothing is sent anywhere; the only
network request the page makes is the Google Fonts stylesheet.

## What is here

| Area | State |
|---|---|
| Authentication, roles, permissions, audit log | Works in-browser; PBKDF2-SHA256 credentials |
| Settings registry (no invented defaults) | Works; unset settings block their dependent actions |
| Vehicles, drivers, clients, compliance documents | Works |
| Bus rentals: request → quotation (versions) → deposit → assignment → trip → final invoice | Works |
| Staff busing: routes, rosters, trip generation, dispatch, progressive stop/boarding capture, on-time report | Works |
| Staff logistics: incidents, work orders, cost report | Works |
| Fleet readiness: service intervals, odometer, readiness | Works |
| Driver and client portals (own-record scope) | Works |
| Contracts, bookings, CSV import, notifications, payments, offline | **Not built** — see `docs/PROGRESS.md` "Not started" |

130 tests across 15 files, with coverage thresholds enforced in CI (`npm run test:coverage`).

## Read these first

| Document | Contents |
|---|---|
| `AGENTS.md` | the standing brief: how this project is built (authoritative) |
| `docs/ARCHITECTURE.md` | modules, request flow, known limits |
| `docs/PROGRESS.md` | what is done, what is blocked, and the evidence for each claim |
| `docs/PERMISSIONS.md` | role × permission matrix and own-record scope |
| `docs/DATA_PROTECTION.md` | personal data held, and what is not yet safe |
| `docs/OPEN_QUESTIONS.md` | business rules the owner still needs to answer |
| `docs/DECISIONS.md` | every non-obvious choice, with the alternatives rejected |
| `audit/AUDIT-REPORT.md` | independent security and code-quality review |

## Data protection

Ghana's Data Protection Act 2012 (Act 843) applies to the data this system is designed to
hold. The prototype stores personal data unencrypted in browser storage and exports it in
unencrypted backups; `docs/DATA_PROTECTION.md` lists exactly which obligations are unmet.
Nothing here is legal advice, and nothing in this build should be used with real people's
data until the server-side rebuild in `audit/AUDIT-REPORT.md` §9 is done.

## Licence

No licence has been chosen yet — that is an owner decision, tracked as Q-49 in
`docs/OPEN_QUESTIONS.md`. Until then, treat the code as all rights reserved.
