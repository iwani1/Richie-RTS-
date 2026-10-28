// @vitest-environment jsdom
// The invoice and payment screen (FIN-02, FIN-03). It is the only place where the money a rental
// produces becomes visible, so the test checks the three things a user relies on: what is still
// owed, what has been received, and that an invoice with money against it offers no void action.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoicesPage } from "./Invoices";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, type CreditNote, type Database, type Invoice, type Payment, type Refund, type User } from "../tms/types";

afterEach(cleanup);

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
  rentalId: null,
  clientId: null,
  customerName: "Acme Ltd",
  buyerAddress: "",
  buyerTin: "",
  currencyCode: "GHS",
  lines: [{ id: "l1", description: "Two days hire", quantity: 2, unitAmount: 1500 }],
  taxLines: [{ name: "VAT", ratePercent: 15, amount: 450 }],
  subtotal: 3000,
  total: 3450,
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
};

const payment: Payment = {
  id: "p1",
  reference: "PAY-2026-0001",
  invoiceId: invoice.id,
  amount: 1000,
  currencyCode: "GHS",
  method: "Bank transfer",
  paidOn: "2026-06-01",
  externalReference: "SLIP-9001",
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
  lines: [{ id: "cl1", description: "Airport transfer not operated", quantity: 1, unitAmount: 2000 }],
  taxLines: [{ name: "VAT", ratePercent: 15, amount: 300 }],
  subtotal: 2000,
  total: 2300,
  reason: "Service not delivered",
  issuedOn: "2026-06-02",
  status: "issued",
  voidReason: null,
  voidedAt: null,
  createdBy: "Ama Mensah",
  createdAt: at,
  updatedAt: at,
};

const base = (): Database => {
  const db = emptyDatabase();
  return { ...db, users: [admin], invoices: [invoice], payments: [payment] };
};

/** The same invoice after a credit note took GHS 2,300.00 off it. */
const credited = (): Database => ({ ...base(), creditNotes: [creditNote] });

function makeTms(db: Database, overrides: Partial<Tms> = {}): Tms {
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
    ...overrides,
  } as unknown as Tms;
}

const renderInvoices = (db: Database, overrides: Partial<Tms> = {}) => {
  const tms = makeTms(db, overrides);
  render(
    <TmsContext.Provider value={tms}>
      <InvoicesPage />
    </TmsContext.Provider>,
  );
  return tms;
};

describe("invoices and payments screen", () => {
  it("shows what is billed, received and still outstanding", () => {
    renderInvoices(base());
    expect(screen.getByText("INV-2026-0001")).toBeTruthy();
    const row = screen.getByText("INV-2026-0001").closest("tr") as HTMLElement;
    expect(within(row).getByText("GHS 3450.00")).toBeTruthy(); // total
    expect(within(row).getByText("GHS 1000.00")).toBeTruthy(); // paid
    expect(within(row).getByText("GHS 2450.00")).toBeTruthy(); // outstanding
    expect(within(row).getByText("Part paid")).toBeTruthy();
    // The stat strip, which a finance officer reads first.
    expect(screen.getAllByText("Received").length).toBeGreaterThan(0);
    // "Outstanding" is a stat label and a column header; both must be present.
    expect(screen.getAllByText("Outstanding").length).toBeGreaterThan(1);
  });

  it("opens the invoice, shows the tax line and the payment, and offers no void while money stands", () => {
    renderInvoices(base());
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));

    expect(screen.getByText(/Two days hire/)).toBeTruthy();
    expect(screen.getByText(/VAT at 15%/)).toBeTruthy();
    expect(screen.getAllByText("PAY-2026-0001").length).toBeGreaterThan(0);
    expect(screen.getByText(/cannot be voided while a payment still\s+counts against it/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Void invoice/i })).toBeNull();
    // Money can still come in for the balance.
    expect(screen.getByRole("button", { name: /Record a payment/i })).toBeTruthy();
  });

  it("records a payment through the panel with the outstanding amount filled in", async () => {
    const tms = renderInvoices(base());
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));
    fireEvent.click(screen.getByRole("button", { name: /Record a payment/i }));

    const dialog = screen.getByRole("dialog");
    const amount = within(dialog).getByLabelText(/Amount received/i) as HTMLInputElement;
    expect(amount.value).toBe("2450.00");
    fireEvent.change(within(dialog).getByLabelText(/External reference/i), { target: { value: "SLIP-9002" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Record payment$/i }));

    expect(tms.dispatch).toHaveBeenCalledWith({
      type: "record_payment",
      input: expect.objectContaining({ invoiceId: "i1", amount: "2450.00", externalReference: "SLIP-9002" }),
    });
  });

  it("warns that invoicing is blocked until the tax position and payment terms are set", () => {
    renderInvoices(base());
    // With neither configured the notice explains both, and the reason: no guessing on a document.
    expect(screen.getByText(/Invoicing is not configured/i)).toBeTruthy();
    expect(screen.getByText(/Set the company tax position in Settings/i)).toBeTruthy();
    expect(screen.getByText(/Set the payment terms in days in Settings/i)).toBeTruthy();
  });
});

