// @vitest-environment jsdom
// AUTH-05 screen: the account's own details, its password, and its sign-in history.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfilePage } from "./Profile";
import { TmsContext, type Tms } from "../tms/useTms";
import { emptyDatabase, type Database, type User } from "../tms/types";

const at = "2026-06-01T09:00:00.000Z";

const user: User = {
  id: "u1",
  fullName: "Ama Mensah",
  email: "ama@example.test",
  role: "operations",
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

const db: Database = { ...emptyDatabase(), users: [user] };

function makeTms(overrides: Partial<Tms> = {}): Tms {
  return {
    db,
    actor: { id: user.id, fullName: user.fullName, role: user.role },
    currentUser: user,
    status: "ready",
    connectionError: null,
    auditTotal: 0,
    setupRequired: false,
    flash: null,
    busy: false,
    setFlash: () => {},
    allowed: () => true,
    dispatch: vi.fn(async () => ({ ok: true, message: "" }) as never),
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
    ...overrides,
  } as unknown as Tms;
}

const renderProfile = (overrides: Partial<Tms> = {}) => {
  const tms = makeTms(overrides);
  render(
    <TmsContext.Provider value={tms}>
      <ProfilePage />
    </TmsContext.Provider>,
  );
  return tms;
};

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method !== "POST") {
        return jsonResponse({ ok: true, user, signIns: [{ at: "2026-06-02T08:15:00.000Z" }, { at: "2026-06-01T07:00:00.000Z" }] });
      }
      return jsonResponse({ ok: true, message: "Saved." });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("profile screen", () => {
  it("shows the last sign-ins and says that the address is not recorded", async () => {
    renderProfile();
    await waitFor(() => expect(screen.getByText(/most recent/)).toBeTruthy());
    // No address is stored, and with one account the screen says so plainly instead of implying
    // that a sign-in can be traced.
    expect(screen.getByText(/Only account on this installation/)).toBeTruthy();
  });

  it("saves the account's own name and email, then refreshes the shell", async () => {
    const tms = renderProfile();
    const name = screen.getByLabelText("Full name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Ama Mensah-Owusu" } });
    fireEvent.click(screen.getByRole("button", { name: /Save details/i }));

    await waitFor(() => expect(tms.refresh).toHaveBeenCalled());
    const post = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "POST");
    expect(post).toBeTruthy();
    expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({
      action: "details",
      fullName: "Ama Mensah-Owusu",
      email: "ama@example.test",
    });
  });

  it("refuses to send a password change when the two new passwords differ", async () => {
    renderProfile();
    fireEvent.change(screen.getByLabelText(/Current password/), { target: { value: "old-password-1" } });
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "new-password-1" } });
    fireEvent.change(screen.getByLabelText(/Repeat the new password/), { target: { value: "new-password-2" } });
    fireEvent.click(screen.getByRole("button", { name: /Change password/i }));

    await waitFor(() => expect(screen.getByText(/do not match/)).toBeTruthy());
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(calls).toHaveLength(0);
  });
});
