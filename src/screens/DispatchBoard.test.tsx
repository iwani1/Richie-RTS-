// @vitest-environment jsdom
// The dispatch board (DSP-01, D-115).
//
// The domain rules are proven in `src/tms/dispatchBoard.test.ts`. What is left is the screen: does a
// supervisor opening it on a date see the day's runs, the runs that cannot leave, and who is free —
// and does a filter narrow the list without quietly pretending the rest of the day is not there?
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DispatchBoardPage } from "./DispatchBoard";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, type BusRoute, type Database, type Driver, type Trip, type User, type Vehicle } from "../tms/types";

afterEach(cleanup);

const at = "2026-06-01T05:00:00.000Z";
const DATE = "2026-06-01";

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

const client = (id: string, name: string) => ({
  id,
  name,
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  reference: "",
  type: null,
  billingAddress: "",
  tin: "",
  notes: "",
  registrationNumber: "",
  registeredOn: "",
  status: "active" as const,
  createdAt: at,
  updatedAt: at,
});

const route = (id: string, name: string, first: string, last: string, clientId: string): BusRoute => ({
  id,
  reference: `RT-00${id.slice(-1)}`,
  name,
  clientId,
  direction: "to_work",
  shiftId: "",
  vehicleCategoryId: "cat",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  startDate: "2026-01-01",
  endDate: null,
  status: "active",
  stops: [
    { id: `${id}-s1`, name: "Pickup", scheduledTime: first, landmark: "", digitalAddress: "", latitude: "", longitude: "" },
    { id: `${id}-s2`, name: "Office", scheduledTime: last, landmark: "", digitalAddress: "", latitude: "", longitude: "" },
  ],
  createdAt: at,
  updatedAt: at,
});

