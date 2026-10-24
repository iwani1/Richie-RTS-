// @vitest-environment jsdom
// The import panel end to end through the UI: paste a file, check it, read the row-level result,
// then import. Uses the same fake server as the rest of the jsdom suites, which executes the real
// command layer, so this is the import path and not a mock of it.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import App from "./App";
import { installFakeServer } from "./test/fakeServer";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(window, "scrollTo", { value: () => undefined, configurable: true });
  installFakeServer();
});
afterEach(cleanup);

const setField = (label: RegExp | string, value: string, scope: { getByLabelText: typeof screen.getByLabelText } = screen) => {
  fireEvent.change(scope.getByLabelText(label) as HTMLInputElement, { target: { value } });
};

async function setup() {
  render(<App />);
  await waitFor(() => expect(screen.queryByText(/Contacting the server/i)).toBeNull());
  setField(/Full name/i, "Admin");
  setField(/^Email/i, "admin@example.test");
  setField(/^Password/i, "correct-horse-battery");
  setField(/Confirm password/i, "correct-horse-battery");
  fireEvent.click(screen.getByRole("button", { name: /Create administrator/i }));
  await screen.findByRole("heading", { name: /Richie Transport Services/i });

  fireEvent.click(screen.getByRole("button", { name: /^Settings/i }));
  fireEvent.click(screen.getByRole("button", { name: /Add category/i }));
  setField(/Category 1/i, "Coaster");
  fireEvent.click(screen.getByRole("button", { name: /Save settings/i }));
  await screen.findByText(/Settings saved/i);
}

describe("CSV import (jsdom)", () => {
  it("previews a file, names the rejected row, and imports only the valid rows", async () => {
    await setup();

    fireEvent.click(screen.getByRole("button", { name: /^Vehicles/i }));
    fireEvent.click(screen.getByRole("button", { name: /Import CSV/i }));
    const dialog = await screen.findByRole("dialog");

    const csv = [
      "registration,category,make,model,seats,notes",
      "GT 700-26,Coaster,Toyota,Coaster,30,",
      "GT 701-26,Spaceship,Acme,Rocket,9,",
      "GT 702-26,Coaster,Toyota,Coaster,22,",
    ].join("\n");
    fireEvent.change(within(dialog).getByLabelText(/CSV contents/i), { target: { value: csv } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Check file/i }));

    // The summary distinguishes what will be created from what will not.
    await waitFor(() => expect(within(dialog).getByText(/2 ready · 1 rejected/)).toBeTruthy());
    expect(within(dialog).getByText(/not configured/i)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: /Import 2 rows/i }));
    await screen.findByText(/Imported 2 of 3 vehicles/);

    // The table now carries the two valid registrations and not the rejected one.
    await waitFor(() => expect(screen.getByText("GT 700-26")).toBeTruthy());
    expect(screen.getByText("GT 702-26")).toBeTruthy();
    expect(screen.queryByText("GT 701-26")).toBeNull();
  }, 30000);

  it("will not import until the file has been checked, and re-checks after an edit", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /^Vehicles/i }));
    fireEvent.click(screen.getByRole("button", { name: /Import CSV/i }));
    const dialog = await screen.findByRole("dialog");

    const textarea = within(dialog).getByLabelText(/CSV contents/i);
    fireEvent.change(textarea, { target: { value: "registration,category,seats\nGT 710-26,Coaster,30\n" } });
    const importButton = within(dialog).getByRole("button", { name: /^Import/ }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: /Check file/i }));
    await waitFor(() => expect((within(dialog).getByRole("button", { name: /Import 1 row/i }) as HTMLButtonElement).disabled).toBe(false));

    // Editing after the check invalidates the preview: the counts no longer describe the file.
    fireEvent.change(textarea, { target: { value: "registration,category,seats\nGT 711-26,Coaster,30\n" } });
    await waitFor(() => expect((within(dialog).getByRole("button", { name: /^Import/ }) as HTMLButtonElement).disabled).toBe(true));
  }, 30000);
});
