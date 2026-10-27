// Handing a file to the browser, in one place (RPT-04, D-113).
//
// Three screens had grown their own copy of this: build a Blob, make an object URL, click an anchor,
// revoke the URL. One copy means one place to get the revoke right, and one place to change if the
// download has to be named differently.
//
// Nothing is uploaded and nothing is stored: the file is built in this browser from records the
// server already narrowed to what the signed-in role may read. A CSV therefore cannot contain a row
// the person could not have seen on the screen.
export function downloadTextFile(filename: string, text: string, mime = "text/csv;charset=utf-8"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  // Appended before the click and removed after: a detached anchor works in current browsers but not
  // in every embedded one, and an attachment inside an iframe is exactly where this gets used.
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** `2026-06-01` to `2026-06-30` in a file name: `report-2026-06-01-to-2026-06-30.csv`. */
export function csvFileName(prefix: string, from: string, to: string): string {
  return `${prefix}-${from}-to-${to}.csv`;
}
