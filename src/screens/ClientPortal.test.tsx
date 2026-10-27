// @vitest-environment jsdom
//
// The client portal in a browser (brief 1B: CLI-03, D-114).
//
// The domain rules are proven in `src/tms/clientAccount.test.ts` and the payload in
// `src/server/visibility.test.ts`. What is left, and what this file checks, is the page a corporate
// contact actually opens: whether it says what the account owes, whether the rows behind that figure
// are there, and whether another customer's invoice can reach it.
//
// The fixtures are written onto the fake server's database rather than raised through the whole hire →
// complete → invoice → payment path, because the snapshot takes whatever the server holds and this is
// about what survives that narrowing.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import App from "../App";
import { installFakeServer } from "../test/fakeServer";
import { executeCommand, type AnyCommand } from "../tms/commands";
import type { Actor } from "../tms/service";
import { emptyDatabase, emptyRentalSettings, type CreditNote, type Database, type Invoice, type Payment } from "../tms/types";


const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);
const fakeCred = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(window, "scrollTo", { value: () => undefined, configurable: true });
});
afterEach(cleanup);

const invoice = (id: string, clientId: string, reference: string, overrides: Partial<Invoice> = {}): Invoice => ({
  id,
  reference,
  kind: "rental",
  rentalId: null,
  clientId,
  customerName: "Alpha Ltd",
  buyerAddress: "",
  buyerTin: "",
  currencyCode: "GHS",
  lines: [{ id: `${id}-l`, description: "Two days hire", quantity: 2, unitAmount: 2000 }],
  taxLines: [{ name: "VAT", ratePercent: 15, amount: 600 }],
  subtotal: 4000,
  total: 4600,
  amountPaid: 0,
  status: "issued",
  billableEvent: `rental:${id}:final`,
  issuedOn: "2026-06-01",
  dueOn: "2026-06-15",
  notes: "",
  voidReason: null,
  voidedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const payment = (id: string, invoiceId: string, amount: number): Payment => ({
  id,
  reference: `PAY-2026-000${id.slice(-1)}`,
  invoiceId,
  amount,
  currencyCode: "GHS",
  method: "Bank transfer",
  paidOn: "2026-06-10",
  externalReference: "",
  status: "recorded",
  note: "",
  log: [],
  recordedBy: "Fin",
  recordedAt: NOW,
  voidReason: null,
  voidedAt: null,
});

const credit = (id: string, invoiceId: string, clientId: string): CreditNote => ({
  id,
  reference: `CN-2026-000${id.slice(-1)}`,
  invoiceId,
  invoiceReference: "INV-2026-0001",
  clientId,
  customerName: "Alpha Ltd",
  currencyCode: "GHS",
  lines: [],
  taxLines: [],
  subtotal: 500,
  total: 575,
  reason: "One day not operated",
  issuedOn: "2026-06-20",
  status: "issued",
  voidReason: null,
  voidedAt: null,
  createdBy: "Fin",
  createdAt: NOW,
  updatedAt: NOW,
});

/**
 * One company with two customers, a contact for the first, and billing on both accounts — so "no other
 * customer's invoice" is a real assertion rather than an empty one.
 */
function seed(options: { bills?: boolean } = {}): { userId: string; alphaId: string } {
  let db: Database = emptyDatabase();
  const run = (actor: Actor | null, command: AnyCommand) => {
    const result = executeCommand(db, actor, command, NOW);
    if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
    db = result.db;
  };

  run(null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential: fakeCred });
  const admin: Actor = { id: db.users[0].id, fullName: "Admin", role: "administrator" };
  run(admin, {
    type: "update_settings",
    input: { ...db.settings, companyName: "Richie Transport Services", currencyCode: "GHS", vehicleCategories: [], shifts: [], rental: emptyRentalSettings() },
  });
  run(admin, { type: "create_client", input: { name: "Alpha Ltd", contactName: "Ama", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" } });
  run(admin, { type: "create_client", input: { name: "Beta Ltd", contactName: "Kojo", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" } });
  const [alphaId, betaId] = db.clients.map((client) => client.id);

  run(admin, {
    type: "create_user",
    input: { fullName: "Alpha Contact", email: "alpha@example.test", role: "client_contact", active: true, driverId: null, clientId: alphaId },
    credential: fakeCred,
  });
  const userId = db.users.find((user) => user.role === "client_contact")!.id;

  if (options.bills !== false) {
    db = {
      ...db,
      invoices: [
        invoice("inv1", alphaId, "INV-2026-0001", { issuedOn: TODAY, dueOn: TODAY }),
        invoice("inv2", betaId, "INV-2026-0002", { issuedOn: TODAY, dueOn: TODAY }),
      ],
      payments: [payment("p1", "inv1", 1000), payment("p2", "inv2", 600)],
      creditNotes: [credit("cn1", "inv1", alphaId)],
      refunds: [],
    };
  }

  installFakeServer(db, userId);
  return { userId, alphaId };
}

/** A figure from the band of totals, not the table heading of the same name. */
const stat = (label: string) => {
  const tile = screen
    .getAllByText(label)
    .map((element) => element.closest(".rts-stat"))
    .find(Boolean) as HTMLElement | undefined;
  if (!tile) throw new Error(`No figure labelled ${label}`);
  return tile;
};

async function renderPortal() {
  render(<App />);
  await waitFor(() => expect(screen.queryByText(/Contacting the server/i)).toBeNull());
  // The portal is the only screen a client contact can reach; waiting for its heading proves it opened.
  await screen.findByRole("heading", { name: "Your account" }, { timeout: 10000 });
}

describe("Client portal (jsdom)", () => {
  it("states what the account owes, and the documents behind that figure", async () => {
    seed();
    await renderPortal();

    // 4,600 billed, 1,000 received, 575 credited: 3,025 still owed, none of it past its due date.
    const due = stat("Balance due");
    expect(due.textContent).toContain("GHS 3025.00");
    const billed = stat("Billed");
    expect(billed.textContent).toContain("GHS 4600.00");
    const paid = stat("Paid");
    expect(paid.textContent).toContain("GHS 1000.00");

    // The rows: the invoice, the payment against it, and the credit note with the reason given.
    // The invoice reference appears on its own row, on the payment's "against" column, and on the
    // credit note's: three places, one document.
    expect(screen.getAllByText("INV-2026-0001").length).toBe(3);
    expect(screen.getByText("PAY-2026-0001")).toBeTruthy();
    expect(screen.getByText("CN-2026-0001")).toBeTruthy();
    expect(screen.getByText("One day not operated")).toBeTruthy();
    // A bill that is partly paid and not yet late says so in words, not only in a colour.
    expect(screen.getAllByText("Part paid").length).toBeGreaterThan(0);
  }, 30000);

  it("never shows another customer's invoice, payment or credit note", async () => {
    seed();
    await renderPortal();
    expect(screen.queryByText("INV-2026-0002")).toBeNull();
    expect(screen.queryByText("PAY-2026-0002")).toBeNull();
  }, 30000);

  it("says there is nothing to state when the account has never been billed", async () => {
    seed({ bills: false });
    await renderPortal();
    expect(screen.getByText("Nothing billed yet")).toBeTruthy();
    expect(screen.getByText("No payments recorded")).toBeTruthy();
    expect(screen.getByText("Nothing credited")).toBeTruthy();
    // No figure is invented for an account with no invoice.
    expect(screen.queryByText("Balance due")).toBeNull();
  }, 30000);
});
