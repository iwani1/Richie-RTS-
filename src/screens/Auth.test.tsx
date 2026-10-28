// @vitest-environment jsdom
// The sign-in screen, and the one behaviour a person expects without being told: type an address,
// type a password, press Enter. jsdom does not perform a browser's implicit form submission, so this
// file proves the screen's own handler — which is the same code path an embedded webview needs.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInPage } from "./Auth";
import { TmsContext, type Tms } from "../tms/useTms";

afterEach(cleanup);

const makeTms = (signIn: Tms["signIn"]) =>
  ({
    signIn,
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
  }) as unknown as Tms;

const open = (signIn: Tms["signIn"]) =>
  render(
    <TmsContext.Provider value={makeTms(signIn)}>
      <SignInPage />
    </TmsContext.Provider>,
  );

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const fill = () => {
  type(/^Email/i, "ama@example.test");
  type(/^Password/i, "Demo-Ghana-2026");
};

const pressEnter = () => fireEvent.keyDown(screen.getByLabelText(/^Password/i), { key: "Enter" });

describe("signing in", () => {
  it("signs in when Enter is pressed in the password field", async () => {
    const signIn = vi.fn(async () => null);
    open(signIn);
    fill();

    await act(async () => {
      pressEnter();
    });

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(signIn).toHaveBeenCalledWith("ama@example.test", "Demo-Ghana-2026");
  });

  it("signs in when Enter is pressed in the email field, before the password is even reached", async () => {
    const signIn = vi.fn(async () => null);
    open(signIn);
    fill();

    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText(/^Email/i), { key: "Enter" });
    });

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
  });

  it("sends one attempt, however many times the key is pressed", () => {
    // A reply that never arrives, so every press after the first lands while one is in flight — the
    // case the disabled button caught and a key press would otherwise bypass. The presses are
    // dispatched one at a time because that is how a browser delivers them: a key press is a
    // discrete event, so React has re-rendered with the form busy before the next one arrives.
    const signIn = vi.fn(() => new Promise<null>(() => {}));
    open(signIn);
    fill();

    pressEnter();
    pressEnter();
    pressEnter();

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Checking/i })).toBeTruthy();
  });

  it("does nothing on Shift+Enter, which is a line break and not a command", async () => {
    const signIn = vi.fn(async () => null);
    open(signIn);
    fill();

    fireEvent.keyDown(screen.getByLabelText(/^Password/i), { key: "Enter", shiftKey: true });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("does not send a blank form: the empty field is named where it is", async () => {
    const signIn = vi.fn(async () => null);
    open(signIn);

    fireEvent.keyDown(screen.getByLabelText(/^Email/i), { key: "Enter" });
    // The browser's own validation answers, so nothing travels: jsdom reports the field as invalid
    // because the email input is `required` and empty.
    expect((screen.getByLabelText(/^Email/i) as HTMLInputElement).validity.valid).toBe(false);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("shows the refusal the server gave, and stays on the screen", async () => {
    const signIn = vi.fn(async () => "Incorrect email or password.");
    open(signIn);
    fill();

    await act(async () => {
      pressEnter();
    });

    expect(await screen.findByText("Incorrect email or password.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Sign in$/i })).toBeTruthy();
  });
});
