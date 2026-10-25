// @vitest-environment jsdom
// Document types are the company's own list, and one switch on that list changes whether a vehicle
// or driver can be sent out at all. That switch had no test of its own before it existed (Q-16).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./Settings";
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
  primaryContact: false,
  passwordHash: "",
  passwordSalt: "",
  createdAt: at,
  updatedAt: at,
};

function settingsDb(required: boolean): Database {
  const db = emptyDatabase();
  return {
    ...db,
    users: [admin],
    settings: {
      ...db.settings,
      documentTypes: [
        { id: "dt-insurance", name: "Insurance", appliesTo: "vehicle", required },
        { id: "dt-licence", name: "Driving licence", appliesTo: "driver", required: false },
      ],
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
    setFlash: () => {},
    allowed: () => true,
    // The screen reloads the saved settings after a successful save, so a plain success is enough.
    dispatch: vi.fn(async (command: { type: string }) => ({ ok: true, message: "Settings saved.", db, command })),
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
  } as unknown as Tms;
}

const renderSettings = (db: Database) =>
  render(
    <TmsContext.Provider value={makeTms(db)}>
      <SettingsPage />
    </TmsContext.Provider>,
  );

const save = () => fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

describe("the before-assignment switch on a document type", () => {
  it("shows which papers already block an assignment", () => {
    renderSettings(settingsDb(true));
    const boxes = screen.getAllByRole("checkbox", { name: /must be current to assign/i });
    expect(boxes).toHaveLength(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
  });

  it("saves the switch when it is ticked, leaving the other type alone", async () => {
    const db = settingsDb(false);
    const tms = makeTms(db);
    render(
      <TmsContext.Provider value={tms}>
        <SettingsPage />
      </TmsContext.Provider>,
    );

    fireEvent.click(screen.getAllByRole("checkbox", { name: /must be current to assign/i })[0]);
    fireEvent.change(screen.getAllByRole("textbox", { name: /document type 2/i })[0], { target: { value: "Driving licence" } });
    save();

    await vi.waitFor(() => expect(tms.dispatch).toHaveBeenCalled());
    const command = (tms.dispatch as unknown as { mock: { calls: [{ type: string; input: { documentTypes: unknown[] } }][] } }).mock.calls[0][0];
    expect(command.type).toBe("update_settings");
    expect(command.input.documentTypes).toEqual([
      { id: "dt-insurance", name: "Insurance", appliesTo: "vehicle", required: true },
      { id: "dt-licence", name: "Driving licence", appliesTo: "driver", required: false },
    ]);
  });

  it("adds a new type that does not block anything until the company says so", async () => {
    const db = { ...settingsDb(false), settings: { ...settingsDb(false).settings, documentTypes: [] } };
    const tms = makeTms(db);
    render(
      <TmsContext.Provider value={tms}>
        <SettingsPage />
      </TmsContext.Provider>,
    );

    // With no types at all the list says why nothing can be recorded yet.
    expect(screen.getByText(/no document types configured/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /add document type/i }));
    const box = screen.getByRole("checkbox", { name: /must be current to assign/i }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: /document type 1/i }), { target: { value: "Roadworthy certificate" } });
    save();

    await vi.waitFor(() => expect(tms.dispatch).toHaveBeenCalled());
    const command = (tms.dispatch as unknown as { mock: { calls: [{ input: { documentTypes: unknown[] } }][] } }).mock.calls[0][0];
    expect(command.input.documentTypes).toEqual([
      { id: "", name: "Roadworthy certificate", appliesTo: "vehicle", required: false },
    ]);
  });
});

describe("the lists the company keeps itself", () => {
  it("shows the approved work types and adds another to the saved settings", async () => {
    const db = settingsDb(false);
    const tms = makeTms(db);
    render(
      <TmsContext.Provider value={tms}>
        <SettingsPage />
      </TmsContext.Provider>,
    );

    // The six approved types are offered, not invented per screen.
    expect((screen.getByLabelText("Work type 1") as HTMLInputElement).value).toBe("Service");
    fireEvent.click(screen.getByRole("button", { name: "Add work type" }));
    fireEvent.change(screen.getByLabelText("Work type 7"), { target: { value: "Electrical" } });
    save();

    await vi.waitFor(() => expect(tms.dispatch).toHaveBeenCalled());
    const command = (tms.dispatch as unknown as { mock: { calls: [{ type: string; input: { workTypes: string[] } }][] } }).mock.calls[0][0];
    expect(command.type).toBe("update_settings");
    expect(command.input.workTypes).toEqual(["Service", "Repair", "Tyres", "Bodywork", "Inspection", "Other", "Electrical"]);
  });

  it("starts with no cost categories and says what that means", () => {
    renderSettings(settingsDb(false));
    expect(screen.getByText(/No cost categories configured/i)).toBeTruthy();
    // The work-type band, by contrast, already holds the agreed six.
    expect(screen.getByLabelText("Work type 6")).toHaveProperty("value", "Other");
  });
});
