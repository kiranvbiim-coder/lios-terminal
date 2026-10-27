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
const registrationVersions = new Map<string, number>();
let nextRegistrationVersion = 0;
const EVENT_NAME = "lios:assumption-bindings";

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function registerAssumptionBinding(binding: AssumptionBinding): () => void {
  const registrationVersion = ++nextRegistrationVersion;
  bindings.set(binding.id, { ...binding, symbol: binding.symbol?.trim().toUpperCase() || undefined });
  registrationVersions.set(binding.id, registrationVersion);
  emit();
  return () => {
    // A stale pane unmount must not unregister a newer owner for this ID.
    if (registrationVersions.get(binding.id) !== registrationVersion) return;
    bindings.delete(binding.id);
    registrationVersions.delete(binding.id);
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

export interface ScenarioBindingApplicationPlan {
  matched: Array<{ bindingId: string; registrationVersion: number; bindingLabel: string; assumptionKey: string; value: number; currentValue: number; unit?: string }>;
  unmatched: string[];
  skipped: Array<{ assumptionKey: string; reason: string }>;
}

/**
 * C02/C04: the exact current registered model input plan, with no side effects.
 * A unit mismatch must not be silently applied just because keys match.
 * This is input editing only, never a completed P11 model run or P4 save.
 */
export function previewScenarioBindingApplication(
  scenario: TerminalScenario,
  filter?: { view?: ViewMode; symbol?: string },
): ScenarioBindingApplicationPlan {
  const available = listAssumptionBindings(filter);
  const plan: ScenarioBindingApplicationPlan = { matched: [], unmatched: [], skipped: [] };
  for (const assumption of scenario.assumptions) {
    if (typeof assumption.value !== "number" || !Number.isFinite(assumption.value)) {
      plan.skipped.push({ assumptionKey: assumption.key, reason: "Only finite numeric assumptions can be applied to model inputs" });
      continue;
    }
    const assumptionTokens = new Set([normalize(assumption.key), normalize(assumption.label)]);
    const matches = available.filter(binding => assumptionTokens.has(normalize(binding.key)) || assumptionTokens.has(normalize(binding.label)));
    if (!matches.length) { plan.unmatched.push(assumption.key); continue; }
    for (const binding of matches) {
      const aUnit = assumption.unit?.trim().toLocaleLowerCase() ?? "";
      const bUnit = binding.unit?.trim().toLocaleLowerCase() ?? "";
      if (aUnit !== bUnit) {
        plan.skipped.push({ assumptionKey: assumption.key,
          reason: `Unit mismatch for ${binding.label}: scenario ${assumption.unit || "not recorded"}, model ${binding.unit || "not recorded"}` });
        continue;
      }
      plan.matched.push({
        bindingId: binding.id, registrationVersion: registrationVersions.get(binding.id) ?? 0,
        bindingLabel: binding.label,
        assumptionKey: assumption.key, value: assumption.value,
        currentValue: binding.value, unit: binding.unit,
      });
    }
  }
  return plan;
}

export function applyScenarioToBindings(scenario: TerminalScenario, filter?: { view?: ViewMode; symbol?: string }): ScenarioApplyResult {
  // Exactly the same matcher and unit gate powers the review and the action.
  const plan = previewScenarioBindingApplication(scenario, filter);
  const applied: ScenarioApplyResult["applied"] = [];
  const skipped = [...plan.skipped];
  for (const match of plan.matched) {
    const binding = bindings.get(match.bindingId);
    if (!binding || registrationVersions.get(match.bindingId) !== match.registrationVersion || binding.value !== match.currentValue) {
      skipped.push({ assumptionKey: match.assumptionKey, reason: "Registered input changed after review; no value applied" });
      continue;
    }
    try {
      binding.apply(match.value);
      updateAssumptionBindingValue(binding.id, match.value);
      applied.push({ bindingId: binding.id, assumptionKey: match.assumptionKey, value: match.value });
    } catch {
      skipped.push({ assumptionKey: match.assumptionKey,
        reason: "Model input rejected the value; inspect actual model state before retrying" });
    }
  }
  emit();
  return { applied, unmatched: plan.unmatched, skipped };
}

export function subscribeAssumptionBindings(listener: (bindings: AssumptionBinding[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(listAssumptionBindings());
  window.addEventListener(EVENT_NAME, handler);
  handler();
  return () => window.removeEventListener(EVENT_NAME, handler);
}
