import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The keyboard behaviour every overlay in this application shares.
 *
 * A scrim drawn over the page does not remove the page from the tab order, so an overlay that only
 * looks modal still lets a keyboard user walk into the screen behind it — and a screen reader has no
 * way to know which of the two it is in. This hook does the four things an overlay owes the person
 * using it: move focus in, keep Tab inside, close on Escape, and put focus back where it was.
 *
 * Shared by `Panel` (the side sheet every form uses) and the print preview, so the two cannot drift
 * into behaving differently.
 */
export function useDialogFocus(container: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = container.current;
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
  }, [container, onClose]);
}
