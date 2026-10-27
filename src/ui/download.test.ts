// @vitest-environment jsdom
// Handing a file to the browser (RPT-04, D-113). jsdom has no download of its own, so the test watches
// the three things the helper must do: build an object URL, click an anchor named for the file, and
// revoke the URL afterwards so the browser does not hold it for the life of the tab.
import { afterEach, describe, expect, it, vi } from "vitest";
import { csvFileName, downloadTextFile } from "./download";

const url = { createObjectURL: vi.fn(() => "blob:rts"), revokeObjectURL: vi.fn() };

afterEach(() => {
  vi.restoreAllMocks();
});

function install() {
  Object.defineProperty(URL, "createObjectURL", { value: url.createObjectURL, configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: url.revokeObjectURL, configurable: true });
}

describe("downloading a file", () => {
  it("names the file, clicks an anchor for it, and releases the URL", () => {
    install();
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });

    downloadTextFile("statement-acme-2026-06-01-to-2026-06-30.csv", "a,b\n1,2");

    expect(url.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (url.createObjectURL.mock.calls[0] as unknown[])[0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(clicked).toEqual(["statement-acme-2026-06-01-to-2026-06-30.csv"]);
    expect(url.revokeObjectURL).toHaveBeenCalledWith("blob:rts");
    // The anchor it clicked is not left behind in the page.
    expect(document.querySelectorAll("a").length).toBe(0);
  });

  it("takes any text type, for a file that is not a CSV", () => {
    install();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadTextFile("notes.txt", "hello", "text/plain;charset=utf-8");
    const blob = (url.createObjectURL.mock.calls[0] as unknown[])[0] as Blob;
    expect(blob.type).toBe("text/plain;charset=utf-8");
  });

  it("builds the file name from the period, so two exports cannot overwrite each other", () => {
    expect(csvFileName("finance", "2026-06-01", "2026-06-30")).toBe("finance-2026-06-01-to-2026-06-30.csv");
  });
});
