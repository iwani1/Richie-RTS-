import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { documentStatus, type CreateDocumentInput } from "./compliance";
import type { Actor, Credential } from "./service";
import { SCHEMA_VERSION, emptyDatabase, emptyRentalSettings, type Database } from "./types";

const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const NOW = "2026-01-01T00:00:00.000Z";

interface World {
  db: Database;
  admin: Actor;
  ops: Actor;
  finance: Actor;
  driverUser: Actor;
  vehicleId: string;
  driverId: string;
}

function world(options: { documentTypes?: boolean } = { documentTypes: true }): World {
  let db = emptyDatabase();
  const run = (actor: Actor | null, command: AnyCommand) => {
    const result = executeCommand(db, actor, command, NOW);
    if (!result.ok) throw new Error(`${command.type} failed: ${result.message} ${JSON.stringify(result.errors)}`);
    db = result.db;
  };

  run(null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential: cred });
  const admin: Actor = { id: db.users[0].id, fullName: "Admin", role: "administrator" };
  run(admin, { type: "create_user", input: { fullName: "Ops", email: "ops@example.test", role: "operations", active: true }, credential: cred });
  run(admin, { type: "create_user", input: { fullName: "Fin", email: "fin@example.test", role: "finance", active: true }, credential: cred });
  const ops: Actor = { id: db.users[1].id, fullName: "Ops", role: "operations" };
  const finance: Actor = { id: db.users[2].id, fullName: "Fin", role: "finance" };

  run(admin, {
    type: "update_settings",
    input: {
      ...db.settings,
      vehicleCategories: [{ id: "", name: "Minibus" }],
      documentTypes: options.documentTypes
        ? [
            { id: "", name: "Insurance", appliesTo: "vehicle" },
            { id: "", name: "Roadworthy certificate", appliesTo: "vehicle" },
            { id: "", name: "National ID", appliesTo: "both" },
          ]
        : [],
      rental: emptyRentalSettings(),
    },
  });
  const category = db.settings.vehicleCategories[0].id;

  run(ops, { type: "create_vehicle", input: { registration: "GT 100-26", categoryId: category, make: "", model: "", seatCapacity: "30", notes: "" } });
  const vehicleId = db.vehicles[0].id;
  run(ops, { type: "create_driver", input: { fullName: "Kojo", phone: "024", licenceNumber: "L-1", licenceExpiry: "2030-01-01", status: "active" } });
  const driverId = db.drivers[0].id;

  run(admin, {
    type: "create_user",
    input: { fullName: "Kojo", email: "driver@example.test", role: "driver", active: true, driverId, clientId: null },
    credential: cred,
  });
  const driverUser: Actor = { id: db.users[3].id, fullName: "Kojo", role: "driver" };

  return { db, admin, ops, finance, driverUser, vehicleId, driverId };
}

const attempt = (w: World, actor: Actor, command: AnyCommand) => executeCommand(w.db, actor, command, NOW);
const errorsOf = (r: ReturnType<typeof attempt>) => (r.ok ? {} : r.errors);

const insuranceInput = (w: World, over: Partial<CreateDocumentInput> = {}): CreateDocumentInput => ({
  ownerType: "vehicle",
  ownerId: w.vehicleId,
  documentTypeId: w.db.settings.documentTypes.find((d) => d.name === "Insurance")!.id,
  documentNumber: "INS-001",
  issuedDate: "2026-01-01",
  expiryDate: "2027-01-01",
  notes: "",
  ...over,
});

describe("documentStatus", () => {
  it("flags only already-expired documents when no lead time is set", () => {
    expect(documentStatus("2025-12-31", null, "2026-01-01")).toBe("expired");
    expect(documentStatus("2026-01-01", null, "2026-01-01")).toBe("valid");
    expect(documentStatus("2026-06-01", null, "2026-01-01")).toBe("valid");
  });

  it("flags expiring_soon only once a lead time is configured", () => {
    expect(documentStatus("2026-01-10", 14, "2026-01-01")).toBe("expiring_soon");
    expect(documentStatus("2026-01-10", 5, "2026-01-01")).toBe("valid");
    expect(documentStatus("2025-12-31", 14, "2026-01-01")).toBe("expired");
  });

  it("returns unknown for an invalid date rather than guessing", () => {
    expect(documentStatus("not-a-date", 14, "2026-01-01")).toBe("unknown");
  });
});

