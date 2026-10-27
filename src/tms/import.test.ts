// MIG-01 / EMP-02: CSV import preview and import.
//
// The properties under test are the ones the brief states: a documented template, required-field
// validation, duplicate detection, a preview before saving, row-level errors, and no silent
// discards — every row is either created or named with a reason.
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
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
  r = execute(db, admin, { type: "update_settings", input: { ...db.settings, vehicleCategories: [{ id: "", name: "Coaster", licenceClasses: [] }, { id: "", name: "Minibus", licenceClasses: [] }] } }, NOW);
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

  it("carries a customer's code, classification and billing details from the file (CUS-01)", () => {
    const { db, admin } = world();
    const result = executeImport(db, admin, {
      type: "import_records",
      kind: "clients",
      csv:
        "name,code,type,contact name,contact phone,contact email,billing address,tin,status\n" +
        "Volta Foods Ltd,VFL-01,Organisation,Efua Owusu,+233244000111,ops@example.test,\"Industrial Area, Accra\",c001234 5678,active\n" +
        "Adjoa Mensah,,,,,,,,active\n",
    }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [volume, person] = result.db.clients;
    expect(volume.reference).toBe("VFL-01");
    expect(volume.type).toBe("organisation");
    expect(volume.billingAddress).toBe("Industrial Area, Accra");
    // Upper-cased on the way in, so the same number typed two ways compares equal.
    expect(volume.tin).toBe("C001234 5678");
    // The second row said nothing beyond a name, so nothing else is claimed about it.
    expect(person.reference).toBe("");
    expect(person.type).toBeNull();
    expect(person.billingAddress).toBe("");
    expect(person.tin).toBe("");
  });

  it("names the line whose type column is neither organisation nor individual", () => {
    const { db, admin } = world();
    const result = executeImport(db, admin, {
      type: "import_records",
      kind: "clients",
      csv: "name,type\nVolta Foods Ltd,Sole trader\nHarbour Logistics,individual\n",
    }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.db.clients.map((client) => client.name)).toEqual(["Harbour Logistics"]);
    expect(result.message).toMatch(/line 2/);
    expect(result.message).toMatch(/Sole trader/);
  });

  it("carries a driver's licence classes and qualifications from the file (FLT-04)", () => {
    const { db, admin } = world();
    const result = executeImport(db, admin, {
      type: "import_records",
      kind: "drivers",
      csv:
        "name,phone,licence number,licence expiry,licence classes,qualifications,status\n" +
        'Kofi Mensah,+233201234567,DL-001,2031-05-01,"C; D",PSV,active\n' +
        "Ama Boateng,+233207654321,DL-002,2030-01-01,,,active\n",
    }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [kofi, ama] = result.db.drivers;
    expect(kofi.licenceClasses).toEqual(["C", "D"]);
    expect(kofi.qualifications).toEqual(["PSV"]);
    // A blank cell is "not recorded", not an empty class that would count as a licence.
    expect(ama.licenceClasses).toEqual([]);
    expect(ama.qualifications).toEqual([]);
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

describe("importing a staff roster (EMP-02, D-81)", () => {
  /** A client with one route of two stops, so a row can name all three in words. */
  function rosterWorld() {
    const base = world();
    let db = base.db;
    const run = (actor: Actor, command: AnyCommand) => {
      const result = executeCommand(db, actor, command, NOW);
      if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
      db = result.db;
    };
    run(base.admin, { type: "create_client", input: { name: "Volta Foods Ltd", contactName: "", contactPhone: "", contactEmail: "", status: "active" } });
    run(base.admin, {
      type: "create_route",
      input: {
        name: "Northstar morning",
        clientId: db.clients[0].id,
        direction: "to_work",
        shiftId: "",
        vehicleCategoryId: db.settings.vehicleCategories[0].id,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        startDate: "2026-01-01",
        endDate: "",
        status: "active",
        stops: [
          { name: "Estate gate", scheduledTime: "06:00", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
          { name: "Head office", scheduledTime: "06:30", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
        ],
      },
    });
    return { ...base, db };
  }

  const HEADER = "name,employee ref,phone,client,route,stop,status\n";

  it("creates the roster, resolving the client, route and stop by name", () => {
    const { db, ops } = rosterWorld();
    const csv = `${HEADER}Ama Boateng,E-001,,Volta Foods Ltd,Northstar morning,Estate gate,\nKofi Mensah,E-002,+233201234567,volta foods ltd,Northstar morning,Head office,inactive\n`;
    const result = executeImport(db, ops, { type: "import_records", kind: "passengers", csv }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [ama, kofi] = result.db.passengers;
    expect(ama.fullName).toBe("Ama Boateng");
    expect(ama.clientId).toBe(result.db.clients[0].id);
    expect(ama.routeId).toBe(result.db.routes[0].id);
    // The stop is the route's own stop, not a name copied into the record.
    expect(ama.stopId).toBe(result.db.routes[0].stops[0].id);
    expect(ama.status).toBe("active");
    // Names are matched case-insensitively; an explicit status is honoured.
    expect(kofi.status).toBe("inactive");
    expect(kofi.stopId).toBe(result.db.routes[0].stops[1].id);

    expect(result.message).toMatch(/Imported 2 roster entries from 2 rows/);
    expect(result.db.audit.filter((entry) => entry.action === "passengers:create")).toHaveLength(2);
    expect(result.db.audit.some((entry) => entry.action === "import:passengers")).toBe(true);
  });

  it("accepts a rider with no route, because a roster is often typed before the runs exist", () => {
    const { db, ops } = rosterWorld();
    const csv = `${HEADER}Yaa Owusu,E-003,,Volta Foods Ltd,,,\n`;
    const result = executeImport(db, ops, { type: "import_records", kind: "passengers", csv }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.db.passengers[0].routeId).toBeNull();
    expect(result.db.passengers[0].stopId).toBeNull();
  });

  it("names the clients that do exist when a row misspells one", () => {
    const { db, ops } = rosterWorld();
    const csv = `${HEADER}Ama Boateng,E-001,,Volta Food Ltd,Northstar morning,Estate gate,\n`;
    const result = previewImport(db, ops, "passengers", csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.rows[0].outcome).toBe("reject");
    expect(result.preview.rows[0].message).toMatch(/Client "Volta Food Ltd" was not found/);
    expect(result.preview.rows[0].message).toMatch(/Known clients: Volta Foods Ltd/);
  });

  it("refuses a stop that is not on the route, listing the stops in order", () => {
    const { db, ops } = rosterWorld();
    const csv = `${HEADER}Ama Boateng,E-001,,Volta Foods Ltd,Northstar morning,Circle, \n`;
    const result = previewImport(db, ops, "passengers", csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.rows[0].outcome).toBe("reject");
    expect(result.preview.rows[0].message).toMatch(/Stop "Circle" is not on Northstar morning/);
    expect(result.preview.rows[0].message).toMatch(/Estate gate, Head office/);
  });

  it("requires a pickup stop once a route is named, rather than guessing one", () => {
    const { db, ops } = rosterWorld();
    const csv = `${HEADER}Ama Boateng,E-001,,Volta Foods Ltd,Northstar morning,,\n`;
    const result = previewImport(db, ops, "passengers", csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.rows[0].outcome).toBe("reject");
    expect(result.preview.rows[0].message).toMatch(/Choose a pickup stop for Northstar morning/);
  });

  it("rejects a repeated employee reference, exactly as a typed row would", () => {
    const { db, ops } = rosterWorld();
    const csv = `${HEADER}Ama Boateng,E-001,,Volta Foods Ltd,Northstar morning,Estate gate,\nAma B.,e-001,,Volta Foods Ltd,Northstar morning,Head office,\n`;
    const result = previewImport(db, ops, "passengers", csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.rows.map((row) => row.outcome)).toEqual(["create", "reject"]);
    expect(result.preview.rows[1].errors.employeeRef).toMatch(/already exists for this client/);
  });

  it("flags a likely duplicate person without refusing the row", () => {
    const { db, ops } = rosterWorld();
    const csv = `${HEADER}Ama Boateng,E-001,,Volta Foods Ltd,Northstar morning,Estate gate,\nAma Boateng,E-999,,Volta Foods Ltd,Northstar morning,Head office,\n`;
    const preview = previewImport(db, ops, "passengers", csv);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    // Both rows import: two people may genuinely share a name.
    expect(preview.preview.rows.map((row) => row.outcome)).toEqual(["create", "create"]);
    expect(preview.preview.warned).toBe(1);
    expect(preview.preview.rows[1].warning).toMatch(/already called Ama Boateng \(E-001\)/);
    expect(preview.preview.rows[0].warning).toBeUndefined();

    const result = executeImport(db, ops, { type: "import_records", kind: "passengers", csv }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.db.passengers).toHaveLength(2);
    expect(result.message).toMatch(/1 row may be someone already on the roster/);
  });

  it("refuses a role that could not add a rider by hand", () => {
    const { db, finance } = rosterWorld();
    const result = previewImport(db, finance, "passengers", `${HEADER}Ama Boateng,E-001,,Volta Foods Ltd,,,\n`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/lacks passengers:create/);
  });
});
