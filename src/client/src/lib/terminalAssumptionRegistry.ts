import type { TerminalScenario } from "./terminalScenarioUniverse";
import type { ViewMode } from "./terminalTypes";

export interface AssumptionBinding {
  id: string;
  view: ViewMode;
  symbol?: string;
  key: string;
  label: string;
  value: number;
  unit?: string;
  apply: (value: number) => void;
}

export interface ScenarioApplyResult {
  applied: Array<{ bindingId: string; assumptionKey: string; value: number }>;
  unmatched: string[];
  skipped: Array<{ assumptionKey: string; reason: string }>;
}

const bindings = new Map<string, AssumptionBinding>();
const EVENT_NAME = "lios:assumption-bindings";

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function registerAssumptionBinding(binding: AssumptionBinding): () => void {
  bindings.set(binding.id, { ...binding, symbol: binding.symbol?.trim().toUpperCase() || undefined });
  emit();
  return () => {
    bindings.delete(binding.id);
    emit();
  };
}

export function listAssumptionBindings(filter?: { view?: ViewMode; symbol?: string }): AssumptionBinding[] {
  const symbol = filter?.symbol?.trim().toUpperCase();
  return Array.from(bindings.values()).filter((binding) => {
    if (filter?.view && binding.view !== filter.view) return false;
    if (symbol && binding.symbol && binding.symbol !== symbol) return false;
    return true;
  }).map((binding) => ({ ...binding }));
}

export function updateAssumptionBindingValue(id: string, value: number): void {
  const current = bindings.get(id);
  if (!current) return;
  bindings.set(id, { ...current, value });
}

export function applyScenarioToBindings(scenario: TerminalScenario, filter?: { view?: ViewMode; symbol?: string }): ScenarioApplyResult {
  const available = listAssumptionBindings(filter);
  const applied: ScenarioApplyResult["applied"] = [];
  const unmatched: string[] = [];
  const skipped: ScenarioApplyResult["skipped"] = [];

  for (const assumption of scenario.assumptions) {
    if (typeof assumption.value !== "number" || !Number.isFinite(assumption.value)) {
      skipped.push({ assumptionKey: assumption.key, reason: "Only finite numeric assumptions can be applied to model inputs" });
      continue;
    }
    const assumptionTokens = new Set([normalize(assumption.key), normalize(assumption.label)]);
    const matches = available.filter((binding) => assumptionTokens.has(normalize(binding.key)) || assumptionTokens.has(normalize(binding.label)));
    if (!matches.length) {
      unmatched.push(assumption.key);
      continue;
    }
    for (const binding of matches) {
      binding.apply(assumption.value);
      updateAssumptionBindingValue(binding.id, assumption.value);
      applied.push({ bindingId: binding.id, assumptionKey: assumption.key, value: assumption.value });
    }
  }
  emit();
  return { applied, unmatched, skipped };
}

export function subscribeAssumptionBindings(listener: (bindings: AssumptionBinding[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(listAssumptionBindings());
  window.addEventListener(EVENT_NAME, handler);
  handler();
  return () => window.removeEventListener(EVENT_NAME, handler);
}
