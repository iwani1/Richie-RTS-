// The vehicle photograph folder (FLT-01, D-108).
//
// These write real files into a temporary directory, because the thing under test is the writing:
// whether the name on disk can be influenced by whoever uploaded the picture, whether the type comes
// from the bytes or from the browser, and whether a photograph can be read from outside the folder.
// A mocked filesystem would let all three pass while the real code was unsafe.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  discardStoredVehiclePhoto,
  readStoredVehiclePhoto,
  saveVehiclePhoto,
  STORED_PHOTO_PATTERN,
  vehiclePhotoDir,
} from "./vehiclePhotoStore";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0x00)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x00)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);
const HTML = Buffer.from("<html><script>alert(1)</script></html>");

const ALLOWED = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX = 2 * 1024 * 1024;

let folder = "";

async function withFolder(): Promise<void> {
  folder = await mkdtemp(path.join(tmpdir(), "richie-vehicle-photos-"));
  process.env.VEHICLE_PHOTO_DIR = folder;
}

afterEach(async () => {
  if (folder) await rm(folder, { recursive: true, force: true });
  folder = "";
  delete process.env.VEHICLE_PHOTO_DIR;
});

const save = (bytes: Buffer) => saveVehiclePhoto({ bytes, maxBytes: MAX, allowedMimeTypes: ALLOWED });

describe("the folder photographs are kept in", () => {
  it("sits beside the application by default, and follows the setting when there is one", async () => {
    delete process.env.VEHICLE_PHOTO_DIR;
    expect(vehiclePhotoDir()).toBe(path.join(process.cwd(), "data", "vehicle-photos"));
    process.env.VEHICLE_PHOTO_DIR = "/var/lib/richie-tms/photos";
    expect(vehiclePhotoDir()).toBe("/var/lib/richie-tms/photos");
    delete process.env.VEHICLE_PHOTO_DIR;
  });

  it("writes a name of its own, never the one the phone gave it", async () => {
    await withFolder();
    const result = await save(JPEG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const files = await readdir(folder);
    expect(files).toEqual([result.saved.storedName]);
    expect(result.saved.storedName).toMatch(STORED_PHOTO_PATTERN);
    expect(result.saved.storedName).toMatch(/^vhcl_[0-9a-f]{36}\.jpg$/);
    // 0600: readable by the office account that runs the application, and nobody else.
    expect((await stat(path.join(folder, files[0]))).mode & 0o777).toBe(0o600);
  });

  it("decides the type from the bytes, so a PDF wearing .jpg is a PDF — and is refused here", async () => {
    await withFolder();
    const pdf = await save(PDF);
    expect(pdf.ok).toBe(false);
    if (!pdf.ok) expect(pdf.message).toMatch(/not kept as a vehicle photograph/i);
    expect(await readdir(folder)).toEqual([]);
  });

  it("refuses a web page, an empty file and anything over the ceiling, writing nothing", async () => {
    await withFolder();
    const html = await save(HTML);
    expect(html.ok).toBe(false);
    if (!html.ok) expect(html.message).toMatch(/not a JPEG, a PNG or a WebP/i);

    const empty = await save(Buffer.alloc(0));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.message).toMatch(/is empty/i);

    const big = await save(Buffer.concat([JPEG, Buffer.alloc(MAX)]));
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.message).toMatch(/too large/i);

    expect(await readdir(folder)).toEqual([]);
  });

  it("writes a PNG as a PNG and keeps a fingerprint of the bytes", async () => {
    await withFolder();
    const result = await save(PNG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.saved.mimeType).toBe("image/png");
    expect(result.saved.storedName.endsWith(".png")).toBe(true);
    expect(result.saved.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.saved.byteSize).toBe(PNG.length);
  });

  it("reads back only a name it wrote, so a hand-edited record cannot reach another file", async () => {
    await withFolder();
    const result = await save(JPEG);
    if (!result.ok) throw new Error("save failed");

    const bytes = await readStoredVehiclePhoto(result.saved.storedName);
    expect(bytes.length).toBe(JPEG.length);

    await expect(readStoredVehiclePhoto("../../.env")).rejects.toThrow(/not a stored vehicle photograph name/i);
    await expect(readStoredVehiclePhoto("rcpt_0123456789.jpg")).rejects.toThrow(/not a stored vehicle photograph/i);
  });

  it("discards a file whose row was refused, and ignores one that has already gone", async () => {
    await withFolder();
    const result = await save(JPEG);
    if (!result.ok) throw new Error("save failed");

    await discardStoredVehiclePhoto(result.saved.storedName);
    expect(await readdir(folder)).toEqual([]);
    // Discarding twice is not an error: the point is that nothing is left behind.
    await discardStoredVehiclePhoto(result.saved.storedName);
    await expect(discardStoredVehiclePhoto("../escape")).rejects.toThrow(/not a stored vehicle photograph/i);
  });
});
