import { cn } from "@/lib/utils";

/**
 * A row of recorded counts that belong together: the states of a register, the coverage figures
 * under a total. Bordered cells, so a reader sees where one figure ends and the next begins, and
 * the label is above the number in the mono caption style the rest of the product uses.
 *
 * The figures are the screen's: this component counts nothing and formats nothing. A `value` may be
 * a number or an already-formatted string ("62%", "—"), because a percentage that this component
 * rounded would be a second opinion about the same number.
 */
export function FigureStrip({
  figures,
  className,
}: {
  figures: { label: string; value: number | string }[];
  className?: string;
}) {
  return (
    <dl
      className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-control border border-border bg-border sm:grid-cols-3", className)}
    >
      {figures.map((figure) => (
        <div key={figure.label} className="min-w-0 bg-card px-3 py-2.5">
          <dt className="tms-mono leading-tight text-muted-foreground">{figure.label}</dt>
          <dd className="mt-1 text-[20px] leading-none font-semibold text-foreground tabular-nums">{figure.value}</dd>
        </div>
      ))}
    </dl>
  );
}
