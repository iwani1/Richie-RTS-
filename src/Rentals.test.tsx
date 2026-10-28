// @vitest-environment jsdom
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
  // This suite starts at first run and creates the administrator through the UI.
  installFakeServer();
});
afterEach(cleanup);

const setField = (label: RegExp | string, value: string, scope: { getByLabelText: typeof screen.getByLabelText } = screen) => {
  fireEvent.change(scope.getByLabelText(label) as HTMLInputElement, { target: { value } });
};

async function setup() {
  await renderApp();
  setField(/Full name/i, "Admin");
  setField(/^Email/i, "admin@example.test");
  setField(/^Password/i, "correct-horse-battery");
  setField(/Confirm password/i, "correct-horse-battery");
  fireEvent.click(screen.getByRole("button", { name: /Create administrator/i }));
  await screen.findByRole("heading", { name: /Richie Transport Services/i });
}

/** Renders the app and waits for the initial /api/session round trip to settle. */
async function renderApp() {
  const view = render(<App />);
  await waitFor(() => expect(screen.queryByText(/Contacting the server/i)).toBeNull());
  return view;
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
    // RNT-04, D-117: validity is in hours (168 = one week) and the terms are the company's own words.
    setField(/Quotation validity \(hours\)/i, "168");
    setField(/Quotation terms/i, "Prices are firm for the validity period.");
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
    // Dates are relative to the day the test runs: the server refuses to start a hire before its
    // booked date, so a fixed past date would be testing the guard rather than the happy path.
    const dayFromNow = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    setField(/Start date/i, dayFromNow(0), within(dialog));
    setField(/End date/i, dayFromNow(2), within(dialog));
    setField(/Passengers/i, "25", within(dialog));
    // The journey the customer asked for (RNT-01, D-119): the desk writes down what it was told.
    setField(/^Departure time/i, "08:00", within(dialog));
    setField(/^Return time/i, "17:30", within(dialog));
    setField(/Stops on the way/i, "Achimota\nNsawam", within(dialog));
    setField(/^Luggage/i, "Twelve suitcases", within(dialog));
    setField(/Special needs/i, "One wheelchair", within(dialog));
    setField(/Who to ring on the day/i, "Ama Mensah", within(dialog));
    setField(/Their phone/i, "024 000 0000", within(dialog));
    fireEvent.change(within(dialog).getByLabelText(/How did this request arrive/i), { target: { value: "phone" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save request/i }));

    // The request goes through the office's own stages before it is priced (RNT-02, D-120). Each
    // button names the next step, and the strip on the record follows without anybody reloading.
    fireEvent.click(await screen.findByRole("button", { name: /Take this request on/i }));
    await screen.findByText(/is now submitted/i);
    fireEvent.click(await screen.findByRole("button", { name: /Start the review/i }));
    await screen.findByText(/is now under review/i);
    fireEvent.click(await screen.findByRole("button", { name: /Ready to be priced/i }));
    await screen.findByText(/is now awaiting quotation/i);

    // Detail view opens on RR-0001, and the journey is on it rather than only in the desk's head.
    await screen.findByText(/Rental RR-0001/i);
    expect(screen.getByText(/Leaves at 08:00/)).toBeTruthy();
    expect(screen.getByText(/and back at 17:30/)).toBeTruthy();
    expect(screen.getByText("Calls at Achimota, then Nsawam.")).toBeTruthy();
    expect(screen.getByText("Twelve suitcases")).toBeTruthy();
    expect(screen.getByText("One wheelchair")).toBeTruthy();
    expect(screen.getByText("On the day, ring Ama Mensah on 024 000 0000.")).toBeTruthy();
    expect(screen.getByText("Phone call")).toBeTruthy();

    // Issue a quotation.
    fireEvent.click(screen.getByRole("button", { name: /Issue quotation/i }));
    dialog = screen.getByRole("dialog");
    setField(/Line 1 description/i, "3 days hire", within(dialog));
    setField(/^Qty/i, "3", within(dialog));
    setField(/Unit amount/i, "1000", within(dialog));
    // A reduction with its reason (RNT-04, D-121). The form shows the total the customer will read.
    setField(/Discount \(optional\)/i, "100", within(dialog));
    setField(/Reason for the discount/i, "Repeat customer", within(dialog));
    await waitFor(() => expect(within(dialog).getByText(/GHS 2,900\.00/)).toBeTruthy());
    fireEvent.click(within(dialog).getByRole("button", { name: /Issue quotation/i }));
    await screen.findByText(/Quotation issued/i);
    // The document carries the reduction, the total and the deposit taken from that total.
    await waitFor(() => expect(screen.getByText(/Less discount: Repeat customer/i)).toBeTruthy());
    expect(screen.getByText(/Deposit \(25%\)/i)).toBeTruthy();
    // No threshold is set, and the screen says so rather than implying a second signature exists.
    // Nobody has asked for a signature on the charge, and the screen says exactly that.
    expect(screen.getAllByText(/No approval is required: the company has not set a figure that needs one/i).length).toBeGreaterThanOrEqual(1);

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

    // Start then complete, recording the journey as well as the charges (RNT-07, D-118).
    fireEvent.click(screen.getByRole("button", { name: /Dispatch vehicle/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Complete & bill/i }));
    dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Odometer at departure/i), { target: { value: "48000" } });
    fireEvent.change(within(dialog).getByLabelText(/Odometer at return/i), { target: { value: "48180" } });
    fireEvent.change(within(dialog).getByLabelText(/Damage or anything wrong/i), { target: { value: "Rear tyre worn." } });
    // A charge added after the quotation went out (RNT-07, D-123): what it was, and the reason the
    // customer will read on their invoice.
    fireEvent.change(within(dialog).getByLabelText(/^Charge 1$/i), { target: { value: "Damaged seat cover" } });
    fireEvent.change(within(dialog).getByLabelText(/Amount each/i), { target: { value: "250" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason the customer was given/i), { target: { value: "Seat cover torn on return" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Complete rental/i }));
    await screen.findByText(/completed\./i);
    expect(screen.getByText(/Final invoice/i)).toBeTruthy();
    // What happened is on the record, in the office's own reading of the facts.
    expect(screen.getByText(/What happened/i)).toBeTruthy();
    expect(screen.getByText(/180 km \(from the odometer\)/)).toBeTruthy();
    expect(screen.getByText(/Rear tyre worn\./)).toBeTruthy();
    // And the money: no invoice has been raised yet, which is not the same as nothing owed.
    expect(screen.getByText(/No invoice has been raised for this hire yet/i)).toBeTruthy();
    // The charge is on the record with its reason, and the screen says nobody has asked for a
    // signature on it because the company has not set a figure.
    expect(screen.getByText(/Reason given: Seat cover torn on return/i)).toBeTruthy();
    expect(screen.getAllByText(/No approval is required: the company has not set a figure that needs one/i).length).toBeGreaterThanOrEqual(1);
  }, 30000);
});
