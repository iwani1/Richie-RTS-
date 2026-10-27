# Trial on real data

This is the last gate before the system is used for a working day: the same features proved against
your records, your prices and your customers, with a backup that has been restored at least once.
It takes about two hours and changes no code.

**The rule for the whole exercise: stop at the first step that does not do what this page says.**
Write down the step number, the message on screen and the screen it came from. Do not clean up after
a failure — the record that went wrong is the evidence.

Nothing here invents a number, a rate or a customer. Where the page says `<your …>`, it means the
value you decided, not one this document supplies.

---

## 0. Trial on a copy, not on the live database

The point of a trial is to make mistakes cheaply. Run it against a copy of the database, and only
use the real one once every step is clean. (If the database is still empty, skip to §2 and do the
trial directly — there is nothing to protect yet.)

```bash
mkdir -p backups
podman exec richie-db pg_dump -U richie --format=custom richie_tms > backups/before-trial.dump
podman exec richie-db createdb -U richie richie_tms_trial
podman exec -i richie-db pg_restore -U richie -d richie_tms_trial < backups/before-trial.dump
```

Run the application against the copy, on a different port so it cannot be confused with the real one:

```bash
DATABASE_URL="postgresql://richie:<your-password>@127.0.0.1:5432/richie_tms_trial" \
  npm run db:migrate
DATABASE_URL="postgresql://richie:<your-password>@127.0.0.1:5432/richie_tms_trial" \
  npm run build && DATABASE_URL="postgresql://richie:<your-password>@127.0.0.1:5432/richie_tms_trial" \
  npm start -- -p 3001
```

Open <http://localhost:3001>. The environment variable wins over `.env` (`scripts/env-loader.ts`
skips any key the shell already set, and Next does the same), so the real database is never touched
by these commands.

Stop the server that is serving port 3000 before running `npm run build`: the build rewrites `.next`,
which that server is reading from. Two production servers from the same checkout are otherwise fine —
the trial one reads the same build and points at the copy.

`next start` listens on every interface, so a phone on the same network can open
`http://<this-machine>:3001/enquiry` in §8. Find the address with `hostname -I`.

At the end, `podman exec richie-db dropdb -U richie richie_tms_trial` discards the trial. Do that
only after §10's sign-off, and only if you want the space back.

---

## 1. Record the starting point (5 minutes)

Before changing anything, write down what the system says it has. You will compare against this.

- **Dashboard**: the counts for vehicles, drivers, rentals and money outstanding.
- **`GET /api/health`**: whether the app is up and whether it can reach PostgreSQL.

```bash
curl -s http://localhost:3001/api/health
```

**Expected:** `{"ok":true,"service":"richie-tms","database":"reachable","time":"…"}`. A `503` here is a
database problem — stop and read `SETUP_AND_DEPLOYMENT.md` §5 before going on.

Under `npm start` the endpoint deliberately reports only that the database is *reachable*; the
server version and migration list are shown in development. Ask the database directly for the second
check:

```bash
podman exec richie-db psql -U richie -d richie_tms_trial -c "select version from schema_migrations order by version"
```

**Expected:** four rows — `001_init.sql`, `002_resource_reservations.sql`,
`003_invoices_and_payments.sql`, `004_reference_series.sql`. The trial copy is dumped from the live
database, so it already has every migration the live one has; `db:migrate` in §0 is what applies any
that are missing, and reports the rest as *already applied*.

---

## 2. A backup you have proved you can restore (10 minutes)

A backup nobody has restored is a hope, not a backup.

```bash
npm run db:backup -- ./backups/trial-start.json
podman exec richie-db createdb -U richie richie_tms_restore_check
DATABASE_URL="postgresql://richie:<your-password>@127.0.0.1:5432/richie_tms_restore_check" \
  npm run db:migrate
DATABASE_URL="postgresql://richie:<your-password>@127.0.0.1:5432/richie_tms_restore_check" \
  npm run db:restore -- ./backups/trial-start.json
```

`db:restore` writes rows into a database that already has the schema; it does not create tables. A
fresh database therefore needs `db:migrate` first, which is also true of the real installation on a
new machine.

