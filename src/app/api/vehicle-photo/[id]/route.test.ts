// Opening a vehicle's photograph (FLT-01, D-108).
//
// Two checks stand between this URL and a file on the disk: the role may read the fleet at all, and —
// because a driver's account is confined to its own records — this vehicle is one that account may
// see. The second is the one a test has to prove: without it, a driver could read any bus in the
// fleet by guessing an id.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyDatabase, type Database, type Trip, type User, type Vehicle } from "../../../../tms/types";

const at = "2026-06-01T09:00:00.000Z";
const STORED = "vhcl_" + "a".repeat(36) + ".jpg";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 0x00)]);

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

const ops = user({ id: "u-ops" });
const driverUser = user({ id: "u-driver", fullName: "Kojo", email: "kojo@example.test", role: "driver", driverId: "d1" });
const clientUser = user({ id: "u-client", fullName: "Efua", email: "efua@example.test", role: "client_contact", clientId: "c1" });

const vehicle = (id: string, overrides: Partial<Vehicle> = {}): Vehicle => ({
  id,
  registration: `GT ${id}`,
  categoryId: "cat",
  make: "",
  model: "",
  seatCapacity: 30,
  status: "available",
  fuelType: "",
  ownership: null,
  ownerName: "",
  usualDriverId: null,
  photo: {
    storedName: STORED,
    originalName: 'bus "front"\n.jpg',
    mimeType: "image/jpeg",
    byteSize: JPEG.length,
    sha256: "b".repeat(64),
    uploadedBy: "Ops",
    uploadedAt: at,
  },
  notes: "",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const trip: Trip = {
  id: "t1",
  reference: "TR-0001",
  routeId: "r1",
  serviceDate: "2026-06-01",
  status: "planned",
  origin: "schedule",
  originReason: null,
  vehicleId: "mine",
  driverId: "d1",
  dispatchedAt: null,
  startedAt: null,
  completedAt: null,
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  incidentId: null,
  stopLogs: [],
  boardings: [],
  onTimeThresholdMinutes: null,
  corrections: [],
  delays: [],
  rosterChanges: [],
  createdAt: at,
  updatedAt: at,
};

let database: Database;
let signedIn: string | null = ops.id;
const loadDatabase = vi.fn(async () => database);

vi.mock("../../../../server/db", () => ({ db: () => ({}) }));
vi.mock("../../../../server/repository", () => ({ loadDatabase }));
vi.mock("../../../../server/session", () => ({ currentUserId: async () => signedIn }));

const { GET } = await import("./route");

let folder = "";

const open = (id: string) => GET(new Request("http://localhost:3000/api/vehicle-photo/x"), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "richie-vehicle-photo-read-"));
  process.env.VEHICLE_PHOTO_DIR = folder;
  await writeFile(path.join(folder, STORED), JPEG, { mode: 0o600 });
  signedIn = ops.id;
  database = {
    ...emptyDatabase(),
    users: [ops, driverUser, clientUser],
    vehicles: [vehicle("mine"), vehicle("theirs")],
    trips: [trip],
  };
  loadDatabase.mockClear();
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
  delete process.env.VEHICLE_PHOTO_DIR;
});

describe("opening a vehicle photograph", () => {
  it("serves the bytes to a role that may read the fleet, with the type from the record", async () => {
    const response = await open("mine");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect((await response.arrayBuffer()).byteLength).toBe(JPEG.length);
  });

  it("strips quotes, newlines and separators out of the download name", async () => {
    const response = await open("mine");
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("inline;");
    expect(disposition).not.toMatch(/[\n\r]/);
    // Exactly two quotes: the ones this server wrote around the name it cleaned.
    expect(disposition.match(/"/g)).toHaveLength(2);
    expect(disposition).toContain(".jpg");
  });

  it("refuses a request with no session, and a client contact whose role reads no fleet at all", async () => {
    signedIn = null;
    expect((await open("mine")).status).toBe(401);

    signedIn = clientUser.id;
    expect((await open("mine")).status).toBe(403);
  });

  it("refuses a driver: the fleet register is not theirs, even for the bus they drive", async () => {
    signedIn = driverUser.id;
    // A driver's snapshot carries the bus it drives, but `vehicles:read` is an office permission. The
    // route keeps its own-record check anyway, so widening that permission later cannot leak the fleet.
    expect((await open("mine")).status).toBe(403);
    expect((await open("theirs")).status).toBe(403);
  });

  it("answers 404 for a vehicle with no photograph, and for one that is not there", async () => {
    database = { ...database, vehicles: [vehicle("mine", { photo: null })] };
    const none = await open("mine");
    expect(none.status).toBe(404);
    expect(((await none.json()) as { message: string }).message).toMatch(/No photograph has been filed/i);

    expect((await open("missing")).status).toBe(404);
  });

  it("says the folder and the register disagree when the file has gone, rather than serving an empty image", async () => {
    await rm(path.join(folder, STORED));
    const response = await open("mine");
    expect(response.status).toBe(404);
    const body = (await response.json()) as { message: string };
    expect(body.message).toMatch(/not in the vehicle photograph folder/i);
    expect(body.message).toMatch(/backup/i);
  });
});
