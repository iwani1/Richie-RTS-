// @vitest-environment jsdom
// DSP-04, D-105: reporting a delay while the run is still out.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripDelayForm } from "./TripDelayForm";
import type { Trip, TripDelay } from "../tms/types";

afterEach(cleanup);

const at = "2026-06-01T07:20:00.000Z";

const delay = (minutes: number, reason: string): TripDelay => ({ id: `d-${minutes}`, at, minutes, reason, reportedBy: "Ops" });

const trip = (overrides: Partial<Trip> = {}): Trip =>
  ({
    id: "t1",
    reference: "TR-0001",
    routeId: "r1",
    serviceDate: "2026-06-01",
    status: "in_progress",
    origin: "schedule",
    originReason: null,
    vehicleId: "v1",
    driverId: "d1",
    dispatchedAt: at,
    startedAt: at,
    completedAt: null,
    cancelReason: null,
    cancelledAt: null,
    cancelledBy: null,
    incidentId: null,
    stopLogs: [],
    boardings: [],
    onTimeThresholdMinutes: 5,
    corrections: [],
    delays: [],
    rosterChanges: [],
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }) as Trip;

describe("reporting a delay", () => {
  it("asks for the minutes and the reason, and sends exactly what was typed", async () => {
    const onSubmit = vi.fn(async () => ({}));
    render(<TripDelayForm trip={trip()} onClose={() => {}} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/minutes behind the timetable/i), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/what is holding the run up/i), { target: { value: "Traffic at the junction" } });
    fireEvent.click(screen.getByRole("button", { name: /record the delay/i }));

    expect(onSubmit).toHaveBeenCalledWith({ minutes: "20", reason: "Traffic at the junction" });
  });

  it("shows what was last reported, and seeds the box with it", () => {
    render(<TripDelayForm trip={trip({ delays: [delay(20, "Traffic at the junction")] })} onClose={() => {}} onSubmit={async () => ({})} />);
    expect(screen.getByText(/last reported/i).textContent).toMatch(/20 minutes late — Traffic at the junction/);
    expect((screen.getByLabelText(/minutes behind the timetable/i) as HTMLInputElement).value).toBe("20");
    // The second report of the morning is usually the same delay getting worse, so the wording says so.
    expect(screen.getByRole("heading", { name: /how late is TR-0001 now/i })).toBeTruthy();
  });

  it("shows the server's answer beside the field it is about", async () => {
    const onSubmit = vi.fn(async () => ({ minutes: "Enter whole minutes, such as 20.", reason: "Say what is holding the run up." }));
    render(<TripDelayForm trip={trip()} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /record the delay/i }));
    expect(await screen.findByText(/enter whole minutes/i)).toBeTruthy();
    expect(screen.getByText(/say what is holding the run up/i)).toBeTruthy();
  });

  it("explains that 0 means the run caught up, only once a delay exists", () => {
    const { unmount } = render(<TripDelayForm trip={trip()} onClose={() => {}} onSubmit={async () => ({})} />);
    expect(screen.getByText(/the number the office would say/i)).toBeTruthy();
    unmount();

    render(<TripDelayForm trip={trip({ delays: [delay(20, "Traffic")] })} onClose={() => {}} onSubmit={async () => ({})} />);
    expect(screen.getByText(/enter 0 if it has caught up/i)).toBeTruthy();
  });
});
