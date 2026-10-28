"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/ui/useDialogFocus";
import { useTms } from "@/tms/useTms";

/**
 * The preview, and the only place the print command is triggered.
 *
 * Rendered into `document.body` rather than inside the shell, so the printable page is the sheet and
 * nothing else: the shell would otherwise be dragged onto the paper with it. The document title is set
 * to the document's own name while the overlay is open, because that is the name the browser offers in
 * "Save as PDF" — the file a customer receives is named after the paper, not after the product.
 *
 * No PDF library. The browser already knows the page size, the margins and how to write a file; a
 * second rendering engine would be a second thing that can disagree with what was checked on screen.
 */
export function PrintPreview({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const { db } = useTms();
  const root = useRef<HTMLDivElement>(null);
  useDialogFocus(root, onClose);

  // The preview only ever mounts from a click, so it is never part of a server render and the portal
  // always has a document to attach to.
  useEffect(() => {
    const previous = document.title;
    document.title = label;
    return () => {
      document.title = previous;
    };
  }, [label]);

  return createPortal(
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Print preview: ${label}`}
      data-print-overlay
      className="fixed inset-0 z-50 flex flex-col bg-background/96 backdrop-blur-sm focus-visible:outline-none"
    >
      <div
        data-print-bar
        className="tms-print-hide flex flex-wrap items-start justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-6"
      >
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">{label}</p>
          <p className="mt-0.5 max-w-[70ch] text-[12px] leading-relaxed text-muted-foreground">
            Print this page, or choose “Save as PDF” in the print dialog to send it as a file.
            {!db.settings.companyName &&
              " The company name is not set in Settings, so this document carries no supplier name yet."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={() => window.print()} className="tms-press">
            <Printer className="size-4" aria-hidden="true" />
            Print or save as PDF
          </Button>
          <Button variant="outline" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
            Close
          </Button>
        </div>
      </div>

      <div data-print-stage className="min-h-0 flex-1 overflow-y-auto bg-black/45 p-4 sm:p-8">
        {children}
      </div>
    </div>,
    document.body,
  );
}
