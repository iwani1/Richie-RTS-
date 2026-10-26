// The customer record a document needs (CUS-01).
//
// The register used to be a name and a phone number: enough to ring somebody, not enough to bill
// them. What is being pinned here:
//
//   1. **The customer's own code identifies them.** Two customers cannot share one, and the
//      comparison ignores case and stray spaces the way the rest of the register does.
//   2. **A blank is a blank.** A customer nobody has classified reads "not recorded" rather than
//      being quietly declared an organisation, and an old record keeps working.
//   3. **The invoice keeps what it was issued with.** Billing details are copied onto the document,
//      so a customer who moves premises in July does not rewrite a January invoice — the same rule
//      the tax lines already follow.
//   4. **The document still prints when there is nothing to print.** A walk-in customer has no
//      client record at all, and their invoice is not broken by that.
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { execute, type Actor, type ClientInput, type Credential, type CommandResult } from "./service";
import { emptyDatabase, emptyRentalSettings, migrate, type Database } from "./types";

const NOW = "2026-06-01T09:00:00.000Z";
const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const EMAILS = { admin: "admin@example.test", ops: "ops@example.test", finance: "fin@example.test" } as const;
type Who = keyof typeof EMAILS;

interface World {
  db: Database;
  clientId: string;
  rentalId: string;
}

function actorOf(db: Database, who: Who): Actor {
  const user = db.users.find((candidate) => candidate.email === EMAILS[who]);
  if (!user) throw new Error(`missing user ${who}`);
  return { id: user.id, fullName: user.fullName, role: user.role };
}

const step = (w: World, who: Who, command: AnyCommand): CommandResult => {
  const result = executeCommand(w.db, actorOf(w.db, who), command, NOW);
  if (!result.ok) throw new Error(`${command.type} failed: ${result.message} ${JSON.stringify(result.errors)}`);
  w.db = result.db;
  return result;
};
const attempt = (w: World, who: Who, command: AnyCommand): CommandResult => executeCommand(w.db, actorOf(w.db, who), command, NOW);
const errorsOf = (result: CommandResult): Record<string, string> => (result.ok ? {} : result.errors);

const clientInput = (overrides: Partial<ClientInput> = {}): ClientInput => ({
  reference: "NST-001",
  name: "Northstar Foods",
  type: "organisation",
  contactName: "Efua Addo",
  contactPhone: "0244000000",
  contactEmail: "efua@northstar.test",
  billingAddress: "Plot 12, Spintex Road, Accra",
  tin: "c0012345678",
  notes: "",
  status: "active",
  ...overrides,
});

const settings = () => ({
  companyName: "Richie Transport Services",
  currencyCode: "GHS",
  onTimeThresholdMinutes: 5,
  vehicleCategories: [{ id: "", name: "Coaster" }],
  shifts: [],
  rental: { ...emptyRentalSettings(), pricingBasis: "per_day" as const, depositPercent: 20, quotationValidityDays: 14, paymentMethods: ["Cash", "Bank transfer"] },
  documentTypes: [],
  documentReminderLeadDays: null,
  taxPosition: "registered" as const,
  taxLines: [{ id: "", name: "VAT", ratePercent: 15 }],
  invoiceDueDays: 14,
  workTypes: ["Service"],
  costCategories: ["Fuel"],
  maintenance: { schedules: [], blockOnOverdueService: false },
  booking: { requestCutoffMinutes: null, cancellationCutoffMinutes: null },
});

