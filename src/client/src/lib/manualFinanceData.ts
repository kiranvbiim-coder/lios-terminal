import type { FinancialMetricObservation, FinancialMetricUnit } from "@shared/financialMetricRegistry";
import { evaluateFinanceFormula, extractFinanceFormulaDependencies } from "@shared/financeFormula";
import { resolveInstitutionalFinancialMetric } from "@shared/institutionalFinancialResolver";

const STORAGE_KEY = "lios:v6:manual-finance-data";

export interface ManualFinanceObservation extends FinancialMetricObservation {
  id: string;
  symbol: string;
  metricId: string;
  value: number | null;
  status: "manual" | "imported";
  createdAt: string;
  updatedAt: string;
}

export interface CustomFinancialMetric {
  id: string;
  label: string;
  unit: FinancialMetricUnit;
  formula: string;
  dependencies: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
}

interface ManualFinanceState {
  version: 1;
  observations: ManualFinanceObservation[];
  customMetrics: CustomFinancialMetric[];
}

const EMPTY: ManualFinanceState = { version: 1, observations: [], customMetrics: [] };

function storage(): Storage | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}

export function loadManualFinanceState(): ManualFinanceState {
  const store = storage();
  if (!store) return { ...EMPTY };
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? "null") as Partial<ManualFinanceState> | null;
    return {
      version: 1,
      observations: Array.isArray(parsed?.observations) ? parsed.observations.filter(item => item && typeof item.symbol === "string" && typeof item.metricId === "string") as ManualFinanceObservation[] : [],
      customMetrics: Array.isArray(parsed?.customMetrics) ? parsed.customMetrics.filter(item => item && typeof item.id === "string" && typeof item.formula === "string") as CustomFinancialMetric[] : [],
    };
  } catch { return { ...EMPTY }; }
}

export function saveManualFinanceState(state: ManualFinanceState): void {
  storage()?.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: 1 }));
}

export function listManualFinanceObservations(symbol: string): ManualFinanceObservation[] {
  const normalized = symbol.trim().toUpperCase();
  return loadManualFinanceState().observations.filter(item => item.symbol === normalized);
}

export function upsertManualFinanceObservation(input: {
  symbol: string;
  metricId: string;
  value: number | null;
  period?: string;
  asOf?: string;
  currency?: string;
  note?: string;
  source?: string;
  sourceUrl?: string;
  confidence?: number;
  scenarioId?: string;
  status?: "manual" | "imported";
}): ManualFinanceObservation {
  const state = loadManualFinanceState();
  const symbol = input.symbol.trim().toUpperCase();
  const period = input.period?.trim() || "CURRENT";
  const scenarioId = input.scenarioId?.trim() || undefined;
  const existing = state.observations.find(item => item.symbol === symbol && item.metricId === input.metricId && (item.period ?? "CURRENT") === period && item.scenarioId === scenarioId);
  const now = new Date().toISOString();
  const observation: ManualFinanceObservation = {
    id: existing?.id ?? `manual-fin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    metricId: input.metricId,
    value: input.value,
    status: input.status ?? "manual",
    period,
    asOf: input.asOf,
    currency: input.currency,
    note: input.note,
    source: input.source || "User manual input",
    sourceUrl: input.sourceUrl,
    confidence: input.confidence,
    scenarioId,
    manualOverride: true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  state.observations = existing ? state.observations.map(item => item.id === existing.id ? observation : item) : [...state.observations, observation];
  saveManualFinanceState(state);
  return observation;
}

export function removeManualFinanceObservation(id: string): void {
  const state = loadManualFinanceState();
  state.observations = state.observations.filter(item => item.id !== id);
  saveManualFinanceState(state);
}

export function listCustomFinancialMetrics(): CustomFinancialMetric[] { return loadManualFinanceState().customMetrics; }

export function upsertCustomFinancialMetric(input: { id?: string; label: string; unit: FinancialMetricUnit; formula: string; description?: string }): CustomFinancialMetric {
  const dependencies = extractFinanceFormulaDependencies(input.formula);
  if (!input.formula.trim()) throw new Error("Formula is required");
  const state = loadManualFinanceState();
  const id = input.id?.trim() || `custom.${input.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || Date.now()}`;
  const existing = state.customMetrics.find(item => item.id === id);
  const now = new Date().toISOString();
  const metric: CustomFinancialMetric = {
    id,
    label: input.label.trim(),
    unit: input.unit,
    formula: input.formula.trim(),
    dependencies,
    description: input.description?.trim() || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  state.customMetrics = existing ? state.customMetrics.map(item => item.id === id ? metric : item) : [...state.customMetrics, metric];
  saveManualFinanceState(state);
  return metric;
}

export function removeCustomFinancialMetric(id: string): void {
  const state = loadManualFinanceState();
  state.customMetrics = state.customMetrics.filter(item => item.id !== id);
  saveManualFinanceState(state);
}

export function evaluateCustomFinancialMetric(metric: CustomFinancialMetric, observations: readonly FinancialMetricObservation[]): ReturnType<typeof evaluateFinanceFormula> {
  const values: Record<string, number | null> = {};
  for (const dependency of metric.dependencies) {
    values[dependency] = resolveInstitutionalFinancialMetric(dependency, observations)?.value ?? null;
  }
  return evaluateFinanceFormula(metric.formula, values);
}

export function exportManualFinanceBundle(symbol?: string): string {
  const state = loadManualFinanceState();
  const normalized = symbol?.trim().toUpperCase();
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    observations: normalized ? state.observations.filter(item => item.symbol === normalized) : state.observations,
    customMetrics: state.customMetrics,
  }, null, 2);
}

export function importManualFinanceBundle(json: string): { observations: number; customMetrics: number } {
  const incoming = JSON.parse(json) as Partial<ManualFinanceState>;
  const state = loadManualFinanceState();
  const observations = Array.isArray(incoming.observations) ? incoming.observations as ManualFinanceObservation[] : [];
  const customMetrics = Array.isArray(incoming.customMetrics) ? incoming.customMetrics as CustomFinancialMetric[] : [];
  const byObservation = new Map(state.observations.map(item => [item.id, item]));
  for (const item of observations) if (item?.id && item?.symbol && item?.metricId) byObservation.set(item.id, { ...item, status: "imported" });
  const byMetric = new Map(state.customMetrics.map(item => [item.id, item]));
  for (const item of customMetrics) if (item?.id && item?.label && item?.formula) byMetric.set(item.id, item);
  saveManualFinanceState({ version: 1, observations: [...byObservation.values()], customMetrics: [...byMetric.values()] });
  return { observations: observations.length, customMetrics: customMetrics.length };
}
