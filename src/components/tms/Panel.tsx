import { cn } from "@/lib/utils";

/**
 * The one card. A mono kicker says what the card is measuring, a title says it in words, and the
 * action slot holds at most one control.
 *
 * Cards are static surfaces — a 1px edge and a 1px inset highlight. Depth on this screen comes from
 * contrast and spacing, not from drop shadows.
 */
export function Panel({
  kicker,
  title,
  description,
  action,
  children,
  footer,
  bodyClassName,
  className,
  as: Shell = "section",
}: {
  kicker?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  bodyClassName?: string;
  className?: string;
  as?: "section" | "div";
}) {
  return (
    <Shell className={cn("tms-surface flex min-w-0 flex-col overflow-hidden", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0">
          {kicker && <p className="tms-mono text-dim">{kicker}</p>}
          <h2 className="mt-1 text-[15px] leading-tight font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
          {description && <p className="mt-1 max-w-[52ch] text-[12px] leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
      </div>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
      {footer && <div className="border-t border-divider px-4 py-2.5">{footer}</div>}
    </Shell>
  );
}
