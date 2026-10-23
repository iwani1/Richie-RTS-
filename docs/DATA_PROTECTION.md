# Data protection (draft for review)

Status: **draft proposal**. This is not legal advice. Ghana's Data Protection Act, 2012 (Act 843) applies to personal data processed by this system. Confirm the obligations, including any controller registration and sector-specific rules, with counsel before any live use.

## 1. Personal data stored

| Subject | Data held | Why | Entered by | Who can see it |
|---|---|---|---|---|
| System users (staff) | Name, email, role, active flag, password hash and salt, audit actions | Account access and accountability | Administrator | Administrator (all); audit viewers see actor names |
| Drivers | Name, phone, licence number, licence expiry, status | Dispatch, licence validity checks | Operations | Operations (read/write); finance (read); administrator |
| Corporate client contacts | Contact name, phone, email | Account communication | Finance, administrator | Finance (read/write); operations (read); administrator |
| Passengers (employees of corporate clients) | Full name, employee reference, optional phone, route, pickup stop, status | Running staff busing routes | Operations (from the client's roster; source to be confirmed) | Operations (read/write); finance (read); administrator |
| Boarding and stop-time records | Per trip: boarded or no-show per passenger; actual time at each stop | Attendance, on-time measurement | Operations at trip completion | Operations; administrator; KPI views show aggregates only |
| Rental customers | Name, phone, email, purpose, pickup and drop-off locations | Quotation, booking, billing | Operations, finance | Finance; operations; administrator |

Sensitivity notes:
- A pickup stop reveals where an employee waits and, often, where they live. Treat it as sensitive location data.
- Boarding outcomes are attendance records about identifiable people.
- The system does not capture health, disability, religious or biometric data. Mobility or accessibility needs are not a field in this build. If the business needs them, that is a new decision requiring its own review.

## 2. Lawful basis and notice (open)

- The basis for processing employee and passenger data has not been decided. Options to assess with counsel include the employer-employee relationship, the client contract, and consent. See OPEN_QUESTIONS Q-32.
- Employees must be told what is recorded, why, who sees it and how long it is kept. A notice template is not yet written.

## 3. Retention schedule (proposal, not configured)

No retention period is set. Every period below is a proposal to confirm, and none is enforced by the build. Each becomes a setting with no default (Q-18).

| Data | Proposed approach | Enforced now? |
|---|---|---|
| Passenger records | Anonymise or delete after the client contract ends plus a period to be set | No |
| Boarding and stop-time records | Keep only as long as needed for agreed reporting; then aggregate | No |
| Driver records | Keep while employed plus a period to be set, for licence and legal records | No |
| Rental customer records | Keep for billing and dispute periods to be set | No |
| Audit log | Keep for an accountability period to be set; do not rewrite entries | No |
| Backups | Same retention as the source data; store encrypted | No |

## 4. Known gaps in this build

These are not acceptable for live personal data. They must be closed before production:

1. Personal data now sits in PostgreSQL on a machine the company controls, protected by the
   database user's password. **There is still no encryption at rest**: anyone with root on that
   machine, or a copy of the data directory, can read it. Full-disk encryption on the workstation
   is the minimum before real data goes in.
2. `npm run db:backup` writes **unencrypted JSON containing password hashes**; move it to encrypted
   storage. The Users-screen export is redacted (no credentials) but still contains personal data.
3. There is no TLS inside the application: staff on the office network must reach it through an
   HTTPS reverse proxy (`docs/SETUP_AND_DEPLOYMENT.md` §5) or their session cookie and traffic are
   exposed on that network. There is no per-record access control beyond roles and own-record
   scope, and scope filtering happens in the application layer, not in SQL.
4. No workflow for subject access, correction or deletion requests.
5. No retention jobs.
6. No audit trail of reads. Only writes are audited.
7. **Phase 3 addition.** Incident descriptions may name a driver or describe an accident, and
   finance can read incidents so that breakdown costs can be recorded against the right event
   (OPEN_QUESTIONS Q-35). Until a narrower scope exists, treat incident descriptions as
   sensitive and keep them factual. Costs recorded on incidents and work orders are financial
   records and are subject to whatever retention period is agreed for accounts (Q-18).

## 5. Controls implemented

- Role-based permissions on every write, enforced in the service layer, not only in the UI (PERMISSIONS.md).
- Audit summaries for passenger and driver records avoid personal names. Entity IDs are recorded instead.
- Passwords are hashed with Argon2id (m=19456, t=2, p=1) on the server and never sent to the browser; sign-in failures return a generic message for unknown account, inactive account and wrong password alike, in equivalent time.
- Sessions are sealed, `httpOnly`, `sameSite=lax` cookies (`iron-session`), `Secure` in production, with an eight-hour lifetime. Sign-in is throttled per address and account.
- Every API response is redacted: `passwordHash` and `passwordSalt` are blanked server-side, and the browser cannot submit a credential hash or restore a backup.
- Data minimisation in forms: passengers need a name and a client. Phone and employee reference are optional.
- **Phase 4 addition.** Record-bound accounts are confined to their own record, and the client
  portal shows roster **name and pickup stop only** — not phone, employee reference or any
  other passenger detail (OPEN_QUESTIONS Q-39). The driver portal shows only the runs and
  incidents belonging to that driver's record.

## 6. Act 843 considerations to verify with counsel

- Whether the company must register as a data controller, and the timing.
- Purpose limitation: each field must serve a stated purpose (see section 1).
- Data minimisation and accuracy, including who keeps passenger lists current.
- Security safeguards for storage, transmission and backups (section 4).
- Data subject rights: access, correction and objection. The workflow does not exist yet.
- Cross-border transfer if a hosted provider stores data outside Ghana.
- Sensitive personal data categories, if any are later added.
