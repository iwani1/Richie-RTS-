// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import App from "./App";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(window, "scrollTo", { value: () => undefined, configurable: true });
});
afterEach(cleanup);

const setField = (label: RegExp | string, value: string, scope: { getByLabelText: typeof screen.getByLabelText } = screen) => {
  fireEvent.change(scope.getByLabelText(label) as HTMLInputElement, { target: { value } });
};

async function setup() {
  render(<App />);
  setField(/Full name/i, "Admin");
  setField(/^Email/i, "admin@example.test");
  setField(/^Password/i, "correct-horse-battery");
  setField(/Confirm password/i, "correct-horse-battery");
  fireEvent.click(screen.getByRole("button", { name: /Create administrator/i }));
  await screen.findByRole("heading", { name: /Richie Transport Services/i });
}

describe("Bus rentals end-to-end (jsdom)", () => {
  it("configures settings, then quotes, confirms, assigns, starts and completes a rental", async () => {
    await setup();

    // Configure vehicle category + rental settings + currency.
    fireEvent.click(screen.getByRole("button", { name: /^Settings/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add category/i }));
    setField(/Category 1/i, "Coaster");
    setField(/Company name/i, "Richie Transport Services");
    setField(/Billing currency/i, "GHS");
    fireEvent.change(screen.getByLabelText(/Pricing basis/i), { target: { value: "per_day" } });
    setField(/Deposit \(% of quotation\)/i, "25");
    setField(/Quotation validity/i, "7");
    fireEvent.click(screen.getByRole("button", { name: /Add method/i }));
    // the payment method input has no label; set by placeholder
    const methodInput = screen.getByPlaceholderText(/Bank transfer, Mobile money/i) as HTMLInputElement;
    fireEvent.change(methodInput, { target: { value: "Bank transfer" } });
    fireEvent.click(screen.getByRole("button", { name: /Save settings/i }));
    await screen.findByText(/Settings saved/i);

    // Add a vehicle in the Coaster category.
    fireEvent.click(screen.getByRole("button", { name: /^Vehicles/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add vehicle/i }));
    let dialog = screen.getByRole("dialog");
    setField(/Registration/i, "GT 500-26", within(dialog));
    fireEvent.change(within(dialog).getByLabelText(/Category/i), { target: { value: (within(dialog).getAllByRole("option")[1] as HTMLOptionElement).value } });
    setField(/Seat capacity/i, "30", within(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: /Save vehicle/i }));
    await waitFor(() => expect(screen.getByText("GT 500-26")).toBeTruthy());

    // Create a rental request.
    fireEvent.click(screen.getByRole("button", { name: /Bus rentals/i }));
    fireEvent.click(screen.getByRole("button", { name: /New request/i }));
    dialog = screen.getByRole("dialog");
    setField(/Customer \/ organisation name/i, "Acme Ltd", within(dialog));
    fireEvent.change(within(dialog).getByLabelText(/Vehicle category/i), { target: { value: (within(dialog).getAllByRole("option").find((o) => (o as HTMLOptionElement).text === "Coaster") as HTMLOptionElement).value } });
    setField(/Start date/i, "2026-05-01", within(dialog));
    setField(/End date/i, "2026-05-03", within(dialog));
    setField(/Passengers/i, "25", within(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: /Save request/i }));

    // Detail view opens on RR-0001.
    await screen.findByText(/Rental RR-0001/i);

    // Issue a quotation.
    fireEvent.click(screen.getByRole("button", { name: /Issue quotation/i }));
    dialog = screen.getByRole("dialog");
    setField(/Line 1 description/i, "3 days hire", within(dialog));
    setField(/^Qty/i, "3", within(dialog));
    setField(/Unit amount/i, "1000", within(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: /Issue quotation/i }));
    await screen.findByText(/Quotation issued/i);
    // deposit 25% of 3000 = 750
    await waitFor(() => expect(screen.getByText(/Deposit \(25%\)/i)).toBeTruthy());

    // Confirm with deposit.
    fireEvent.click(screen.getByRole("button", { name: /Record deposit & confirm/i }));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm booking/i }));
    await screen.findByText(/confirmed\./i);

    // Assign vehicle.
    fireEvent.click(screen.getByRole("button", { name: /Assign resources/i }));
    dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Vehicle/i), { target: { value: (within(dialog).getAllByRole("option")[1] as HTMLOptionElement).value } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save assignment/i }));
    await screen.findByText(/Resources assigned/i);

    // Start then complete.
    fireEvent.click(screen.getByRole("button", { name: /Start trip/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Complete & bill/i }));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Complete rental/i }));
    await screen.findByText(/completed\./i);
    expect(screen.getByText(/Final invoice/i)).toBeTruthy();
  }, 30000);
});
