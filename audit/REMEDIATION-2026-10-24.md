# Remediation — all sixteen defects from the 2026-10-24 audit

Follow-up to [`AUDIT-2026-10-24.md`](AUDIT-2026-10-24.md). Every finding is addressed below, with
what changed, how it was verified, and the one item that is deliberately only documented.

Gates after the work: typecheck **0 errors** · eslint **0 errors, 0 warnings** ·
**203 tests passed / 5 skipped** (up from 177) · line coverage **80.8 %** (up from 77.08 %) ·
production build **✓**.

| id | state | verified by |
|---|---|---|
| F-01 read scoping | **fixed** | driver snapshot 795 770 → **1 740 bytes** |
| F-02 throttle bypass | **fixed** | 9 attempts with rotating `X-Forwarded-For` → `429` on the 9th |
| F-03 unvalidated payloads | **fixed** | malformed `create_user` → `400`, not `500` |
| F-04 silent production 500s | **fixed** | one log line per failure, in every environment |
| F-05 snapshot size | **reduced + documented** | admin snapshot 792 kB → 492 kB; the rest is D-56 |
| F-06 no CI runs | **fixed** | CI now triggers on every branch |
| F-07 scaffold screen | **deleted** | route, nav item, icon and 512 lines of `BriefDesk` |
| F-08 no Origin check | **fixed** | cross-site `POST` → `403`; same-origin → `200` |
| F-09 reset leaves sessions | **fixed** | old cookie dead after reset; old password `401`, new `200` |
| F-10 HSTS absent | **fixed, opt-in** | `Strict-Transport-Security` present with `HTTPS=1` |
| F-11 CSP too loose | **fixed** | Google font origins gone from the served policy |
| F-12 plain-HTTP lockout | **documented** | `SETUP_AND_DEPLOYMENT.md` §7 |
| F-13 dialog semantics | **fixed** | focus trap, Escape, focus restore — 4 tests |
| F-14 documentation drift | **fixed** | seven claims corrected |
| F-15 coverage gaps | **fixed** | 26 new tests, including the first route-handler and Users tests |
| F-16 app owns the schema | **documented** | two-role SQL in `SETUP_AND_DEPLOYMENT.md` §10 |
| F-17 health over-shares | **fixed** | production reports `"reachable"` |

---

## F-01 · Read scope is now applied on the server

`src/server/visibility.ts` narrows the database to the actor before it leaves the process, reusing
`scopedView()` from `src/tms/scope.ts` — the same rules the portals already applied to a payload
they should never have received. `scopeDatabase()` is used by **all four** places that return data:
`GET /api/session`, `POST /api/commands`, `POST /api/auth/login` and `POST /api/setup`.

- Internal roles keep company-wide reads.
- A driver gets their own user row, their driver record, their trips, the vehicles those trips used,
  and the odometer readings for those vehicles.
- A client contact gets their own client, its routes, its roster and its rental requests.
- A record-bound account with no linked record gets its own row and nothing else — it does not fall
  back to company-wide access.
- Credentials are stripped last, after every branch, so no path can reintroduce a hash.
- The audit log is not sent to record-bound roles: its summaries name records that are not theirs.

**Measured**, same database, same seeded 1 500 trips:

```
driver  GET /api/session   795 770 bytes → 1 740 bytes   (clients 2→0, trips 1500→0, audit 2012→0)
admin   GET /api/session   791 877 bytes → 492 440 bytes (audit 2012 → 500)
```

A `visibility.test.ts` asserts the payload shape per role — including that an unlinked driver sees no
trips and that no role ever receives a password hash.

## F-02 · The throttle keys on the account, and trusts a proxy only when told to

`clientKey()` returns `"local"` unless `TRUST_PROXY=1`; with a proxy it takes the **right-most**
`X-Forwarded-For` hop, which is the one the proxy appended. Sign-in then checks two buckets — the
account (unforgeable) and the address (when one exists) — and counts **failures**, not arrivals, so
a mistyped first run cannot lock the installation.

```
9 attempts, rotating X-Forwarded-For → 401 ×8, 429 on the 9th
another account while one is throttled → 200
correct password for the throttled account → 429 until the window closes
```

The trade is stated: an attacker who knows an email can deny that account for fifteen minutes. That
is preferred to unlimited guessing, and the window is short.

## F-03 · A malformed body is a 400 that names the field

`runCommand` now separates three kinds of failure: a configuration error (503), a request whose
shape the command cannot read (`400`), and a database refusal (mapped as before). A `TypeError`
whose property names a request field says which one; a language member (`trim`, `map`) does not,
because it tells the caller nothing.

