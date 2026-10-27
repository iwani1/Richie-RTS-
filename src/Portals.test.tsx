// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import App from "./App";
import { installFakeServer } from "./test/fakeServer";

let api: ReturnType<typeof installFakeServer>;
import { executeCommand, type AnyCommand } from "./tms/commands";
import type { Actor } from "./tms/service";
import { emptyDatabase, emptyRentalSettings, type Database } from "./tms/types";

const NOW = "2026-06-01T06:00:00.000Z";
const fakeCred = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const DATE = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(window, "scrollTo", { value: () => undefined, configurable: true });
});
afterEach(cleanup);

function saved(): Database {
  return api.db();
}

// Two clients and two routes, with a driver account and a client contact account each
// linked to the first pair. Anything belonging to the second pair must stay invisible.
function seed(): { driverUserId: string; clientUserId: string; driverVehicleId: string; otherVehicleId: string } {
  let db: Database = emptyDatabase();
  const run = (actor: Actor | null, command: AnyCommand) => {
    const r = executeCommand(db, actor, command, NOW);
    if (!r.ok) throw new Error(`${command.type}: ${r.message} ${JSON.stringify(r.errors)}`);
    db = r.db;
  };

  run(null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential: fakeCred });
  const admin: Actor = { id: db.users[0].id, fullName: "Admin", role: "administrator" };
  run(admin, { type: "create_user", input: { fullName: "Ops", email: "ops@example.test", role: "operations", active: true }, credential: fakeCred });
  const ops: Actor = { id: db.users[1].id, fullName: "Ops", role: "operations" };

  run(admin, {
    type: "update_settings",
    input: { ...db.settings, currencyCode: "GHS", vehicleCategories: [{ id: "", name: "Minibus", licenceClasses: [] }], shifts: [], rental: emptyRentalSettings() },
  });
  const category = db.settings.vehicleCategories[0].id;
  run(ops, { type: "create_vehicle", input: { registration: "GT 100-26", categoryId: category, make: "", model: "", seatCapacity: "30", notes: "" } });
  run(ops, { type: "create_vehicle", input: { registration: "GT 200-26", categoryId: category, make: "", model: "", seatCapacity: "30", notes: "" } });
  const [driverVehicleId, otherVehicleId] = [db.vehicles[0].id, db.vehicles[1].id];

  run(ops, { type: "create_driver", input: { fullName: "Kojo Mensah", phone: "024", licenceNumber: "L-1", licenceExpiry: "2030-01-01", status: "active" } });
  run(ops, { type: "create_driver", input: { fullName: "Kwame", phone: "020", licenceNumber: "L-2", licenceExpiry: "2030-01-01", status: "active" } });
  run(admin, { type: "create_client", input: { name: "Alpha Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" } });
  run(admin, { type: "create_client", input: { name: "Beta Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" } });
  const [alphaId, betaId] = [db.clients[0].id, db.clients[1].id];

  const route = (name: string, clientId: string, a: string, b: string) => ({
    name,
    clientId,
    direction: "to_work" as const,
    shiftId: "",
    vehicleCategoryId: category,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startDate: "2020-01-01",
    endDate: "",
    status: "active" as const,
    stops: [
      { name: a, scheduledTime: "06:00", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
      { name: b, scheduledTime: "06:30", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
    ],
  });
  run(ops, { type: "create_route", input: route("Alpha run", alphaId, "Alpha gate", "Alpha office") });
  run(ops, { type: "create_route", input: route("Beta run", betaId, "Beta gate", "Beta office") });
  run(ops, { type: "create_passenger", input: { fullName: "Ama Boateng", employeeRef: "A1", phone: "055", clientId: alphaId, routeId: db.routes[0].id, stopId: db.routes[0].stops[0].id, status: "active" } });

  run(ops, { type: "generate_trips", routeId: db.routes[0].id, fromDate: DATE, toDate: DATE });
  run(ops, { type: "generate_trips", routeId: db.routes[1].id, fromDate: DATE, toDate: DATE });
  run(ops, { type: "assign_trip", id: db.trips[0].id, input: { vehicleId: driverVehicleId, driverId: db.drivers[0].id } });
  run(ops, { type: "assign_trip", id: db.trips[1].id, input: { vehicleId: otherVehicleId, driverId: db.drivers[1].id } });
  // Operations dispatches the first run, so the driver has something to execute.
  run(ops, { type: "dispatch_trip", id: db.trips[0].id });

  run(admin, {
    type: "create_user",
    input: { fullName: "Kojo Mensah", email: "driver@example.test", role: "driver", active: true, driverId: db.drivers[0].id, clientId: null },
    credential: fakeCred,
  });
  const driverUserId = db.users[2].id;
  run(admin, {
    type: "create_user",
    input: { fullName: "Alpha Contact", email: "alpha@example.test", role: "client_contact", active: true, driverId: null, clientId: alphaId },
    credential: fakeCred,
  });
  const clientUserId = db.users[3].id;

  api = installFakeServer(db, null);
  return { driverUserId, clientUserId, driverVehicleId, otherVehicleId };
}

const signInAs = (id: string) => api.setUser(id);

/** Renders the app and waits for the initial /api/session round trip to settle. */
async function renderApp() {
  const view = render(<App />);
  await waitFor(() => expect(screen.queryByText(/Contacting the server/i)).toBeNull());
  return view;
}

describe("Driver portal (jsdom)", () => {
  it("lands on the driver's own runs and hides the internal screens", async () => {
    const { driverUserId, driverVehicleId } = seed();
    signInAs(driverUserId);
    await renderApp();

    // The driver lands on its portal, not the dashboard.
    expect(await screen.findByText("Alpha run")).toBeTruthy();
    expect(screen.getAllByText(/Kojo Mensah/).length).toBeGreaterThan(0);

    // The other client's run must never appear.
    expect(screen.queryByText("Beta run")).toBeNull();
    expect(screen.queryByText("GT 200-26")).toBeNull();

    // Internal screens are not offered to a record-bound role.
    expect(screen.queryByRole("button", { name: /Accounts and roles/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Audit log/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Settings/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Staff logistics/i })).toBeNull();

    // A driver can report a problem on its own vehicle.
    fireEvent.click(screen.getByRole("button", { name: /Report a problem/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^What happened\?/), { target: { value: "Coolant leak." } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Send report/i }));
    await screen.findByText(/IN-0001 reported/i);

    const db = saved();
    expect(db.incidents).toHaveLength(1);
    expect(db.incidents[0].vehicleId).toBe(driverVehicleId);
    // A driver cannot withdraw a vehicle from service.
    expect(db.incidents[0].takeVehicleOutOfService).toBe(false);
    expect(db.vehicles.find((v) => v.id === driverVehicleId)?.status).toBe("available");
  }, 30000);

  it("starts the run, records stops and boarding progressively, then completes", async () => {
    const { driverUserId } = seed();
    signInAs(driverUserId);
    await renderApp();

    fireEvent.click(await screen.findByRole("button", { name: /Start run/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Record next stop/i }));
    let dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Actual arrival at Alpha gate/i), { target: { value: "06:03" } });

    // The roster is shown by name and pickup stop only.
    expect(within(dialog).getByText("Ama Boateng")).toBeTruthy();
    expect(within(dialog).queryByText("055")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/Ama Boateng/i), { target: { value: "no_show" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /Save stop/i }));
    await screen.findByText(/Alpha gate recorded/i);

    fireEvent.click(await screen.findByRole("button", { name: /Record next stop/i }));
    dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Actual arrival at Alpha office/i), { target: { value: "06:31" } });
    expect(within(dialog).getByText(/Nobody is expected at this stop/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Save stop/i }));
    await screen.findByText(/Alpha office recorded/i);

    fireEvent.click(await screen.findByRole("button", { name: /Complete run/i }));
    expect((await screen.findAllByText("Recorded")).length).toBeGreaterThan(0);

    const db = saved();
    const trip = db.trips.find((t) => t.driverId === db.drivers[0].id);
    expect(trip?.status).toBe("completed");
    expect(trip?.stopLogs.map((l) => l.actualTime)).toEqual(["06:03", "06:31"]);
    expect(trip?.boardings).toHaveLength(1);
    expect(trip?.boardings[0].outcome).toBe("no_show");
  }, 30000);
});

describe("Client portal (jsdom)", () => {
  it("shows only its own client's records and raises a request for that client", async () => {
    const { clientUserId } = seed();
    signInAs(clientUserId);
    await renderApp();

    expect((await screen.findAllByText("Alpha run")).length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Beta run")).toHaveLength(0);
    // Roster detail is limited to name and pickup stop.
    expect(screen.getAllByText("Ama Boateng").length).toBeGreaterThan(0);
    expect(screen.queryByText("055")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Request a vehicle/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Purpose of hire/), { target: { value: "Staff shuttle" } });
    fireEvent.change(within(dialog).getByLabelText(/^Pickup location/), { target: { value: "Accra" } });
    fireEvent.change(within(dialog).getByLabelText(/^Drop-off location/), { target: { value: "Tema" } });
    fireEvent.change(within(dialog).getByLabelText(/^Number of passengers/), { target: { value: "4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Send request/i }));
    // The reference appears in the confirmation and in the table.
    expect((await screen.findAllByText(/RR-0001/i)).length).toBeGreaterThan(0);

    const db = saved();
    expect(db.rentals).toHaveLength(1);
    expect(db.rentals[0].purpose).toBe("Staff shuttle");
  }, 30000);
});
