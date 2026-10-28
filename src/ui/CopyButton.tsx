"use client";

// Copying a reference, so it can be pasted rather than read out (D-111).
//
// The office chases money and answers questions on the phone: "what is my invoice number?", "which
// booking is this?". Reading a reference aloud invites a wrong digit, and until now the only way to
// get one out of this program was to retype it. This button puts it on the clipboard.
//
// Two deliberate choices:
//
//   * **The confirmation is text in a live region, not a colour or a tick that fades.** A button that
//     turns green and back is invisible to somebody using a screen reader, and a tick that appears for
//     a second is easy to miss. The word "Copied" is announced, and the button's own accessible name
//     stays the same so a keyboard user's focus does not appear to move to a different control.
//   * **No animation.** It is a button that does a thing; the design direction has no decorative
//     motion, and a flourish on a copy is exactly the sort of gesture that ages badly.
import { useEffect, useRef, useState } from "react";
import { Button } from "./primitives";
import { cn } from "../utils/cn";

type CopyState = "idle" | "copied" | "failed";

/** How long the confirmation stays before the button goes back to "Copy". */
const NOTE_MS = 4000;

/**
 * Puts `value` on the clipboard, or says it could not.
 *
 * The asynchronous Clipboard API is the right one, but it is refused outside a secure context (an
 * office machine reached over plain http on the local network is not one) and by some browsers in an
 * embedded view. The fallback selects a temporary textarea and copies that — deprecated, but it is the
 * only route left, and a button that silently does nothing is worse than a deprecated call.
 */
async function writeToClipboard(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the textarea.
  }

  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    // Off-screen rather than display:none: a hidden element cannot be selected, and selecting it is
    // the whole mechanism.
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand?.("copy") ?? false;
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

export function CopyButton({ value, what, className }: { value: string; what: string; className?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A confirmation left behind by an unmounted screen is a React warning and a pointless timer.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    const copied = await writeToClipboard(value);
    setState(copied ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), NOTE_MS);
  };

  return (
    <span className={cn("inline-flex items-center", className)}>
      {/* Fixed width, so a table cell does not jump when it reads "Copied". */}
      <Button variant="ghost" size="sm" className="min-w-[62px]" onClick={copy} aria-label={`Copy ${what} ${value}`}>
        {state === "copied" ? "Copied" : state === "failed" ? "Not copied" : "Copy"}
      </Button>
      {/* Announced rather than shown: the button's own label is the visible confirmation. */}
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied"
          ? `${what.charAt(0).toUpperCase()}${what.slice(1)} ${value} copied.`
          : state === "failed"
            ? "The browser would not copy it. Select the number and copy it by hand."
            : ""}
      </span>
    </span>
  );
}
