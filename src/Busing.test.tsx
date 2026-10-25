// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import App from "./App";
import { installFakeServer } from "./test/fakeServer";

let api: ReturnType<typeof installFakeServer>;
import { executeCommand, type AnyCommand } from "./tms/commands";
import { execute, type Actor } from "./tms/service";
import { emptyDatabase, emptyRentalSettings, type Database } from "./tms/types";

const NOW = "2026-06-01T06:00:00.000Z";
const fakeCred = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(window, "scrollTo", { value: () => undefined, configurable: true });
});
afterEach(cleanup);

// Seeds a signed-in administrator with one client, route, passenger and today's trip,
// so the UI test starts directly on the Staff busing screen.
function seed(options: { overdue?: boolean } = {}): { vehicleId: string; driverId: string } {
  const today = new Date().toISOString().slice(0, 10);
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
      taxPosition: null,
      taxLines: [],
      invoiceDueDays: null,
      workTypes: ["Service", "Repair", "Tyres", "Bodywork", "Inspection", "Other"],
      costCategories: ["Parts", "Labour", "Tyres"],
      maintenance: { schedules: [], blockOnOverdueService: false },
    },
  });
  const categoryId = db.settings.vehicleCategories[0].id;
  run({ type: "create_client", input: { name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "", status: "active" } });
  run({ type: "create_vehicle", input: { registration: "GT 900-26", categoryId, make: "", model: "", seatCapacity: "30", notes: "" } });
  run({ type: "create_driver", input: { fullName: "Kojo Driver", phone: "024", licenceNumber: "DRV-1", licenceExpiry: "2030-01-01", status: "active" } });

  if (options.overdue) {
    // The workshop serviced it at 120,000 km and the odometer has since passed the 10,000 km
    // interval. Q-43's rule is off, so this is a warning rather than a block.
    run({
      type: "update_settings",
      input: {
        ...db.settings,
        maintenance: {
          blockOnOverdueService: false,
          schedules: [{ categoryId, intervalKm: 10000, intervalDays: null, remindLeadKm: null, remindLeadDays: null }],
        },
      },
    });
    const vehicleId = db.vehicles[0].id;
    run({
      type: "create_work_order",
      input: { vehicleId, title: "Major service", workType: "Service", workshop: "", description: "", reportedOdometer: "120000", plannedDate: "", incidentId: "", resetsServiceInterval: true },
    });
    const orderId = db.workOrders[db.workOrders.length - 1].id;
    run({ type: "advance_work_order", id: orderId, input: { to: "in_progress", note: "Booked in", costsConfirmedComplete: false, vehicleRestoredTo: "unchanged" } });
    run({ type: "advance_work_order", id: orderId, input: { to: "completed", note: "Filters and oil", costsConfirmedComplete: true, vehicleRestoredTo: "unchanged" } });
    run({ type: "advance_work_order", id: orderId, input: { to: "closed", note: "Costs reviewed", costsConfirmedComplete: true, vehicleRestoredTo: "available" } });
    run({ type: "record_odometer", input: { vehicleId, readingKm: "135000", readingDate: "2026-06-01", note: "" } });
  }

  run({
    type: "create_route",
    input: {
      name: "Estate run",
      clientId: db.clients[0].id,
      direction: "to_work",
      shiftId: "",
      vehicleCategoryId: categoryId,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: "2020-01-01",
      endDate: "",
      status: "active",
      stops: [
        { name: "Estate gate", scheduledTime: "06:00" },
        { name: "Head office", scheduledTime: "06:30" },
      ],
    },
  });
  const route = db.routes[0];
  run({
    type: "create_passenger",
    input: { fullName: "Ama Boateng", employeeRef: "E-001", phone: "", clientId: route.clientId, routeId: route.id, stopId: route.stops[0].id, status: "active" },
  });
  run({ type: "generate_trips", routeId: route.id, fromDate: today, toDate: today });

  api = installFakeServer(db, admin.id);
  return { vehicleId: db.vehicles[0].id, driverId: db.drivers[0].id };
}

/** Renders the app and waits for the initial /api/session round trip to settle. */
async function renderApp() {
  const view = render(<App />);
  await waitFor(() => expect(screen.queryByText(/Contacting the server/i)).toBeNull());
  return view;
}

