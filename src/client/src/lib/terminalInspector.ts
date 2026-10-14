import type { ViewMode } from "./terminalTypes";

export interface TerminalInspectorRequest {
  view: ViewMode;
  symbol?: string;
  label?: string;
  value?: string | number | boolean | null;
  metricKey?: string;
  sourceHint?: string;
}

const EVENT_NAME = "lios:mini-inspector";

export function openTerminalInspector(request: TerminalInspectorRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: request }));
}

export function subscribeTerminalInspector(listener: (request: TerminalInspectorRequest | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    listener(event.detail as TerminalInspectorRequest);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
