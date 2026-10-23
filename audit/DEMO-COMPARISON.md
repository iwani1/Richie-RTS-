# Which demo came closer to building the application?

**Compared:** `Richie TMS demo 1.zip` (00:48) and `Richie TMS demo 2.zip` (00:58), against
`richie-tms-standing-brief.md` (the standing brief, `AGENTS.md`) and `richie-tms-phase-prompts.md`
(Phases 0–3).

Short answer: **neither is close, and they are not really two different attempts — they are the
same application twice.** If you must ship one, take **demo 2**; it is a better *presentation* of
the same build, not a better *build*.

---

## 1. The decisive fact: the domain layer is byte-identical

All 19 files in `src/tms/` — the entire command layer, validation, permissions, own-record scope,
crypto, KPI/cost reports and **all six test suites** — have identical MD5 hashes in both archives.
`src/routes.ts`, `src/main.tsx` and `src/utils/cn.ts` are identical too. Both builds run the same
**118 tests**, and the bundle is 567 kB in each.

```
SAME  src/tms/service.ts        SAME  src/tms/busing.ts        SAME  src/tms/logistics.ts
SAME  src/tms/permissions.ts    SAME  src/tms/scope.ts         SAME  src/tms/crypto.ts
SAME  src/tms/types.ts          SAME  src/tms/useTms.ts        SAME  src/tms/commands.ts
SAME  src/tms/*.test.ts (6)     SAME  src/routes.ts            SAME  src/main.tsx
```

Every source difference is presentational (measured line deltas):

| File | +/− | What changed |
|---|---|---|
| `src/App.tsx` | +106 / −72 | nav regrouped into five labelled sections; ledger numbering |
| `src/pages/Auth.tsx` | +43 / −53 | split-screen poster re-laid out; copy rewritten |
| `src/ui/primitives.tsx` | +49 / −63 | component classes moved to the new design system |
| `src/pages/Dashboard.tsx` | +18 / −14 | masthead, stat tiles |
| `src/pages/StaffLogistics.tsx` | +17 / −17 | class names only |
| 7 other pages | ±1–8 | class names only |
| `src/index.css` | 40,561 → 51,160 B | new "operations ledger" token set and layout layer |
| `index.html` | 327 → 888 B | Google Fonts (Fraunces / Archivo / IBM Plex Mono), meta description |

**No new feature, screen, command, validator or test exists in demo 2.** Demo 1 is a
"dispatch console" skin (sand, livery green, gold); demo 2 is an "operations ledger" skin (ink,
paper, brass, serif display). Both were built against the same Phase 11 state.

### Documentation differences

| Document | Demo 1 | Demo 2 |
|---|---|---|
| `ARCHITECTURE.md` | describes modules and limits | **adds an "Interface system" section** and claims a headless-Chromium visual verification |
| `DECISIONS.md` | D-01…D-40 | **adds D-41** (the operations-ledger design decision) |
| `PROGRESS.md` | **records "Phase 12 — Interface rework: dispatch-console UI"** | **no Phase 12 entry at all**, although it performed another UI rework |
| `AGENTS.md` | 6,125 B | 5,991 B (tighter) |

So the two differ in *which* UI pass they document, and demo 2 has a small documentation
regression: it reworked the interface but did not log the phase that `AGENTS.md` §14 requires.

---

## 2. What the briefs actually asked for

The brief is specific about stack (§4) and about how work is proven (§2, §12, §13). Measured
against that:

| Brief requirement | Demo 1 | Demo 2 |
|---|---|---|
| Next.js App Router + React + TypeScript strict + Tailwind | ✗ Vite SPA (React/TS/Tailwind ok) | same |
| PostgreSQL 15 + `btree_gist` exclusion constraints | ✗ none | same |
| Prisma + hand-written SQL migrations | ✗ JSON `migrate()` with `schemaVersion` 1–10 | same |
| Zod at every server boundary | ✗ hand-written validators | same |
| Auth library (Auth.js / Better Auth); never hand-roll | ✗ hand-rolled PBKDF2 + `sessionStorage` | same |
| `pg-boss` background jobs | ✗ none | same |
| Vitest against a **real Postgres**; Playwright E2E | ✗ jsdom only, no Playwright | same |
| Docker Compose, `.env.example`, `/health` | ✗ | same |
| Server-side validation and permission checks (§2.1) | ✗ all in the browser | same |
| Company (tenant) isolation (§5.2) | ✗ single tenant, no company entity | same |
| Database-enforced double-booking (§5.1) | ✗ in-memory overlap checks only | same |
| `NUMERIC(14,2)` money, immutable invoices (§5.4) | ✗ JS floats, `round2()` | same |
| `timestamptz` UTC / Africa/Accra (§5.5) | ✗ ISO strings, browser locale | same |
| Human-readable references from sequences (§5.6) | ~ prefixed refs (`RNT-…`), no sequence | same |

**Both fail the stack completely.** Neither is a TMS in the brief's sense; each is a
well-structured browser prototype of one.

---

## 3. Feature backlog coverage (78 feature IDs, identical for both demos)

Scoring: **Done** = works end to end in this build · **Partial** = a meaningful subset exists ·
**Missing** = no implementation. Rated from the code, not from `PROGRESS.md`.

