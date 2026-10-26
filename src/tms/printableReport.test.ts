// The management report as a printed document (RPT-05, D-98).
//
// The property that matters is not the layout: it is that the paper says the same thing as the screen
// and never says more. So these tests check four things:
//
//   1. every figure is the report's own number, not a second addition;
//   2. a figure that cannot be stated is withheld, with the reason on the page — never printed as
//      zero, and never printed bare without a currency;
//   3. tables that are empty say so, and the coverage counts travel with the report;
//   4. the sheet names the limits a reader of the paper would otherwise have to know in advance.
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { financialReport } from "./financialReport";
import { periodLabel, printableReport, printableReportFileName } from "./printableReport";
import { rentalReport } from "./rentalReport";
import { execute, type Actor, type Credential } from "./service";
import { emptyDatabase, emptyRentalSettings, type Database } from "./types";

const NOW = "2026-06-12T08:30:00.000Z";
const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

function run(db: Database, actor: Actor | null, command: AnyCommand): Database {
  const result = executeCommand(db, actor, command, NOW);
  if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
  return result.db;
}

/**
 * One client, one hire quoted, confirmed, completed and invoiced, one payment, one payment recorded
 * in error, and one cost. Enough that every section of the sheet has something in it.
 */
function world(currencyCode: string | null = "GHS"): Database {
  let db = emptyDatabase();
  const setup = execute(db, null, { type: "setup_administrator", input: { fullName: "Admin One", email: "admin@example.test" }, credential: cred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  db = setup.db;
  const admin: Actor = { id: db.users[0].id, fullName: "Admin One", role: "administrator" };
  db = run(db, admin, {
    type: "update_settings",
    input: {
      ...db.settings,
      companyName: "Richie Transport Services",
      currencyCode,
      rental: {
        ...emptyRentalSettings(),
        pricingBasis: "per_day",
        depositPercent: 0,
        quotationValidityDays: 30,
        driversAlwaysIncluded: false,
        paymentMethods: ["cash"],
      },
      invoiceDueDays: 14,
      taxPosition: "not_registered",
      taxLines: [],
      vehicleCategories: [{ id: "", name: "Coaster" }],
      shifts: [],
      costCategories: ["Fuel", "Parts"],
      booking: { requestCutoffMinutes: null, cancellationCutoffMinutes: null },
    },
  });
  const category = db.settings.vehicleCategories[0].id;
  db = run(db, admin, { type: "create_vehicle", input: { registration: "GT 100-26", categoryId: category, make: "", model: "", seatCapacity: "30", notes: "" } });
  db = run(db, admin, {
    type: "create_client",
    input: { name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" },
  });
  db = run(db, admin, {
    type: "create_rental",
    input: {
      clientId: db.clients[0].id,
      customerName: "Acme Ltd",
      customerPhone: "",
      customerEmail: "",
      purpose: "Staff shuttle",
      pickupLocation: "Accra",
      dropoffLocation: "Tema",
      startDate: "2026-06-10",
      endDate: "2026-06-16",
      passengers: "20",
      vehicleCategoryId: category,
      driverRequired: false,
      notes: "",
    },
  });
  const rentalId = db.rentals[0].id;
  db = run(db, admin, {
    type: "quote_rental",
    id: rentalId,
    input: { lines: [{ description: "Two days", quantity: "2", unitAmount: "1000.00" }] },
  });
  // A confirmed hire needs a vehicle; a driver is taken only when the request asked for one.
  db = run(db, admin, { type: "confirm_rental", id: rentalId, input: { amount: "0.00", method: "cash", reference: "" } });
  db = run(db, admin, { type: "assign_rental", id: rentalId, input: { vehicleId: db.vehicles[0].id, driverId: "" } });
  db = run(db, admin, { type: "start_rental", id: rentalId });
  db = run(db, admin, {
    type: "complete_rental",
    id: rentalId,
    input: { lines: [{ description: "Two days", quantity: "2", unitAmount: "1000.00" }] },
  });
  db = run(db, admin, {
    type: "issue_rental_invoice",
    input: { rentalId, issuedOn: "2026-06-12", discountAmount: "", discountReason: "", notes: "" },
  });
  const invoiceId = db.invoices[0].id;
  db = run(db, admin, { type: "record_payment", input: { invoiceId, amount: "500.00", method: "cash", paidOn: "2026-06-12", externalReference: "RCPT-1", note: "" } });
  // A cost line, so the cost section has a figure rather than an empty table.
  db = run(db, admin, {
    type: "record_expense",
    input: { incurredOn: "2026-06-12", category: "Fuel", description: "Fuel", payee: "", amount: "120.00", method: "", receiptReference: "", receiptHeld: false, notes: "" },
  });
  return db;
}

const sheetOf = (db: Database) =>
  printableReport({
    rental: rentalReport(db, "2026-06-01", "2026-06-30"),
    financial: financialReport(db, "2026-06-01", "2026-06-30"),
    companyName: db.settings.companyName,
    generatedAt: NOW,
  });

describe("printed management report - the figures are the report's own", () => {
  it("prints the money the reports calculated, and nothing it worked out itself", () => {
    const db = world();
    const report = rentalReport(db, "2026-06-01", "2026-06-30");
    const money = financialReport(db, "2026-06-01", "2026-06-30");
    const sheet = sheetOf(db);

    const figure = (label: string) => sheet.figures.find((item) => item.label === label)!.value;
    expect(figure("Invoiced")).toBe(`GHS ${money.invoicedTotal.toFixed(2)}`);
    expect(figure("Received")).toBe(`GHS ${money.receivedTotal.toFixed(2)}`);
    expect(figure("Owed at period end")).toBe(`GHS ${money.outstandingTotal.toFixed(2)}`);
    expect(figure("Costs recorded")).toBe(`GHS ${money.expensesTotal.toFixed(2)}`);
    expect(figure("Requests received")).toBe(String(report.enquiries));
    expect(figure("Hires completed")).toBe(String(report.completed));
    // The hire was invoiced at 2 000 and 500 has been paid: the two figures are not the same number.
    expect(money.invoicedTotal).toBe(2000);
    expect(money.receivedTotal).toBe(500);
  });

  it("carries each customer's row, each category and the reason a hire was lost", () => {
    const db = world();
    const sheet = sheetOf(db);
    const section = (id: string) => sheet.sections.find((item) => item.id === id)!;

    const customers = section("revenue-by-customer");
    expect(customers.rows).toHaveLength(1);
    expect(customers.rows[0][0]).toBe("Acme Ltd");
    expect(customers.rows[0].slice(2)).toEqual(["GHS 2000.00", "GHS 500.00", "GHS 1500.00"]);

    expect(section("costs-by-category").rows[0]).toEqual(["Fuel", "1", "GHS 120.00"]);
    expect(section("revenue-by-service").rows[0][0]).toBe("Vehicle hire");
    expect(section("utilisation").rows[0][0]).toBe("Rental vehicle-days committed");
    // No hire was cancelled in this scenario, so that table says so rather than sitting empty.
    expect(section("why-lost").rows).toEqual([]);
    expect(section("why-lost").empty).toMatch(/No rental was cancelled or declined/i);
  });

  it("states the count behind every 'not available', so a gap is never read as zero", () => {
    const db = world();
    const sheet = sheetOf(db);
    const perUnit = sheet.sections.find((item) => item.id === "cost-per")!;
    // No staff run was completed and nobody boarded, so both per-unit figures are withheld with the
    // denominator printed beside them.
    expect(perUnit.rows[0][1]).toBe("Not available");
    expect(perUnit.rows[0][2]).toBe("0 runs completed");
    expect(perUnit.rows[1][1]).toBe("Not available");
    expect(perUnit.rows[1][2]).toBe("0 riders boarded");
  });
});

/** The same records with the company currency cleared: what a sheet looks like before Settings is done. */
const withoutCurrency = (db: Database): Database => ({ ...db, settings: { ...db.settings, currencyCode: null } });

describe("printed management report - money it cannot state", () => {
  it("withholds every amount when no currency is set, and says why on the page", () => {
    const db = withoutCurrency(world());
    const sheet = sheetOf(db);
    expect(sheet.state).toBe("withheld");
    expect(sheet.stateLabel).toMatch(/no currency is set/i);
    expect(sheet.stateDetail).toMatch(/a bare figure would be read as a currency/i);

    // Not one cell on the sheet claims to be money.
    const everyCell = [...sheet.figures.map((f) => f.value), ...sheet.sections.flatMap((s) => s.rows.flat())];
    expect(everyCell.filter((cell) => /GHS|Not stated/.test(cell)).every((cell) => cell === "Not stated")).toBe(true);
    expect(everyCell.some((cell) => /\d+\.\d\d/.test(cell))).toBe(false);
    expect(sheet.figures.find((f) => f.label === "Invoiced")!.value).toBe("Not stated");
    expect(sheet.notes.join(" ")).toMatch(/No company currency is set/i);
  });

  it("still prints the counts, because they are true without a currency", () => {
    const db = withoutCurrency(world());
    const sheet = sheetOf(db);
    expect(sheet.figures.find((f) => f.label === "Requests received")!.value).toBe("1");
    expect(sheet.figures.find((f) => f.label === "Hires completed")!.value).toBe("1");
  });

  it("refuses to describe a backwards period as a report", () => {
    const db = world();
    const sheet = printableReport({
      rental: rentalReport(db, "2026-06-30", "2026-06-01"),
      financial: financialReport(db, "2026-06-30", "2026-06-01"),
      companyName: "Richie Transport Services",
      generatedAt: NOW,
    });
    expect(sheet.state).toBe("withheld");
    expect(sheet.stateLabel).toMatch(/wrong way round/i);
    expect(sheet.stateDetail).toMatch(/Nothing on this page is a report of any period/i);
  });
});

describe("printed management report - what the page tells its reader", () => {
  it("names the company, the period and when it was printed", () => {
    const sheet = sheetOf(world());
    expect(sheet.companyName).toBe("Richie Transport Services");
    expect(sheet.period).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(sheet.generatedAt).toBe(NOW);
    expect(sheet.reference).toBe("RPT-2026-06-01-to-2026-06-30-202606120830");
    expect(printableReportFileName(sheet)).toBe("management-report-2026-06-01-to-2026-06-30.pdf");
  });

  it("leaves the company name as a gap when Settings has none", () => {
    const db = world();
    const sheet = printableReport({
      rental: rentalReport(db, "2026-06-01", "2026-06-30"),
      financial: financialReport(db, "2026-06-01", "2026-06-30"),
      companyName: null,
      generatedAt: NOW,
    });
    expect(sheet.companyName).toBeNull();
  });

  it("carries the coverage counts and the definitions a reader would otherwise assume", () => {
    const sheet = sheetOf(world());
    const coverage = Object.fromEntries(sheet.coverage.map((item) => [item.label, item.value]));
    expect(coverage["Requests never quoted"]).toBe("0");
    expect(coverage["Uncategorised cost lines"]).toBe("0");
    expect(sheet.coverage.every((item) => item.note.length > 0)).toBe(true);

    const notes = sheet.notes.join(" ");
    expect(notes).toMatch(/Only vehicle hire is invoiced/i);
    expect(notes).toMatch(/Outstanding is valued at the period end/i);
    expect(notes).toMatch(/a payment made after that date does not settle/i);
    expect(notes).toMatch(/All amounts are in GHS/i);
  });

  it("writes the period the way a person reads it", () => {
    expect(periodLabel("2026-06-01", "2026-06-30")).toBe("1 – 30 June 2026");
    expect(periodLabel("2026-05-28", "2026-06-04")).toBe("28 May – 4 June 2026");
    expect(periodLabel("2025-12-20", "2026-01-05")).toBe("20 December 2025 – 5 January 2026");
    expect(periodLabel("nonsense", "2026-01-05")).toBe("nonsense to 2026-01-05");
  });
});
