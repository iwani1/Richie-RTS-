import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../utils/cn";
import { Icon } from "./icons";
import type { Tone } from "../tms/useTms";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({ variant = "secondary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={cn("rts-btn", variant !== "secondary" && `rts-btn--${variant}`, className)}
      {...props}
    />
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("rts-field", className)}>
      <span className="rts-label">{label}</span>
      {children}
      {hint && !error && <span className="rts-hint">{hint}</span>}
      {error && <span className="rts-error" role="alert">{error}</span>}
    </label>
  );
}

export function TextInput({ invalid, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  // The red border is the sighted cue; `aria-invalid` is the same fact for a screen reader, which
  // otherwise has to infer it from an error message it may have missed.
  return (
    <input
      className={cn("rts-input", invalid && "rts-input--invalid", className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

/**
 * A password field with a reveal control.
 *
 * Typing a password you cannot see is where most failed sign-ins come from, and this application
 * has no "reset it yourself" path — a wrong password means finding an administrator. The control is
 * a real button, announced as "Show password" / "Hide password" (the eye glyph alone carries no
 * meaning to a screen reader), and the state is carried by the glyph and its tooltip, not by colour.
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
    <span className="rts-input-wrap">
      <input
        ref={input}
        type={shown ? "text" : "password"}
        className={cn("rts-input", "rts-input--revealable", invalid && "rts-input--invalid", className)}
        aria-invalid={invalid || undefined}
        {...props}
      />
      <button
        type="button"
        className="rts-input-reveal"
        onClick={toggle}
        aria-label={shown ? "Hide password" : "Show password"}
        title={shown ? "Hide password" : "Show password"}
        data-shown={shown || undefined}
        // A click inside a <label> would otherwise be forwarded to the field it labels.
        onMouseDown={(event) => event.preventDefault()}
      >
        <Icon name={shown ? "eyeOff" : "eye"} width={16} height={16} />
      </button>
    </span>
  );
}

export function TextArea({ invalid, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn("rts-input", invalid && "rts-input--invalid", className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Select({ invalid, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={cn("rts-input", invalid && "rts-input--invalid", className)} aria-invalid={invalid || undefined} {...props}>
      {children}
    </select>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: Tone; title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rts-notice", `rts-notice--${tone}`, className)} role={tone === "error" ? "alert" : "status"}>
      {title && <p className="rts-notice-title">{title}</p>}
      {children}
    </div>
  );
}

export function Badge({ tone = "info", children }: { tone?: Tone | "neutral"; children: ReactNode }) {
  return <span className={cn("rts-badge", `rts-badge--${tone}`)}>{children}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="rts-page-head">
      <div className="min-w-0">
        <p className="rts-eyebrow">{eyebrow}</p>
        <h1 className="rts-title">{title}</h1>
        {description && <p className="rts-page-desc">{description}</p>}
      </div>
      {actions && <div className="rts-page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, actions, children, className }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rts-card", className)}>
      {(title || actions) && (
        <header className="rts-card-head">
          <div className="rts-head-text">
            {title && <h2 className="rts-card-title">{title}</h2>}
            {description && <p className="rts-card-desc">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="rts-card-body">{children}</div>
    </section>
  );
}

/**
 * A band is one horizontal rule of the sheet: a label column on the left, the work on the right.
 * Screens use bands for the big sections of a page, so the page reads as a pre-printed form rather
 * than a stack of boxes. `Card` remains for sections that need a heavier top rule inside a band.
 */
export function Band({ label, note, actions, id, className, children }: { label: string; note?: string; actions?: ReactNode; id?: string; className?: string; children: ReactNode }) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className={cn("rts-band", className)} aria-labelledby={headingId}>
      <div className="rts-band-label">
        <div className="rts-head-text">
          <h2 id={headingId} className="rts-band-title">{label}</h2>
          {note && <p className="rts-band-note">{note}</p>}
        </div>
        {actions && <div className="rts-band-actions">{actions}</div>}
      </div>
      <div className="rts-band-body">{children}</div>
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rts-empty">
      <h3>{title}</h3>
      <p>{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** A search field with its icon inside the control, sized for a card header or filter bar. */
export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={cn("rts-search", className)}>
      <svg className="rts-search-icon" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" focusable="false">
        <circle cx="9" cy="9" r="5.5" />
        <path d="m13.5 13.5 3 3" />
      </svg>
      <input className="rts-search-input" type="search" {...props} />
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
    <section className="rts-card rts-table-card">
      <div className="rts-card-head">
        <div className="rts-head-text">
          <h2 className="rts-card-title">{title}</h2>
          {summary && <p className="rts-card-desc">{summary}</p>}
        </div>
        {actions && <div className="rts-band-actions">{actions}</div>}
      </div>
      {toolbar && <div className="rts-filter-bar">{toolbar}</div>}
      <div className="rts-card-body rts-card-body--flush">{children}</div>
    </section>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, emptyState }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; emptyState: ReactNode }) {
  if (rows.length === 0) return <>{emptyState}</>;
  return (
    <div className="rts-table-wrap">
      <table className="rts-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.className}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A side panel that behaves like a dialog.
 *
 * `role="dialog" aria-modal="true"` describes an intent the browser does not enforce on its own:
 * without a focus trap, Tab walked out of the open panel into the page behind it, and without
 * Escape or a focus restore a keyboard user could not get back to the control they came from
 * (audit F-13). The scrim keeps its click-to-close behaviour but is no longer a second, invisible
 * "Close" button in the tab order — Escape and the header button are the accessible paths.
 */
export function Panel({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panel.current;
    const focusable = () =>
      Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        // Not `offsetParent`: layout is not available in every environment this runs in, and an
        // element inside a hidden subtree is excluded by the attribute check instead.
        (element) => !element.hasAttribute("hidden") && element.closest('[hidden],[aria-hidden="true"]') === null,
      );

    (focusable()[0] ?? node)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreTo.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="rts-panel-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className="rts-panel-scrim" aria-hidden="true" onClick={onClose} />
      <div className="rts-panel" ref={panel} tabIndex={-1}>
        <header className="rts-panel-head">
          <div className="min-w-0">
            <h2 className="rts-panel-title">{title}</h2>
            {description && <p className="rts-panel-desc">{description}</p>}
          </div>
          <button type="button" className="rts-panel-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        <div className="rts-panel-body">{children}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, caption }: { label: string; value: string | number; caption?: string }) {
  return (
    <div className="rts-stat">
      <p className="rts-stat-label">{label}</p>
      <p className="rts-stat-value">{value}</p>
      {caption && <p className="rts-stat-caption">{caption}</p>}
    </div>
  );
}

export const formatDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const formatDate = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString(undefined, { dateStyle: "medium" });
};
export const todayYmd = () => new Date().toISOString().slice(0, 10);