const vehicle = (id: string, registration: string, seats: number, overrides: Partial<Vehicle> = {}): Vehicle => ({
  id,
  registration,
  categoryId: "cat",
  make: "Toyota",
  model: "Coaster",
  seatCapacity: seats,
  fuelType: "",
  ownership: null,
  ownerName: "",
  usualDriverId: null,
  photo: null,
  status: "available",
  notes: "",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const driver = (id: string, fullName: string, overrides: Partial<Driver> = {}): Driver => ({
  id,
  fullName,
  phone: "0244000000",
  licenceNumber: `DL-${id}`,
  licenceExpiry: "2028-12-31",
  licenceClasses: [],
  qualifications: [],
  status: "active",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const trip = (id: string, reference: string, overrides: Partial<Trip> = {}): Trip => ({
  id,
  reference,
  routeId: "route1",
  serviceDate: DATE,
  status: "planned",
  origin: "schedule",
  originReason: null,
  vehicleId: null,
  driverId: null,
  dispatchedAt: null,
  startedAt: null,
  completedAt: null,
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  incidentId: null,
  stopLogs: [],
  boardings: [],
  onTimeThresholdMinutes: 5,
  corrections: [],
  delays: [],
  rosterChanges: [],
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

/**
 * Two companies, three runs: one crewed and ready, one whose bus is off the road and whose driver's
 * licence has lapsed, and one with nobody on it at all. One spare bus and one spare driver.
 */
function world(overrides: Partial<Database> = {}): Database {
  const db = emptyDatabase();
  return {
    ...db,
    users: [admin],
    settings: { ...db.settings, currencyCode: "GHS", vehicleCategories: [{ id: "cat", name: "Coach", licenceClasses: [] }] },
    clients: [client("c1", "Acme Ltd"), client("c2", "Beta Ltd")],
    routes: [route("route1", "Airport run", "06:00", "06:40", "c1"), route("route2", "Tema run", "07:00", "07:40", "c2")],
    vehicles: [vehicle("v1", "GT-1", 14), vehicle("v2", "GT-2", 45, { status: "out_of_service" }), vehicle("v3", "GT-3", 30)],
    drivers: [driver("d1", "Kojo Owusu"), driver("d2", "Yaa Asantewaa", { licenceExpiry: "2026-05-01" }), driver("d3", "Adjoa Mensah")],
    trips: [
      trip("t1", "TR-0001", { vehicleId: "v1", driverId: "d1" }),
      trip("t2", "TR-0002", { routeId: "route2", vehicleId: "v2", driverId: "d2" }),
      trip("t3", "TR-0003"),
    ],
    ...overrides,
  };
}

function renderBoard(db: Database = world()) {
  const tms = {
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
    dispatch: vi.fn(async () => ({ ok: true, message: "" }) as CommandResult),
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
  } as unknown as Tms;

  render(
    <TmsContext.Provider value={tms}>
      <DispatchBoardPage />
    </TmsContext.Provider>,
  );
}

/** Put the board on the date the records cover, rather than today. */
const setDate = (date: string) => fireEvent.change(screen.getByLabelText(/^Service date/), { target: { value: date } });

describe("the dispatch board", () => {
  it("shows the day, the runs that cannot leave, and who is free", () => {
    renderBoard();
    setDate(DATE);

    // Three departures, one of them with nobody on it.
    expect(screen.getByText("TR-0001")).toBeTruthy();
    expect(screen.getByText("TR-0002")).toBeTruthy();
    expect(screen.getByText("TR-0003")).toBeTruthy();
    const unassigned = screen.getByText("Waiting on a crew").closest('[data-slot="stat"]') as HTMLElement;
    expect(unassigned.textContent).toContain("1");

    // The warning leads with the two runs that cannot leave, and says why in the reason's own words.
    expect(screen.getByText(/2 runs cannot leave as they stand/)).toBeTruthy();
    expect(screen.getByText(/GT-2 is out of service/)).toBeTruthy();
    expect(screen.getByText(/Yaa Asantewaa's licence expired on 2026-05-01/)).toBeTruthy();
    // Both halves of a missing crew are named, not just "unassigned".
    expect(screen.getByText("No driver assigned.")).toBeTruthy();
    expect(screen.getByText("No vehicle assigned.")).toBeTruthy();

    // Who is free: the spare bus and the spare driver, each with a sentence.
    expect(screen.getByText("GT-3 · 30 seats")).toBeTruthy();
    // The name is also an option in the driver filter, so the sentence is the assertion, not the name.
    expect(screen.getAllByText("Adjoa Mensah").length).toBeGreaterThan(0);
    expect(screen.getByText("Free: no run or hire is holding them today.")).toBeTruthy();
    // The bus on a run is not offered as free.
    expect(screen.queryByText("GT-1 · 14 seats")).toBeNull();
  });

  it("narrows the list with a filter without pretending the rest of the day is gone", () => {
    renderBoard();
    setDate(DATE);

    fireEvent.change(screen.getByLabelText(/^Route/), { target: { value: "route2" } });
    expect(screen.getByText("TR-0002")).toBeTruthy();
    expect(screen.queryByText("TR-0001")).toBeNull();
    expect(screen.queryByText("TR-0003")).toBeNull();
    // Still three on the sheet, and the screen says so beside the figures.
    expect(screen.getByText(/3 on the sheet for/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Company/), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText(/^Route/), { target: { value: "" } });
    expect(screen.getByText("TR-0001")).toBeTruthy();
    expect(screen.getByText("TR-0003")).toBeTruthy();
    expect(screen.queryByText("TR-0002")).toBeNull();
  });

  it("says so when the date has no runs, rather than showing an empty table", () => {
    renderBoard();
    setDate("2026-06-05");
    expect(screen.getByText("No runs on this date")).toBeTruthy();
    // No figure is invented for a day with nothing on it.
    const departures = screen.getByText("Departures").closest('[data-slot="stat"]') as HTMLElement;
    expect(departures.textContent).toContain("0");
  });

  it("prints what it cannot answer, instead of leaving it to be discovered", () => {
    renderBoard();
    setDate(DATE);
    expect(screen.getByText(/cannot tell you/i)).toBeTruthy();
    expect(screen.getByText(/no service type/)).toBeTruthy();
    expect(screen.getByText(/not a map position/)).toBeTruthy();
  });
});
