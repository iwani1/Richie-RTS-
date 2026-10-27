// @vitest-environment jsdom
// The documents that leave the building (FIN-02, D-86, D-87).
//
// Three things are being pinned here, and none of them is cosmetic. First, the figures a customer
// reads on paper must be the figures the screen shows — the amount due comes from the same balance
// helper, and a credited or refunded invoice says so instead of printing a stale total. Second, a
// document that does not stand says so in words at the top: a void invoice cannot go out looking
// payable. Third, nothing is invented: a company name that was never set is named as missing.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreditNoteSheet, InvoiceSheet, PrintPreview, StatementSheet } from "./Documents";
import { customerStatement } from "../tms/customerStatement";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import {
  emptyDatabase,
  emptyRentalSettings,
  type CreditNote,
  type Database,
  type Invoice,
  type Payment,
  type Refund,
  type Rental,
  type User,
} from "../tms/types";

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
  passengerId: null,
  primaryContact: false,
  passwordHash: "",
  passwordSalt: "",
  createdAt: at,
  updatedAt: at,
};

const invoice: Invoice = {
  id: "i1",
  reference: "INV-2026-0001",
  kind: "rental",
  rentalId: "r1",
  clientId: null,
  customerName: "Acme Ltd",
  buyerAddress: "",
  buyerTin: "",
  currencyCode: "GHS",
  lines: [
    { id: "l1", description: "Two days hire", quantity: 2, unitAmount: 1500 },
    { id: "l2", description: "Extra day", quantity: 1, unitAmount: 500 },
  ],
  taxLines: [{ name: "VAT", ratePercent: 15, amount: 525 }],
  subtotal: 3500,
  total: 4025,
  amountPaid: 1000,
  status: "part_paid",
  billableEvent: "rental:r1:final",
  issuedOn: "2026-06-01",
  dueOn: "2026-06-15",
  notes: "Thank you for your business.",
  voidReason: null,
  voidedAt: null,
  createdAt: at,
  updatedAt: at,
};

const payment: Payment = {
  id: "p1",
  reference: "PAY-2026-0001",
  invoiceId: invoice.id,
  amount: 1000,
  currencyCode: "GHS",
  method: "Bank transfer",
  paidOn: "2026-06-03",
  externalReference: "",
  status: "recorded",
  note: "",
  log: [],
  recordedBy: "Ama Mensah",
  recordedAt: at,
  voidReason: null,
  voidedAt: null,
};

const creditNote: CreditNote = {
  id: "cn1",
  reference: "CN-2026-0001",
  invoiceId: invoice.id,
  invoiceReference: invoice.reference,
  clientId: null,
  customerName: "Acme Ltd",
  currencyCode: "GHS",
  lines: [{ id: "cl1", description: "Airport transfer not operated", quantity: 1, unitAmount: 500 }],
  taxLines: [{ name: "VAT", ratePercent: 15, amount: 75 }],
  subtotal: 500,
  total: 575,
  reason: "Service not delivered",
  issuedOn: "2026-06-04",
  status: "issued",
  voidReason: null,
  voidedAt: null,
  createdBy: "Ama Mensah",
  createdAt: at,
  updatedAt: at,
};

const rental: Rental = {
  id: "r1",
  reference: "RR-0007",
  clientId: null,
  customerName: "Acme Ltd",
  customerPhone: "",
  customerEmail: "",
  purpose: "",
  pickupLocation: "",
  dropoffLocation: "",
  startDate: "2026-06-01",
  endDate: "2026-06-03",
  passengers: 20,
  vehicleCategoryId: "cat-1",
  driverRequired: false,
  notes: "",
  status: "completed",
  quote: null,
  quoteHistory: [],
  acceptance: null,
      run: null,
  assignedVehicleId: null,
  assignedDriverId: null,
  deposit: null,
  finalInvoice: null,
  resolutionReason: null,
  createdAt: at,
  updatedAt: at,
};

function world(overrides: Partial<Database> = {}): Database {
  const db = emptyDatabase();
  return {
    ...db,
    users: [admin],
    rentals: [rental],
    invoices: [invoice],
    payments: [payment],
    settings: {
      ...db.settings,
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      rental: { ...emptyRentalSettings(), quotationTerms: "Prices are firm for the validity period.", pricingBasis: "per_day", depositPercent: 20, quotationValidityHours: 336, paymentMethods: ["Cash"] },
      taxPosition: "registered",
      taxLines: [{ id: "", name: "VAT", ratePercent: 15 }],
      invoiceDueDays: 14,
    },
    ...overrides,
  };
}

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

