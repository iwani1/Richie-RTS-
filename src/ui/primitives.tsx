import { useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, CircleAlert, CircleCheck, Eye, EyeOff, Info, Search, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge as ShadBadge } from "@/components/ui/badge";
import { Button as ShadButton } from "@/components/ui/button";
import { Card as ShadCard, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { nextSort, sortOf, type TableSort } from "./tableSort";
import { useDialogFocus } from "./useDialogFocus";
import type { Tone } from "../tms/useTms";

/*
 * The product's own vocabulary, expressed entirely in shadcn/ui components and Tailwind tokens.
 *
 * Every exported name and prop here predates the migration: thirty screens already call them, so
 * the surface stays identical while the inside is replaced. No colour is written anywhere in this
 * file — a component asks for `bg-primary`, `text-muted-foreground` or `border-border` and the
 * token layer decides what that is.
 */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANT: Record<ButtonVariant, "default" | "outline" | "ghost" | "destructive"> = {
  primary: "default",
  secondary: "outline",
  ghost: "ghost",
  danger: "destructive",
};

export function Button({
  variant = "secondary",
  size = "sm",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "icon" }) {
  return (
    <ShadButton
      type="button"
      variant={BUTTON_VARIANT[variant]}
      // A dense back office: the default shadcn button is a shop-front size, one step down is a
      // desk size, and `sm` keeps row actions quiet without making them fiddly. `icon` is the
      // square control used beside a field or in a card header.
      size={size === "icon" ? "icon-sm" : size === "md" ? "default" : "sm"}
      className={cn(variant === "primary" && "shadow-sm", className)}
      {...props}
    />
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <Label className="text-[13px] font-medium text-foreground">{label}</Label>
      {children}
      {hint && !error && <span className="block text-xs text-muted-foreground">{hint}</span>}
      {error && (
        <span role="alert" className="flex items-start gap-1.5 text-xs font-medium text-destructive">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </span>
      )}
    </label>
  );
}

export function TextInput({ invalid, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  // The ring is the sighted cue; `aria-invalid` is the same fact for a screen reader, which
  // otherwise has to infer it from an error message it may have missed.
  return <Input className={cn("h-9 bg-card", className)} aria-invalid={invalid || undefined} {...props} />;
}

/**
 * A password field with a reveal control.
 *
 * Typing a password you cannot see is where most failed sign-ins come from, and this application
 * has no "reset it yourself" path — a wrong password means finding an administrator. The control is
 * a real button, announced as "Show password" / "Hide password" (the eye glyph alone carries no
 * meaning to a screen reader), and the state is carried by the glyph and its label, not by colour.
 *
 * Toggling keeps the caret where it was: the field is re-rendered with a different `type`, which
 * resets the selection in some browsers, and losing your place mid-typing is worse than no toggle.
 */
export function PasswordInput({ invalid, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const [shown, setShown] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<{ start: number | null; end: number | null } | null>(null);

  useLayoutEffect(() => {
    const field = input.current;
    if (!field || !caret.current) return;
    if (caret.current.start !== null) field.setSelectionRange(caret.current.start, caret.current.end);
    caret.current = null;
  }, [shown]);

  const toggle = () => {
    const field = input.current;
    // Only worth restoring when the field has focus: a blurred field has no caret to lose, and
    // selecting its text would be a surprise.
    caret.current = field && document.activeElement === field ? { start: field.selectionStart, end: field.selectionEnd } : null;
    setShown((value) => !value);
  };

  return (
    <span className="relative block">
      <Input
        ref={input}
        type={shown ? "text" : "password"}
        className={cn("h-9 bg-card pr-10", className)}
        aria-invalid={invalid || undefined}
        {...props}
      />
      <ShadButton
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={toggle}
        aria-label={shown ? "Hide password" : "Show password"}
        title={shown ? "Hide password" : "Show password"}
        // A click inside a <label> would otherwise be forwarded to the field it labels.
        onMouseDown={(event) => event.preventDefault()}
      >
        {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </ShadButton>
    </span>
  );
}

export function TextArea({ invalid, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-xs",
        "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 outline-none",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Select({ invalid, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cn(
        "h-9 w-full appearance-none rounded-md border border-input bg-card bg-[length:16px] bg-[right_0.5rem_center] bg-no-repeat",
        "px-3 pr-8 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 outline-none",
        "aria-invalid:border-destructive",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235c6472' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      aria-invalid={invalid || undefined}
      {...props}
    >
      {children}
    </select>
  );
}

const NOTICE: Record<Tone, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "border-border bg-card text-foreground" },
  success: { icon: CircleCheck, className: "border-primary/25 bg-primary/5 text-foreground" },
  warning: { icon: TriangleAlert, className: "border-amber-700/25 bg-amber-700/5 text-foreground" },
  error: { icon: CircleAlert, className: "border-destructive/25 bg-destructive/5 text-foreground" },
};

const NOTICE_ICON_INK: Record<Tone, string> = {
  info: "text-muted-foreground",
  success: "text-primary",
  warning: "text-amber-700",
  error: "text-destructive",
};

export function Notice({ tone = "info", title, children, className }: { tone?: Tone; title?: string; children: ReactNode; className?: string }) {
  const { icon: Glyph, className: surface } = NOTICE[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm", surface, className)} role={tone === "error" ? "alert" : "status"}>
      <Glyph className={cn("mt-0.5 size-4 shrink-0", NOTICE_ICON_INK[tone])} aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium text-foreground">{title}</p>}
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

const BADGE: Record<Tone | "neutral", { variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
  info: { variant: "outline", className: "border-primary/25 bg-primary/5 text-primary" },
  success: { variant: "outline", className: "border-emerald-700/25 bg-emerald-700/5 text-emerald-700" },
  warning: { variant: "outline", className: "border-amber-700/25 bg-amber-700/5 text-amber-700" },
  error: { variant: "outline", className: "border-destructive/25 bg-destructive/5 text-destructive" },
  neutral: { variant: "secondary", className: "text-muted-foreground" },
};

export function Badge({ tone = "info", children }: { tone?: Tone | "neutral"; children: ReactNode }) {
  const { variant, className } = BADGE[tone];
  return (
    <ShadBadge variant={variant} className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium", className)}>
      {children}
    </ShadBadge>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div className="min-w-0 space-y-1">
        <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</p>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">{title}</h1>
        {description && <p className="max-w-[78ch] text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, actions, children, className }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section>
    <ShadCard className={cn("gap-0 overflow-hidden py-0 shadow-xs", className)}>
      {(title || actions) && (
        <CardHeader className="flex flex-row items-start gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            {title && <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>}
            {description && <CardDescription className="text-xs">{description}</CardDescription>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </CardHeader>
      )}
      <CardContent className="px-4 py-4">{children}</CardContent>
    </ShadCard>
    </section>
  );
}

/**
 * A section of a page: a label and its note above the work, separated by a rule rather than boxed in
 * a card. `Card` remains for sections that need a border and a surface of their own.
 */
export function Band({ label, note, actions, id, className, children }: { label: string; note?: string; actions?: ReactNode; id?: string; className?: string; children: ReactNode }) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className={cn("space-y-3", className)} aria-labelledby={headingId}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-2">
        <div className="min-w-0 space-y-0.5">
          <h2 id={headingId} className="text-sm font-semibold tracking-[-0.01em] text-foreground">{label}</h2>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="max-w-[46ch] text-[13px] text-muted-foreground">{body}</p>
      {action && <div className="mt-2 flex justify-center">{action}</div>}
    </div>
  );
}

/** A search field with its icon inside the control, sized for a card header or filter bar. */
export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={cn("relative block w-full max-w-xs", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input type="search" className="h-9 bg-card pl-8" {...props} />
    </span>
  );
}

/**
 * The shell every register uses: a card with a title, the sentence that counts the rows, the
 * screen's filters, and the table flush to the card's edges. Keeping the filter row inside the card
 * is what stops a register from looking like a table dropped on a canvas.
 */
export function TableCard({
  title,
  summary,
  actions,
  toolbar,
  children,
}: {
  title: string;
  summary?: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
    <ShadCard className="gap-0 overflow-hidden py-0 shadow-xs">
      <CardHeader className="flex flex-row items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
          {summary && <CardDescription className="text-xs">{summary}</CardDescription>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </CardHeader>
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2">{toolbar}</div>}
      <CardContent className="p-0">{children}</CardContent>
    </ShadCard>
    </section>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  /** How to read one value for sorting. A column without this is not sortable. */
  sortValue?: (row: T) => string | number;
}

/**
 * A table of rows.
 *
 * Sorting is opt-in and belongs to the screen: a column is sortable only when it says how to read
 * its value *and* the screen passes the sort with the callback that changes it (`useTableSort` in
 * `tableSort.ts` holds both). The table never sorts by itself, so the order on screen is the order
 * the screen exports. The header keeps `aria-sort`, which is how a screen reader learns which column
 * is in play and which way round; the arrow is decoration and is hidden from it, because the state
 * is already spoken.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyState,
  sort,
  onSortChange,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyState: ReactNode;
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort | null) => void;
}) {
  if (rows.length === 0) return <>{emptyState}</>;
  return (
    <div className="w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => {
              const sortable = Boolean(c.sortValue && onSortChange);
              const state = sortable ? sortOf(sort, c.key) : null;
              const Arrow = state === "ascending" ? ChevronUp : state === "descending" ? ChevronDown : ChevronsUpDown;
              return (
                <TableHead
                  key={c.key}
                  scope="col"
                  className={cn("h-9 bg-muted/40 px-3 font-mono text-[10px] font-medium tracking-[0.1em] text-muted-foreground uppercase", c.className)}
                  // Only a sortable column carries the attribute: `aria-sort="none"` on a column that
                  // cannot be sorted invites a reader to try.
                  {...(state ? { "aria-sort": state } : {})}
                >
                  {sortable && onSortChange ? (
                    <button
                      type="button"
                      className="group -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-inherit uppercase hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                      aria-label={`Sort by ${c.header}`}
                      onClick={() => onSortChange(nextSort(sort ?? null, c.key))}
                    >
                      <span>{c.header}</span>
                      <Arrow
                        className={cn("size-3 shrink-0", state ? "text-foreground" : "text-muted-foreground/60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((c) => (
                <TableCell key={c.key} className={cn("h-11 px-3 py-2 text-[13px]", c.className)}>
                  {c.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * A side panel that behaves like a dialog.
 *
 * Built on shadcn's `Dialog`, so the focus trap, Escape, the scroll lock and the focus restore are
 * radix's rather than ours — the earlier hand-rolled version had to reconstruct all four (audit
 * F-13). `role`, `aria-modal` and the label come with the primitive; the sheet keeps its
 * "Close" wording so nothing a test or a reader relied on has moved.
 */
export function Panel({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // Radix gives the modal surface, the portal and the scroll lock; this hook keeps the keyboard
  // contract the rest of the application already relies on (focus in, Tab stays, Escape, restore).
  useDialogFocus(panel, onClose);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        ref={panel}
        className="max-h-[92vh] max-w-2xl gap-0 overflow-hidden p-0 sm:max-w-2xl"
        aria-label={title}
        // One Close, and it is the one in the header with a word on it: shadcn's built-in
        // corner button would be a second, silent route to the same action.
        showCloseButton={false}
        // The panel is a form surface: it should be as wide as the work is, and scroll inside
        // rather than pushing the page behind it.
      >
        <div className="flex items-start gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1 space-y-1">
            <DialogTitle className="text-base font-semibold tracking-[-0.015em]">{title}</DialogTitle>
            {description && <DialogDescription className="text-[13px]">{description}</DialogDescription>}
          </div>
          <ShadButton type="button" variant="ghost" size="sm" onClick={onClose} className="-mr-2 text-muted-foreground">
            <X aria-hidden="true" />
            Close
          </ShadButton>
        </div>
        <div className="max-h-[calc(92vh-4.5rem)] overflow-y-auto px-5 py-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function Stat({ label, value, caption }: { label: string; value: string | number; caption?: string }) {
  return (
    <div data-slot="stat" className="space-y-1.5 p-4">
      <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">{label}</p>
      <p className="text-[28px] leading-none font-semibold tracking-[-0.04em] text-foreground tabular-nums">{value}</p>
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}

export { Separator, Dialog };

// The formatters moved to `@/lib/format` (Phase 78): a formatter is not a component, and the rebuilt
// screens import it from there. Re-exported so the screens still on this layer keep compiling, and so
// there is exactly one implementation of each.
export { formatDate, formatDateTime, todayYmd } from "@/lib/format";
