// CSV import for master data (brief MIG-01; the same pattern EMP-02 asks for).
//
// The rule the brief sets is "no silent discards": every row in the file ends up either created
// or rejected with a reason the operator can read. So there is one implementation of "what would
// happen to this file" — `previewImport` — and the import command runs exactly that same code and
// commits the result. The preview cannot promise something the import will not do, because it is
// the import, run against a scratch copy of the database.
//
// Rows are executed through the ordinary commands (`create_vehicle`, `create_driver`,
// `create_client`), so an imported record is validated, permission-checked and audited by the same
// code as one typed into a form. Duplicate detection is therefore identical too: the second of two
// rows with the same registration is rejected, not silently merged.
import type { Permission } from "./permissions";
import { can } from "./permissions";
import { audit, execute, type Actor, type ClientInput, type Command, type CommandResult, type DriverInput, type VehicleInput } from "./service";
import type { ClientStatus, Database, DriverStatus } from "./types";

export const IMPORT_KINDS = ["vehicles", "drivers", "clients"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** A file larger than this is refused rather than half-imported. */
export const MAX_IMPORT_BYTES = 200_000;
/** More rows than this in one file is almost certainly the wrong file. */
export const MAX_IMPORT_ROWS = 500;

interface ColumnSpec {
  /** Header names accepted for this field, lower-cased. */
  aliases: string[];
  required: boolean;
}

interface KindSpec {
  label: string;
  permission: Permission;
  columns: Record<string, ColumnSpec>;
  template: string;
  example: string;
}

export const IMPORT_SPECS: Record<ImportKind, KindSpec> = {
  vehicles: {
    label: "vehicles",
    permission: "vehicles:create",
    template: "registration,category,make,model,seats,notes",
    example: "GT 1234-26,Coaster,Toyota,Coaster,22,",
    columns: {
      registration: { aliases: ["registration", "registration number", "reg", "plate"], required: true },
      category: { aliases: ["category", "vehicle category", "type"], required: true },
      make: { aliases: ["make", "manufacturer"], required: false },
      model: { aliases: ["model"], required: false },
      seats: { aliases: ["seats", "seat capacity", "capacity"], required: true },
      notes: { aliases: ["notes", "note", "remarks"], required: false },
    },
  },
  drivers: {
    label: "drivers",
    permission: "drivers:create",
    template: "name,phone,licence number,licence expiry,status",
    example: "Kofi Mensah,+233201234567,DL-001,2031-05-01,active",
    columns: {
      name: { aliases: ["name", "full name", "driver"], required: true },
      phone: { aliases: ["phone", "telephone", "mobile"], required: true },
      licence: { aliases: ["licence", "license", "licence number", "license number"], required: true },
      expiry: { aliases: ["licence expiry", "license expiry", "expiry", "expiry date"], required: true },
      status: { aliases: ["status"], required: false },
    },
  },
  clients: {
    label: "clients",
    permission: "clients:create",
    template: "name,contact name,contact phone,contact email,status",
    example: "Volta Foods Ltd,Efua Owusu,+233244000111,ops@example.test,active",
    columns: {
      name: { aliases: ["name", "client", "organisation", "organization", "company"], required: true },
      contact: { aliases: ["contact", "contact name", "contact person"], required: false },
      phone: { aliases: ["phone", "contact phone", "telephone"], required: false },
      email: { aliases: ["email", "contact email", "e-mail"], required: false },
      status: { aliases: ["status"], required: false },
    },
  },
};

/**
 * RFC 4180-ish reader: commas, double-quoted fields, `""` inside quotes, CRLF or LF, and newlines
 * inside quotes. A byte-order mark is ignored (Excel writes one). Blank trailing lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Skip rows that are entirely empty (a trailing newline, or blank lines between blocks).
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r" && input[i + 1] === "\n") {
      endRow();
      i += 2;
      continue;
    }
    if (char === "\n" || char === "\r") {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

export interface ImportRowResult {
  /** 1-based line in the file, counting the header, so the operator can look at the right row. */
  line: number;
  values: string[];
  outcome: "create" | "reject";
  message: string;
  errors: Record<string, string>;
}

