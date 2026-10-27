// What actually happened on a hire (RNT-07, D-118).
//
// The rules proven here are the ones a damage claim or a repeat price turns on: when the vehicle left
// and came back, how far it went and whether that figure was measured, and what was reported wrong.
import { describe, expect, it } from "vitest";
import { balanceLine, damageLine, distanceLine, readInstant, readRun, rentalBalance, runDuration, runLine, RUN_NOTE_LIMIT, toLocalInput } from "./run";
import { emptyDatabase, migrate, SCHEMA_VERSION, type Database, type Invoice, type Payment, type Rental } from "./types";

const NOW = "2026-06-12T17:30:00.000Z";
const STARTED = "2026-06-10T08:00:00.000Z";

describe("the times of a hire (RNT-07, D-118)", () => {
  it("keeps the moment the hire started when nobody types a departure", () => {
    const { run, problems } = readRun({}, { startedAt: STARTED, odometerStartKm: null }, NOW);
    expect(problems).toEqual({});
    expect(run?.departedAt).toBe(STARTED);
    // The return defaults to the completion itself: pressing complete is the office saying it is back.
    expect(run?.returnedAt).toBe(NOW);
  });

  it("accepts a wall clock from the form, and says so when it is unreadable", () => {
    expect(readInstant("2026-06-10T08:05")).toBe("2026-06-10T08:05:00.000Z");
    expect(readInstant("2026-06-10T08:05:00.000Z")).toBe("2026-06-10T08:05:00.000Z");
    expect(readInstant("last Tuesday")).toBeNull();
    expect(readInstant("")).toBeNull();
    const bad = readRun({ returnedAt: "last Tuesday" }, { startedAt: STARTED, odometerStartKm: null }, NOW);
    expect(bad.problems.returnedAt).toBe("Enter the date and time the vehicle came back.");
    expect(bad.run).toBeNull();
  });

  it("refuses a vehicle that came back before it left", () => {
    const { problems, run } = readRun({ returnedAt: "2026-06-09T09:00:00.000Z" }, { startedAt: STARTED, odometerStartKm: null }, NOW);
    expect(problems.returnedAt).toBe("The vehicle cannot come back before it left.");
    expect(run).toBeNull();
  });

  it("says how long the vehicle was out, in a unit a person would use", () => {
    expect(runDuration({ ...emptyRun(), departedAt: "2026-06-10T08:00:00.000Z", returnedAt: "2026-06-10T08:45:00.000Z" })).toBe("45 minutes");
    expect(runDuration({ ...emptyRun(), departedAt: "2026-06-10T08:00:00.000Z", returnedAt: "2026-06-10T09:00:00.000Z" })).toBe("1 hour");
    expect(runDuration({ ...emptyRun(), departedAt: "2026-06-10T08:00:00.000Z", returnedAt: "2026-06-11T17:30:00.000Z" })).toBe("33 h 30 min");
    expect(runDuration({ ...emptyRun(), departedAt: "2026-06-10T08:00:00.000Z", returnedAt: "2026-06-14T08:00:00.000Z" })).toBe("4 days");
    // Without both times there is no duration to state.
    expect(runDuration({ ...emptyRun(), departedAt: STARTED, returnedAt: null })).toBeNull();
  });
});

