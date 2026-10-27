// @vitest-environment jsdom
// Copying a reference (D-111). The interesting cases are not the happy path: a browser that refuses
// the Clipboard API (plain http on the office network, or an embedded view) and one where the call
// throws. Both must end in a sentence a person can act on, never a button that looks like it worked.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Undo whatever clipboard the test installed.
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  Object.defineProperty(document, "execCommand", { value: undefined, configurable: true });
});

function clipboardThat(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

describe("the copy button", () => {
  it("names the reference it copies, so the button is not just 'Copy'", () => {
    render(<CopyButton value="INV-2026-0001" what="invoice number" />);
    expect(screen.getByRole("button", { name: "Copy invoice number INV-2026-0001" })).toBeTruthy();
  });

  it("puts the reference on the clipboard and says so", async () => {
    const writeText = vi.fn(async () => {});
    clipboardThat(writeText);
    render(<CopyButton value="INV-2026-0001" what="invoice number" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Copy invoice number/ }));
    });

    expect(writeText).toHaveBeenCalledWith("INV-2026-0001");
    expect(screen.getByRole("button", { name: /^Copy invoice number/ }).textContent).toBe("Copied");
    expect(screen.getByRole("status").textContent).toBe("Invoice number INV-2026-0001 copied.");
  });

  it("goes back to 'Copy' after a few seconds, so the next click still makes sense", async () => {
    vi.useFakeTimers();
    clipboardThat(async () => {});
    render(<CopyButton value="GT-900-26" what="rental reference" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Copy rental reference/ }));
    });
    expect(screen.getByRole("button", { name: /^Copy rental reference/ }).textContent).toBe("Copied");

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.getByRole("button", { name: /^Copy rental reference/ }).textContent).toBe("Copy");
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("says the browser would not copy it, rather than pretending it did", async () => {
    clipboardThat(async () => {
      throw new Error("denied");
    });
    render(<CopyButton value="RCP-11" what="receipt number" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Copy receipt number/ }));
    });

    expect(screen.getByRole("button", { name: /^Copy receipt number/ }).textContent).toBe("Not copied");
    expect(screen.getByRole("status").textContent).toMatch(/Select the number and copy it by hand/i);
  });

  it("falls back to selecting the text when the Clipboard API is missing", async () => {
    // What an office machine on plain http over the local network gets: no navigator.clipboard.
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    render(<CopyButton value="TRP-2041" what="trip reference" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Copy trip reference/ }));
    });

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(screen.getByRole("button", { name: /^Copy trip reference/ }).textContent).toBe("Copied");
    // The scratch textarea it selects is removed again; nothing is left in the page behind it.
    expect(document.querySelectorAll("textarea").length).toBe(0);
  });
});
