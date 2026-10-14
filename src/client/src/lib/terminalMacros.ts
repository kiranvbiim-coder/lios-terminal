import type { ViewMode } from "./terminalTypes";
import type { AnalyticalOpenMode } from "./terminalActionContracts";
import { getTerminalCapability, isCapabilityVisible } from "./terminalCatalog";

export type MacroSymbolMode = "active" | "fixed" | "none";

export interface TerminalMacroStep {
  id: string;
  view: ViewMode;
  symbolMode: MacroSymbolMode;
  fixedSymbol?: string;
  openMode: AnalyticalOpenMode;
  note?: string;
}

export interface TerminalMacro {
  id: string;
  name: string;
  description: string;
  steps: TerminalMacroStep[];
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedMacroStep {
  id: string;
  index: number;
  view: ViewMode;
  label: string;
  symbol?: string;
  openMode: AnalyticalOpenMode;
  note?: string;
}

const STORAGE_KEY = "limuria-terminal-macros-v1";

function step(id: string, view: ViewMode, openMode: AnalyticalOpenMode = "tab", symbolMode: MacroSymbolMode = "active", note?: string): TerminalMacroStep {
  return { id, view, openMode, symbolMode, note };
}

const BUILT_IN_MACROS: readonly TerminalMacro[] = [
  { id: "builtin-equity-tearsheet", name: "Equity Tearsheet", description: "Open the core company research sequence without hiding any step.", builtIn: true, createdAt: 0, updatedAt: 0, steps: [step("entity", "entity", "tab"), step("financials", "financialstatements", "tab"), step("valuation", "valuation", "tab"), step("peers", "peercomp", "tab"), step("risk", "advancedrisk", "tab"), step("news", "news", "tab")] },
  { id: "builtin-morning-review", name: "Morning Review", description: "Open global market, macro, sector, and event context for the day.", builtIn: true, createdAt: 0, updatedAt: 0, steps: [step("market", "market", "tab", "none"), step("brief", "morningbrief", "tab", "none"), step("macro", "macrodashboard", "tab", "none"), step("sector", "sectorrotation", "tab", "none"), step("calendar", "ecalendar", "tab", "none")] },
  { id: "builtin-portfolio-risk", name: "Portfolio Risk Review", description: "Inspect portfolio, attribution, dependency, stress, and monitoring surfaces.", builtIn: true, createdAt: 0, updatedAt: 0, steps: [step("portfolio", "portfolio", "tab", "none"), step("attribution", "portfolioattribution", "tab", "none"), step("correlation", "correlation", "tab", "none"), step("stress", "portfoliostress", "tab", "none"), step("alerts", "alerts", "tab", "none")] },
  { id: "builtin-policy-brief", name: "Macro & Policy Brief", description: "Move from macro context into indicators, signals, and scenario modeling.", builtIn: true, createdAt: 0, updatedAt: 0, steps: [step("macro", "macrodashboard", "tab", "none"), step("indicators", "indicatorexplorer", "tab", "none"), step("signals", "econsignals", "tab", "none"), step("policy", "econpolicyquant", "tab", "none")] },
  { id: "builtin-client-situation", name: "Client Situation Brief", description: "Package research, data, modeling, and a durable workspace in a visible sequence.", builtIn: true, createdAt: 0, updatedAt: 0, steps: [step("entity", "entity", "tab"), step("fundamentals", "companyfundamentals", "tab"), step("research", "research", "tab"), step("workspace", "workspaces", "tab", "none")] },
];

function normalizeSymbol(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized || undefined;
}

function isStep(value: unknown): value is TerminalMacroStep {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TerminalMacroStep>;
  return typeof candidate.id === "string" && typeof candidate.view === "string" &&
    (candidate.symbolMode === "active" || candidate.symbolMode === "fixed" || candidate.symbolMode === "none") &&
    (candidate.openMode === "current" || candidate.openMode === "tab" || candidate.openMode === "split-right" || candidate.openMode === "split-below");
}

function isMacro(value: unknown): value is TerminalMacro {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TerminalMacro>;
  return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.description === "string" && Array.isArray(candidate.steps) && candidate.steps.every(isStep) && typeof candidate.builtIn === "boolean" && typeof candidate.createdAt === "number" && typeof candidate.updatedAt === "number";
}

export function getBuiltInTerminalMacros(): TerminalMacro[] {
  return BUILT_IN_MACROS.map((macro) => ({ ...macro, steps: macro.steps.map((item) => ({ ...item })) }));
}

export function loadTerminalMacros(): TerminalMacro[] {
  if (typeof window === "undefined") return getBuiltInTerminalMacros();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const custom = Array.isArray(parsed) ? parsed.filter(isMacro).filter((macro) => !macro.builtIn) : [];
    return [...getBuiltInTerminalMacros(), ...custom];
  } catch {
    return getBuiltInTerminalMacros();
  }
}

export function saveCustomTerminalMacros(macros: readonly TerminalMacro[]): void {
  if (typeof window === "undefined") return;
  const custom = macros.filter((macro) => !macro.builtIn).slice(0, 50);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
}

export function createTerminalMacro(input: { name: string; description?: string; steps?: TerminalMacroStep[] }): TerminalMacro {
  const timestamp = Date.now();
  const name = input.name.trim().slice(0, 80) || "Untitled Macro";
  return { id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `macro-${timestamp}`, name, description: (input.description ?? "").trim().slice(0, 240), steps: (input.steps ?? []).map((item) => ({ ...item })), builtIn: false, createdAt: timestamp, updatedAt: timestamp };
}

export function duplicateTerminalMacro(macro: TerminalMacro): TerminalMacro {
  return createTerminalMacro({ name: `${macro.name} Copy`, description: macro.description, steps: macro.steps.map((item, index) => ({ ...item, id: `${item.id}-${index}-${Date.now()}` })) });
}

export function resolveTerminalMacro(macro: TerminalMacro, activeSymbol?: string): ResolvedMacroStep[] {
  const normalizedActive = normalizeSymbol(activeSymbol);
  return macro.steps.map((item, index) => {
    const symbol = item.symbolMode === "active" ? normalizedActive : item.symbolMode === "fixed" ? normalizeSymbol(item.fixedSymbol) : undefined;
    const capability = getTerminalCapability(item.view);
    return { id: item.id, index, view: item.view, label: capability.label, symbol: capability.symbolAware ? symbol : undefined, openMode: item.openMode, note: item.note };
  });
}

export function resolveVisibleTerminalMacro(macro: TerminalMacro, activeSymbol: string | undefined, isInternal: boolean): ResolvedMacroStep[] {
  return resolveTerminalMacro(macro, activeSymbol)
    .filter((item) => isCapabilityVisible(getTerminalCapability(item.view), isInternal))
    .map((item, index) => ({ ...item, index }));
}

export function macroHasVisibleSteps(macro: TerminalMacro, isInternal: boolean): boolean {
  return macro.steps.some((item) => isCapabilityVisible(getTerminalCapability(item.view), isInternal));
}

export function validateTerminalMacro(macro: TerminalMacro): string[] {
  const errors: string[] = [];
  if (!macro.name.trim()) errors.push("Macro name is required.");
  if (macro.steps.length === 0) errors.push("Add at least one visible step.");
  if (macro.steps.length > 24) errors.push("Macros are limited to 24 inspectable steps.");
  for (const [index, item] of macro.steps.entries()) if (item.symbolMode === "fixed" && !normalizeSymbol(item.fixedSymbol)) errors.push(`Step ${index + 1} requires a fixed symbol.`);
  return errors;
}