```
POST /api/commands {"type":"create_user","input":{}} → 400 "The request was missing a value the change needs…"
```

## F-04 · Failures are logged in production too

`logFailure()` writes one line — command type, error class, PostgreSQL code and constraint, never the
payload or its values — in every environment. That is the difference between "the server log has the
detail" and the log actually having it.

## F-05 · Smaller payloads, and an honest statement of the ceiling

- Scoping (F-01) removes almost everything from a record-bound payload.
- The snapshot carries the newest **500** audit rows instead of 5 000 (the audit screen renders 500),
  with the true count in `auditTotal` so the screen can still say how many exist. `useTms` carries
  it; the Audit screen uses it for both counts.
- Measured: admin 791 877 → 492 440 bytes; driver 795 770 → 1 740 bytes.

The remaining ceiling is structural: the API is snapshot-shaped, so an administrator still receives
the whole working set (≈400 kB at 1 500 trips, plus the audit window). Paging per screen is the next
change and is recorded in `docs/PROGRESS.md` and §12 of the setup guide rather than pretended away.

## F-06 · CI runs on every branch

`ci.yml` triggered only on `push` to `main` and on pull requests, and every commit in this project has
been pushed to a branch with no pull request — so no workflow had ever executed. The trigger is now
`push` (all branches) and `pull_request`.

## F-07 · The scaffold screen is gone

`src/docs/BriefDesk.tsx` (512 lines, 8 % covered), its route, its nav group, its icon and its
`localStorage` key are deleted. That was the last browser-persistence in the application, and the
last class names in the tree that the Daylight stylesheet does not define.

## F-08 · An Origin check on every state-changing request

`sameOrigin()` accepts a request whose `Origin` is any address the request arrived on — the URL's
origin, the `Host` header over either scheme, an `x-forwarded-proto` when present, and
`PUBLIC_ORIGIN` for a rewriting proxy. A request with no `Origin` is accepted: that is a script, and
it has no cookie to ride on.

```
POST /api/commands  Origin: https://evil.example  → 403 "Cross-site requests are not accepted."
POST /api/commands  Origin: http://127.0.0.1:3000 → 200
```

## F-09 · A reset ends existing sessions

The cookie carries a truncated SHA-256 of the account's Argon2 hash (`credentialTag`). Every request
that resolves an actor compares it with the stored hash; the hash changes on reset, so the old cookie
stops matching. Cookies minted before the field existed are treated as ended.

```
driver signed in → admin resets password → same cookie: user null, database null
                    old password 401, new password 200
```

## F-10, F-11 · Headers

- `Strict-Transport-Security: max-age=31536000; includeSubDomains` is sent only when `HTTPS=1`
  (verified by building with it and reading the response). It stays off by default, because a
  workstation that also answers on a LAN address would lock itself out.
- `style-src` and `font-src` no longer allow Google: fonts are self-hosted. Verified in the served
  policy.

## F-12 · The plain-HTTP trap is written down

§7 of the setup guide now says why a `Secure` cookie cannot be stored over `http://` from another
machine, and gives the two honest options — TLS in front, or a development-posture installation on a
trusted network.

## F-13 · The panel behaves like a dialog

`Panel` focuses its first control on open, traps Tab and Shift-Tab, closes on Escape, restores focus
to the trigger, and no longer makes the scrim a second invisible "Close" in the tab order. Four
tests cover the behaviour.

## F-14 · Documentation corrected

README (Compose removed, test count made non-numeric, Zod claim narrowed), `PROGRESS.md` (Compose),
`rateLimit.ts` (cited a document that does not exist), `scope.ts` (said "this build has no server"),
`Users.tsx` ("in this browser-local build"), `ARCHITECTURE.md` (redacted → scoped). New decisions
D-56…D-59 record the four design choices above.

## F-15 · Tests where the findings were

26 new tests: `visibility.test.ts` (6, the per-role payload), `api.test.ts` (8, client key and origin),
`login/route.test.ts` (2, the first route-handler tests in the project), `Users.test.tsx` (4, the
first for that screen), `primitives.test.tsx` (+4, the dialog), `rateLimit.test.ts` (+2). Line
coverage 77.08 % → 80.8 %.

## F-16 · Schema ownership — documented

A two-role SQL snippet in §10 of the setup guide (owner migrates, app reads and writes) with the
trade stated: for one workstation it costs more than it protects; for a shared server it is the
difference between the append-only trigger being a guarantee and being a convention.

## F-17 · Health says less in production

`{"database":"reachable"}` instead of the PostgreSQL build string and extension list. The detail
remains outside production, where the operator running `curl` is the only audience.
