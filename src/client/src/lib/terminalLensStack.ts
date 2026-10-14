import type { ViewMode } from "./terminalTypes";

export type TerminalLensId = "financial" | "valuation" | "risk" | "macro" | "policy" | "supply-chain" | "sustainability" | "market" | "evidence" | "decision";

export interface TerminalLens {
  id: TerminalLensId;
  label: string;
  shortLabel: string;
  description: string;
  suggestedViews: ViewMode[];
  accent: "amber" | "cyan" | "green" | "red" | "violet";
}

export const TERMINAL_LENSES: readonly TerminalLens[] = [
  { id: "financial", label: "Financial", shortLabel: "FIN", description: "Statements, fundamentals, cash generation and operating structure.", suggestedViews: ["financialstatements", "companyfundamentals"], accent: "amber" },
  { id: "valuation", label: "Valuation", shortLabel: "VAL", description: "Intrinsic value, peers, assumptions and scenario sensitivity.", suggestedViews: ["valuation", "peercomp"], accent: "amber" },
  { id: "risk", label: "Risk", shortLabel: "RSK", description: "Downside, distributions, exposures, concentration and stress behavior.", suggestedViews: ["advancedrisk", "portfoliostress", "montecarlo"], accent: "red" },
  { id: "macro", label: "Macro", shortLabel: "MAC", description: "Rates, inflation, growth, FX, liquidity and regime context.", suggestedViews: ["macrodashboard", "crossasset", "economics"], accent: "cyan" },
  { id: "policy", label: "Policy", shortLabel: "POL", description: "Policy conditions, fiscal/regulatory impact and public-sector intelligence.", suggestedViews: ["econpolicyquant", "indicatorworkbench"], accent: "violet" },
  { id: "supply-chain", label: "Supply Chain", shortLabel: "SCM", description: "Flow, logistics, constraints, inventory and operating exposure.", suggestedViews: ["supplychaindashboard", "supplychainquant"], accent: "cyan" },
  { id: "sustainability", label: "Sustainability", shortLabel: "ESG", description: "Climate, transition, carbon and environmental operating context.", suggestedViews: ["environmentdashboard", "environmentquant", "carbonintensity"], accent: "green" },
  { id: "market", label: "Market", shortLabel: "MKT", description: "Price, positioning, liquidity, flows and event response.", suggestedViews: ["quote", "chart", "market", "optionsflow"], accent: "green" },
  { id: "evidence", label: "Evidence", shortLabel: "EVD", description: "Source, freshness, provenance, contradictions and calculation lineage.", suggestedViews: ["research"], accent: "cyan" },
  { id: "decision", label: "Decision", shortLabel: "DEC", description: "Thesis, confidence, reversal conditions, monitoring and replay.", suggestedViews: ["alerts"], accent: "amber" },
] as const;

const STORAGE_KEY = "limuria-terminal-lens-stack-v1";
const EVENT_NAME = "lios:lens-stack";

export interface TerminalLensState {
  active: TerminalLensId[];
  updatedAt: number;
}

export function loadLensStack(): TerminalLensState {
  if (typeof window === "undefined") return { active: [], updatedAt: 0 };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as TerminalLensState | null;
    const valid = new Set(TERMINAL_LENSES.map((lens) => lens.id));
    return parsed && Array.isArray(parsed.active)
      ? { active: parsed.active.filter((id): id is TerminalLensId => valid.has(id)), updatedAt: Number(parsed.updatedAt) || 0 }
      : { active: [], updatedAt: 0 };
  } catch { return { active: [], updatedAt: 0 }; }
}

export function saveLensStack(state: TerminalLensState): void {
  if (typeof window === "undefined") return;
  const next = { active: Array.from(new Set(state.active)).slice(0, 5), updatedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
}

export function toggleLens(state: TerminalLensState, id: TerminalLensId): TerminalLensState {
  return {
    active: state.active.includes(id) ? state.active.filter((item) => item !== id) : [...state.active, id].slice(-5),
    updatedAt: Date.now(),
  };
}

export function suggestedViewsForLenses(ids: readonly TerminalLensId[]): ViewMode[] {
  return Array.from(new Set(ids.flatMap((id) => TERMINAL_LENSES.find((lens) => lens.id === id)?.suggestedViews ?? [])));
}

export function subscribeLensStack(listener: (state: TerminalLensState) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => listener(event instanceof CustomEvent && event.detail ? event.detail : loadLensStack());
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