describe("sorting the register", () => {
  /** Two invoices, so the order on screen is visible: one larger and older-numbered than the other. */
  const twoInvoices = (): Database => {
    const second: Invoice = { ...invoice, id: "i2", reference: "INV-2026-0002", customerName: "Zongo Coaches", total: 500, status: "issued", amountPaid: 0, billableEvent: "rental:r2:final" };
    const db = base();
    return { ...db, invoices: [invoice, second], payments: [] };
  };

  const references = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent);

  it("sorts by a column, reverses, and puts the screen's own order back", () => {
    renderInvoices(twoInvoices());
    // The screen's own order is newest reference first.
    expect(references()).toEqual(["INV-2026-0002", "INV-2026-0001"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort by Total" }));
    expect(references()).toEqual(["INV-2026-0002", "INV-2026-0001"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort by Total" }));
    expect(references()).toEqual(["INV-2026-0001", "INV-2026-0002"]);
    // A third click returns the list to how the screen had it, not to a stale alphabet.
    fireEvent.click(screen.getByRole("button", { name: "Sort by Total" }));
    expect(references()).toEqual(["INV-2026-0002", "INV-2026-0001"]);
  });

  it("keeps sorting inside the filter: a filtered list stays filtered when it is re-ordered", () => {
    renderInvoices(twoInvoices());
    fireEvent.change(screen.getByLabelText("Search invoices"), { target: { value: "zongo" } });
    expect(references()).toEqual(["INV-2026-0002"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort by Customer" }));
    expect(references()).toEqual(["INV-2026-0002"]);
  });
});

describe("credit notes on the invoice screen (D-86)", () => {
  it("shows what was credited and reports the invoice as settled by credit rather than paid", () => {
    renderInvoices(credited());
    const row = screen.getByText("INV-2026-0001").closest("tr") as HTMLElement;
    // Total 3,450 less GHS 1,000 received less GHS 2,300 credited leaves 150 outstanding.
    expect(within(row).getByText("GHS 2300.00")).toBeTruthy();
    expect(within(row).getByText("GHS 150.00")).toBeTruthy();
    // Money received is still stated as received: the payment was not rewritten.
    expect(within(row).getByText("GHS 1000.00")).toBeTruthy();
    expect(within(row).getByText("Part paid")).toBeTruthy();
  });

  it("warns that a refund is due when credits pass what the customer paid", () => {
    const refundable: Database = {
      ...base(),
      payments: [{ ...payment, amount: 3450 }],
      invoices: [{ ...invoice, amountPaid: 3450, status: "paid" }],
      creditNotes: [creditNote],
    };
    renderInvoices(refundable);
    const row = screen.getByText("INV-2026-0001").closest("tr") as HTMLElement;
    // 1,000 paid is not the case here: GHS 3,450 was paid and GHS 2,300 credited, so 2,300 is owed back.
    expect(within(row).getByText(/GHS 2300.00 back/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));
    expect(screen.getByText("A refund is due")).toBeTruthy();
    // The notice now says where the money is actually recorded, rather than telling the operator to
    // book it as an ordinary outgoing (D-92).
    expect(screen.getByText(/A credit note never moves money: record the\s+refund here/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pay a refund/i })).toBeTruthy();
  });

  it("lists the credit note on the invoice, with its reason, and offers to void it", () => {
    renderInvoices(credited());
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));

    expect(screen.getAllByText("CN-2026-0001").length).toBeGreaterThan(0);
    expect(screen.getByText("Service not delivered")).toBeTruthy();
    expect(screen.getByText("Airport transfer not operated")).toBeTruthy();
    // The notice and the card summary both state the credited total; both are wanted.
    expect(screen.getAllByText(/2300\.00/).length).toBeGreaterThanOrEqual(2);
    // The credit note's own status badge, distinct from the "Issued" column header and the invoice status.
    expect(screen.getAllByText("Issued").length).toBeGreaterThan(1);
    // A credit note can be voided even though the payment standing on the invoice cannot be touched.
    expect(screen.getByRole("button", { name: /Void CN-2026-0001/i })).toBeTruthy();
  });

  it("issues a credit note from the invoice, previewing the tax the invoice itself carried", async () => {
    const tms = renderInvoices(credited());
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));
    fireEvent.click(screen.getByRole("button", { name: /Credit the invoice/i }));

    const dialog = screen.getByRole("dialog");
    // 3,450 less 2,300 already credited leaves 1,150 that can still come off, including tax.
    expect(within(dialog).getByText(/GHS 1150\.00 is left to credit/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Amount to credit/i), { target: { value: "100" } });
    // The invoice's own rate (15%), not today's settings: 100 + 15 = 115.
    expect(within(dialog).getByText("Credit note total: GHS 115.00")).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(/What it is for/i), { target: { value: "One day not operated" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason for the credit/i), { target: { value: "Vehicle broke down" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Issue credit note$/i }));

    expect(tms.dispatch).toHaveBeenCalledWith({
      type: "issue_credit_note",
      input: expect.objectContaining({ invoiceId: invoice.id, amount: "100", description: "One day not operated", reason: "Vehicle broke down" }),
    });
  });

  it("voids a credit note through the panel with a reason", async () => {
    const tms = renderInvoices(credited());
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));
    fireEvent.click(screen.getByRole("button", { name: /Void CN-2026-0001/i }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "Wrong invoice" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Void credit note$/i }));

    expect(tms.dispatch).toHaveBeenCalledWith({ type: "void_credit_note", id: creditNote.id, reason: "Wrong invoice" });
  });
});

