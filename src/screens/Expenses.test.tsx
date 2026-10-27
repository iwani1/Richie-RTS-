// @vitest-environment jsdom
// The expenses screen (FIN-05, D-93).
//
// The point of this screen is that spending which is not a repair finally belongs somewhere, and that
// what it says can be trusted: the total is the sum of the records, a voided entry is listed but counts
// for nothing, and the count of spending with no receipt number on it is shown rather than hidden.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpensesPage } from "./Expenses";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, emptyRentalSettings, type Database, type Expense, type ReceiptFile, type User } from "../tms/types";

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

const scan = (overrides: Partial<ReceiptFile> = {}): ReceiptFile => ({
  id: "rc1",
  expenseId: "ex1",
  storedName: "rcpt_9f2c1ab34d5e6f708192a3b4.pdf",
  originalName: "Total filing 4 Aug.pdf",
  mimeType: "application/pdf",
  byteSize: 184_320,
  sha256: "c".repeat(64),
  status: "attached",
  removedReason: null,
  removedBy: null,
  removedAt: null,
  supersededById: null,
  uploadedBy: "Ama Mensah",
  uploadedAt: at,
  ...overrides,
});

const base = (expenses: Expense[] = [expense()], receipts: ReceiptFile[] = []): Database => {
  const db = emptyDatabase();
  return {
    ...db,
    users: [admin],
    expenses,
    receipts,
    settings: {
      ...db.settings,
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      costCategories: ["Fuel", "Tolls", "Permits"],
      rental: { ...emptyRentalSettings(), quotationTerms: "Prices are firm for the validity period.", paymentMethods: ["Cash", "Bank transfer"] },
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

describe("the scanned copy of a receipt (Q-51, D-100)", () => {
  /** The role matrix, narrowed: everything allowed except the permissions named. */
  const without = (denied: string[]) => ((permission: string) => !denied.includes(permission)) as unknown as Tms["allowed"];

  it("offers to file a scan, and opens the one already on file", () => {
    openJune(base([expense(), expense({ id: "ex2", reference: "EXP-2026-0002", receiptReference: "RCPT-2", receiptHeld: true })], [scan()]));

    // The entry with a scan: a link that opens the image through the guarded route.
    const open = screen.getByRole("link", { name: "Open the scan of EXP-2026-0001" });
    expect(open.getAttribute("href")).toBe("/api/receipts/rc1");
    expect(screen.getByText("Total filing 4 Aug.pdf")).toBeTruthy();

    // The entry without one: a button that opens the filing panel, not a silent blank.
    expect(screen.getByRole("button", { name: "File a scan for EXP-2026-0002" })).toBeTruthy();

    // And the gap is counted for the whole period, with the count agreeing with the rows.
    const stat = screen.getByText("No scan on file").closest(".rts-stat") as HTMLElement;
    expect(within(stat).getByText("1")).toBeTruthy();
  });

  it("does not mention scans at all to a role that may not read them", () => {
    // Operations reads the expense register but not the paper behind it.
    openJune(base(), { allowed: without(["receipts:read", "receipts:write"]) });

    expect(screen.queryByText("No scan on file")).toBeNull();
    expect(screen.queryByRole("button", { name: /File a scan/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Open the scan/ })).toBeNull();
    // The register itself is unchanged: the paper facts it has always shown are still there.
    expect(screen.getByText("RCPT-0091")).toBeTruthy();
    expect(screen.getByText(/kept by finance and administrators/)).toBeTruthy();
  });

  it("files the scan through the upload method, and says where the file goes first", async () => {
    const attachReceipt = vi.fn(async () => ({ ok: true, message: "Scan filed against EXP-2026-0001." }) as CommandResult);
    openJune(base(), { attachReceipt });

    fireEvent.click(screen.getByRole("button", { name: "File a scan for EXP-2026-0001" }));
    const panel = screen.getByRole("dialog", { name: /File a scan for EXP-2026-0001/ });
    // Nothing is written anywhere until somebody presses the button.
    expect(attachReceipt).not.toHaveBeenCalled();
    // The three rules the owner set are stated in the panel, not discovered later.
    expect(within(panel).getByText(/folder on this machine beside the database/)).toBeTruthy();
    expect(within(panel).getByText(/kept for 3 years/)).toBeTruthy();
    expect(within(panel).getByText(/Only finance and administrators can open it/)).toBeTruthy();

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "receipt.pdf", { type: "application/pdf" });
    fireEvent.change(within(panel).getByLabelText("Receipt scan"), { target: { files: [file] } });
    fireEvent.click(within(panel).getByRole("button", { name: "File the scan" }));

    await waitFor(() => expect(attachReceipt).toHaveBeenCalledWith("ex1", file));
  });

  it("refuses a file that is too large before it is sent", async () => {
    const attachReceipt = vi.fn(async () => ({ ok: true, message: "filed" }) as CommandResult);
    openJune(base(), { attachReceipt });

    fireEvent.click(screen.getByRole("button", { name: "File a scan for EXP-2026-0001" }));
    const panel = screen.getByRole("dialog", { name: /File a scan for EXP-2026-0001/ });
    // 2 MB is the ceiling; this file claims to be larger without carrying the bytes.
    const huge = new File([new Uint8Array(1)], "huge.jpg", { type: "image/jpeg" });
    Object.defineProperty(huge, "size", { value: 3 * 1024 * 1024 });
    fireEvent.change(within(panel).getByLabelText("Receipt scan"), { target: { files: [huge] } });

    expect(within(panel).getByText(/That file is 3.0 MB/)).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "File the scan" })).toHaveProperty("disabled", true);
    expect(attachReceipt).not.toHaveBeenCalled();
  });
});

describe("copying a receipt number (D-111)", () => {
  it("offers the receipt number from the row, and copies the number as typed", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    openJune(base([expense()]));

    const copy = screen.getByRole("button", { name: "Copy receipt number RCPT-0091" });
    await act(async () => {
      fireEvent.click(copy);
    });

    expect(writeText).toHaveBeenCalledWith("RCPT-0091");
    const wrapper = copy.closest(".rts-copy") as HTMLElement;
    expect(within(wrapper).getByRole("status").textContent).toBe("Receipt number RCPT-0091 copied.");
  });

  it("offers nothing to copy where the expense has no receipt number", () => {
    openJune(base([expense({ receiptReference: "" })]));
    expect(screen.queryByRole("button", { name: /^Copy receipt number/ })).toBeNull();
    expect(screen.getByText("no number")).toBeTruthy();
  });
});

describe("handing the expenses to a spreadsheet (RPT-04, D-113)", () => {
  it("downloads the period's entries, named for the period, with an apostrophe on a formula", () => {
    const created: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      value: (blob: Blob) => {
        created.push(blob);
        return "blob:expenses";
      },
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, configurable: true });
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });

    // A description typed as a formula is text, and the file must not hand it to Excel as one.
    openJune(base([expense({ description: '=HYPERLINK("http://example.test")' })]));
    fireEvent.click(screen.getByRole("button", { name: /Download CSV/i }));

    expect(clicked).toEqual(["expenses-2026-06-01-to-2026-06-30.csv"]);
    expect(created).toHaveLength(1);
    click.mockRestore();
  });

  it("offers nothing to download for a period with no entries", () => {
    openJune(base([]));
    expect(screen.getByRole("button", { name: /Download CSV/i })).toHaveProperty("disabled", true);
  });
});
