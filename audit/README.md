# Audit pack — Richie Transport Services TMS

Independent security and code-quality review of
`https://github.com/iwani1/Richie-RTS-` at commit `030197e5c80eb7e09adef734f6398cc811e37242`
(branch `main`), carried out 2026-10-23.

## Start here

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
