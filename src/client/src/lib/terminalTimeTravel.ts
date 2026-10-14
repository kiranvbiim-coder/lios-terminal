import type { ViewMode } from "./terminalTypes";

export interface TerminalTimeContext {
  enabled: boolean;
  asOfDate: string | null;
  mode: "latest" | "as-known-on";
}

const STORAGE_KEY = "limuria-terminal-time-context-v1";
const EVENT_NAME = "lios:terminal-time-context";

const POINT_IN_TIME_VIEWS = new Set<ViewMode>([
  "marketdatafabric",
  "economicdatafabric",
  "universefabric",
  "crossassetfabric",
  "financialstatements",
  "companyfundamentals",
  "filingintel",
  "backtesting",
  "decisionmemory",
  "research",
  "consensus",
  "indicatorexplorer",
  "indicatorworkbench",
  "valuation",
  "peercomp",
  "portfolio",
  "portfolioattribution",
  "advancedrisk",
  "macrodashboard",
  "crossasset",
  "regime",
  "econpolicyquant",
  "supplychaindashboard",
  "environmentdashboard",
  "crossdomainfusion",
]);

export const DEFAULT_TERMINAL_TIME_CONTEXT: TerminalTimeContext = {
  enabled: false,
  asOfDate: null,
  mode: "latest",
};

export function supportsPointInTime(view: ViewMode): boolean {
  return POINT_IN_TIME_VIEWS.has(view);
}

export function normalizeTimeContext(value: unknown): TerminalTimeContext {
  if (!value || typeof value !== "object") return { ...DEFAULT_TERMINAL_TIME_CONTEXT };
  const candidate = value as Partial<TerminalTimeContext>;
  const validDate = typeof candidate.asOfDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate.asOfDate)
    ? candidate.asOfDate
    : null;
  const enabled = candidate.enabled === true && Boolean(validDate);
  return {
    enabled,
    asOfDate: enabled ? validDate : null,
    mode: enabled ? "as-known-on" : "latest",
  };
}

export function loadTerminalTimeContext(): TerminalTimeContext {
  if (typeof window === "undefined") return { ...DEFAULT_TERMINAL_TIME_CONTEXT };
  try {
    return normalizeTimeContext(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return { ...DEFAULT_TERMINAL_TIME_CONTEXT };
  }
}

export function saveTerminalTimeContext(context: TerminalTimeContext): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeTimeContext(context);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }));
}

export function setAsKnownOn(date: string): TerminalTimeContext {
  return normalizeTimeContext({ enabled: true, asOfDate: date, mode: "as-known-on" });
}

export function resetToLatest(): TerminalTimeContext {
  return { ...DEFAULT_TERMINAL_TIME_CONTEXT };
}

export function describeTimeContext(context: TerminalTimeContext): string {
  return context.enabled && context.asOfDate ? `As known on ${context.asOfDate}` : "Latest available data";
}

export function subscribeTerminalTimeContext(listener: (context: TerminalTimeContext) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const context = event instanceof CustomEvent && event.detail ? normalizeTimeContext(event.detail) : loadTerminalTimeContext();
    listener(context);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
