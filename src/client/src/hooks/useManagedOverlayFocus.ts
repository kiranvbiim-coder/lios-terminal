import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])",
  "a[href]", '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Shared keyboard lifecycle for existing overlays, not a new modal owner.
 * Nonmodal drawers preserve the ability to tab to the main workbench.
 * A modal studio wraps Tab and returns focus to the prior element on close.
 */
export function useManagedOverlayFocus(onClose: () => void, modal: boolean) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const container = ref.current;
    if (!container || typeof document === "undefined") return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const getFocusable = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(element => element.getClientRects().length > 0
        && element.getAttribute("aria-hidden") !== "true");
    const initial = container.querySelector<HTMLElement>("[data-overlay-initial-focus]");
    (initial ?? getFocusable()[0] ?? container).focus();

    const handleKey = (event: KeyboardEvent) => {
      if (!modal && !container.contains(document.activeElement)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !modal) return;
      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!container.contains(document.activeElement)
        || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [modal]);
  return ref;
}
