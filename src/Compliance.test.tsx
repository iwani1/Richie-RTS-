// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import App from "./App";
import { installFakeServer } from "./test/fakeServer";

let api: ReturnType<typeof installFakeServer>;
import { executeCommand, type AnyCommand } from "./tms/commands";
import { execute, type Actor } from "./tms/service";
import { emptyDatabase, emptyRentalSettings, type Database } from "./tms/types";

const NOW = "2026-06-01T06:00:00.000Z";
const fakeCred = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(window, "scrollTo", { value: () => undefined, configurable: true });
});
afterEach(cleanup);

function saved(): Database {
  return api.db();
}

// Seeds a signed-in administrator with one vehicle, one driver and no document types
// configured, so the test can exercise the "Not configured" gate before adding one.
function seed(): { vehicleId: string } {
  let db: Database = emptyDatabase();
  const setup = execute(db, null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential: fakeCred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  db = setup.db;
  const admin: Actor = { id: db.users[0].id, fullName: "Admin", role: "administrator" };

  const run = (command: AnyCommand) => {
    const r = executeCommand(db, admin, command, NOW);
    if (!r.ok) throw new Error(`${command.type}: ${r.message} ${JSON.stringify(r.errors)}`);
    db = r.db;
  };

  run({
    type: "update_settings",
    input: {
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      onTimeThresholdMinutes: 5,
      vehicleCategories: [{ id: "", name: "Coaster" }],
      shifts: [],
      rental: emptyRentalSettings(),
      documentTypes: [],
      documentReminderLeadDays: null,
      taxPosition: null,
      taxLines: [],
      invoiceDueDays: null,
      workTypes: ["Service", "Repair", "Tyres", "Bodywork", "Inspection", "Other"],
      costCategories: ["Parts", "Labour", "Tyres"],
      maintenance: { schedules: [], blockOnOverdueService: false },
    },
  });
  const categoryId = db.settings.vehicleCategories[0].id;
  run({ type: "create_vehicle", input: { registration: "GT 900-26", categoryId, make: "", model: "", seatCapacity: "30", notes: "" } });

  api = installFakeServer(db, admin.id);
  return { vehicleId: db.vehicles[0].id };
}

/** Renders the app and waits for the initial /api/session round trip to settle. */
async function renderApp() {
  const view = render(<App />);
  await waitFor(() => expect(screen.queryByText(/Contacting the server/i)).toBeNull());
  return view;
}

describe("Compliance documents end-to-end (jsdom)", () => {
  it("blocks recording until a document type is configured, then records and edits a document", async () => {
    seed();
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /^Compliance/i }));
    expect(await screen.findByText(/No document types exist yet/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Record a document/i }) as HTMLButtonElement).disabled).toBe(true);

    // Configure a document type from Settings.
    fireEvent.click(screen.getByRole("button", { name: /^Settings/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add document type/i }));
    const typeInputs = screen.getAllByPlaceholderText(/Insurance, Roadworthy certificate/i);
    fireEvent.change(typeInputs[typeInputs.length - 1], { target: { value: "Insurance" } });
    fireEvent.change(screen.getByLabelText(/Reminder lead time/i), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: /Save settings/i }));
    await screen.findByText(/Settings saved/i);

    // Back on Compliance, the block is gone and a document can be recorded.
    fireEvent.click(screen.getByRole("button", { name: /^Compliance/i }));
    expect(screen.queryByText(/No document types exist yet/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Record a document/i }));
    const dialog = screen.getByRole("dialog");
    // Select the vehicle by its visible registration option.
    const ownerSelect = within(dialog).getByLabelText(/^Vehicle$/i) as HTMLSelectElement;
    fireEvent.change(ownerSelect, { target: { value: Array.from(ownerSelect.options).find((o) => o.text === "GT 900-26")!.value } });
    fireEvent.change(within(dialog).getByLabelText(/Document type/i), { target: { value: Array.from((within(dialog).getByLabelText(/Document type/i) as HTMLSelectElement).options).find((o) => o.text === "Insurance")!.value } });
    fireEvent.change(within(dialog).getByLabelText(/Expiry date/i), { target: { value: "2026-06-10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Record document/i }));
    await screen.findByText(/recorded\./i);

    // With a 14-day lead time and today fixed by the system clock at seed time being
    // in the past relative to 2026-06-10, the document should show as expiring soon
    // once enough days have passed; here we assert the record exists and is editable.
    expect(await screen.findByText("Insurance")).toBeTruthy();
    expect(screen.getByText("GT 900-26")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/i }));
    const editDialog = screen.getByRole("dialog");
    fireEvent.change(within(editDialog).getByLabelText(/Expiry date/i), { target: { value: "2030-01-01" } });
    fireEvent.click(within(editDialog).getByRole("button", { name: /Save changes/i }));
    await screen.findByText(/Document updated/i);

    const db = saved();
    expect(db.documents).toHaveLength(1);
    expect(db.documents[0].expiryDate).toBe("2030-01-01");
  }, 30000);

  it("flags an already-expired document even with no reminder lead time set", async () => {
    const { vehicleId } = seed();
    await renderApp();

    // Configure a document type with no lead time.
    fireEvent.click(screen.getByRole("button", { name: /^Settings/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add document type/i }));
    const typeInputs = screen.getAllByPlaceholderText(/Insurance, Roadworthy certificate/i);
    fireEvent.change(typeInputs[typeInputs.length - 1], { target: { value: "Roadworthy" } });
    fireEvent.click(screen.getByRole("button", { name: /Save settings/i }));
    await screen.findByText(/Settings saved/i);

    fireEvent.click(screen.getByRole("button", { name: /^Compliance/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Record a document/i }));
    const dialog = screen.getByRole("dialog");
    const ownerSelect = within(dialog).getByLabelText(/^Vehicle$/i) as HTMLSelectElement;
    fireEvent.change(ownerSelect, { target: { value: vehicleId } });
    const typeSelect = within(dialog).getByLabelText(/Document type/i) as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: Array.from(typeSelect.options).find((o) => o.text === "Roadworthy")!.value } });
    fireEvent.change(within(dialog).getByLabelText(/Expiry date/i), { target: { value: "2020-01-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Record document/i }));
    await screen.findByText(/recorded\./i);

    // Scope to the document's table row: "Expired" also appears as a stat label.
    const docRow = (await screen.findByText("Roadworthy")).closest("tr") as HTMLElement;
    expect(within(docRow).getByText("Expired")).toBeTruthy();
    expect(screen.getByText(/No reminder lead time is set/i)).toBeTruthy();
  }, 30000);
});
