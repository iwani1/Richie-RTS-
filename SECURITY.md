# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's private reporting:
**Security → Advisories → Report a vulnerability** on this repository
(`https://github.com/iwani1/Richie-RTS-/security/advisories/new`).

Include what you found, where (file, screen or command), how to reproduce it, and the impact
you believe it has. You will get an acknowledgement within 3 working days and a fix plan
within 10.

## Scope

This repository is a **browser-local prototype**: it has no server, and its data lives in
`localStorage`. It must not hold real personal data — see finding **C-01** in
`audit/AUDIT-REPORT.md`.

In scope:

- cross-site scripting or injection in the interface;
- permission-check bypasses in the command layer;
- data loss or corruption from backup import/export;
- credential handling (hashing, storage, session).

Out of scope for this build (documented limitations, tracked as C-01, not vulnerabilities):
attacks that assume access to the browser's own storage or devtools — reading `localStorage`,
editing a role, or writing a user id into `sessionStorage`. Those are real risks and are
recorded as such; they cannot be fixed without moving the trust boundary to a server.

## Supported versions

Only the current `main` branch is supported. There are no backported fixes.
