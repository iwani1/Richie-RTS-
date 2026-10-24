// MIG-01 / EMP-02: CSV import preview and import.
//
// The properties under test are the ones the brief states: a documented template, required-field
// validation, duplicate detection, a preview before saving, row-level errors, and no silent
// discards — every row is either created or named with a reason.
import { describe, expect, it } from "vitest";
import { executeImport, parseCsv, previewImport, MAX_IMPORT_ROWS } from "./import";
import { execute, type Actor, type Credential } from "./service";
import { emptyDatabase, type Database } from "./types";

const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const NOW = "2026-01-01T00:00:00.000Z";

function world(): { db: Database; admin: Actor; ops: Actor; finance: Actor } {
  let db = emptyDatabase();
  let r = execute(db, null, { type: "setup_administrator", input: { fullName: "Admin One", email: "admin@example.test" }, credential: cred }, NOW);
  if (!r.ok) throw new Error(r.message);
  db = r.db;
  const admin: Actor = { id: db.users[0].id, fullName: "Admin One", role: "administrator" };
  for (const [fullName, role] of [["Ops", "operations"], ["Fin", "finance"]] as const) {
    r = execute(db, admin, { type: "create_user", input: { fullName, email: `${role}@example.test`, role, active: true }, credential: cred }, NOW);
    if (!r.ok) throw new Error(r.message);
    db = r.db;
  }
  r = execute(db, admin, { type: "update_settings", input: { ...db.settings, vehicleCategories: [{ id: "", name: "Coaster" }, { id: "", name: "Minibus" }] } }, NOW);
  if (!r.ok) throw new Error(r.message);
  db = r.db;
  const ops: Actor = { id: db.users[1].id, fullName: "Ops", role: "operations" };
  const finance: Actor = { id: db.users[2].id, fullName: "Fin", role: "finance" };
  return { db, admin, ops, finance };
}

describe("csv parsing", () => {
  it("handles quoted commas, escaped quotes, CRLF and blank lines", () => {
    const table = parseCsv('name,notes\r\n"Acme, Ltd","He said ""hello"""\r\n\r\nBolt,fast\r\n');
    expect(table).toEqual([
      ["name", "notes"],
      ["Acme, Ltd", 'He said "hello"'],
      ["Bolt", "fast"],
    ]);
  });

  it("keeps a newline that sits inside a quoted field, and ignores a byte-order mark", () => {
    const table = parseCsv('\uFEFFa,b\n"line one\nline two",2');
    expect(table).toEqual([
      ["a", "b"],
      ["line one\nline two", "2"],
    ]);
  });
});

