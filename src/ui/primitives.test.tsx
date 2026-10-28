// @vitest-environment jsdom
// The reveal control on a password field. It exists so a mistyped password is visible before it is
// submitted: this application has no self-service reset, so a failed sign-in costs the operator an
// administrator's time.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable, Field, Panel, PasswordInput } from "./primitives";

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
    expect(field.className).toContain("aria-invalid:border-destructive");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Too short.");
  });
});

describe("panel dialog", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Record a vehicle</button>
        {open && (
          <Panel title="New vehicle" onClose={() => setOpen(false)}>
            <label>
              Registration
              <input />
            </label>
            <p>Written straight to the register.</p>
          </Panel>
        )}
      </>
    );
  }

  it("moves focus into the panel and restores it to the trigger on close", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Record a vehicle" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "New vehicle" })).toBeTruthy();
    // The first control inside the panel takes focus, not the page behind it.
    expect(document.activeElement?.textContent).toBe("Close");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Panel title="New vehicle" onClose={onClose}>
        <input aria-label="Registration" />
      </Panel>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps Tab inside the panel", () => {
    render(
      <Panel title="New vehicle" onClose={() => {}}>
        <input aria-label="Registration" />
        <input aria-label="Notes" />
      </Panel>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    const notes = screen.getByLabelText("Notes");
    notes.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(notes);
  });

  it("does not put a second invisible Close in the tab order", () => {
    render(
      <Panel title="New vehicle" onClose={() => {}}>
        <input aria-label="Registration" />
      </Panel>,
    );
    expect(screen.getAllByRole("button", { name: /close/i })).toHaveLength(1);
  });
});

// The sortable header. Sorting lives in the screen (see tableSort.ts), so what the table owes is the
// control: a button named for its column, `aria-sort` on the cell it belongs to, and one callback
// per click saying which state the screen should be in.
describe("a sortable column header", () => {
  const rows = [
    { id: "a", name: "Zebra", total: 3 },
    { id: "b", name: "Acme", total: 1 },
  ];
  const columns = [
    { key: "name", header: "Customer", render: (row: (typeof rows)[number]) => row.name, sortValue: (row: (typeof rows)[number]) => row.name },
    { key: "plain", header: "Purpose", render: (row: (typeof rows)[number]) => `${row.total} days` },
  ];

  function Harness() {
    const [sort, setSort] = useState<{ key: string; direction: "ascending" | "descending" } | null>(null);
    return <DataTable rows={rows} rowKey={(row) => row.id} columns={columns} emptyState={null} sort={sort} onSortChange={setSort} />;
  }

  it("offers a button only on a column that says how to sort", () => {
    const { unmount } = render(<Harness />);
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Sort by Customer"]);
    unmount();
    // Without the callback the header is plain text: a sort control that changes nothing is a lie.
    render(<DataTable rows={rows} rowKey={(row) => row.id} columns={columns} emptyState={null} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says which way the column is sorted, and clears on the third click", () => {
    render(<Harness />);
    const header = () => screen.getByRole("columnheader", { name: /Customer|Sort by Customer/ });
    expect(header().getAttribute("aria-sort")).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "Sort by Customer" }));
    expect(header().getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: "Sort by Customer" }));
    expect(header().getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(screen.getByRole("button", { name: "Sort by Customer" }));
    expect(header().getAttribute("aria-sort")).toBe("none");
  });

  it("does not claim a sort state on a column that cannot be sorted", () => {
    render(<Harness />);
    expect(screen.getByRole("columnheader", { name: "Purpose" }).getAttribute("aria-sort")).toBeNull();
  });
});