describe("Staff busing end-to-end (jsdom)", () => {
  it("runs a trip from assignment through dispatch and completion to on-time performance", async () => {
    const { vehicleId, driverId } = seed();
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /Staff busing/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^Trips$/ }));
    expect(await screen.findByText("TR-0001")).toBeTruthy();

    // Assign a vehicle and driver.
    fireEvent.click(screen.getByRole("button", { name: /^Assign$/ }));
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Vehicle/), { target: { value: vehicleId } });
    fireEvent.change(within(dialog).getByLabelText(/^Driver/), { target: { value: driverId } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save assignment/i }));

    // Dispatch.
    fireEvent.click(await screen.findByRole("button", { name: /^Dispatch$/ }));
    await screen.findByText(/dispatched\./i);

    // Record completion with actual stop times inside the threshold.
    fireEvent.click(await screen.findByRole("button", { name: /Record full completion/i }));
    dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Actual time at Estate gate/i), { target: { value: "06:02" } });
    fireEvent.change(within(dialog).getByLabelText(/Actual time at Head office/i), { target: { value: "06:31" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save completion/i }));
    await screen.findByText(/completed\. On time: yes/i);

    // Performance reflects the completed, on-time trip.
    fireEvent.click(screen.getByRole("tab", { name: /Performance/i }));
    expect((await screen.findAllByText("100%")).length).toBeGreaterThan(0);
    expect(screen.getByText(/RPT-02 and RPT-03/i)).toBeTruthy();
  }, 30000);

  it("adds a rider to a future stop mid-run, blocks recorded stops, and completes with them", async () => {
    const { vehicleId, driverId } = seed();
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /Staff busing/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^Trips$/ }));
    expect(await screen.findByText("TR-0001")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Assign$/ }));
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Vehicle/), { target: { value: vehicleId } });
    fireEvent.change(within(dialog).getByLabelText(/^Driver/), { target: { value: driverId } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save assignment/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Dispatch$/ }));
    await screen.findByText(/dispatched\./i);
    fireEvent.click(await screen.findByRole("button", { name: /^Start run$/ }));
    await screen.findByText(/started\. Record each stop/i);

    // Mid-trip addition to a future stop is allowed while the run is in progress.
    fireEvent.click(screen.getByRole("tab", { name: /^Passengers$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add passenger/i }));
    dialog = screen.getByRole("dialog");
    const clientSelect = within(dialog).getByLabelText("Client") as HTMLSelectElement;
    fireEvent.change(clientSelect, { target: { value: clientSelect.options[1].value } });
    fireEvent.change(within(dialog).getByLabelText("Full name"), { target: { value: "Yaw Mensah" } });
    const routeSelect = within(dialog).getByLabelText(/Route/) as HTMLSelectElement;
    fireEvent.change(routeSelect, { target: { value: routeSelect.options[1].value } });
    const stopSelect = within(dialog).getByLabelText("Pickup stop") as HTMLSelectElement;
    const officeOption = Array.from(stopSelect.options).find((o) => o.text.includes("Head office"))!;
    fireEvent.change(stopSelect, { target: { value: officeOption.value } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save passenger/i }));
    await screen.findByText(/Passenger record created/i);

    // Record the first stop, then confirm the recorded stop is disabled for new riders.
    fireEvent.click(screen.getByRole("tab", { name: /^Trips$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Record next stop/i }));
    dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Actual arrival at Estate gate/i), { target: { value: "06:03" } });
    fireEvent.change(within(dialog).getByLabelText(/Ama Boateng/i), { target: { value: "boarded" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save stop/i }));
    await screen.findByText(/Estate gate recorded/i);

    fireEvent.click(screen.getByRole("tab", { name: /^Passengers$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add passenger/i }));
    dialog = screen.getByRole("dialog");
    const clientSelect2 = within(dialog).getByLabelText("Client") as HTMLSelectElement;
    fireEvent.change(clientSelect2, { target: { value: clientSelect2.options[1].value } });
    const routeSelect2 = within(dialog).getByLabelText(/Route/) as HTMLSelectElement;
    fireEvent.change(routeSelect2, { target: { value: routeSelect2.options[1].value } });
    const stopSelect2 = within(dialog).getByLabelText("Pickup stop") as HTMLSelectElement;
    const gateOption = Array.from(stopSelect2.options).find((o) => o.text.includes("Estate gate"))!;
    expect(gateOption.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel$/ }));

    // The mid-trip rider boards at the future stop; the run completes with them.
    fireEvent.click(screen.getByRole("tab", { name: /^Trips$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Record next stop/i }));
    dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Actual arrival at Head office/i), { target: { value: "06:31" } });
    fireEvent.change(within(dialog).getByLabelText(/Yaw Mensah/i), { target: { value: "boarded" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save stop/i }));
    await screen.findByText(/Head office recorded/i);
    fireEvent.click(await screen.findByRole("button", { name: /Complete run/i }));
    await screen.findByText(/completed\. On time: yes/i);

    const db = api.db();
    expect(db.trips[0].boardings).toHaveLength(2);
    expect(db.audit.some((entry) => entry.summary.includes("Mid-trip addition"))).toBe(true);
  }, 30000);
});