describe("the distance (RNT-07, D-118)", () => {
  it("is measured from two odometer readings, and says it was", () => {
    const { run, problems } = readRun({ odometerStartKm: "82140", odometerEndKm: "82354.5" }, { startedAt: STARTED, odometerStartKm: null }, NOW);
    expect(problems).toEqual({});
    expect(run?.distanceKm).toBe(214.5);
    expect(run?.distanceSource).toBe("odometer");
    expect(distanceLine(run!)).toBe("214.5 km (from the odometer)");
  });

  it("is what the office typed when there are no readings, and says that instead", () => {
    const { run, problems } = readRun({ distanceKm: "180" }, { startedAt: STARTED, odometerStartKm: null }, NOW);
    expect(problems).toEqual({});
    expect(run?.distanceKm).toBe(180);
    expect(run?.distanceSource).toBe("entered");
    expect(distanceLine(run!)).toBe("180 km (entered by the office, not from an odometer reading)");
  });

  it("refuses two answers to the same question rather than picking one", () => {
    const { problems, run } = readRun({ odometerStartKm: "100", odometerEndKm: "300", distanceKm: "150" }, { startedAt: STARTED, odometerStartKm: null }, NOW);
    expect(problems.distanceKm).toBe("The odometer readings give 200 km. Remove the typed distance, or correct a reading.");
    expect(run).toBeNull();
  });

  it("refuses a closing reading that went backwards, and a reading on its own", () => {
    expect(readRun({ odometerStartKm: "900", odometerEndKm: "800" }, { startedAt: STARTED, odometerStartKm: null }, NOW).problems.odometerEndKm).toMatch(/lower than the reading at departure/);
    expect(readRun({ odometerEndKm: "800" }, { startedAt: STARTED, odometerStartKm: null }, NOW).problems.odometerStartKm).toMatch(/Enter the reading at departure too/);
  });

  it("refuses a distance that is not a number of kilometres", () => {
    expect(readRun({ distanceKm: "12.34" }, { startedAt: STARTED, odometerStartKm: null }, NOW).problems.distanceKm).toMatch(/one decimal place/);
    expect(readRun({ distanceKm: "0" }, { startedAt: STARTED, odometerStartKm: null }, NOW).problems.distanceKm).toMatch(/more than 0/);
    expect(readRun({ distanceKm: "9999999" }, { startedAt: STARTED, odometerStartKm: null }, NOW).problems.distanceKm).toMatch(/looks wrong/);
  });

  it("invents no distance when nobody recorded one", () => {
    const { run } = readRun({}, { startedAt: STARTED, odometerStartKm: null }, NOW);
    expect(run?.distanceKm).toBeNull();
    expect(run?.distanceSource).toBeNull();
    expect(distanceLine(run!)).toBeNull();
  });
});

describe("damage and what the customer said (RNT-07, D-118)", () => {
  it("records a damage note, and says plainly when nothing was reported", () => {
    const { run } = readRun({ damageNotes: "  Cracked near-side mirror.  " }, { startedAt: STARTED, odometerStartKm: null }, NOW);
    expect(run?.damageNotes).toBe("Cracked near-side mirror.");
    expect(damageLine(run!)).toBe("Cracked near-side mirror.");
    expect(damageLine(readRun({}, { startedAt: STARTED, odometerStartKm: null }, NOW).run!)).toBe("Nothing was reported damaged when the vehicle came back.");
  });

  it("keeps the customer's words", () => {
    const { run } = readRun({ feedback: "Driver was punctual; they will book again." }, { startedAt: STARTED, odometerStartKm: null }, NOW);
    expect(run?.feedback).toBe("Driver was punctual; they will book again.");
  });

  it("refuses a note longer than a person will read", () => {
    const long = "x".repeat(RUN_NOTE_LIMIT + 1);
    expect(readRun({ damageNotes: long }, { startedAt: STARTED, odometerStartKm: null }, NOW).problems.damageNotes).toMatch(/under 1000 characters/);
    expect(readRun({ feedback: long }, { startedAt: STARTED, odometerStartKm: null }, NOW).problems.feedback).toMatch(/under 1000 characters/);
  });
});

describe("the sentence the record prints (RNT-07, D-118)", () => {
  it("says when it left, when it came back and for how long", () => {
    const run = readRun({ returnedAt: "2026-06-11T17:30:00.000Z" }, { startedAt: STARTED, odometerStartKm: null }, NOW).run!;
    expect(runLine(run)).toBe("Left 10 Jun 2026, 08:00, back 11 Jun 2026, 17:30 — 33 h 30 min on the road.");
  });

  it("admits when nothing is recorded at all", () => {
    expect(runLine(null)).toBe("Nothing is recorded about this hire's journey: no departure, no return, no distance.");
    expect(damageLine(null)).toBe("No damage was recorded with this hire.");
  });

  it("round-trips a time into the form's own field", () => {
    expect(toLocalInput("2026-06-10T08:05:00.000Z")).toBe("2026-06-10T08:05");
    expect(toLocalInput(null)).toBe("");
  });
});

