"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface GlideOption {
  key: string;
  label: string;
}

/**
 * A segmented control whose highlight travels to the option you picked.
 *
 * The pill is one element that measures its target — `offsetLeft` and `offsetWidth` of the button
 * that is now active — and glides there on the glide curve, so the eye follows the choice instead of
 * re-finding it. The buttons underneath are the real control: a radio group, reachable by Tab and
 * steppable with the arrow keys, and the pill is decoration with no words of its own.
 *
 * Reduced motion is honoured in CSS (the token layer stops every transition), so the same control
 * simply appears in its new place for a reader who asked for that.
 */
export function GlidingTabs({
  options,
  value,
  onChange,
  ariaLabel,
  size = "sm",
  className,
}: {
  options: GlideOption[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const index = options.findIndex((option) => option.key === value);
    const button = buttonsRef.current[index];
    if (button) setPill({ left: button.offsetLeft, width: button.offsetWidth });
  }, [options, value]);

  // Measure before paint so the pill is never seen at the old place for a frame.
  useLayoutEffect(measure, [measure]);

  // A control can be resized with the window; the pill has to know.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [measure]);

  const move = (dir: 1 | -1) => {
    const index = options.findIndex((option) => option.key === value);
    const next = options[(index + dir + options.length) % options.length];
    if (next) onChange(next.key);
  };

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("relative inline-flex items-center gap-0.5 rounded-control border border-border bg-card p-0.5", className)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-0.5 bottom-0.5 rounded-[7px] bg-action shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] transition-[left,width,opacity] duration-[420ms] ease-[cubic-bezier(0.65,0,0.35,1)]",
          pill ? "opacity-100" : "opacity-0",
        )}
        style={{ left: pill?.left ?? 0, width: pill?.width ?? 0 }}
      />
      {options.map((option, index) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            ref={(node) => {
              buttonsRef.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.key)}
            className={cn(
              "relative z-10 rounded-[7px] font-medium transition-colors duration-200 focus-visible:outline-none",
              size === "sm" ? "px-3 py-1.5 text-[12px]" : "px-3.5 py-2 text-[13px]",
              active ? "text-action-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
