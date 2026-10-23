# Security and Code-Quality Audit — Richie Transport Services TMS

**Repository** `https://github.com/iwani1/Richie-RTS-` · **Branch** `main` · **Commit** `030197e5c80eb7e09adef734f6398cc811e37242` (*"Add files via upload"*, 2026-10-23)
**Audit date** 2026-10-23 · **Version** 1.0 · **Classification** Public repository, no client data consulted

---

## 1. Executive summary

### What this is

Richie TMS is a React 19 + Vite + Tailwind single-page transport-management application for a Ghanaian transport operator: staff busing, bus rentals, staff logistics, compliance documents and fleet readiness. It is a **browser-local prototype**: there is no server, no database and no network calls. Its command layer (`executeCommand`) is pure and synchronous, deliberately shaped so it can move behind an HTTP API later.

### Verdict

> **The application code is unusually well built; the security model is not a security model.**
>
> As a demo with synthetic data, this is a strong, honest, well-tested piece of work. As a system holding employee, driver and passenger personal data — which the documentation itself proposes — it is not deployable at any severity below *critical*, because every control it has runs in the browser of the person those controls are supposed to constrain.

The single dominant risk (**C-01**) is architectural and cannot be patched in the client: authorisation, credentials, personal data and the audit log all live in `localStorage`/`sessionStorage`. A user with devtools can read every record, every password hash, and promote themselves to administrator by editing one field. The project documents this limit candidly (`docs/DATA_PROTECTION.md` §4, `docs/ARCHITECTURE.md` "Known limits"), which is to its credit — but it means the demo must never be pointed at real data.

Beneath that ceiling, the engineering is disciplined and the gaps that *are* fixable are concrete and small. I found and demonstrated four exploitable-or-damaging defects in the service layer and two process defects that make the repository unreviewable, then wrote and verified patches for five of them.

### Headline numbers

| Measure | Result |
|---|---|
| Source / test code | 9,780 lines across 34 files / 3,583 lines across 14 test files |
| Tests | **118 passing**, 3 consecutive runs including shuffled order, no flakiness |
| Coverage | **82.0 % statements, 75.1 % branches** (72.2 % on an all-files basis) |
| Build | Single 568 kB HTML file (153 kB gzip) in 3.1 s |
| Production dependencies | 5 packages, all MIT, **0 known vulnerabilities** |
| All dependencies | 293 packages, **8 advisories** (2 critical, 4 high) — dev-only |
| Secrets | Clean (regex sweep + detect-secrets 1.5.0; all 10 hits are test fixtures) |
| CI | A well-formed workflow exists — **inside a ZIP**, so it has never run |
| Max cyclomatic complexity | **151** (`execute()` in `service.ts`, 465 lines) |

### The five things to do first (about one day of work)

1. **Unpack the source into the repository and make CI real** (H-04). Today GitHub sees zero workflows, so nothing is scanned or gated. Patch set applies at the repo root.
2. **Upgrade the dev toolchain** (M-01). `vite 7.3.2 → 7.3.7`, `vite-plugin-singlefile 2.3.0 → 2.3.4`, `vitest 3.2.7 → 5.0.5` clears every critical and high advisory and keeps 130 tests green — verified.
3. **Enforce the credential policy in the service layer** (H-01). Today a one-character password can be minted and an empty credential is accepted (patch 0001, demonstrated PoC).
4. **Validate backups before trusting them** (H-02). Today a crafted file injects a role that makes every permission check throw (patch 0002, demonstrated PoC).
5. **Cap the audit log and audit the exports** (H-03, M-03). Today the log grows until the 5 MB storage quota is hit, after which writes fail silently; exports leave no trace (patch 0003, measured curve).

Then start the real work: **C-01** is a 4–6 week vertical slice (API + PostgreSQL behind the existing `executeCommand` contract), not a bug fix.

### Calibration note

Severity here assumes **real operational data**. If this build is permanently a sales demo with synthetic fixtures, C-01/H-04 drop to informational and the remaining items are ordinary engineering debt. If anyone is tempted to load a real driver roster into it — even temporarily, even on one laptop — C-01 applies at full force, and Ghana's Data Protection Act 2012 (Act 843) obligations attach to that data from the first record.

---

## 2. Scope, access and what was actually audited

### Access

The repository is **public**; no credentials were required. It was read at commit `030197e` on `main` via a local clone, with repository metadata confirmed through the GitHub API (`gh api repos/iwani1/Richie-RTS-`).

### The critical scoping fact

**The repository contains no working tree.** Its four files are:

| File | Size | Nature |
|---|---|---|
| `Richie TMS demo 1.zip` | 1,009,439 B | 75-entry archive of the application, older snapshot |
| `Richie TMS demo 2.zip` | 1,020,065 B | 75-entry archive, newer snapshot (1,952 changed source lines) |
| `richie-tms-phase-prompts.md` | 12,704 B | build prompts |
| `richie-tms-standing-brief.md` | 33,868 B | standing brief |

Everything below was therefore run against an **unpacked copy of demo 2** (and, for secrets and diffing, demo 1). This is itself finding **H-04**: the published repository cannot be built, tested, scanned or reviewed as-is, and its CI configuration has never executed.

### In scope