export interface ImportPreview {
  kind: ImportKind;
  rows: ImportRowResult[];
  ready: number;
  rejected: number;
  /** Columns in the file that the importer does not use. Reported, not fatal. */
  ignoredColumns: string[];
  /** True when the file had more rows than MAX_IMPORT_ROWS and the tail was not read. */
  truncated: boolean;
}

export type PreviewOutcome =
  | { ok: true; preview: ImportPreview }
  | { ok: false; message: string; errors: Record<string, string> };

type ParseGuard =
  | { ok: true; table: string[][]; index: Record<string, number>; ignored: string[] }
  | { ok: false; message: string; errors: Record<string, string> };

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

function headerIndex(kind: ImportKind, header: string[]): { index: Record<string, number>; missing: string[]; ignored: string[] } {
  const spec = IMPORT_SPECS[kind];
  const index: Record<string, number> = {};
  const used = new Set<number>();
  for (const [field, column] of Object.entries(spec.columns)) {
    const at = header.findIndex((cell, position) => !used.has(position) && column.aliases.includes(norm(cell)));
    if (at >= 0) {
      index[field] = at;
      used.add(at);
    }
  }
  const missing = Object.entries(spec.columns)
    .filter(([field, column]) => column.required && index[field] === undefined)
    .map(([field]) => field);
  const ignored = header.filter((cell, position) => !used.has(position) && cell.trim() !== "");
  return { index, missing, ignored };
}

function cell(values: string[], index: Record<string, number>, field: string): string {
  const at = index[field];
  return at === undefined ? "" : (values[at] ?? "").trim();
}

/** Turns one row into the ordinary command a person would have sent by hand. */
function rowCommand(db: Database, kind: ImportKind, values: string[], index: Record<string, number>): { command: Command } | { error: string } {
  if (kind === "clients") {
    const input: ClientInput = {
      name: cell(values, index, "name"),
      contactName: cell(values, index, "contact"),
      contactPhone: cell(values, index, "phone"),
      contactEmail: cell(values, index, "email"),
      status: (cell(values, index, "status") || "active") as ClientStatus,
    };
    return { command: { type: "create_client", input } };
  }

  if (kind === "drivers") {
    const input: DriverInput = {
      fullName: cell(values, index, "name"),
      phone: cell(values, index, "phone"),
      licenceNumber: cell(values, index, "licence"),
      licenceExpiry: cell(values, index, "expiry"),
      status: (cell(values, index, "status") || "active") as DriverStatus,
    };
    return { command: { type: "create_driver", input } };
  }

  const categoryName = cell(values, index, "category");
  const category = db.settings.vehicleCategories.find((candidate) => norm(candidate.name) === norm(categoryName));
  if (!category) {
    const known = db.settings.vehicleCategories.map((c) => c.name);
    return {
      error: known.length
        ? `Category "${categoryName}" is not configured. Known categories: ${known.join(", ")}.`
        : "No vehicle categories are configured. Add them in Settings first.",
    };
  }
  const input: VehicleInput = {
    registration: cell(values, index, "registration"),
    categoryId: category.id,
    make: cell(values, index, "make"),
    model: cell(values, index, "model"),
    seatCapacity: cell(values, index, "seats"),
    notes: cell(values, index, "notes"),
  };
  return { command: { type: "create_vehicle", input } };
}

function runRows(db: Database, actor: Actor, kind: ImportKind, rows: string[][], index: Record<string, number>, now: string): { rows: ImportRowResult[]; db: Database } {
  let scratch = db;
  const results: ImportRowResult[] = [];
  rows.forEach((values, position) => {
    // +2: the header is line 1, and positions are 0-based.
    const line = position + 2;
    const mapped = rowCommand(scratch, kind, values, index);
    if ("error" in mapped) {
      results.push({ line, values, outcome: "reject", message: mapped.error, errors: {} });
      return;
    }
    const result: CommandResult = execute(scratch, actor, mapped.command, now);
    if (!result.ok) {
      results.push({ line, values, outcome: "reject", message: result.message, errors: result.errors });
      return;
    }
    scratch = result.db;
    results.push({ line, values, outcome: "create", message: result.message, errors: {} });
  });
  return { rows: results, db: scratch };
}

