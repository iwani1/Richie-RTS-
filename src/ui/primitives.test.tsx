// @vitest-environment jsdom
// The reveal control on a password field. It exists so a mistyped password is visible before it is
// submitted: this application has no self-service reset, so a failed sign-in costs the operator an
// administrator's time.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Field, PasswordInput } from "./primitives";

afterEach(cleanup);

const renderField = () =>
  render(
    <Field label="Password">
      <PasswordInput defaultValue="correct-horse" />
    </Field>,
  );

describe("password reveal", () => {
  it("starts masked, and the control is named for what it does", () => {
    renderField();
    const field = screen.getByLabelText("Password") as HTMLInputElement;
    expect(field.type).toBe("password");
    expect(screen.getByRole("button", { name: "Show password" })).toBeTruthy();
  });

  it("reveals the value, then hides it again", () => {
    renderField();
    const field = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(field.type).toBe("text");
    expect(field.value).toBe("correct-horse");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(field.type).toBe("password");
  });

  it("keeps the printed value across a toggle", () => {
    renderField();
    const field = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "typed-after-render" } });
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(field.value).toBe("typed-after-render");
  });

  it("marks the field invalid for assistive technology, not only in red", () => {
    render(<Field label="Password" error="Too short."><PasswordInput invalid defaultValue="x" /></Field>);
    // The error text is part of the label, so the field's accessible name carries it too.
    const field = screen.getByLabelText(/^Password/) as HTMLInputElement;
    expect(field.className).toContain("rts-input--invalid");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Too short.");
  });
});
