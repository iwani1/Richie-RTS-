// @vitest-environment jsdom
// The invoice and payment screen (FIN-02, FIN-03). It is the only place where the money a rental
// produces becomes visible, so the test checks the three things a user relies on: what is still
// owed, what has been received, and that an invoice with money against it offers no void action.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoicesPage } from "./Invoices";
import { TmsContext, type Tms } from "../tms/useTms";
import { emptyDatabase, type Database, type Invoice, type Payment, type User } from "../tms/types";

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
};

const base = (): Database => {
  const db = emptyDatabase();
  return { ...db, users: [admin], invoices: [invoice], payments: [payment] };
};

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
    setFlash: () => {},
    allowed: () => true,
    dispatch: vi.fn(async () => ({ ok: true, message: "" })),
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
    ...overrides,
  } as Tms;
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
    expect(screen.getByText(/cannot be voided while payments stand/i)).toBeTruthy();
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