/** Size, permission and header checks, shared by the preview and the import. */
function readFile(kind: ImportKind, actor: Actor | null, csv: string): ParseGuard {
  if (!actor) return { ok: false, message: "Sign in is required.", errors: {} };
  if (!can(actor.role, IMPORT_SPECS[kind].permission)) {
    return { ok: false, message: `Not permitted: your role lacks ${IMPORT_SPECS[kind].permission}.`, errors: {} };
  }
  if (csv.length > MAX_IMPORT_BYTES) {
    return { ok: false, message: `That file is too large. Import at most ${Math.round(MAX_IMPORT_BYTES / 1000)} kB in one go.`, errors: {} };
  }
  const table = parseCsv(csv);
  if (table.length === 0) return { ok: false, message: "The file is empty.", errors: {} };
  const { index, missing, ignored } = headerIndex(kind, table[0]);
  if (missing.length) {
    return {
      ok: false,
      message: "The header row is missing required columns.",
      errors: Object.fromEntries(missing.map((field) => [field, `Add a "${field}" column. Expected: ${IMPORT_SPECS[kind].template}`])),
    };
  }
  return { ok: true, table, index, ignored };
}

/**
 * What the import would do, without doing it. Safe to call from the browser: it writes nothing
 * and only reads the snapshot the account already holds.
 */
export function previewImport(db: Database, actor: Actor | null, kind: ImportKind, csv: string, now: string = new Date().toISOString()): PreviewOutcome {
  const read = readFile(kind, actor, csv);
  if (!read.ok) return { ok: false, message: read.message, errors: read.errors };

  const dataRows = read.table.slice(1);
  const truncated = dataRows.length > MAX_IMPORT_ROWS;
  const run = runRows(db, actor!, kind, dataRows.slice(0, MAX_IMPORT_ROWS), read.index, now);
  const ready = run.rows.filter((row) => row.outcome === "create").length;
  return {
    ok: true,
    preview: { kind, rows: run.rows, ready, rejected: run.rows.length - ready, ignoredColumns: read.ignored, truncated },
  };
}

export type ImportCommand = { type: "import_records"; kind: ImportKind; csv: string };

export function isImportCommand(command: { type: string }): command is ImportCommand {
  return command.type === "import_records";
}

/** Applies the file. Each created record is audited individually, plus one summary entry. */
export function executeImport(db: Database, actor: Actor | null, command: ImportCommand, now: string = new Date().toISOString()): CommandResult {
  const spec = IMPORT_SPECS[command.kind];
  if (!spec) return { ok: false, message: "Unknown import type.", errors: {} };

  const read = readFile(command.kind, actor, command.csv);
  if (!read.ok) return { ok: false, message: read.message, errors: read.errors };

  const run = runRows(db, actor!, command.kind, read.table.slice(1, MAX_IMPORT_ROWS + 1), read.index, now);
  const created = run.rows.filter((row) => row.outcome === "create");
  const rejected = run.rows.filter((row) => row.outcome === "reject");

  if (created.length === 0) {
    return {
      ok: false,
      message: `Nothing was imported: all ${rejected.length} row${rejected.length === 1 ? "" : "s"} were rejected.`,
      errors: Object.fromEntries(rejected.slice(0, 8).map((row) => [`line ${row.line}`, Object.values(row.errors)[0] ?? row.message])),
    };
  }

  const named = rejected.slice(0, 5).map((row) => `line ${row.line} (${Object.values(row.errors)[0] ?? row.message})`);
  const more = rejected.length > named.length ? `, and ${rejected.length - named.length} more` : "";
  const message = rejected.length
    ? `Imported ${created.length} of ${run.rows.length} ${spec.label}. ${rejected.length} rejected: ${named.join("; ")}${more}.`
    : `Imported ${created.length} ${spec.label} from ${run.rows.length} row${run.rows.length === 1 ? "" : "s"}.`;

  const next = audit(run.db, actor, {
    action: `import:${command.kind}`,
    entity: "import",
    entityId: `import-${now}`,
    summary: `${message} Source: CSV upload.`,
  }, now);

  return { ok: true, db: next, message };
}
