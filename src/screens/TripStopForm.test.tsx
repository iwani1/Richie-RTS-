// @vitest-environment jsdom
// Q-48: there is no SMS and no push, so the run itself carries the marker. The driver's next stop
// form is where it has to appear, because that is the screen he is on when the roster matters.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripStopForm } from "./TripStopForm";
import type { ManifestRider } from "../tms/bookings";
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
    { id: "s1", name: "Estate gate", scheduledTime: "06:00", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
    { id: "s2", name: "Head office", scheduledTime: "06:30", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
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
  origin: "schedule",
  originReason: null,
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

const manifestOf = (passengers: Passenger[] = [rider("Ama Boateng", "p1")]): ManifestRider[] =>
  passengers.map((passenger) => ({ passenger, source: "roster" as const, bookingReference: null, pickupStopId: passenger.stopId ?? "s1" }));

const renderForm = (t: Trip, passengers: Passenger[] = [rider("Ama Boateng", "p1")]) =>
  render(<TripStopForm trip={t} route={route} manifest={manifestOf(passengers)} onClose={() => {}} onSubmit={vi.fn(async () => ({}))} />);

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
    // The rider list is the roster and the booked seats as they are now, and the banner says so.
    expect(screen.getByText(/is the roster and the seats booked for this run, as they are now/i)).toBeTruthy();
  });
});

describe("where the stop actually is (RTE-01)", () => {
  /** The same run, with the first stop described the way a dispatcher would describe it. */
  const detailedRoute: BusRoute = {
    ...route,
    stops: [
      { id: "s1", name: "Estate gate", scheduledTime: "06:00", landmark: "Behind the Total filling station", digitalAddress: "GA-123-4567", latitude: "", longitude: "" },
      { id: "s2", name: "Head office", scheduledTime: "06:30", landmark: "", digitalAddress: "", latitude: "5.603717", longitude: "-0.186964" },
    ],
  };

  const renderDetailed = (t: Trip, stops = detailedRoute.stops) =>
    render(
      <TripStopForm
        trip={t}
        route={{ ...detailedRoute, stops }}
        manifest={manifestOf()}
        onClose={() => {}}
        onSubmit={vi.fn(async () => ({}))}
      />,
    );

  it("shows the landmark and the digital address of the stop being recorded", () => {
    renderDetailed(trip());
    expect(screen.getByText(/Behind the Total filling station · GA-123-4567/)).toBeTruthy();
  });

  it("offers a map link when the stop has a position", () => {
    // The first stop is already recorded, so the form opens on the second, which has coordinates.
    renderDetailed(trip({ stopLogs: [{ stopId: "s1", actualTime: "06:01" }] as never }));
    const link = screen.getByRole("link", { name: /Open in maps/i });
    expect(link.getAttribute("href")).toContain("5.603717%2C-0.186964");
    // The link leaves the application rather than being followed inside it.
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("says the directions are missing rather than leaving the panel empty", () => {
    renderDetailed(trip(), [
      { id: "s1", name: "Estate gate", scheduledTime: "06:00", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
      { id: "s2", name: "Head office", scheduledTime: "06:30", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
    ]);
    expect(screen.getByText("no directions recorded")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open in maps/i })).toBeNull();
  });
});
