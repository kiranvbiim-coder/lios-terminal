import { analyticalFingerprint } from "./analyticalCore";

export type ScenarioShockOperation = "add" | "multiply" | "replace";
export type ScenarioShockUnit = "raw" | "percentage-points" | "basis-points";

export interface ScenarioShock {
  id: string;
  label: string;
  path: string;
  operation: ScenarioShockOperation;
  value: number;
  unit?: ScenarioShockUnit;
}

export interface AnalyticalScenario {
  id: string;
  label: string;
  description?: string;
  shocks: ScenarioShock[];
  tags?: string[];
}

export interface ScenarioChange {
  shockId: string;
  path: string;
  before: unknown;
  after: unknown;
}

export interface ScenarioApplication<T> {
  scenario: AnalyticalScenario;
  payload: T;
  changes: ScenarioChange[];
  fingerprint: string;
}

function scaledValue(shock: ScenarioShock): number {
  return shock.unit === "basis-points" ? shock.value / 100 : shock.value;
}

function applyNumericShock(value: unknown, shock: ScenarioShock): unknown {
  const scaled = scaledValue(shock);
  if (shock.operation === "replace") return scaled;
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return shock.operation === "multiply" ? value * scaled : value + scaled;
}

function cloneAndApply(
  current: unknown,
  segments: string[],
  index: number,
  shock: ScenarioShock,
  resolvedPath: string[],
  changes: ScenarioChange[],
): unknown {
  if (index >= segments.length) {
    const next = applyNumericShock(current, shock);
    if (!Object.is(next, current)) {
      changes.push({ shockId: shock.id, path: resolvedPath.join("."), before: current, after: next });
    }
    return next;
  }

  const segment = segments[index];
  if (segment === "*") {
    if (Array.isArray(current)) {
      return current.map((value, childIndex) => cloneAndApply(value, segments, index + 1, shock, [...resolvedPath, String(childIndex)], changes));
    }
    if (current && typeof current === "object") {
      return Object.fromEntries(Object.entries(current as Record<string, unknown>).map(([key, value]) => [
        key,
        cloneAndApply(value, segments, index + 1, shock, [...resolvedPath, key], changes),
      ]));
    }
    return current;
  }

  if (Array.isArray(current)) {
    const childIndex = Number(segment);
    if (!Number.isInteger(childIndex) || childIndex < 0 || childIndex >= current.length) return current;
    const next = [...current];
    next[childIndex] = cloneAndApply(next[childIndex], segments, index + 1, shock, [...resolvedPath, segment], changes);
    return next;
  }

  if (current && typeof current === "object") {
    const object = current as Record<string, unknown>;
    if (!(segment in object)) return current;
    return {
      ...object,
      [segment]: cloneAndApply(object[segment], segments, index + 1, shock, [...resolvedPath, segment], changes),
    };
  }

  return current;
}

export function applyAnalyticalScenario<T>(payload: T, scenario: AnalyticalScenario): ScenarioApplication<T> {
  let next: unknown = payload;
  const changes: ScenarioChange[] = [];
  for (const shock of scenario.shocks) {
    const segments = shock.path.split(".").map((segment) => segment.trim()).filter(Boolean);
    if (!segments.length) continue;
    next = cloneAndApply(next, segments, 0, shock, [], changes);
  }
  return {
    scenario,
    payload: next as T,
    changes,
    fingerprint: analyticalFingerprint({ scenario, changes }),
  };
}

export function composeAnalyticalScenarios(id: string, label: string, scenarios: readonly AnalyticalScenario[]): AnalyticalScenario {
  return {
    id,
    label,
    description: scenarios.map((scenario) => scenario.label).join(" + "),
    shocks: scenarios.flatMap((scenario) => scenario.shocks),
    tags: Array.from(new Set(scenarios.flatMap((scenario) => scenario.tags ?? []))),
  };
}

export function scenarioTouchesPath(scenario: AnalyticalScenario, pathPrefix: string): boolean {
  return scenario.shocks.some((shock) => shock.path === pathPrefix || shock.path.startsWith(`${pathPrefix}.`) || pathPrefix.startsWith(`${shock.path}.`));
}
