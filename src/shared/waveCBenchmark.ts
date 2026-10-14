/** Deterministic evidence harness for the Wave C shell orientation targets. */

export type WaveCBenchmarkTarget = 10 | 60;

export interface WaveCBenchmarkEvent {
  id: string;
  atMs: number;
}

export interface WaveCBenchmarkDefinition {
  targetSeconds: WaveCBenchmarkTarget;
  requiredActions: readonly string[];
}

export interface WaveCBenchmarkEvidence {
  targetSeconds: WaveCBenchmarkTarget;
  requiredActions: string[];
  completedActions: string[];
  missingActions: string[];
  elapsedMs: number | null;
  passed: boolean;
  reason: string | null;
}

export const WAVE_C_BENCHMARK_DEFINITIONS: readonly WaveCBenchmarkDefinition[] = [
  { targetSeconds: 10, requiredActions: ["identify active surface", "open search", "open active object"] },
  { targetSeconds: 60, requiredActions: ["find a metric", "open a comparison", "inspect evidence", "save a workspace"] },
];

function normalizedEvents(events: readonly WaveCBenchmarkEvent[]): WaveCBenchmarkEvent[] {
  return [...events]
    .filter((event) => event && typeof event.id === "string" && event.id.trim() && Number.isFinite(event.atMs) && event.atMs >= 0)
    .sort((left, right) => left.atMs - right.atMs || left.id.localeCompare(right.id));
}

/**
 * Evaluate a recorded interaction trace. The harness uses supplied event
 * timestamps, so CI evidence is deterministic and cannot pass by sleeping or
 * by relying on a particular browser/runner speed.
 */
export function evaluateWaveCBenchmark(
  definition: WaveCBenchmarkDefinition,
  events: readonly WaveCBenchmarkEvent[],
): WaveCBenchmarkEvidence {
  const ordered = normalizedEvents(events);
  const completedActions = definition.requiredActions.filter((action) => ordered.some((event) => event.id === action));
  const missingActions = definition.requiredActions.filter((action) => !completedActions.includes(action));
  const completionEvents = ordered.filter((event) => definition.requiredActions.includes(event.id));
  const elapsedMs = completionEvents.length === definition.requiredActions.length
    ? Math.max(...completionEvents.map((event) => event.atMs)) - Math.min(...completionEvents.map((event) => event.atMs))
    : null;
  const targetMs = definition.targetSeconds * 1_000;
  const passed = missingActions.length === 0 && elapsedMs !== null && elapsedMs <= targetMs;
  const reason = passed
    ? null
    : missingActions.length > 0
      ? `Missing actions: ${missingActions.join(", ")}`
      : `Completed actions exceeded the ${definition.targetSeconds}-second target.`;
  return {
    targetSeconds: definition.targetSeconds,
    requiredActions: [...definition.requiredActions],
    completedActions,
    missingActions,
    elapsedMs,
    passed,
    reason,
  };
}

export function evaluateWaveCOrientation(events: readonly WaveCBenchmarkEvent[]): WaveCBenchmarkEvidence {
  return evaluateWaveCBenchmark(WAVE_C_BENCHMARK_DEFINITIONS[0], events);
}

export function evaluateWaveCTask(events: readonly WaveCBenchmarkEvent[]): WaveCBenchmarkEvidence {
  return evaluateWaveCBenchmark(WAVE_C_BENCHMARK_DEFINITIONS[1], events);
}

