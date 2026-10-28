import { cn } from "@/lib/utils";

/**
 * Paper.
 *
 * An invoice, a credit note, a statement and the management report are one object seen four ways, and
 * they share one vocabulary. The sheet is white with dark ink whatever the screen's theme is: the page
 * in the preview and the page in the printer are the same page, and a customer's invoice is not a
 * dark-mode surface.
 *
 * These are presentation only. Every figure and every sentence arrives from the screen, because the
 * printed total must come from the same helper the screen used — a document that does its own
 * arithmetic is how paper starts disagreeing with the register.
 */

/** A right-aligned cell: money, counts, dates in a column. Tabular so the digits line up. */
export const NUM = "text-right tabular-nums whitespace-nowrap";

/** The document itself. */
export function Sheet({
  label,
  children,
  className,
}: {
  /** Spoken name: "Invoice INV-2026-0001". */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      aria-label={label}
      data-sheet
      className={cn(
        "mx-auto w-full max-w-[820px] bg-paper px-6 py-7 text-paper-ink shadow-pop ring-1 ring-black/10 sm:px-10 sm:py-9",
        "print:max-w-none print:px-0 print:py-0 print:shadow-none print:ring-0",
        className,
      )}
    >
      {children}
    </article>
  );
}

/** Who is billing, what the document is, and the number or period that identifies it. */
export function SheetHeader({
  docType,
  reference,
  state,
  companyName,
  referenceLabel = "Reference",
  subtitle,
}: {
  docType: string;
  reference: string;
  state: string;
  companyName: string | null;
  referenceLabel?: string;
  subtitle?: string;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-paper-ink pb-4">
      <div className="min-w-0">
        <p className={cn("text-[17px] leading-tight font-semibold tracking-[-0.01em]", !companyName && "italic text-paper-muted")}>
          {companyName ?? "Company name not set in Settings"}
        </p>
        <p className="mt-1 text-[10px] font-semibold tracking-[0.14em] text-paper-accent uppercase">{docType}</p>
        {subtitle && <p className="mt-1 max-w-[46ch] text-[11.5px] text-paper-muted">{subtitle}</p>}
      </div>
      <div className="text-right">
        <p className="text-[9px] font-semibold tracking-[0.12em] text-paper-muted uppercase">{referenceLabel}</p>
        <p className="tms-mono mt-0.5 text-[12.5px] tracking-normal text-paper-ink normal-case">{reference}</p>
        <p className="mt-1 text-[10px] font-medium tracking-[0.08em] text-paper-muted uppercase">{state}</p>
      </div>
    </header>
  );
}

/** The block of label and value pairs under the letterhead. */
export function SheetMeta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("mt-5 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4", className)}>{children}</dl>;
}

export function SheetMetaItem({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-semibold tracking-[0.12em] text-paper-muted uppercase">{label}</dt>
      <dd className="mt-1 truncate text-[12.5px] font-medium text-paper-ink">{value}</dd>
      {detail && <dd className="mt-0.5 text-[11px] leading-relaxed text-paper-muted">{detail}</dd>}
    </div>
  );
}

/**
 * Something the reader must see before any figure: a void document, or a report whose numbers are
 * withheld or estimated. Tone is never the only carrier — the sentence says it in words.
 */
export function SheetNotice({ tone, children }: { tone: "warning" | "void"; children: React.ReactNode }) {
  return (
    <p
      role="note"
      className={cn(
        "mt-4 border-l-[3px] px-3 py-2 text-[11.5px] leading-relaxed",
        tone === "void" ? "border-paper-void-ink bg-paper-void text-paper-void-ink" : "border-paper-warn-ink bg-paper-warn text-paper-warn-ink",
      )}
    >
      {children}
    </p>
  );
}

/** A table on paper: hairline rules, a quiet head, numbers aligned on the right. */
export function SheetTable({
  label,
  head,
  children,
  className,
}: {
  label: string;
  head: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <table aria-label={label} className={cn("mt-5 w-full border-collapse text-left text-[12px]", className)}>
      <thead>
        <tr className="border-b border-paper-line">
          {head}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

/** A cell in the sheet's body. `num` right-aligns and locks the digits to the tabular grid. */
export function SheetTd({
  children,
  num,
  mono,
  colSpan,
  className,
}: {
  children?: React.ReactNode;
  num?: boolean;
  mono?: boolean;
  colSpan?: number;
  className?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn("border-b border-paper-rule py-1.5 pr-3 align-top text-paper-ink last:pr-0", num && NUM, mono && "tms-mono tracking-normal normal-case", className)}
    >
      {children}
    </td>
  );
}

export function SheetTh({ children, num }: { children: React.ReactNode; num?: boolean }) {
  return (
    <th
      scope="col"
      className={cn("py-1.5 pr-3 text-[9px] font-semibold tracking-[0.1em] text-paper-muted uppercase last:pr-0", num ? NUM : "text-left")}
    >
      {children}
    </th>
  );
}

/** The totals block, set to the right so it reads as the end of the column above it. */
export function SheetTotals({ children }: { children: React.ReactNode }) {
  return <dl className="mt-4 ml-auto w-full max-w-[19rem] text-[12px]">{children}</dl>;
}

export function SheetRow({
  label,
  value,
  emphasis,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  /** "total" for the sum, "due" for the figure the reader must act on. */
  emphasis?: "total" | "due";
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-6 py-1",
        emphasis === "total" && "border-t border-paper-ink pt-1.5 font-semibold",
        emphasis === "due" && "mt-1 border-t-2 border-paper-ink pt-2 text-[13.5px] font-semibold",
      )}
    >
      <dt className={cn(emphasis ? "text-paper-ink" : "text-paper-muted")}>{label}</dt>
      <dd className="tabular-nums whitespace-nowrap text-paper-ink">{value}</dd>
    </div>
  );
}

/** The sentence that explains what the figures mean, where a person will actually read it. */
export function SheetWords({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 max-w-[62ch] text-[11px] leading-relaxed text-paper-muted">{children}</p>;
}

/** A labelled note: a payment term, a reason, a way to read the page. */
export function SheetNote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 border-t border-paper-rule pt-3">
      <p className="text-[9px] font-semibold tracking-[0.12em] text-paper-muted uppercase">{label}</p>
      <div className="mt-1 max-w-[78ch] text-[11px] leading-relaxed text-paper-ink">{children}</div>
    </div>
  );
}

/** A run of prose under a heading: the report's sections. */
export function SheetSection({
  title,
  intro,
  label,
  children,
}: {
  title?: string;
  intro?: string;
  label?: string;
  children?: React.ReactNode;
}) {
  return (
    <section aria-label={label ?? title} className="mt-6">
      {title && <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-paper-ink">{title}</h2>}
      {intro && <p className="mt-1 max-w-[70ch] text-[11px] leading-relaxed text-paper-muted">{intro}</p>}
      {children}
    </section>
  );
}

/** The foot of the sheet: what this paper is, and when it was printed. */
export function SheetFoot({ reference, printed }: { reference: string; printed: string }) {
  return (
    <footer className="mt-7 flex items-baseline justify-between gap-4 border-t border-paper-line pt-2 text-[9px] tracking-[0.1em] text-paper-muted uppercase">
      <span>{reference}</span>
      <span>{printed}</span>
    </footer>
  );
}
