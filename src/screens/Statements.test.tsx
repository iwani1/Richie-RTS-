// @vitest-environment jsdom
// The statements screen (FIN-02, D-90).
//
// A statement is the document an office sends when it chases money, so what is checked here is that
// the screen tells the same story as the paper: the customer's balance as it stands, what moved in the
// period, the age of the debt in bands, and an honest refusal when the account cannot be stated —
// mixed currencies, or no invoice yet. One test also pins the point the whole feature rests on: a
// cancelled payment is not the customer's money and must not appear on their statement.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatementsPage } from "./Statements";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, emptyRentalSettings, type CreditNote, type Database, type Invoice, type Payment, type User } from "../tms/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const at = "2026-06-01T09:00:00.000Z";

const admin: User = {
  id: "u1",
  fullName: "Ama Mensah",
  email: "ama@example.test",
  role: "administrator",
  active: true,
  driverId: null,
  clientId: null,
  primaryContact: false,
  passwordHash: "",
  passwordSalt: "",
  createdAt: at,
  updatedAt: at,
};

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "i1",
  reference: "INV-2026-0001",
  kind: "rental",
  rentalId: null,
  clientId: null,
  customerName: "Acme Ltd",
  currencyCode: "GHS",
  lines: [{ id: "l1", description: "Two days hire", quantity: 2, unitAmount: 2000 }],
  taxLines: [{ name: "VAT", ratePercent: 15, amount: 600 }],
  subtotal: 4000,
  total: 4600,
  amountPaid: 1000,
  status: "part_paid",
  billableEvent: "rental:r1:final",
  issuedOn: "2026-06-01",
  dueOn: "2026-06-15",
  notes: "",
  voidReason: null,
  voidedAt: null,
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: "p1",
  reference: "PAY-2026-0001",
  invoiceId: "i1",
  amount: 1000,
  currencyCode: "GHS",
  method: "Bank transfer",
  paidOn: "2026-06-10",
  externalReference: "",
  status: "recorded",
  note: "",
  log: [],
  recordedBy: "Ama Mensah",
  recordedAt: at,
  voidReason: null,
  voidedAt: null,
  ...overrides,
});

const creditNote = (overrides: Partial<CreditNote> = {}): CreditNote => ({
  id: "cn1",
  reference: "CN-2026-0001",
  invoiceId: "i1",
  invoiceReference: "INV-2026-0001",
  clientId: null,
  customerName: "Acme Ltd",
  currencyCode: "GHS",
  lines: [{ id: "cl1", description: "One day not operated", quantity: 1, unitAmount: 500 }],
  taxLines: [{ name: "VAT", ratePercent: 15, amount: 75 }],
  subtotal: 500,
  total: 575,
  reason: "One day not operated",
  issuedOn: "2026-06-20",
  status: "issued",
  voidReason: null,
  voidedAt: null,
  createdBy: "Ama Mensah",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const base = (): Database => {
  const db = emptyDatabase();
  return {
    ...db,
    users: [admin],
    invoices: [invoice(), invoice({ id: "i2", reference: "INV-2026-0002", customerName: "Harbour Logistics", issuedOn: "2026-06-05", dueOn: "2026-06-20", total: 900, subtotal: 900, taxLines: [] })],
    payments: [payment()],
    creditNotes: [creditNote()],
    settings: {
      ...db.settings,
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      rental: { ...emptyRentalSettings(), pricingBasis: "per_day", depositPercent: 20, quotationValidityDays: 14, paymentMethods: ["Bank transfer"] },
      taxPosition: "registered",
      taxLines: [{ id: "", name: "VAT", ratePercent: 15 }],
      invoiceDueDays: 14,
    },
  };
};

function makeTms(db: Database): Tms {
  return {
    db,
    actor: { id: admin.id, fullName: admin.fullName, role: admin.role },
    currentUser: admin,
    status: "ready",
    connectionError: null,
    auditTotal: 0,
    setupRequired: false,
    flash: null,
    busy: false,
    setFlash: () => {},
    allowed: () => true,
    dispatch: vi.fn(async () => ({ ok: true, message: "" }) as CommandResult),
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
  } as unknown as Tms;
}

const renderStatements = (db: Database = base()) => {
  render(
    <TmsContext.Provider value={makeTms(db)}>
      <StatementsPage />
    </TmsContext.Provider>,
  );
  return db;
};

/** Opening a customer's statement is one click on their name in the list. */
const openCustomer = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));

/**
 * The screen opens on the current month, and these tests are written against June 2026 in a fixture
 * that cannot move. Setting the period explicitly keeps them from depending on the day they run.
 */
const setPeriod = (from: string, to: string) => {
  fireEvent.change(screen.getByLabelText(/^From/), { target: { value: from } });
  fireEvent.change(screen.getByLabelText(/^As at/), { target: { value: to } });
};

const openJuneStatement = (name: RegExp) => {
  setPeriod("2026-06-01", "2026-06-30");
  openCustomer(name);
};

