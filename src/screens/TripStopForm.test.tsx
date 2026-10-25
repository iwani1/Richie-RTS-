// @vitest-environment jsdom
// Q-48: there is no SMS and no push, so the run itself carries the marker. The driver's next stop
// form is where it has to appear, because that is the screen he is on when the roster matters.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripStopForm } from "./TripStopForm";
import type { BusRoute, Passenger, Trip } from "../tms/types";

afterEach(cleanup);

const at = "2026-06-01T06:10:00.000Z";

const route: BusRoute = {
  id: "route1",
  reference: "RT-001",
  name: "Northstar morning",
  clientId: "c1",
  direction: "to_work",
  shiftId: null,
  vehicleCategoryId: "cat1",
  weekdays: [1, 2, 3, 4, 5],
  startDate: "2026-01-01",
  endDate: null,
  stops: [
    { id: "s1", name: "Estate gate", scheduledTime: "06:00" },
    { id: "s2", name: "Head office", scheduledTime: "06:30" },
  ],
  status: "active",
  createdAt: at,
  updatedAt: at,
};

const trip = (overrides: Partial<Trip> = {}): Trip => ({
  id: "t1",
  reference: "TR-0001",
  routeId: route.id,
  serviceDate: "2026-06-01",
  status: "in_progress",
  vehicleId: "v1",
  driverId: "d1",
  dispatchedAt: at,
  startedAt: at,
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
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const rider = (fullName: string, id: string): Passenger => ({
  id,
  clientId: "c1",
  fullName,
  employeeRef: `E-${id}`,
  phone: "",
  routeId: route.id,
  stopId: "s1",
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const renderForm = (t: Trip, roster: Passenger[] = [rider("Ama Boateng", "p1")]) =>
  render(<TripStopForm trip={t} route={route} roster={roster} onClose={() => {}} onSubmit={vi.fn(async () => ({}))} />);

describe("the roster marker on the driver's stop form", () => {
  it("says nothing when the roster has not moved since the run started", () => {
    renderForm(trip());
    expect(screen.queryByText(/roster changed since this run started/i)).toBeNull();
  });

  it("lists what changed, when, and who changed it", () => {
    renderForm(
      trip({
        rosterChanges: [
          { id: "rc1", at: "2026-06-01T06:12:00.000Z", by: "Ama Mensah", summary: "Kofi Mensah joined this roster at Estate gate." },
          { id: "rc2", at: "2026-06-01T06:20:00.000Z", by: "Ama Mensah", summary: "Ama Boateng moved from Estate gate to Head office." },
        ],
      }),
    );
    // The roster marker is the first status region on the form; the standing note is the second.
    const banner = screen.getAllByRole("status")[0];
    expect(within(banner).getByText(/roster changed since this run started \(2\)/i)).toBeTruthy();
    expect(within(banner).getByText(/Kofi Mensah joined this roster at Estate gate\./)).toBeTruthy();
    expect(within(banner).getByText(/Ama Boateng moved from Estate gate to Head office\./)).toBeTruthy();
    expect(within(banner).getAllByText(/Ama Mensah/)).toHaveLength(2);
  });

  it("still shows the boarding fields below the marker, so the stop can be recorded", () => {
    renderForm(
      trip({ rosterChanges: [{ id: "rc1", at, by: "Ops", summary: "Kofi Mensah joined this roster at Estate gate." }] }),
    );
    expect(screen.getByLabelText(/Actual arrival at Estate gate/)).toBeTruthy();
    expect(screen.getByLabelText(/Ama Boateng/)).toBeTruthy();
    // The rider list is the roster as it is now, and the banner says so.
    expect(screen.getByText(/The list of riders below is the roster as it is now/i)).toBeTruthy();
  });
});