describe("import preview", () => {
  const VEHICLES = "registration,category,make,model,seats,notes\nGT 100-26,Coaster,Toyota,Coaster,30,\nGT 101-26,Minibus,Toyota,Hiace,14,\n";

  it("marks every row that would be created and names the ones that would not", () => {
    const { db, ops } = world();
    const result = previewImport(db, ops, "vehicles", `${VEHICLES}GT 102-26,Spaceship,Acme,Rocket,9,\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.ready).toBe(2);
    expect(result.preview.rejected).toBe(1);
    expect(result.preview.rows.map((row) => row.line)).toEqual([2, 3, 4]);
    expect(result.preview.rows[2].message).toMatch(/Category "Spaceship" is not configured/);
  });

  it("detects duplicates inside the file and against existing records", () => {
    const { db, ops } = world();
    const result = previewImport(db, ops, "vehicles", `${VEHICLES}gt 100-26,Coaster,Toyota,Coaster,30,\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Each row is "create" in isolation; the duplicate of line 2 is rejected, so the preview must
    // run the rows in order rather than validate them independently.
    expect(result.preview.rows.map((row) => row.outcome)).toEqual(["create", "create", "reject"]);
    expect(result.preview.rows[2].errors.registration).toMatch(/already exists/i);
  });

  it("refuses a file whose header is missing a required column", () => {
    const { db, ops } = world();
    const result = previewImport(db, ops, "vehicles", "registration,make\nGT 200-26,Toyota\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/missing required columns/i);
    expect(result.errors.category).toBeDefined();
    expect(result.errors.seats).toBeDefined();
  });

  it("refuses rows for a role that could not create them by hand", () => {
    const { db, finance } = world();
    const result = previewImport(db, finance, "vehicles", VEHICLES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/lacks vehicles:create/);
  });

  it("never writes anything", () => {
    const { db, ops } = world();
    previewImport(db, ops, "vehicles", VEHICLES);
    expect(db.vehicles).toHaveLength(0);
  });
});

describe("import", () => {
  it("creates the valid rows, reports the rejected ones by line, and audits each record", () => {
    const { db, ops } = world();
    const csv = "registration,category,make,model,seats,notes\nGT 300-26,Coaster,Toyota,Coaster,30,\nGT 301-26,Coaster,Toyota,Coaster,not-a-number,\nGT 302-26,Minibus,Toyota,Hiace,14,Spare\n";
    const result = executeImport(db, ops, { type: "import_records", kind: "vehicles", csv }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.db.vehicles.map((vehicle) => vehicle.registration)).toEqual(["GT 300-26", "GT 302-26"]);
    expect(result.message).toMatch(/Imported 2 of 3 vehicles/);
    expect(result.message).toMatch(/line 3/);
    expect(result.db.audit.filter((entry) => entry.action === "vehicles:create")).toHaveLength(2);
    expect(result.db.audit.some((entry) => entry.action === "import:vehicles")).toBe(true);
  });

  it("creates drivers and clients with the same rules as the forms", () => {
    const { db, admin } = world();
    const drivers = executeImport(db, admin, {
      type: "import_records",
      kind: "drivers",
      csv: "name,phone,licence number,licence expiry,status\nKofi Mensah,+233201234567,DL-001,2031-05-01,active\nAma Boateng,+233207654321,DL-002,2020-01-01,\n",
    }, NOW);
    expect(drivers.ok).toBe(true);
    if (!drivers.ok) return;
    expect(drivers.db.drivers).toHaveLength(2);
    expect(drivers.db.drivers[1].status).toBe("active");

    const clients = executeImport(drivers.db, admin, {
      type: "import_records",
      kind: "clients",
      csv: "name,contact name,contact phone,contact email,status\nVolta Foods Ltd,Efua Owusu,+233244000111,ops@example.test,active\nBad Row,,,,not-a-status\n",
    }, NOW);
    expect(clients.ok).toBe(true);
    if (!clients.ok) return;
    expect(clients.db.clients.map((client) => client.name)).toEqual(["Volta Foods Ltd"]);
    expect(clients.message).toMatch(/Imported 1 of 2 clients/);
  });

  it("fails as a whole when every row is rejected, so nothing half-imports", () => {
    const { db, ops } = world();
    const result = executeImport(db, ops, { type: "import_records", kind: "vehicles", csv: "registration,category,seats\n,Coaster,30\n,Minibus,14\n" }, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/Nothing was imported/);
    expect(Object.keys(result.errors)).toEqual(["line 2", "line 3"]);
  });

  it("is refused for a role without the create permission", () => {
    const { db, finance } = world();
    const result = executeImport(db, finance, { type: "import_records", kind: "vehicles", csv: "registration,category,seats\nGT 400-26,Coaster,30\n" }, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/Not permitted/);
  });

  it("stops at the row limit instead of importing an unbounded file", () => {
    const { db, ops } = world();
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => `GT ${1000 + i}-26,Coaster,Toyota,Coaster,30,`).join("\n");
    const csv = `registration,category,make,model,seats,notes\n${rows}\n`;
    const preview = previewImport(db, ops, "vehicles", csv);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(preview.preview.truncated).toBe(true);

    const result = executeImport(db, ops, { type: "import_records", kind: "vehicles", csv }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.db.vehicles).toHaveLength(MAX_IMPORT_ROWS);
  });
});
