# Patches

Six git-format patches against the `Richie TMS demo 2.zip` source tree. They apply in
numerical order to a tree whose root is the contents of that archive.

Verified: `git apply --check` clean for 0001–0005, and `npm ci && npm run check` passes on the
patched tree (typecheck, lint, coverage thresholds, build) with **130 tests green** (118 original
+ 12 regression tests added by the patches).

**Applied in this repository** (Phase 12, see `CHANGELOG.md`): 0001–0005 were applied verbatim.
0006 (the dependency upgrade) was **not** applied from the patch: it was generated in a scratch
tree that also contained audit-only packages (`@vitest/coverage-v8`, `eslint-plugin-security`),
so its `package.json` context did not match this repository. The upgrade was instead performed
directly (`npm install -D --save-exact vite@7.3.7 vite-plugin-singlefile@2.3.4 vitest@5.0.5
@vitest/coverage-v8@5.0.5`) with the same result: 0 critical, 0 high, 1 low advisory.
All patches were also sanitised to remove a stray `node_modules` symlink that leaked in from the
scratch tree.

| Patch | Fixes | Effect |
|---|---|---|
| 0001 | H-01, part of M-04 | credential shape enforced at the service boundary; password length enforced inside `hashPassword()`; PBKDF2 120k → 600k; 12 test fixtures made realistic |
| 0002 | H-02, part of L-07 | new `backupGuard.ts` validates every record before an import is trusted; `can()` fails closed; `ROLE_LABELS` lookup guarded |
| 0003 | H-03, part of M-03 | audit log capped at 5,000 entries; backup export is permissioned and audited (`record_backup_export`) |
| 0004 | M-02 | CI: coverage ratchet, full-tree audit, CodeQL, dependency review with licence denylist, Dependabot, concurrency, artifact retention, `engines` |
| 0005 | L-03 | Content-Security-Policy for the single-file build; `referrerpolicy` on the font link |
| 0006 | M-01 | vite 7.3.7, vite-plugin-singlefile 2.3.4, vitest 5.0.5 — clears all critical/high advisories |

## Apply

```bash
cd <repo with the source at its root>
git apply --check audit/patches/*.patch
git apply audit/patches/*.patch
npm ci && npm run check
```

If you would rather review than apply: `git am audit/patches/*.patch` keeps the commit
messages, which explain the reasoning for each change.

## What these patches do not do

They do not address **C-01** (the browser is the trust boundary). That needs an API and a
database; see §9 of the audit report.

They also do not pin GitHub Actions to commit SHAs — resolve the SHAs at merge time rather
than trusting a recorded one.
