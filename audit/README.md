# Audit pack — Richie Transport Services TMS

## Current review — 2026-10-24, commit `08d7177`

**[`AUDIT-2026-10-24.md`](AUDIT-2026-10-24.md)** reviews the running system: server, PostgreSQL,
sealed sessions, 17 findings, all reproduced against the production build.
Machine-readable: [`findings-2026-10-24.json`](findings-2026-10-24.json).

Headline: the write path is strong and the read path is not. A driver account receives the entire
database (F-01), and the sign-in throttle can be switched off with a request header (F-02).

| If you are… | Read |
|---|---|
| deciding what to fix first | `AUDIT-2026-10-24.md` §3 (table) and §7 (plan) |
| a security reviewer | `AUDIT-2026-10-24.md` §4 — the two high findings, with reproductions |
| checking a claim | `AUDIT-2026-10-24.md` §6 — every measurement as a command |

---

## Historical review — 2026-10-23, commit `030197e` (superseded)

Everything below reviews the **browser-local prototype**, before the server existed. It is kept
because the reasoning about governance and governance gaps still applies; its description of the
architecture does not. Do not read `AUDIT-REPORT.md` as a description of the current build.

| If you are… | Read |
|---|---|
| an engineering lead | [`AUDIT-REPORT.md`](AUDIT-REPORT.md) §1, §4 (findings table), §9 (plan) |
| a security reviewer | `AUDIT-REPORT.md` §4 in full, then [`findings.json`](findings.json) |
| comparing the two demos | [`DEMO-COMPARISON.md`](DEMO-COMPARISON.md) — feature-by-feature against the briefs |
| implementing fixes | [`patches/`](patches/) — six verified patches, apply in order |
| setting up the repository properly | [`templates/`](templates/) — `.gitignore`, `SECURITY.md`, README snippet |
| checking my work | [`evidence/toolchain.txt`](evidence/toolchain.txt) — every command used |

## In one paragraph

The application code is well built — pure command layer, 118 deterministic tests, 82 % statement
coverage, no XSS sinks, no secrets, permissive licences, clean production dependencies. Its
security model, however, is entirely client-side: data, credentials and authorisation live in
the user's browser, so it is a prototype and must never hold real personal data (finding C-01).
Six concrete defects or governance gaps are fixable now and patched here; the rest need an API.

## Contents

```
audit/
├── AUDIT-REPORT.md      main deliverable: summary, findings, architecture, tests, plan, patches
├── DEMO-COMPARISON.md   demo 1 vs demo 2 measured against the standing brief and phase prompts
├── findings.json        machine-readable: target, metrics, scorecard, 21 findings, plan
├── README.md            this file
├── patches/             6 verified patches + apply instructions
├── templates/           .gitignore, SECURITY.md, README snippet for the repo root
└── evidence/            raw tool output: audit, coverage, complexity, benchmarks, secrets, runs
```

## Reproducing

Everything ran against an unpacked copy of `Richie TMS demo 2.zip`, because the repository
itself contains no source tree (finding H-04). Commands are listed verbatim in
`evidence/toolchain.txt`; the toolchain was node 22.22.3, npm 10.9.8, vitest 3.2.7,
ESLint 10.13.0, detect-secrets 1.5.0.

## Scope and limits

No live system existed to test, so this is source, history, CI, dependency and documentation
review plus direct execution of the service layer through a purpose-built probe harness — not a
penetration test. Branch protection settings could not be read with the available token and are
recorded as unverified. Nothing here is legal advice on Ghana's Data Protection Act 2012.

## Probes

`probes/audit-probe.test.ts` is the harness behind the behavioural claims in the report
(permission sweep, credential and backup PoCs, latency benchmark). Drop it one level below the
project root, exclude it from the project's test glob, and run it with `npx vitest run` to
reproduce. It is reference material, not a change to the product.

## Remediation status (updated 2026-10-23, Phase 12)

| Finding | Status |
|---|---|
| H-01 credential policy | **Fixed** in the repository (commit `87d1688`), 4 regression tests |
| H-02 untrusted backup import | **Fixed** (`fc07073`), 5 regression tests |
| H-03 audit log growth / lost writes | **Fixed** (`126ad32`), 3 regression tests |
| M-01 dev-dependency advisories | **Fixed** (`363f45d`): 2 critical + 4 high → 0 |
| M-02 CI gaps | **Fixed** (`363f45d`); CI still unobserved on GitHub's runner |
| M-03 audit tamper-evidence | **Partially fixed**: exports are permissioned and audited; hash chaining remains open |
| H-04 repository layout | **Fixed** (`f46c984`): source at root, CI live, README/SECURITY/.gitignore added |
| L-03 CSP / referer leak | **Fixed** (`532f861`); self-hosting the fonts remains open |
| C-01 browser trust boundary | **Open** — needs the API + PostgreSQL rebuild (§9); cannot be fixed in the client |
| M-04 … M-08, L-01, L-02, L-04…L-07 | Open; see `findings.json` for effort |