**Expected:** the restore reports the records it wrote. Compare the vehicle, driver, rental and
invoice counts with §1 — they must be identical. Then:

```bash
podman exec richie-db dropdb -U richie richie_tms_restore_check
```

**If records are missing, stop here.** A restore that loses rows is the one failure that cannot be
worked around later.

> The export contains Argon2 password hashes and customer details. Keep `backups/` out of any shared
> folder or cloud sync, and treat the files as personal data (`docs/DATA_PROTECTION.md`).

---

## 3. Settings: your rules, not defaults (10 minutes)

Open **Settings** and complete, with your own values:

| Setting | Why it blocks something until it is set |
|---|---|
| Company name, currency | Every quote and invoice prints it |
| Tax position and tax lines | Issuing an invoice is refused while the position is unset; a VAT-registered company with no tax line is refused too |
| Payment terms (days) | An invoice has no due date without it |
| Deposit percentage, quotation validity (in hours since D-117), quotation terms | The deposit on confirmation, the moment the price stops holding and the conditions printed on the sheet are taken from these |
| Payment methods | Recording a payment needs a method that exists here |
| Vehicle categories | Vehicles cannot be created, and the public form cannot open, without at least one |

**Prove the blocking works once**, because that is the behaviour that protects you: with the tax
position left unset, try to issue an invoice. **Expected:** the screen refuses in words ("Set the
company tax position in Settings before issuing an invoice"), not with a crash. Then set it and
issue.

---

## 4. Import the registers (20 minutes)

Follow `SETUP_AND_DEPLOYMENT.md` §8. **Check file** first on every import — it lists every row as
*will import* or *rejected* with a line number, and nothing is written until you press **Import N rows**.

**Expected, and worth checking on purpose:**

- A row whose `category` is not one of your vehicle categories is **rejected** with the list of
  categories you do have. That is the import refusing to invent a category.
- A registration or licence number that already exists is **rejected**, not merged or overwritten.
- Each imported record has its own audit entry, plus one `import:vehicles` (or drivers/clients)
  summary entry.

**Write down** how many rows you gave it, how many imported, and the exact reason for each rejection.

---

## 5. One real rental, from enquiry to paid invoice (45 minutes)

Use a genuine job — a real customer, real dates, the real price you would quote. Record the figures
you expect *before* you press anything, then compare.

| Step | Screen | What must be true afterwards |
|---|---|---|
| Request | Rentals | Saved as **Draft** with a reference `RR-0001`-style, and an audit entry |
| Quotation | Rentals | Subtotals add up to your arithmetic; the deposit is exactly your percentage, to the cedi/pesewa |
| Confirm | Rentals | Vehicle and driver are now reserved; the rental is **Confirmed** |
| Assign | Rentals | The vehicle appears on the rental, with its plate; the audit entry names it |
| Start | Rentals | Status **In progress** |
| Complete | Rentals | Final line items, including anything extra you add (which needs a reason) |
| Invoice | Invoices | Numbered `INV-<year>-0001`; tax at your rate on the quoted amount; due date = invoice date + your payment terms |
| Payment 1 | Invoices | Status **Part paid**; outstanding shows the difference; numbered `PAY-<year>-0001` |
| Payment 2 | Invoices | Status **Paid**; outstanding is zero; numbered `PAY-<year>-0002` |

Then the two failures that matter more than the happy path:

1. **Book the same vehicle twice.** In a second rental, assign the vehicle you just used over the
   same dates. **Expected:** refused with a sentence naming the rental that already has it
   (`… already assigned to RR-…`) — not a crash, and certainly not two bookings.
2. **Record a payment larger than the balance.** **Expected:** refused, and it says how much is
   outstanding instead.

---

## 6. Maintenance and the release control (15 minutes)

On the vehicle you just used: raise a work order, add a cost, move it to **Closed**.

**Expected:** closing requires the release permission, and the work order records **who released the
vehicle and when**. Sign in as a role without that permission (operations can advance a work order
but not release it) and confirm the refusal — that separation is the point of the control.

---

## 7. The reports reconcile (20 minutes)

Open **Reports** and check three numbers against the records, by hand:

- **Invoiced** = the total of every invoice that is not void.
- **Received** = the total of every payment recorded.
- **Outstanding** = invoiced − received, and the same as the sum of each invoice's own outstanding.

**Expected:** all three match your arithmetic to the pesewa. This is the step where a money bug shows
up as a difference, so write down the three numbers rather than just ticking the box.

---

## 8. The public enquiry form (10 minutes)

1. On a phone or a second browser (not signed in), open `http://<this-machine>:3001/enquiry`, fill it
   in with your own details and send it. **Expected:** a thank-you panel with a reference, and no
   login prompt.
2. In the application, open **Rentals**. **Expected:** a **Draft** request with that reference, a note
   saying it came from the public enquiry form, and an audit entry (`rentals:enquiry`).
3. If you intend to embed it, open `embed/enquiry-iframe.html` in this repository in a browser —
   it is the finished snippet, with the TMS address to change marked. **Expected:** the form renders
   inside the frame at its own height (no clipped button, no band of white underneath), and every
   other page of the application refuses to be framed.
4. Optional: a script posting immediately (the browser console, `fetch('/api/enquiry', {method:'POST', body:'{}'})`)
   is refused. **Expected:** a 400, and no record created.

---

## 9. Restart, and check it is still there (5 minutes)

```bash
# stop the trial server (Ctrl-C), then restart it against the same copy
DATABASE_URL="postgresql://richie:<your-password>@127.0.0.1:5432/richie_tms_trial" \
  npm start -- -p 3001
```

`npm run build` is only needed if the code changed, not to prove the data survived — but rebuild if
you want the restart to be identical to a deployment. Reload the rental and the invoice from §5.

**Expected:** the same records, the same statuses, the same numbers — and the same sign-in still
works. Data lives in PostgreSQL, not in a browser tab.

---

## 10. Sign-off

Fill this in as you go. Anything other than a tick is a finding; send me the step number, the message
on screen and (if it is a money or booking issue) the reference in question.

| Step | Expected | Observed | Pass? |
|---|---|---|---|
| 1 | Health `ok`, four migrations in `schema_migrations` | | |
| 2 | Restore reproduces every count | | |
| 3 | Invoice refused until tax position set | | |
| 4 | Bad rows rejected by line, duplicates refused | | |
| 5 | Quote, deposit, invoice, VAT, due date, two payments — arithmetic correct | | |
| 5 | Double booking refused in words | | |
| 6 | Release needs the permission; releaser recorded | | |
| 7 | Invoiced − received = outstanding | | |
| 8 | Enquiry arrives as a draft, attributed to the form | | |
| 9 | Records survive a restart | | |

**After a clean trial**, repeat §5–§8 once on the real database (port 3000, the `.env` connection).
The copy exists to make the first pass safe; the real pass is what tells you the system is ready for
a working day.

### Runs recorded

| Date | Build | Where | Result | Notes |
|---|---|---|---|---|
| 2026-10-25 | `c7d6454` | Copy (`richie_tms_trial`), port 3001, §1–§10 | **Clean — reported by the owner, no step failed** | The arithmetic probe in §5 agreed to the pesewa: 1 × GHS 15.90 at a 25% deposit asking **3.98**, VAT at 15% on the invoice **2.39**, total **18.29**; a payment of 0.02 was refused naming 0.01 outstanding, and 0.01 settled it. §5–§8 on the live database is **still to run** |

The row above is the owner's report of a completed pass, not a machine record: the trial is run by a
person at a workstation, and this page is where the result is kept. A run that fails is recorded here
too, with the step number and the reference in question, so the next person knows what was tried.

---

## What this trial deliberately does not cover

- **Playwright.** The end-to-end proof is HTTP-level and is a recorded substitute for the brief's
  browser automation (D-68). The screens themselves are covered by jsdom tests.
- **Email, notifications, SMS.** Not built; the office rings customers back, which is why the form
  asks for a phone number.
- **Multi-tenancy, contracts, bookings, driver app.** Phase 1B/2 work, listed as not built in
  `docs/PROGRESS.md`.
- **Load.** One workstation, one server, a handful of operators. The concurrency that matters —
  two dispatchers, one vehicle — is proved in CI, not by this trial.
