// @vitest-environment jsdom
// The bookings tab (BKG-01..06, D-83). Two things must be visible on the screen itself: how many of
// a run's seats are held — counting the roster and the bookings together — and that a seat is only
// a request until a person confirms it. The tab also has to send the reason with a refusal, because
// a refusal without one is not a record.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffBusingPage } from "./StaffBusing";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, type Booking, type BusRoute, type Database, type Passenger, type Trip, type User } from "../tms/types";

afterEach(cleanup);

const at = "2026-06-01T05:00:00.000Z";
const today = new Date().toISOString().slice(0, 10);

const admin: User = {
  id: "u1",
  fullName: "Ama Mensah",
  email: "ama@example.test",
  role: "administrator",
  active: true,
  driverId: null,
  clientId: null,
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
    { id: "s1", name: "Estate gate", scheduledTime: "06:00" },
    { id: "s2", name: "Head office", scheduledTime: "06:30" },
  ],
  createdAt: at,
  updatedAt: at,
};

const rosterRider = (id: string, fullName: string): Passenger => ({
  id,
  fullName,
  employeeRef: `E-${id}`,
  phone: "",
  clientId: "c1",
  routeId: "route1",
  stopId: "s1",
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const visitor = (id: string, fullName: string): Passenger => ({
  id,
  fullName,
  employeeRef: "",
  phone: "",
  clientId: "c1",
  routeId: "",
  stopId: "",
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
  vehicleId: "v1",
  driverId: "d1",
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
  rosterChanges: [],
  origin: "schedule",
  originReason: null,
  createdAt: at,
  updatedAt: at,
};

const booking = (n: number, passengerId: string, status: Booking["status"], type: Booking["type"] = "one_time"): Booking => ({
  id: `b${n}`,
  reference: `BK-000${n}`,
  passengerId,
  clientId: "c1",
  routeId: "route1",
  stopId: "s1",
  tripId: "t1",
  serviceDate: today,
  type,
  status,
  note: "",
  seriesId: null,
  offeredAt: status === "offered" ? at : null,
  cancelledAt: null,
  cancelledBy: null,
  history: [{ at, by: "Ama Mensah", action: "Requested", note: "Interview candidate." }],
  createdAt: at,
  updatedAt: at,
});

function world(): { db: Database; dispatch: Tms["dispatch"] } {
  const base = emptyDatabase();
  const db: Database = {
    ...base,
    users: [admin],
    clients: [{ id: "c1", name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "", status: "active", createdAt: at, updatedAt: at }],
    routes: [route],
    vehicles: [
      {
        id: "v1",
        registration: "GT 900-26",
        categoryId: "cat",
        make: "",
        model: "",
        seatCapacity: 14,
        status: "available",
        notes: "",
        createdAt: at,
        updatedAt: at,
      },
    ],
    passengers: [
      rosterRider("p1", "Roster One"),
      rosterRider("p2", "Roster Two"),
      visitor("p3", "Visiting Vic"),
      visitor("p4", "New Hire Naa"),
      visitor("p5", "Waiter One"),
      visitor("p6", "Waiter Two"),
    ],
    trips: [trip],
    bookings: [booking(1, "p3", "confirmed"), booking(2, "p4", "confirmed"), booking(3, "p5", "offered"), booking(4, "p6", "waitlisted")],
    settings: { ...base.settings, vehicleCategories: [{ id: "cat", name: "Minibus" }] },
  };
  const dispatch = vi.fn(async () => ({ ok: true, message: "done", db }) as CommandResult);
  return { db, dispatch };
}

const makeTms = (db: Database, dispatch: Tms["dispatch"]) =>
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

const openBookings = (db: Database, dispatch: Tms["dispatch"]) => {
  render(
    <TmsContext.Provider value={makeTms(db, dispatch)}>
      <StaffBusingPage />
    </TmsContext.Provider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: /Bookings/i }));
};

describe("booked riders on the run's list of people (D-85)", () => {
  const openTrips = (db: Database, dispatch: Tms["dispatch"]) => {
    render(
      <TmsContext.Provider value={makeTms(db, dispatch)}>
        <StaffBusingPage />
      </TmsContext.Provider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Trips/i }));
  };

  it("asks for a booked visitor by name when the next stop is recorded", () => {
    const { db, dispatch } = world();
    const running: Database = { ...db, trips: [{ ...trip, status: "in_progress", startedAt: at }] };
    openTrips(running, dispatch);

    fireEvent.click(screen.getByRole("button", { name: /Record next stop/i }));
    // The roster riders at this stop, and the three seats that still hold one.
    expect(screen.getByText(/Boarding at this stop \(5\)/)).toBeTruthy();
    expect(screen.getByText(/Booked seat BK-0001 — not on the regular roster/i)).toBeTruthy();
    expect(screen.getByText(/Booked seat BK-0003 — not on the regular roster/i)).toBeTruthy();
    // A requested or waitlisted seat is not a person to collect.
    expect(screen.queryByText(/BK-0004/)).toBeNull();
  });

  it("sends an outcome for every expected rider, booked seats included", () => {
    const { db, dispatch } = world();
    const running: Database = { ...db, trips: [{ ...trip, status: "in_progress", startedAt: at }] };
    openTrips(running, dispatch);

    fireEvent.click(screen.getByRole("button", { name: /Record next stop/i }));
    fireEvent.change(screen.getByLabelText(/Actual arrival at Estate gate/i), { target: { value: "06:03" } });
    for (const name of ["Roster One", "Roster Two", "Visiting Vic", "New Hire Naa", "Waiter One"]) {
      fireEvent.change(screen.getByLabelText(new RegExp(`^${name}`)), { target: { value: "boarded" } });
    }
    fireEvent.click(screen.getByRole("button", { name: /Save stop/i }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "record_trip_stop",
      id: "t1",
      input: {
        stopId: "s1",
        actualTime: "06:03",
        boardings: [
          { passengerId: "p1", outcome: "boarded" },
          { passengerId: "p2", outcome: "boarded" },
          { passengerId: "p3", outcome: "boarded" },
          { passengerId: "p4", outcome: "boarded" },
          { passengerId: "p5", outcome: "boarded" },
        ],
      },
    });
  });

  it("shows the booked riders in the full completion form, with the seat they hold", () => {
    const { db, dispatch } = world();
    const dispatched: Database = { ...db, trips: [{ ...trip, status: "dispatched", dispatchedAt: at }] };
    openTrips(dispatched, dispatch);

    fireEvent.click(screen.getByRole("button", { name: /Record full completion/i }));
    expect(screen.getByText(/Riders \(5\)/)).toBeTruthy();
    expect(screen.getByLabelText(/Outcome for Visiting Vic/i)).toBeTruthy();
    expect(screen.getByText(/Booked seat BK-0001/i)).toBeTruthy();
  });
});

