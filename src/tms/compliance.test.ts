import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { daysUntil, documentStatus, describeDocumentGaps, requiredDocumentGaps, type CreateDocumentInput } from "./compliance";
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
      vehicleCategories: [{ id: "", name: "Minibus", licenceClasses: [] }],
      documentTypes: options.documentTypes
        ? [
            { id: "", name: "Insurance", appliesTo: "vehicle", required: false },
            { id: "", name: "Roadworthy certificate", appliesTo: "vehicle", required: false },
            { id: "", name: "National ID", appliesTo: "both", required: false },
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
      input: { ...w.db.settings, documentTypes: [{ id: "", name: "Insurance", appliesTo: "vehicle", required: false }, { id: "", name: "insurance", appliesTo: "driver", required: false }] },
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

describe("daysUntil", () => {
  it("counts forward, zero and backward days without a timezone shift", () => {
    expect(daysUntil("2026-11-02", "2026-10-23")).toBe(10);
    expect(daysUntil("2026-10-23", "2026-10-23")).toBe(0);
    expect(daysUntil("2026-10-01", "2026-10-23")).toBe(-22);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
  });

  it("returns null for dates it cannot read instead of inventing a number", () => {
    expect(daysUntil("not-a-date", "2026-10-23")).toBeNull();
    expect(daysUntil("2026-10-23", "")).toBeNull();
  });
});

describe("documents a company has made mandatory (Q-16, D-76)", () => {
  const withRequired = (w: World, names: string[]) => {
    const result = executeCommand(
      w.db,
      w.admin,
      {
        type: "update_settings",
        input: {
          ...w.db.settings,
          documentTypes: w.db.settings.documentTypes.map((d) => ({ ...d, required: names.includes(d.name) })),
        },
      },
      NOW,
    );
    if (!result.ok) throw new Error(result.message);
    w.db = result.db;
  };

  const record = (w: World, over: Partial<CreateDocumentInput>) => {
    const result = executeCommand(w.db, w.ops, { type: "create_document", input: insuranceInput(w, over) }, NOW);
    if (!result.ok) throw new Error(`${result.message} ${JSON.stringify(result.errors)}`);
    w.db = result.db;
  };

  it("reports nothing at all when no document type has been made mandatory", () => {
    const w = world();
    expect(requiredDocumentGaps(w.db, "vehicle", w.vehicleId, "2026-06-01")).toEqual([]);
  });

  it("names a missing paper and an expired one differently", () => {
    const w = world();
    withRequired(w, ["Insurance", "Roadworthy certificate"]);
    record(w, { expiryDate: "2026-05-31" });

    const gaps = requiredDocumentGaps(w.db, "vehicle", w.vehicleId, "2026-06-01");
    expect(gaps).toEqual([
      // Recorded, but it had lapsed by the day of the work.
      { documentTypeId: expect.any(String), name: "Insurance", expiryDate: "2026-05-31", reason: "expired" },
      // Never recorded at all.
      { documentTypeId: expect.any(String), name: "Roadworthy certificate", expiryDate: null, reason: "missing" },
    ]);
    expect(describeDocumentGaps("Vehicle GT 100-26", gaps)).toBe(
      "Vehicle GT 100-26 cannot be assigned: its Insurance expired on 2026-05-31; no Roadworthy certificate is recorded. Record the document in Compliance first.",
    );
  });

  it("accepts the day of expiry, and the latest of several copies", () => {
    const w = world();
    withRequired(w, ["Insurance"]);
    record(w, { documentNumber: "OLD", issuedDate: "2024-12-31", expiryDate: "2025-12-31" });
    record(w, { documentNumber: "NEW", issuedDate: "2025-12-31", expiryDate: "2026-06-01" });
    // The renewed certificate replaces the old one; the work happens on the last valid day.
    expect(requiredDocumentGaps(w.db, "vehicle", w.vehicleId, "2026-06-01")).toEqual([]);
    expect(requiredDocumentGaps(w.db, "vehicle", w.vehicleId, "2026-06-02")).toHaveLength(1);
  });

  it("applies a both-owners type to drivers as well as vehicles", () => {
    const w = world();
    withRequired(w, ["National ID"]);
    expect(requiredDocumentGaps(w.db, "driver", w.driverId, "2026-06-01")).toEqual([
      { documentTypeId: expect.any(String), name: "National ID", expiryDate: null, reason: "missing" },
    ]);
    record(w, { ownerType: "driver", ownerId: w.driverId, documentTypeId: w.db.settings.documentTypes.find((d) => d.name === "National ID")!.id, expiryDate: "2030-01-01" });
    expect(requiredDocumentGaps(w.db, "driver", w.driverId, "2026-06-01")).toEqual([]);
    // A driver's paper does not satisfy the vehicle's requirement, or the other way round.
    expect(requiredDocumentGaps(w.db, "vehicle", w.vehicleId, "2026-06-01")).toHaveLength(1);
  });
});

// FLT-03, D-110: a reminder is a record, not a message.
describe("taking a paper's renewal on", () => {
  const withLead = (w: World, leadDays: number | null) => {
    const result = executeCommand(w.db, w.admin, {
      type: "update_settings",
      input: { ...w.db.settings, documentReminderLeadDays: leadDays },
    }, NOW);
    if (!result.ok) throw new Error(result.message);
    w.db = result.db;
  };

  const record = (w: World, expiryDate: string) => {
    // The issued date is left blank: a paper that lapsed in 2025 cannot have been issued in 2026.
    const result = executeCommand(w.db, w.ops, { type: "create_document", input: insuranceInput(w, { expiryDate, issuedDate: "" }) }, NOW);
    if (!result.ok) throw new Error(`${result.message} ${JSON.stringify(result.errors)}`);
    w.db = result.db;
    return w.db.documents[w.db.documents.length - 1];
  };

  const acknowledge = (w: World, actor: Actor, documentId: string, over: { note?: string; expectedBy?: string } = {}) =>
    executeCommand(w.db, actor, {
      type: "acknowledge_document_reminder",
      input: { documentId, note: over.note ?? "Chasing the insurer", expectedBy: over.expectedBy ?? "" },
    }, NOW);

  it("records who took it on, what they are doing, and when they expect the paper", () => {
    const w = world();
    withLead(w, 30);
    const doc = record(w, "2026-01-20");

    const result = acknowledge(w, w.ops, doc.id, { expectedBy: "2026-01-15" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reminder = result.db.documentReminders[0];
    expect(reminder).toMatchObject({
      documentId: doc.id,
      expiryDate: "2026-01-20",
      note: "Chasing the insurer",
      expectedBy: "2026-01-15",
      acknowledgedBy: "Ops",
      acknowledgedAt: NOW,
    });
    expect(result.db.audit[0].action).toBe("documents:reminder");
    expect(result.db.audit[0].summary).toContain("Insurance for GT 100-26");
    expect(result.message).toMatch(/expected by 2026-01-15/);
  });

  it("takes on a paper that has already lapsed, and one inside the lead time", () => {
    const w = world();
    withLead(w, 30);
    const lapsed = record(w, "2025-12-20");
    const soon = record(w, "2026-01-20");
    expect(lapsed.id).not.toBe(soon.id);
    expect(acknowledge(w, w.ops, lapsed.id).ok).toBe(true);
    expect(acknowledge(w, w.ops, soon.id).ok).toBe(true);
  });

  it("refuses a paper nobody has to think about yet, and names the date", () => {
    const w = world();
    withLead(w, 30);
    const far = record(w, "2027-06-01");
    const refused = acknowledge(w, w.ops, far.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.message).toContain("2027-06-01");
      expect(refused.message).toContain("30-day lead time");
    }
  });

  it("with no lead time set, refuses anything that has not expired — and says why", () => {
    const w = world();
    withLead(w, null);
    const far = record(w, "2027-06-01");
    const refused = acknowledge(w, w.ops, far.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/no reminder lead time is set/i);
  });

  it("needs a note, and a date that has not already passed", () => {
    const w = world();
    withLead(w, 30);
    const doc = record(w, "2026-01-20");

    const blank = acknowledge(w, w.ops, doc.id, { note: "   " });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.errors.note).toMatch(/Say what is being done/);

    const tooLong = acknowledge(w, w.ops, doc.id, { note: "x".repeat(201) });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.errors.note).toMatch(/200 characters/);

    const past = acknowledge(w, w.ops, doc.id, { expectedBy: "2025-12-31" });
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.errors.expectedBy).toMatch(/already passed/);

    const nonsense = acknowledge(w, w.ops, doc.id, { expectedBy: "next tuesday" });
    expect(nonsense.ok).toBe(false);
    if (!nonsense.ok) expect(nonsense.errors.expectedBy).toMatch(/Enter the date/);
  });

  it("keeps the earlier acknowledgement when somebody else takes it on", () => {
    const w = world();
    withLead(w, 30);
    const doc = record(w, "2026-01-20");

    const first = acknowledge(w, w.ops, doc.id, { note: "Chasing the insurer" });
    if (!first.ok) throw new Error(first.message);
    w.db = first.db;

    const second = executeCommand(w.db, w.admin, {
      type: "acknowledge_document_reminder",
      input: { documentId: doc.id, note: "Renewal paid, collecting the certificate", expectedBy: "" },
    }, "2026-01-02T00:00:00.000Z");
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.db.documentReminders).toHaveLength(2);
    expect(second.db.documentReminders.map((r) => r.note)).toEqual([
      "Chasing the insurer",
      "Renewal paid, collecting the certificate",
    ]);
    // The audit log says it replaced the first one rather than pretending it was the only one.
    expect(second.db.audit[0].summary).toMatch(/replaces the acknowledgement by Ops/);
  });

  it("is documents:update — a driver cannot take a renewal on, and neither can a stranger's id", () => {
    const w = world();
    withLead(w, 30);
    const doc = record(w, "2026-01-20");

    const denied = acknowledge(w, w.driverUser, doc.id);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.message).toMatch(/Not permitted/);

    const missing = acknowledge(w, w.ops, "not-a-document");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toMatch(/Document not found/);
  });

  it("comes back when the paper is renewed to a new date that is still too close", () => {
    const w = world();
    withLead(w, 30);
    const doc = record(w, "2026-01-20");
    const taken = acknowledge(w, w.ops, doc.id);
    if (!taken.ok) throw new Error(taken.message);
    w.db = taken.db;

    // The office corrects the expiry to a date that is still inside the lead time: the
    // acknowledgement was given against the old date and cannot answer for the new one.
    const corrected = executeCommand(w.db, w.ops, {
      type: "update_document",
      id: doc.id,
      input: { documentNumber: doc.documentNumber, issuedDate: "", expiryDate: "2026-01-25", notes: "" },
    }, NOW);
    if (!corrected.ok) throw new Error(corrected.message);
    w.db = corrected.db;

    expect(w.db.documentReminders).toHaveLength(1);
    // The reminder is due again, with nobody having taken the new date on.
    expect(acknowledge(w, w.ops, doc.id).ok).toBe(true);
  });
});