describe("printing from the invoice screen (D-87)", () => {
  it("opens the invoice as a printable document, with what is owed on it", () => {
    renderInvoices(credited());
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));
    fireEvent.click(screen.getByRole("button", { name: /Print invoice/i }));

    expect(screen.getByRole("dialog", { name: "Print preview: Invoice INV-2026-0001" })).toBeTruthy();
    const sheet = screen.getByRole("article", { name: /Invoice INV-2026-0001/i });
    expect(within(sheet).getByText("Acme Ltd")).toBeTruthy();
    expect(within(sheet).getByText("Credited by credit note")).toBeTruthy();
    // 3,450 total less 1,000 received less 2,300 credited.
    expect(within(sheet).getByText("GHS 150.00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a credit note as its own document, against the invoice it corrects", () => {
    renderInvoices(credited());
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));
    fireEvent.click(screen.getByRole("button", { name: /Print CN-2026-0001/i }));

    expect(screen.getByRole("dialog", { name: "Print preview: Credit note CN-2026-0001" })).toBeTruthy();
    const sheet = screen.getByRole("article", { name: /Credit note CN-2026-0001/i });
    expect(within(sheet).getByText("INV-2026-0001")).toBeTruthy();
    expect(within(sheet).getByText("Airport transfer not operated")).toBeTruthy();
    expect(within(sheet).getByText("GHS 2300.00")).toBeTruthy();
  });
});

describe("cancelling a payment recorded in error (D-88)", () => {
  const cancelledPayment: Payment = { ...payment, voidReason: "Recorded against the wrong invoice", voidedAt: "2026-06-02T10:00:00.000Z" };
  const withCancelled = (): Database => ({
    ...base(),
    payments: [payment, { ...cancelledPayment, id: "p2", reference: "PAY-2026-0002", amount: 500, externalReference: "" }],
  });

  it("offers a cancel action beside a payment that still counts", () => {
    renderInvoices(base());
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));
    expect(screen.getByRole("button", { name: /Cancel PAY-2026-0001/i })).toBeTruthy();
  });

  it("cancels a payment through the panel, with the reason typed in", async () => {
    const tms = renderInvoices(base());
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel PAY-2026-0001/i }));

    const dialog = screen.getByRole("dialog");
    // The panel says what stopping the payment does to the invoice, in figures.
    expect(within(dialog).getByText(/GHS 1000\.00 stops counting towards what was received on INV-2026-0001/i)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "Customer's transfer bounced" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel payment$/i }));

    expect(tms.dispatch).toHaveBeenCalledWith({ type: "void_payment", id: payment.id, reason: "Customer's transfer bounced" });
  });

  it("says what cancelling does to a payment already reconciled with the bank", () => {
    const reconciled: Database = { ...base(), payments: [{ ...payment, status: "reconciled" }], invoices: [{ ...invoice, status: "part_paid" }] };
    renderInvoices(reconciled);
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel PAY-2026-0001/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Already reconciled with the bank statement/i)).toBeTruthy();
    expect(within(dialog).getByText(/leaves that statement\s+unmatched by GHS 1000\.00/i)).toBeTruthy();
  });

  it("shows a cancelled payment as cancelled, keeps its reason, and stops counting it as received", () => {
    renderInvoices(withCancelled());
    const row = screen.getByText("INV-2026-0001").closest("tr") as HTMLElement;
    // Only the GHS 1,000 payment still counts; the cancelled GHS 500 is not money received.
    expect(within(row).getByText("GHS 1000.00")).toBeTruthy();
    expect(within(row).getByText("GHS 2450.00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getByText(/Recorded against the wrong invoice — it no longer counts/)).toBeTruthy();
    // A cancelled payment offers nothing further to do with it.
    expect(screen.queryByRole("button", { name: /Cancel PAY-2026-0002/i })).toBeNull();
    // The received figure is one of two payments, and the caption says so rather than lying.
    expect(screen.getByText(/1 payment counting of 2 recorded/)).toBeTruthy();
  });
});

