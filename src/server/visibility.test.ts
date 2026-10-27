// What leaves the server, per role.
//
// These tests exist because the read path had no authorisation for most of this project's life: a
// driver account received every client, every other driver's trips and the audit log (audit F-01).
// They assert the shape of the payload the HTTP layer sends, not what a screen chooses to render.
import { describe, expect, it } from "vitest";
import { SNAPSHOT_AUDIT_LIMIT, scopeDatabase, visibleSnapshot } from "./visibility";
import { emptyDatabase, type AuditEntry, type Booking, type Client, type Database, type Driver, type Trip, type User, type Vehicle } from "../tms/types";

const at = "2026-01-01T00:00:00.000Z";

const user = (id: string, role: User["role"], links: Partial<User> = {}): User => ({
  id,
  fullName: `Person ${id}`,
  email: `${id}@example.test`,
  role,
  active: true,
  driverId: null,
  clientId: null,
  passengerId: null,
  primaryContact: false,
  passwordHash: `argon2id-hash-${id}`,
  passwordSalt: "",
  createdAt: at,
  updatedAt: at,
  ...links,
});

const driver = (id: string): Driver => ({
  id,
  fullName: `Driver ${id}`,
  phone: "+233 00 000 0000",
  licenceNumber: `DL-${id}`,
  licenceExpiry: "2030-01-01",
  licenceClasses: [],
  qualifications: [],
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const vehicle = (id: string): Vehicle => ({
  id,
  registration: `GT-${id}`,
  categoryId: "cat",
  make: "Toyota",
  model: "Hiace",
  seatCapacity: 14,
  status: "available",
  notes: "",
  createdAt: at,
  updatedAt: at,
});

const client = (id: string): Client => ({
  id,
  name: `Client ${id}`,
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  reference: "",
  type: null,
  billingAddress: "",
  tin: "",
  notes: "",
  registrationNumber: "",
  registeredOn: "",
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const trip = (id: string, driverId: string, vehicleId: string, routeId: string): Trip => ({
  id,
  reference: `TR-${id}`,
  routeId,
  serviceDate: "2026-01-01",
  status: "planned",
  vehicleId,
  driverId,
  dispatchedAt: null,
  startedAt: null,
  completedAt: null,
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  incidentId: null,
  stopLogs: [],
  boardings: [],
  onTimeThresholdMinutes: null,
  corrections: [],
  delays: [], rosterChanges: [],
  origin: "schedule",
  originReason: null,
  createdAt: at,
  updatedAt: at,
});

const booking = (id: string, tripId: string, passengerId: string, clientId: string, reference: string): Booking => ({
  id,
  reference,
  passengerId,
  clientId,
  routeId: "r1",
  stopId: null,
  tripId,
  serviceDate: "2026-01-01",
  type: "one_time",
  status: "confirmed",
  note: "",
  seriesId: null,
  offeredAt: null,
  cancelledAt: null,
  cancelledBy: null,
  history: [],
  createdAt: at,
  updatedAt: at,
});

const audit = (n: number): AuditEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `a-${i}`,
    at: new Date(Date.parse(at) + i * 1000).toISOString(),
    actorId: null,
    actorName: "Operations",
    action: "vehicles:create",
    entity: "vehicle",
    entityId: "v1",
    summary: "Vehicle added.",
  }));

function world(): Database {
  const base = emptyDatabase();
  return {
    ...base,
    users: [
      user("admin", "administrator"),
      user("driver-user", "driver", { driverId: "d1" }),
      user("other-driver-user", "driver", { driverId: "d2" }),
      user("client-user", "client_contact", { clientId: "c1" }),
      user("unlinked", "driver"),
    ],
    drivers: [driver("d1"), driver("d2")],
    clients: [client("c1"), client("c2")],
    vehicles: [vehicle("v1"), vehicle("v2")],
    routes: [
      {
        id: "r1",
        reference: "RT-001",
        name: "Route 1",
        clientId: "c1",
        direction: "to_work",
        shiftId: null,
        vehicleCategoryId: "cat",
        startDate: "2026-01-01",
        endDate: null,
        status: "active",
        weekdays: [],
        stops: [],
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "r2",
        reference: "RT-002",
        name: "Route 2",
        clientId: "c2",
        direction: "to_work",
        shiftId: null,
        vehicleCategoryId: "cat",
        startDate: "2026-01-01",
        endDate: null,
        status: "active",
        weekdays: [],
        stops: [],
        createdAt: at,
        updatedAt: at,
      },
    ],
    trips: [trip("t1", "d1", "v1", "r1"), trip("t2", "d2", "v2", "r2")],
    audit: audit(1200),
  };
}

const actor = (id: string, role: User["role"]) => ({ id, fullName: `Person ${id}`, role });

describe("snapshot scope", () => {
  it("sends an unlinked or signed-out account nothing at all", () => {
    expect(scopeDatabase(world(), null)).toBeNull();
    const unlinked = scopeDatabase(world(), actor("unlinked", "driver"))!;
    // Their own account row is theirs to see; nothing else is.
    expect(unlinked.users.map((u) => u.id)).toEqual(["unlinked"]);
    expect(unlinked.drivers).toEqual([]);
    expect(unlinked.trips).toEqual([]);
    expect(unlinked.vehicles).toEqual([]);
  });

  it("gives a driver their own record, their trips and nothing else", () => {
    const visible = scopeDatabase(world(), actor("driver-user", "driver"))!;
    expect(visible.users.map((u) => u.id)).toEqual(["driver-user"]);
    expect(visible.drivers.map((d) => d.id)).toEqual(["d1"]);
    expect(visible.trips.map((t) => t.id)).toEqual(["t1"]);
    expect(visible.vehicles.map((v) => v.id)).toEqual(["v1"]);
    // The fleet, the other driver, the client book and the audit log are not theirs.
    expect(visible.clients).toEqual([]);
    expect(visible.audit).toEqual([]);
  });

  it("withholds staff phone numbers from a client contact but keeps the manifest", () => {
    const w = world();
    w.passengers = [
      { id: "p1", clientId: "c1", fullName: "Ama Boateng", employeeRef: "E-1", phone: "+233200000001", routeId: "r1", stopId: null, status: "active", createdAt: at, updatedAt: at },
    ];
    const visible = scopeDatabase(w, actor("client-user", "client_contact"))!;
    expect(visible.passengers.map((p) => p.fullName)).toEqual(["Ama Boateng"]);
    expect(visible.passengers.every((p) => p.phone === "")).toBe(true);
  });

  it("gives a client contact their own client and the trips run for it", () => {
    const visible = scopeDatabase(world(), actor("client-user", "client_contact"))!;
    expect(visible.clients.map((c) => c.id)).toEqual(["c1"]);
    expect(visible.routes.map((r) => r.id)).toEqual(["r1"]);
    expect(visible.trips.map((t) => t.id)).toEqual(["t1"]);
    expect(visible.drivers).toEqual([]);
    expect(visible.vehicles).toEqual([]);
    expect(visible.audit).toEqual([]);
  });

  it("gives a client contact its own branches and no other customer's (CLI-01)", () => {
    const w = world();
    w.clientLocations = [
      { id: "l1", clientId: "c1", name: "Tema depot", address: "Harbour Road", phone: "", contactName: "", status: "active", createdAt: at, updatedAt: at },
      { id: "l2", clientId: "c2", name: "Another customer's office", address: "Elsewhere", phone: "", contactName: "", status: "active", createdAt: at, updatedAt: at },
    ];

    const contact = scopeDatabase(w, actor("client-user", "client_contact"))!;
    expect(contact.clientLocations.map((location) => location.id)).toEqual(["l1"]);

    // A driver is not given the customer's addresses at all, not even the ones on their own run.
    const driver = scopeDatabase(w, actor("driver-user", "driver"))!;
    expect(driver.clientLocations).toEqual([]);

    // Internal staff with the client book see every branch, because branches are part of it.
    const ops = scopeDatabase(w, actor("ops-user", "operations"))!;
    expect(ops.clientLocations.map((location) => location.id).sort()).toEqual(["l1", "l2"]);
  });

  it("gives finance rentals and costs but not the employee roster, documents, accounts or audit", () => {
    const w = world();
    w.passengers = [
      { id: "p1", clientId: "c1", fullName: "Ama Boateng", employeeRef: "E-1", phone: "+233200000001", routeId: "r1", stopId: null, status: "active", createdAt: at, updatedAt: at },
    ];
    w.documents = [
      { id: "doc1", ownerType: "driver", ownerId: "d1", documentTypeId: "t1", documentNumber: "DL-1", issuedDate: "2026-01-01", expiryDate: "2030-01-01", notes: "", createdAt: at, updatedAt: at },
    ];
    const visible = scopeDatabase(w, actor("fin", "finance"))!;
    // Billing context stays.
    expect(visible.clients.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(visible.trips).toHaveLength(2);
    expect(visible.vehicles).toHaveLength(2);
    // Personal and restricted records do not travel at all (brief section 6).
    expect(visible.passengers).toEqual([]);
    expect(visible.documents).toEqual([]);
    expect(visible.users).toEqual([]);
    expect(visible.audit).toEqual([]);
  });

  it("keeps the employee roster and audit trail for operations", () => {
    const w = world();
    w.passengers = [
      { id: "p1", clientId: "c1", fullName: "Ama Boateng", employeeRef: "E-1", phone: "+233200000001", routeId: "r1", stopId: null, status: "active", createdAt: at, updatedAt: at },
    ];
    const visible = scopeDatabase(w, actor("ops", "operations"))!;
    expect(visible.passengers.map((p) => p.id)).toEqual(["p1"]);
    expect(visible.audit).toHaveLength(SNAPSHOT_AUDIT_LIMIT);
  });

  it("keeps company-wide access for internal staff, and bounds the audit window", () => {
    const { database, auditTotal } = visibleSnapshot(world(), actor("admin", "administrator"));
    expect(database!.users).toHaveLength(5);
    expect(database!.trips).toHaveLength(2);
    expect(database!.audit).toHaveLength(SNAPSHOT_AUDIT_LIMIT);
    expect(auditTotal).toBe(1200);
  });

  it("never sends credential material, whatever the role", () => {
    for (const [id, role] of [
      ["admin", "administrator"],
      ["driver-user", "driver"],
      ["client-user", "client_contact"],
    ] as const) {
      const visible = scopeDatabase(world(), actor(id, role))!;
      expect(visible.users.every((u) => u.passwordHash === "" && u.passwordSalt === "")).toBe(true);
    }
  });

  it("reports the true audit count even when it sends none of the rows", () => {
    const visible = visibleSnapshot(world(), actor("driver-user", "driver"));
    expect(visible.database!.audit).toEqual([]);
    expect(visible.auditTotal).toBe(1200);
  });
});

describe("the seats a bound account may see (D-85)", () => {
  /** A visitor with no route of their own, holding a booked seat on the driver's run, plus another client's booking. */
  function withBookings(): Database {
    const w = world();
    w.passengers = [
      { id: "p1", clientId: "c1", fullName: "Ama Boateng", employeeRef: "E-1", phone: "+233200000001", routeId: "r1", stopId: null, status: "active", createdAt: at, updatedAt: at },
      { id: "p2", clientId: "c1", fullName: "Visiting Vic", employeeRef: "", phone: "+233200000002", routeId: "", stopId: "", status: "active", createdAt: at, updatedAt: at },
      { id: "p3", clientId: "c2", fullName: "Other Client Rider", employeeRef: "", phone: "", routeId: "", stopId: "", status: "active", createdAt: at, updatedAt: at },
    ];
    w.bookings = [booking("b1", "t1", "p2", "c1", "BK-0001"), booking("b2", "t2", "p3", "c2", "BK-0002")];
    return w;
  }

  it("sends a driver the seats on their own run and the name to collect, and nothing else", () => {
    const visible = scopeDatabase(withBookings(), actor("driver-user", "driver"))!;
    expect(visible.bookings.map((b) => b.reference)).toEqual(["BK-0001"]);
    // Without the visitor's passenger record the driver would have a seat and nobody to call for.
    expect(visible.passengers.map((p) => p.fullName)).toContain("Visiting Vic");
    expect(visible.passengers.map((p) => p.fullName)).not.toContain("Other Client Rider");
  });

  it("sends a client contact only its own client's seats, never the whole register", () => {
    const visible = scopeDatabase(withBookings(), actor("client-user", "client_contact"))!;
    expect(visible.bookings.map((b) => b.reference)).toEqual(["BK-0001"]);
  });

  it("sends a role that may not read bookings none at all", () => {
    const visible = scopeDatabase(withBookings(), actor("fin", "finance"))!;
    expect(visible.bookings).toEqual([]);
  });

  it("still leaves the booking register out of a bound account's view of another record", () => {
    // The snapshot for a bound role is a whitelist; this pins the seats to that role's own records.
    const visible = scopeDatabase(withBookings(), actor("other-driver-user", "driver"))!;
    expect(visible.bookings.map((b) => b.reference)).toEqual(["BK-0002"]);
    expect(visible.passengers.map((p) => p.fullName)).toContain("Other Client Rider");
  });
});

describe("credit notes inside the snapshot (D-86)", () => {
  // A credit note names a customer and says why they were given money back. It belongs to the
  // invoice's billing, so it follows the invoice's read permission and nothing else. This block
  // exists because the narrowed snapshot is a whitelist: a collection added to the database and not
  // to that list is handed to a bound account in full (the same shape of leak D-85 fixed).
  function withCreditNotes(): Database {
    const w = world();
    const invoice = {
      id: "inv1",
      reference: "INV-2026-0001",
      kind: "rental" as const,
      rentalId: null,
      clientId: "c1",
      customerName: "Acme Ltd",
      buyerAddress: "",
      buyerTin: "",
      currencyCode: "GHS",
      lines: [],
      taxLines: [],
      subtotal: 1000,
      total: 1000,
      amountPaid: 0,
      status: "issued" as const,
      billableEvent: "rental:r1:final",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-15",
      notes: "",
      voidReason: null,
      voidedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    w.invoices = [invoice];
    w.creditNotes = [
      {
        id: "cn1",
        reference: "CN-2026-0001",
        invoiceId: invoice.id,
        invoiceReference: invoice.reference,
        clientId: "c1",
        customerName: "Acme Ltd",
        currencyCode: "GHS",
        lines: [],
        taxLines: [],
        subtotal: 200,
        total: 200,
        reason: "Service not delivered",
        issuedOn: "2026-06-04",
        status: "issued",
        voidReason: null,
        voidedAt: null,
        createdBy: "Fin",
        createdAt: at,
        updatedAt: at,
      },
    ];
    // A refund names a customer and an amount paid back to them (D-92). It travels with the invoice.
    w.refunds = [
      {
        id: "rf1",
        reference: "REF-2026-0001",
        invoiceId: invoice.id,
        invoiceReference: invoice.reference,
        clientId: "c1",
        customerName: "Acme Ltd",
        currencyCode: "GHS",
        amount: 200,
        method: "Bank transfer",
        paidOn: "2026-06-06",
        externalReference: "",
        reason: "Service not delivered",
        status: "paid",
        voidReason: null,
        voidedAt: null,
        recordedBy: "Fin",
        recordedAt: at,
        updatedAt: at,
      },
    ];
    return w;
  }

  it("never sends a credit note to a driver or a client contact", () => {
    for (const who of [
      actor("driver-user", "driver"),
      actor("client-user", "client_contact"),
    ]) {
      const visible = scopeDatabase(withCreditNotes(), who)!;
      expect(visible.creditNotes).toEqual([]);
    }
  });

  it("sends finance the credit notes that belong to the invoices it may read", () => {
    const visible = scopeDatabase(withCreditNotes(), actor("fin", "finance"))!;
    expect(visible.creditNotes.map((note) => note.reference)).toEqual(["CN-2026-0001"]);
    expect(visible.invoices.map((invoice) => invoice.reference)).toEqual(["INV-2026-0001"]);
  });

  it("sends operations nothing about billing, credit notes and refunds included", () => {
    const visible = scopeDatabase(withCreditNotes(), actor("ops", "operations"))!;
    expect(visible.creditNotes).toEqual([]);
    expect(visible.refunds).toEqual([]);
    expect(visible.invoices).toEqual([]);
  });

  it("never sends a refund to a driver or a client contact", () => {
    // The narrowed snapshot is a whitelist; an unlisted collection would be handed over in full.
    for (const who of [actor("driver-user", "driver"), actor("client-user", "client_contact")]) {
      const visible = scopeDatabase(withCreditNotes(), who)!;
      expect(visible.refunds).toEqual([]);
    }
  });

  it("sends finance the refunds that belong to the invoices it may read", () => {
    const visible = scopeDatabase(withCreditNotes(), actor("fin", "finance"))!;
    expect(visible.refunds.map((refund) => refund.reference)).toEqual(["REF-2026-0001"]);
  });
});

// Spending that is not a repair (FIN-05, D-93). An expense names who was paid — a filling station, a
// landlord, sometimes a person — so it is company money information, not something a driver or a
// customer has any reason to receive. The whitelist is the only thing standing between the collection
// and every account, so it is asserted directly.
describe("expense scope", () => {
  function withExpense(): Database {
    const w = world();
    w.expenses = [
      {
        id: "ex1",
        reference: "EXP-2026-0001",
        incurredOn: "2026-06-05",
        category: "Fuel",
        description: "Diesel, depot run",
        payee: "Total Filling Station",
        amount: 320.5,
        currencyCode: "GHS",
        method: "Cash",
        receiptReference: "RCPT-0091",
        receiptHeld: true,
        notes: "",
        status: "recorded",
        voidReason: null,
        voidedAt: null,
        recordedBy: "Finance",
        recordedAt: at,
        updatedAt: at,
      },
    ];
    return w;
  }

  it("never sends an expense to a driver or a client contact", () => {
    for (const who of [actor("driver-user", "driver"), actor("client-user", "client_contact")]) {
      expect(scopeDatabase(withExpense(), who)!.expenses).toEqual([]);
    }
  });

  it("sends the spending register to the roles that may read costs", () => {
    for (const who of [actor("fin", "finance"), actor("ops", "operations"), actor("admin", "administrator")]) {
      expect(scopeDatabase(withExpense(), who)!.expenses.map((expense) => expense.reference)).toEqual(["EXP-2026-0001"]);
    }
  });
});

// Contracts (CLI-02, D-95). A contract is the price and the terms agreed with one client, so it is
// information about that client's relationship with the office — not something the whole company sees
// through a driver's phone, and not another client's to read.
describe("contract scope", () => {
  function withContracts(): Database {
    const w = world();
    const base = {
      serviceType: "staff_transport" as const,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      status: "active" as const,
      routeIds: [],
      weekdays: [],
      shiftIds: [],
      vehicleCategoryId: "",
      pricingModel: "",
      billingFrequency: "",
      paymentTerms: "",
      serviceLevelTargets: "",
      notes: "",
      replacesId: null,
      history: [],
      createdBy: "Ops",
      createdAt: at,
      updatedAt: at,
    };
    w.contracts = [
      { ...base, id: "ct1", reference: "CT-0001", clientId: "c1", clientName: "Client c1" },
      { ...base, id: "ct2", reference: "CT-0002", clientId: "c2", clientName: "Client c2" },
    ];
    return w;
  }

  it("sends a client contact only its own client's contracts", () => {
    const visible = scopeDatabase(withContracts(), actor("client-user", "client_contact"))!;
    expect(visible.contracts.map((contract) => contract.reference)).toEqual(["CT-0001"]);
  });

  it("never sends a contract to a driver", () => {
    for (const who of [actor("driver-user", "driver"), actor("other-driver-user", "driver")]) {
      expect(scopeDatabase(withContracts(), who)!.contracts).toEqual([]);
    }
  });

  it("sends the office every contract, and finance the terms it invoices against", () => {
    for (const who of [actor("admin", "administrator"), actor("fin", "finance"), actor("ops", "operations")]) {
      const visible = scopeDatabase(withContracts(), who)!;
      expect(visible.contracts.map((contract) => contract.reference)).toEqual(["CT-0001", "CT-0002"]);
    }
  });
});

describe("what a passenger account receives (PAX-01, D-97)", () => {
  /** Ama on route r1's roster holding a booked seat on t1; a colleague holding one on another client's run. */
  function withRiders(): Database {
    const w = world();
    w.users = [...w.users, user("rider-user", "passenger", { passengerId: "p1" })];
    w.passengers = [
      { id: "p1", clientId: "c1", fullName: "Ama Boateng", employeeRef: "E-1", phone: "+233200000001", routeId: "r1", stopId: null, status: "active", createdAt: at, updatedAt: at },
      { id: "p2", clientId: "c1", fullName: "Kofi Mensah", employeeRef: "E-2", phone: "+233200000002", routeId: "r1", stopId: null, status: "active", createdAt: at, updatedAt: at },
      { id: "p3", clientId: "c2", fullName: "Other Client Rider", employeeRef: "", phone: "+233200000003", routeId: "r2", stopId: null, status: "active", createdAt: at, updatedAt: at },
    ];
    // p1 holds a seat on the route its client runs; p2 holds a seat on another client's run.
    w.bookings = [booking("b1", "t1", "p1", "c1", "BK-0001"), booking("b2", "t2", "p2", "c1", "BK-0002")];
    return w;
  }

  it("sends one rider: itself, its own seats, the run it travels on and that bus", () => {
    const visible = scopeDatabase(withRiders(), actor("rider-user", "passenger"))!;
    expect(visible.users.map((u) => u.id)).toEqual(["rider-user"]);
    expect(visible.passengers.map((p) => p.fullName)).toEqual(["Ama Boateng"]);
    expect(visible.bookings.map((b) => b.reference)).toEqual(["BK-0001"]);
    expect(visible.trips.map((t) => t.id)).toEqual(["t1"]);
    expect(visible.routes.map((r) => r.id)).toEqual(["r1"]);
    expect(visible.vehicles.map((v) => v.id)).toEqual(["v1"]);
  });

  it("never sends a colleague, another company, the office's money or the audit log", () => {
    const w = withRiders();
    w.incidents = [
      {
        id: "i1",
        reference: "IN-0001",
        type: "breakdown",
        severity: "high",
        vehicleId: "v1",
        tripId: "t1",
        reportedDate: "2026-01-01",
        description: "Fleet-wide tyre check.",
        assignedTo: null,
        takeVehicleOutOfService: false,
        status: "reported",
        resolutionNote: null,
        vehicleRestoredTo: null,
        costEntries: [],
        log: [{ id: "l1", at, actorId: "admin", actorName: "Admin", note: "Reported", fromStatus: null, toStatus: "reported" }],
        createdAt: at,
        updatedAt: at,
      },
    ];
    const visible = scopeDatabase(w, actor("rider-user", "passenger"))!;
    expect(visible.passengers.map((p) => p.id)).toEqual(["p1"]);
    expect(visible.clients).toEqual([]);
    expect(visible.drivers).toEqual([]);
    expect(visible.invoices).toEqual([]);
    expect(visible.payments).toEqual([]);
    expect(visible.expenses).toEqual([]);
    expect(visible.contracts).toEqual([]);
    expect(visible.audit).toEqual([]);
    // An incident somebody else raised is not the rider's to read, even on its own bus.
    expect(visible.incidents).toEqual([]);
    // The rider keeps its own name and phone; nobody else's number is in the payload.
    expect(visible.passengers[0].phone).toBe("+233200000001");
    expect(JSON.stringify(visible)).not.toContain("+233200000002");
    expect(JSON.stringify(visible)).not.toContain("+233200000003");
  });

  it("sends a rider the company's name and booking rules, but none of its prices", () => {
    const w = withRiders();
    w.settings = {
      ...w.settings,
      companyName: "Richie Transport Services",
      invoiceDueDays: 30,
      booking: { requestCutoffMinutes: 60, cancellationCutoffMinutes: 30 },
      rental: { ...w.settings.rental, depositPercent: 40 },
    };
    const visible = scopeDatabase(w, actor("rider-user", "passenger"))!;
    expect(visible.settings.companyName).toBe("Richie Transport Services");
    expect(visible.settings.booking).toEqual({ requestCutoffMinutes: 60, cancellationCutoffMinutes: 30 });
    expect(visible.settings.invoiceDueDays).toBeNull();
    expect(visible.settings.rental.depositPercent).toBeNull();
    // The other roles still receive the settings table whole.
    expect(scopeDatabase(w, actor("admin", "administrator"))!.settings.rental.depositPercent).toBe(40);
  });

  it("sends an unlinked passenger nothing, rather than falling back to the company", () => {
    const w = withRiders();
    w.users = [...w.users, user("stray", "passenger")];
    const visible = scopeDatabase(w, actor("stray", "passenger"))!;
    expect(visible.trips).toEqual([]);
    expect(visible.passengers).toEqual([]);
    expect(visible.bookings).toEqual([]);
    expect(visible.routes).toEqual([]);
  });
});
