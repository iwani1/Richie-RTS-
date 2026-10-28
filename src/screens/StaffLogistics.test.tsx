// @vitest-environment jsdom
// Staff logistics: the incident register, the work orders and the cost report. Three things have to
// hold on the rebuilt screen — the sections are one tab list, a vehicle the register no longer holds
// is said out loud rather than drawn as a dash, and the cost report's total is the sum of the lines
// it lists underneath it.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffLogisticsPage } from "./StaffLogistics";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, emptyRentalSettings, type Database, type Incident, type Trip, type User, type Vehicle, type WorkOrder } from "../tms/types";

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

const vehicle: Vehicle = {
  id: "v1",
  registration: "GT 4521-24",
  categoryId: "cat",
  make: "Toyota",
  model: "Coaster",
  seatCapacity: 33,
  status: "maintenance",
  fuelType: "Diesel",
  ownership: "owned",
  ownerName: "",
  usualDriverId: null,
  photo: null,
  notes: "",
  createdAt: at,
  updatedAt: at,
};

const incident: Incident = {
  id: "i1",
  reference: "IN-0001",
  type: "breakdown",
  severity: "high",
  vehicleId: "v1",
  tripId: null,
  reportedDate: today,
  description: "Gearbox slipped out of third on the Tema road.",
  assignedTo: "Kofi Auto Works",
  takeVehicleOutOfService: true,
  status: "responding",
  resolutionNote: null,
  vehicleRestoredTo: null,
  costEntries: [
    { id: "c1", description: "Recovery truck", category: "Maintenance", amount: 650, incurredDate: today, recordedAt: at, recordedBy: "Ama Mensah" },
  ],
  log: [],
  createdAt: `${today}T09:00:00.000Z`,
  updatedAt: at,
};

const order: WorkOrder = {
  id: "w1",
  reference: "WO-0001",
  vehicleId: "v1",
  title: "Gearbox overhaul",
  workType: "Repair",
  workshop: "Kofi Auto Works",
  description: "Strip and rebuild.",
  reportedOdometer: 318450,
  plannedDate: today,
  incidentId: "i1",
  status: "in_progress",
  holdReason: null,
  completedAt: null,
  resetsServiceInterval: false,
  costEntries: [
    { id: "c2", description: "Rebuild parts", category: "Maintenance", amount: 9800, incurredDate: today, recordedAt: at, recordedBy: "Ama Mensah" },
  ],
  costsConfirmedComplete: false,
  completionNote: null,
  releasedBy: null,
  releasedAt: null,
  log: [],
  createdAt: `${today}T09:00:00.000Z`,
  updatedAt: at,
};

// A run the records say was completed, with one rider who did not board: the only fixture the two
// derived figures need — cost per run divides by completed runs, and utilisation counts vehicle-days.
const completedRun: Trip = {
  id: "t1",
  reference: "TR-0001",
  routeId: "route1",
  serviceDate: today,
  status: "completed",
  origin: "schedule",
  originReason: null,
  vehicleId: "v1",
  driverId: null,
  dispatchedAt: at,
  startedAt: at,
  completedAt: at,
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  incidentId: null,
  stopLogs: [],
  boardings: [{ passengerId: "p1", stopId: "s1", outcome: "no_show" }],
  onTimeThresholdMinutes: 5,
  corrections: [],
  delays: [],
  rosterChanges: [],
  createdAt: at,
  updatedAt: at,
};

function world(overrides: Partial<Database> = {}): { db: Database; dispatch: Tms["dispatch"] } {
  const db: Database = {
    ...emptyDatabase(),
    settings: {
      ...emptyDatabase().settings,
      currencyCode: "GHS",
      rental: emptyRentalSettings(),
      costCategories: ["Maintenance"],
      workTypes: ["Repair"],
    },
    users: [admin],
    vehicles: [vehicle],
    incidents: [incident],
    workOrders: [order],
    ...overrides,
  };
  const dispatch = vi.fn(async () => ({ ok: true, message: "saved" }) as CommandResult);
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

const open = (db: Database, dispatch: Tms["dispatch"]) =>
  render(
    <TmsContext.Provider value={makeTms(db, dispatch)}>
      <StaffLogisticsPage />
    </TmsContext.Provider>,
  );

describe("the sections", () => {
  it("are one tab list, and each tab names the panel it opens", () => {
    const { db, dispatch } = world();
    open(db, dispatch);

    const strip = screen.getByRole("tablist", { name: /Staff logistics sections/i });
    expect(within(strip).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Incidents & breakdowns",
      "Work orders",
      "Cost report",
    ]);
    expect(within(strip).getByRole("tab", { name: "Incidents & breakdowns" }).getAttribute("aria-controls")).toBe(
      "logistics-panel-incidents",
    );
    // The open section is the panel the strip points at.
    expect(screen.getByRole("tabpanel", { name: "Incidents & breakdowns" }).id).toBe("logistics-panel-incidents");
  });

  it("switches to the work orders and the cost report", () => {
    const { db, dispatch } = world();
    open(db, dispatch);

    fireEvent.click(screen.getByRole("tab", { name: "Work orders" }));
    expect(screen.getByRole("tabpanel", { name: "Work orders" })).toBeTruthy();
    expect(screen.getByText("Gearbox overhaul")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Cost report" }));
    expect(screen.getByRole("tabpanel", { name: "Cost report" })).toBeTruthy();
    expect(screen.getAllByText(/Recorded spending/i).length).toBeGreaterThan(0);
  });
});

describe("the incident register", () => {
  it("lists the incident with its vehicle, its state and what it has cost so far", () => {
    const { db, dispatch } = world();
    open(db, dispatch);

    const panel = screen.getByRole("tabpanel", { name: "Incidents & breakdowns" });
    expect(within(panel).getByText("IN-0001")).toBeTruthy();
    // The vehicle appears in the register row and again in the desk's "off the road" list: both are
    // true, so the table is the one under test here.
    expect(within(panel).getByRole("table")).toBeTruthy();
    expect(within(panel).getAllByText("GT 4521-24").length).toBeGreaterThan(0);
    // The state appears on the register row and again in the desk list beside it.
    expect(within(panel).getAllByText("Response in progress").length).toBeGreaterThan(0);
    // The count of cost entries, not a figure: the amounts are on the record and in the report.
    expect(screen.getByText("1 of 1 incident shown")).toBeTruthy();
  });

  it("says a vehicle is missing from the register rather than drawing a dash", () => {
    const { db, dispatch } = world({ vehicles: [] });
    open(db, dispatch);
    expect(screen.getByText("not on the register")).toBeTruthy();
  });

  it("opens the incident, and offers the work order raised from it", async () => {
    const { db, dispatch } = world();
    open(db, dispatch);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText(/IN-0001/)).toBeTruthy();

    // Raising a work order carries the incident and the vehicle across, so the cost keeps its source.
    fireEvent.click(within(panel).getByRole("button", { name: /Raise work order/i }));
    const raised = screen.getByRole("dialog");
    expect(within(raised).getByText(/Raise a work order/i)).toBeTruthy();
  });
});

