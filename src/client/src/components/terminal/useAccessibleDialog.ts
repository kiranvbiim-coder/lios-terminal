import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

/**
 * Keep short-lived terminal overlays usable without a mouse. Focus stays in
 * the active dialog and returns to its original control when it closes.
 * Dialog content/permissions remain owned by the existing caller.
 */
export function useAccessibleDialog(onClose: () => void) {
  const dialogRef = useRef<HTMLElement>(null);
  const initialRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;

    const dialog = dialogRef.current;
    const tabbables = Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);

    if (!tabbables.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = tabbables[0];
    const last = tabbables[tabbables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return { dialogRef, initialRef, onDialogKeyDown };
}
