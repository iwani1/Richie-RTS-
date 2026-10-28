"use client";

import { useCallback } from "react";

/**
 * Points a card's spotlight at the pointer.
 *
 * The two custom properties are written straight to the element rather than through React state:
 * a pointer moving across a card should not re-render anything. It does nothing at all when the
 * reader has asked for reduced motion, and nothing on a device with no pointer to follow.
 */
export function useSpotlight<T extends HTMLElement = HTMLDivElement>() {
  const onPointerMove = useCallback((event: React.PointerEvent<T>) => {
    if (event.pointerType !== "mouse") return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    element.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    element.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
  }, []);

  return { onPointerMove };
}