const renderSheet = (ui: React.ReactNode, db: Database = world()) => {
  render(<TmsContext.Provider value={makeTms(db)}>{ui}</TmsContext.Provider>);
};

describe("the invoice a customer receives (FIN-02, D-87)", () => {
  it("carries the supplier, the customer, the lines and the amount still owed", () => {
    renderSheet(<InvoiceSheet invoice={invoice} />);

    const sheet = screen.getByRole("article", { name: /Invoice INV-2026-0001/i });
    expect(within(sheet).getByText("Richie Transport Services")).toBeTruthy();
    expect(within(sheet).getByText("Acme Ltd")).toBeTruthy();
    expect(within(sheet).getByText("RR-0007")).toBeTruthy();
    expect(within(sheet).getByText("Two days hire")).toBeTruthy();
    expect(within(sheet).getByText("GHS 3000.00")).toBeTruthy(); // 2 × 1,500
    expect(within(sheet).getByText("GHS 4025.00")).toBeTruthy(); // total
    expect(within(sheet).getByText("VAT at 15%")).toBeTruthy();
    // 4,025 total less 1,000 received: the figure the screen also shows.
    expect(within(sheet).getByText("Amount due")).toBeTruthy();
    expect(within(sheet).getByText("GHS 3025.00")).toBeTruthy();
    expect(within(sheet).getByText(/Please pay GHS 3025\.00 by/i)).toBeTruthy();
    expect(within(sheet).getByText("Thank you for your business.")).toBeTruthy();
  });

  it("prints the buyer's address and tax number as they were issued", () => {
    renderSheet(<InvoiceSheet invoice={{ ...invoice, buyerAddress: "Tema Harbour, Gate 3", buyerTin: "C0012345678" }} />, world({ invoices: [{ ...invoice, buyerAddress: "Tema Harbour, Gate 3", buyerTin: "C0012345678" }] }));

    const sheet = screen.getByRole("article", { name: /Invoice INV-2026-0001/i });
    expect(within(sheet).getByText("Tema Harbour, Gate 3")).toBeTruthy();
    expect(within(sheet).getByText("TIN C0012345678")).toBeTruthy();
  });

  it("prints no buyer details at all when the invoice was issued to a walk-in customer", () => {
    renderSheet(<InvoiceSheet invoice={invoice} />);
    const sheet = screen.getByRole("article", { name: /Invoice INV-2026-0001/i });
    // No empty label, no placeholder: the sheet reads exactly as it did before.
    expect(within(sheet).queryByText(/^TIN /)).toBeNull();
  });

  it("shows what was credited as well as what was paid, and never a stale total", () => {
    renderSheet(<InvoiceSheet invoice={invoice} />, world({ creditNotes: [creditNote] }));

    const sheet = screen.getByRole("article", { name: /Invoice INV-2026-0001/i });
    expect(within(sheet).getByText("Received")).toBeTruthy();
    expect(within(sheet).getByText("Credited by credit note")).toBeTruthy();
    // 4,025 − 1,000 received − 575 credited = 2,450 still due.
    expect(within(sheet).getByText("GHS 575.00")).toBeTruthy();
    expect(within(sheet).getByText("GHS 2450.00")).toBeTruthy();
  });

  it("asks for nothing, and states a refund, when credits pass what was paid", () => {
    renderSheet(
      <InvoiceSheet invoice={{ ...invoice, status: "paid", amountPaid: 4025 }} />,
      world({ invoices: [{ ...invoice, status: "paid", amountPaid: 4025 }], payments: [{ ...payment, amount: 4025 }], creditNotes: [creditNote] }),
    );

    const sheet = screen.getByRole("article", { name: /Invoice INV-2026-0001/i });
    expect(within(sheet).getByText("Refund due to the customer")).toBeTruthy();
    expect(within(sheet).queryByText("Amount due")).toBeNull();
    expect(within(sheet).getByText(/the difference shown is owed back to them/i)).toBeTruthy();
  });

  it("says a void invoice does not stand, before any figure", () => {
    const voided: Invoice = { ...invoice, status: "void", voidReason: "Wrong customer name", voidedAt: at, amountPaid: 0 };
    renderSheet(<InvoiceSheet invoice={voided} />, world({ invoices: [voided], payments: [] }));

    const sheet = screen.getByRole("article", { name: /Invoice INV-2026-0001/i });
    expect(within(sheet).getByText("This invoice is void and does not stand.")).toBeTruthy();
    expect(within(sheet).getByText(/Wrong customer name/)).toBeTruthy();
    // A document that does not count cannot ask for money.
    expect(within(sheet).queryByText("Amount due")).toBeNull();
    expect(within(sheet).queryByText("Refund due to the customer")).toBeNull();
  });

  it("names a missing company name instead of inventing one", () => {
    const db = world();
    renderSheet(<InvoiceSheet invoice={invoice} />, { ...db, settings: { ...db.settings, companyName: null } });
    const sheet = screen.getByRole("article", { name: /Invoice INV-2026-0001/i });
    expect(within(sheet).getByText("Company name not set in Settings")).toBeTruthy();
  });
});

