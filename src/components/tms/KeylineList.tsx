import { cn } from "@/lib/utils";

/**
 * A list of figures that belong together, separated by hairlines: the age of the debt, the bands a
 * statement prints, the split of a cost. One row is the total and is marked as such — weight and a
 * rule, not a colour, so the figure still reads in greyscale and on paper.
 *
 * The component formats nothing. The screen has already decided what each figure is and which
 * currency it is in; a second formatter here is how two screens start disagreeing about the same
 * number.
 */
export function KeylineList({
  rows,
  total,
  className,
}: {
  rows: { key: string; label: string; hint?: string; value: string }[];
  total?: { label: string; hint?: string; value: string };
  className?: string;
}) {
  return (
    <dl className={cn("m-0", className)}>
      {rows.map((row, index) => (
        <div
          key={row.key}
          className={cn(
            "flex items-baseline justify-between gap-4 border-b border-divider py-2.5",
            index === 0 && "pt-0",
          )}
        >
          <dt className="min-w-0">
            <span className="block text-[13px] text-foreground">{row.label}</span>
            {row.hint && <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">{row.hint}</span>}
          </dt>
          <dd className="tms-num m-0 shrink-0 whitespace-nowrap text-foreground">{row.value}</dd>
        </div>
      ))}
      {total && (
        <div className="flex items-baseline justify-between gap-4 pt-2.5">
          <dt className="min-w-0">
            <span className="block text-[13px] font-semibold text-foreground">{total.label}</span>
            {total.hint && <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">{total.hint}</span>}
          </dt>
          <dd className="tms-num m-0 shrink-0 font-semibold whitespace-nowrap text-foreground">{total.value}</dd>
        </div>
      )}
    </dl>
  );
}
