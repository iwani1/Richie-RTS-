// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import App from "./App";
import { installFakeServer } from "./test/fakeServer";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(window, "scrollTo", { value: () => undefined, configurable: true });
  // A fresh, empty server per test: the app's first request is /api/session, which reports
  // setupRequired on an installation with no accounts.
  installFakeServer();
});
afterEach(cleanup);

const type = (label: RegExp | string, value: string, container: HTMLElement | typeof screen = screen) => {
  const el = (container as typeof screen).getByLabelText(label) as HTMLInputElement;
  fireEvent.change(el, { target: { value } });
};

describe("Richie TMS end-to-end (jsdom)", () => {
  it("runs first-time setup, persists data, enforces blocking settings and records audit entries", async () => {
    const { unmount } = render(<App />);

    // 1. First run: administrator setup, no accounts exist.
    expect(await screen.findByText(/Create the first administrator/i)).toBeTruthy();
    type(/Full name/i, "Ama Mensah");
    type(/^Email/i, "ama@example.test");
    type(/^Password/i, "correct-horse-battery");
    type(/Confirm password/i, "correct-horse-battery");
    fireEvent.click(screen.getByRole("button", { name: /Create administrator/i }));

    await waitFor(() => expect(screen.getByRole("heading", { name: /Richie Transport Services/i })).toBeTruthy());
    expect(screen.getAllByText(/Not set/).length).toBeGreaterThan(0);

    // 2. Vehicles are blocked until categories exist.
    fireEvent.click(screen.getByRole("button", { name: /^Vehicles/i }));
    expect(screen.getByText(/Vehicle registration is blocked/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Add vehicle/i }) as HTMLButtonElement).disabled).toBe(true);

    // 3. Configure a category in Settings.
    fireEvent.click(screen.getByRole("button", { name: /^Settings/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add category/i }));
    type(/Category 1/i, "Minibus");
    type(/Company name/i, "Richie Transport Services");
    fireEvent.click(screen.getByRole("button", { name: /Save settings/i }));
    await waitFor(() => expect(screen.getByText(/Settings saved/i)).toBeTruthy());

    // 4. Register a vehicle and change its status.
    fireEvent.click(screen.getByRole("button", { name: /^Vehicles/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add vehicle/i }));
    const dialog = screen.getByRole("dialog");
    type(/Registration/i, "GT 1234-26", within(dialog) as never);
    fireEvent.change(within(dialog).getByLabelText(/Category/i), { target: { value: (within(dialog).getAllByRole("option")[1] as HTMLOptionElement).value } });
    type(/Seat capacity/i, "14", within(dialog) as never);
    fireEvent.click(within(dialog).getByRole("button", { name: /Save vehicle/i }));
    await waitFor(() => expect(screen.getByText("GT 1234-26")).toBeTruthy());
    expect(within(screen.getByRole("table")).getByText("Available")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Change status/i }));
    const t = screen.getByRole("dialog");
    fireEvent.click(within(t).getByRole("button", { name: /Apply/i }));
    expect(await within(t).findByText(/Give a short reason/i)).toBeTruthy();
    type(/Reason/i, "Scheduled service", within(t) as never);
    fireEvent.click(within(t).getByRole("button", { name: /Apply/i }));
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Under maintenance")).toBeTruthy());

    // 5. Audit log has the entries.
    fireEvent.click(screen.getByRole("button", { name: /Audit log/i }));
    expect(screen.getByText(/vehicles:transition/)).toBeTruthy();
    expect(screen.getByText(/users:setup/)).toBeTruthy();

    // 6. Sign out, reload the app, and sign back in: the data lives on the server, so it survives
    //    a fresh browser session and a full remount.
    fireEvent.click(screen.getByRole("button", { name: /Sign out/i }));
    expect(await screen.findByRole("heading", { name: /^Sign in$/i })).toBeTruthy();
    unmount();

    await act(async () => {
      render(<App />);
    });
    expect(await screen.findByRole("heading", { name: /^Sign in$/i })).toBeTruthy();
    type(/^Email/i, "ama@example.test");
    type(/^Password/i, "wrong-password-here");
    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/i }));
    expect(await screen.findByText(/Incorrect email or password/i)).toBeTruthy();
    type(/^Password/i, "correct-horse-battery");
    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Richie Transport Services/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Vehicles/i }));
    expect(screen.getByText("GT 1234-26")).toBeTruthy();
  }, 20000);
});
