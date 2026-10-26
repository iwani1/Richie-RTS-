// @vitest-environment jsdom
// The client register is where the office looks up who to ring. Since a client may now have more
// than one contact account (Q-38, D-77), the register has to say how many there are and which one
// is primary - otherwise the reader assumes the person in the free-text field is the only one.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientsPage } from "./Registers";
import { TmsContext, type Tms } from "../tms/useTms";
import { emptyDatabase, type Client, type Database, type User } from "../tms/types";

afterEach(cleanup);

const at = "2026-01-01T00:00:00.000Z";

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
  contactName: "Efua Addo",
  contactPhone: "024",
  contactEmail: "efua@example.test",
  reference: "",
  type: null,
  billingAddress: "",
  tin: "",
  notes: "",
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const contact = (id: string, fullName: string, email: string, clientId: string, primaryContact = false): User => ({
  ...admin,
  id,
  fullName,
  email,
  role: "client_contact",
  clientId,
  primaryContact,
});

function renderClients(db: Database) {
  const tms = {
    db,
    actor: { id: admin.id, fullName: admin.fullName, role: admin.role },
    currentUser: admin,
    status: "ready",
    connectionError: null,
    auditTotal: 0,
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
  } as unknown as Tms;
  render(
    <TmsContext.Provider value={tms}>
      <ClientsPage />
    </TmsContext.Provider>,
  );
  return tms;
}

const rowFor = (text: string) => screen.getAllByRole("row").find((row) => row.textContent?.includes(text))!;

describe("the client register and its contact accounts", () => {
  it("says how many contact accounts a client has and which one is primary", () => {
    renderClients({
      ...emptyDatabase(),
      users: [admin, contact("u2", "Efua Addo", "efua@example.test", "c1"), contact("u3", "Yaw Mensah", "yaw@example.test", "c1", true)],
      clients: [client("c1", "Northstar Foods")],
    });
    const row = rowFor("Northstar Foods");
    expect(within(row).getByText(/2 contact accounts · Yaw Mensah is primary/)).toBeTruthy();
  });

  it("says so when nobody is marked primary, rather than implying the only contact is gone", () => {
    renderClients({
      ...emptyDatabase(),
      users: [admin, contact("u2", "Efua Addo", "efua@example.test", "c1")],
      clients: [client("c1", "Northstar Foods")],
    });
    expect(within(rowFor("Northstar Foods")).getByText(/1 contact account · none marked primary/)).toBeTruthy();
  });

  it("leaves a client with no accounts reading exactly as before", () => {
    renderClients({ ...emptyDatabase(), users: [admin], clients: [client("c2", "Harbour Logistics")] });
    const row = rowFor("Harbour Logistics");
    expect(row.textContent).toContain("Efua Addo");
    expect(row.textContent).not.toContain("contact account");
  });
});

