// @vitest-environment jsdom
// The client register is where the office looks up who to ring. Since a client may now have more
// than one contact account (Q-38, D-77), the register has to say how many there are and which one
// is primary - otherwise the reader assumes the person in the free-text field is the only one.
import { cleanup, render, screen, within } from "@testing-library/react";
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