describe("creating a document", () => {
  it("is blocked until document types are configured", () => {
    const w = world({ documentTypes: false });
    const result = attempt(w, w.ops, {
      type: "create_document",
      input: { ownerType: "vehicle", ownerId: w.vehicleId, documentTypeId: "x", documentNumber: "", issuedDate: "", expiryDate: "2027-01-01", notes: "" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no document types are configured/);
  });

  it("validates the owner exists and matches the document type's applies-to", () => {
    const w = world();
    const missingVehicle = attempt(w, w.ops, { type: "create_document", input: insuranceInput(w, { ownerId: "nope" }) });
    expect(errorsOf(missingVehicle).ownerId).toMatch(/not found/);

    const driverOnlyType = w.db.settings.documentTypes.find((d) => d.name === "National ID")!.id;
    const wrongApplies = attempt(w, w.ops, {
      type: "create_document",
      input: insuranceInput(w, { ownerType: "driver", ownerId: w.driverId, documentTypeId: w.db.settings.documentTypes.find((d) => d.name === "Insurance")!.id }),
    });
    expect(errorsOf(wrongApplies).documentTypeId).toMatch(/applies to vehicles, not drivers/);

    // "both" applies to either owner type.
    const bothOk = attempt(w, w.ops, { type: "create_document", input: insuranceInput(w, { ownerType: "driver", ownerId: w.driverId, documentTypeId: driverOnlyType }) });
    expect(bothOk.ok).toBe(true);
  });

  it("requires a valid expiry date and rejects an issued date after it", () => {
    const w = world();
    const noExpiry = attempt(w, w.ops, { type: "create_document", input: insuranceInput(w, { expiryDate: "" }) });
    expect(errorsOf(noExpiry).expiryDate).toBeDefined();

    const backwards = attempt(w, w.ops, { type: "create_document", input: insuranceInput(w, { issuedDate: "2027-06-01", expiryDate: "2027-01-01" }) });
    expect(errorsOf(backwards).issuedDate).toMatch(/cannot be after/);

    const noIssued = attempt(w, w.ops, { type: "create_document", input: insuranceInput(w, { issuedDate: "" }) });
    expect(noIssued.ok).toBe(true);
    if (noIssued.ok) expect(noIssued.db.documents[0].issuedDate).toBeNull();
  });

  it("records an audit entry naming the document type and owner", () => {
    const w = world();
    const result = attempt(w, w.ops, { type: "create_document", input: insuranceInput(w) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.db.audit[0].action).toBe("documents:create");
      expect(result.db.audit[0].summary).toMatch(/Insurance recorded for vehicle GT 100-26/);
    }
  });
});

describe("updating a document", () => {
  it("allows changing the dates and notes but the owner and type stay fixed", () => {
    const w = world();
    const created = attempt(w, w.ops, { type: "create_document", input: insuranceInput(w) });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    w.db = created.db;
    const docId = w.db.documents[0].id;

    const updated = attempt(w, w.ops, {
      type: "update_document",
      id: docId,
      input: { documentNumber: "INS-002", issuedDate: "2026-02-01", expiryDate: "2028-01-01", notes: "Renewed" },
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      const doc = updated.db.documents[0];
      expect(doc.expiryDate).toBe("2028-01-01");
      expect(doc.documentNumber).toBe("INS-002");
      expect(doc.ownerId).toBe(w.vehicleId);
      expect(doc.documentTypeId).toBe(insuranceInput(w).documentTypeId);
    }
  });

  it("re-validates dates on update", () => {
    const w = world();
    const created = attempt(w, w.ops, { type: "create_document", input: insuranceInput(w) });
    if (!created.ok) throw new Error("setup failed");
    w.db = created.db;
    const docId = w.db.documents[0].id;

    const bad = attempt(w, w.ops, {
      type: "update_document",
      id: docId,
      input: { documentNumber: "", issuedDate: "", expiryDate: "not-a-date", notes: "" },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.expiryDate).toBeDefined();
  });
});

describe("permissions and own-record scope", () => {
  it("lets operations and administrator manage documents but not finance", () => {
    const w = world();
    const financeCreate = attempt(w, w.finance, { type: "create_document", input: insuranceInput(w) });
    expect(financeCreate.ok).toBe(false);
    if (!financeCreate.ok) expect(financeCreate.message).toMatch(/Not permitted/);

    const adminCreate = attempt(w, w.admin, { type: "create_document", input: insuranceInput(w) });
    expect(adminCreate.ok).toBe(true);
  });

  it("denies a driver write access to documents entirely", () => {
    const w = world();
    const result = attempt(w, w.driverUser, { type: "create_document", input: insuranceInput(w) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Not permitted/);
  });
});

describe("settings: document types and reminder lead time", () => {
  it("rejects duplicate type names and an invalid applies-to value", () => {
    const w = world({ documentTypes: false });
    const dup = attempt(w, w.admin, {
      type: "update_settings",
      input: { ...w.db.settings, documentTypes: [{ id: "", name: "Insurance", appliesTo: "vehicle" }, { id: "", name: "insurance", appliesTo: "driver" }] },
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(Object.values(dup.errors).some((m) => m.includes("Duplicate"))).toBe(true);
  });

  it("will not let a document type with recorded documents be removed", () => {
    const w = world();
    const created = attempt(w, w.ops, { type: "create_document", input: insuranceInput(w) });
    if (!created.ok) throw new Error("setup failed");
    w.db = created.db;

    const removed = attempt(w, w.admin, {
      type: "update_settings",
      input: { ...w.db.settings, documentTypes: w.db.settings.documentTypes.filter((d) => d.name !== "Insurance") },
    });
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.errors.documentTypes).toMatch(/Cannot remove document types with recorded documents/);
  });

  it("validates the reminder lead time as a non-negative whole number", () => {
    const w = world();
    const negative = attempt(w, w.admin, { type: "update_settings", input: { ...w.db.settings, documentReminderLeadDays: -1 } });
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.errors.documentReminderLeadDays).toBeDefined();

    const fractional = attempt(w, w.admin, { type: "update_settings", input: { ...w.db.settings, documentReminderLeadDays: 14.5 } });
    expect(fractional.ok).toBe(false);

    const ok = attempt(w, w.admin, { type: "update_settings", input: { ...w.db.settings, documentReminderLeadDays: 30 } });
    expect(ok.ok).toBe(true);
  });
});

describe("schema migration", () => {
  it("upgrades an older backup with empty documents, document types and no lead time", () => {
    const w = world();
    const legacy = {
      schemaVersion: 5,
      users: w.db.users,
      vehicles: w.db.vehicles,
      drivers: w.db.drivers,
      clients: w.db.clients,
      rentals: w.db.rentals,
      routes: w.db.routes,
      passengers: w.db.passengers,
      trips: w.db.trips,
      incidents: w.db.incidents,
      workOrders: w.db.workOrders,
      settings: { ...w.db.settings, documentTypes: undefined, documentReminderLeadDays: undefined },
      audit: w.db.audit,
    } as unknown as Database;
    const result = executeCommand(w.db, w.admin, { type: "import_backup", database: legacy }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.db.documents).toEqual([]);
      expect(result.db.settings.documentTypes).toEqual([]);
      expect(result.db.settings.documentReminderLeadDays).toBeNull();
      expect(result.db.schemaVersion).toBe(SCHEMA_VERSION);
    }
  });
});
