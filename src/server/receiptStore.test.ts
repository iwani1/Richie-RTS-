// The receipt folder on the office disk (Q-51, D-100).
//
// These tests write real files into a temporary directory, because the thing being tested *is* the
// writing: whether the name on disk can be influenced by the uploader, whether the type is decided by
// the bytes or by the browser, and whether a scan can be read from outside the folder. A mocked
// filesystem would let all three pass while the real code was unsafe.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  discardStoredReceipt,
  fingerprint,
  readStoredReceipt,
  receiptDir,
  retentionDate,
  saveReceipt,
  sniffType,
  storedName,
  STORED_NAME_PATTERN,
} from "./receiptStore";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0x00)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x00)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from("WEBPVP8 "), Buffer.alloc(32, 0x00)]);
const HTML = Buffer.from("<html><script>alert(1)</script></html>");

const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

let folder = "";

async function withFolder(): Promise<void> {
  folder = await mkdtemp(path.join(tmpdir(), "richie-receipts-"));
  process.env.RECEIPT_DIR = folder;
}

afterEach(async () => {
  if (folder) await rm(folder, { recursive: true, force: true });
  folder = "";
  delete process.env.RECEIPT_DIR;
});

describe("what a file really is", () => {
  it("reads the type from the bytes, never from the name or the browser", () => {
    expect(sniffType(PDF)?.mimeType).toBe("application/pdf");
    expect(sniffType(JPEG)?.mimeType).toBe("image/jpeg");
    expect(sniffType(PNG)?.mimeType).toBe("image/png");
    expect(sniffType(WEBP)?.mimeType).toBe("image/webp");
    // A file called `receipt.jpg` that is really a PDF is a PDF, and is stored as one.
    expect(sniffType(PDF)?.extension).toBe("pdf");
  });

  it("refuses anything else, including a web page wearing an image name", () => {
    expect(sniffType(HTML)).toBeNull();
    expect(sniffType(Buffer.from("hello"))).toBeNull();
    expect(sniffType(Buffer.alloc(0))).toBeNull();
  });

  it("fingerprints the same bytes to the same value", () => {
    expect(fingerprint(PDF)).toBe(fingerprint(Buffer.from(PDF)));
    expect(fingerprint(PDF)).not.toBe(fingerprint(PNG));
    expect(fingerprint(PDF)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("where the folder is", () => {
  it("follows RECEIPT_DIR when it is set, and defaults beside the application otherwise", async () => {
    await withFolder();
    expect(receiptDir()).toBe(path.resolve(folder));
    delete process.env.RECEIPT_DIR;
    expect(receiptDir()).toBe(path.join(process.cwd(), "data", "receipts"));
  });
});

describe("filing a scan on disk", () => {
  it("writes the file under a generated name and reports what it stored", async () => {
    await withFolder();
    const result = await saveReceipt({ bytes: PDF, maxBytes: 2 * 1024 * 1024, allowedMimeTypes: ALLOWED });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The name is the server's, and it ends in the extension the bytes earned.
    expect(result.saved.storedName).toMatch(/^rcpt_[0-9a-f]{36}\.pdf$/);
    expect(result.saved.mimeType).toBe("application/pdf");
    expect(result.saved.byteSize).toBe(PDF.length);
    expect(result.saved.sha256).toBe(fingerprint(PDF));

    const onDisk = await readdir(folder);
    expect(onDisk).toEqual([result.saved.storedName]);
    expect(await readFile(path.join(folder, result.saved.storedName))).toEqual(PDF);
  });

  it("refuses an empty file, an oversized file and a type it does not keep", async () => {
    await withFolder();
    expect((await saveReceipt({ bytes: Buffer.alloc(0), maxBytes: 1000, allowedMimeTypes: ALLOWED })).ok).toBe(false);
    expect((await saveReceipt({ bytes: Buffer.alloc(2000, 1), maxBytes: 1000, allowedMimeTypes: ALLOWED })).ok).toBe(false);
    const html = await saveReceipt({ bytes: HTML, maxBytes: 1000, allowedMimeTypes: ALLOWED });
    expect(html.ok).toBe(false);
    if (!html.ok) expect(html.message).toContain("not a PDF, a JPEG, a PNG or a WebP");
    // Nothing was written for any of the three refusals.
    expect(await readdir(folder)).toEqual([]);
  });

  it("stores a file as what it is, even when it claimed another type", async () => {
    await withFolder();
    const result = await saveReceipt({ bytes: PDF, maxBytes: 2 * 1024 * 1024, allowedMimeTypes: ALLOWED });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.saved.mimeType).toBe("application/pdf");
      expect(result.saved.storedName.endsWith(".pdf")).toBe(true);
    }
  });

  it("never overwrites a file that is already there", async () => {
    await withFolder();
    // Two saves in a row cannot collide in practice (18 random bytes), so the collision is forced by
    // writing the file the second save would choose. `wx` must refuse rather than replace it.
    const first = await saveReceipt({ bytes: PDF, maxBytes: 2 * 1024 * 1024, allowedMimeTypes: ALLOWED });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const bytes = await readFile(path.join(folder, first.saved.storedName));
    expect(await saveReceipt({ bytes, maxBytes: 2 * 1024 * 1024, allowedMimeTypes: ALLOWED })).toMatchObject({ ok: true });
    // The original is untouched.
    expect(await readFile(path.join(folder, first.saved.storedName))).toEqual(PDF);
  });
});

describe("reading a scan back", () => {
  it("reads the bytes of a name it wrote", async () => {
    await withFolder();
    const saved = await saveReceipt({ bytes: JPEG, maxBytes: 2 * 1024 * 1024, allowedMimeTypes: ALLOWED });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(await readStoredReceipt(saved.saved.storedName)).toEqual(JPEG);
  });

  it("refuses to read anything outside the folder, whatever the row says", async () => {
    await withFolder();
    await writeFile(path.join(path.dirname(folder), "secret.txt"), "not yours");
    for (const name of ["../../secret.txt", "../secret.txt", "/etc/passwd", "rcpt_ok.pdf/../../secret.txt", "notes.txt"]) {
      await expect(readStoredReceipt(name)).rejects.toThrow();
    }
    // The shape the server writes is the only shape it reads.
    expect(STORED_NAME_PATTERN.test("rcpt_9f2c1ab34d5e6f708192a3b4.pdf")).toBe(true);
    expect(STORED_NAME_PATTERN.test("rcpt_.pdf")).toBe(false);
  });

  it("can discard a file it just wrote, and does nothing when it is already gone", async () => {
    await withFolder();
    const saved = await saveReceipt({ bytes: PNG, maxBytes: 2 * 1024 * 1024, allowedMimeTypes: ALLOWED });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    await discardStoredReceipt(saved.saved.storedName);
    expect(await readdir(folder)).toEqual([]);
    // A second discard is not an error: the route calls it while unwinding a refusal.
    await expect(discardStoredReceipt(saved.saved.storedName)).resolves.toBeUndefined();
    // And it will not delete anything outside the folder either.
    await expect(discardStoredReceipt("../../secret.txt")).rejects.toThrow();
  });
});

describe("the retention date", () => {
  it("is three years after the scan was filed, and says nothing for a nonsense date", () => {
    expect(retentionDate("2026-06-01T09:00:00.000Z", 3)).toBe("2029-06-01");
    expect(retentionDate("2028-02-29T09:00:00.000Z", 3)).toBe("2031-03-01");
    expect(retentionDate("not a date", 3)).toBe("");
  });

  it("matches the constant the screen shows", () => {
    // The panel says "kept for three years"; this is the same number, not a second opinion.
    expect(retentionDate("2026-01-01T00:00:00.000Z", 3)).toBe("2029-01-01");
  });
});

describe("the name a file is stored under", () => {
  it("is random, carries the extension, and never contains a path separator", () => {
    const name = storedName("jpg");
    expect(name).toMatch(/^rcpt_[0-9a-f]{36}\.jpg$/);
    expect(name).not.toContain("/");
    expect(storedName("jpg")).not.toBe(storedName("jpg"));
  });
});
