// @vitest-environment jsdom
// The section strip: one tab list, the arrow keys walk it, Home and End go to the ends, and only
// the open section is a tab stop. Every screen that has more than one section uses it, so a defect
// here is a defect on four screens at once.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionTabs } from "./SectionTabs";

afterEach(cleanup);

type Section = "routes" | "passengers" | "trips";

function Harness() {
  const [value, setValue] = useState<Section>("routes");
  return (
    <SectionTabs
      tabs={[
        { id: "routes", label: "Routes" },
        { id: "passengers", label: "Passengers" },
        { id: "trips", label: "Trips" },
      ]}
      value={value}
      onChange={setValue}
      ariaLabel="Sections"
    />
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });

describe("SectionTabs", () => {
  it("marks the open section, and only it is a tab stop", () => {
    render(<Harness />);
    const strip = screen.getByRole("tablist", { name: "Sections" });
    expect(within(strip).getAllByRole("tab").map((node) => node.textContent)).toEqual(["Routes", "Passengers", "Trips"]);
    expect(tab("Routes").getAttribute("aria-selected")).toBe("true");
    expect(tab("Routes").getAttribute("tabindex")).toBe("0");
    expect(tab("Trips").getAttribute("tabindex")).toBe("-1");
  });

  it("walks with the arrow keys and wraps at both ends", () => {
    render(<Harness />);
    fireEvent.keyDown(tab("Routes"), { key: "ArrowRight" });
    expect(tab("Passengers").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Passengers"), { key: "ArrowLeft" });
    expect(tab("Routes").getAttribute("aria-selected")).toBe("true");
    // Backwards from the first section lands on the last: a strip that dead-ends is a keyboard trap.
    fireEvent.keyDown(tab("Routes"), { key: "ArrowLeft" });
    expect(tab("Trips").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Trips"), { key: "ArrowDown" });
    expect(tab("Routes").getAttribute("aria-selected")).toBe("true");
  });

  it("jumps to the first and last section with Home and End, and ignores other keys", () => {
    render(<Harness />);
    fireEvent.keyDown(tab("Routes"), { key: "End" });
    expect(tab("Trips").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Trips"), { key: "Home" });
    expect(tab("Routes").getAttribute("aria-selected")).toBe("true");
    // Typing a letter is not a shortcut: the strip must not move under somebody using a screen reader.
    fireEvent.keyDown(tab("Routes"), { key: "t" });
    expect(tab("Routes").getAttribute("aria-selected")).toBe("true");
  });
});
