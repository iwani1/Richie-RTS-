# Richie Transport Services — Operations Ledger (prototype)

Transport management for staff busing, bus rentals and staff logistics.

> **This build is a prototype.** It stores everything in the browser (`localStorage`) and has
> no server. Authorisation and the audit trail therefore run in the same process as the person
> using them. **Do not enter real personal data.** See `audit/AUDIT-REPORT.md` finding C-01.

## Run it

```bash
npm ci
npm run dev        # http://localhost:5173
npm run check      # typecheck, lint, tests with coverage, build
```

The production build is a single self-contained file: `dist/index.html`.

## Read this first

| Document | What it covers |
|---|---|
| `docs/ARCHITECTURE.md` | modules, request flow, known limits |
| `docs/DATA_PROTECTION.md` | what personal data is held and what is not yet safe |
| `docs/PERMISSIONS.md` | role × permission matrix and own-record scope |
| `docs/OPEN_QUESTIONS.md` | business rules still needing an owner's decision |
| `audit/AUDIT-REPORT.md` | independent security and code-quality review |

## Status

Prototype, no server, no real data. `docs/PROGRESS.md` tracks feature state.
