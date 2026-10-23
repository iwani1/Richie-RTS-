import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../utils/cn";
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
  return <input className={cn("rts-input", invalid && "rts-input--invalid", className)} {...props} />;
}

export function TextArea({ invalid, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={cn("rts-input", invalid && "rts-input--invalid", className)} {...props} />;
}

export function Select({ invalid, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={cn("rts-input", invalid && "rts-input--invalid", className)} {...props}>
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

export function Panel({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="rts-panel-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="rts-panel-scrim" aria-label="Close panel" onClick={onClose} />
      <div className="rts-panel">
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
