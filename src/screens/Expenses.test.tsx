// @vitest-environment jsdom
// The expenses screen (FIN-05, D-93).
//
// The point of this screen is that spending which is not a repair finally belongs somewhere, and that
// what it says can be trusted: the total is the sum of the records, a voided entry is listed but counts
// for nothing, and the count of spending with no receipt number on it is shown rather than hidden.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpensesPage } from "./Expenses";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, emptyRentalSettings, type Database, type Expense, type User } from "../tms/types";

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

const expense = (overrides: Partial<Expense> = {}): Expense => ({
  id: "ex1",
  reference: "EXP-2026-0001",
  incurredOn: "2026-06-05",
  category: "Fuel",
  description: "Diesel, Kumasi depot",
  payee: "Total Filling Station",
  amount: 320.5,
  currencyCode: "GHS",
  method: "Cash",
  receiptReference: "RCPT-0091",
  receiptHeld: true,
  notes: "",
  status: "recorded",
  voidReason: null,
  voidedAt: null,
  recordedBy: "Ama Mensah",
  recordedAt: at,
  updatedAt: at,
  ...overrides,
});

const base = (expenses: Expense[] = [expense()]): Database => {
  const db = emptyDatabase();
  return {
    ...db,
    users: [admin],
    expenses,
    settings: {
      ...db.settings,
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      costCategories: ["Fuel", "Tolls", "Permits"],
      rental: { ...emptyRentalSettings(), paymentMethods: ["Cash", "Bank transfer"] },
    },
  };
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
    busy: false,
    setFlash: () => {},
    allowed: () => true,
    dispatch: vi.fn(async () => ({ ok: true, message: "done" }) as CommandResult),
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
    ...overrides,
  } as unknown as Tms;
}

const renderExpenses = (db: Database = base(), overrides: Partial<Tms> = {}) => {
  const tms = makeTms(db, overrides);
  render(
    <TmsContext.Provider value={tms}>
      <ExpensesPage />
    </TmsContext.Provider>,
  );
  return tms;
};

/** The screen opens on the current month; the fixture is June 2026, so the period is set explicitly. */
const setPeriod = (from: string, to: string) => {
  fireEvent.change(screen.getByLabelText(/^From/), { target: { value: from } });
  fireEvent.change(screen.getByLabelText(/^To/), { target: { value: to } });
};

const openJune = (db: Database = base(), overrides: Partial<Tms> = {}) => {
  const tms = renderExpenses(db, overrides);
  setPeriod("2026-06-01", "2026-06-30");
  return tms;
};

