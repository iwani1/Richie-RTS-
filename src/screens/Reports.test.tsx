// @vitest-environment jsdom
// The rental report (RPT-01): the figures an owner compares with their own records, and the
// behaviour when the business has not supplied the thing a figure needs.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  passengerId: null,
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
  acceptance: null,
      run: null,
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
  buyerAddress: "",
  buyerTin: "",
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
      rental: { ...emptyRentalSettings(), quotationTerms: "Prices are firm for the validity period.", pricingBasis: "per_day" },
    },
  };
}

function makeTms(db: Database, allowed: (permission: string) => boolean = () => true): Tms {
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
    allowed,
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
    // The hire sheet is the first tab; the staff-transport report is its own tab (RPT-02).
    expect(screen.getByRole("tab", { name: "Hire and money" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Hire report")).toBeTruthy();
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
          delays: [],
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
    // The client appears on the route table and again on the client table.
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
    expect(screen.getByText(/No invoices, payments, credit notes, refunds, recorded costs or completed runs/)).toBeTruthy();
  });
});

describe("printing the report (RPT-05, D-98)", () => {
  it("opens the sheet as a printer receives it, with the figures already checked on screen", () => {
    renderReport({ ...world("GHS"), settings: { ...world("GHS").settings, companyName: "Richie Transport Services" } });

    fireEvent.click(screen.getByRole("button", { name: /Print or save as PDF/i }));

    // The preview is the paper: the company, the period, and the document's own name.
    const dialog = screen.getByRole("dialog", { name: /Print preview: Management report/i });
    expect(within(dialog).getByText("Richie Transport Services")).toBeTruthy();
    expect(within(dialog).getByText("Management report")).toBeTruthy();
    expect(within(dialog).getByText(/Printing RPT-/)).toBeTruthy();

    // The money on the paper is the money the screen shows: nothing has been paid on this invoice.
    expect(within(dialog).getAllByText("GHS 2000.00").length).toBeGreaterThan(0);
    // A table with nothing in it says so rather than sitting blank.
    expect(within(dialog).getByText(/No invoice was issued in this period|Acme Ltd/)).toBeTruthy();
    // The one command that produces the file is the browser's own print dialog.
    expect(within(dialog).getByRole("button", { name: /Print or save as PDF/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^Close$/ })).toBeTruthy();
  });

  it("prints a sheet that withholds money, rather than refusing to print at all", () => {
    renderReport(world(null));

    // The button is offered when no currency is set: the sheet then says what it cannot state.
    const print = screen.getByRole("button", { name: /Print or save as PDF/i });
    expect(print).toHaveProperty("disabled", false);
    fireEvent.click(print);

    const dialog = screen.getByRole("dialog", { name: /Print preview: Management report/i });
    expect(within(dialog).getByText(/Money withheld: no currency is set/i)).toBeTruthy();
    expect(within(dialog).getAllByText("Not stated").length).toBeGreaterThan(0);
    // The company name is a stated gap, not a plausible-looking placeholder.
    expect(within(dialog).getByText(/Company name not set in Settings/)).toBeTruthy();
  });

  it("does not offer paper for a period that is the wrong way round", () => {
    renderReport(world("GHS"));
    fireEvent.change(screen.getByLabelText(/Report to date/i), { target: { value: "2020-01-01" } });
    fireEvent.change(screen.getByLabelText(/Report from date/i), { target: { value: "2020-02-01" } });
    expect(screen.getByRole("button", { name: /Print or save as PDF/i })).toHaveProperty("disabled", true);
  });
});

