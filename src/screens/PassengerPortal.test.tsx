// @vitest-environment jsdom
//
// The passenger portal in a browser (brief 1C: PAX-01, D-97).
//
// The domain rules are proven in `src/tms/passenger.test.ts` and the payload in
// `src/server/visibility.test.ts`. What is left, and what this file checks, is the thing a rider
// actually meets: does the page open on the rider's own journeys, does it say which state each seat
// is in, can a seat be asked for and cancelled from here, and can a problem be reported — without a
// colleague's name ever reaching the screen.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import App from "../App";
import { installFakeServer } from "../test/fakeServer";
import { executeCommand, type AnyCommand } from "../tms/commands";
import type { Actor } from "../tms/service";
import { emptyDatabase, emptyRentalSettings, type Database } from "../tms/types";

let api: ReturnType<typeof installFakeServer>;

const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);
const TOMORROW = new Date(Date.parse(NOW) + 86_400_000).toISOString().slice(0, 10);
const fakeCred = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(window, "scrollTo", { value: () => undefined, configurable: true });
});
afterEach(cleanup);

/**
 * One client, two runs a day: the morning route Ama is rostered on and an evening route she can ask
 * for a seat on. A colleague shares her roster, so "no other rider's name" is a real assertion rather
 * than an empty one.
 */
function seed(): { userId: string; riderId: string; colleagueId: string; eveningRouteId: string; vehicleId: string } {
  let db: Database = emptyDatabase();
  const run = (actor: Actor | null, command: AnyCommand) => {
    const result = executeCommand(db, actor, command, NOW);
    if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
    db = result.db;
  };

  run(null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential: fakeCred });
  const admin: Actor = { id: db.users[0].id, fullName: "Admin", role: "administrator" };
  run(admin, { type: "create_user", input: { fullName: "Ops", email: "ops@example.test", role: "operations", active: true }, credential: fakeCred });
  const ops: Actor = { id: db.users[1].id, fullName: "Ops", role: "operations" };
  run(admin, {
    type: "update_settings",
    input: {
      ...db.settings,
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      vehicleCategories: [{ id: "", name: "Minibus" }],
      shifts: [],
      rental: emptyRentalSettings(),
      booking: { requestCutoffMinutes: null, cancellationCutoffMinutes: null },
    },
  });
  const category = db.settings.vehicleCategories[0].id;
  run(ops, { type: "create_vehicle", input: { registration: "GT 100-26", categoryId: category, make: "", model: "", seatCapacity: "30", notes: "" } });
  run(ops, { type: "create_driver", input: { fullName: "Kojo", phone: "024", licenceNumber: "L-1", licenceExpiry: "2030-01-01", status: "active" } });
  run(admin, { type: "create_client", input: { name: "Alpha Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" } });
  const clientId = db.clients[0].id;

  // Different times on purpose: one bus and one driver work both runs, so no assignment overlaps.
  const route = (name: string, first: string, firstTime: string, second: string, secondTime: string) => ({
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
      { name: first, scheduledTime: firstTime },
      { name: second, scheduledTime: secondTime },
    ],
  });
  run(ops, { type: "create_route", input: route("Alpha morning", "Alpha gate", "06:00", "Alpha office", "06:30") });
  run(ops, { type: "create_route", input: route("Alpha evening", "Alpha yard", "18:00", "Alpha homes", "18:30") });
  const morningRouteId = db.routes[0].id;
  const eveningRouteId = db.routes[1].id;

  run(ops, { type: "create_passenger", input: { fullName: "Ama Boateng", employeeRef: "A-1", phone: "0550000001", clientId, routeId: morningRouteId, stopId: db.routes[0].stops[0].id, status: "active" } });
  const riderId = db.passengers[0].id;
  run(ops, { type: "create_passenger", input: { fullName: "Kofi Mensah", employeeRef: "K-1", phone: "0550000002", clientId, routeId: morningRouteId, stopId: db.routes[0].stops[0].id, status: "active" } });
  const colleagueId = db.passengers[1].id;

  for (const id of [morningRouteId, eveningRouteId]) {
    run(ops, { type: "generate_trips", routeId: id, fromDate: TODAY, toDate: TOMORROW });
  }
  for (const trip of db.trips) {
    run(ops, { type: "assign_trip", id: trip.id, input: { vehicleId: db.vehicles[0].id, driverId: db.drivers[0].id } });
  }
  run(ops, { type: "dispatch_trip", id: db.trips.find((trip) => trip.routeId === morningRouteId && trip.serviceDate === TODAY)!.id });

  run(admin, {
    type: "create_user",
    input: { fullName: "Ama Boateng", email: "ama@example.test", role: "passenger", active: true, passengerId: riderId },
    credential: fakeCred,
  });
  const userId = db.users.find((user) => user.role === "passenger")!.id;

  api = installFakeServer(db, null);
  return {
    userId,
    riderId,
    colleagueId,
    eveningRouteId,
    vehicleId: db.vehicles[0].id,
  };
}

