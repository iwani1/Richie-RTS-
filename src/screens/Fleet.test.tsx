// @vitest-environment jsdom
// The fleet dashboard (FLT-05, D-112). The screen has one job: state the fleet's figures as they are
// in the records, and say plainly where a figure cannot be stated. The tests therefore check the
// counts, the honesty about idle cost, and that a period with no days in it is refused rather than
// rendered as zero.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetPage } from "./Fleet";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, type Database, type Rental, type Trip, type User, type Vehicle, type WorkOrder } from "../tms/types";

afterEach(cleanup);

const at = "2026-01-01T06:00:00.000Z";

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

const vehicle = (id: string, overrides: Partial<Vehicle> = {}): Vehicle => ({
  id,
  registration: `GT ${id.toUpperCase()}`,
  categoryId: "cat",
  make: "Toyota",
  model: "Coaster",
  seatCapacity: 30,
  status: "available",
  fuelType: "Diesel",
  ownership: "owned",
  ownerName: "",
  usualDriverId: null,
  photo: null,
  notes: "",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const trip = (id: string, serviceDate: string, vehicleId: string, overrides: Partial<Trip> = {}): Trip => ({
  id,
  reference: `TR-${id}`,
  routeId: "r1",
  serviceDate,
  status: "completed",
  origin: "schedule",
  originReason: null,
  vehicleId,
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
  onTimeThresholdMinutes: null,
  corrections: [],
  delays: [],
  rosterChanges: [],
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const rental = (id: string, vehicleId: string, startDate: string, endDate: string, overrides: Partial<Rental> = {}): Rental => ({
  id,
  reference: `RR-${id}`,
  clientId: null,
  customerName: "Ama Transport",
  customerPhone: "",
  customerEmail: "",
  purpose: "",
  pickupLocation: "",
  dropoffLocation: "",
  startDate,
  endDate,
  passengers: 12,
  vehicleCategoryId: "cat",
  driverRequired: true,
  notes: "",
  status: "confirmed",
  quote: null,
  quoteHistory: [],
  acceptance: null,
      run: null,
      plan: null,
  assignedVehicleId: vehicleId,
  assignedDriverId: null,
  deposit: null,
  // Nothing charged beyond the price on these fixtures (D-123).
  extraCharges: [],
  finalInvoice: null,
  resolutionReason: null,
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const workOrder = (id: string, vehicleId: string, overrides: Partial<WorkOrder> = {}): WorkOrder => ({
  id,
  reference: `WO-${id}`,
  vehicleId,
  title: "Brakes",
  workType: "Repair",
  workshop: "",
  description: "",
  reportedOdometer: null,
  plannedDate: null,
  incidentId: null,
  status: "in_progress",
  holdReason: null,
  completedAt: null,
  resetsServiceInterval: false,
  costEntries: [],
  costsConfirmedComplete: false,
  completionNote: null,
  releasedBy: null,
  releasedAt: null,
  log: [],
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

function world(overrides: Partial<Database> = {}): Database {
  const db = emptyDatabase();
  return {
    ...db,
    users: [admin],
    settings: {
      ...db.settings,
      currencyCode: "GHS",
      vehicleCategories: [{ id: "cat", name: "Coach", licenceClasses: [] }],
    },
    vehicles: [
      vehicle("a", { registration: "GT 1" }),
      vehicle("b", { registration: "GT 2", createdAt: "2026-06-06T07:00:00.000Z" }),
      vehicle("c", { registration: "GT 3", status: "retired" }),
      vehicle("d", { registration: "GT 4", status: "out_of_service" }),
      vehicle("m", { registration: "GT 5", status: "maintenance" }),
    ],
    trips: [trip("1", "2026-06-02", "a"), trip("2", "2026-06-03", "a", { status: "planned" }), trip("3", "2026-06-07", "b"), trip("4", "2026-06-02", "d")],
    rentals: [rental("1", "a", "2026-06-04", "2026-06-05")],
    workOrders: [workOrder("1", "a", { createdAt: "2026-06-08T09:00:00.000Z", releasedAt: "2026-06-11T09:00:00.000Z" })],
    ...overrides,
  } as Database;
}

function renderFleet(db: Database, allowed: (permission: string) => boolean = () => true) {
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
    allowed,
    dispatch: vi.fn(async () => ({ ok: true, message: "" }) as CommandResult),
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
  } as unknown as Tms;

  render(
    <TmsContext.Provider value={tms}>
      <FleetPage />
    </TmsContext.Provider>,
  );
}

/** Put the screen on a period the records actually cover, rather than this month. */
function setPeriod(from: string, to: string) {
  fireEvent.change(screen.getByLabelText(/^From/), { target: { value: from } });
  fireEvent.change(screen.getByLabelText(/^To/), { target: { value: to } });
}

describe("the fleet dashboard", () => {
  it("states the fleet, the day and the period from the records", () => {
    renderFleet(world());
    setPeriod("2026-06-01", "2026-06-10");

    expect(screen.getByText("4 in service · 1 retired")).toBeTruthy();
    // Approved utilisation: six committed vehicle-days of the four vehicles in service × ten days.
    expect(screen.getByText("6 of 40 committed vehicle-days")).toBeTruthy();
    expect(screen.getByText("15%")).toBeTruthy();
    // Worked: three of the 32 serviceable vehicle-days (35 in the fleet, 3 in the workshop).
    expect(screen.getByText("9% of 32 serviceable vehicle-days")).toBeTruthy();
    expect(screen.getByText("of 35 vehicle-days in the period")).toBeTruthy();
    expect(screen.getByText(/15% of the available vehicle-days were committed to work: 6 of 40/)).toBeTruthy();
    expect(screen.getByText(/3 vehicle-day\(s\) were actually worked — 9% of the 32 serviceable day\(s\)/)).toBeTruthy();
  });

  it("puts no money on an idle day until the company supplies a daily cost", () => {
    renderFleet(world());
    setPeriod("2026-06-01", "2026-06-10");

    expect(screen.getByText("Not priced")).toBeTruthy();
    expect(screen.getByText("No standing cost set")).toBeTruthy();
    expect(screen.getByText(/No money is put on an idle day/)).toBeTruthy();
    expect(screen.getByText(/Set it under Settings → Fleet/)).toBeTruthy();
    expect(screen.getByText(/26 idle day\(s\) have no money on them/)).toBeTruthy();
  });

  it("tells a reader who may not change settings who can", () => {
    renderFleet(world(), () => false);
    setPeriod("2026-06-01", "2026-06-10");
    expect(screen.getByText(/An administrator can set it under Settings → Fleet/)).toBeTruthy();
  });

  it("prices the idle days when the standing cost is set", () => {
    const db = world();
    renderFleet({ ...db, settings: { ...db.settings, fleetStandingCostPerDay: 450.05 } });
    setPeriod("2026-06-01", "2026-06-10");

    expect(screen.getByText("GHS 11701.30")).toBeTruthy();
    expect(screen.getByText("GHS 450.05 per vehicle-day")).toBeTruthy();
    expect(screen.queryByText(/No money is put on an idle day/)).toBeNull();
  });

  it("states what the records cannot say, rather than leaving a silent gap", () => {
    renderFleet(world());
    setPeriod("2026-06-01", "2026-06-10");

    // The caveats sit under the per-vehicle table, not only in the sentence above it.
    const caveats = screen.getByText("What the records cannot say").parentElement as HTMLElement;
    expect(within(caveats).getByText(/retired vehicle\(s\) are left out of every day/)).toBeTruthy();
    expect(within(caveats).getByText(/have no\s+work order, so there is nothing to date the days by/)).toBeTruthy();
    expect(within(caveats).getByText(/Hours are not measured at all/)).toBeTruthy();
    expect(within(caveats).getByText(/booked day\(s\) never had a start recorded/)).toBeTruthy();
  });

  it("lists the idlest vehicle first, because that is the row somebody acts on", () => {
    renderFleet(world());
    setPeriod("2026-06-01", "2026-06-10");

    const card = screen.getByText("By vehicle").closest("section") as HTMLElement;
    const rows = within(card).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("GT 5")).toBeTruthy();
    // Ten days in the fleet, none committed, ten of them idle: the vehicle with no work order and
    // nothing else.
    expect(within(rows[0]).getAllByText("10").length).toBe(2);
    expect(within(rows[0]).getAllByText("0").length).toBe(4); // committed, worked, workshop, and the empty booked cell is not printed
    // A retired vehicle never appears in the period table.
    expect(within(card).queryByText("GT 3")).toBeNull();
  });

  it("refuses a period that runs backwards instead of rendering zeros", () => {
    renderFleet(world());
    setPeriod("2026-06-10", "2026-06-10");
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: "2026-06-11" } });

    expect(screen.getByText(/The start date is after the end date/)).toBeTruthy();
    expect(screen.queryByText("By vehicle")).toBeNull();
  });

  it("says there is nothing to measure on an empty register", () => {
    renderFleet(emptyDatabase());
    expect(screen.getByText(/No vehicles are on the register, so there is nothing to measure/)).toBeTruthy();
    expect(screen.queryByText("By vehicle")).toBeNull();
  });
});

describe("handing the dashboard to a spreadsheet (RPT-04, D-113)", () => {
  it("downloads the figures and the per-vehicle rows, named for the period", () => {
    const created: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", { value: (blob: Blob) => { created.push(blob); return "blob:fleet"; }, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, configurable: true });
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });

    renderFleet(world());
    setPeriod("2026-06-01", "2026-06-10");
    fireEvent.click(screen.getByRole("button", { name: /Download CSV/i }));

    expect(clicked).toEqual(["fleet-dashboard-2026-06-01-to-2026-06-10.csv"]);
    expect(created).toHaveLength(1);
    click.mockRestore();
  });

  it("offers nothing to download when there is no fleet", () => {
    renderFleet(emptyDatabase());
    expect(screen.getByRole("button", { name: /Download CSV/i })).toHaveProperty("disabled", true);
  });
});
