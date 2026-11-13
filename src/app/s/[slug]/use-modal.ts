"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Where Tab (or Shift+Tab) must go to stay inside the dialog, or null when the
// browser's own move already stays inside.
export function trapTarget<T>(focusable: T[], active: unknown, inside: boolean, backwards: boolean): T | null {
  if (focusable.length === 0) return null;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (backwards) return !inside || active === first ? last : null;
  return !inside || active === last ? first : null;
}

// What an aria-modal dialog promises: Tab and Shift+Tab stay inside it, and the
// page behind does not scroll while it is open.
export function useModal(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousPadding = root.style.paddingRight;
    // Keep the page from shifting sideways when its scrollbar goes away.
    const scrollbar = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;

    function onKeyDown(event: KeyboardEvent) {
      const panel = ref.current;
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const inside = active instanceof Node && panel.contains(active);
      const target = trapTarget(focusable, active, inside, event.shiftKey);
      if (target) {
        event.preventDefault();
        target.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      root.style.overflow = previousOverflow;
      root.style.paddingRight = previousPadding;
    };
  }, [ref]);
}
