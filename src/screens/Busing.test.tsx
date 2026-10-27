// @vitest-environment jsdom
// Correcting a recorded run (D-74, Q-42): the screen has to offer only what can actually be
// corrected, and it has to send the reason with it. The record itself is never edited in place.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffBusingPage } from "./StaffBusing";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, emptyRentalSettings, type BusRoute, type Database, type Passenger, type Trip, type User } from "../tms/types";

afterEach(cleanup);

const at = "2026-06-02T09:00:00.000Z";
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

const passenger: Passenger = {
  id: "p1",
  fullName: "Kojo Owusu",
  employeeRef: "E-001",
  phone: "0244000000",
  clientId: "c1",
  routeId: "route1",
  stopId: "s1",
  status: "active",
  createdAt: at,
  updatedAt: at,
};

const trip: Trip = {
  id: "t1",
  reference: "TR-0001",
  routeId: "route1",
  serviceDate: today,
  status: "completed",
  vehicleId: "v1",
  driverId: "d1",
  dispatchedAt: at,
  startedAt: at,
  completedAt: at,
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  incidentId: null,
  stopLogs: [
    { stopId: "s1", actualTime: "06:05" },
    { stopId: "s2", actualTime: "06:35" },
  ],
  boardings: [{ passengerId: "p1", stopId: "s1", outcome: "no_show" }],
  onTimeThresholdMinutes: 5,
  corrections: [],
  rosterChanges: [],
  origin: "schedule",
  originReason: null,
  createdAt: at,
  updatedAt: at,
};

function world(tripOverride: Partial<Trip> = {}, incidents: Database["incidents"] = []): { db: Database; dispatch: Tms["dispatch"] } {
  const db: Database = {
    ...emptyDatabase(),
    settings: { ...emptyDatabase().settings, currencyCode: "GHS", rental: emptyRentalSettings() },
    users: [admin],
    routes: [route],
    passengers: [passenger],
    incidents,
    trips: [{ ...trip, ...tripOverride }],
  };
  const dispatch = vi.fn(async () => ({ ok: true, message: "corrected" }) as CommandResult);
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

const openTrips = (db: Database, dispatch: Tms["dispatch"]) => {
  render(
    <TmsContext.Provider value={makeTms(db, dispatch)}>
      <StaffBusingPage />
    </TmsContext.Provider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: /Trips/i }));
};

describe("correcting a recorded run", () => {
  it("offers the correction on a finished run, with the reason required", async () => {
    const { db, dispatch } = world();
    openTrips(db, dispatch);

    fireEvent.click(screen.getByRole("button", { name: /Correct a record/i }));
    expect(screen.getByText(/Correct a record on TR-0001/i)).toBeTruthy();
    // Only the two recorded stops are offered — a correction is not a way to add a missing record.
    expect(screen.getByRole("option", { name: "Estate gate" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Head office" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Corrected arrival time/i), { target: { value: "06:02" } });
    fireEvent.change(screen.getByLabelText(/Why is it being corrected/i), { target: { value: "Driver's watch was wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /Record correction/i }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "correct_trip_record",
      id: "t1",
      input: { field: "stop_time", stopId: "s1", passengerId: undefined, newValue: "06:02", reason: "Driver's watch was wrong" },
    });
  });

  it("switches to the rider's recorded outcome, and says what is on file", () => {
    const { db, dispatch } = world();
    openTrips(db, dispatch);
    fireEvent.click(screen.getByRole("button", { name: /Correct a record/i }));

    fireEvent.change(screen.getByLabelText(/What is wrong/i), { target: { value: "boarding_outcome" } });
    // Only riders with an outcome already recorded at this stop are listed, labelled with that outcome.
    expect(screen.getByRole("option", { name: /Kojo Owusu \(did not board\)/ })).toBeTruthy();
    // Until a rider is chosen the screen says so, rather than showing a blank "recorded as".
    expect(screen.getByText(/Choose the rider first/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Rider$/i), { target: { value: "p1" } });
    // Once chosen, the hint states what is on file so the change is visible before it is made.
    expect(screen.getByText(/Recorded as did not board/i)).toBeTruthy();
  });

  it("shows the corrections already made, and counts them on the run", () => {
    const { db, dispatch } = world({
      corrections: [
        {
          id: "c1",
          field: "stop_time",
          stopId: "s1",
          passengerId: null,
          previousValue: "06:09",
          newValue: "06:05",
          reason: "Logged from the depot sheet",
          correctedAt: at,
          correctedBy: "Ama Mensah",
        },
      ],
    });
    openTrips(db, dispatch);
    expect(screen.getByText(/1 correction/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Correct a record/i }));
    expect(screen.getByText(/Already corrected on this run/i)).toBeTruthy();
    expect(screen.getByText(/06:09 → 06:05/)).toBeTruthy();
  });

  it("does not offer a correction on a run where nothing has been recorded yet", () => {
    const { db, dispatch } = world({ status: "dispatched", stopLogs: [], boardings: [] });
    openTrips(db, dispatch);
    expect(screen.queryByRole("button", { name: /Correct a record/i })).toBeNull();
  });
});

describe("stopping a run that has started", () => {
  it("offers Stop run on a running trip and sends the reason", async () => {
    const { db, dispatch } = world({ status: "in_progress", completedAt: null });
    openTrips(db, dispatch);

    fireEvent.click(screen.getByRole("button", { name: /Stop run/i }));
    expect(screen.getByText(/Stop TR-0001/i)).toBeTruthy();
    // The panel says what will be kept rather than warning that the record disappears.
    expect(screen.getByText(/2 stop\(s\) already recorded stay on the run/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: "Driver taken ill" } });
    fireEvent.click(screen.getByRole("button", { name: /Stop this run/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: "cancel_trip", id: "t1", reason: "Driver taken ill", incidentId: undefined });
  });

  it("asks for the incident when one is already recorded against the vehicle", async () => {
    const incident = {
      id: "i1",
      reference: "IN-0001",
      type: "breakdown" as const,
      severity: "high" as const,
      vehicleId: "v1",
      tripId: "t1",
      reportedDate: today,
      description: "Gearbox",
      assignedTo: null,
      takeVehicleOutOfService: true,
      status: "reported" as const,
      resolutionNote: null,
      vehicleRestoredTo: null,
      costEntries: [],
      log: [],
      createdAt: at,
      updatedAt: at,
    };
    const { db, dispatch } = world({ status: "in_progress", completedAt: null }, [incident]);
    openTrips(db, dispatch);
    fireEvent.click(screen.getByRole("button", { name: /Stop run/i }));

    expect(screen.getByLabelText(/Incident that stopped the run/i)).toBeTruthy();
    expect(screen.getByRole("option", { name: /IN-0001/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: "Gearbox failed" } });
    fireEvent.change(screen.getByLabelText(/Incident that stopped the run/i), { target: { value: "i1" } });
    fireEvent.click(screen.getByRole("button", { name: /Stop this run/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: "cancel_trip", id: "t1", reason: "Gearbox failed", incidentId: "i1" });
  });

  it("keeps a planned run's cancel panel simple", () => {
    const { db, dispatch } = world({ status: "planned", stopLogs: [], boardings: [], vehicleId: null, driverId: null });
    openTrips(db, dispatch);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(screen.getByText(/Cancel TR-0001/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Incident that stopped the run/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Cancel this trip/i })).toBeTruthy();
  });
});