describe("bookings tab", () => {
  it("shows the seats held against the vehicle, counting the roster and the bookings", () => {
    const { db, dispatch } = world();
    openBookings(db, dispatch);

    // 2 on the roster and 3 confirmed/offered bookings = 3 seats held of 14, 9 still free.
    expect(screen.getByText(/3 of 14 seats held/)).toBeTruthy();
    expect(screen.getByText(/2 on the roster/)).toBeTruthy();
    expect(screen.getByText(/9 free/)).toBeTruthy();
    expect(screen.getByText("Visiting Vic")).toBeTruthy();
    expect(screen.getByText("Waiter One")).toBeTruthy();
    // An offer is shown as an offer, not as a confirmed seat.
    expect(screen.getByText("Seat offered")).toBeTruthy();
    expect(screen.getByText("On the waiting list")).toBeTruthy();
  });

  it("sends a seat request with the rider, the run's route and the date", async () => {
    const { db, dispatch } = world();
    openBookings(db, dispatch);

    fireEvent.click(screen.getByRole("button", { name: /Request a seat/i }));
    expect(screen.getByText(/the office confirms it once the vehicle's seats are counted/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Rider/), { target: { value: "p4" } });
    fireEvent.change(screen.getByLabelText(/^Route/), { target: { value: "route1" } });
    fireEvent.change(screen.getByLabelText(/Date of travel/i), { target: { value: today } });
    fireEvent.click(screen.getByRole("button", { name: /Request seat/i }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "create_booking",
      input: { passengerId: "p4", routeId: "route1", serviceDate: today, toDate: today, type: "one_time", note: "" },
    });
  });

  it("asks for a reason before refusing a seat, and sends it with the refusal", () => {
    const { db, dispatch } = world();
    openBookings(db, dispatch);

    // Confirmed seats only offer Cancel, so the first Refuse belongs to the offered seat (BK-0003).
    fireEvent.click(screen.getAllByRole("button", { name: /^Refuse$/ })[0]);
    expect(screen.getByText(/Refuse BK-0003/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "The bus is reserved for the audit team." } });
    fireEvent.click(screen.getByRole("button", { name: /Refuse request/i }));

    expect(dispatch).toHaveBeenCalledWith({ type: "reject_booking", id: "b3", reason: "The bus is reserved for the audit team." });
  });

  it("says plainly that a cancelled seat is only offered, never confirmed", () => {
    const { db, dispatch } = world();
    openBookings(db, dispatch);

    expect(screen.getByText(/offered/, { selector: "em" })).toBeTruthy();
    expect(screen.getByText(/to the oldest waiter/, { exact: false })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /^Cancel$/ })[0]);
    expect(screen.getByText(/nobody is confirmed automatically/i)).toBeTruthy();
  });
});
