// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import App from "./App";
import { installFakeServer } from "./test/fakeServer";

import { executeCommand, type AnyCommand } from "./tms/commands";
import { execute, type Actor } from "./tms/service";
import { emptyDatabase, type Database } from "./tms/types";

const NOW = "2026-01-01T00:00:00.000Z";
const credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(window, "scrollTo", { value: () => undefined, configurable: true });
});
afterEach(cleanup);

function seedExpiredQuote() {
  let db: Database = emptyDatabase();
  const setup = execute(db, null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  db = setup.db;
  const admin: Actor = { id: db.users[0].id, fullName: "Admin", role: "administrator" };
  const run = (command: AnyCommand, at = NOW) => {
    const result = executeCommand(db, admin, command, at);
    if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
    db = result.db;
  };

  run({
    type: "update_settings",
    input: {
      ...db.settings,
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      vehicleCategories: [{ id: "", name: "Minibus", licenceClasses: [] }],
      rental: { quotationTerms: "Prices are firm for the validity period.", pricingBasis: "per_day", depositPercent: 25, quotationValidityHours: 168, driversAlwaysIncluded: null, paymentMethods: ["Bank transfer"], requotePolicy: null, quotationApprovalAbove: null, extraChargeApprovalAbove: null },
    },
  });
  const categoryId = db.settings.vehicleCategories[0].id;
  run({
    type: "create_rental",
    input: {
      clientId: null,
      customerName: "Ama Mensah",
      customerPhone: "0240000000",
      customerEmail: "ama@example.test",
      purpose: "Airport transfer",
      pickupLocation: "Accra",
      dropoffLocation: "Kumasi",
      startDate: "2026-02-01",
      endDate: "2026-02-02",
      passengers: "4",
      vehicleCategoryId: categoryId,
      driverRequired: false,
      notes: "",
    },
  });
  const rentalId = db.rentals[0].id;
  run({ type: "quote_rental", id: rentalId, input: { lines: [{ description: "Airport transfer", quantity: "1", unitAmount: "1000" }] } });
  installFakeServer(db, admin.id);
}

/** Renders the app and waits for the initial /api/session round trip to settle. */
async function renderApp() {
  const view = render(<App />);
  await waitFor(() => expect(screen.queryByText(/Contacting the server/i)).toBeNull());
  return view;
}

describe("Expired quotation policy end-to-end (jsdom)", () => {
  it("blocks renewal until configured, then revises in place and retains the old quote", async () => {
    seedExpiredQuote();
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /Bus rentals/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Open$/i }));
    expect(await screen.findByText(/Quotation expired/i)).toBeTruthy();
    expect(screen.getByText(/policy in Settings/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Renew quotation/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Settings/i }));
    const policy = screen.getByLabelText(/Expired quotation policy/i);
    fireEvent.change(policy, { target: { value: "revise_in_place" } });
    fireEvent.click(screen.getByRole("button", { name: /Save settings/i }));
    await screen.findByText(/Settings saved/i);

    fireEvent.click(screen.getByRole("button", { name: /Bus rentals/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Open$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Renew quotation/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByDisplayValue("Airport transfer")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Unit amount/i), { target: { value: "1500" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Issue revised quotation/i }));
    await screen.findByText(/Quotation QUO-0001 renewed for RR-0001 as revision 2; prior quotation retained/i);
    expect(screen.getByText(/Previous quotations retained/i)).toBeTruthy();
    expect(screen.getByText("Revision 1")).toBeTruthy();
    expect(screen.getAllByText("Airport transfer").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1,500\.00|GHS.*1500\.00/).length).toBeGreaterThan(0);
  }, 30000);
});