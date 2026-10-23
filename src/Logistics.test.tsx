// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import App from "./App";
import { executeCommand, type AnyCommand } from "./tms/commands";
import { execute, type Actor } from "./tms/service";
import { emptyDatabase, emptyRentalSettings, type Database } from "./tms/types";

const NOW = "2026-06-01T06:00:00.000Z";
const fakeCred = { passwordHash: "h", passwordSalt: "s" };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(window, "scrollTo", { value: () => undefined, configurable: true });
});
afterEach(cleanup);

// Seeds a signed-in administrator with a vehicle category, the company currency and
// one available vehicle, so the test starts directly on the Staff logistics screen.
function seed(): { vehicleId: string } {
  let db: Database = emptyDatabase();
  const setup = execute(db, null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential: fakeCred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  db = setup.db;
  const admin: Actor = { id: db.users[0].id, fullName: "Admin", role: "administrator" };

  const run = (command: AnyCommand) => {
    const r = executeCommand(db, admin, command, NOW);
    if (!r.ok) throw new Error(`${command.type}: ${r.message} ${JSON.stringify(r.errors)}`);
    db = r.db;
  };

  run({
    type: "update_settings",
    input: {
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      onTimeThresholdMinutes: 5,
      vehicleCategories: [{ id: "", name: "Coaster" }],
      shifts: [],
      rental: emptyRentalSettings(),
      documentTypes: [],
      documentReminderLeadDays: null,
      maintenance: { schedules: [] },
    },
  });
  const categoryId = db.settings.vehicleCategories[0].id;
  run({ type: "create_vehicle", input: { registration: "GT 900-26", categoryId, make: "", model: "", seatCapacity: "30", notes: "" } });

  localStorage.setItem("richie-tms:db:v1", JSON.stringify(db));
  sessionStorage.setItem("richie-tms:session", admin.id);
  return { vehicleId: db.vehicles[0].id };
}

const openLogistics = () => fireEvent.click(screen.getByRole("button", { name: /Staff logistics/i }));
const advanceTo = (dialog: HTMLElement, status: string, label: RegExp, note: string) => {
  fireEvent.change(within(dialog).getByLabelText(/^New status/), { target: { value: status } });
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value: note } });
  fireEvent.click(within(dialog).getByRole("button", { name: /Record change/i }));
};

