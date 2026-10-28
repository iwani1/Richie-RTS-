import { useEffect, useRef } from "react";

// Radix (behind shadcn's Dialog) drops two zero-size focus guards around a modal surface. They are
// tabbable by design — they are how a reader that escapes the dialog is pulled back — but they are
// not part of the form, so the Tab cycle must not treat the last guard as its last control.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([data-radix-focus-guard])';

/**
 * The keyboard behaviour every overlay in this application shares.
 *
 * A scrim drawn over the page does not remove the page from the tab order, so an overlay that only
 * looks modal still lets a keyboard user walk into the screen behind it — and a screen reader has no
 * way to know which of the two it is in. This hook does the four things an overlay owes the person
 * using it: move focus in, keep Tab inside, close on Escape, and put focus back where it was.
 *
 * The container is read at event time rather than captured in the effect: shadcn's Dialog mounts its
 * portal one commit later than this component, so a container captured on mount would still be empty
 * when the first Tab arrives. Reading it late costs nothing and cannot go stale.
 */
export function useDialogFocus(container: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusable = () =>
      Array.from(container.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        // Not `offsetParent`: layout is not available in every environment this runs in, and an
        // element inside a hidden subtree is excluded by the attribute check instead.
        (element) => !element.hasAttribute("hidden") && element.closest('[hidden],[aria-hidden="true"]') === null,
      );

    const focusFirst = () => (focusable()[0] ?? container.current)?.focus();
    focusFirst();
    // One retry after the portal has been attached, for the case where it did not exist yet.
    const retry = window.setTimeout(() => {
      if (!container.current?.contains(document.activeElement)) focusFirst();
    }, 0);

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
      window.clearTimeout(retry);
      document.removeEventListener("keydown", onKeyDown);
      restoreTo.current?.focus();
    };
  }, [container, onClose]);
}