describe("the expenses screen", () => {
  it("lists the period's spending and adds it up", () => {
    openJune(base([expense(), expense({ id: "ex2", reference: "EXP-2026-0002", incurredOn: "2026-06-08", category: "Tolls", amount: 17, description: "Toll, Accra road", receiptReference: "TR-2" })]));

    expect(screen.getByText("EXP-2026-0001")).toBeTruthy();
    expect(screen.getByText("EXP-2026-0002")).toBeTruthy();
    const recorded = screen.getByText("Recorded in the period").closest(".rts-stat") as HTMLElement;
    expect(within(recorded).getByText("GHS 337.50")).toBeTruthy();
    const biggest = screen.getByText("Biggest category").closest(".rts-stat") as HTMLElement;
    expect(within(biggest).getByText("Fuel")).toBeTruthy();
  });

  it("keeps a voided entry on the list but out of the total", () => {
    openJune(
      base([
        expense(),
        expense({ id: "ex2", reference: "EXP-2026-0002", amount: 100, status: "void", voidReason: "Receipt already recorded", voidedAt: at, receiptReference: "RCPT-1" }),
      ]),
    );

    expect(screen.getByText("EXP-2026-0002")).toBeTruthy();
    expect(screen.getByText("Void: Receipt already recorded")).toBeTruthy();
    const recorded = screen.getByText("Recorded in the period").closest(".rts-stat") as HTMLElement;
    expect(within(recorded).getByText("GHS 320.50")).toBeTruthy();
    expect(within(recorded).getByText("1 entry in the period")).toBeTruthy();
  });

  it("says how much spending has no receipt number on it", () => {
    openJune(base([expense(), expense({ id: "ex2", reference: "EXP-2026-0002", amount: 79.5, receiptReference: "", receiptHeld: false })]));

    const noReceipt = screen.getByText("No receipt number").closest(".rts-stat") as HTMLElement;
    expect(within(noReceipt).getByText("1")).toBeTruthy();
    expect(within(noReceipt).getByText("GHS 79.50 of spending with no number on it")).toBeTruthy();
    const held = screen.getByText("Receipt held").closest(".rts-stat") as HTMLElement;
    expect(within(held).getByText("1")).toBeTruthy();
  });

  it("files nothing outside the chosen period and says so", () => {
    openJune(base([expense({ incurredOn: "2026-05-20" })]));
    expect(screen.getByText("No expenses recorded")).toBeTruthy();
    const recorded = screen.getByText("Recorded in the period").closest(".rts-stat") as HTMLElement;
    expect(within(recorded).getByText("GHS 0.00")).toBeTruthy();
  });

  it("finds an entry by its payee or receipt, and filters by category", () => {
    openJune(base([expense(), expense({ id: "ex2", reference: "EXP-2026-0002", category: "Tolls", description: "Toll, Accra road", payee: "Motorway booth", receiptReference: "TR-2" })]));

    fireEvent.change(screen.getByLabelText("Find an expense"), { target: { value: "motorway" } });
    expect(screen.getByText("EXP-2026-0002")).toBeTruthy();
    expect(screen.queryByText("EXP-2026-0001")).toBeNull();

    fireEvent.change(screen.getByLabelText("Find an expense"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter by category"), { target: { value: "Fuel" } });
    expect(screen.getByText("EXP-2026-0001")).toBeTruthy();
    expect(screen.queryByText("EXP-2026-0002")).toBeNull();
  });

  it("records an expense from the receipt", async () => {
    const dispatch = vi.fn(async () => ({ ok: true, message: "EXP-2026-0003 recorded." }) as CommandResult);
    openJune(base(), { dispatch });

    fireEvent.click(screen.getByRole("button", { name: /Record an expense/ }));
    fireEvent.change(screen.getByLabelText("What the money was spent on"), { target: { value: "Generator diesel" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "45.00" } });
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "Fuel" } });
    fireEvent.change(screen.getByLabelText(/^Who was paid/), { target: { value: "Shell Adum" } });
    fireEvent.change(screen.getByLabelText(/^How it was paid/), { target: { value: "Cash" } });
    fireEvent.change(screen.getByLabelText(/^Receipt number/), { target: { value: "RCPT-77" } });
    fireEvent.click(screen.getByRole("button", { name: /Record the expense/ }));

    await waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(dispatch).toHaveBeenCalledWith({
      type: "record_expense",
      input: expect.objectContaining({ description: "Generator diesel", amount: "45.00", category: "Fuel", payee: "Shell Adum", method: "Cash", receiptReference: "RCPT-77", receiptHeld: false }),
    });
  });

  it("shows the refusal on the field it belongs to", async () => {
    const dispatch = vi.fn(async () => ({ ok: false, message: "Check the expense.", errors: { amount: "Enter an amount greater than zero." } }) as CommandResult);
    openJune(base(), { dispatch });

    fireEvent.click(screen.getByRole("button", { name: /Record an expense/ }));
    fireEvent.change(screen.getByLabelText("What the money was spent on"), { target: { value: "Diesel" } });
    fireEvent.click(screen.getByRole("button", { name: /Record the expense/ }));

    await waitFor(() => expect(screen.getByText("Enter an amount greater than zero.")).toBeTruthy());
    // The form stays open with what was typed in it, so nothing has to be entered twice.
    expect((screen.getByLabelText("What the money was spent on") as HTMLInputElement).value).toBe("Diesel");
  });

  it("voids a wrong entry with a reason, and offers no way to edit it", async () => {
    const dispatch = vi.fn(async () => ({ ok: true, message: "EXP-2026-0001 voided. It no longer counts in any report." }) as CommandResult);
    openJune(base(), { dispatch });

    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Void EXP-2026-0001/ }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Wrong vehicle" } });
    fireEvent.click(screen.getByRole("button", { name: /^Void expense/ }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "void_expense", id: "ex1", reason: "Wrong vehicle" }));
  });

  it("asks for the company currency before offering to record anything", () => {
    const db = base();
    renderExpenses({ ...db, settings: { ...db.settings, currencyCode: null } });

    expect(screen.getByText("No company currency is configured")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Record an expense/ })).toHaveProperty("disabled", true);
    const recorded = screen.getByText("Recorded in the period").closest(".rts-stat") as HTMLElement;
    expect(within(recorded).getByText("Not configured")).toBeTruthy();
  });

  it("hides recording and voiding from a role that may only read", () => {
    openJune(base(), { allowed: (permission) => permission === "expenses:read" });
    expect(screen.queryByRole("button", { name: /Record an expense/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Void EXP-2026-0001/ })).toBeNull();
    // Reading it is still allowed, which is why operations has the permission at all.
    expect(screen.getByText("EXP-2026-0001")).toBeTruthy();
  });
});