describe("the credit note a customer receives (D-86, D-87)", () => {
  it("says which invoice it corrects, how much came off, and why", () => {
    renderSheet(<CreditNoteSheet note={creditNote} />);

    const sheet = screen.getByRole("article", { name: /Credit note CN-2026-0001/i });
    expect(within(sheet).getByText("Richie Transport Services")).toBeTruthy();
    expect(within(sheet).getByText("Acme Ltd")).toBeTruthy();
    expect(within(sheet).getByText("INV-2026-0001")).toBeTruthy();
    expect(within(sheet).getByText("Airport transfer not operated")).toBeTruthy();
    expect(within(sheet).getByText("Total credited")).toBeTruthy();
    // 500 before tax plus 15% VAT: the same tax the invoice charged.
    expect(within(sheet).getByText("GHS 575.00")).toBeTruthy();
    expect(within(sheet).getByText(/reduces the amount due on INV-2026-0001 by GHS 575\.00/)).toBeTruthy();
    expect(within(sheet).getByText("Service not delivered")).toBeTruthy();
  });

  it("marks a void credit note as void, and says the money is back on the bill", () => {
    renderSheet(<CreditNoteSheet note={{ ...creditNote, status: "void", voidReason: "Wrong invoice", voidedAt: at }} />);
    const sheet = screen.getByRole("article", { name: /Credit note CN-2026-0001/i });
    expect(within(sheet).getByText("This credit note is void and does not stand.")).toBeTruthy();
    expect(within(sheet).getByText(/does not change any payment|nothing is taken off/i)).toBeTruthy();
  });
});

describe("the preview around the sheet (D-87)", () => {
  function Harness({ onClose }: { onClose: () => void }) {
    return (
      <PrintPreview label="Invoice INV-2026-0001" onClose={onClose}>
        <InvoiceSheet invoice={invoice} />
      </PrintPreview>
    );
  }

  it("opens as a dialog over the page, with the sheet attached to the document body", () => {
    renderSheet(<Harness onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Print preview: Invoice INV-2026-0001" })).toBeTruthy();
    // Portalled to the body so the print stylesheet can remove everything else from the page.
    expect(document.body.querySelector(".rts-print .rts-sheet")).toBeTruthy();
    // The browser offers the document title as the file name when saving as a PDF.
    expect(document.title).toBe("Invoice INV-2026-0001");
  });

  it("prints what is on screen, and closes with its button or Escape", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const onClose = vi.fn();
    renderSheet(<Harness onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Print or save as PDF/i }));
    expect(print).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("tells the operator the supplier name is missing, without putting that note on the paper", () => {
    const db = world();
    renderSheet(<Harness onClose={() => {}} />, { ...db, settings: { ...db.settings, companyName: null } });
    const dialog = screen.getByRole("dialog", { name: /Print preview/i });
    const toolbar = dialog.querySelector(".rts-print-bar") as HTMLElement;
    expect(within(toolbar).getByText(/The company name is not set in Settings/i)).toBeTruthy();
    // The sheet itself carries the gap as a plain statement, not as advice.
    expect(screen.getByRole("article", { name: /Invoice/i }).textContent).toContain("Company name not set in Settings");
    expect(screen.getByRole("article", { name: /Invoice/i }).textContent).not.toContain("is not set in Settings, so this document");
  });
});

