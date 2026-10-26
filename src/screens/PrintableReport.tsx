// The management report on paper (RPT-05, D-98).
//
// The sheet is the same A4 page the invoice and the statement use, and it is printed the same way:
// the browser's own print engine, which already knows the page size, the margins and how to write a
// PDF. There is no PDF library in this build, and adding one would put a second rendering engine
// beside the one on the machine — a second thing that can disagree with what the reader checked.
//
// What the paper keeps from the screen (D-87): white with dark ink whatever the theme, no tints as
// the carrier of a state, money in the monospaced face lining up on the right, and the one accent
// used once, as an eyebrow over the document type.
import { PrintPreview } from "./Documents";
import type { PrintableReport } from "../tms/printableReport";
import { formatDate } from "../ui/primitives";

/** The figures at the top of the sheet: eight numbers, each with the sentence that qualifies it. */
function FigureGrid({ figures }: { figures: PrintableReport["figures"] }) {
  return (
    <div className="rts-sheet-figures">
      {figures.map((figure) => (
        <div key={figure.label} className="rts-sheet-fig">
          <p className="rts-sheet-label">{figure.label}</p>
          <p className="rts-sheet-fig-value">{figure.value}</p>
          <p className="rts-sheet-fig-note">{figure.note}</p>
        </div>
      ))}
    </div>
  );
}

function Section({ section }: { section: PrintableReport["sections"][number] }) {
  return (
    <section className="rts-sheet-section">
      <h2 className="rts-sheet-section-title">{section.title}</h2>
      <p className="rts-sheet-section-intro">{section.intro}</p>
      {section.rows.length === 0 ? (
        <p className="rts-sheet-empty">{section.empty}</p>
      ) : (
        <table className="rts-sheet-table">
          <thead>
            <tr>
              {section.columns.map((column, index) => (
                <th key={column} className={index > 0 && section.numeric ? "rts-sheet-num" : undefined}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row, rowIndex) => (
              <tr key={`${section.id}-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${section.id}-${rowIndex}-${cellIndex}`}
                    className={cellIndex === 0 ? undefined : "rts-sheet-num"}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** The sheet itself, without the toolbar: this is exactly what a printer receives. */
export function ReportSheet({ report }: { report: PrintableReport }) {
  return (
    <article className="rts-sheet" aria-label={`${report.title}, ${report.period.from} to ${report.period.to}`}>
      <header className="rts-sheet-top">
        <div className="rts-sheet-issuer">
          <p className={report.companyName ? "rts-sheet-company" : "rts-sheet-company rts-sheet-company--missing"}>
            {report.companyName ?? "Company name not set in Settings"}
          </p>
          <p className="rts-sheet-doctype">{report.title}</p>
          <p className="rts-sheet-value">{report.subtitle}</p>
        </div>
        <div className="rts-sheet-id">
          <p className="rts-sheet-label">Period</p>
          <p className="rts-sheet-reference">{`${formatDate(report.period.from)} – ${formatDate(report.period.to)}`}</p>
          <p className="rts-sheet-state">Printing {report.reference}</p>
        </div>
      </header>

      {/* The state comes before any figure, so a withheld amount is read as withheld and not as zero. */}
      <p className={report.state === "withheld" ? "rts-sheet-void" : "rts-sheet-note rts-sheet-state-line"}>
        <strong>{report.stateLabel}.</strong> {report.stateDetail}
      </p>

      <FigureGrid figures={report.figures} />

      {report.sections.map((section) => (
        <Section key={section.id} section={section} />
      ))}

      <section className="rts-sheet-section">
        <h2 className="rts-sheet-section-title">What these figures do not include</h2>
        <p className="rts-sheet-section-intro">
          The counts below are printed so the report can be read honestly: they are the records the figures above could not use.
        </p>
        <dl className="rts-sheet-coverage">
          {report.coverage.map((item) => (
            <div key={item.label} className="rts-sheet-coverage-row">
              <dt>
                {item.label}
                <span className="rts-sheet-coverage-note">{item.note}</span>
              </dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="rts-sheet-note">
        <p className="rts-sheet-label">How to read this page</p>
        <ul className="rts-sheet-note-list">
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>

      <footer className="rts-sheet-foot">
        <span>{report.reference}</span>
        <span>Printed {formatDate(report.generatedAt.slice(0, 10))}</span>
      </footer>
    </article>
  );
}

/** The preview: the sheet, the print command, and the note about saving it as a PDF. */
export function ReportPrintPreview({ report, onClose }: { report: PrintableReport; onClose: () => void }) {
  return (
    <PrintPreview label={`${report.title} · ${report.period.from} to ${report.period.to}`} onClose={onClose}>
      <ReportSheet report={report} />
    </PrintPreview>
  );
}
