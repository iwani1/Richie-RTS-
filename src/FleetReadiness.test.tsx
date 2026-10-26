// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import App from "./App";
import { installFakeServer } from "./test/fakeServer";

import { executeCommand, type AnyCommand } from "./tms/commands";
import { execute, type Actor } from "./tms/service";
import { emptyDatabase, type Database } from "./tms/types";

const NOW = "2026-06-01T10:00:00.000Z";
const credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(window, "scrollTo", { value: () => undefined, configurable: true });
});
afterEach(cleanup);

// Administrator, one category, one vehicle, and a completed service at NOW (so by today the
// 90 day interval is overdue). No service schedule: the report must start as not configured.
function seed() {
  let db: Database = emptyDatabase();
  const setup = execute(db, null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  db = setup.db;
  const admin: Actor = { id: db.users[0].id, fullName: "Admin", role: "administrator" };
  const run = (command: AnyCommand) => {
    const result = executeCommand(db, admin, command, NOW);
    if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
    db = result.db;
  };

  run({ type: "update_settings", input: { ...db.settings, companyName: "Richie Transport Services", vehicleCategories: [{ id: "", name: "Coach", licenceClasses: [] }], maintenance: { blockOnOverdueService: false, schedules: [] } } });
  run({ type: "create_vehicle", input: { registration: "GT 7-26", categoryId: db.settings.vehicleCategories[0].id, make: "", model: "", seatCapacity: "30", notes: "" } });
  run({
    type: "create_work_order",
    input: { vehicleId: db.vehicles[0].id, title: "Major service", workType: "Service", workshop: "", description: "", reportedOdometer: "120000", plannedDate: "", incidentId: "", resetsServiceInterval: true },
  });
  const workOrderId = db.workOrders[0].id;
  run({ type: "advance_work_order", id: workOrderId, input: { to: "in_progress", note: "Booked in", costsConfirmedComplete: false, vehicleRestoredTo: "unchanged" } });
  run({ type: "advance_work_order", id: workOrderId, input: { to: "completed", note: "Oil, filters and inspection", costsConfirmedComplete: true, vehicleRestoredTo: "unchanged" } });

  installFakeServer(db, admin.id);
}

/** Renders the app and waits for the initial /api/session round trip to settle. */
async function renderApp() {
  const view = render(<App />);
  await waitFor(() => expect(screen.queryByText(/Contacting the server/i)).toBeNull());
  return view;
}

describe("Fleet readiness end-to-end (jsdom)", () => {
  it("starts unconfigured, schedules a category, reports overdue, records an odometer and flags the dashboard", async () => {
    seed();
    await renderApp();

    // Nothing is scheduled, so the report refuses to estimate.
    fireEvent.click(screen.getByRole("button", { name: /Fleet readiness/i }));
    expect(await screen.findByText(/No service schedules configured/i)).toBeTruthy();
    expect(screen.getByText("Not evaluated")).toBeTruthy();
    expect(screen.getAllByText(/No service schedule is configured for this vehicle category/i).length).toBeGreaterThan(0);

    // Administrator configures a schedule per category (no defaults anywhere).
    fireEvent.click(screen.getByRole("button", { name: /^Settings/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Add schedule$/i }));
    fireEvent.change(screen.getByLabelText(/Interval \(days\)/), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText(/Interval \(km\)/), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save settings$/i }));
    await screen.findByText(/Settings saved/i);

    // The service is 100+ days old, so the day basis is overdue while km is fine.
    fireEvent.click(screen.getByRole("button", { name: /Fleet readiness/i }));
    expect((await screen.findAllByText("100%")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Overdue/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No service schedules configured/i)).toBeNull();

    // Odometer logging runs through the module command and appears in the log.
    fireEvent.click(screen.getByRole("tab", { name: /Odometer log/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Record reading$/i }));
    const dialog = screen.getByRole("dialog");
    const vehicleSelect = within(dialog).getByLabelText(/^Vehicle/i) as HTMLSelectElement;
    fireEvent.change(vehicleSelect, { target: { value: vehicleSelect.options[1].value } });
    fireEvent.change(within(dialog).getByLabelText(/Odometer \(km\)/), { target: { value: "130500" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save reading/i }));
    expect(await screen.findByText(/Odometer recorded at 130500 km/i)).toBeTruthy();
    expect(screen.getByText("130500 km")).toBeTruthy();

    // The dashboard surfaces the overdue condition. The 2026 redesign replaced the old notice
    // with an exception row on the operations board; the promise is the same, the wording is new.
    fireEvent.click(screen.getByRole("button", { name: /^Dashboard/i }));
    expect(await screen.findByText(/vehicle past service interval/i)).toBeTruthy();
  }, 30000);
});
