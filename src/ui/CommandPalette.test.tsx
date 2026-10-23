// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

afterEach(cleanup);

const allowAll = () => true;

describe("command palette", () => {
  it("lists reachable screens and filters as you type", () => {
    render(<CommandPalette onClose={() => {}} onNavigate={() => {}} allowed={allowAll} />);
    expect(screen.getByRole("option", { name: /Bus rentals/ })).toBeTruthy();
    const input = screen.getByLabelText("Search screens");
    fireEvent.change(input, { target: { value: "fleet" } });
    expect(screen.getByRole("option", { name: /Fleet readiness/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Bus rentals/ })).toBeNull();
  });

  it("navigates with the keyboard and closes on Enter", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette onClose={onClose} onNavigate={onNavigate} allowed={allowAll} />);
    const input = screen.getByLabelText("Search screens");
    fireEvent.change(input, { target: { value: "settings" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("settings");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette onClose={onClose} onNavigate={() => {}} allowed={allowAll} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("only offers screens the role may reach", () => {
    // A user without users:read must not be offered the user register.
    const allowed = (permission: string | null) => permission !== "users:read";
    render(<CommandPalette onClose={() => {}} onNavigate={() => {}} allowed={allowed} />);
    expect(screen.queryByRole("option", { name: /^Users/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Vehicles/ })).toBeTruthy();
  });

  it("keeps focus inside the dialog when Tab is pressed", () => {
    render(<CommandPalette onClose={() => {}} onNavigate={() => {}} allowed={allowAll} />);
    const input = screen.getByLabelText("Search screens");
    const event = fireEvent.keyDown(input, { key: "Tab" });
    // fireEvent returns false when preventDefault was called.
    expect(event).toBe(false);
  });

  it("says so when nothing matches, rather than showing an empty box", () => {
    render(<CommandPalette onClose={() => {}} onNavigate={() => {}} allowed={allowAll} />);
    fireEvent.change(screen.getByLabelText("Search screens"), { target: { value: "zzzz" } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });
});
