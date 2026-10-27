// @vitest-environment jsdom
// The planning aid on the trips screen (RTE-04, D-96).
//
// What the screen must not do: assign anything on its own, hide a refusal behind an empty list, or
// present a suggestion as if it had measured distance and travel time. What it must do: put the pair
// the rules would accept in front of the dispatcher, with the reason, and let that person decide.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffBusingPage } from "./StaffBusing";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, emptyRentalSettings, type BusRoute, type Database, type Driver, type Passenger, type Trip, type User, type Vehicle } from "../tms/types";

afterEach(cleanup);

const at = "2026-06-01T06:00:00.000Z";
const today = new Date().toISOString().slice(0, 10);

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

const route: BusRoute = {
  id: "route1",
  reference: "RT-001",
  name: "Estate run",
  clientId: "c1",
  direction: "to_work",
  shiftId: "",
  vehicleCategoryId: "cat",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  startDate: "2026-01-01",
  endDate: null,
  status: "active",
  stops: [
    { id: "s1", name: "Estate gate", scheduledTime: "06:00", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
    { id: "s2", name: "Head office", scheduledTime: "06:30", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
  ],
  createdAt: at,
  updatedAt: at,
};

const passenger = (id: string, name: string): Passenger => ({
  id,
  fullName: name,
  employeeRef: `E-${id}`,
  phone: "",
  clientId: "c1",
  routeId: "route1",
  stopId: "s1",
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const vehicle = (id: string, registration: string, seatCapacity: number, status: Vehicle["status"] = "available"): Vehicle => ({
  id,
  registration,
  categoryId: "cat",
  make: "Toyota",
  model: "Coaster",
  seatCapacity,
  status,
  notes: "",
  createdAt: at,
  updatedAt: at,
});

const driver = (id: string, fullName: string): Driver => ({
  id,
  fullName,
  phone: "",
  licenceNumber: `DL-${id}`,
  licenceExpiry: "2028-12-31",
  licenceClasses: [],
  qualifications: [],
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const trip: Trip = {
  id: "t1",
  reference: "TR-0001",
  routeId: "route1",
  serviceDate: today,
  status: "planned",
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
  origin: "schedule",
  originReason: null,
  createdAt: at,
  updatedAt: at,
};

function world(overrides: Partial<Database> = {}): Database {
  const db = emptyDatabase();
  return {
    ...db,
    settings: { ...db.settings, currencyCode: "GHS", documentReminderLeadDays: 30, rental: emptyRentalSettings() },
    users: [admin],
    clients: [{ id: "c1", name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", registrationNumber: "", registeredOn: "", status: "active", createdAt: at, updatedAt: at }],
    routes: [route],
    passengers: [passenger("p1", "Kojo Owusu"), passenger("p2", "Adwoa Boakye")],
    vehicles: [vehicle("v-small", "GT-1111-24", 14), vehicle("v-big", "GT-9999-24", 45)],
    drivers: [driver("d1", "Kojo Mensah"), driver("d2", "Yaa Asantewaa")],
    trips: [trip],
    ...overrides,
  };
}

const makeTms = (db: Database, dispatch: Tms["dispatch"]): Tms =>
  ({
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
    dispatch,
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
  }) as unknown as Tms;

function openTrips(db: Database, dispatch: Tms["dispatch"]) {
  render(
    <TmsContext.Provider value={makeTms(db, dispatch)}>
      <StaffBusingPage />
    </TmsContext.Provider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: /Trips/i }));
}

describe("the planning aid", () => {
  it("suggests a pair in the assign panel without assigning anything", () => {
    const dispatch = vi.fn(async () => ({ ok: true, message: "assigned" }) as CommandResult);
    openTrips(world(), dispatch);

    fireEvent.click(screen.getByRole("button", { name: /^Assign$/ }));
    const aid = screen.getByRole("region", { name: "Planning aid" });
    expect(within(aid).getByText(/Who can take this run/)).toBeTruthy();
    // The conclusion, not a bare list: who to send and why the numbers fit.
    expect(within(aid).getByText(/^Send GT-1111-24 with /)).toBeTruthy();
    expect(within(aid).getByText(/2 to carry \(2 on the roster\)/)).toBeTruthy();
    // It has suggested something; nothing has been saved.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fills both fields from a suggestion, and saves only when the dispatcher presses save", () => {
    const dispatch = vi.fn(async () => ({ ok: true, message: "assigned" }) as CommandResult);
    openTrips(world(), dispatch);
    fireEvent.click(screen.getByRole("button", { name: /^Assign$/ }));

    // Two drivers could take it; the first suggestion is the one offered first.
    fireEvent.click(screen.getAllByRole("button", { name: /Use GT-1111-24 with / })[0]);
    expect((screen.getByLabelText("Vehicle") as HTMLSelectElement).value).toBe("v-small");
    expect((screen.getByLabelText("Driver") as HTMLSelectElement).value).not.toBe("");
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Save assignment/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "assign_trip",
      id: "t1",
      input: { vehicleId: "v-small", driverId: expect.any(String) },
    });
  });

  it("says why nobody can take the run instead of showing an empty list", () => {
    openTrips(
      world({ vehicles: [vehicle("v-shop", "GT-2222-24", 30, "maintenance")], drivers: [driver("d1", "Kojo Mensah")] }),
      vi.fn(async () => ({ ok: true, message: "" }) as CommandResult),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Assign$/ }));

    const aid = screen.getByRole("region", { name: "Planning aid" });
    expect(within(aid).getByText(/^No pair can take this run/)).toBeTruthy();
    // The headline and the pair's own reason both say it, which is the point: the same sentence.
    expect(within(aid).getAllByText(/must be Available to be assigned/).length).toBeGreaterThan(0);
    expect(within(aid).getByText("cannot")).toBeTruthy();
  });

  it("offers the day's suggestion from the desk, and assigns only when asked", () => {
    const dispatch = vi.fn(async () => ({ ok: true, message: "assigned" }) as CommandResult);
    openTrips(world(), dispatch);

    const desk = screen.getByRole("complementary", { name: "Dispatch desk" });
    expect(within(desk).getByText(/Send GT-1111-24 \+ /)).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(within(desk).getByRole("button", { name: /^Assign GT-1111-24 and .* to TR-0001$/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "assign_trip",
      id: "t1",
      input: { vehicleId: "v-small", driverId: expect.any(String) },
    });
  });

  it("says nobody is free rather than naming a pair it cannot stand behind", () => {
    openTrips(
      world({ vehicles: [vehicle("v-shop", "GT-2222-24", 30, "maintenance")] }),
      vi.fn(async () => ({ ok: true, message: "" }) as CommandResult),
    );
    const desk = screen.getByRole("complementary", { name: "Dispatch desk" });
    expect(within(desk).getByText("Nobody free to send")).toBeTruthy();
    expect(within(desk).queryByRole("button", { name: /^Assign GT-/ })).toBeNull();
  });

  it("states what it cannot see, so a suggestion is not read as a measured plan", () => {
    openTrips(world(), vi.fn(async () => ({ ok: true, message: "" }) as CommandResult));
    fireEvent.click(screen.getByRole("button", { name: /^Assign$/ }));
    fireEvent.click(screen.getByText("What this aid cannot see"));
    expect(screen.getByText(/cannot measure how far apart a pickup and the office are/)).toBeTruthy();
  });
});
