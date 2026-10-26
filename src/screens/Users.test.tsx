// @vitest-environment jsdom
// The accounts register. It had no test at all (audit F-15), which is why a sentence describing the
// pre-server build survived on its reset form for a whole rewrite.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsersPage } from "./Users";
import { TmsContext, type Tms } from "../tms/useTms";
import { emptyDatabase, type Database, type User } from "../tms/types";

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

const driverUser: User = {
  ...admin,
  id: "u2",
  fullName: "Kofi Boateng",
  email: "kofi@example.test",
  role: "driver",
  driverId: "d1",
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

const renderUsers = (db: Database, overrides: Partial<Tms> = {}) =>
  render(
    <TmsContext.Provider value={makeTms(db, overrides)}>
      <UsersPage />
    </TmsContext.Provider>,
  );

const withUsers = (): Database => ({ ...emptyDatabase(), users: [admin, driverUser] });

const client = {
  id: "c1",
  name: "Northstar Foods",
  contactName: "Efua Addo",
  contactPhone: "024",
  contactEmail: "efua@northstar.test",
  reference: "",
  type: null,
  billingAddress: "",
  tin: "",
  notes: "",
  status: "active" as const,
  createdAt: at,
  updatedAt: at,
};

const contactOne: User = {
  ...admin,
  id: "u3",
  fullName: "Efua Addo",
  email: "efua@northstar.test",
  role: "client_contact",
  clientId: client.id,
  primaryContact: false,
};

const contactTwo: User = {
  ...contactOne,
  id: "u4",
  fullName: "Yaw Mensah",
  email: "yaw@northstar.test",
  primaryContact: true,
};

const withContacts = (): Database => ({ ...withUsers(), clients: [client], users: [admin, driverUser, contactOne, contactTwo] });

describe("accounts register", () => {
  it("lists every account, marks the signed-in one and counts the administrators", () => {
    renderUsers(withUsers());
    expect(screen.getByText(/2 accounts · 2 active · 1 administrator/)).toBeTruthy();
    expect(screen.getByText("Kofi Boateng")).toBeTruthy();
    expect(screen.getByText("(you)")).toBeTruthy();
  });

  it("opens the add-user form with a password field that can be read back", () => {
    renderUsers(withUsers());
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add user" });
    const field = within(dialog).getByLabelText(/Initial password/i) as HTMLInputElement;
    expect(field.type).toBe("password");
    fireEvent.click(within(dialog).getByRole("button", { name: "Show password" }));
    expect(field.type).toBe("text");
  });

  it("says what a password reset does, instead of describing a build that no longer exists", () => {
    renderUsers(withUsers());
    fireEvent.click(screen.getAllByRole("button", { name: "Reset password" })[0]);
    const dialog = screen.getByRole("dialog", { name: /Reset password/ });
    expect(within(dialog).getByText(/ends every session this user has open/i)).toBeTruthy();
  });

  it("hides the actions a role cannot perform", () => {
    renderUsers(withUsers(), { allowed: () => false });
    expect(screen.queryByRole("button", { name: "Add user" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset password" })).toBeNull();
  });
});

describe("several contact accounts at one client (Q-38, D-77)", () => {
  it("shows which contact is the one we ring first", () => {
    renderUsers(withContacts());
    // Both people are listed against the same client, and only one carries the mark.
    const rows = screen.getAllByRole("row");
    const efua = rows.find((r) => r.textContent?.includes("efua@northstar.test"))!;
    const yaw = rows.find((r) => r.textContent?.includes("yaw@northstar.test"))!;
    expect(efua.textContent).toContain("Northstar Foods");
    expect(yaw.textContent).toContain("Northstar Foods");
    expect(efua.textContent).not.toContain("Primary");
    expect(yaw.textContent).toContain("Primary");
  });

  it("offers every client in the link picker, saying how many contacts it already has", () => {
    renderUsers(withContacts());
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add user" });
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "client_contact" } });
    const option = within(dialog).getByRole("option", { name: /Northstar Foods \(2 contact accounts\)/ });
    expect(option).toBeTruthy();
    // The primary switch cannot be used until a client is chosen.
    const box = within(dialog).getByRole("checkbox", { name: /primary contact for the linked client/i }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
  });

  it("saves a new contact as the primary, and sends the flag with the account", async () => {
    const db = withContacts();
    const dispatch = vi.fn(async () => ({ ok: true as const, message: "User created.", db }));
    renderUsers(db, { dispatch });

    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add user" });
    fireEvent.change(within(dialog).getByLabelText("Full name"), { target: { value: "Adwoa Boateng" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "adwoa@northstar.test" } });
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "client_contact" } });
    fireEvent.change(within(dialog).getByLabelText(/^Linked client/), { target: { value: client.id } });
    const box = within(dialog).getByRole("checkbox", { name: /primary contact for the linked client/i }) as HTMLInputElement;
    expect(box.disabled).toBe(false);
    fireEvent.click(box);
    fireEvent.change(within(dialog).getByLabelText(/Initial password/i), { target: { value: "correct horse battery" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save user" }));

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    const command = (dispatch as unknown as { mock: { calls: [Record<string, unknown>][] } }).mock.calls[0][0] as { type: string; input: Record<string, unknown> };
    expect(command.type).toBe("create_user");
    expect(command.input).toMatchObject({ role: "client_contact", clientId: client.id, primaryContact: true });
  });

  it("clears the primary flag when the role is changed away from a client contact", () => {
    renderUsers(withContacts());
    const rows = screen.getAllByRole("row");
    const yaw = rows.find((r) => r.textContent?.includes("yaw@northstar.test"))!;
    fireEvent.click(within(yaw).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: /Edit Yaw Mensah/ });
    expect((within(dialog).getByRole("checkbox", { name: /primary contact/i }) as HTMLInputElement).checked).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "operations" } });
    expect(within(dialog).queryByRole("checkbox", { name: /primary contact/i })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "client_contact" } });
    expect((within(dialog).getByRole("checkbox", { name: /primary contact/i }) as HTMLInputElement).checked).toBe(false);
  });
});
