// @vitest-environment jsdom
// The audit log had no test of its own. It is the screen an owner is shown when they ask "who changed
// this?", so the two things that could quietly lie — the window that is drawn and the count that is
// printed beside it — are pinned here.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditPage } from "./Audit";
import { TmsContext, type Tms } from "../tms/useTms";
import { emptyDatabase, type AuditEntry, type Database } from "../tms/types";

afterEach(cleanup);

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "a1",
    at: "2026-10-01T09:15:00.000Z",
    actorId: "u1",
    actorName: "Ama Mensah",
    action: "rental.create",
    entity: "rental",
    entityId: "r1",
    summary: "Rental created for Northstar Foods",
    ...overrides,
  };
}

function makeTms(db: Database, overrides: Partial<Tms> = {}): Tms {
  return {
    db,
    actor: { id: "u1", fullName: "Ama Mensah", role: "administrator" },
    currentUser: null,
    status: "ready",
    busy: false,
    connectionError: null,
    auditTotal: db.audit.length,
    setupRequired: false,
    flash: null,
    setFlash: () => {},
    allowed: () => true,
    dispatch: vi.fn(async () => ({ ok: true, message: "" })),
    attachReceipt: vi.fn(async () => ({ ok: true, message: "" })),
    attachVehiclePhoto: vi.fn(async () => ({ ok: true, message: "" })),
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
    ...overrides,
  } as Tms;
}

const renderAudit = (audit: AuditEntry[], overrides: Partial<Tms> = {}) =>
  render(
    <TmsContext.Provider value={makeTms({ ...emptyDatabase(), audit }, overrides)}>
      <AuditPage />
    </TmsContext.Provider>,
  );

const threeEntries = [
  entry({ id: "a1", at: "2026-10-03T08:00:00.000Z", actorName: "Ama Mensah", action: "invoice.issue", entity: "invoice", summary: "Invoice INV-0007 issued" }),
  entry({ id: "a2", at: "2026-10-02T08:00:00.000Z", actorName: "Kofi Boateng", action: "trip.dispatch", entity: "trip", summary: "Trip TRP-0003 dispatched" }),
  entry({ id: "a3", at: "2026-10-01T08:00:00.000Z", actorName: "Ama Mensah", action: "rental.create", entity: "rental", summary: "Rental requested by Northstar Foods" }),
];

describe("audit log", () => {
  it("lists every entry with its actor, its command and its record, and says how much it is showing", () => {
    renderAudit(threeEntries);

    const table = screen.getByRole("table", { name: /Audit log: when, who/ });
    // Newest first, which is the order the service appends them in.
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("invoice.issue")).toBeTruthy();
    expect(within(rows[0]).getByText("Ama Mensah")).toBeTruthy();
    expect(within(rows[2]).getByText("Rental requested by Northstar Foods")).toBeTruthy();

    // Both counts are printed: what the database holds and what is on screen.
    expect(screen.getByRole("status").textContent).toContain("3 recorded · append-only");
    expect(screen.getByText(/Showing 3 of 3 matching entries/)).toBeTruthy();
  });

  it("narrows by the search box and by the record it belongs to, and says what it did", () => {
    renderAudit(threeEntries);

    fireEvent.change(screen.getByLabelText("Search audit log"), { target: { value: "kofi" } });
    expect(screen.getByRole("table", { name: /Audit log/ }).querySelectorAll("tbody tr")).toHaveLength(1);
    expect(screen.getByText(/Showing 1 of 1 matching entry/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search audit log"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter by entity"), { target: { value: "invoice" } });
    const rows = screen.getByRole("table", { name: /Audit log/ }).querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("invoice.issue");
  });

  it("says nothing matches rather than showing an empty table when a filter finds nothing", () => {
    renderAudit(threeEntries);
    fireEvent.change(screen.getByLabelText("Search audit log"), { target: { value: "nothing like this" } });

    expect(screen.getByText("Nothing matches that")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/Showing 0 of 0 matching entries/)).toBeTruthy();
  });

  it("draws five hundred of the matches and admits it is a window, not the whole log", () => {
    const many = Array.from({ length: 505 }, (_, index) =>
      entry({
        id: `a${index}`,
        at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        actorName: "Ama Mensah",
        action: `command.${index}`,
        entity: "rental",
        summary: `Change number ${index}`,
      }),
    );
    renderAudit(many);

    expect(screen.getByRole("table", { name: /Audit log/ }).querySelectorAll("tbody tr")).toHaveLength(500);
    expect(screen.getByText(/Showing 500 of 505 matching entries — narrow the search to see earlier ones/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("505 recorded");
  });

  it("sorts every match before taking the window, so oldest first really is the oldest", () => {
    const many = Array.from({ length: 505 }, (_, index) =>
      entry({
        id: `a${index}`,
        at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        actorName: "Ama Mensah",
        action: `command.${index}`,
        entity: "rental",
        summary: `Change number ${index}`,
      }),
    );
    renderAudit(many);

    const when = screen.getByRole("button", { name: /When/i });
    fireEvent.click(when); // ascending
    const first = screen.getByRole("table", { name: /Audit log/ }).querySelector("tbody tr");
    expect(first?.textContent).toContain("command.0");
  });

  it("reloads through the service rather than pretending to", async () => {
    const refresh = vi.fn(async () => {});
    renderAudit(threeEntries, { refresh });

    fireEvent.click(screen.getByRole("button", { name: /Reload/ }));
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("counts what the snapshot holds separately from what the database holds", () => {
    renderAudit(threeEntries.slice(0, 1), { auditTotal: 1204 });

    expect(within(screen.getByLabelText("What this log covers")).getByText(/1[.,]?204/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/1[.,]?204 recorded · append-only/);
    expect(screen.getByText(/1 in this snapshot/)).toBeTruthy();
  });
});
