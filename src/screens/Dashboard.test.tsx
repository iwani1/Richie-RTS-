// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./Dashboard";
import { TmsContext, type Tms } from "../tms/useTms";
import { emptyDatabase, type Database, type Driver, type Trip, type User } from "../tms/types";

afterEach(cleanup);

const admin: User = {
  id: "u1",
  fullName: "Ama Mensah",
  email: "ama@example.test",
  role: "administrator",
  active: true,
  passwordHash: "",
  passwordSalt: "",
  driverId: null,
  clientId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const today = new Date().toISOString().slice(0, 10);

function withData(patch: Partial<Database> = {}): Database {
  return { ...emptyDatabase(), users: [admin], ...patch };
}

const driver = (name: string, licenceExpiry: string): Driver => ({
  id: `d-${name}`,
  fullName: name,
  phone: "+233 00 000 0000",
  licenceNumber: `DL-${name}`,
  licenceExpiry,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function makeTms(db: Database, overrides: Partial<Tms> = {}): Tms {
  return {
    db,
    actor: { id: admin.id, fullName: admin.fullName, role: admin.role },
    currentUser: admin,
    status: "ready",
    connectionError: null,
    setupRequired: false,
    flash: null,
    setFlash: () => {},
    allowed: () => true,
    dispatch: vi.fn(async () => ({ ok: true, message: "" })),
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
    ...overrides,
  } as Tms;
}

const renderBoard = (db: Database, navigate = vi.fn(), overrides: Partial<Tms> = {}) => {
  render(
    <TmsContext.Provider value={makeTms(db, overrides)}>
      <DashboardPage navigate={navigate} />
    </TmsContext.Provider>,
  );
  return navigate;
};

describe("operations board", () => {
  it("leads with the sheet masthead and keeps the four work bands", () => {
    renderBoard(withData());
    expect(screen.getByRole("heading", { level: 1, name: /Richie Transport Services/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Needs attention/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Today's departures/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Fleet/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Setup/ })).toBeTruthy();
  });

  it("says nothing needs attention once the rules are supplied, instead of listing zeros", () => {
    // Unset settings are themselves an exception, so the quiet state needs a configured install.
    const configured = withData({
      settings: {
        ...emptyDatabase().settings,
        companyName: "Richie Transport Services",
        currencyCode: "GHS",
        vehicleCategories: [{ id: "c1", name: "Coaster" }],
        shifts: [{ id: "s1", name: "Day", startTime: "06:00", endTime: "18:00" }],
        onTimeThresholdMinutes: 10,
      },
    });
    renderBoard(configured);
    expect(screen.getByText(/Nothing is waiting on you/)).toBeTruthy();
    expect(screen.queryByText(/still unset/)).toBeNull();
    expect(screen.queryByText(/0 driver licences expired/)).toBeNull();
  });

  it("lists an expired licence as an exception and links to the register", () => {
    const navigate = renderBoard(withData({ drivers: [driver("Kofi Boateng", "2020-01-01")] }));
    expect(screen.getByText(/1 driver licence expired/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Review/ })[0]);
    expect(navigate).toHaveBeenCalledWith("drivers");
  });

  it("shows today's departures from real trips, with unassigned slots named", () => {
    const db = withData({
      vehicles: [
        {
          id: "v1",
          registration: "GT 1234-26",
          categoryId: "c1",
          make: "Toyota",
          model: "Coaster",
          seatCapacity: 30,
          status: "available",
          notes: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      settings: { ...emptyDatabase().settings, vehicleCategories: [{ id: "c1", name: "Coaster" }] },
      routes: [
        {
          id: "r1",
          reference: "RT-001",
          name: "East estate run",
          clientId: "c",
          direction: "to_work",
          shiftId: null,
          vehicleCategoryId: "c1",
          weekdays: [1],
          startDate: "2026-01-01",
          endDate: null,
          stops: [{ id: "s1", name: "Gate", scheduledTime: "06:15" }],
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const trip: Trip = {
      id: "t1",
      reference: "TR-0001",
      routeId: "r1",
      serviceDate: today,
      status: "planned",
      vehicleId: null,
      driverId: null,
      dispatchedAt: null,
      startedAt: null,
      completedAt: null,
      cancelReason: null,
      stopLogs: [],
      boardings: [],
      onTimeThresholdMinutes: null,
      corrections: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    renderBoard({ ...db, trips: [trip] });
    expect(screen.getByRole("table", { name: /Today's departures/ })).toBeTruthy();
    expect(screen.getByText("06:15")).toBeTruthy();
    expect(screen.getByText("East estate run")).toBeTruthy();
    expect(screen.getAllByText(/not assigned/).length).toBe(2);
    // A planned trip is an exception: it has not been dispatched.
    expect(screen.getByText(/not dispatched/)).toBeTruthy();
  });

  it("marks unset business rules as Not set and counts progress", () => {
    renderBoard(withData());
    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);
    expect(screen.getByText(/0 of 5 complete/)).toBeTruthy();
  });

  it("hides bands the role cannot read", () => {
    renderBoard(withData(), vi.fn(), { allowed: (permission) => permission !== "rentals:read" && permission !== "settings:read" });
    expect(screen.queryByRole("heading", { name: /Bus rentals/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Setup/ })).toBeNull();
    expect(screen.getByRole("heading", { name: /Today's departures/ })).toBeTruthy();
  });
});
