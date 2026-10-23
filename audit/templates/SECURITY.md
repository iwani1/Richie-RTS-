# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem.

Email the maintainer with:
- what you found and where (file, screen or command);
- how to reproduce it;
- the impact you believe it has.

You will get an acknowledgement within 3 working days and a fix plan within 10.

## Scope

This repository is a **prototype**. It stores its data in the browser and has no server.
It must not hold real personal data (drivers, passengers, corporate client contacts) — see
`docs/DATA_PROTECTION.md` §4 and the audit report in `audit/`.

Security issues in scope for this prototype:
- cross-site scripting or injection in the interface;
- permission-check bypasses in the command layer;
- data loss or corruption from backup import/export;
- credential handling (hashing, storage, session).

Out of scope until a server exists: anything that depends on trust boundaries the browser
cannot provide (local database tampering, devtools access, role editing in localStorage).
These are documented limitations, not vulnerabilities, and are tracked in the audit report as
finding C-01.

## Supported versions

Only the current `main` branch is supported. There are no backported fixes.