describe("an overdue routine service, seen by the dispatcher (Q-43, D-80)", () => {
  it("says so in the vehicle list and in the message after dispatch while the rule only warns", async () => {
    const { vehicleId, driverId } = seed({ overdue: true });
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /Staff busing/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^Trips$/ }));
    expect(await screen.findByText("TR-0001")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Assign$/ }));
    const dialog = screen.getByRole("dialog");
    // The warning is in the list itself, before anything is chosen.
    expect(within(dialog).getByRole("option", { name: /GT 900-26.*service overdue/ })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Vehicle/), { target: { value: vehicleId } });
    fireEvent.change(within(dialog).getByLabelText(/^Driver/), { target: { value: driverId } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save assignment/i }));

    // The run still goes out, and the office is told why the note is there.
    expect(await screen.findByText(/overdue for routine service/i)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^Dispatch$/ }));
    expect(await screen.findByText(/dispatched\..*overdue for routine service/i)).toBeTruthy();
  });
});

describe("importing a roster from the passengers tab (EMP-02)", () => {
  it("offers the roster template and checks the file before saving anything", async () => {
    seed();
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /Staff busing/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^Passengers$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Import CSV/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Import roster entries from CSV/i)).toBeTruthy();
    // The template names the columns a roster file must carry, and says what must already exist.
    expect(within(dialog).getByText("name,employee ref,phone,client,route,stop,status")).toBeTruthy();
    expect(within(dialog).getByText(/Client, route and stop are matched by name/i)).toBeTruthy();

    // Previewing the existing rider is refused: the roster already holds that employee reference.
    fireEvent.change(within(dialog).getByLabelText("CSV contents"), {
      target: { value: "name,employee ref,phone,client,route,stop,status\nAma Boateng,E-001,,Acme Ltd,Estate run,Estate gate,\n" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Check file/i }));

    expect(await within(dialog).findByText(/already exists for this client/i)).toBeTruthy();
  });
});

describe("a run outside the schedule, from the dispatch screen (DSP-03)", () => {
  it("creates a run for a day the route does not operate and shows it with its reason", async () => {
    seed();
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /Staff busing/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^Trips$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Add an ad hoc run/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Add a run outside the schedule/i)).toBeTruthy();

    // A date the seeded route does operate on, so the run sits beside a scheduled one.
    const today = new Date().toISOString().slice(0, 10);
    fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: today } });
    fireEvent.change(within(dialog).getByLabelText(/Why is this run needed/i), { target: { value: "Second bus for the audit team." } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Create run/i }));

    // The run appears on the sheet, marked as an exception with the reason the dispatcher typed.
    expect(await screen.findByText(/Second bus for the audit team\./)).toBeTruthy();
    expect(screen.getAllByText(/ad hoc/).length).toBeGreaterThan(0);
  });

  it("refuses a run with no reason, and keeps the dialog open", async () => {
    seed();
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /Staff busing/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^Trips$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Add an ad hoc run/i }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Create run/i }));
    expect(await within(dialog).findByText(/Say why this run is needed/i)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
