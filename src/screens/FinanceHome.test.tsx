// @vitest-environment jsdom
// The finance home screen (FIN-07). Three things the screen must get right: the figures match the
// report behind them, the open work is dated as at today rather than hidden inside the period, and
// every amount is withheld — in words — when the company currency is not configured.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinanceHomePage } from "./FinanceHome";
import { TmsContext, type Tms } from "../tms/useTms";
import { emptyDatabase, emptyRentalSettings, type Database, type Invoice, type Payment, type Rental, type User } from "../tms/types";

afterEach(cleanup);

const at = "2026-06-02T09:00:00.000Z";
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const financeUser: User = {
  id: "u1",
  fullName: "Efua Owusu",
  email: "efua@example.test",
  role: "finance",
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
  id: "inv1",
  reference: "INV-2026-0001",
  kind: "rental",
  rentalId: "r1",
  clientId: null,
  customerName: "Northstar Foods",
  currencyCode: "GHS",
  lines: [{ id: "l1", description: "Hire", quantity: 1, unitAmount: 2000 }],
  taxLines: [],
  subtotal: 2000,
  total: 2000,
  amountPaid: 0,
  status: "issued",
  billableEvent: "rental:r1:final",
  issuedOn: today,
  dueOn: daysAgo(10),
  notes: "",
  voidReason: null,
  voidedAt: null,
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  voidReason: null,
  voidedAt: null,
  id: "pay1",
  reference: "PAY-2026-0001",
  invoiceId: "inv1",
  amount: 500,
  currencyCode: "GHS",
  method: "Bank transfer",
  paidOn: today,
  externalReference: "",
  status: "recorded",
  note: "",
  log: [],
  recordedBy: "Efua Owusu",
  recordedAt: at,
  ...overrides,
});

const unbilled: Rental = {
  id: "r2",
  reference: "RR-0002",
  clientId: null,
  customerName: "Beta Foods",
  customerPhone: "",
  customerEmail: "",
  purpose: "",
  pickupLocation: "Accra",
  dropoffLocation: "Tema",
  startDate: today,
  endDate: today,
  passengers: 12,
  vehicleCategoryId: "cat",
  driverRequired: false,
  notes: "",
  status: "completed",
  quote: null,
  quoteHistory: [],
  assignedVehicleId: null,
  assignedDriverId: null,
  deposit: null,
  finalInvoice: { currencyCode: "GHS", lines: [], total: 1800, issuedAt: `${daysAgo(2)}T17:00:00.000Z`, issuedBy: "Ops" },
  resolutionReason: null,
  createdAt: at,
  updatedAt: `${daysAgo(2)}T17:00:00.000Z`,
};

function world(currencyCode: string | null = "GHS"): Database {
  const base = emptyDatabase();
  return {
    ...base,
    users: [financeUser],
    settings: { ...base.settings, currencyCode, rental: emptyRentalSettings(), costCategories: ["Parts"] },
    invoices: [invoice()],
    payments: [payment()],
    rentals: [unbilled],
  };
}

const makeTms = (db: Database): Tms =>
  ({
    db,
    actor: { id: financeUser.id, fullName: financeUser.fullName, role: financeUser.role },
    currentUser: financeUser,
    status: "ready",
    connectionError: null,
    auditTotal: 0,
    setupRequired: false,
    flash: null,
    busy: false,
    setFlash: () => {},
    allowed: () => true,
    dispatch: vi.fn(async () => ({ ok: true, message: "" })),
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
  }) as unknown as Tms;

const open = (db: Database, navigate = vi.fn()) => {
  render(
    <TmsContext.Provider value={makeTms(db)}>
      <FinanceHomePage navigate={navigate} />
    </TmsContext.Provider>,
  );
  return navigate;
};

describe("finance home", () => {
  it("shows the late invoice, the unbilled hire and the payment still to check, dated as at today", () => {
    open(world());

    expect(screen.getByText("Overdue")).toBeTruthy();
    // It appears twice on purpose: once in the overdue list, once against its payment.
    expect(screen.getAllByText("INV-2026-0001").length).toBe(2);
    // 10 days late, and the money still owed (2,000 invoiced less 500 recorded).
    expect(screen.getByText("10 days")).toBeTruthy();
    // Said in the notice at the top and on the table itself: the period filter does not move a deadline.
    expect(screen.getAllByText(/measured as at/i).length).toBe(2);

    expect(screen.getByText("RR-0002")).toBeTruthy();
    expect(screen.getByText("Completed but not billed")).toBeTruthy();

    expect(screen.getByText("PAY-2026-0001")).toBeTruthy();
    // A recorded payment is not settled money, and the screen names the step left to take.
    expect(screen.getByText("Recorded ·")).toBeTruthy();
    expect(screen.getByText("verify")).toBeTruthy();
  });

  it("withholds the margin and says what is missing, instead of showing a made-up rate", () => {
    open(world());
    // One invoice in the period but no cost recorded: a margin would just repeat the revenue.
    expect(screen.getByText("Margin")).toBeTruthy();
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
    expect(screen.getByText(/No cost was recorded in the period/i)).toBeTruthy();
  });

  it("withholds every amount, in words, when the company currency is not set", () => {
    open(world(null));
    expect(screen.getAllByText(/no company currency is configured/i).length).toBeGreaterThan(0);
    // The money cells say so rather than printing a bare number.
    expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);
  });

  it("refuses to read a range that is the wrong way round", () => {
    open(world());
    const to = screen.getByLabelText(/Finance period to/i);
    fireEvent.change(screen.getByLabelText(/Finance period from/i), { target: { value: "2026-12-31" } });
    fireEvent.change(to, { target: { value: "2026-01-01" } });
    expect(screen.getByText(/wrong way round/i)).toBeTruthy();
  });

  it("sends the officer to the invoices they are chasing", () => {
    const navigate = open(world());
    fireEvent.click(screen.getByRole("button", { name: /Open invoices/i }));
    expect(navigate).toHaveBeenCalledWith("invoices");
  });
});