- All 34 TypeScript/TSX source files and 14 test files (demo 2), plus their demo 1 counterparts for diffing.
- `docs/` (8 documents, ~16,300 words), `AGENTS.md`, and both root briefs.
- Build/lint/test configuration: `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `vite.config.ts`, `index.html`.
- `.github/workflows/ci.yml` (read from inside the archives).
- Git history, branches, tags, releases, Actions workflows, repository settings — via `git` and the GitHub API.

### Out of scope / not verifiable

| Item | Why |
|---|---|
| Branch protection on `main` | API returned `403 Resource not accessible by integration` for the token in use — **unverified**, not "absent" |
| Real browser runtime | No browser in this environment; behaviour exercised via jsdom tests and direct service-layer probes |
| Deployment, hosting, infrastructure-as-code | None exists (documented as `OPEN_QUESTIONS Q-01`) |
| Behaviour at production data volumes | Benchmarks use synthetic records |
| Legal sufficiency under Act 843 | Engineering view only; counsel required (the docs say the same) |

**Confidentiality:** no personal data was accessed; all fixtures are synthetic (`*@example.test`). Findings reproduce using local synthetic data only.

---

## 3. Method and toolchain

Everything was **executed, not inferred**. Where a claim in the documentation could be tested, I tested it; where it could not, I say so.

| Activity | Tool | Notes |
|---|---|---|
| Install + gates | `npm ci`, `tsc --noEmit`, `eslint .`, `vitest run`, `vite build` | node 22.22.3, npm 10.9.8 |
| Coverage | `@vitest/coverage-v8` 3.2.7 (added to the scratch copy only) | default and all-files bases |
| Complexity | ESLint `complexity: 10`, `max-depth: 4`, `max-lines-per-function: 120` | custom config, scratch copy |
| Dead code | `ts-prune` 0.10.3 + per-symbol reference greps | |
| Secrets | `detect-secrets` 1.5.0, custom regex sweep, history and both archives | gitleaks 8.30.1 binary could not be downloaded in this sandbox |
| Dependencies | `npm audit` (prod and full tree), npm registry `dist-tags`, lockfile licence aggregation | |
| Behavioural | A purpose-written probe harness (8 tests): [`probes/audit-probe.test.ts`](probes/audit-probe.test.ts) | permission sweep over 47 command types, PoCs, latency benchmark |
| Git/GitHub | `git log`, `gh api`, `gh release list` | |
| Patches | `git apply --check` against a pristine extract, then `npm run check` on the patched tree | all six apply cleanly; full gate suite passes |

Exact commands are in [`evidence/toolchain.txt`](evidence/toolchain.txt). Raw outputs are in [`evidence/`](evidence/).

**One tool failed honestly:** `eslint-plugin-security` 3.0.1 crashes against ESLint 10's AST on this codebase, so it contributed nothing; the security review is manual plus the behavioural probe harness. That is a limitation, not a clean bill of health from a SAST tool.

---

## 4. Findings

Severity: **Critical** = blocks any real-data use · **High** = exploitable or data-losing defect, or a blocker to review/governance · **Medium** = material weakness with a practical workaround · **Low** = hygiene, maintainability, defence-in-depth. `PB` marks a production blocker.

| ID | Sev | PB | Area | Finding | Patched |
|---|---|---|---|---|---|
| **C-01** | Critical | ✔ | Architecture | Entire security model runs in the user's browser | — (needs API) |
| **H-01** | High | | Auth | Password policy only in UI; any credential accepted by the service | 0001 |
| **H-02** | High | | Input validation | Backup import trusts arbitrary JSON; unknown role crashes the app | 0002 |
| **H-03** | High | | Reliability | Unbounded audit log + full-DB serialisation ⇒ quota failure, silent loss | 0003 |
| **H-04** | High | ✔ | Process | No source tree; CI never runs; no history, review, licence or release | templates |
| **M-01** | Medium | | Supply chain | 2 critical + 4 high dev-dependency advisories invisible to the CI gate | 0006 |
| **M-02** | Medium | | CI/CD | No coverage, SAST, licence or supply-chain gates; mutable action tags | 0004 |
| **M-03** | Medium | | Audit | Audit log not tamper-evident; exports unaudited and unpermissioned | 0003 (partial) |
| **M-04** | Medium | | Crypto | PBKDF2 120k < OWASP 600k while backups ship the hashes in plaintext | 0001 (partial) |
| **M-05** | Medium | | Auth | No throttling/lockout, no failed-sign-in audit, timing oracle | — |
| **M-06** | Medium | | Confidentiality | Internal build brief readable by external client contacts | — |
| **M-07** | Medium | | Testing | Users screen 3.1 % covered, Registers 6.0 % — the privilege-granting paths | — |
| **M-08** | Medium | | Input validation | No max lengths or numeric ceilings on stored text/money | — |
| **L-01** | Low | | Architecture | Type-only import cycle contradicts documented "no cycle" | — |
| **L-02** | Low | | Code quality | Dead exports (`PERMISSION_SCOPE`, `driverTripIds`, test-only `isOwnScoped`) | — |
| **L-03** | Low | | Privacy/web | Google Fonts call from a "no network" app; no CSP | 0005 |
| **L-04** | Low | | Maintainability | God-functions: complexity 151 / 122 / 103 / 74; 40 functions > 10 | — |
| **L-05** | Low | | Docs | Documentation drift: PII in audit summaries, "no cycle" claim | — |
| **L-06** | Low | | Governance | No LICENSE, README, SECURITY.md, owner, or version metadata | templates |
| **L-07** | Low | | Robustness | `Math.random` id fallback; unguarded role lookups | 0002 (partial) |
| **I-01** | Info | | Positive | Nine controls worth preserving through the rewrite | — |

Counts: **1 critical, 4 high, 8 medium, 7 low, 1 informational** (21).

Machine-readable: [`findings.json`](findings.json).

---

### C-01 · Critical — The entire security model runs in the user's browser

**Where** `src/tms/useTms.ts:35-70, 96-142` · `src/tms/scope.ts:1-14` · `docs/DATA_PROTECTION.md` §4

Every control the system has — authentication, the role matrix, own-record scope, the audit log — executes in the same JavaScript context as the attacker. The session is a bare user id in `sessionStorage`; the current role is read from `localStorage`; password hashes sit beside the records they protect.

Concretely, a user with devtools or a copy of a browser profile can:

1. read every vehicle, driver, passenger, rental and audit record, including pickup locations (which the docs correctly call sensitive location data);
2. read every password hash and salt, and crack them offline;
3. become an administrator by editing `users[i].role` in `localStorage`, or by writing any user id to `sessionStorage['richie-tms:session']` — no password required;
4. rewrite or delete the audit trail.

**Why it is not a code defect.** The authors state the limit plainly, and the module boundaries are shaped for the fix that matters: `executeCommand(db, actor, command, now)` is pure, synchronous and free of React. Moving it behind an HTTP endpoint plus PostgreSQL is a transport change, not a rewrite. `docs/ERD.md` already describes the target schema.

**Remediation**

1. Declare the current build a **prototype**: no real personal data, on any device, at any time. Put it in the README and keep the in-app "browser-local · no server" chip.
2. Build the API vertical slice (auth + users + one domain module) in 4–6 weeks: cookie session (`HttpOnly; Secure; SameSite=Lax`), server-side `authorise()` using the same `ROLE_PERMISSIONS` matrix, server-side `scopedView`, server-side audit insert in the same transaction.
3. Delete credentials from the browser entirely: the client never receives a hash, and the server never trusts a client-supplied role.
4. Keep the client dispatcher; swap its implementation for `fetch`, keeping the `CommandResult` contract so the UI and its 118 tests survive.

**Trade-off:** this is the most expensive item in the report by an order of magnitude. Doing it is the only way to carry real Act 843 data; not doing it means the product's security story ends at the demo.

---

### H-01 · High — Password policy is enforced only in the UI *(patched, 0001)*

**Where** `src/tms/service.ts:514-620` vs `src/tms/useTms.ts:117-120`

`PASSWORD_MIN_LENGTH` is checked in `createCredential()` — a React hook. The service layer takes `command.credential` and spreads it into the user record without inspecting it.

**Proof** (from `audit/audit-probe.test.ts`, run against the unmodified snapshot):

```
WEAK CREDENTIAL ACCEPTED: true
SIGN-IN WITH 1-CHAR PASSWORD: true
EMPTY CREDENTIAL ACCEPTED: true        # via reset_user_password
```

The empty-credential path is also a lockout bug: verification can never match an empty hash, so the account is bricked.

**Patch 0001** adds `validateCredential()` (64 hex / 32 hex), calls it from `setup_administrator`, `create_user` and `reset_user_password`, moves the length rule into `hashPassword()` — the only function that can mint a credential — raises PBKDF2 to 600,000 iterations, updates 12 test fixtures to realistic credential shapes and adds 4 regression tests. **Verified:** typecheck, lint, 118 existing tests and 4 new tests pass.

**Trade-off:** the plaintext password never reaches the service layer by design, so strict length/breach checks remain advisory in the browser. They belong at the future API boundary, where the server sees the password once.

---

### H-02 · High — Backup import trusts arbitrary JSON *(patched, 0002)*

**Where** `src/tms/types.ts:544-591` (`migrate`) · `src/tms/service.ts:990-1000` · `src/pages/Users.tsx:31` (`parsed as never`)

`migrate()` verifies a schema version, five arrays and that `settings` is an object; every record is then cast. Since `import_backup` replaces the entire database and backups are the documented way to move data between deployments, this is the one place untrusted data enters.

**Proof:**

```
IMPORT ACCEPTED POISONED ROLE: true     # user with role "superuser"
can() THREW: Cannot read properties of undefined (reading 'includes')
IMPORT OF INVALID SHAPES: true          # vehicles:[{id:null,registration:42}]
```

Effects: instant white screen (a `TypeError` inside a render path), persistent corruption, and a shared backup as a way to plant an administrator account.

**Patch 0002** adds `src/tms/backupGuard.ts`: per-record validation for the fields the app trusts (ids, roles against `ROLES`, credential shape, driver/client link invariants, duplicate detection), structural checks on settings, a 100,000-record ceiling, and a readable operator message instead of a crash. It also makes `can()` fail closed on unknown roles and guards the `ROLE_LABELS` lookup. **Verified:** all 118 existing tests (including four legacy-backup migration tests) still pass, plus 5 new regression tests.

---

### H-03 · High — The audit log grows until storage fails, then loses writes *(patched, 0003)*

**Where** `src/tms/service.ts:226-247` · `src/tms/useTms.ts:62-95`

Every command prepends an audit entry, and `commit()` re-serialises the whole database synchronously. Measured in the probe harness ([`evidence/benchmark.json`](evidence/benchmark.json)):

| Audit entries | Command | `JSON.stringify` | Snapshot |
|---|---|---|---|
| 1 | 0.01 ms | 0.01 ms | 1.5 kB |
| 1,000 | 0.07 ms | 0.63 ms | 232 kB |
| 5,000 | 0.23 ms | 3.97 ms | 1.16 MB |
| 20,000 | 0.92 ms | 15.05 ms | **4.65 MB** |
| 50,000 | 2.38 ms | 34.8 ms | 11.6 MB |

A typical origin quota is 5 MB, so a busy tenant reaches failure at roughly 20,000 audit entries — about a year of moderate use, months for heavy use. When it fails, `persist()` returns an error, `commit()` still advances React state, and a banner appears; the change survives until reload and then disappears. The entry that fails first is the audit record of the change itself.

**Patch 0003** caps the log at 5,000 entries and routes the overflow out through the audited export; it also adds `record_backup_export`, which checks `backup:export` and writes an audit entry before the file is produced, and moves `exportBackup` behind it. **Verified:** 130 tests green, 12 in the hardening suite.

**Trade-off:** capping loses old entries from the browser. That is the correct trade in a local store, but the durable answer is server-side append-only storage (or IndexedDB with indexes) — and a failed write should block further work with a modal, not a dismissible banner.

---

### H-04 · High (production blocker) — The repository is not a source repository

**Evidence**

- One commit, `030197e "Add files via upload"`, containing two binary ZIPs and two Markdown files; `git log --stat` shows both archives as `Bin`.
- `gh api …/actions/workflows` → `total_count: 0`. The `ci.yml` that the authors wrote carefully **cannot run**, because it lives inside the archives.
- No `.github/` at the root, no `.gitignore`, no `README`, no `LICENSE`, no `SECURITY.md`, no `CODEOWNERS`, no tags, no releases, no pull requests.
- Demo 1 → demo 2 differs by **1,952 source lines** with no history explaining any of it; an auditor cannot tell what changed or why.

**Why it matters beyond tidiness:** every automated control in this report depends on a buildable tree. Vulnerability scanning, dependency review, SARIF upload, provenance and reviewer diffing all become impossible. The project's own `AGENTS.md` requires the quality gates before every change; the repository structure prevents anyone from running them on a change.

**Remediation (about an hour)**

```bash
unzip -q "Richie TMS demo 2.zip" -d .          # source at the repo root
rm "Richie TMS demo 1.zip" "Richie TMS demo 2.zip"   # or move to releases/
cp audit/templates/.gitignore .
cp audit/templates/SECURITY.md .
gh repo edit --description "Richie Transport Services — transport management demo"
git add -A && git commit -m "chore: import demo 2 source tree"
gh workflow list                                # expect ci to appear
```

Then protect `main`: require a pull request, require the `ci` check, require linear history, disallow force-push. Add `README.md` and a `LICENSE` (or make the repository private — "all rights reserved" is the current default and is probably not what a demo intends).

---

### M-01 · Medium — Dev-dependency advisories the CI gate cannot see *(patched, 0006)*

`npm audit` on the full tree: **2 critical, 4 high, 1 moderate, 1 low**. Production dependencies: **0**. The CI step is `npm audit --omit=dev --audit-level=high`, so it is structurally incapable of noticing.

| Package | Installed | Severity | Notable advisory | Fixed in |
|---|---|---|---|---|
| vitest | 3.2.7 | critical | tinypool prototype-pollution gadget → RCE; `@vitest/mocker` path traversal, arbitrary file read, mock code injection | 5.0.5 |
| vite | 7.3.2 | high | 6 advisories incl. `server.fs.deny` bypass, cross-origin script execution via middleware | 7.3.7 |
| vite-plugin-singlefile | 2.3.0 | high | via `micromatch`/`braces` stack-exhaustion DoS | 2.3.4 |
| esbuild | — | low | dev-server arbitrary file read, Windows only | — |

**Patch 0006** upgrades all four. Verified end to end: `npm ci && npm run check` passes (typecheck, lint, coverage thresholds, build), 130 tests green, bundle unchanged at 568 kB, and the audit drops to **1 low** (the esbuild dev-server advisory).

**Trade-off:** vitest 5 is a major version. It reports coverage on an all-files basis, so the ratchet in patch 0004 sits at 70/62/66/74 rather than 80/72/70/80. Raise it as the untested screens gain tests.

---

### M-02 · Medium — CI/CD lacks the gates that matter *(patched, 0004)*

The existing workflow is better than most: pinned Node, `npm ci`, four gates in the project's own order, read-only token, `timeout-minutes`, and a genuinely honest header noting it had never been observed.

What it lacks — all added by patch 0004: coverage thresholds, a full-tree audit, `concurrency` cancellation, `persist-credentials: false`, artifact upload with retention, CodeQL (`security-and-quality`), dependency review with a GPL/AGPL/SSPL denylist, Dependabot with grouped updates, and an `engines` pin.

**Remaining follow-ups:** pin actions to commit SHAs (resolve them at merge time — I deliberately did not guess SHAs), add `npm ci --ignore-scripts` once confirmed safe, and fail the audit step rather than `continue-on-error` after the dependency upgrade lands.

---

### M-03 · Medium — The audit trail is neither tamper-evident nor complete *(partially patched, 0003)*

The audit page states "Append-only record of every change made through the service layer". In fact:

- entries are a plain array in `localStorage` — editable, deletable, with no hash chain or signature;
- **backup export bypasses the service layer entirely** (`useTms.exportBackup` serialises the database directly), so a full copy of all personal data and password hashes leaves the system with no permission check in the service and no audit entry;
- `import_backup` replaces the whole history;
- failed sign-ins and permission denials are not recorded.

Patch 0003 closes the export hole (permission + audit entry). The hash chain is the follow-up: `prevHash = sha256(canonical(previous entry))`, verified when the page loads, with the head hash exported alongside each backup — which is the cheapest way to make a local log evidentially useful.

### M-04 · Medium — PBKDF2 work factor vs plaintext hash distribution *(partially patched, 0001)*

120,000 iterations of PBKDF2-HMAC-SHA256 is roughly one-fifth of OWASP's 2023 recommendation (600,000). Two facts combine badly: the hashes are in `localStorage`, and the export writes them to an unencrypted `.json` file whose own success message warns that it "contains password hashes and personal data". Patch 0001 raises the cost to 600,000. Follow-ups: store the algorithm and cost with the hash (`pbkdf2-sha256$600000$salt$hash`) so it can be raised again without lockouts; encrypt backups with a passphrase-derived key (AES-GCM), or omit credentials from exports entirely.

### M-05 · Medium — No sign-in throttling, and a timing oracle

`signIn()` returns a generic message (good) but performs PBKDF2 **only when the account exists**, so response time distinguishes known from unknown accounts. Nothing limits attempts and no failure is recorded. In a single-browser demo the impact is small; it becomes a credential-stuffing enabler the moment an API exists. Fix: dummy derivation for unknown users, per-account attempt counter with backoff, `auth:sign_in_failed` audit action.

### M-06 · Medium — Internal brief exposed to external roles

`routes.ts` registers "Project brief" with `permission: null`, and the shell deliberately includes it for record-bound roles — so a **corporate client contact** (an external party) and a driver can read the internal build brief: mission, integrity rules, unknown business rules, phase prompts, and the authors' own note that there is no server. Gate it behind an administrator permission and drop it from production builds.

### M-07 · Medium — The privilege-granting screens are the least tested

| File | Statements | Note |
|---|---|---|
| `src/pages/Users.tsx` | **3.12 %** | lines 12–252 uncovered: create users, assign roles, link driver/client records, reset passwords |
| `src/pages/Registers.tsx` | **5.98 %** | client and driver registers |
| `src/docs/BriefDesk.tsx` | 27.9 % | acceptable (static content) |
| `src/tms/*` | 92.5 % | the domain core is genuinely well covered |

A regression in role assignment or account linking is precisely the class of bug that becomes a privilege-escalation incident, and CI would not see it. Add jsdom tests for these two screens; 1–2 days gets both above 80 %.

### M-08 · Medium — No length or magnitude limits

Validators check presence and format, never size: names, notes, purposes, reasons and incident descriptions are unbounded; quote quantities and amounts have no ceiling (`quantity > 0`, `amount >= 0` are the only rules). Combined with full-database serialisation (H-03) this is a cheap storage-exhaustion path; with a database it becomes a column-width and reporting-integrity problem. Bound every free-text field (200 chars for names, 1,000 for notes) and every number, and mirror the bounds with `maxLength` on inputs.

### Low-severity findings (details in `findings.json`)

- **L-01** `scope.ts` imports `type Actor` from `service.ts` while `service.ts` imports `confinedClientId` from `scope.ts` — a real (type-only, compile-time-erased) cycle that contradicts `ARCHITECTURE.md`'s "there is no cycle". Move `Actor`/`Credential` to `types.ts`.
- **L-02** Dead exports: `PERMISSION_SCOPE` (zero references, and it marks every permission "company" — contradicting the own-record comment above it), `driverTripIds` (zero references), `isOwnScoped` (tests only).
- **L-03** A "no network" app loads Google Fonts (IP + referer disclosure, offline degradation) and shipped **zero CSP** (confirmed absent from `dist/index.html`). Patch 0005 adds a CSP and `referrerpolicy="no-referrer"`; self-host the three families to actually honour the "no network" claim, then move to per-build script hashes at the host, which is the only place that can also send `frame-ancestors`.
- **L-04** Complexity: `execute()` **151** (465 lines), `executeBusing()` 122 (367), `executeLogistics()` 103 (324), `RentalDetail()` 74 (184); **40 source functions above 10**. Split each `execute*` into a `Record<CommandType, Handler>` with shared authorise/validate/audit middleware; add the complexity budget to ESLint so it ratchets down.
- **L-05** Documentation drift: `DATA_PROTECTION.md` §5 says audit summaries avoid personal names, but `service.ts:662/679/893` write the driver's full name and licence number. Either reference ids only, or amend the document.
- **L-06** No LICENSE, README, SECURITY.md, CODEOWNERS or version metadata; `package.json` still says `react-vite-tailwind@0.0.0`.
- **L-07** `makeId()` falls back to `Date.now()+Math.random` without `crypto.randomUUID`; `ROLE_LABELS[role]` throws on unknown roles (partially fixed by patch 0002).

---

## 5. Architecture review

### Structure (good)

The dependency shape is disciplined for a prototype:

```
pages/*  →  useTms (React state, dispatch, persistence)  →  commands.ts (router)
                                                              ├─ service.ts   (core commands)
                                                              ├─ busing.ts    (staff busing)
                                                              ├─ logistics.ts (incidents, work orders)
                                                              ├─ compliance.ts(documents)
                                                              └─ maintenance.ts(odometer, readiness)
core modules import types/permissions/scope only — no React, no DOM
```

Measured fan-in: `types.ts` 39, `service.ts` 26, `useTms.ts` 16, `commands.ts` 12. Only `useTms.ts` imports React from the `tms/` core. The rule "UI never calls `execute*` directly" is enforced mechanically by `no-restricted-imports` — this is the kind of guardrail most teams only talk about.

### Weak points

1. **One dispatcher file per domain is a god-object.** `service.ts` is 978 lines with a 465-line `execute()`. The router pattern is right; the granularity is not. Handler maps fix this without changing behaviour — and the 118 tests make it safe.
2. **A real (if erased) cycle** between `service.ts` and `scope.ts` (L-01).
3. **`migrate()` is a schema-shaped cast,** not validation — the root cause of H-02. Import is the only path where untrusted data enters, and it was the least validated.
4. **Persistence is a single synchronous `JSON.stringify`** of the whole database on every write. That is fine at demo scale and structurally wrong at any other scale (H-03). The seam is clean (`commit()` is the only write site, D-29), which makes replacing it with IndexedDB or an API straightforward.
5. **Reads are not scoped uniformly.** The portals correctly read through `scopedView`, but `DriverPortal` resolves route and vehicle names from the full `db.routes`/`db.vehicles` tables. Harmless today (the ids come from own trips) and easy to tighten.

### Performance hotspots (measured, not guessed)

| Path | Result | Verdict |
|---|---|---|
| Write: command execution | 0.01 → 2.4 ms as the DB grows to 11.6 MB | acceptable |
| Write: full-DB serialisation | **0.01 → 34.8 ms**, dominated by the audit log | the real hotspot (H-03) |
| Read: `scopedView` for a driver over 20,000 trips | **0.008 ms per render** | not a hotspot — the own-record filter is fine |
| Initial load: parse + `migrate()` of a 4.6 MB snapshot | not measured separately; follows the same curve | will hurt once H-03's cap is lifted by IndexedDB |

The honest conclusion: the interesting performance problem is not the domain logic (which is fast and linear), it is the choice to rewrite the entire database into synchronous browser storage on every keystroke-level command.

### Scalability path

`localStorage` → IndexedDB (append-only log + indexes) → HTTP API + PostgreSQL with the `btree_gist` exclusion constraints already specified in `docs/ERD.md`. Because `executeCommand(db, actor, command, now)` is pure and the clock is injected, each step keeps the tests.

---

## 6. Tests and CI

### What is good

- **118 tests, 14 files**, covering the command layer and eight jsdom end-to-end flows (busing dispatch → completion → on-time KPI; rentals quote → confirm → assign → start → complete; breakdown → work order → cost; compliance expiry; fleet readiness).
- **Deterministic by construction:** `now` is injected into every command, so no clock flakiness.
- **No flakiness observed:** three consecutive runs, two of them with `--sequence.shuffle`, all 118 green. Slowest test 2.4 s; whole suite ~29 s.
- Zero `@ts-ignore`, zero `TODO`/`FIXME`, zero `console` calls, three deliberate `eslint-disable` comments, all with a stated reason.

### Gaps

| Gap | Evidence | Fix |
|---|---|---|
| Admin user-management UI untested | `Users.tsx` 3.12 % | jsdom tests for roles, linking, reset, backup paths (M-07) |
| Registers untested | `Registers.tsx` 5.98 % | same |
| Branch coverage 75 % overall, 67 % in `service.ts` | `evidence/coverage-before.json` | add negative-path tests for `execute()` branches |
| No coverage gate in CI | `ci.yml` | patch 0004 |
| No SAST/DAST anywhere | no workflows at root | patch 0004 (CodeQL) |
| No security-focused negative tests | only `scope.test.ts` probes permissions | the probe harness in this audit is a starting point: unauthenticated sweep, role sweep, malformed import |
| Build reproducibility | no `engines`, no `packageManager`, no `.nvmrc`; CI Node 20 vs audit Node 22 | patch 0004 pins `engines`; add `.nvmrc`/`packageManager` |

### Verification of the patches

Applied in order to a pristine extract of demo 2 (`git apply --check` clean for all six), then:

```
npm ci && npm run check
  typecheck  ✔
  lint       ✔
  coverage   ✔ 72.16 % statements (threshold 70)
  build      ✔ 572 kB single file
  tests      ✔ 130 passed (118 original + 12 regression)
npm audit               → 1 low (was 2 critical / 4 high)
```

---

## 7. Dependencies, licences and supply chain

**Production dependencies (5, all MIT, 0 vulnerabilities):** `react@19.2.6`, `react-dom@19.2.6`, `scheduler@0.27.0`, `clsx@2.1.1`, `tailwind-merge@3.4.0`.

**Freshness** (registry `dist-tags` at audit time): `react` 19.3.1 (installed 19.2.6), `tailwind-merge` 3.7.0 (3.4.0), `vite` 8.3.5 (7.3.2), `vitest` 5.0.5 (3.2.7), `typescript` 7.0.2 (5.9.3), `eslint` 10.13.0 (current). Production majors are one minor behind; the build toolchain is one to two majors behind, which is where the advisories live. TypeScript 7 is a major migration — schedule it, do not rush it.

**Supply chain**
- `npm ci` against a committed lockfile: good, reproducible installs.
- Caret ranges in `devDependencies` are pinned by the lockfile, so this is fine in CI and slightly loose for local `npm install`; consider exact versions for the toolchain.
- No `ignore-scripts` policy (most advisories here are in packages that would run on a compromised release).
- Actions referenced by mutable tag — pin to SHAs (M-02).
- No dependency automation: patch 0004 adds Dependabot with grouped updates and a dependency-review gate.

**Licences** — 410 packages, no copyleft:

| Licence | Count | Notes |
|---|---|---|
| MIT | 335 | includes all five production dependencies |
| ISC | 22 | |
| Apache-2.0 | 19 | |
| MPL-2.0 | 12 | file-level copyleft, dev tooling only — acceptable, keep out of shipped code |
| BSD-2 / BSD-3 | 8 / 7 | |
| BlueOak-1.0.0 | 5 | permissive; dev tooling (jackspeak, minimatch, minipass, path-scurry) |
| MIT-0, CC-BY-4.0 | 1 each | dev data |
| **GPL / AGPL / SSPL** | **0** | clean |

**The project's own licence is missing.** With no `LICENSE`, the public repository is "all rights reserved" by default — likely unintended for a demo meant to be shared. Decide: add a licence or make the repository private (L-06).

---

## 8. Data protection (engineering view, not legal advice)

The project's own `DATA_PROTECTION.md` is unusually honest — it lists plaintext storage, unencrypted backups, no retention, no read-audit and no DSAR workflow. I agree with all of it and add three specifics:

1. **Sensitive location data.** Pickup stops effectively reveal where employees live; the document says so. Under any deployment, treat the passenger table as the highest-sensitivity dataset in the system, and note that the client portal already minimises correctly (name + stop only).
2. **The audit log is a personal-data store.** It holds actor names, emails, driver names and (currently) licence numbers, and it is readable by administrators, operations **and finance**. Finance's need is cost attribution; the licence number in a summary is not required for that (L-05).
3. **Backups are the weakest link.** Unencrypted JSON, containing password hashes and every personal record, downloaded by an administrator to a laptop. Encrypt them or strip credentials; log every export (patch 0003 does the latter).

Act 843 items to confirm with counsel before any live use: controller registration, lawful basis for employee/passenger data, notice wording, retention periods, and cross-border transfer if hosting is outside Ghana. The in-repo document already frames these as open questions (Q-18, Q-32); nothing in this audit resolves them.

---

## 9. Remediation plan

### Day 0 — before showing this to anyone outside the team (~1 day)

| # | Action | Finding | Effort |
|---|---|---|---|
| 1 | Unpack demo 2 to the repo root; make CI run; protect `main`; add README/LICENSE/SECURITY.md/.gitignore | H-04, L-06 | 1–2 h |
| 2 | Apply patches 0001–0006; `npm run check` green | H-01, H-02, H-03, M-01, M-02, M-03, L-03 | 1 h |
| 3 | Hide "Project brief" from non-administrators | M-06 | 1 h |
| 4 | State in the README: prototype, browser-local, no real personal data | C-01 | 15 min |

### Weeks 1–2 — harden the prototype (~5 days)

- Tests for `Users.tsx` and `Registers.tsx` (M-07), 1–2 d
- Sign-in throttling, dummy derivation, failure auditing (M-05), 0.5 d
- Field length and numeric ceilings (M-08), 0.5 d
- Hash-chain the audit log and verify it on load (M-03), 1–2 d
- Broken imports cycle, dead exports, complexity budget, doc drift (L-01/L-02/L-04/L-05), 1–2 d
- Self-host fonts and add per-build CSP hashes (L-03), 0.5 d

### Weeks 2–6 — the real fix (C-01)

A vertical slice, not a rewrite: `POST /commands` + PostgreSQL + cookie sessions, with the existing `executeCommand` contract behind it, one domain module at a time, keeping the UI and its tests.

Exit criteria: no personal data or credential material in the browser; permission matrix and own-record scope enforced where the caller cannot rewrite them; audit written in the same transaction as the change; backups encrypted; retention job running; deployment, monitoring and restore drill documented.

### What I would *not* do

- **Do not rewrite the domain layer.** It is the strongest part of this codebase: pure, tested, well-typed, with correct state machines. Port it.
- **Do not add a UI framework or state library.** `useTms` + a dispatcher is adequate and comprehensible.
- **Do not chase TypeScript 7 or Vite 8 now.** Security-relevant upgrades are done by patch 0006; the rest can wait for a scheduled window.
- **Do not try to "secure" `localStorage`** with obfuscation or client-side encryption keyed by a value in the same browser. That converts an honest limitation into a misleading claim.

---

## 10. Example patches

All six patches are in [`patches/`](patches/), generated as git-format patches against the demo 2 source tree, and **verified** by applying them in order to a pristine extract and running the full gate suite.

| Patch | Files | Adds | Tests |
|---|---|---|---|
| `0001-fix-security-enforce-credential-policy…` | `crypto.ts`, `service.ts`, 12 test fixtures | credential shape validation at the boundary, length rule inside `hashPassword()`, PBKDF2 600k | +4 |
| `0002-fix-security-validate-imported-backups…` | new `backupGuard.ts`, `service.ts`, `permissions.ts`, `App.tsx` | per-record import validation, fail-closed `can()`, safe role label | +5 |
| `0003-fix-audit-cap-the-audit-log…` | `service.ts`, `useTms.ts`, `Users.tsx` | `AUDIT_LIMIT`, audited + permissioned export | +3 |
| `0004-ci-cover-the-full-dependency-tree…` | `ci.yml`, `codeql.yml`, `dependency-review.yml`, `dependabot.yml`, `vitest.config.ts`, `package.json` | coverage ratchet, full audit, SAST, licence policy, Dependabot, artifact retention | — |
| `0005-fix-web-add-a-Content-Security-Policy…` | `index.html` | CSP, `referrerpolicy` on the font link | — |
| `0006-chore-deps-upgrade-vite-singlefile-and-vitest…` | `package.json`, lockfile | vite 7.3.7, singlefile 2.3.4, vitest 5.0.5 | — |

Apply with:

```bash
cd <repo-with-source-at-root>
git apply --check audit/patches/*.patch && git apply audit/patches/*.patch
npm ci && npm run check
```

Example — the core of patch 0001, which is the smallest complete illustration of the design principle behind several findings ("enforce at the boundary, not in the caller"):

```ts
// src/tms/service.ts
const CREDENTIAL_HASH_RE = /^[0-9a-f]{64}$/;
const CREDENTIAL_SALT_RE = /^[0-9a-f]{32}$/;

export function validateCredential(credential: Credential | null | undefined): Errors {
  const errors: Errors = {};
  const hash = credential?.passwordHash;
  const salt = credential?.passwordSalt;
  if (typeof hash !== "string" || !CREDENTIAL_HASH_RE.test(hash)) {
    errors.password = "The password must be set through the app so it is hashed before it reaches the service layer.";
  } else if (typeof salt !== "string" || !CREDENTIAL_SALT_RE.test(salt)) {
    errors.password = "The password salt is missing or malformed.";
  }
  return errors;
}
```

```ts
// src/tms/crypto.ts — the only function that can mint a credential enforces the policy
export async function hashPassword(password: string): Promise<Credential> {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  ...
}
```

---

## 11. Residual risk and trade-offs

| Decision | Residual risk | Rationale |
|---|---|---|
| Ship the demo as-is for now, patched | **High** — a determined user can read and edit everything (C-01) | Acceptable only while data is synthetic; the README must say so |
| Cap the audit log at 5,000 in-browser entries | Old entries leave the device; history is not continuous | Better than silent write failure; the API solves it properly |
| Enforce credential *shape* locally, not password strength | A caller inside the app could still hash a weak password | The plaintext never crosses the service boundary by design; strength checks belong at the API |
| Vendor nothing, self-host nothing yet (fonts) | Third-party request remains until fonts are self-hosted | Patch removes the referer and adds CSP; self-hosting is a 1-hour follow-up |
| Keep `localStorage` until the API exists | Quota and last-write-wins across tabs remain | Replacing it is half the API work; a second storage layer would be waste |
| Not touching the domain logic | None | It is the strongest asset; the tests give confidence to port it |

**What would change my assessment upward:** a decision to load real data into this build. That converts C-01 from "documented prototype limitation" into an immediate Act 843 exposure, and H-04/M-06 from hygiene into governance failures.

**What would change it downward:** making the repository private and explicitly demo-only, which removes the licence ambiguity and much of the external-role exposure.

---

## 12. Appendices

### A. Evidence index

| File | Contents |
|---|---|
| [`findings.json`](findings.json) | machine-readable: target metadata, scope, toolchain, metrics, scorecard, 21 findings, remediation plan, unverified list |
| [`evidence/toolchain.txt`](evidence/toolchain.txt) | exact commands and versions |
| [`evidence/npm-audit-before.json`](evidence/npm-audit-before.json) / [`…after.json`](evidence/npm-audit-after.json) | full-tree advisory detail before/after patches |
| [`evidence/coverage-before.json`](evidence/coverage-before.json) | per-file statement/branch/function/line coverage |
| [`evidence/complexity-all.json`](evidence/complexity-all.json), [`…top.json`](evidence/complexity-top.json) | every complexity/size violation, and the top 12 by cyclomatic complexity |
| [`evidence/benchmark.json`](evidence/benchmark.json) | write-latency and scoped-view measurements |
| [`evidence/test-runs.json`](evidence/test-runs.json) | three full-suite runs, including shuffled order |
| [`evidence/secret-scan.json`](evidence/secret-scan.json) | scanner results and false-positive triage |
| [`patches/`](patches/) | six verified patches |

### B. Files reviewed

`AGENTS.md`; `docs/{ARCHITECTURE,DATA_PROTECTION,DECISIONS,ERD,KPIS,OPEN_QUESTIONS,PERMISSIONS,PROGRESS,STATE_MACHINES}.md`; `index.html`; `package.json`; `package-lock.json`; `tsconfig.json`; `eslint.config.js`; `vite.config.ts`; `.github/workflows/ci.yml`; all 34 files under `src/` (including all 14 test files, read in full for the modules under test and at least by interface for the rest).

### C. Generated code and dependencies (notes for reviewers)

The probe harness used for the behavioural tests is reproduced at [`probes/audit-probe.test.ts`](probes/audit-probe.test.ts). It expects to live in a directory one level below the project root (the imports resolve `../../src/…`) and to be excluded from the project's own test glob; it is reference material, not a change to the product. The ESLint complexity config and the coverage provider were also audit-only. The patches in `patches/` are the only intended changes to the project.

### D. Audit limitations

- No dynamic testing in a real browser; no DAST.
- `gitleaks` unavailable (download blocked); detection-secrets + regex used instead.
- `eslint-plugin-security` incompatible with ESLint 10 on this tree; security findings are manual plus behavioural.
- Branch protection could not be read (403); reported as unverified, not absent.
- Two snapshots only, no history, so I cannot attribute changes or detect removed code.
- This is an engineering assessment. It is not a penetration test, and it is not legal advice.

---

*Prepared 2026-10-23. Reproduce with the commands in `evidence/toolchain.txt`.*
