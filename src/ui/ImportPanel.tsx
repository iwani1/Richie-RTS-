"use client";

// CSV import for master data (brief MIG-01, and the same pattern EMP-02 asks of employees).
//
// The panel never decides what is valid: it runs `previewImport` — the same function the server
// runs — against the snapshot this account already holds, shows the row-level result, and sends
// the file only when the operator confirms. The server re-runs the identical code before writing,
// so a preview taken minutes ago cannot smuggle a row past validation.
import { useMemo, useState } from "react";
import { IMPORT_SPECS, MAX_IMPORT_ROWS, previewImport, type ImportKind, type ImportPreview } from "../tms/import";
import { useTms } from "../tms/useTms";
import { Badge, Button, DataTable, Field, Notice, Panel, TextArea } from "./primitives";

const SHOWN = 100;

export function ImportPanel({ kind, onClose }: { kind: ImportKind; onClose: () => void }) {
  const { db, actor, dispatch, setFlash } = useTms();
  const spec = IMPORT_SPECS[kind];
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [problem, setProblem] = useState<{ message: string; errors: Record<string, string> } | null>(null);
  const [checkedText, setCheckedText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = preview !== null && checkedText !== text;
  const canRun = preview !== null && preview.ready > 0 && !dirty && !busy;

  const summary = useMemo(() => {
    if (!preview) return null;
    const parts = [`${preview.ready} ready`, `${preview.rejected} rejected`];
    if (preview.warned) parts.push(`${preview.warned} to check for a duplicate person`);
    if (preview.truncated) parts.push(`only the first ${MAX_IMPORT_ROWS} rows were read`);
    if (preview.ignoredColumns.length) parts.push(`ignored columns: ${preview.ignoredColumns.join(", ")}`);
    return parts.join(" · ");
  }, [preview]);

  const readFile = async (file: File | undefined) => {
    setProblem(null);
    setPreview(null);
    setCheckedText(null);
    setFileName(null);
    if (!file) return;
    const content = await file.text();
    setText(content);
    setFileName(file.name);
  };

  const check = () => {
    setProblem(null);
    const result = previewImport(db, actor, kind, text);
    if (!result.ok) {
      setPreview(null);
      setCheckedText(null);
      setProblem({ message: result.message, errors: result.errors });
      return;
    }
    setPreview(result.preview);
    setCheckedText(text);
  };

  const run = async () => {
    setBusy(true);
    const result = await dispatch({ type: "import_records", kind, csv: text });
    setBusy(false);
    if (!result.ok) {
      setProblem({ message: result.message, errors: result.errors });
      setFlash({ tone: "error", message: result.message });
      return;
    }
    setFlash({ tone: "success", message: result.message });
    onClose();
  };

  return (
    <Panel
      title={`Import ${spec.label} from CSV`}
      description="Nothing is saved until you check the file and confirm. Rejected rows are listed with the line number and the reason; no row is dropped silently."
      onClose={onClose}
    >
      <div className="space-y-4">
        <Notice tone="info" title="Template">
          <p className="font-mono text-xs break-all">{spec.template}</p>
          <p className="mt-1 text-xs">Example row: <span className="font-mono break-all">{spec.example}</span></p>
          <p className="mt-1 text-xs">Headers are matched case-insensitively and may be reordered. {spec.note}</p>
        </Notice>

        <Field label="CSV file" hint="One file at a time. Nothing leaves this screen until you confirm.">
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="rts-input"
            aria-label="CSV file"
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
        </Field>

        <Field label="Or paste the rows" hint={fileName ? `Loaded from ${fileName}` : undefined}>
          <TextArea
            rows={6}
            value={text}
            aria-label="CSV contents"
            placeholder={spec.template}
            onChange={(event) => {
              setText(event.target.value);
              setPreview(null);
              setProblem(null);
            }}
          />
        </Field>

        {problem && (
          <Notice tone="error" title={problem.message}>
            {Object.keys(problem.errors).length > 0 && (
              <ul className="mt-1 space-y-1 text-xs">
                {Object.entries(problem.errors).map(([field, message]) => (
                  <li key={field}>
                    <span className="font-mono">{field}</span>: {message}
                  </li>
                ))}
              </ul>
            )}
          </Notice>
        )}

        {preview && (
          <div className="space-y-3">
            <p role="status" className="text-xs text-stone-600">{summary}</p>
            {dirty && <Notice tone="warning" title="The file changed">Check it again before importing, so the counts match what will be saved.</Notice>}
            <DataTable
              rows={preview.rows.slice(0, SHOWN)}
              rowKey={(row) => String(row.line)}
              emptyState={<p className="text-sm text-stone-600">No data rows were found below the header.</p>}
              columns={[
                { key: "line", header: "Line", className: "rts-num", render: (row) => row.line },
                { key: "row", header: "Row", render: (row) => <span className="font-mono text-xs break-all">{row.values.filter(Boolean).slice(0, 4).join(" · ")}</span> },
                {
                  key: "outcome",
                  header: "Outcome",
                  render: (row) => (
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={row.outcome === "create" ? "success" : "error"}>{row.outcome === "create" ? "Will import" : "Rejected"}</Badge>
                      {/* A likely duplicate is not a rejection: a namesake is real. It is flagged, not blocked. */}
                      {row.warning && <Badge tone="warning">Check</Badge>}
                    </div>
                  ),
                },
                {
                  key: "why",
                  header: "Detail",
                  render: (row) =>
                    row.outcome === "create" ? (
                      <div className="text-xs text-stone-500">
                        <span>{row.message}</span>
                        {row.warning && <p className="mt-1 font-medium text-amber-800">{row.warning}</p>}
                      </div>
                    ) : (
                      <span className="text-xs">{Object.values(row.errors)[0] ?? row.message}</span>
                    ),
                },
              ]}
            />
            {preview.rows.length > SHOWN && <p className="text-xs text-stone-500">Showing the first {SHOWN} of {preview.rows.length} rows.</p>}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={check} disabled={!text.trim()}>Check file</Button>
          <Button type="button" variant="primary" onClick={() => void run()} disabled={!canRun}>
            {busy ? "Importing…" : preview && preview.ready > 0 ? `Import ${preview.ready} row${preview.ready === 1 ? "" : "s"}` : "Import"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