describe("Staff logistics end-to-end (jsdom)", () => {
  it("reports a breakdown, takes the vehicle off the road and runs the response to resolution", async () => {
    const { vehicleId } = seed();
    render(<App />);
    openLogistics();

    // Report a breakdown and take the vehicle out of service (the default choice).
    fireEvent.click(screen.getByRole("button", { name: /Report incident/i }));
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Vehicle/), { target: { value: vehicleId } });
    fireEvent.change(within(dialog).getByLabelText(/What happened\?/), { target: { value: "Coolant hose burst." } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Report incident$/i }));

    await screen.findByText(/IN-0001 reported/i);
    expect(screen.getAllByText(/out of service/i).length).toBeGreaterThan(0);

    // The vehicle register reflects the change immediately.
    fireEvent.click(screen.getByRole("button", { name: /Fleet register/i }));
    expect((await screen.findAllByText(/Out of service/i)).length).toBeGreaterThan(0);

    // Acknowledge, respond (a breakdown needs someone named), then resolve.
    openLogistics();
    fireEvent.click(await screen.findByRole("button", { name: /^Open$/i }));
    dialog = screen.getByRole("dialog");
    await within(dialog).findByText(/IN-0001/);

    advanceTo(dialog, "acknowledged", /^Note/, "Seen by dispatch.");
    await screen.findByText(/is now acknowledged/i);

    fireEvent.change(within(dialog).getByLabelText(/^New status/), { target: { value: "responding" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Record change/i }));

    await screen.findByText(/who is responding/i); // blocked until a responder is named

    fireEvent.change(within(dialog).getByLabelText(/Responding \(required/), { target: { value: "Kojo Mensah" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Record change/i }));
    await screen.findByText(/is now responding/i);

    fireEvent.change(within(dialog).getByLabelText(/^New status/), { target: { value: "resolved" } });
    fireEvent.change(within(dialog).getByLabelText(/How was it resolved\?/), { target: { value: "Hose replaced by the roadside." } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Record change/i }));
    await screen.findByText(/is now resolved/i);

    // Raise the linked work order straight from the incident.
    fireEvent.click(within(dialog).getByRole("button", { name: /Raise work order/i }));
    const workDialog = screen.getByRole("dialog");
    fireEvent.change(within(workDialog).getByLabelText(/^Title/), { target: { value: "Replace coolant hose" } });
    fireEvent.change(within(workDialog).getByLabelText(/^Type of work/), { target: { value: "Engine" } });
    fireEvent.click(within(workDialog).getByRole("button", { name: /Raise work order/i }));
    await screen.findByText(/WO-0001 raised/i);
    expect(await screen.findByText("Replace coolant hose")).toBeTruthy();
  }, 30000);

  it("records costs, drives the work order to closure and reports the cost with coverage", async () => {
    const { vehicleId } = seed();
    render(<App />);
    openLogistics();

    fireEvent.click(screen.getByRole("button", { name: /Report incident/i }));
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Vehicle/), { target: { value: vehicleId } });
    fireEvent.change(within(dialog).getByLabelText(/What happened\?/), { target: { value: "Tyre blowout." } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Report incident$/i }));
    await screen.findByText(/IN-0001 reported/i);

    fireEvent.click(screen.getByRole("button", { name: /^Open$/i }));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Raise work order/i }));
    const workDialog = screen.getByRole("dialog");
    fireEvent.change(within(workDialog).getByLabelText(/^Title/), { target: { value: "Replace nearside tyre" } });
    fireEvent.change(within(workDialog).getByLabelText(/^Type of work/), { target: { value: "Tyres" } });
    fireEvent.click(within(workDialog).getByRole("button", { name: /Raise work order/i }));
    await screen.findByText(/WO-0001 raised/i);

    // Record what it cost.
    fireEvent.click(await screen.findByRole("button", { name: /^Open$/i }));
    const orderDialog = screen.getByRole("dialog");
    fireEvent.change(within(orderDialog).getByLabelText(/What was the cost for\?/), { target: { value: "Tyre and fitting" } });
    fireEvent.change(within(orderDialog).getByLabelText(/^Amount/), { target: { value: "1250.00" } });
    fireEvent.click(within(orderDialog).getByRole("button", { name: /Record cost/i }));
    expect(await within(orderDialog).findByText(/1,?250\.00|GHS 1250\.00/)).toBeTruthy();

    // Drive the work order through to closure and return the vehicle to service.
    advanceTo(orderDialog, "in_progress", /^Note/, "In the workshop.");
    await screen.findByText(/is now in progress/i);

    fireEvent.change(within(orderDialog).getByLabelText(/^New status/), { target: { value: "completed" } });
    fireEvent.change(within(orderDialog).getByLabelText(/What work was done\?/), { target: { value: "Tyre replaced." } });
    fireEvent.click(within(orderDialog).getByRole("checkbox"));
    fireEvent.click(within(orderDialog).getByRole("button", { name: /Record change/i }));
    await screen.findByText(/is now completed/i);

    fireEvent.change(within(orderDialog).getByLabelText(/^New status/), { target: { value: "closed" } });
    fireEvent.change(within(orderDialog).getByLabelText(/^Cost review note/), { target: { value: "Invoice checked." } });
    fireEvent.click(within(orderDialog).getByRole("button", { name: /Record change/i }));
    await screen.findByText(/is now closed/i);
    await screen.findByText(/set to available/i);

    // The cost report shows the recorded amount with its period and coverage.
    fireEvent.click(screen.getByRole("tab", { name: /Cost report/i }));
    // The figure appears in the total and in the entry list.
    expect((await screen.findAllByText(/GHS 1250\.00/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Reporting period/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 of 2/)).toBeTruthy(); // 1 of the 2 records in scope has a recorded cost
    expect(screen.getAllByText(/Not configured/i).length).toBeGreaterThan(0); // RPT-02/03 stay unconfigured
  }, 30000);
});


