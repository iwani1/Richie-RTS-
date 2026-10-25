# Backup and recovery

Two different files exist, and confusing them is the failure this document is written to prevent.

| | Full backup | Redacted export |
|---|---|---|
| Command | `npm run db:backup -- <file>` | "Download" in the Accounts screen (audit trail export) |
| Contains credentials | **Yes** — Argon2id hashes | No |
| Contains personal data | Yes | No, and only what the role may read |
| Restorable | **Yes** | **No** — `db:restore` refuses it by name |
| Who runs it | the operator, on the server | a signed-in administrator, in the browser |

The redacted export is for review and for handing data to an auditor. Restoring it would leave every
account unable to sign in, so the restore command detects it and refuses instead of appearing to
succeed.

---

## 1. Taking a backup

Stop the application first if you can. If you cannot, the backup is still consistent because every
command writes in one transaction, but a command in flight may land after the file is written.

```bash
cd ~/Videos/Richie\ transport/richie-tms
npm run db:backup -- /secure/richie-$(date +%F).json
```

Expected output:

```
Wrote /secure/richie-2026-10-24.json (7 users, 412 audit rows in the snapshot).
This file contains password hashes and personal data. Keep it on encrypted storage.
```

The file is created with mode `0600`. It is a single JSON document:

```json
{ "format": "richie-tms-full-backup", "version": 1, "exportedAt": "…", "database": { "schemaVersion": 11, "…": [] } }
```

Two things to know about its contents:

- **The audit log in the snapshot is the most recent 5 000 entries**, which is what the application
  loads. Older audit rows stay in PostgreSQL. For a byte-exact copy of every row, use `pg_dump`
  instead (section 2). The backup file is a *restore point for the application*, and a restore
  replays the audit rows it carries into an empty table.
- **Passwords travel as hashes.** They cannot be read from the file, but they can be attacked offline,
  so the file belongs on encrypted storage, and the encryption key does not belong on the same disk.

### Where to keep it

- Daily to an encrypted volume, and weekly off the machine.
- `scp /secure/richie-2026-10-24.json admin@backup-host:/srv/backups/` if you have another machine.
- Never in the repository, never in a chat, never in an issue tracker.

## 2. A physical backup (PostgreSQL)

For disaster recovery where the whole database has to be rebuilt exactly:

```bash
podman exec richie-db pg_dump -U richie -d richie_tms -Fc > /secure/richie-$(date +%F).dump
```

Restore into an empty database:

```bash
podman exec -i richie-db pg_restore -U richie -d richie_tms_restored --clean --if-exists < /secure/richie-2026-10-24.dump
```

A physical backup restores everything, including audit rows older than the snapshot limit. The
application-level JSON backup is easier to inspect and to move between versions; the physical one is
the one to reach for after a disk failure.

## 3. Restoring

### 3.1 Preparation

1. **Stop the application.** A restore truncates every table, and a running app would fight it.
2. **Take a backup of the current state first**, even if it is the state you believe is broken. This
   is the only way to undo a wrong restore.
3. Check the file you intend to use: it must contain `"format": "richie-tms-full-backup"`. A redacted
   export does not, and the command will refuse it with a sentence saying so.

### 3.2 Restore

```bash
npm run db:restore -- /secure/richie-2026-10-24.json
```

What the command does, in order:

1. reads and parses the file;
2. runs it through `migrate()`, which accepts schema versions 1–15 and fills in the fields added by
   later versions — a backup taken before invoices existed restores into the current schema;
3. refuses if the shape is not a Richie TMS database;
4. in one transaction: truncates every business table, then writes the snapshot back (parents before
   children, invoices before payments, then the append-only audit rows as inserts);
5. reports how many rows were written.

If any step fails, the transaction rolls back and the database is untouched.

### 3.3 After the restore

```bash
npm run db:migrate        # no-op if the snapshot is current; applies anything newer
npm run build && npm start
curl -s localhost:3000/api/health
```

Then sign in as an administrator and check three things, in this order:

1. **Accounts** — the expected number, each with the right role. If nobody can sign in, the file was a
   redacted export after all; restore again from a full backup.
2. **A recent record** — open the latest rental or invoice and confirm its status and amounts.
3. **The audit log** — the most recent entries should end where the backup was taken. Entries after
   that point are gone, which is the meaning of restoring.

### 3.4 Restoring to another machine

The backup carries absolute identifiers but no paths, so it moves freely:

```bash
# on the new machine, after install and `npm run db:migrate`
npm run db:restore -- /secure/richie-2026-10-24.json
```

Set `DATABASE_URL` and `SESSION_SECRET` in the new machine's `.env` first (see
`SETUP_AND_DEPLOYMENT.md` §3). Restoring the database does **not** carry the session secret: existing
browser sessions on the old machine cannot be used against the new one, which is the outcome you want.

## 4. What a restore does not do

- **It does not merge.** Every business table is replaced. Restoring an old backup discards everything
  recorded since it was taken. That is why step 3.1.2 exists.
- **It does not renumber anything within the data it restores.** Every series (`reference_counter`:
  rentals, routes, trips, incidents, work orders, invoices, payments) is part of the snapshot, so the
  numbering resumes from where that backup left it rather than from a row count.
- **It cannot protect numbers issued after the backup.** Restoring an older backup is a decision to
  return the whole installation to an earlier moment: documents created since are gone, and their
  numbers become available again. Nothing in the database can prevent that, because the record of
  the number went with the data. If a document was printed on paper and the backup predates it, the
  restore and the paper disagree — check before restoring in that situation.
- **It does not restore files outside the database.** There are none today (no attachments are
  stored); when attachments arrive they will need their own backup procedure.
- **It cannot undo a delete**, because the application does not delete: records are archived by status,
  and invoices and payments are protected in the table itself.

## 5. A drill, once a quarter

A backup nobody has restored is a hope, not a plan. Once a quarter:

1. take a backup;
2. restore it into a **separate** database (`createdb richie_tms_drill`, point `DATABASE_URL` at it,
   `npm run db:migrate`, `npm run db:restore`, `npm run build && npm start` on another port);
3. sign in, open a rental, an invoice and the audit log;
4. drop the drill database.

Record the date and the result in `docs/PROGRESS.md` under "Operational checks".

## 6. Failure modes seen in practice

| Symptom | Cause | What to do |
|---|---|---|
| `That file is not a Richie TMS database snapshot` | restored a redacted export, or a file from another system | use the `db:backup` file |
| `relation "schema_migrations" does not exist` | migrations were never applied to this database | `npm run db:migrate` |
| `password authentication failed` | `.env` points at the wrong database or password | check `DATABASE_URL`; see `SETUP_AND_DEPLOYMENT.md` §3 |
| Restore succeeds but sign-in fails | the snapshot's users were restored, but you are typing an account that did not exist when it was taken | check the Accounts screen against the backup's `users` |
| Audit rows missing after restore | expected: the JSON snapshot carries the most recent 5 000 | use `pg_dump` if the full history matters |
