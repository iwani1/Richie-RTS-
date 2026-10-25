// @vitest-environment jsdom
// The contracts screen (CLI-02, D-95).
//
// Three things this screen must not get wrong:
//   * an active contract offers no way to change its terms — the edit button is not there, because a
//     signed term that can be edited is worth nothing in an argument;
//   * approving is a real move that asks for a reason when it ends or pauses the agreement;
//   * "expired" comes from the end date, so a lapsed contract says so without anyone having recorded it.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContractsPage } from "./Contracts";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, emptyRentalSettings, type Client, type Contract, type Database, type User } from "../tms/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const at = "2026-06-01T09:00:00.000Z";

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

const client = (id: string, name: string): Client => ({
  id,
  name,
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const contract = (overrides: Partial<Contract> = {}): Contract => ({
  id: "ct1",
  reference: "CT-0001",
  clientId: "c1",
  clientName: "Acme Ltd",
  serviceType: "staff_transport",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  status: "active",
  routeIds: [],
  weekdays: [1, 2, 3, 4, 5],
  shiftIds: [],
  vehicleCategoryId: "",
  pricingModel: "Monthly rate per bus",
  billingFrequency: "Monthly in arrears",
  paymentTerms: "30 days from invoice",
  serviceLevelTargets: "",
  notes: "",
  replacesId: null,
  history: [{ at, actor: "Ama Mensah", from: "draft", to: "draft", note: "Drafted." }],
  createdBy: "Ama Mensah",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const base = (overrides: Partial<Database> = {}): Database => {
  const db = emptyDatabase();
  return {
    ...db,
    users: [admin],
    clients: [client("c1", "Acme Ltd")],
    contracts: [contract()],
    settings: { ...db.settings, currencyCode: "GHS", documentReminderLeadDays: 30, rental: { ...emptyRentalSettings(), paymentMethods: ["Cash"] } },
    ...overrides,
  };
};

function makeTms(db: Database, overrides: Partial<Tms> = {}): Tms {
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
    dispatch: vi.fn(async () => ({ ok: true, message: "done" }) as CommandResult),
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
    ...overrides,
  } as unknown as Tms;
}

const renderContracts = (db: Database = base(), overrides: Partial<Tms> = {}) => {
  const tms = makeTms(db, overrides);
  render(
    <TmsContext.Provider value={tms}>
      <ContractsPage />
    </TmsContext.Provider>,
  );
  return tms;
};

describe("the contracts screen", () => {
  it("lists the agreements with their term, client and state", () => {
    renderContracts();
    expect(screen.getByText("CT-0001")).toBeTruthy();
    expect(screen.getByText("Acme Ltd")).toBeTruthy();
    expect(screen.getByText("Staff transport")).toBeTruthy();
    // The badge, not the filter's own option: both read "Active".
    expect(screen.getAllByText("Active").length).toBeGreaterThan(1);
    // The figures at the top count the same records rather than a second set.
    expect(screen.getByText("agreement in force")).toBeTruthy();
  });

  it("calls a lapsed agreement expired without anybody having recorded it", () => {
    renderContracts(base({ contracts: [contract({ endDate: "2020-12-31" })] }));
    expect(screen.getAllByText("Expired").length).toBeGreaterThan(1);
  });

  it("warns about a renewal that falls inside the configured window", () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    renderContracts(base({ contracts: [contract({ endDate: soon })] }));
    expect(screen.getByText("Renewals due")).toBeTruthy();
  });

  it("opens an active contract without offering to change its terms", () => {
    renderContracts();
    fireEvent.click(screen.getByRole("button", { name: /Open CT-0001/ }));

    expect(screen.getByText("Monthly in arrears")).toBeTruthy();
    expect(screen.getByText("30 days from invoice")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Correct the terms/ })).toBeNull();

    // What it does offer is the next state, and suspending needs a reason.
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(screen.getByText(/Say why the contract is being suspend/i)).toBeTruthy();
  });

  it("suspends an active contract with a reason", async () => {
    const dispatch = vi.fn(async () => ({ ok: true, message: "CT-0001 suspended." }) as CommandResult);
    renderContracts(base(), { dispatch });
    fireEvent.click(screen.getByRole("button", { name: /Open CT-0001/ }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Invoice unpaid" } });
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "advance_contract", id: "ct1", to: "suspended", reason: "Invoice unpaid" }));
  });

  it("lets a draft be corrected — approval is the gate, not creation", () => {
    renderContracts(base({ contracts: [contract({ status: "draft" })] }));
    fireEvent.click(screen.getByRole("button", { name: /Open CT-0001/ }));
    fireEvent.click(screen.getByRole("button", { name: /Correct the terms/ }));
    expect(screen.getByRole("button", { name: /Save the contract/ })).toBeTruthy();
  });

  it("drafts a new contract from the form, transcribing the terms", async () => {
    const dispatch = vi.fn(async () => ({ ok: true, message: "CT-0002 drafted." }) as CommandResult);
    renderContracts(base(), { dispatch });

    fireEvent.click(screen.getByRole("button", { name: /New contract/ }));
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText(/^Pricing model/), { target: { value: "Per trip" } });
    fireEvent.click(screen.getByRole("button", { name: /Draft the contract/ }));

    await waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(dispatch).toHaveBeenCalledWith({
      type: "create_contract",
      input: expect.objectContaining({ clientId: "c1", pricingModel: "Per trip", serviceType: "staff_transport" }),
    });
  });

  it("shows a refusal on the field it belongs to", async () => {
    const dispatch = vi.fn(async () => ({ ok: false, message: "This contract cannot be created yet.", errors: { startDate: "Enter the day the contract starts." } }) as CommandResult);
    renderContracts(base(), { dispatch });

    fireEvent.click(screen.getByRole("button", { name: /New contract/ }));
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: /Draft the contract/ }));

    await waitFor(() => expect(screen.getByText("Enter the day the contract starts.")).toBeTruthy());
  });

  it("offers no drafting to a role that may only read", () => {
    renderContracts(base(), { allowed: (permission) => permission === "contracts:read" });
    expect(screen.queryByRole("button", { name: /New contract/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open CT-0001/ }));
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
    expect(screen.getByText("Monthly rate per bus")).toBeTruthy();
  });
});
