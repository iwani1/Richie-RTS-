// The boundary of the one route that accepts a file (Q-51, D-100).
//
// A file upload is the most dangerous thing this application does, so the order of refusals is the
// thing under test: no session, then no permission, then the wrong kind of file, then a write the
// domain refuses. What matters as much as the refusals is the folder afterwards — a refused upload
// must leave nothing behind, because an unindexed scan is a file nobody can find, open or delete.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyDatabase, type Database, type User } from "../../../tms/types";

const at = "2026-06-01T09:00:00.000Z";
const user = (overrides: Partial<User>): User => ({
  id: "u1",
  fullName: "Fin",
  email: "fin@example.test",
  role: "finance",
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

const finance = user({ id: "u-fin", fullName: "Fin", role: "finance" });
const ops = user({ id: "u-ops", fullName: "Ops", email: "ops@example.test", role: "operations" });

let database: Database = { ...emptyDatabase(), users: [finance, ops] };
let signedIn: string | null = finance.id;

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

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);
const HTML = Buffer.from("<html><script>alert(1)</script></html>");

let folder = "";

const upload = (options: { bytes?: Buffer; name?: string; type?: string; expenseId?: string; origin?: string | null } = {}) => {
  const form = new FormData();
  form.append("expenseId", options.expenseId ?? "ex1");
  form.append("file", new File([new Uint8Array(options.bytes ?? PDF)], options.name ?? "receipt.pdf", { type: options.type ?? "application/pdf" }));
  const origin = options.origin === undefined ? "http://localhost:3000" : options.origin;
  return POST(
    new Request("http://localhost:3000/api/receipts", {
      method: "POST",
      body: form,
      headers: origin ? { origin } : {},
    }),
  );
};

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "richie-receipt-route-"));
  process.env.RECEIPT_DIR = folder;
  signedIn = finance.id;
  runCommand.mockReset();
  loadDatabase.mockClear();
  runCommand.mockResolvedValue({ ok: true, status: 200, message: "Scan filed against EXP-2026-0001.", database });
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
  delete process.env.RECEIPT_DIR;
});

describe("filing a scan over HTTP", () => {
  it("refuses a request with no session before reading the file", async () => {
    signedIn = null;
    const response = await upload();
    expect(response.status).toBe(401);
    expect(runCommand).not.toHaveBeenCalled();
    expect(await readdir(folder)).toEqual([]);
  });

  it("refuses operations, whose role may read costs but not the supplier's paper", async () => {
    signedIn = ops.id;
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

  it("refuses a web page wearing an image name, and writes nothing", async () => {
    const response = await upload({ bytes: HTML, name: "receipt.jpg", type: "image/jpeg" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message: string; errors: Record<string, string> };
    expect(body.message).toContain("not a PDF, a JPEG, a PNG or a WebP");
    expect(loadDatabase).toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
    expect(await readdir(folder)).toEqual([]);
  });

  it("saves the bytes, then asks the domain to index them, and hands back the new snapshot", async () => {
    const response = await upload();
    expect(response.status).toBe(200);

    const files = await readdir(folder);
    expect(files).toHaveLength(1);
    // The name on disk is the server's, and it is a PDF because the bytes said so.
    expect(files[0]).toMatch(/^rcpt_[0-9a-f]{36}\.pdf$/);

    const command = runCommand.mock.calls[0][0] as { type: string; expenseId: string; upload: { originalName: string; mimeType: string; storedName: string; byteSize: number } };
    expect(command.type).toBe("attach_receipt");
    expect(command.expenseId).toBe("ex1");
    expect(command.upload.mimeType).toBe("application/pdf");
    expect(command.upload.originalName).toBe("receipt.pdf");
    expect(command.upload.byteSize).toBe(PDF.length);
    expect(command.upload.storedName).toBe(files[0]);
  });

  it("deletes the file again when the domain refuses the row", async () => {
    runCommand.mockResolvedValueOnce({
      ok: false,
      status: 400,
      message: "That receipt could not be filed.",
      errors: { expenseId: "EXP-2026-0004 was voided, so there is nothing to file a receipt against." },
    });

    const response = await upload();
    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors: Record<string, string> };
    expect(body.errors.expenseId).toContain("voided");
    // The scan that was just written is gone: nothing points at it, so nothing should keep it.
    expect(await readdir(folder)).toEqual([]);
  });
});

describe("opening a filed scan", () => {
  it("is served to finance under the name it arrived with, and never cached", async () => {
    // File a scan through the route first, so the folder holds a real file.
    await upload();
    const [stored] = await readdir(folder);

    database = {
      ...database,
      receipts: [
        {
          id: "rc1",
          expenseId: "ex1",
          storedName: stored,
          originalName: 'Total "filing" 4 Aug.pdf',
          mimeType: "application/pdf",
          byteSize: PDF.length,
          sha256: "c".repeat(64),
          status: "attached",
          removedReason: null,
          removedBy: null,
          removedAt: null,
          supersededById: null,
          uploadedBy: "Fin",
          uploadedAt: at,
        },
      ],
    };

    const { GET: openScan } = await import("./[id]/route");
    const response = await openScan(new Request("http://localhost:3000/api/receipts/rc1"), { params: Promise.resolve({ id: "rc1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    // Quotes in the name are stripped: a header built from what somebody typed is an injection.
    expect(response.headers.get("content-disposition")).toBe('inline; filename="Total _filing_ 4 Aug.pdf"');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PDF);
  });

  it("tells the operator when the index and the folder disagree", async () => {
    const { GET: openScan } = await import("./[id]/route");
    database = {
      ...database,
      receipts: [
        {
          id: "rc-missing",
          expenseId: "ex1",
          storedName: "rcpt_0000000000000000000000000000.pdf",
          originalName: "receipt.pdf",
          mimeType: "application/pdf",
          byteSize: 4,
          sha256: "c".repeat(64),
          status: "attached",
          removedReason: null,
          removedBy: null,
          removedAt: null,
          supersededById: null,
          uploadedBy: "Fin",
          uploadedAt: at,
        },
      ],
    };
    const response = await openScan(new Request("http://localhost:3000/api/receipts/rc-missing"), { params: Promise.resolve({ id: "rc-missing" }) });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("Restore that folder from the last backup");
  });

  it("refuses operations the image, even with its id", async () => {
    signedIn = ops.id;
    const { GET: openScan } = await import("./[id]/route");
    const response = await openScan(new Request("http://localhost:3000/api/receipts/rc1"), { params: Promise.resolve({ id: "rc1" }) });
    expect(response.status).toBe(403);
  });
});
