import { describe, expect, it } from "vitest";
import { setupChecklist, setupProgress } from "./setup";
import { emptyDatabase } from "./types";

describe("setup checklist", () => {
  it("reports an empty installation as nothing supplied, not as five silent zeros", () => {
    const progress = setupProgress(emptyDatabase().settings);
    expect(progress.done).toBe(0);
    expect(progress.outstanding).toBe(5);
    expect(progress.percent).toBe(0);
    expect(progress.complete).toBe(false);
    expect(setupChecklist(emptyDatabase().settings).every((i) => !i.done)).toBe(true);
  });

  it("counts only rules that were actually supplied", () => {
    const settings = {
      ...emptyDatabase().settings,
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      onTimeThresholdMinutes: 10,
    };
    const progress = setupProgress(settings);
    expect(progress.done).toBe(3);
    expect(progress.percent).toBe(60);
    expect(progress.items.filter((i) => !i.done).map((i) => i.key)).toEqual(["vehicle_categories", "shifts"]);
  });

  it("treats a zero-minute threshold as supplied and an empty list as unset", () => {
    const base = emptyDatabase().settings;
    expect(setupProgress({ ...base, onTimeThresholdMinutes: 0 }).items.find((i) => i.key === "on_time_threshold")?.done).toBe(true);
    expect(setupProgress({ ...base, vehicleCategories: [] }).items.find((i) => i.key === "vehicle_categories")?.done).toBe(false);
  });

  it("is complete only when every rule is supplied", () => {
    const settings = {
      ...emptyDatabase().settings,
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      onTimeThresholdMinutes: 10,
      vehicleCategories: [{ id: "c1", name: "Coaster" }],
      shifts: [{ id: "s1", name: "Day", startTime: "06:00", endTime: "18:00" }],
    };
    const progress = setupProgress(settings);
    expect(progress.complete).toBe(true);
    expect(progress.percent).toBe(100);
  });
});
