// Reference numbering (audit D-03).
//
// The two failures this replaces: `records.length + 1` collides between simultaneous commands, and
// goes backwards when a record is deleted or a restore drops the counters. Each case below is one
// of those failures, stated as a property.
import { describe, expect, it } from "vitest";
import { allocateReference, highestIssued, referencePattern, REFERENCE_SERIES, seriesPeriod } from "./references";
import { executeCommand } from "./commands";
import { execute, type Actor, type Credential } from "./service";
import { emptyDatabase, type Database, type Rental } from "./types";

const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const NOW = "2026-06-01T08:00:00.000Z";

function rental(reference: string): Rental {
  return {
    id: `id-${reference}`,
    reference,
    clientId: null,
    customerName: "Customer",
    customerPhone: "",
    customerEmail: "",
    purpose: "",
    pickupLocation: "",
    dropoffLocation: "",
    startDate: "2026-07-01",
    endDate: "2026-07-02",
    passengers: 10,
    vehicleCategoryId: "cat-1",
    driverRequired: false,
    notes: "",
    status: "draft",
    quote: null,
    quoteHistory: [],
    assignedVehicleId: null,
    assignedDriverId: null,
    deposit: null,
    finalInvoice: null,
    resolutionReason: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("reference series", () => {
  it("numbers each series in its own shape, and files non-annual ones under `all`", () => {
    let db = emptyDatabase();
    const taken: Record<string, string> = {};
    for (const scope of Object.keys(REFERENCE_SERIES) as (keyof typeof REFERENCE_SERIES)[]) {
      const allocated = allocateReference(db, scope, "2026");
      taken[scope] = allocated.reference;
      db = { ...db, referenceCounters: allocated.counters };
    }
    expect(taken).toEqual({
      rental: "RR-0001",
      route: "RT-001",
      trip: "TR-0001",
      incident: "IN-0001",
      workOrder: "WO-0001",
      invoice: "INV-2026-0001",
      creditNote: "CN-2026-0001",
      payment: "PAY-2026-0001",
      refund: "REF-2026-0001",
      expense: "EXP-2026-0001",
      booking: "BK-0001",
    });
    expect(seriesPeriod("rental", "2026")).toBe("all");
    expect(seriesPeriod("invoice", "2026")).toBe("2026");
  });

  it("counts up, one number per call, and never hands out the same number twice", () => {
    let db = emptyDatabase();
    const issued: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const allocated = allocateReference(db, "rental", "2026");
      issued.push(allocated.reference);
      db = { ...db, referenceCounters: allocated.counters };
    }
    expect(issued).toEqual(["RR-0001", "RR-0002", "RR-0003", "RR-0004", "RR-0005"]);
    expect(new Set(issued).size).toBe(5);
  });

  it("restarts invoices each year but not rentals", () => {
    let db = emptyDatabase();
    const first = allocateReference(db, "invoice", "2026");
    db = { ...db, referenceCounters: first.counters };
    const second = allocateReference(db, "invoice", "2026");
    db = { ...db, referenceCounters: second.counters };
    const nextYear = allocateReference(db, "invoice", "2027");
    db = { ...db, referenceCounters: nextYear.counters };

    expect([first.reference, second.reference, nextYear.reference]).toEqual([
      "INV-2026-0001",
      "INV-2026-0002",
      "INV-2027-0001",
    ]);

    // Continuous series ignore the year entirely.
    const a = allocateReference(db, "rental", "2026");
    const b = allocateReference({ ...db, referenceCounters: a.counters }, "rental", "2027");
    expect([a.reference, b.reference]).toEqual(["RR-0001", "RR-0002"]);
  });

  it("recovers a missing counter from the highest reference already issued", () => {
    // The state a restore that dropped reference_counter would leave: records, no counters.
    const db: Database = { ...emptyDatabase(), rentals: [rental("RR-0001"), rental("RR-0002"), rental("RR-0007")] };
    expect(highestIssued(db, "rental", "all")).toBe(7);
    expect(allocateReference(db, "rental", "2026").reference).toBe("RR-0008");
  });

  it("does not reuse a number after the highest record is deleted, because the counter remembers", () => {
    let db: Database = { ...emptyDatabase(), rentals: [rental("RR-0001"), rental("RR-0002")] };
    db = { ...db, referenceCounters: [{ scope: "rental", period: "all", last: 2 }] };
    // Delete the newest record: a count would now say "1 rental exists", so the old code would have
    // reissued RR-0002 — a number already printed on a quotation.
    const afterDelete: Database = { ...db, rentals: [db.rentals[0]] };
    const allocated = allocateReference(afterDelete, "rental", "2026");
    expect(allocated.reference).toBe("RR-0003");
  });

  it("prefers the records over a counter that has fallen behind them", () => {
    // A counter can be stale (an interrupted restore, a hand-edited row). The records are the truth.
    const db: Database = {
      ...emptyDatabase(),
      rentals: [rental("RR-0001"), rental("RR-0009")],
      referenceCounters: [{ scope: "rental", period: "all", last: 3 }],
    };
    expect(allocateReference(db, "rental", "2026").reference).toBe("RR-0010");
  });

  it("ignores references that belong to another series or year", () => {
    const db = {
      ...emptyDatabase(),
      // A rental whose reference happens to look like an invoice must not move the invoice series,
      // and last year's invoice must not move this year's.
      rentals: [rental("RR-0004")],
      invoices: [{ reference: "INV-2026-0099" }, { reference: "INV-2025-0042" }],
    } as unknown as Database;
    expect(highestIssued(db, "rental", "all")).toBe(4);
    expect(highestIssued(db, "invoice", "2026")).toBe(99);
    expect(highestIssued(db, "invoice", "2027")).toBe(0);
  });

  it("describes the shape each series must have", () => {
    expect(referencePattern("rental", "all").test("RR-0001")).toBe(true);
    expect(referencePattern("rental", "all").test("RR-1")).toBe(false);
    expect(referencePattern("route", "all").test("RT-001")).toBe(true);
    expect(referencePattern("invoice", "2026").test("INV-2026-0001")).toBe(true);
    expect(referencePattern("invoice", "2026").test("INV-2027-0001")).toBe(false);
  });
});

describe("commands that mint references", () => {
  function ready(): { db: Database; admin: Actor } {
    const setup = execute(emptyDatabase(), null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential: cred }, NOW);
    if (!setup.ok) throw new Error(setup.message);
    const admin: Actor = { id: setup.db.users[0].id, fullName: "Admin", role: "administrator" };
    const configured = execute(
      setup.db,
      admin,
      {
        type: "update_settings",
        input: {
          ...setup.db.settings,
          currencyCode: "GHS",
          vehicleCategories: [{ id: "", name: "Coaster" }],
          rental: { ...setup.db.settings.rental, pricingBasis: "per_day", depositPercent: 20, paymentMethods: ["Cash"] },
        },
      },
      NOW,
    );
    if (!configured.ok) throw new Error(configured.message);
    return { db: configured.db, admin };
  }

  const request = (categoryId: string, name: string) => ({
    clientId: null,
    customerName: name,
    customerPhone: "",
    customerEmail: "",
    purpose: "",
    pickupLocation: "",
    dropoffLocation: "",
    startDate: "2026-07-01",
    endDate: "2026-07-02",
    passengers: "10",
    vehicleCategoryId: categoryId,
    driverRequired: false,
    notes: "",
  });

  it("keeps the rental series moving after a record is removed from the snapshot", () => {
    const { db, admin } = ready();
    const category = db.settings.vehicleCategories[0].id;
    const one = execute(db, admin, { type: "create_rental", input: request(category, "First") }, NOW);
    if (!one.ok) throw new Error(one.message);
    const two = execute(one.db, admin, { type: "create_rental", input: request(category, "Second") }, NOW);
    if (!two.ok) throw new Error(two.message);
    expect(two.db.rentals.map((r) => r.reference)).toEqual(["RR-0001", "RR-0002"]);
    expect(two.db.referenceCounters).toEqual([{ scope: "rental", period: "all", last: 2 }]);

    // The counter travels with the snapshot, so a snapshot that lost a record still cannot reissue.
    const afterRemoval: Database = { ...two.db, rentals: [two.db.rentals[1]] };
    const three = execute(afterRemoval, admin, { type: "create_rental", input: request(category, "Third") }, NOW);
    if (!three.ok) throw new Error(three.message);
    expect(three.db.rentals.map((r) => r.reference)).toEqual(["RR-0002", "RR-0003"]);
  });

  it("records the counter for an enquiry as well as for a rental taken at the desk", () => {
    const { db } = ready();
    const category = db.settings.vehicleCategories[0].id;
    const enquiry = execute(
      db,
      null,
      {
        type: "submit_enquiry",
        input: {
          customerName: "Akosua Boateng",
          customerPhone: "+233 24 123 4567",
          customerEmail: "",
          organization: "",
          purpose: "",
          pickupLocation: "",
          dropoffLocation: "",
          startDate: "2026-07-01",
          endDate: "2026-07-02",
          passengers: "18",
          vehicleCategoryId: category,
          notes: "",
        },
      },
      NOW,
    );
    if (!enquiry.ok) throw new Error(enquiry.message);
    expect(enquiry.db.rentals[0].reference).toBe("RR-0001");
    expect(enquiry.db.referenceCounters).toEqual([{ scope: "rental", period: "all", last: 1 }]);
  });

  it("numbers a whole generated week of trips without repeating a number", () => {
    const { db: started, admin } = ready();
    const client = executeCommand(
      started,
      admin,
      { type: "create_client", input: { name: "Volta Foods Ltd", contactName: "", contactPhone: "", contactEmail: "", status: "active" } },
      NOW,
    );
    if (!client.ok) throw new Error(client.message);
    const db: Database = client.db;
    const route = executeCommand(
      db,
      admin,
      {
        type: "create_route",
        input: {
          name: "Kumasi staff bus",
          clientId: db.clients[0].id,
          direction: "to_work",
          shiftId: "",
          vehicleCategoryId: db.settings.vehicleCategories[0].id,
          // Monday to Sunday: 2026-07-01 is a Wednesday, so a full week from it is 7 operating days.
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          startDate: "2026-07-01",
          endDate: "2026-07-07",
          status: "active",
          stops: [{ name: "Depot", scheduledTime: "07:00" }, { name: "Plant", scheduledTime: "07:40" }],
        },
      },
      NOW,
    );
    if (!route.ok) throw new Error(`${route.message} ${JSON.stringify(route.errors)}`);
    expect(route.db.routes[0].reference).toBe("RT-001");

    const generated = executeCommand(route.db, admin, { type: "generate_trips", routeId: route.db.routes[0].id, fromDate: "2026-07-01", toDate: "2026-07-07" }, NOW);
    if (!generated.ok) throw new Error(generated.message);
    const references = generated.db.trips.map((trip) => trip.reference).sort();
    expect(references).toHaveLength(7);
    expect(new Set(references).size).toBe(7);
    expect(references[0]).toBe("TR-0001");
    expect(generated.db.referenceCounters).toEqual(
      expect.arrayContaining([
        { scope: "route", period: "all", last: 1 },
        { scope: "trip", period: "all", last: 7 },
      ]),
    );
  });
});
