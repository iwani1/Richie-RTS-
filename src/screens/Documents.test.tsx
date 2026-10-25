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
import { CreditNoteSheet, InvoiceSheet, PrintPreview } from "./Documents";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import {
  emptyDatabase,
  emptyRentalSettings,
  type CreditNote,
  type Database,
  type Invoice,
  type Payment,
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
      rental: { ...emptyRentalSettings(), pricingBasis: "per_day", depositPercent: 20, quotationValidityDays: 14, paymentMethods: ["Cash"] },
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