describe("the statements screen", () => {
  it("lists the customers who have been invoiced, with what each owes", () => {
    renderStatements();
    expect(screen.getByText("Acme Ltd")).toBeTruthy();
    expect(screen.getByText("Harbour Logistics")).toBeTruthy();
    // Acme: 4,600 invoiced less 1,000 paid less 575 credited = 3,025.
    expect(screen.getByText("GHS 3025.00")).toBeTruthy();
    expect(screen.getByText("GHS 900.00")).toBeTruthy();
    // Nothing is on screen until a customer is chosen, and the paper is not offered before then.
    expect(screen.getByText("No customer chosen")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Print statement/i })).toHaveProperty("disabled", true);
  });

  it("states the account once a customer is chosen", () => {
    renderStatements();
    openJuneStatement(/Acme Ltd/);

    expect(screen.getByText("Brought forward")).toBeTruthy();
    // June for Acme: 4,600 invoiced, 1,000 received, 575 credited, nothing carried in.
    const invoiced = screen.getByText("Invoiced").closest(".rts-stat") as HTMLElement;
    expect(within(invoiced).getByText("GHS 4600.00")).toBeTruthy();
    const received = screen.getByText("Received").closest(".rts-stat") as HTMLElement;
    expect(within(received).getByText("GHS 1000.00")).toBeTruthy();
    const credited = screen.getByText("Credited").closest(".rts-stat") as HTMLElement;
    expect(within(credited).getByText("GHS 575.00")).toBeTruthy();
    const closing = screen.getByText("Balance due").closest(".rts-stat") as HTMLElement;
    expect(within(closing).getByText("GHS 3025.00")).toBeTruthy();

    // The rows are the documents, each with its own date and number. An invoice appears twice — once
    // as an entry in the period and once in the list of what is still owing — which is intended.
    expect(screen.getAllByText("INV-2026-0001").length).toBe(2);
    expect(screen.getByText("PAY-2026-0001")).toBeTruthy();
    expect(screen.getByText("CN-2026-0001")).toBeTruthy();
    // The other customer's invoice is not on this statement.
    expect(screen.queryByText("INV-2026-0002")).toBeNull();
    expect(screen.getByRole("button", { name: /Print statement/i })).toHaveProperty("disabled", false);
  });

  it("says what is late, in days and in bands", () => {
    renderStatements();
    openJuneStatement(/Acme Ltd/);

    // The four bands are named, with a sentence saying what each one is worth doing about.
    expect(screen.getByText("1–30 days late")).toBeTruthy();
    expect(screen.getByText("worth a reminder")).toBeTruthy();
    expect(screen.getByText("Over 60 days late")).toBeTruthy();
    // Acme's invoice was due 15 June and is 15 days late as at 30 June: 3,025 in the first band.
    expect(screen.getAllByText("GHS 3025.00").length).toBeGreaterThan(0);
    expect(screen.getByText("15 days")).toBeTruthy();
  });

  it("carries a balance in when the period starts after the invoice", () => {
    renderStatements();
    setPeriod("2026-07-01", "2026-07-31");
    openCustomer(/Harbour Logistics/);
    // Harbour's only invoice is dated 5 June, so a July statement has no rows and carries the debt in.
    expect(screen.getByText("Nothing moved")).toBeTruthy();
    const broughtForward = screen.getByText("Brought forward").closest(".rts-stat") as HTMLElement;
    expect(within(broughtForward).getByText("GHS 900.00")).toBeTruthy();
  });

  it("finds a customer by name", () => {
    renderStatements();
    fireEvent.change(screen.getByLabelText("Find a customer"), { target: { value: "harbour" } });
    expect(screen.getByRole("button", { name: /Harbour Logistics/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Acme Ltd/ })).toBeNull();
  });

  it("leaves a cancelled payment off the statement", () => {
    const db = base();
    renderStatements({
      ...db,
      payments: [
        payment(),
        payment({ id: "p2", reference: "PAY-2026-0002", amount: 700, paidOn: "2026-06-12", voidReason: "Bounced", voidedAt: "2026-06-13T09:00:00.000Z" }),
      ],
    });
    openJuneStatement(/Acme Ltd/);
    // The cancelled payment is not the customer's money, so neither the row nor the total carries it.
    expect(screen.queryByText("PAY-2026-0002")).toBeNull();
    const received = screen.getByText("Received").closest(".rts-stat") as HTMLElement;
    expect(within(received).getByText("GHS 1000.00")).toBeTruthy();
  });

  it("prints the statement as a document once one is on screen", () => {
    renderStatements();
    openJuneStatement(/Acme Ltd/);
    fireEvent.click(screen.getByRole("button", { name: /Print statement/i }));

    expect(screen.getByRole("dialog", { name: "Print preview: Statement for Acme Ltd" })).toBeTruthy();
    const sheet = screen.getByRole("article", { name: "Statement for Acme Ltd" });
    expect(within(sheet).getByText("Statement of account")).toBeTruthy();
    expect(within(sheet).getByText("Balance due")).toBeTruthy();
    // 4,600 invoiced less 1,000 received less 575 credited.
    expect(within(sheet).getAllByText("GHS 3025.00").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses to state an account whose invoices are in two currencies", () => {
    const db = base();
    renderStatements({ ...db, invoices: [{ ...db.invoices[0] }, { ...db.invoices[1], customerName: "Acme Ltd", currencyCode: "USD" }] });
    openJuneStatement(/Acme Ltd/);
    expect(screen.getByText("This account cannot be stated")).toBeTruthy();
    expect(screen.getByText(/GHS, USD/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Print statement/i })).toHaveProperty("disabled", true);
  });

  it("says so when no customer has been invoiced at all", () => {
    const db = base();
    renderStatements({ ...db, invoices: [], payments: [], creditNotes: [] });
    expect(screen.getByText("Nothing to state yet")).toBeTruthy();
    expect(screen.getByText(/An invoice has to be issued before a customer has an account to state/)).toBeTruthy();
  });
});