describe("the customer details a document needs (CUS-01)", () => {
  const detailed = (overrides: Partial<Client> = {}): Client => ({
    ...client("c3", "Harbour Logistics"),
    reference: "HBL-77",
    type: "organisation",
    billingAddress: "Tema Harbour, Gate 3",
    tin: "C0012345678",
    notes: "",
    ...overrides,
  });

  it("shows the code, the classification and the billing details on the row", () => {
    renderClients({ ...emptyDatabase(), users: [admin], clients: [detailed()] });
    const row = rowFor("Harbour Logistics");
    // The code and the classification share one cell: "HBL-77 · Organisation".
    expect(row.textContent).toContain("HBL-77");
    expect(row.textContent).toContain("Organisation");
    expect(within(row).getByText("Tema Harbour, Gate 3")).toBeTruthy();
    expect(within(row).getByText("TIN C0012345678")).toBeTruthy();
  });

  it("says what it does not know instead of filling a blank with a guess", () => {
    renderClients({ ...emptyDatabase(), users: [admin], clients: [client("c4", "Walk-in Hire")] });
    const row = rowFor("Walk-in Hire");
    expect(within(row).getByText("no code")).toBeTruthy();
    expect(row.textContent).toContain("type not recorded");
    // The billing column is its own cell, and it says the details are missing.
    expect(within(row).getByText("not recorded")).toBeTruthy();
  });

  it("offers the code, the classification and the billing fields when adding a customer", () => {
    renderClients({ ...emptyDatabase(), users: [admin], clients: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add client" }));

    const panel = screen.getByRole("dialog", { name: /Add client/ });
    expect(within(panel).getByLabelText(/Customer code/)).toBeTruthy();
    expect(within(panel).getByLabelText(/Customer is/)).toBeTruthy();
    expect(within(panel).getByLabelText(/Billing address/)).toBeTruthy();
    expect(within(panel).getByLabelText(/Tax identification number/)).toBeTruthy();
    // The classification starts unrecorded rather than defaulting to a company.
    expect((within(panel).getByLabelText(/Customer is/) as HTMLSelectElement).value).toBe("");
    // And the panel says what the details are for, so nobody wonders why it asks.
    expect(within(panel).getByText(/what an invoice prints/i)).toBeTruthy();
  });

  it("sends the typed details with the command", async () => {
    const tms = renderClients({ ...emptyDatabase(), users: [admin], clients: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add client" }));
    const panel = screen.getByRole("dialog", { name: /Add client/ });

    fireEvent.change(within(panel).getByLabelText("Client name"), { target: { value: "Harbour Logistics" } });
    fireEvent.change(within(panel).getByLabelText(/Customer code/), { target: { value: "HBL-77" } });
    fireEvent.change(within(panel).getByLabelText(/Customer is/), { target: { value: "organisation" } });
    fireEvent.change(within(panel).getByLabelText(/Billing address/), { target: { value: "Tema Harbour, Gate 3" } });
    fireEvent.change(within(panel).getByLabelText(/Tax identification number/), { target: { value: "C0012345678" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save client" }));

    await waitFor(() => expect(tms.dispatch).toHaveBeenCalled());
    const sent = (tms.dispatch as unknown as { mock: { calls: [unknown][] } }).mock.calls[0][0] as { type: string; input: Record<string, unknown> };
    expect(sent.type).toBe("create_client");
    expect(sent.input.reference).toBe("HBL-77");
    expect(sent.input.type).toBe("organisation");
    expect(sent.input.billingAddress).toBe("Tema Harbour, Gate 3");
    expect(sent.input.tin).toBe("C0012345678");
  });

  it("shows the changes recorded against a customer, newest first", () => {
    renderClients({
      ...emptyDatabase(),
      users: [admin],
      clients: [detailed()],
      audit: [
        { id: "a2", at: "2026-06-02T10:00:00.000Z", actorId: admin.id, actorName: "Ama Mensah", action: "clients:update", entity: "client", entityId: "c3", summary: "Updated client Harbour Logistics (active)." },
        { id: "a1", at: "2026-06-01T09:00:00.000Z", actorId: admin.id, actorName: "Ama Mensah", action: "clients:create", entity: "client", entityId: "c3", summary: "Added corporate client Harbour Logistics." },
        { id: "other", at: "2026-06-01T09:00:00.000Z", actorId: admin.id, actorName: "Ama Mensah", action: "vehicles:create", entity: "vehicle", entityId: "v9", summary: "Added vehicle GT 999-26." },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "History of Harbour Logistics" }));
    const panel = screen.getByRole("dialog", { name: /History of Harbour Logistics/ });
    // Only this customer's changes: another record's entry is not in the panel.
    expect(within(panel).getByText("Updated client Harbour Logistics (active).")).toBeTruthy();
    expect(within(panel).getByText("Added corporate client Harbour Logistics.")).toBeTruthy();
    expect(within(panel).queryByText(/Added vehicle/)).toBeNull();
    // It is a record, not an editor: every button in the panel only closes it.
    expect([...new Set(within(panel).getAllByRole("button").map((button) => button.textContent))]).toEqual(["Close"]);
  });
});