describe("refunds paid back on the invoice screen (D-92)", () => {
  // GHS 3,450 paid in full, then GHS 2,300 credited: GHS 2,300 is genuinely owed back.
  const overpaid = (overrides: Partial<Database> = {}): Database => ({
    ...base(),
    payments: [{ ...payment, amount: 3450, status: "reconciled" }],
    invoices: [{ ...invoice, amountPaid: 3450, status: "paid" }],
    creditNotes: [creditNote],
    ...overrides,
  });

  const refund: Refund = {
    id: "rf1",
    reference: "REF-2026-0001",
    invoiceId: invoice.id,
    invoiceReference: invoice.reference,
    clientId: null,
    customerName: "Acme Ltd",
    currencyCode: "GHS",
    amount: 2300,
    method: "Bank transfer",
    paidOn: "2026-06-20",
    externalReference: "TRF-1",
    reason: "Service not delivered",
    status: "paid",
    voidReason: null,
    voidedAt: null,
    recordedBy: "Ama Mensah",
    recordedAt: at,
    updatedAt: at,
  };

  it("records the refund with the amount still owed back filled in and the reason required", () => {
    const tms = renderInvoices(overpaid());
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));
    fireEvent.click(screen.getByRole("button", { name: /Pay a refund/i }));

    const dialog = screen.getByRole("dialog");
    const amount = within(dialog).getByLabelText(/Amount paid back/i) as HTMLInputElement;
    expect(amount.value).toBe("2300.00");
    // The reason is a field of its own, not an optional note: a refund with no explanation cannot be
    // audited a year later.
    fireEvent.change(within(dialog).getByLabelText(/Why the money was paid back/i), { target: { value: "Service not delivered" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Record the refund/i }));

    expect(tms.dispatch).toHaveBeenCalledWith({
      type: "record_refund",
      input: expect.objectContaining({ invoiceId: "i1", amount: "2300.00", reason: "Service not delivered" }),
    });
  });

  it("lists a refund with its number, reason and method, and says nothing further is owed back", () => {
    renderInvoices(overpaid({ refunds: [refund] }));
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));

    expect(screen.getByText("The refund has been paid")).toBeTruthy();
    expect(screen.getAllByText("REF-2026-0001").length).toBeGreaterThan(0);
    // The status badge and the column header say the same thing, deliberately: the word carries the
    // state, not only the colour.
    expect(screen.getAllByText("Paid back").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Service not delivered").length).toBeGreaterThan(0);
    // Received is still GHS 3,450: a refund does not rewrite what the customer paid.
    expect(screen.getAllByText(/GHS 3450\.00 received/).length).toBeGreaterThan(0);
    // Nothing is owed back any more, so the action is gone.
    expect(screen.queryByRole("button", { name: /Pay a refund/i })).toBeNull();
  });

  it("cancels a refund with a reason, so the money is owed back again", () => {
    const tms = renderInvoices(overpaid({ refunds: [refund] }));
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel REF-2026-0001/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/becomes owed back to the customer again on INV-2026-0001/i)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: "Transfer never left the bank" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel refund/i }));

    expect(tms.dispatch).toHaveBeenCalledWith({ type: "void_refund", id: "rf1", reason: "Transfer never left the bank" });
  });
});

describe("copying an invoice number (D-111)", () => {
  it("offers the number from the open invoice and says when it has copied it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderInvoices(base());
    fireEvent.click(screen.getByRole("button", { name: /Open INV-2026-0001/i }));

    const copy = screen.getByRole("button", { name: "Copy invoice number INV-2026-0001" });
    await act(async () => {
      fireEvent.click(copy);
    });

    expect(writeText).toHaveBeenCalledWith("INV-2026-0001");
    expect(copy.textContent).toBe("Copied");
  });
});
