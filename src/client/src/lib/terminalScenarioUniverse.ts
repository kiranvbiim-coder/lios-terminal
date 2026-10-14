export type ScenarioKind = "base" | "bull" | "bear" | "stress" | "custom";
export type ScenarioScope = "global" | "entity" | "portfolio" | "macro" | "policy" | "operations" | "sustainability";

export interface ScenarioAssumption {
  key: string;
  label: string;
  value: string | number | boolean | null;
  unit?: string;
  source?: string;
}

export interface TerminalScenario {
  id: string;
  name: string;
  kind: ScenarioKind;
  scope: ScenarioScope;
  symbol?: string;
  probability?: number;
  thesis?: string;
  assumptions: ScenarioAssumption[];
  parentId?: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "limuria-terminal-scenario-universe-v1";
const ACTIVE_KEY = "limuria-terminal-active-scenario-v1";
const EVENT_NAME = "lios:scenario-universe";

function id(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `scenario-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneScenario(scenario: TerminalScenario): TerminalScenario {
  return { ...scenario, assumptions: scenario.assumptions.map((assumption) => ({ ...assumption })) };
}

export function createScenario(input: Omit<TerminalScenario, "id" | "createdAt" | "updatedAt" | "symbol" | "assumptions"> & { symbol?: string; assumptions?: ScenarioAssumption[] }): TerminalScenario {
  const now = Date.now();
  return {
    ...input,
    id: id(),
    symbol: input.symbol?.trim().toUpperCase() || undefined,
    probability: input.probability === undefined ? undefined : Math.max(0, Math.min(100, input.probability)),
    assumptions: (input.assumptions ?? []).map((assumption) => ({ ...assumption })),
    createdAt: now,
    updatedAt: now,
  };
}

export function loadScenarios(): TerminalScenario[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as TerminalScenario[];
    return Array.isArray(parsed) ? parsed.map(cloneScenario).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch { return []; }
}

export function saveScenarios(scenarios: readonly TerminalScenario[]): void {
  if (typeof window === "undefined") return;
  const normalized = scenarios.map(cloneScenario).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 120);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }));
}

export function upsertScenario(scenarios: readonly TerminalScenario[], candidate: TerminalScenario): TerminalScenario[] {
  const next = { ...cloneScenario(candidate), updatedAt: Date.now() };
  const exists = scenarios.some((scenario) => scenario.id === candidate.id);
  return (exists ? scenarios.map((scenario) => scenario.id === candidate.id ? next : cloneScenario(scenario)) : [next, ...scenarios])
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function patchScenario(scenario: TerminalScenario, patch: Partial<Pick<TerminalScenario, "name" | "kind" | "scope" | "symbol" | "probability" | "thesis">>): TerminalScenario {
  return {
    ...cloneScenario(scenario),
    ...patch,
    symbol: patch.symbol === undefined ? scenario.symbol : patch.symbol?.trim().toUpperCase() || undefined,
    probability: patch.probability === undefined ? scenario.probability : Math.max(0, Math.min(100, patch.probability)),
    updatedAt: Date.now(),
  };
}

export function ensureDefaultScenarios(): TerminalScenario[] {
  const current = loadScenarios();
  if (current.length) return current;
  const defaults = [
    createScenario({ name: "BASE", kind: "base", scope: "global", probability: 50, thesis: "Central operating case", assumptions: [] }),
    createScenario({ name: "BULL", kind: "bull", scope: "global", probability: 25, thesis: "Upside operating case", assumptions: [] }),
    createScenario({ name: "BEAR", kind: "bear", scope: "global", probability: 25, thesis: "Downside operating case", assumptions: [] }),
  ];
  saveScenarios(defaults);
  return defaults;
}

export function cloneScenarioBranch(parent: TerminalScenario, patch: Partial<Pick<TerminalScenario, "name" | "kind" | "probability" | "thesis">> = {}): TerminalScenario {
  return createScenario({
    name: patch.name ?? `${parent.name} COPY`,
    kind: patch.kind ?? "custom",
    scope: parent.scope,
    symbol: parent.symbol,
    probability: patch.probability ?? parent.probability,
    thesis: patch.thesis ?? parent.thesis,
    assumptions: parent.assumptions,
    parentId: parent.id,
  });
}

export function updateScenarioAssumption(scenario: TerminalScenario, assumption: ScenarioAssumption): TerminalScenario {
  return {
    ...cloneScenario(scenario),
    assumptions: [assumption, ...scenario.assumptions.filter((item) => item.key !== assumption.key)],
    updatedAt: Date.now(),
  };
}

export function removeScenarioAssumption(scenario: TerminalScenario, key: string): TerminalScenario {
  return { ...cloneScenario(scenario), assumptions: scenario.assumptions.filter((item) => item.key !== key), updatedAt: Date.now() };
}

export function setActiveScenario(scenarioId: string | null): void {
  if (typeof window === "undefined") return;
  if (scenarioId) localStorage.setItem(ACTIVE_KEY, scenarioId); else localStorage.removeItem(ACTIVE_KEY);
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function getActiveScenario(): TerminalScenario | null {
  if (typeof window === "undefined") return null;
  const activeId = localStorage.getItem(ACTIVE_KEY);
  if (!activeId) return ensureDefaultScenarios().find((scenario) => scenario.kind === "base") ?? null;
  return loadScenarios().find((scenario) => scenario.id === activeId) ?? null;
}

export function subscribeScenarioUniverse(listener: (scenarios: TerminalScenario[], active: TerminalScenario | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const emit = () => listener(loadScenarios(), getActiveScenario());
  const handler = () => emit();
  window.addEventListener(EVENT_NAME, handler);
  emit();
  return () => window.removeEventListener(EVENT_NAME, handler);
}
