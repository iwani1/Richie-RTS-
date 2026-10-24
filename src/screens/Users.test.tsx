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