const signInAs = (id: string) => api.setUser(id);

async function renderApp() {
  render(<App />);
  await waitFor(() => expect(screen.queryByText(/Contacting the server/i)).toBeNull());
}

describe("Passenger portal (jsdom)", () => {
  it("lands on the rider's own journeys and shows nothing about a colleague or the office", async () => {
    const { userId } = seed();
    signInAs(userId);
    await renderApp();

    // The rider lands on its own desk, with its own route and stop.
    expect((await screen.findAllByText("Alpha morning")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alpha gate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GT 100-26").length).toBeGreaterThan(0);

    // The brief's states, named: this morning's run is released, tomorrow's is merely planned.
    expect(screen.getAllByText("Ready to leave").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bus assigned").length).toBeGreaterThan(0);
    // The rider travels on the roster, so there is no booking reference to quote yet.
    expect(screen.getAllByText("on roster").length).toBeGreaterThan(0);

    // A colleague on the same run is not in the payload, and neither is the office's work.
    expect(screen.queryByText("Kofi Mensah")).toBeNull();
    expect(screen.queryByRole("button", { name: /Accounts and roles/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Staff logistics/i })).toBeNull();

    // What the page cannot do is also stated, so a rider does not read silence as a fault.
    expect(screen.getByText(/live position is not tracked/i)).toBeTruthy();
  }, 30000);

  it("asks for a seat on another run, cancels it, and reports a problem with a journey", async () => {
    const { userId, riderId, eveningRouteId, vehicleId } = seed();
    signInAs(userId);
    await renderApp();
    await screen.findAllByText("Alpha morning");

    fireEvent.click(screen.getByRole("button", { name: /Request a seat on another run/i }));
    let dialog = screen.getByRole("dialog");
    // The evening run can be asked for; her own route cannot, and the panel says why.
    expect(within(dialog).getAllByText(/Alpha evening/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/your seat on it is automatic/i).length).toBeGreaterThan(0);
    fireEvent.change(within(dialog).getByLabelText(/Anything the office should know/i), { target: { value: "Late shift" } });
    // The evening run can be asked for on a day it has not left yet; the panel offers one button per
    // such run, so the first is the soonest.
    const requestButtons = within(dialog).getAllByRole("button", { name: /^Request$/ });
    expect(requestButtons.length).toBeGreaterThan(0);
    fireEvent.click(requestButtons[0]);
    await screen.findByText(/Seat requested for|requested/i, undefined, { timeout: 5000 });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Done$/ }));

    let db = api.db();
    expect(db.bookings).toHaveLength(1);
    expect(db.bookings[0].passengerId).toBe(riderId);
    expect(db.trips.find((trip) => trip.id === db.bookings[0].tripId)?.routeId).toBe(eveningRouteId);
    expect(db.bookings[0].status).toBe("requested");
    expect(db.bookings[0].note).toMatch(/Late shift/);

    // The seat now appears on the page with its reference, and can be cancelled from here.
    expect((await screen.findAllByText(db.bookings[0].reference)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel seat$/ }));
    dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Why are you cancelling/i), { target: { value: "Working from home" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel seat$/ }));
    await waitFor(() => expect(api.db().bookings[0].status).toBe("cancelled"));
    expect(api.db().bookings[0].note).toMatch(/Working from home/);

    // A problem is reported against the run, and the run decides which bus it is about.
    fireEvent.click(screen.getByRole("button", { name: /Report a problem with a journey/i }));
    dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/What happened/i), { target: { value: "The door would not close." } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Send to operations/i }));
    await screen.findByText(/IN-0001 reported/i, undefined, { timeout: 5000 });

    db = api.db();
    expect(db.incidents).toHaveLength(1);
    expect(db.incidents[0].description).toBe("The door would not close.");
    expect(db.incidents[0].vehicleId).toBe(vehicleId);
    expect(db.incidents[0].takeVehicleOutOfService).toBe(false);
    // The rider can see the feedback it raised.
    expect((await screen.findAllByText(/IN-0001/)).length).toBeGreaterThan(0);
  }, 30000);
});