| Area | IDs | Done | Partial | Missing |
|---|---|---|---|---|
| Auth & administration | AUTH-01…06 | – | 01, 02, 03, 04, 05 | 06 (2FA) |
| Audit / settings / migration | AUD-01, SET-01, MIG-01 | AUD-01, SET-01 | – | MIG-01 (CSV import) |
| Customers & rentals | CUS-01, RNT-01…09, WEB-01 | RNT-08 | CUS-01, RNT-01…07, RNT-09 | WEB-01 (public enquiry) |
| Fleet & drivers | FLT-01…05 | – | 01, 02, 03, 04, 05 | – |
| Maintenance | MNT-01…04 | – | 01, 02, 03, 04 | – |
| Corporate clients & contracts | CLI-01…03 | – | 01, 03 | **02 (contracts)** |
| Employees | EMP-01…03 | – | 01, 03 | **02 (CSV import)** |
| Routes & schedules | RTE-01…05 | – | 01, 02, 03 | 04 (planning aid), 05 |
| Bookings | BKG-01…06 | – | – | **all six** |
| Trips | TRP-01, 02 | – | 01, 02 | – |
| Dispatch | DSP-01…04 | – | 01, 02, 04 | 03 (emergency trip) |
| Driver interface | DRV-01…05 | 01, 04 | 02 | 03 (boarding codes), 05 (offline) |
| Passenger interface | PAX-01, 02 | – | – | both |
| Incidents | INC-01, 02 | – | 01, 02 | – |
| Finance | FIN-01…08 | – | 01, 02, 03 | 04, 05, 06, 07, 08 |
| Notifications | NTF-01…03 | – | – | all three |
| Reporting | RPT-01…05 | – | 02, 03, 04 | 01 (rental report), 05 (PDF) |
| Location tracking | GPS-01 | – | – | yes |

**Totals: 5 done · 44 partial · 29 missing** → 49 of 78 features touched (63 %),
weighted **≈ 35 % of the backlog** (done = 1, partial = 0.5).

### What the 5 "done" features are

`AUD-01` audit log + viewer · `SET-01` settings registry with no invented defaults ·
`RNT-08` cancellation releasing resources · `DRV-01` driver home · `DRV-04` defect/breakdown report.

The strongest *partial* work, and the part worth keeping: the rental lifecycle
(request → quotation with immutable versions → deposit → assignment → start → completion →
final invoice), staff-busing trips with progressive stop recording and on-time reporting,
own-record scoping that fails closed, and incident → work-order → cost handling.

---

## 4. Phase-gate verdict (both demos)

| Phase | What the brief demanded | Reality in both demos | Gate |
|---|---|---|---|
| 0 | docs + Docker/Postgres/`.env`/health + CI | 8 docs present and good; no infrastructure; CI authored but never run | **not met** |
| 1A | rentals, fleet, finance, audit, public enquiry, Playwright, parallel double-booking test | rental slice works in-browser; no DB constraints, no Playwright, no WEB-01/MIG-01 | **not met** |
| 1B | contracts, employees + CSV import, bookings, dispatch, corporate invoicing | no contracts, no bookings, no CSV; busing acts as a substitute for RTE/TRP/DSP | **not met** |
| 1C | portals, reports with coverage, finance dashboard, deployment docs | driver + client portals partial; on-time and cost reports have coverage; no finance dashboard | **not met** |
| 2 | notifications, offline, boarding codes, incidents | incidents built **ahead of schedule**; everything else absent | **not met** |
| 3 | payments, expenses, payroll, reconciliation | nothing | not started |

Not one exit criterion in the phase prompts is satisfied, because all of them require a real
database, parallel-request tests and Playwright.

---

## 5. So which one?

**Demo 2**, but only for presentation and documentation:

- one coherent design system with tokens, a documented decision (D-41) and an interface section in
  `ARCHITECTURE.md` — closer to brief §11 (visual standards, role-specific dashboards, mobile rail);
- typography and layout are visibly more considered; the auth screen carries the three services;
- its `AGENTS.md` is tighter.

**Demo 1** is not behind on anything functional, and it is marginally more honest about its own
history: its `PROGRESS.md` records the interface rework as a phase; demo 2 silently dropped that
record.

Choose demo 2 as the base and carry over nothing else — the choice costs you no features.

---

## 6. If the goal is actually "build the application"

Neither demo is the application, and no amount of UI polish closes the gap. The distance, in
dependency order:

1. **A server** (Next.js + Postgres + Prisma + Zod), moving `executeCommand` behind an API with
   cookie sessions — this alone converts C-01/§2.1 from a fail to a pass and unblocks most of
   Phase 1A's exit criteria.
   The command layer is already pure, synchronous and React-free, so this is a transport change,
   not a rewrite. See `audit/AUDIT-REPORT.md` §4 (C-01) for the shape of the work.
2. **Contracts and bookings** (CLI-02, BKG-01…06) — the corporate side of the business is entirely
   absent; busing currently runs off standing rosters, not bookings.
3. **Employees with CSV import** (EMP-02, MIG-01) — the brief treats row-level-error imports as a
   day-one feature, and it is the fastest way to get real data in.
4. **Money** (FIN-02/03 ledger, immutable invoices, duplicate-billing guard) before anything is
   shown to finance.
5. **Playwright + a Postgres test database**, otherwise no phase gate can ever be signed off.

Trying to reach the brief by starting from demo 2's UI is the wrong order; starting from its
`src/tms/` modules is the right one.
