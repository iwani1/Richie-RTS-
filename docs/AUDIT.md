# Whole-system audit - 28 October 2026

**Audited:** commit `5aed55e` ("One product: every screen on the dark palette, and the motion that
belongs to it"), the tip of `arena/368c3fd2-richie-rts`, plus the documentation corrections this audit
made (they are committed with it).

**Where it ran:** this workspace — the same source tree, its own copy of PostgreSQL 18.4, and a
production build of the application served on a local port. **Not** the owner's office machine and not
a live deployment, because neither is reachable from here.

**What this audit did not look at:** a real browser window (there is no browser in this workspace, so
every layout and animation claim below is read from the compiled CSS and the component code, never
from a screenshot); real staff using the system; the office machine's backups; and anything that needs
a provider that is not installed — email, SMS, GPS or a card gateway.

---

## 1. The verdict in one table

| Area | Result | Note |
| --- | --- | --- |
| Compiles and type-checks | **Pass** | `tsc --noEmit` clean over 277 files / 71,043 lines |
| Lint | **Pass** | `eslint .` clean, no warnings suppressed by name |
| Unit and screen tests | **Pass** | 1,340 passed, 28 skipped, 0 failed |
| Database tests against real PostgreSQL | **Pass** | 28 tests, 5 files, 5.2 s, PostgreSQL 18.4 |
| Coverage | **Pass, thin in one place** | 85.16 % lines, 76.66 % branches overall; `src/screens` is 79.55 / 68.37 |
| Production build | **Pass** | `next build` 42-64 s, no warnings that matter |
| Live behaviour | **Pass** | 12 API routes answered as designed; unknown path 404 |
| Authorisation | **Pass** | every protected route refused an unauthenticated caller; nothing leaked |
| Security headers | **Pass** | frame, type-sniff, referrer, permissions and CSP all present |
| Secrets in the repository | **Pass** | only `.env.example` is tracked; no key, token or password |
| Injection and XSS | **Pass** | no `dangerouslySetInnerHTML`, no `eval`, no dynamic code, no `any` |
| Database integrity | **Pass** | 19 triggers, 1 exclusion constraint, 22 migrations applied |
| Dependencies | **Pass** | `npm audit` 0 vulnerabilities; the one version drift was closed in Phase 77; two majors deferred (P3-2) |
| Dead code | **Fixed** | 10 unused components and 2 unused packages removed in Phase 77; the build had also been reading class names out of prose (P2-2) |
| Documentation accuracy | **Finding, fixed** | feature counts were wrong by 6 rows (P2-1) |
| Accessibility | **Pass** | icon buttons labelled, images described, tables and radios given names |
| Design tokens and contrast | **Pass** | 234 colour rules in the legacy sheet re-checked; lowest 4.90:1, none below 4.5 |

**No P1 finding.** Nothing in this build loses a record, leaks one to the wrong role, or lets a
stranger in. What this audit found is clerical and hygienic: the paperwork disagreed with itself, and
some machinery was shipped that nothing uses.

---

## 2. Findings, worst first

### P2-1 - The feature register disagreed with its own table (fixed in this audit)

**What was wrong.** `docs/PROGRESS.md` said the register held **72 IDs: 34 met, 26 partial, 12
deferred**, and its own heading read "all 72 IDs". The table underneath it has **78 rows: 39 Met, 26
Partial, 0 not built, 13 Deferred**. `docs/STATUS.md` separately told a reader "14 IDs" were deferred. Three documents, three numbers, none
of them the table's. The same drift is in `docs/SETUP_AND_DEPLOYMENT.md`, which advertised the database
suite as "14 tests, 4 files" when it is 28 tests in 5 files.

The phase breakdown was wrong the same way: it credited 1A with 24 rows when there are 29, and phase 2
with 10 when there are 11.

**Why it mattered.** The register is how the owner knows what they own. Counting five delivered rows as
undelivered, and disagreeing with itself about how much is deferred, is the kind of error that gets
repeated in a pitch, a plan or a budget.

**What was done.** The heading, the tally line and the phase breakdown were recomputed from the table,
`docs/STATUS.md` was rewritten to name the thirteen deferred rows and to say the count comes from the
table, not from prose, and the database-suite line in `docs/SETUP_AND_DEPLOYMENT.md` now reads 28 tests
in 5 files. A re-read of the table now gives 39 / 26 / 0 / 13 and the arithmetic closes:
29 + 25 + 6 + 11 + 7 = 78.

**Guarded against.** The rule is now written down as D-126: **the table is the register; prose is
derived from it and never maintained beside it.**

### P2-2 - Ten components and two packages that nothing in the product uses (removed in Phase 77)

Ten shadcn components sit under `src/components/ui/` with **no importer anywhere**: `alert`,
`avatar`, `command`, `dropdown-menu`, `popover`, `select`, `skeleton`, `tabs`, `textarea`, `tooltip`.
Two more (`badge`, `separator`) are each imported once and do nothing that the product's own
`StatusBadge` and borders do not already do.

One package is genuinely unused: **`recharts`** (0 imports). A second, **`cmdk`**, is imported only by
`ui/command.tsx`, which itself is imported by nobody — so `cmdk` is dead transitively. `tw-animate-css`
was on the suspect list and is **not** dead: `src/app/globals.css` imports it on line 2.

**Why it is worth a decision rather than a deletion.** These files are the standard scaffolding of the
component library the build rule names, they cost nothing at runtime (they are not in any page's
bundle), and the next screen that needs a select or a tooltip can take one off the shelf. Against that:
every unused file is code that no test covers and no type-check exercises through use, and `recharts`
is a dependency in the lockfile that a security advisory would one day make someone patch for nothing.

**Status: removed.** The owner answered "do it" on 28 October 2026 and Phase 77 took the first
option: the ten components, `recharts` and `cmdk` are gone, `radix-ui` and the nine components in use
(`badge`, `button`, `card`, `dialog`, `input`, `label`, `separator`, `sheet`, `table`) remain. Removing
them exposed a second fault worth recording under this heading: **Tailwind had been reading class names
out of the documentation.** Its automatic source detection walks the whole project, and `DECISIONS.md`
quotes the old `stone` utilities in prose, so the build emitted a `.text-stone-500\/600` utility — a
dark text colour at 4.1:1 on the dark card, waiting for somebody to type the class. `globals.css` now
names its sources (`@source not` for `docs/`, `README.md` and `audit/`), and the compiled stylesheet
contains no literal text colour at all.

### P2-3 - The working screens are the thinnest-tested part of the product

| Area | Lines % | Branches % |
| --- | --- | --- |
| `src/server` | 91.87 | 88.81 |
| `src/tms` (the rules) | 89.02 | 81.67 |
| `src/components/tms` (the new interface layer) | 87.29 | 84.11 |
| `src/ui` | 82.86 | 81.67 |
| **`src/screens`** (the 27 working screens) | **79.55** | **68.37** |
| All files | 85.16 | 76.66 |

(Functions across all files: 81.14 %. Statements: 88.61 %.)

`src/screens` is 22,500 lines and the branch figure sits 6 points above the CI floor of 62. That is not
a defect today — those screens have 60-odd screen tests between them and the rules they call are tested
directly — but it is where a regression would most likely slip through, and where the structural
rebuild will take the most risk. **Next action:** as each screen is rebuilt on `components/tms`, write
its screen test against the new structure rather than porting the old one.

### P3-1 - Two Tailwind pieces were on different releases (closed in Phase 77)

`package.json` pins the engine exactly — `"tailwindcss": "4.1.17"` — but takes the PostCSS plugin on a
caret range, `"@tailwindcss/postcss": "^4.1.17"`, and 4.3.3 already satisfies that range. The lockfile
currently holds 4.1.17 for both, so today they agree; the next `npm install` that refreshes the
lockfile may not. The compiler and its plugin are meant to move together, and a silent split in this
pair is a classic source of "the class works in dev and not in the build". **Fixed in Phase 77:** both are now pinned to the same exact release, `4.3.3`, and the build, the
suite and the stylesheet scan were re-run against it. Pinning both exactly (rather than one exact and
one caret) is what stops the pair drifting again.

### P3-2 - Big majors are available and deliberately not taken

`next` 15.5.28 (16.4.3 available), `jsdom` 25 (30), `typescript` 5.9.3 (7.0.2). Each is a project, not
an afternoon, and none is a security matter — `npm audit` reports zero. Recorded so the next audit does
not rediscover them.

### P3-3 - The runtime used here is not the one written down

`.nvmrc` says 20.19 and `engines` says `>=20.19`; the audit ran on Node 22.22.3. Every gate passed on
22, so this is a note rather than a fault — but the README should not imply the two are identical.

---

## 3. What was probed, and what came back

### Authorisation, over HTTP against the production build

| Request | Answer | Meaning |
| --- | --- | --- |
| `GET /api/health` | 200 | database reachable: PostgreSQL 18.4, extensions `btree_gist`, `pgcrypto`, 22 migrations |
| `GET /api/session` | 200 | says `setupRequired: true` on an empty install; that is the designed first-run state |
| `POST /api/session` | 405 | the sign-in route is not a form post to this path |
| `GET /api/profile` | 401 | no session, no profile |
| `GET /api/vehicle-photo/abc` | 401 | a private picture is not served to a stranger, even with a wrong id |
| `GET /api/commands` | 405 | commands only arrive as posts |
| `POST /api/commands` | 401 | a stranger cannot write |
| `GET /api/receipts` | 405 | same |
| `POST /api/enquiry` with junk | 400 with a human sentence | the one public write validates, throttles (8 per 10 minutes per address), time-traps and honeypots |
| `GET /does-not-exist` | 404 | no stack trace, no path echo |

### Security headers, production build

Present on every page: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and a
`Content-Security-Policy` of `default-src 'self'` with `frame-ancestors 'none'`, `base-uri 'none'`,
`form-action 'self'` and no remote hosts at all.

`/enquiry` is the single documented exception: `frame-ancestors *`, because the public form is designed
to sit inside the company website (WEB-01). That is the only page where a third party may frame this
application, and it needs no session to be useful.

The session cookie is `httpOnly`, `sameSite=lax`, `path=/`, with `secure` switched on whenever
`NODE_ENV` is production — read from the code, not assumed.

### Database integrity

22 migrations, 26 tables and 19 triggers, applied cleanly to a fresh database in this workspace. The
guards that make the records trustworthy are all present and were exercised by the integration suite:

| Guard | What it stops |
| --- | --- |
| `exclude using gist (resource_type, resource_id, period) where (active)` | one vehicle or driver on two overlapping jobs — "exactly one of six simultaneous assignments wins" passes |
| `odometer_monotonic_trg` | a reading that goes backwards |
| `audit_append_only_trg` | editing or deleting history |
| `invoice_frozen_trg`, `invoice_no_delete_trg` | changing an invoice after it is issued, or deleting one |
| `payment_frozen_trg` | rewriting a receipt |

### Secrets and personal data

Only `.env.example` is tracked. `.env` is ignored, as are receipt images and vehicle photographs
(`data/receipts/`, `data/vehicle-photos/`). No token, key or password exists in the tree; the only
matches for "password" are form fields and the hash column.

### Dead ends and silencing

No `TODO`, `FIXME`, `XXX` or `HACK`. No `console.log`, `console.warn` or `console.debug`. No `eval`,
`new Function` or `dangerouslySetInnerHTML`. No `any` in the product code and no `@ts-ignore`. Five
`as unknown as` casts in the product code (the other 58 are in test files, shaping mocks) — all five
sit where a database row meets a type or where a request body is admitted, and each was read to confirm
it narrows a known shape rather than papering over an unknown one.

### Accessibility

The three icon-only buttons all carry an accessible name; both `<img>` elements carry an `alt`
(`"{registration}"` and `"Photograph of {registration}"`) and are deliberately plain `<img>` tags,
because Next's image optimiser would cache a picture behind a session check (D-108). The data tables,
the segmented controls and the command palette are each given a name, and the suite asserts those names
rather than reaching into markup by class — so a control that loses its name fails a test.

### Appearance and contrast

Every one of the 234 rules in `src/styles/legacy.css` that sets a text colour was recomputed after the
Phase 75 re-point, resolving each `var()` and each `color-mix()` against the surface it sits on:

- **72 rules declare their own background.** The lowest is a disabled button at **5.05:1**, and the red
  status text on its own 13 % tint is 5.18:1. None is below 4.5.
- **162 rules inherit their surface** and were measured against the card (`#1A1A1D`), which is where
  that text sits. The lowest is **4.90:1** — the documented "dim" floor, used for small icons. Seven
  rules land between 4.5 and 7 (the dim and red-on-card cases); everything else is above 7.

So the floor in the palette is real and nothing crosses it.

The production stylesheet was then compiled and scanned for a second opinion. It contains **no literal
hex value for any background and no literal hex value for any text colour** — every colour in the built
CSS goes through a token, which is what makes a single-palette claim checkable at all. (The only
literal white in the file is Tailwind's own `--color-white` definition and the `#fff` default for a ring
offset: variables, not a painted surface.) The same scan confirms the legacy sheet carries no rule that
sets a light surface, which is why `/` and `/dashboard` look like one product rather than two.

### The register tells the truth about what it cannot do

Six rows whose brief mentions notifying a customer were read line by line (RNT-01, RNT-02, RNT-05,
NTF-01, NTF-02, FLT-03). There is no mail or SMS provider in the build and **no row claims a message
was sent**: each says the record exists and the message does not, and the interface says so on screen.
That is the standard this audit is holding the rest of the register to.

---

## 4. Next actions, in order

| # | Action | Owner | Size |
| --- | --- | --- | --- |
| 1 | ~~Decide P2-2: delete, partly delete, or keep the unused components and `recharts` / `cmdk`~~ — done in Phase 77 | owner | done |
| 2 | ~~Bump `tailwindcss` and `@tailwindcss/postcss` to one release, re-run build and CSS scan~~ — done in Phase 77 | build | done |
| 3 | Rebuild the 27 screens on `components/tms`, screen by screen, testing each against the new structure | build | the large remaining piece |
| 4 | Once a screen is rebuilt, delete its rules from `legacy.css`; the file should reach zero | build | follows 3 |
| 5 | Re-run this audit at each phase boundary rather than once a year | build | 20 minutes |

---

## 5. How to reproduce this audit

```bash
npx tsc --noEmit                     # types
npx eslint .                         # lint
npx vitest run                       # 1,340 tests
npx vitest run --coverage            # the coverage table above
npm audit --audit-level=low          # dependencies
rm -rf .next && npx next build       # the production build

# database: against a scratch database, never the office one
createdb richie_tms_audit
TEST_DATABASE_URL=postgresql:///richie_tms_audit npm run test:integration

# live behaviour and headers
npx next start -p 3001 &             # production build, no PREVIEW_EMBED
curl -s -D - -o /dev/null http://127.0.0.1:3001/ | grep -i "frame\|content-security"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3001/api/commands
```

The register count is checked mechanically, not by eye:

```bash
grep -c '^| [A-Z]\+-[0-9]\+ |' docs/PROGRESS.md     # rows in the table
```

---

## 6. Follow-up: what changed after the audit (Phase 77)

The owner answered the audit's first two actions with "do it" on 28 October 2026. Phase 77 carried them
out and the measurements above were re-taken on the new tree:

| Change | Evidence |
| --- | --- |
| Ten unused components deleted, two packages removed (`recharts`, `cmdk`), lockfile re-resolved | `radix-ui` and the nine components in use remain; `npm install` removed 37 packages and still reports **0 vulnerabilities** |
| Tailwind pinned exactly on both sides (`4.3.3`) | build succeeds; the compiled stylesheet keeps every token, utility and keyframe (`rounded-card`, `tms-mono`, `fade-up`, `--ease-spring`, `bg-sidebar` all present) |
| Class detection limited to `src/` | the stray `.text-stone-500\/600` utility is gone; **no literal text colour and no light background** remains in the compiled CSS |
| Gates re-run | `tsc` clean, `eslint` clean, **1,340 tests passed** (28 skipped — unchanged, because nothing under test was deleted), `next build` 62 s, coverage 89.24 % lines / 76.79 % branches |

The one thing this follow-up did **not** change is the shape of the product: no screen gained or lost a
feature, and the 27 screens still read `legacy.css` until each is rebuilt.
