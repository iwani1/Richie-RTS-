# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's private reporting:
**Security → Advisories → Report a vulnerability** on this repository
(`https://github.com/iwani1/Richie-RTS-/security/advisories/new`).

Include what you found, where (file, screen or command), how to reproduce it, and the impact
you believe it has. You will get an acknowledgement within 3 working days and a fix plan
within 10.

## Scope

This repository is now a **server-side application**: Next.js serves it, PostgreSQL stores the
records, and permissions, audit logging and the double-booking rule are enforced on the server
(see `docs/ARCHITECTURE.md`, "Request flow for a write"). The browser holds a redacted snapshot
and a sealed session cookie — never a credential.

In scope:

- authentication, session and cookie handling (`src/server/session.ts`, `src/app/api/auth/*`);
- permission or ownership bypasses in `src/tms/*` or at the API boundary;
- SQL injection or a repository write that escapes the transaction;
- cross-site scripting or injection in the interface;
- data loss or corruption from backup, restore, export or migration;
- credential handling: hashing (Argon2id), storage, redaction, throttling.

Out of scope for this stage (documented limits, not vulnerabilities — see
`docs/SETUP_AND_DEPLOYMENT.md` §12): no 2FA or email verification, no TLS inside the application
(terminate at a reverse proxy), an in-process sign-in throttle, and an append-only audit log
without a retention policy.

Report anything that lets a signed-in user act outside their role or record, or that exposes a
password hash, immediately.

## Supported versions

Only the current `main` branch is supported. There are no backported fixes.