describe("staff transport tab (RPT-02)", () => {
  /** One route, one bus of 20 seats, one rostered rider who boarded, on a run completed today. */
  function staffWorld(): Database {
    const base = emptyDatabase();
    const route = {
      id: "route1",
      reference: "RT-001",
      name: "Estate run",
      clientId: "c1",
      direction: "to_work" as const,
      shiftId: null,
      vehicleCategoryId: "cat",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startDate: "2026-01-01",
      endDate: null,
      stops: [
        { id: "s1", name: "Estate gate", scheduledTime: "06:00", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
        { id: "s2", name: "Head office", scheduledTime: "06:30", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
      ],
      status: "active" as const,
      createdAt: at,
      updatedAt: at,
    };
    return {
      ...base,
      users: [admin],
      clients: [{ id: "c1", name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", registrationNumber: "", registeredOn: "", status: "active", createdAt: at, updatedAt: at }],
      routes: [route],
      vehicles: [
        { id: "v1", registration: "GT 100-26", categoryId: "cat", make: "", model: "", seatCapacity: 20, status: "available", fuelType: "", ownership: null, ownerName: "", usualDriverId: null, photo: null, notes: "", createdAt: at, updatedAt: at },
      ],
      passengers: [
        { id: "p1", clientId: "c1", fullName: "Ama", employeeRef: "E-1", phone: "", routeId: "route1", stopId: "s1", status: "active", createdAt: at, updatedAt: at },
      ],
      trips: [
        {
          id: "t1",
          reference: "TR-0001",
          routeId: "route1",
          serviceDate: today,
          status: "completed",
          vehicleId: "v1",
          driverId: null,
          dispatchedAt: at,
          startedAt: at,
          completedAt: at,
          cancelReason: null,
          cancelledAt: null,
          cancelledBy: null,
          incidentId: null,
          stopLogs: [
            { stopId: "s1", actualTime: "06:04" },
            { stopId: "s2", actualTime: "06:31" },
          ],
          boardings: [{ passengerId: "p1", stopId: "s1", outcome: "boarded" }],
          onTimeThresholdMinutes: 5,
          corrections: [],
          delays: [],
          rosterChanges: [],
          origin: "schedule",
          originReason: null,
          createdAt: at,
          updatedAt: at,
        },
      ],
    } as Database;
  }

  const openStaffTab = (db: Database, allowed?: (permission: string) => boolean) => {
    render(
      <TmsContext.Provider value={makeTms(db, allowed)}>
        <ReportsPage />
      </TmsContext.Provider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Staff transport" }));
  };

  it("counts the rider who boarded against the seats the bus actually offered", () => {
    openStaffTab(staffWorld());

    expect(screen.getByRole("tab", { name: "Staff transport" }).getAttribute("aria-selected")).toBe("true");
    // One run worked, one rider carried, and 20 seats on the bus that ran: 1 of 20 is a measurement.
    expect(screen.getByText("Riders carried")).toBeTruthy();
    expect(screen.getByText("of 1 expected on those runs")).toBeTruthy();
    expect(screen.getByText("1 riders over 20 seats offered")).toBeTruthy();
    // 1 carried of 20 seats reads the same on the card and in the route table.
    expect(screen.getAllByText("5.0%").length).toBe(2);
    // The route and the client are named, not just totalled.
    expect(screen.getByText("Estate run")).toBeTruthy();
    // The client appears on the route table and again on the client table.
    expect(screen.getAllByText("Acme Ltd").length).toBeGreaterThanOrEqual(2);
    // And the report states what it cannot say rather than leaving a blank.
    expect(screen.getByText("What this report cannot say")).toBeTruthy();
    expect(screen.getByText(/Fuel and mileage are not per route/i)).toBeTruthy();
    expect(screen.getByText(/A delay is only known where a stop time was recorded/i)).toBeTruthy();
  });

  it("is not offered to a role that cannot read the employee roster", () => {
    render(
      <TmsContext.Provider value={makeTms(staffWorld(), (permission) => permission !== "passengers:read")}>
        <ReportsPage />
      </TmsContext.Provider>,
    );
    expect(screen.queryByRole("tab", { name: "Staff transport" })).toBeNull();
    expect(screen.getByText("Hire report")).toBeTruthy();
  });

  it("reports an empty period as empty, and refuses a backwards one", () => {
    openStaffTab(staffWorld());
    const from = screen.getByLabelText(/Report from date/i);
    const to = screen.getByLabelText(/Report to date/i);

    // A period before the business had any runs: nothing ran, which is not the same as nobody travelling.
    fireEvent.change(from, { target: { value: "2025-01-01" } });
    fireEvent.change(to, { target: { value: "2025-01-31" } });
    expect(screen.getByText(/No run has a service date in this period/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download CSV/i })).toHaveProperty("disabled", false);

    fireEvent.change(to, { target: { value: "2024-12-31" } });
    expect(screen.getByText(/wrong way round/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download CSV/i })).toHaveProperty("disabled", true);
  });
});