function build(): World {
  const setup = execute(emptyDatabase(), null, { type: "setup_administrator", input: { fullName: "Admin", email: EMAILS.admin }, credential: cred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  const w: World = { db: setup.db, clientId: "", rentalId: "" };
  step(w, "admin", { type: "create_user", input: { fullName: "Ops", email: EMAILS.ops, role: "operations", active: true }, credential: cred });
  step(w, "admin", { type: "create_user", input: { fullName: "Fin", email: EMAILS.finance, role: "finance", active: true }, credential: cred });
  step(w, "admin", { type: "update_settings", input: settings() });
  return w;
}

describe("the customer register (CUS-01)", () => {
  it("keeps the code, the type, the billing address and the tax number", () => {
    const w = build();
    step(w, "admin", { type: "create_client", input: clientInput() });

    const saved = w.db.clients[0];
    expect(saved.reference).toBe("NST-001");
    expect(saved.type).toBe("organisation");
    expect(saved.billingAddress).toBe("Plot 12, Spintex Road, Accra");
    // A tax number is stored in one case, so the same number typed twice compares equal.
    expect(saved.tin).toBe("C0012345678");
    expect(w.db.audit[0].action).toBe("clients:create");
  });

  it("refuses a second customer with the same code, whatever the case or spacing", () => {
    const w = build();
    step(w, "admin", { type: "create_client", input: clientInput() });

    const clash = attempt(w, "admin", { type: "create_client", input: clientInput({ name: "Something Else Ltd", reference: "  nst-001 " }) });
    expect(clash.ok).toBe(false);
    expect(errorsOf(clash).reference).toContain("already uses this code");
    expect(w.db.clients).toHaveLength(1);
  });

  it("lets a customer be added with no code and no classification, and says so rather than guessing", () => {
    const w = build();
    step(w, "admin", { type: "create_client", input: clientInput({ reference: "", type: null, name: "Walk-in Hire", billingAddress: "", tin: "" }) });

    const saved = w.db.clients[0];
    expect(saved.reference).toBe("");
    expect(saved.type).toBeNull();
    expect(saved.billingAddress).toBe("");
    expect(saved.tin).toBe("");
  });

  it("refuses a classification it does not have, and a tax number that is not one", () => {
    const w = build();
    const badType = attempt(w, "admin", { type: "create_client", input: clientInput({ type: "charity" as never }) });
    expect(errorsOf(badType).type).toBeTruthy();

    const shortTin = attempt(w, "admin", { type: "create_client", input: clientInput({ name: "Other Ltd", reference: "", tin: "A1" }) });
    expect(errorsOf(shortTin).tin).toContain("4–30");

    const longCode = attempt(w, "admin", { type: "create_client", input: clientInput({ name: "Third Ltd", reference: "X".repeat(41) }) });
    expect(errorsOf(longCode).reference).toContain("40 characters");
    expect(w.db.clients).toHaveLength(0);
  });

  it("updates the details in place, and records who changed them", () => {
    const w = build();
    step(w, "admin", { type: "create_client", input: clientInput() });
    const id = w.db.clients[0].id;

    step(w, "admin", { type: "update_client", id, input: clientInput({ billingAddress: "New address, Tema", notes: "Prefers invoices by email" }) });

    expect(w.db.clients[0].billingAddress).toBe("New address, Tema");
    expect(w.db.clients[0].notes).toBe("Prefers invoices by email");
    // The code did not move, and the update is attributed.
    expect(w.db.clients[0].reference).toBe("NST-001");
    expect(w.db.audit[0].action).toBe("clients:update");
    expect(w.db.audit[0].actorName).toBe("Admin");
  });

  it("reads an older backup without inventing a classification for every customer", () => {
    // A snapshot from before this phase: a client row with only the old fields.
    const migrated = migrate({
      ...emptyDatabase(),
      schemaVersion: 21,
      clients: [{ id: "c1", name: "Old Customer", contactName: "", contactPhone: "", contactEmail: "", status: "active", createdAt: NOW, updatedAt: NOW }],
    });
    expect(migrated).not.toBeNull();
    expect(migrated!.clients[0].reference).toBe("");
    expect(migrated!.clients[0].type).toBeNull();
    expect(migrated!.clients[0].billingAddress).toBe("");
    expect(migrated!.clients[0].name).toBe("Old Customer");
  });
});

describe("the certificate a company supplied (CLI-01)", () => {
  it("keeps the registration number and the date on it", () => {
    const w = build();
    step(w, "admin", {
      type: "create_client",
      input: clientInput({ registrationNumber: " CS-1234567 ", registeredOn: "2019-04-12" }),
    });

    const saved = w.db.clients[0];
    expect(saved.registrationNumber).toBe("CS-1234567");
    expect(saved.registeredOn).toBe("2019-04-12");
  });

  it("leaves both blank on a customer who never supplied one, and on an older record", () => {
    const w = build();
    step(w, "admin", { type: "create_client", input: clientInput() });
    expect(w.db.clients[0].registrationNumber).toBe("");
    expect(w.db.clients[0].registeredOn).toBe("");

    const old = migrate({ ...emptyDatabase(), schemaVersion: 22, clients: [{ ...w.db.clients[0], registrationNumber: undefined, registeredOn: undefined }] });
    expect(old?.clients[0].registrationNumber).toBe("");
    expect(old?.clients[0].registeredOn).toBe("");
  });

  it("refuses a day that is not a day, and a registration dated in the future", () => {
    const w = build();
    const notADay = attempt(w, "admin", {
      type: "create_client",
      input: clientInput({ registeredOn: "2019-02-30" }),
    });
    expect(errorsOf(notADay).registeredOn).toBe("Enter the registration date as a real day.");

    const future = attempt(w, "admin", {
      type: "create_client",
      input: clientInput({ name: "Tomorrow Ltd", reference: "", registeredOn: "2027-01-01" }),
    });
    expect(errorsOf(future).registeredOn).toBe("A company cannot be registered in the future.");

    const longNumber = attempt(w, "admin", {
      type: "create_client",
      input: clientInput({ name: "Long Ltd", reference: "", registrationNumber: "x".repeat(41) }),
    });
    expect(errorsOf(longNumber).registrationNumber).toBe("Keep the registration number to 40 characters.");
  });

  it("keeps the certificate details when the rest of the record is edited", () => {
    const w = build();
    step(w, "admin", { type: "create_client", input: clientInput({ registrationNumber: "CS-1234567", registeredOn: "2019-04-12" }) });
    const saved = w.db.clients[0];

    step(w, "admin", {
      type: "update_client",
      id: saved.id,
      input: clientInput({ contactPhone: "0302000111", registrationNumber: saved.registrationNumber, registeredOn: saved.registeredOn }),
    });
    expect(w.db.clients[0].registrationNumber).toBe("CS-1234567");
    expect(w.db.clients[0].registeredOn).toBe("2019-04-12");
  });
});

describe("the branches of a customer, written as commands (CLI-01)", () => {
  const branchInput = (overrides: Record<string, unknown> = {}) => ({
    clientId: "ignored",
    name: "Tema depot",
    address: "Harbour Road, Gate 3",
    phone: "0244000111",
    contactName: "Yaw Mensah",
    ...overrides,
  });

  it("adds a branch under the customer, and the customer's own history shows who did it", () => {
    const w = build();
    step(w, "admin", { type: "create_client", input: clientInput() });
    const clientId = w.db.clients[0].id;

    step(w, "admin", { type: "create_client_location", input: { ...branchInput(), clientId } as never });

    expect(w.db.clientLocations).toHaveLength(1);
    const entry = w.db.audit.find((row) => row.action === "clients:location_create")!;
    expect(entry.entity).toBe("client");
    expect(entry.entityId).toBe(clientId);
    expect(entry.actorName).toBe("Admin");
    expect(entry.summary).toBe("Added branch Tema depot (Harbour Road, Gate 3) to Northstar Foods.");
  });

  it("closes a branch without throwing its address away, and says so in the history", () => {
    const w = build();
    step(w, "admin", { type: "create_client", input: clientInput() });
    const clientId = w.db.clients[0].id;
    step(w, "admin", { type: "create_client_location", input: { ...branchInput(), clientId } as never });
    const locationId = w.db.clientLocations[0].id;

    step(w, "admin", {
      type: "update_client_location",
      id: locationId,
      input: { ...branchInput(), clientId, status: "closed" } as never,
    });

    expect(w.db.clientLocations[0].status).toBe("closed");
    expect(w.db.clientLocations[0].address).toBe("Harbour Road, Gate 3");
    expect(w.db.audit[0].summary).toBe("Closed branch Tema depot of Northstar Foods. The address is kept.");
  });

  it("refuses a duplicate branch name and a branch on a customer that does not exist", () => {
    const w = build();
    step(w, "admin", { type: "create_client", input: clientInput() });
    const clientId = w.db.clients[0].id;
    step(w, "admin", { type: "create_client_location", input: { ...branchInput(), clientId } as never });

    const twice = attempt(w, "admin", { type: "create_client_location", input: { ...branchInput({ name: "tema DEPOT" }), clientId } as never });
    expect(twice.ok).toBe(false);
    expect(errorsOf(twice).name).toBe("This customer already has a branch with this name.");

    const orphan = attempt(w, "admin", { type: "create_client_location", input: { ...branchInput({ name: "Somewhere" }), clientId: "nobody" } as never });
    expect(orphan.ok).toBe(false);
    expect(errorsOf(orphan).clientId).toBe("Choose the customer this branch belongs to.");
  });

  it("is closed to a role that may read the client book but not change it", () => {
    const w = build();
    step(w, "admin", { type: "create_client", input: clientInput() });
    const clientId = w.db.clients[0].id;

    // Operations reads the client book to dispatch; it does not add branches to a customer.
    const denied = attempt(w, "ops", { type: "create_client_location", input: { ...branchInput(), clientId } as never });
    expect(denied.ok).toBe(false);
    expect(w.db.clientLocations).toHaveLength(0);
  });
});

describe("the invoice carries the buyer's details (CUS-01)", () => {
  /** A completed rental for a customer who is on the client register. */
  function completedRentalFor(clientId: string): World {
    const w = build();
    w.clientId = clientId;
    const categoryId = w.db.settings.vehicleCategories[0].id;
    step(w, "admin", { type: "create_client", input: clientInput() });
    w.clientId = w.db.clients[0].id;
    step(w, "ops", { type: "create_vehicle", input: { registration: "GT 500-26", categoryId, make: "Toyota", model: "Coaster", seatCapacity: "30", notes: "" } });
    step(w, "ops", {
      type: "create_rental",
      input: {
        clientId: w.clientId,
        customerName: "Northstar Foods",
        customerPhone: "0244000000",
        customerEmail: "efua@northstar.test",
        purpose: "Staff retreat",
        pickupLocation: "Accra",
        dropoffLocation: "Kumasi",
        startDate: "2026-06-01",
        endDate: "2026-06-03",
        passengers: "20",
        vehicleCategoryId: categoryId,
        driverRequired: false,
        notes: "",
      },
    });
    w.rentalId = w.db.rentals[0].id;
    const id = w.rentalId;
    step(w, "ops", { type: "quote_rental", id, input: { lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1500" }] } });
    step(w, "admin", { type: "confirm_rental", id, input: { amount: "600", method: "Bank transfer", reference: "SLIP-1" } });
    step(w, "ops", { type: "assign_rental", id, input: { vehicleId: w.db.vehicles[0].id, driverId: "" } });
    step(w, "ops", { type: "start_rental", id });
    step(w, "ops", { type: "complete_rental", id, input: { lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1500" }] } });
    return w;
  }

  it("copies the address and tax number onto the invoice when it is issued", () => {
    const w = completedRentalFor("");
    step(w, "finance", { type: "issue_rental_invoice", input: { rentalId: w.rentalId, issuedOn: "2026-06-01", discountAmount: "", discountReason: "", notes: "" } });

    const invoice = w.db.invoices[0];
    expect(invoice.customerName).toBe("Northstar Foods");
    expect(invoice.buyerAddress).toBe("Plot 12, Spintex Road, Accra");
    expect(invoice.buyerTin).toBe("C0012345678");
  });

  it("does not rewrite an issued invoice when the customer later moves", () => {
    const w = completedRentalFor("");
    step(w, "finance", { type: "issue_rental_invoice", input: { rentalId: w.rentalId, issuedOn: "2026-06-01", discountAmount: "", discountReason: "", notes: "" } });
    const issued = w.db.invoices[0];

    step(w, "admin", { type: "update_client", id: w.clientId, input: clientInput({ billingAddress: "Moved to Tema, opposite the port", tin: "C0099999999" }) });

    // The register moved; the document did not. That is the point of copying rather than looking up.
    expect(w.db.clients[0].billingAddress).toContain("Tema");
    const after = w.db.invoices.find((invoice) => invoice.id === issued.id)!;
    expect(after.buyerAddress).toBe("Plot 12, Spintex Road, Accra");
    expect(after.buyerTin).toBe("C0012345678");
  });

  it("prints nothing for a walk-in customer who has no register record", () => {
    const w = build();
    const categoryId = w.db.settings.vehicleCategories[0].id;
    step(w, "ops", { type: "create_vehicle", input: { registration: "GT 501-26", categoryId, make: "", model: "", seatCapacity: "30", notes: "" } });
    step(w, "ops", {
      type: "create_rental",
      input: {
        clientId: null,
        customerName: "Mr Owusu",
        customerPhone: "0200000000",
        customerEmail: "",
        purpose: "",
        pickupLocation: "Accra",
        dropoffLocation: "Koforidua",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        passengers: "4",
        vehicleCategoryId: categoryId,
        driverRequired: false,
        notes: "",
      },
    });
    const id = w.db.rentals[0].id;
    w.rentalId = id;
    step(w, "ops", { type: "quote_rental", id, input: { lines: [{ description: "One day hire", quantity: "1", unitAmount: "800" }] } });
    step(w, "admin", { type: "confirm_rental", id, input: { amount: "160", method: "Cash", reference: "" } });
    step(w, "ops", { type: "assign_rental", id, input: { vehicleId: w.db.vehicles[0].id, driverId: "" } });
    step(w, "ops", { type: "start_rental", id });
    step(w, "ops", { type: "complete_rental", id, input: { lines: [{ description: "One day hire", quantity: "1", unitAmount: "800" }] } });
    step(w, "finance", { type: "issue_rental_invoice", input: { rentalId: id, issuedOn: "2026-06-01", discountAmount: "", discountReason: "", notes: "" } });

    const invoice = w.db.invoices[0];
    expect(invoice.customerName).toBe("Mr Owusu");
    expect(invoice.buyerAddress).toBe("");
    expect(invoice.buyerTin).toBe("");
  });
});
