import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { isOwnScoped, isRecordBound, ROLE_PERMISSIONS, can } from "./permissions";
import { actorLink, confinedClientId, driverVehicleIds, mayReportOnVehicle, scopedView } from "./scope";
import type { Actor, Credential } from "./service";
import { emptyDatabase, emptyRentalSettings, type CreditNote, type Database, type Invoice, type Payment, type Refund } from "./types";

const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const NOW = "2026-01-01T00:00:00.000Z";
const DATE = "2026-01-05";

interface World {
  db: Database;
  admin: Actor;
  ops: Actor;
  driverOne: Actor;
  clientOne: Actor;
  driverOneId: string;
  driverTwoId: string;
  clientOneId: string;
  vehicleOne: string;
  vehicleTwo: string;
  tripOne: string;
  tripTwo: string;
}

// Two clients, two routes, two vehicles and one assigned trip each, so scope leaks
// are visible: anything from the second pair must never reach the first pair's account.
function world(): World {
  let db = emptyDatabase();
  const run = (actor: Actor | null, command: AnyCommand) => {
    const result = executeCommand(db, actor, command, NOW);
    if (!result.ok) throw new Error(`${command.type} failed: ${result.message} ${JSON.stringify(result.errors)}`);
    db = result.db;
  };

  run(null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential: cred });
  const admin: Actor = { id: db.users[0].id, fullName: "Admin", role: "administrator" };
  run(admin, { type: "create_user", input: { fullName: "Ops", email: "ops@example.test", role: "operations", active: true }, credential: cred });
  const ops: Actor = { id: db.users[1].id, fullName: "Ops", role: "operations" };

  run(admin, {
    type: "update_settings",
    input: { ...db.settings, currencyCode: "GHS", vehicleCategories: [{ id: "", name: "Minibus", licenceClasses: [] }], shifts: [], rental: emptyRentalSettings() },
  });
  const category = db.settings.vehicleCategories[0].id;

  run(ops, { type: "create_vehicle", input: { registration: "GT 100-26", categoryId: category, make: "", model: "", seatCapacity: "30", notes: "" } });
  run(ops, { type: "create_vehicle", input: { registration: "GT 200-26", categoryId: category, make: "", model: "", seatCapacity: "30", notes: "" } });
  const [vehicleOne, vehicleTwo] = [db.vehicles[0].id, db.vehicles[1].id];

  run(ops, { type: "create_driver", input: { fullName: "Kojo", phone: "024", licenceNumber: "L-1", licenceExpiry: "2030-01-01", status: "active" } });
  run(ops, { type: "create_driver", input: { fullName: "Kwame", phone: "020", licenceNumber: "L-2", licenceExpiry: "2030-01-01", status: "active" } });
  const [driverOneId, driverTwoId] = [db.drivers[0].id, db.drivers[1].id];

  run(admin, { type: "create_client", input: { name: "Alpha Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" } });
  run(admin, { type: "create_client", input: { name: "Beta Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" } });
  const [clientOneId, clientTwoId] = [db.clients[0].id, db.clients[1].id];

  const routeInput = (name: string, clientId: string, start: string, end: string) => ({
    name,
    clientId,
    direction: "to_work" as const,
    shiftId: "",
    vehicleCategoryId: category,
    weekdays: [1, 2, 3, 4, 5],
    startDate: "2026-01-01",
    endDate: "",
    status: "active" as const,
    stops: [
      { name: start, scheduledTime: "06:00", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
      { name: end, scheduledTime: "06:30", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
    ],
  });
  run(ops, { type: "create_route", input: routeInput("Alpha run", clientOneId, "Alpha gate", "Alpha office") });
  run(ops, { type: "create_route", input: routeInput("Beta run", clientTwoId, "Beta gate", "Beta office") });
  const [routeOne, routeTwo] = [db.routes[0].id, db.routes[1].id];

  run(ops, { type: "create_passenger", input: { fullName: "Ama", employeeRef: "A1", phone: "", clientId: clientOneId, routeId: routeOne, stopId: db.routes[0].stops[0].id, status: "active" } });
  run(ops, { type: "create_passenger", input: { fullName: "Akosua", employeeRef: "B1", phone: "", clientId: clientTwoId, routeId: routeTwo, stopId: db.routes[1].stops[0].id, status: "active" } });

  run(ops, { type: "generate_trips", routeId: routeOne, fromDate: DATE, toDate: DATE });
  run(ops, { type: "generate_trips", routeId: routeTwo, fromDate: DATE, toDate: DATE });
  const [tripOne, tripTwo] = [db.trips[0].id, db.trips[1].id];

  run(ops, { type: "assign_trip", id: tripOne, input: { vehicleId: vehicleOne, driverId: driverOneId } });
  run(ops, { type: "assign_trip", id: tripTwo, input: { vehicleId: vehicleTwo, driverId: driverTwoId } });

  run(admin, {
    type: "create_user",
    input: { fullName: "Driver One", email: "driver1@example.test", role: "driver", active: true, driverId: driverOneId, clientId: null },
    credential: cred,
  });
  const driverOne: Actor = { id: db.users[2].id, fullName: "Driver One", role: "driver" };

  run(admin, {
    type: "create_user",
    input: { fullName: "Client One", email: "client1@example.test", role: "client_contact", active: true, driverId: null, clientId: clientOneId },
    credential: cred,
  });
  const clientOne: Actor = { id: db.users[3].id, fullName: "Client One", role: "client_contact" };

  return { db, admin, ops, driverOne, clientOne, driverOneId, driverTwoId, clientOneId, vehicleOne, vehicleTwo, tripOne, tripTwo };
}

const attempt = (w: World, actor: Actor, command: AnyCommand) => executeCommand(w.db, actor, command, NOW);

// Billing fixtures (CLI-03, D-114). Invoices are written straight onto the database because this file
// is about what `scopedView` hands back, and issuing a real invoice would take a completed hire to get
// here. The shapes are the ones `finance.ts` writes.
const invoiceFor = (id: string, clientId: string, reference: string, overrides: Partial<Invoice> = {}): Invoice => ({
  id,
  reference,
  kind: "rental",
  rentalId: null,
  clientId,
  customerName: clientId === "CLIENT_ONE" ? "Alpha Ltd" : "Beta Ltd",
  buyerAddress: "",
  buyerTin: "",
  currencyCode: "GHS",
  lines: [],
  taxLines: [],
  subtotal: 1000,
  total: 1000,
  amountPaid: 0,
  status: "issued",
  billableEvent: `rental:${id}:final`,
  issuedOn: "2026-01-05",
  dueOn: "2026-01-19",
  notes: "",
  voidReason: null,
  voidedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const paymentFor = (id: string, invoiceId: string): Payment => ({
  id,
  reference: `PAY-2026-000${id.slice(-1)}`,
  invoiceId,
  amount: 400,
  currencyCode: "GHS",
  method: "Bank transfer",
  paidOn: "2026-01-10",
  externalReference: "",
  status: "recorded",
  note: "",
  log: [],
  recordedBy: "Fin",
  recordedAt: NOW,
  voidReason: null,
  voidedAt: null,
});

const creditFor = (id: string, invoiceId: string, clientId: string): CreditNote => ({
  id,
  reference: `CN-2026-000${id.slice(-1)}`,
  invoiceId,
  invoiceReference: "INV",
  clientId,
  customerName: "Alpha Ltd",
  currencyCode: "GHS",
  lines: [],
  taxLines: [],
  subtotal: 100,
  total: 100,
  reason: "Service not delivered",
  issuedOn: "2026-01-12",
  status: "issued",
  voidReason: null,
  voidedAt: null,
  createdBy: "Fin",
  createdAt: NOW,
  updatedAt: NOW,
});

const refundFor = (id: string, invoiceId: string, clientId: string): Refund => ({
  id,
  reference: `REF-2026-000${id.slice(-1)}`,
  invoiceId,
  invoiceReference: "INV",
  clientId,
  customerName: "Alpha Ltd",
  currencyCode: "GHS",
  amount: 100,
  method: "Bank transfer",
  paidOn: "2026-01-14",
  externalReference: "",
  reason: "Service not delivered",
  status: "paid",
  voidReason: null,
  voidedAt: null,
  recordedBy: "Fin",
  recordedAt: NOW,
  updatedAt: NOW,
});

/** Two clients, two invoices, and the money against each, so a leak is visible as a wrong row. */
function billed(w: World): World {
  const [alpha, beta] = w.db.clients.map((client) => client.id);
  w.db = {
    ...w.db,
    invoices: [invoiceFor("inv1", alpha, "INV-2026-0001"), invoiceFor("inv2", beta, "INV-2026-0002")],
    payments: [paymentFor("p1", "inv1"), paymentFor("p2", "inv2")],
    creditNotes: [creditFor("cn1", "inv1", alpha), creditFor("cn2", "inv2", beta)],
    refunds: [refundFor("rf1", "inv1", alpha), refundFor("rf2", "inv2", beta)],
  };
  return w;
}

describe("account-to-record links (validateUser)", () => {
  it("requires a driver record for a driver account and a client for a client contact", () => {
    const w = world();
    const missingDriver = attempt(w, w.admin, {
      type: "create_user",
      input: { fullName: "X", email: "x@example.test", role: "driver", active: true },
      credential: cred,
    });
    expect(missingDriver.ok).toBe(false);
    if (!missingDriver.ok) expect(missingDriver.errors.driverId).toMatch(/Link this account/);

    const missingClient = attempt(w, w.admin, {
      type: "create_user",
      input: { fullName: "Y", email: "y@example.test", role: "client_contact", active: true },
      credential: cred,
    });
    expect(missingClient.ok).toBe(false);
    if (!missingClient.ok) expect(missingClient.errors.clientId).toMatch(/Link this account/);
  });

  it("refuses to share one driver record, but allows a second contact at the same client", () => {
    const w = world();
    const duplicateDriver = attempt(w, w.admin, {
      type: "create_user",
      input: { fullName: "Copy", email: "copy@example.test", role: "driver", active: true, driverId: w.driverOneId, clientId: null },
      credential: cred,
    });
    expect(duplicateDriver.ok).toBe(false);
    if (!duplicateDriver.ok) expect(duplicateDriver.errors.driverId).toMatch(/already linked/);

    // A company usually has an operations contact and an accounts contact. Share the password and
    // nobody can tell who did what, so the second person gets their own login (Q-38, D-77).
    const secondContact = attempt(w, w.admin, {
      type: "create_user",
      input: { fullName: "Copy2", email: "copy2@example.test", role: "client_contact", active: true, driverId: null, clientId: w.clientOneId },
      credential: cred,
    });
    expect(secondContact.ok).toBe(true);
    if (secondContact.ok) {
      expect(secondContact.db.users.filter((u) => u.clientId === w.clientOneId)).toHaveLength(2);
      // Neither is marked primary unless the administrator says so.
      expect(secondContact.db.users.some((u) => u.primaryContact)).toBe(false);
    }
  });

  it("keeps internal roles unlinked", () => {
    const w = world();
    const linkedStaff = attempt(w, w.admin, {
      type: "create_user",
      input: { fullName: "Bad", email: "bad@example.test", role: "operations", active: true, driverId: w.driverTwoId, clientId: null },
      credential: cred,
    });
    expect(linkedStaff.ok).toBe(false);
    if (!linkedStaff.ok) expect(linkedStaff.errors.driverId).toMatch(/Only driver, client contact and passenger/);
  });
});

describe("permission scope classification", () => {
  it("marks record-bound roles and their record permissions as own-scoped", () => {
    expect(isRecordBound("driver")).toBe(true);
    expect(isRecordBound("client_contact")).toBe(true);
    expect(isRecordBound("operations")).toBe(false);
    expect(isOwnScoped("driver", "trips:read")).toBe(true);
    expect(isOwnScoped("operations", "trips:read")).toBe(false);
    expect(isOwnScoped("driver", "maintenance:advance")).toBe(false);
    // Deny-by-default still holds for anything not granted.
    expect(can("driver", "settings:update")).toBe(false);
    expect(ROLE_PERMISSIONS.driver).not.toContain("vehicles:read");
    expect(ROLE_PERMISSIONS.client_contact).not.toContain("trips:read");
  });
});

describe("several contacts per client, one marked primary (Q-38, D-77)", () => {
  const addContact = (db: Database, email: string, name: string, clientId: string, primaryContact = false) =>
    executeCommand(db, { id: db.users[0].id, fullName: db.users[0].fullName, role: "administrator" }, {
      type: "create_user",
      input: { fullName: name, email, role: "client_contact", active: true, driverId: null, clientId, primaryContact },
      credential: cred,
    }, NOW);

  const primaryOf = (db: Database, clientId: string) => db.users.find((u) => u.clientId === clientId && u.primaryContact);

  it("gives each contact its own login, both confined to the same client", () => {
    const w = world();
    const second = addContact(w.db, "accounts@alpha.test", "Efua", w.clientOneId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const accounts = second.db.users.filter((u) => u.clientId === w.clientOneId);
    expect(accounts.map((u) => u.email)).toEqual(["client1@example.test", "accounts@alpha.test"]);

    // Each is its own account with its own actor, and both see exactly the one client's work.
    for (const account of accounts) {
      const view = scopedView(second.db, { id: account.id, fullName: account.fullName, role: account.role });
      expect(view.routes.map((r) => r.name)).toEqual(["Alpha run"]);
      expect(view.trips).toHaveLength(1);
    }
  });

  it("keeps one primary per client, taking the mark off the account that held it", () => {
    const w = world();
    const first = executeCommand(w.db, w.admin, {
      type: "update_user",
      id: w.clientOne.id,
      input: { fullName: "Client One", email: "client1@example.test", role: "client_contact", active: true, driverId: null, clientId: w.clientOneId, primaryContact: true },
    }, NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(primaryOf(first.db, w.clientOneId)!.email).toBe("client1@example.test");

    const second = addContact(first.db, "accounts@alpha.test", "Efua", w.clientOneId, true);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const primaries = second.db.users.filter((u) => u.clientId === w.clientOneId && u.primaryContact);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].email).toBe("accounts@alpha.test");

    // The audit says whose mark moved, so the change is not silent.
    // Newest first.
    const last = second.db.audit[0];
    expect(last.summary).toBe("Created user accounts@alpha.test (client_contact), primary contact for Alpha Ltd (mark taken from Client One).");
  });

  it("leaves the other client's primary alone", () => {
    const w = world();
    const betaAdmin = executeCommand(w.db, w.admin, {
      type: "create_user",
      input: { fullName: "Beta Contact", email: "beta@beta.test", role: "client_contact", active: true, driverId: null, clientId: w.db.clients[1].id, primaryContact: true },
      credential: cred,
    }, NOW);
    expect(betaAdmin.ok).toBe(true);
    if (!betaAdmin.ok) return;
    const alpha = addContact(betaAdmin.db, "alpha2@alpha.test", "Yaa", w.clientOneId, true);
    expect(alpha.ok).toBe(true);
    if (!alpha.ok) return;
    expect(primaryOf(alpha.db, w.clientOneId)!.email).toBe("alpha2@alpha.test");
    expect(primaryOf(alpha.db, w.db.clients[1].id)!.email).toBe("beta@beta.test");
  });

  it("refuses a primary mark on anything but a client contact", () => {
    const w = world();
    const staff = attempt(w, w.admin, {
      type: "create_user",
      input: { fullName: "Staff", email: "staff@example.test", role: "operations", active: true, primaryContact: true },
      credential: cred,
    });
    expect(staff.ok).toBe(false);
    if (!staff.ok) expect(staff.errors.primaryContact).toMatch(/Only a client contact account/);
  });

  it("clears the mark when the account stops being a contact, and follows it to a new client", () => {
    const w = world();
    const made = addContact(w.db, "ops@alpha.test", "Efua", w.clientOneId, true);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const id = made.db.users.find((u) => u.email === "ops@alpha.test")!.id;

    // Reassigned to the other client: it carries the mark with it, and Alpha is left with none.
    const moved = executeCommand(made.db, w.admin, {
      type: "update_user",
      id,
      input: { fullName: "Efua", email: "ops@alpha.test", role: "client_contact", active: true, driverId: null, clientId: w.db.clients[1].id, primaryContact: true },
    }, NOW);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(primaryOf(moved.db, w.clientOneId)).toBeUndefined();
    expect(primaryOf(moved.db, w.db.clients[1].id)!.id).toBe(id);

    // Promoted to internal staff: the client link and the mark both go.
    const promoted = executeCommand(moved.db, w.admin, {
      type: "update_user",
      id,
      input: { fullName: "Efua", email: "ops@alpha.test", role: "operations", active: true },
    }, NOW);
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    const after = promoted.db.users.find((u) => u.id === id)!;
    expect(after.clientId).toBeNull();
    expect(after.primaryContact).toBe(false);
  });
});

describe("scopedView", () => {
  it("gives internal roles the whole company slice", () => {
    const w = world();
    for (const actor of [w.admin, w.ops]) {
      const view = scopedView(w.db, actor);
      expect(view.trips).toHaveLength(2);
      expect(view.routes).toHaveLength(2);
      expect(view.passengers).toHaveLength(2);
    }
  });

  it("confines a driver to its own trips, vehicles and incidents", () => {
    const w = world();
    // Two incidents: one on the driver's own vehicle, one on the other vehicle.
    const own = attempt(w, w.ops, {
      type: "create_incident",
      input: { type: "breakdown", severity: "high", vehicleId: w.vehicleOne, tripId: w.tripOne, reportedDate: DATE, description: "Own", assignedTo: "", takeVehicleOutOfService: false },
    });
    expect(own.ok).toBe(true);
    if (own.ok) w.db = own.db;
    const other = attempt(w, w.ops, {
      type: "create_incident",
      input: { type: "breakdown", severity: "low", vehicleId: w.vehicleTwo, tripId: w.tripTwo, reportedDate: DATE, description: "Other", assignedTo: "", takeVehicleOutOfService: false },
    });
    expect(other.ok).toBe(true);
    if (other.ok) w.db = other.db;

    const view = scopedView(w.db, w.driverOne);
    expect(view.trips).toHaveLength(1);
    expect(view.trips[0].id).toBe(w.tripOne);
    expect(view.routes.map((r) => r.name)).toEqual(["Alpha run"]);
    expect(view.vehicles.map((v) => v.registration)).toEqual(["GT 100-26"]);
    // Only the incident on its own vehicle/run is visible.
    expect(view.incidents).toHaveLength(1);
    expect(view.incidents[0].description).toBe("Own");
    // A driver sees no rentals and no work orders.
    expect(view.rentals).toHaveLength(0);
    expect(view.workOrders).toHaveLength(0);
  });

  it("confines a client contact to its own client", () => {
    const w = world();
    const view = scopedView(w.db, w.clientOne);
    expect(view.routes.map((r) => r.name)).toEqual(["Alpha run"]);
    expect(view.passengers.map((p) => p.fullName)).toEqual(["Ama"]);
    expect(view.trips).toHaveLength(1);
    expect(view.trips[0].id).toBe(w.tripOne);
    expect(view.vehicles).toHaveLength(0);
    expect(view.incidents).toHaveLength(0);
  });

  it("shows a client contact the billing on its own invoices and no other customer's (CLI-03, D-114)", () => {
    const w = billed(world());
    const view = scopedView(w.db, w.clientOne);
    expect(view.invoices.map((invoice) => invoice.reference)).toEqual(["INV-2026-0001"]);
    expect(view.payments.map((payment) => payment.reference)).toEqual(["PAY-2026-0001"]);
    expect(view.creditNotes.map((note) => note.reference)).toEqual(["CN-2026-0001"]);
    expect(view.refunds.map((refund) => refund.reference)).toEqual(["REF-2026-0001"]);
  });

  it("matches an invoice on the rental it bills when the document names no client", () => {
    // Invoices written before the buyer was copied onto the document (CUS-01) carry only the rental,
    // so the rental is the second way to know whose bill it is. One rental each, for two clients.
    const w = billed(world());
    const request = (name: string) => ({
      clientId: null,
      customerName: name,
      customerPhone: "",
      customerEmail: "",
      purpose: "Staff shuttle",
      pickupLocation: "Accra",
      dropoffLocation: "Tema",
      startDate: "2026-02-01",
      endDate: "2026-02-02",
      passengers: "4",
      vehicleCategoryId: w.db.settings.vehicleCategories[0].id,
      driverRequired: true,
      notes: "",
    });
    for (const clientId of w.db.clients.map((client) => client.id)) {
      const result = executeCommand(w.db, w.ops, { type: "create_rental", input: { ...request("Shuttle"), clientId } }, NOW);
      expect(result.ok).toBe(true);
      if (result.ok) w.db = result.db;
    }
    const [alphaRental, betaRental] = w.db.rentals;
    expect(alphaRental.clientId).toBe(w.clientOneId);
    w.db = {
      ...w.db,
      invoices: [
        invoiceFor("inv9", "", "INV-2026-0009", { clientId: null, rentalId: alphaRental.id }),
        invoiceFor("inv8", "", "INV-2026-0008", { clientId: null, rentalId: betaRental.id }),
      ],
      payments: [paymentFor("p9", "inv9"), paymentFor("p8", "inv8")],
      creditNotes: [],
      refunds: [],
    };
    const view = scopedView(w.db, w.clientOne);
    expect(view.invoices.map((invoice) => invoice.reference)).toEqual(["INV-2026-0009"]);
    expect(view.payments.map((payment) => payment.reference)).toEqual(["PAY-2026-0009"]);
  });

  it("gives a driver and a rider no billing at all", () => {
    const w = billed(world());
    for (const view of [scopedView(w.db, w.driverOne), scopedView(w.db, { id: w.db.users[0].id, fullName: "Admin", role: "passenger" })]) {
      expect(view.invoices).toEqual([]);
      expect(view.payments).toEqual([]);
      expect(view.creditNotes).toEqual([]);
      expect(view.refunds).toEqual([]);
    }
  });

  it("shows nothing to a record-bound account with no linked record", () => {
    const w = world();
    const result = attempt(w, w.admin, {
      type: "create_user",
      input: { fullName: "Orphan", email: "orphan@example.test", role: "driver", active: true, driverId: w.driverTwoId, clientId: null },
      credential: cred,
    });
    expect(result.ok).toBe(true);
    // Unlink the driver record to simulate an account whose record was removed.
    w.db = (result as { db: Database }).db;
    const orphan: Actor = { id: w.db.users[w.db.users.length - 1].id, fullName: "Orphan", role: "driver" };
    w.db = { ...w.db, drivers: w.db.drivers.filter((d) => d.id !== w.driverTwoId) };

    const view = scopedView(w.db, orphan);
    expect(view.trips).toHaveLength(0);
    expect(view.routes).toHaveLength(0);
    expect(view.incidents).toHaveLength(0);
    expect(actorLink(w.db, orphan).driver).toBeNull();
    expect(confinedClientId(w.db, orphan)).toBeNull();
  });
});

describe("write scoping in the service layer", () => {
  it("lets a driver report only on a vehicle assigned to it", () => {
    const w = world();
    expect(mayReportOnVehicle(w.db, w.driverOne, w.vehicleOne)).toBe(true);
    expect(mayReportOnVehicle(w.db, w.driverOne, w.vehicleTwo)).toBe(false);
    expect(driverVehicleIds(w.db, w.driverOneId).size).toBe(1);

    const refused = attempt(w, w.driverOne, {
      type: "create_incident",
      input: { type: "breakdown", severity: "high", vehicleId: w.vehicleTwo, tripId: "", reportedDate: DATE, description: "Nope", assignedTo: "", takeVehicleOutOfService: true },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/only report an incident for a vehicle assigned to you/);

    const allowed = attempt(w, w.driverOne, {
      type: "create_incident",
      input: { type: "breakdown", severity: "high", vehicleId: w.vehicleOne, tripId: w.tripOne, reportedDate: DATE, description: "Broke down", assignedTo: "", takeVehicleOutOfService: true },
    });
    expect(allowed.ok).toBe(true);
  });

  it("does not let a driver withdraw a vehicle from service", () => {
    const w = world();
    const result = attempt(w, w.driverOne, {
      type: "create_incident",
      input: { type: "breakdown", severity: "high", vehicleId: w.vehicleOne, tripId: w.tripOne, reportedDate: DATE, description: "Broke down", assignedTo: "", takeVehicleOutOfService: true },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The operations decision flag is ignored for record-bound roles.
      expect(result.db.vehicles.find((v) => v.id === w.vehicleOne)?.status).toBe("available");
      expect(result.db.incidents[0].takeVehicleOutOfService).toBe(false);
    }
  });

  it("forces a client contact's rental request onto its own client", () => {
    const w = world();
    const result = attempt(w, w.clientOne, {
      type: "create_rental",
      input: {
        clientId: null,
        customerName: "Someone Else Ltd",
        customerPhone: "",
        customerEmail: "",
        purpose: "Staff shuttle",
        pickupLocation: "Accra",
        dropoffLocation: "Tema",
        startDate: "2026-02-01",
        endDate: "2026-02-02",
        passengers: "4",
        vehicleCategoryId: w.db.settings.vehicleCategories[0].id,
        driverRequired: true,
        notes: "",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.db.rentals).toHaveLength(1);
      expect(result.db.rentals[0].clientId).toBe(w.clientOneId);
    }
  });

  it("lets a client contact answer its own quotation and not another customer's (RNT-05, D-116)", () => {
    const w = world();
    // One rental per client, each quoted, through the ordinary commands.
    let db = w.db;
    const settings = executeCommand(db, w.admin, {
      type: "update_settings",
      input: {
        ...db.settings,
        currencyCode: "GHS",
        rental: { quotationTerms: "Prices are firm for the validity period.", pricingBasis: "per_day", depositPercent: 25, quotationValidityHours: 168, driversAlwaysIncluded: null, paymentMethods: ["Cash", "Bank transfer"], requotePolicy: null },
      },
    }, NOW);
    if (!settings.ok) throw new Error(settings.message);

    db = settings.db;
    const category = db.settings.vehicleCategories[0].id;
    const request = (clientId: string) => ({
      clientId,
      customerName: clientId === w.clientOneId ? "Alpha Ltd" : "Beta Ltd",
      customerPhone: "",
      customerEmail: "",
      purpose: "Shuttle",
      pickupLocation: "Accra",
      dropoffLocation: "Tema",
      startDate: "2026-02-01",
      endDate: "2026-02-02",
      passengers: "4",
      vehicleCategoryId: category,
      driverRequired: false,
      notes: "",
    });
    for (const clientId of db.clients.map((client) => client.id)) {
      const created = executeCommand(db, w.ops, { type: "create_rental", input: request(clientId) }, NOW);
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      db = created.db;
    }
    for (const rental of db.rentals) {
      const quoted = executeCommand(db, w.ops, { type: "quote_rental", id: rental.id, input: { lines: [{ description: "Two days", quantity: "2", unitAmount: "1000" }] } }, NOW);
      expect(quoted.ok).toBe(true);
      if (!quoted.ok) return;
      db = quoted.db;
    }
    const [alpha, beta] = db.rentals;

    // Its own quotation: accepted, and the record says it came from the portal.
    const mine = executeCommand(db, w.clientOne, { type: "accept_quotation", id: alpha.id, note: "Confirmed with the office" }, NOW);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect(mine.db.rentals[0].acceptance).toMatchObject({ channel: "client_portal", byName: "Client One", total: 2000, note: "Confirmed with the office" });
    expect(mine.db.rentals[0].status).toBe("accepted");

    // Another customer's: refused, and the refusal says nothing about whose it is.
    const theirs = executeCommand(db, w.clientOne, { type: "accept_quotation", id: beta.id, note: "" }, NOW);
    expect(theirs.ok).toBe(false);
    if (!theirs.ok) expect(theirs.message).toBe("This request is not on your account.");
  });

  it("blocks a driver from internal and client actions", () => {
    const w = world();
    const settings = attempt(w, w.driverOne, { type: "update_settings", input: w.db.settings });
    expect(settings.ok).toBe(false);
    const rental = attempt(w, w.driverOne, {
      type: "create_rental",
      input: { clientId: w.clientOneId, customerName: "X", customerPhone: "", customerEmail: "", purpose: "p", pickupLocation: "a", dropoffLocation: "b", startDate: "2026-02-01", endDate: "2026-02-02", passengers: "1", vehicleCategoryId: w.db.settings.vehicleCategories[0].id, driverRequired: true, notes: "" },
    });
    expect(rental.ok).toBe(false);
    const clientInternal = attempt(w, w.clientOne, {
      type: "create_work_order",
      input: { vehicleId: w.vehicleOne, title: "t", workType: "w", workshop: "", description: "", reportedOdometer: "", plannedDate: "", incidentId: "" },
    });
    expect(clientInternal.ok).toBe(false);
  });
});

describe("driver trip execution", () => {
  // A driver records the run it actually drove: actual time at each stop and whether
  // each person boarded. It may only do so for the run assigned to its driver record.
  it("lets a driver complete only its own run and records what it entered", () => {
    const w = world();
    for (const id of [w.tripOne, w.tripTwo]) {
      const dispatched = attempt(w, w.ops, { type: "dispatch_trip", id });
      expect(dispatched.ok).toBe(true);
      if (dispatched.ok) w.db = dispatched.db;
    }

    const stops = w.db.routes[0].stops;
    const passengerId = w.db.passengers[0].id;
    const input = {
      stopTimes: stops.map((s) => ({ stopId: s.id, actualTime: "06:05" })),
      boardings: [{ passengerId, outcome: "boarded" as const }],
    };

    // The other driver's run is refused before anything about it is revealed.
    const notMine = attempt(w, w.driverOne, { type: "complete_trip", id: w.tripTwo, input });
    expect(notMine.ok).toBe(false);
    if (!notMine.ok) {
      expect(notMine.message).toMatch(/only complete a run assigned to you/);
      expect(notMine.message).not.toMatch(/dispatched|planned/);
    }

    const mine = attempt(w, w.driverOne, { type: "complete_trip", id: w.tripOne, input });
    expect(mine.ok).toBe(true);
    if (mine.ok) {
      const trip = mine.db.trips.find((t) => t.id === w.tripOne);
      expect(trip?.status).toBe("completed");
      expect(trip?.stopLogs.map((l) => l.actualTime)).toEqual(["06:05", "06:05"]);
      expect(trip?.boardings).toEqual([{ passengerId, stopId: stops[0].id, outcome: "boarded" }]);
    }
  });

  it("will not accept a completion that leaves a passenger or stop unrecorded", () => {
    const w = world();
    const dispatched = attempt(w, w.ops, { type: "dispatch_trip", id: w.tripOne });
    expect(dispatched.ok).toBe(true);
    if (dispatched.ok) w.db = dispatched.db;

    const stops = w.db.routes[0].stops;
    const missingStop = attempt(w, w.driverOne, {
      type: "complete_trip",
      id: w.tripOne,
      input: {
        stopTimes: [{ stopId: stops[0].id, actualTime: "06:05" }, { stopId: stops[1].id, actualTime: "" }],
        boardings: [{ passengerId: w.db.passengers[0].id, outcome: "boarded" }],
      },
    });
    expect(missingStop.ok).toBe(false);
    if (!missingStop.ok) expect(Object.keys(missingStop.errors).some((k) => k.startsWith("stopTimes."))).toBe(true);

    const missingPassenger = attempt(w, w.driverOne, {
      type: "complete_trip",
      id: w.tripOne,
      input: {
        stopTimes: stops.map((s) => ({ stopId: s.id, actualTime: "06:05" })),
        boardings: [],
      },
    });
    expect(missingPassenger.ok).toBe(false);
    if (!missingPassenger.ok) expect(missingPassenger.errors.boardings).toMatch(/every rider expected/);
  });

  it("does not let a driver dispatch or cancel a run", () => {
    const w = world();
    const dispatch = attempt(w, w.driverOne, { type: "dispatch_trip", id: w.tripOne });
    expect(dispatch.ok).toBe(false);
    const cancel = attempt(w, w.driverOne, { type: "cancel_trip", id: w.tripOne, reason: "not going" });
    expect(cancel.ok).toBe(false);
  });
});
