# Architecture (as built)

## Deployment reality

- Build: Vite 7 + React 19 + Tailwind 4, bundled into a single `dist/index.html` (`vite-plugin-singlefile`).
- Runtime: the browser only. There is no Node.js server, no PostgreSQL, no background worker and no WebSocket host in this environment. The hosting target is unknown (OPEN_QUESTIONS Q-01).
- Persistence: `localStorage` under `richie-tms:db:v1`, schema version 10. This is an interim seam (DECISIONS D-01), not production persistence.
- Quality gates: `npm run check` runs typecheck, lint, test and build in order. The same four
  run in `.github/workflows/ci.yml` (authored here; execution not observed, no runner exists).

## Interface system

The interface is a purpose-built "operations ledger", not a component-kit default:

- **Type.** Fraunces (display headings, auth poster), Archivo (body/UI), IBM Plex Mono (eyebrows,
  labels, nav indices, table heads, badges). Loaded via Google Fonts with serif/sans/mono
  fallbacks so the app still renders offline.
- **Palette.** Ink `#14231d`, paper `#f2ecdf`, card `#fbf7ec`, hairline `#cfc5ae`, signal amber
  `#e0a43c`, brass `#b08b3e`, rust `#a24a30`. Tokens are `--rts-*` custom properties.
- **Form.** Square corners, 1px ink rules, hard offset shadows, numbered/grouped ledger rail,
  dotted-grid desk surface, dashed tape motif in the rail.
- **Implementation.** `src/ui/primitives.tsx` is the single component seam; layout classes live at
  the end of `src/index.css` under the RICHIE OPERATIONS LEDGER block. Shell and navigation are in
  `src/App.tsx`; authentication in `src/pages/Auth.tsx`. The source-document viewer keeps its own
  document styling.
- **Verification.** Headless Chromium at 1440px and 390px: fonts loaded, 0px radii, offset shadows,
  one active nav item, mobile rail off-canvas with visible menu trigger, no horizontal overflow, no
  page errors, and sampled small text at >=4.5:1 contrast. All 118 behavioural tests remain green;
  D-41 records the design decision.

## Modules

| Path | Responsibility |
|---|---|
| `src/tms/types.ts` | Domain types, `SCHEMA_VERSION = 10`, `emptyDatabase()`, `migrate()` (accepts schema 1–10) |
| `src/tms/permissions.ts` | `resource:action` permissions, the role matrix, and `isOwnScoped` / `isRecordBound` |
| `src/tms/scope.ts` | Own-record access: `actorLink`, `scopedView`, `mayReportOnVehicle`, `confinedClientId`. Confines `driver` and `client_contact` to their one linked record. Fails closed |
| `src/tms/service.ts` | Core commands: setup, users, settings, vehicles, drivers, clients, rentals, backup import |
| `src/tms/logistics.ts` | Staff logistics commands: incidents, work orders, cost entries, response and maintenance state machines |
| `src/tms/busing.ts` | Staff busing commands: routes, passengers, trip generation, assignment, dispatch, progressive start/stop/boarding, completion, cancellation, conflict checks and on-time judgement |
| `src/tms/compliance.ts` | Vehicle/driver compliance documents, expiry status and reminder lead time |
| `src/tms/maintenance.ts` | Odometer readings, last completed service anchor and fleet readiness evaluation per configured basis |
| `src/tms/kpis.ts` | KPI calculations. Each result carries period, numerator, denominator, coverage and an explicit status |
| `src/tms/costs.ts` | Recorded-cost report with period, total, entries and data coverage |
| `src/tms/commands.ts` | `executeCommand()`: the single router for every write (`AnyCommand`) |
| `src/tms/crypto.ts` | PBKDF2-SHA256 password hashing via Web Crypto |
| `src/tms/useTms.ts` | React state, session, persistence, `dispatch()` |
| `src/pages/*` | Screens. `StaffBusing.tsx` holds Routes, Passengers, Trips and Performance tabs |
| `src/ui/primitives.tsx` | Shared form, table, panel and notice components |
| `src/docs/BriefDesk.tsx` | Read-only viewer for the source brief (kept per Integrity rule 6) |

Dependency direction: pages depend on `useTms`, which depends on `commands`, which depends on `busing` and `service`. `busing` and `service` never import pages or React. `busing` imports helpers from `service` (`authorise`, `audit`, `fail`, validators). `service` does not import `busing`, so there is no cycle.

## Request flow for a write

1. A UI handler calls `dispatch(command)` from `useTms`.
2. `executeCommand(db, actor, command, now)` routes by command type.
3. The module checks the permission (`authorise`). Without it, the command is refused and nothing changes.
4. The module validates input and returns field-keyed errors (for example `stops.1.scheduledTime`). Any error means nothing changes.
5. The module checks state (for example trip `planned` to `dispatched`) and resource conflicts (same-day time overlap, rental clash, licence expiry).
6. The module builds a new immutable `Database` and appends an audit entry (`audit()`).
7. `useTms.commit()` sets React state and writes to `localStorage` **synchronously, in the same
   call**. This is the single write site; there is no window in which state and storage
   disagree (D-29). A storage failure is surfaced as `storageError` and the UI shows it.

This flow is enforced, not just described: ESLint forbids any page or UI file from importing
an `execute*` function or `executeCommand` (D-28). The only path to a write is `dispatch()`.

Guarantees in this build: no mutation without a permission; illegal transitions are rejected; every successful write produces an audit entry; failed writes leave data untouched.

Known limits:

1. State lives in one browser profile. Two open tabs can overwrite each other (last write
   wins). Server transactions are required before multi-user production use.
2. **Own-record scope runs in the caller's process.** `src/tms/scope.ts` is the only thing
   between a `driver` or `client_contact` and company data, and it runs in the same JavaScript
   context as the UI. It is applied consistently on every read and write and is covered by
   tests, but with no server there is no privileged boundary — a production deployment must
   enforce the same rules in the API layer, where the caller cannot rewrite them. The app
   shell also walls record-bound roles off from the internal screens, which is defence in
   depth rather than the security boundary itself.

## Provider interfaces (seams for later)

| Seam | Current implementation | Target |
|---|---|---|
| Persistence | `localStorage` via `useTms` | PostgreSQL behind an API, with transactions and the constraints in `ERD.md` |
| Authentication | Local PBKDF2 accounts created by administrators | Chosen provider (decision pending; no provider selected yet) |
| Clock | `now` is passed into every command | Server time, which also keeps tests deterministic |
| Notifications | None | Email/SMS providers (not configured) |

## Job runner

Not present. Trip generation runs only when an operator asks for it. Daily generation, document-expiry reminders and retention jobs need a scheduler, which needs a server runtime (D-01). They are not implemented and are not claimed as working.