describe("the statement a customer's bookkeeper reads (FIN-02, D-90)", () => {
  const statementWorld = (): Database => {
    const db = world();
    return {
      ...db,
      invoices: [invoice, { ...invoice, id: "i2", reference: "INV-2026-0002", issuedOn: "2026-05-20", dueOn: "2026-06-03", total: 1000, subtotal: 1000, taxLines: [] }],
      payments: [{ ...payment, paidOn: "2026-06-02" }],
      creditNotes: [],
    };
  };

  it("states the period, what came in and what is still owed", () => {
    const db = statementWorld();
    renderSheet(<StatementSheet statement={customerStatement(db, "Acme Ltd", "2026-06-01", "2026-06-30")} />, db);

    const sheet = screen.getByRole("article", { name: /Statement for Acme Ltd/i });
    expect(within(sheet).getByText("Statement of account")).toBeTruthy();
    expect(within(sheet).getByText("Acme Ltd")).toBeTruthy();
    expect(within(sheet).getByText("Balance brought forward")).toBeTruthy();
    // The opening balance is stated once on the paper, not once in the table and again below it.
    expect(within(sheet).getAllByText("Balance brought forward")).toHaveLength(1);
    // The May invoice is carried in at what was owed on it, not restated as a June row; the figure
    // also appears in the ageing and in the invoices table, which is the point of the sheet.
    expect(within(sheet).getAllByText("GHS 1000.00").length).toBeGreaterThan(0);
    expect(within(sheet).getByText("Invoiced in the period")).toBeTruthy();
    expect(within(sheet).getByText("Payments received")).toBeTruthy();
    expect(within(sheet).getByText("Balance due")).toBeTruthy();
    // 4,025 + 1,000 brought forward − 1,000 paid = 4,025.
    expect(within(sheet).getByText(/This is a statement of account, not a demand for payment/)).toBeTruthy();
    expect(within(sheet).getByText(/GHS 4025\.00 was owed as at/i)).toBeTruthy();
  });

  it("shows how old the money is, and names the invoices still owing", () => {
    const db = statementWorld();
    renderSheet(<StatementSheet statement={customerStatement(db, "Acme Ltd", "2026-06-01", "2026-06-30")} />, db);

    const ageing = screen.getByRole("region", { name: /How old the money is/i });
    expect(within(ageing).getByText("Over 60 days late")).toBeTruthy();
    const owing = screen.getByRole("region", { name: /Invoices still owing/i });
    expect(within(owing).getByText("INV-2026-0002")).toBeTruthy();
    // The unpaid invoice is 27 days late as at 30 June, and the table says so in days.
    expect(within(owing).getByText("27")).toBeTruthy();
  });

  it("prints money paid back as its own row, so the customer can trace the refund receipt", () => {
    const db = world();
    const refunded: Refund = {
      id: "rf1",
      reference: "REF-2026-0001",
      invoiceId: invoice.id,
      invoiceReference: invoice.reference,
      clientId: null,
      customerName: "Acme Ltd",
      currencyCode: "GHS",
      amount: 400,
      method: "Bank transfer",
      paidOn: "2026-06-20",
      externalReference: "",
      reason: "Service not delivered",
      status: "paid",
      voidReason: null,
      voidedAt: null,
      recordedBy: "Ama Mensah",
      recordedAt: at,
      updatedAt: at,
    };
    const over: Database = {
      ...db,
      invoices: [{ ...invoice, total: 1000, subtotal: 1000, taxLines: [] }],
      payments: [{ ...payment, amount: 1000 }],
      creditNotes: [{ ...creditNote, total: 400, subtotal: 400, taxLines: [] }],
      refunds: [refunded],
    };
    renderSheet(<StatementSheet statement={customerStatement(over, "Acme Ltd", "2026-06-01", "2026-06-30")} />, over);

    const sheet = screen.getByRole("article", { name: /Statement for Acme Ltd/i });
    // Named as money going back, with the receipt number the customer can quote.
    expect(within(sheet).getByText(/Refund paid back/)).toBeTruthy();
    expect(within(sheet).getByText("REF-2026-0001")).toBeTruthy();
    // In credit by 400 before the refund, settled after it: the account now says so, not "in credit".
    expect(within(sheet).queryByText(/In credit — owed to the customer/)).toBeNull();
    expect(within(sheet).getByText("Refunds paid back")).toBeTruthy();
    expect(within(sheet).getByText(/Nothing is owed on this account as at/i)).toBeTruthy();
  });

  it("says an account is in credit rather than printing a demand", () => {
    const db = world();
    const over = {
      ...db,
      invoices: [{ ...invoice, total: 1000, subtotal: 1000, taxLines: [] }],
      payments: [{ ...payment, amount: 1000 }],
      creditNotes: [{ ...creditNote, total: 400, subtotal: 400, taxLines: [] }],
    };
    renderSheet(<StatementSheet statement={customerStatement(over, "Acme Ltd", "2026-06-01", "2026-06-30")} />, over);

    const sheet = screen.getByRole("article", { name: /Statement for Acme Ltd/i });
    expect(within(sheet).getByText(/In credit — owed to the customer/)).toBeTruthy();
    expect(within(sheet).getByText(/in credit by GHS 400\.00 as at/i)).toBeTruthy();
    expect(within(sheet).queryByText("Balance due")).toBeNull();
    // Nothing is owed on an invoice, so there is no ageing section to read.
    expect(screen.queryByRole("region", { name: /How old the money is/i })).toBeNull();
  });
});
