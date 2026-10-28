// The management report on paper (RPT-05, D-98).
//
// The sheet is the same A4 page the invoice and the statement use — `components/tms/Sheet` — and it is
// printed the same way: the browser's own print engine, which already knows the page size, the margins
// and how to write a PDF. There is no PDF library in this build, and adding one would put a second
// rendering engine beside the one on the machine — a second thing that can disagree with what the
// reader checked.
//
// What the paper keeps from the screen (D-87): white with dark ink whatever the theme, no tints as the
// carrier of a state, money in the tabular figures lining up on the right, and the one accent used once,
// as an eyebrow over the document type.
import type { PrintableReport } from "../tms/printableReport";
import { formatDate } from "@/lib/format";
import { PrintPreview } from "@/components/tms/PrintPreview";
import {
  NUM,
  Sheet,
  SheetFoot,
  SheetHeader,
  SheetNote,
  SheetNotice,
  SheetSection,
  SheetTable,
  SheetTd,
  SheetTh,
} from "@/components/tms/Sheet";

/** The figures at the top of the sheet: each number with the sentence that qualifies it. */
function FigureGrid({ figures }: { figures: PrintableReport["figures"] }) {
  return (
    <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-paper-rule py-4 sm:grid-cols-4">
      {figures.map((figure) => (
        <div key={figure.label} className="min-w-0">
          <dt className="text-[9px] font-semibold tracking-[0.12em] text-paper-muted uppercase">{figure.label}</dt>
          <dd className="mt-1 text-[17px] leading-none font-semibold tracking-[-0.02em] text-paper-ink tabular-nums">
            {figure.value}
          </dd>
          <dd className="mt-1 text-[10px] leading-snug text-paper-muted">{figure.note}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ section }: { section: PrintableReport["sections"][number] }) {
  return (
    <SheetSection title={section.title} intro={section.intro}>
      {section.rows.length === 0 ? (
        <p className="mt-2 border border-dashed border-paper-line px-3 py-2 text-[11px] text-paper-muted">{section.empty}</p>
      ) : (
        <SheetTable
          label={section.title}
          className="mt-2"
          head={section.columns.map((column, index) => (
            <SheetTh key={column} num={Boolean(section.numeric) && index > 0}>
              {column}
            </SheetTh>
          ))}
        >
          {section.rows.map((row, rowIndex) => (
            <tr key={`${section.id}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <SheetTd key={`${section.id}-${rowIndex}-${cellIndex}`} num={cellIndex > 0}>
                  {cell}
                </SheetTd>
              ))}
            </tr>
          ))}
        </SheetTable>
      )}
    </SheetSection>
  );
}

/** The sheet itself, without the toolbar: this is exactly what a printer receives. */
export function ReportSheet({ report }: { report: PrintableReport }) {
  return (
    <Sheet label={`${report.title}, ${report.period.from} to ${report.period.to}`}>
      <SheetHeader
        docType={report.title}
        reference={`${formatDate(report.period.from)} – ${formatDate(report.period.to)}`}
        referenceLabel="Period"
        subtitle={report.subtitle}
        // The state is on the sheet as text, not as a colour: a withheld amount must read as withheld.
        state={`Printing ${report.reference}`}
        companyName={report.companyName}
      />

      {/* The state comes before any figure, so a withheld amount is read as withheld and not as zero. */}
      <SheetNotice tone={report.state === "withheld" ? "void" : "warning"}>
        <strong>{report.stateLabel}.</strong> {report.stateDetail}
      </SheetNotice>

      <FigureGrid figures={report.figures} />

      {report.sections.map((section) => (
        <Section key={section.id} section={section} />
      ))}

      <SheetSection
        title="What these figures do not include"
        intro="The counts below are printed so the report can be read honestly: they are the records the figures above could not use."
      >
        <dl className="mt-3 border-t border-paper-rule">
          {report.coverage.map((item) => (
            <div key={item.label} className="flex items-baseline justify-between gap-6 border-b border-paper-rule py-1.5">
              <dt className="text-[11px] text-paper-ink">
                {item.label}
                <span className="mt-0.5 block text-[10px] leading-snug text-paper-muted">{item.note}</span>
              </dt>
              <dd className={`text-[11.5px] text-paper-ink ${NUM}`}>{item.value}</dd>
            </div>
          ))}
        </dl>
      </SheetSection>

      <SheetNote label="How to read this page">
        <ul className="list-disc space-y-1 pl-4">
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </SheetNote>

      <SheetFoot reference={report.reference} printed={`Printed ${formatDate(report.generatedAt.slice(0, 10))}`} />
    </Sheet>
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
