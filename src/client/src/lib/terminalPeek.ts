import type { ViewMode } from "./terminalTypes";

export interface TerminalPeekRequest {
  x: number;
  y: number;
  view: ViewMode;
  symbol?: string;
  title?: string;
  source?: "tab" | "tool" | "entity" | "evidence" | "other";
}

const OPEN_EVENT = "lios:peek-open";
const CLOSE_EVENT = "lios:peek-close";

export function requestTerminalPeek(request: TerminalPeekRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: request }));
}

export function dismissTerminalPeek(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CLOSE_EVENT));
}

export function subscribeTerminalPeek(
  onOpen: (request: TerminalPeekRequest) => void,
  onClose: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const open = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail as Partial<TerminalPeekRequest>;
    if (typeof detail?.x !== "number" || typeof detail?.y !== "number" || typeof detail?.view !== "string") return;
    onOpen(detail as TerminalPeekRequest);
  };
  const close = () => onClose();
  window.addEventListener(OPEN_EVENT, open);
  window.addEventListener(CLOSE_EVENT, close);
  return () => {
    window.removeEventListener(OPEN_EVENT, open);
    window.removeEventListener(CLOSE_EVENT, close);
  };
}
