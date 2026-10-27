// The boundary of the route that accepts a vehicle photograph (FLT-01, D-108).
//
// The order of the refusals is the thing under test — no session, then no permission, then another
// site, then the wrong kind of file, then a row the domain refuses — because each of those is a
// different attack, and the one that matters most is the last: a refused upload must leave nothing
// behind, since an unindexed file is one nobody can find, open or delete.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyDatabase, type Database, type User } from "../../../tms/types";

const at = "2026-06-01T09:00:00.000Z";
const user = (overrides: Partial<User>): User => ({
  id: "u1",
  fullName: "Ops",
  email: "ops@example.test",
  role: "operations",
  active: true,
  driverId: null,
  clientId: null,
  passengerId: null,
  primaryContact: false,
  passwordHash: "",
  passwordSalt: "",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const ops = user({ id: "u-ops", fullName: "Ops", role: "operations" });
const finance = user({ id: "u-fin", fullName: "Fin", email: "fin@example.test", role: "finance" });

const database: Database = { ...emptyDatabase(), users: [ops, finance] };
let signedIn: string | null = ops.id;

const runCommand = vi.fn();
const loadDatabase = vi.fn(async () => database);

vi.mock("../../../server/commands", () => ({
  runCommand,
  findActor: (db: Database, userId: string | null) => {
    const found = db.users.find((candidate) => candidate.id === userId) ?? null;
    return { user: found, actor: found ? { id: found.id, fullName: found.fullName, role: found.role } : null };
  },
}));
vi.mock("../../../server/db", () => ({ db: () => ({}) }));
vi.mock("../../../server/repository", () => ({ loadDatabase }));
vi.mock("../../../server/session", () => ({ currentUserId: async () => signedIn }));

const { POST } = await import("./route");

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x00)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);

let folder = "";

const upload = (options: { bytes?: Buffer; name?: string; type?: string; vehicleId?: string; origin?: string | null } = {}) => {
  const form = new FormData();
  form.append("vehicleId", options.vehicleId ?? "v1");
  form.append("file", new File([new Uint8Array(options.bytes ?? JPEG)], options.name ?? "bus.jpg", { type: options.type ?? "image/jpeg" }));
  const origin = options.origin === undefined ? "http://localhost:3000" : options.origin;
  return POST(
    new Request("http://localhost:3000/api/vehicle-photo", {
      method: "POST",
      body: form,
      headers: origin ? { origin } : {},
    }),
  );
};

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "richie-vehicle-photo-route-"));
  process.env.VEHICLE_PHOTO_DIR = folder;
  signedIn = ops.id;
  runCommand.mockReset();
  loadDatabase.mockClear();
  runCommand.mockResolvedValue({ ok: true, status: 200, message: "Photograph filed for GT 100-26.", database });
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
  delete process.env.VEHICLE_PHOTO_DIR;
});

describe("filing a vehicle photograph over HTTP", () => {
  it("refuses a request with no session before reading the file, and writes nothing", async () => {
    signedIn = null;
    const response = await upload();
    expect(response.status).toBe(401);
    expect(runCommand).not.toHaveBeenCalled();
    expect(await readdir(folder)).toEqual([]);
  });

  it("refuses finance, whose role reads the fleet but does not maintain it", async () => {
    signedIn = finance.id;
    const response = await upload();
    expect(response.status).toBe(403);
    expect(runCommand).not.toHaveBeenCalled();
    expect(await readdir(folder)).toEqual([]);
  });

  it("refuses a request from another site", async () => {
    const response = await upload({ origin: "https://attacker.example" });
    expect(response.status).toBe(403);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("refuses a PDF wearing a photograph's name, and writes nothing", async () => {
    const response = await upload({ bytes: PDF, name: "bus.jpg", type: "image/jpeg" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message: string };
    expect(body.message).toMatch(/not kept as a vehicle photograph/i);
    expect(runCommand).not.toHaveBeenCalled();
    expect(await readdir(folder)).toEqual([]);
  });

  it("refuses a form with no vehicle, and one with no file", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(JPEG)], "bus.jpg", { type: "image/jpeg" }));
    const noVehicle = await POST(new Request("http://localhost:3000/api/vehicle-photo", { method: "POST", body: form, headers: { origin: "http://localhost:3000" } }));
    expect(noVehicle.status).toBe(400);
    expect(((await noVehicle.json()) as { message: string }).message).toMatch(/Choose the vehicle/i);

    const empty = new FormData();
    empty.append("vehicleId", "v1");
    const noFile = await POST(new Request("http://localhost:3000/api/vehicle-photo", { method: "POST", body: empty, headers: { origin: "http://localhost:3000" } }));
    expect(noFile.status).toBe(400);
    expect(((await noFile.json()) as { message: string }).message).toMatch(/Attach the photograph/i);
    expect(await readdir(folder)).toEqual([]);
  });

  it("saves the bytes, then asks the domain to index them, and hands back the new snapshot", async () => {
    const response = await upload();
    expect(response.status).toBe(200);

    const files = await readdir(folder);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^vhcl_[0-9a-f]{36}\.jpg$/);

    const command = runCommand.mock.calls[0][0] as { type: string; vehicleId: string; upload: { originalName: string; mimeType: string; storedName: string; byteSize: number } };
    expect(command.type).toBe("attach_vehicle_photo");
    expect(command.vehicleId).toBe("v1");
    expect(command.upload.mimeType).toBe("image/jpeg");
    expect(command.upload.originalName).toBe("bus.jpg");
    expect(command.upload.byteSize).toBe(JPEG.length);
    expect(command.upload.storedName).toBe(files[0]);

    // The reply is the same shape a command returns, so a screen handles both the same way.
    const body = (await response.json()) as { ok: boolean; message: string; database: Database };
    expect(body.ok).toBe(true);
    expect(body.database).toBeTruthy();
  });

  it("deletes the file again when the domain refuses the row", async () => {
    runCommand.mockResolvedValueOnce({
      ok: false,
      status: 400,
      message: "That photograph could not be filed.",
      errors: { vehicleId: "That vehicle is not on the register." },
    });
    const response = await upload({ vehicleId: "gone" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors: Record<string, string> };
    expect(body.errors.vehicleId).toMatch(/not on the register/i);
    // Nothing left behind: the folder and the register agree.
    expect(await readdir(folder)).toEqual([]);
  });
});
