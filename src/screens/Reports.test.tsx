// @vitest-environment jsdom
// The rental report (RPT-01): the figures an owner compares with their own records, and the
// behaviour when the business has not supplied the thing a figure needs.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportsPage } from "./Reports";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, emptyRentalSettings, type Database, type Invoice, type Rental, type User } from "../tms/types";

afterEach(cleanup);

const at = "2026-06-02T09:00:00.000Z";

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

const today = new Date().toISOString().slice(0, 10);

const rental: Rental = {
  id: "r1",
  reference: "RR-0001",
  clientId: null,
  customerName: "Acme Ltd",
  customerPhone: "0244000000",
  customerEmail: "",
  purpose: "",
  pickupLocation: "Accra",
  dropoffLocation: "Kumasi",
  startDate: today,
  endDate: today,
  passengers: 10,
  vehicleCategoryId: "cat",
  driverRequired: false,
  notes: "",
  status: "declined",
  quote: null,
  quoteHistory: [],
  assignedVehicleId: null,
  assignedDriverId: null,
  deposit: null,
  finalInvoice: null,
  resolutionReason: "Price",
  createdAt: `${today}T09:00:00.000Z`,
  updatedAt: `${today}T10:00:00.000Z`,
};

const invoice: Invoice = {
  id: "i1",
  reference: "INV-2026-0001",
  kind: "rental",
  rentalId: rental.id,
  clientId: null,
  customerName: "Acme Ltd",
  currencyCode: "GHS",
  lines: [],
  taxLines: [],
  subtotal: 2000,
  total: 2000,
  amountPaid: 0,
  status: "issued",
  billableEvent: "rental:r1:final",
  issuedOn: today,
  dueOn: today,
  notes: "",
  voidReason: null,
  voidedAt: null,
  createdAt: at,
  updatedAt: at,
};

function world(currencyCode: string | null): Database {
  const base = emptyDatabase();
  return {
    ...base,
    users: [admin],
    rentals: [rental],
    invoices: [invoice],
    settings: {
      ...base.settings,
      currencyCode,
      rental: { ...emptyRentalSettings(), pricingBasis: "per_day" },
    },
  };
}

function makeTms(db: Database): Tms {
  return {
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
}

const renderReport = (db: Database) =>
  render(
    <TmsContext.Provider value={makeTms(db)}>
      <ReportsPage />
    </TmsContext.Provider>,
  );

describe("rental report screen", () => {
  it("shows the period's enquiries, money and the reason rentals were lost", () => {
    renderReport(world("GHS"));
    expect(screen.getByText("Rental report")).toBeTruthy();
    expect(screen.getByText(/2 requests received, 0 quoted|1 request received, 0 quoted/)).toBeTruthy();
    // Invoiced and outstanding are the same figure here: nothing has been paid.
    expect(screen.getAllByText("GHS 2000.00").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Price")).toBeTruthy();
    // No quotation means no acceptance rate; no vehicle in this fleet means no utilisation; no
    // completed run means no cost per trip, and nobody boarded means no cost per passenger.
    expect(screen.getAllByText("Not available").length).toBe(4);
  });

  it("refuses to print money when no currency is configured", () => {
    renderReport(world(null));
    // Both sections withhold money: the rental figures and the financial report.
    expect(screen.getAllByText(/Money figures are withheld/i)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Download CSV/i })).toHaveProperty("disabled", true);
  });

  it("rejects a backwards date range instead of showing zeros", () => {
    renderReport(world("GHS"));
    const from = screen.getByLabelText(/Report from date/i);
    const to = screen.getByLabelText(/Report to date/i);
    fireEvent.change(to, { target: { value: "2020-01-01" } });
    fireEvent.change(from, { target: { value: "2020-02-01" } });
    expect(screen.getByText(/wrong way round/i)).toBeTruthy();
  });
});

describe("money and cost section (RPT-03)", () => {
  it("shows revenue by customer, expenses by category and the cost of a completed run", () => {
    const db = world("GHS");
    renderReport({
      ...db,
      workOrders: [
        {
          id: "wo1",
          reference: "WO-0001",
          vehicleId: "v1",
          title: "Brakes",
          workType: "Repair",
          workshop: "",
          description: "",
          reportedOdometer: null,
          plannedDate: null,
          incidentId: null,
          status: "open",
          holdReason: null,
          completedAt: null,
          resetsServiceInterval: false,
          costEntries: [
            { id: "c1", description: "Pads", category: "Parts", amount: 300, incurredDate: today, recordedAt: at, recordedBy: "Fin" },
            { id: "c2", description: "Fitting", category: "Labour", amount: 200, incurredDate: today, recordedAt: at, recordedBy: "Fin" },
          ],
          costsConfirmedComplete: true,
          completionNote: null,
          releasedBy: null,
          releasedAt: null,
          log: [],
          // The cost report counts a work order only if the order itself was raised in the period.
          createdAt: `${today}T09:00:00.000Z`,
          updatedAt: `${today}T09:00:00.000Z`,
        },
      ],
      trips: [
        {
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
          stopLogs: [],
          boardings: [{ passengerId: "p1", stopId: "s1", outcome: "boarded" }],
          onTimeThresholdMinutes: 5,
          corrections: [],
          rosterChanges: [],
          origin: "schedule",
          originReason: null,
          createdAt: at,
          updatedAt: at,
        },
      ],
    });

    expect(screen.getByText("Money and cost (RPT-03)")).toBeTruthy();
    // Revenue by customer names the customer, not just a total.
    expect(screen.getByText("Acme Ltd")).toBeTruthy();
    // Expenses keep their category, and cost per trip divides by the one completed run.
    expect(screen.getByText("Parts")).toBeTruthy();
    expect(screen.getByText("Labour")).toBeTruthy();
    expect(screen.getByText("Cost per trip")).toBeTruthy();
    // 500 of costs over 1 run, and over 1 rider boarded.
    expect(screen.getAllByText("GHS 500.00").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "Download financial CSV" })).toBeTruthy();
  });

  it("says plainly when the financial period holds nothing", () => {
    renderReport({ ...world("GHS"), invoices: [], rentals: [] });
    expect(screen.getByText(/No invoices, payments, credit notes, recorded costs or completed runs/)).toBeTruthy();
  });
});