describe("what the hire cost and what is still owed (RNT-07)", () => {
  const rental = (overrides: Partial<Rental> = {}): Rental => ({
    id: "r1",
    reference: "RR-0001",
    clientId: null,
    customerName: "Acme Ltd",
    customerPhone: "",
    customerEmail: "",
    purpose: "Shuttle",
    pickupLocation: "Accra",
    dropoffLocation: "Tema",
    startDate: "2026-06-10",
    endDate: "2026-06-11",
    passengers: 10,
    vehicleCategoryId: "c1",
    driverRequired: true,
    notes: "",
    status: "completed",
    quote: null,
    quoteHistory: [],
    acceptance: null,
    run: null,
    plan: null,
    assignedVehicleId: "v1",
    assignedDriverId: null,
    deposit: null,
    finalInvoice: null,
    resolutionReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
    id: "inv1",
    reference: "INV-2026-0001",
    kind: "rental",
    rentalId: "r1",
    clientId: null,
    customerName: "Acme Ltd",
    buyerAddress: "",
    buyerTin: "",
    currencyCode: "GHS",
    lines: [{ id: "l1", description: "Two days hire", quantity: 2, unitAmount: 2000 }],
    taxLines: [],
    subtotal: 4000,
    total: 4000,
    amountPaid: 0,
    status: "issued",
    billableEvent: "rental:r1:final",
    issuedOn: "2026-06-12",
    dueOn: "2026-06-26",
    notes: "",
    voidReason: null,
    voidedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  const payment = (amount: number): Payment => ({
    id: "p1",
    reference: "PAY-2026-0001",
    invoiceId: "inv1",
    amount,
    currencyCode: "GHS",
    method: "Bank transfer",
    paidOn: "2026-06-20",
    externalReference: "",
    status: "recorded",
    note: "",
    log: [],
    recordedBy: "Fin",
    recordedAt: NOW,
    voidReason: null,
    voidedAt: null,
  });

  it("states the balance from the invoice and the money against it", () => {
    const db: Database = { ...emptyDatabase(), rentals: [rental()], invoices: [invoice()], payments: [payment(1000)] };
    const balance = rentalBalance(db, db.rentals[0]);
    expect(balance?.outstanding).toBe(3000);
    expect(balanceLine(balance)).toBe("Invoice INV-2026-0001: GHS 4000.00 billed, GHS 3000.00 still outstanding.");
  });

  it("says a settled hire is settled", () => {
    const db: Database = { ...emptyDatabase(), rentals: [rental()], invoices: [invoice()], payments: [payment(4000)] };
    expect(balanceLine(rentalBalance(db, db.rentals[0]))).toBe("Invoice INV-2026-0001 is settled: GHS 4000.00 billed, nothing outstanding.");
  });

  it("does not confuse a void invoice with a bill, nor nothing billed with nothing owed", () => {
    const voided: Database = { ...emptyDatabase(), rentals: [rental()], invoices: [invoice({ status: "void", voidReason: "Wrong customer" })] };
    expect(rentalBalance(voided, voided.rentals[0])).toBeNull();
    const unbilled: Database = { ...emptyDatabase(), rentals: [rental()] };
    expect(rentalBalance(unbilled, unbilled.rentals[0])).toBeNull();
    expect(balanceLine(null)).toBeNull();
  });
});

describe("older backups (schema 33)", () => {
  it("leaves a hire with no journey recorded rather than inventing one", () => {
    const base = emptyDatabase();
    const legacy = {
      ...base,
      schemaVersion: 32,
      rentals: [
        {
          id: "r1",
          reference: "RR-0001",
          clientId: null,
          customerName: "Acme Ltd",
          customerPhone: "",
          customerEmail: "",
          purpose: "Shuttle",
          pickupLocation: "Accra",
          dropoffLocation: "Tema",
          startDate: "2026-06-10",
          endDate: "2026-06-11",
          passengers: 10,
          vehicleCategoryId: "c1",
          driverRequired: true,
          notes: "",
          status: "completed",
          quote: null,
          quoteHistory: [],
          acceptance: null,
          assignedVehicleId: "v1",
          assignedDriverId: null,
          deposit: null,
          finalInvoice: null,
          resolutionReason: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    };
    const migrated = migrate(legacy)!;
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.rentals[0].run).toBeNull();
  });
});

function emptyRun() {
  return {
    departedAt: null,
    returnedAt: null,
    odometerStartKm: null,
    odometerEndKm: null,
    distanceKm: null,
    distanceSource: null,
    damageNotes: "",
    feedback: "",
    recordedBy: "",
    recordedAt: NOW,
  };
}
