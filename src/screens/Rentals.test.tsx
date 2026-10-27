// @vitest-environment jsdom
// Copying a rental reference from the request itself (D-111). The office quotes this number on the
// phone and in a message to the customer, so the test checks the button exists on the open request and
// that it hands over exactly the reference on screen — not a shortened or prettified version.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RentalsPage } from "./Rentals";
import { TmsContext, type Tms } from "../tms/useTms";
import type { CommandResult } from "../tms/service";
import { emptyDatabase, type Database, type Rental, type User } from "../tms/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
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

const rental: Rental = {
  id: "r1",
  reference: "RR-0007",
  clientId: null,
  customerName: "Acme Ltd",
  customerPhone: "",
  customerEmail: "",
  purpose: "Staff outing",
  pickupLocation: "Accra",
  dropoffLocation: "Aburi",
  startDate: "2026-06-10",
  endDate: "2026-06-11",
  passengers: 20,
  vehicleCategoryId: "c1",
  driverRequired: true,
  notes: "",
  status: "draft",
  quote: null,
  quoteHistory: [],
  acceptance: null,
  assignedVehicleId: null,
  assignedDriverId: null,
  deposit: null,
  finalInvoice: null,
  resolutionReason: null,
  createdAt: at,
  updatedAt: at,
};

function base(): Database {
  const db = emptyDatabase();
  return {
    ...db,
    users: [admin],
    rentals: [rental],
    settings: { ...db.settings, vehicleCategories: [{ id: "c1", name: "Coach", licenceClasses: [] }] },
  };
}

function renderRentals() {
  const tms = {
    db: base(),
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

  render(
    <TmsContext.Provider value={tms}>
      <RentalsPage navigate={() => {}} />
    </TmsContext.Provider>,
  );
}

describe("copying a rental reference (D-111)", () => {
  it("offers the reference from the open request and puts it on the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderRentals();

    fireEvent.click(screen.getByRole("button", { name: /^Open$/ }));
    const copy = screen.getByRole("button", { name: "Copy rental reference RR-0007" });

    await act(async () => {
      fireEvent.click(copy);
    });

    expect(writeText).toHaveBeenCalledWith("RR-0007");
    // The screen already has a role="status" filter note, so the confirmation is read from the
    // button's own live region rather than the first status on the page.
    const wrapper = screen.getByRole("button", { name: /^Copy rental reference/ }).closest(".rts-copy") as HTMLElement;
    expect(within(wrapper).getByRole("status").textContent).toBe("Rental reference RR-0007 copied.");
  });
});