describe("the cost report", () => {
  it("prints the total, the coverage figures and the categories that make it up", () => {
    const { db, dispatch } = world();
    open(db, dispatch);
    fireEvent.click(screen.getByRole("tab", { name: "Cost report" }));

    // 650 recovery + 9,800 rebuild parts, both in the period.
    // The same figure three times on purpose: the headline total, the one category that makes it up,
    // and the ruled total under it. One category here, so all three agree.
    expect(screen.getAllByText("GHS 10450.00")).toHaveLength(3);
    const categories = screen.getByRole("table", { name: /Recorded spending by category/i });
    expect(within(categories).getAllByText("GHS 10450.00")).toHaveLength(2);
    expect(within(categories).getByText("Maintenance")).toBeTruthy();
    expect(within(categories).getByText("Total recorded")).toBeTruthy();
    expect(screen.getByText(/total recorded · 2 entries/)).toBeTruthy();
  });

  it("divides the total by the runs that were completed, and says when there were none", () => {
    const { db, dispatch } = world();
    open(db, dispatch);
    fireEvent.click(screen.getByRole("tab", { name: "Cost report" }));

    // No run in the period: the figure is absent, not zero, and the words say why.
    const band = screen.getByRole("heading", { name: /Cost per completed run/i }).closest("section") as HTMLElement;
    expect(within(band).getByText("Not available")).toBeTruthy();
    expect(within(band).getByText(/no run was completed in this period/i)).toBeTruthy();
    expect(within(band).getByText("Runs completed")).toBeTruthy();
  });

  it("prints the cost per completed run and how hard the fleet worked, from the same total", () => {
    const { db, dispatch } = world({ trips: [completedRun] });
    open(db, dispatch);
    fireEvent.click(screen.getByRole("tab", { name: "Cost report" }));

    const perRun = screen.getByRole("heading", { name: /Cost per completed run/i }).closest("section") as HTMLElement;
    // GHS 10,450 of recorded cost over the one completed run — the same total the band above prints.
    expect(within(perRun).getByText("GHS 10450.00")).toBeTruthy();
    expect(within(perRun).getByText(/per completed run · 1 run/i)).toBeTruthy();
    // One rider was recorded and did not board, so nobody was carried and the per-rider figure is absent.
    expect(within(perRun).getByText("Riders boarded")).toBeTruthy();
    expect(within(perRun).getByText("Cost per rider boarded")).toBeTruthy();
    expect(within(perRun).getByText("—")).toBeTruthy();

    const utilisation = screen.getByRole("heading", { name: /Fleet utilisation/i }).closest("section") as HTMLElement;
    expect(within(utilisation).getByText("Utilisation")).toBeTruthy();
    expect(within(utilisation).getByText(/^\d+%$/)).toBeTruthy();
    expect(within(utilisation).getByText("Committed vehicle-days")).toBeTruthy();
    // The gap is stated, not glossed: the figure is days, because no hours are recorded.
    expect(within(utilisation).getByText(/Counted in days, not hours/i)).toBeTruthy();
  });

  it("refuses a period that runs backwards, and computes nothing", async () => {
    const { db, dispatch } = world();
    open(db, dispatch);
    fireEvent.click(screen.getByRole("tab", { name: "Cost report" }));

    const [fromInput, toInput] = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    await act(async () => {
      fireEvent.change(fromInput, { target: { value: "2026-06-30" } });
      fireEvent.change(toInput, { target: { value: "2026-06-01" } });
    });
    expect(screen.getByText(/"From" must be on or before "To"/i)).toBeTruthy();
    expect(screen.queryByText("GHS 10450.00")).toBeNull();
  });

  it("says nothing was recorded rather than showing zero", () => {
    const { db, dispatch } = world({ incidents: [], workOrders: [] });
    open(db, dispatch);
    fireEvent.click(screen.getByRole("tab", { name: "Cost report" }));
    expect(screen.getByText(/Nothing recorded in this period/i)).toBeTruthy();
  });
});
