export type AnalyticalDomain =
  | "valuation"
  | "portfolio"
  | "risk"
  | "quant"
  | "fixed-income"
  | "credit"
  | "economics"
  | "options"
  | "market"
  | "research"
  | "custom";

export type AnalyticalDeterminism = "deterministic" | "seeded-stochastic";
export type AnalyticalRunStatus = "success" | "partial" | "blocked" | "error";
export type AnalyticalDiagnosticSeverity = "ok" | "info" | "watch" | "critical";
export type AnalyticalInputKind = "observed" | "assumption" | "scenario" | "derived";
export type AnalyticalOutputRole = "primary" | "secondary" | "diagnostic";
export type AnalyticalPrimitive = string | number | boolean | null;

export interface AnalyticalInput {
  id: string;
  label: string;
  value: AnalyticalPrimitive;
  unit?: string;
  kind: AnalyticalInputKind;
  source?: string;
  asOf?: string | null;
  locked?: boolean;
}

export interface AnalyticalOutput {
  id: string;
  label: string;
  value: AnalyticalPrimitive;
  unit?: string;
  role: AnalyticalOutputRole;
  confidence?: number;
}

export interface AnalyticalDiagnostic {
  id: string;
  label: string;
  severity: AnalyticalDiagnosticSeverity;
  detail?: string;
  metric?: AnalyticalPrimitive;
  unit?: string;
  blocking?: boolean;
}

export interface AnalyticalEvidence {
  id: string;
  label: string;
  source: string;
  asOf?: string | null;
  reference?: string;
  confidence?: number;
}

export interface AnalyticalDependency {
  id: string;
  kind: "data" | "assumption" | "model" | "scenario" | "evidence";
  label?: string;
  version?: string;
  fingerprint?: string;
}

export interface AnalyticalScenarioContext {
  id: string;
  label: string;
  fingerprint?: string;
}

export interface AnalyticalExecutionContext {
  objectId?: string;
  scenario?: AnalyticalScenarioContext;
  runAt?: string;
  metadata?: Record<string, unknown>;
}

export interface AnalyticalExecutionResult {
  status?: AnalyticalRunStatus;
  outputs: AnalyticalOutput[];
  diagnostics?: AnalyticalDiagnostic[];
  evidence?: AnalyticalEvidence[];
  dependencies?: AnalyticalDependency[];
  metadata?: Record<string, unknown>;
}

export interface AnalyticalModelDefinition<TPayload = unknown> {
  id: string;
  label: string;
  domain: AnalyticalDomain;
  version: string;
  determinism: AnalyticalDeterminism;
  description?: string;
  describeInputs: (payload: TPayload, context: AnalyticalExecutionContext) => AnalyticalInput[];
  execute: (payload: TPayload, context: AnalyticalExecutionContext) => AnalyticalExecutionResult;
}

export interface AnalyticalModelRun {
  id: string;
  modelId: string;
  modelLabel: string;
  modelVersion: string;
  domain: AnalyticalDomain;
  determinism: AnalyticalDeterminism;
  objectId?: string;
  scenarioId?: string;
  status: AnalyticalRunStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  inputs: AnalyticalInput[];
  outputs: AnalyticalOutput[];
  diagnostics: AnalyticalDiagnostic[];
  evidence: AnalyticalEvidence[];
  dependencies: AnalyticalDependency[];
  inputFingerprint: string;
  outputFingerprint: string;
  reproducibilityHash: string;
  metadata: Record<string, unknown>;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return "__undefined__";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalize(child)]);
    return Object.fromEntries(entries);
  }
  return String(value);
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function fnv1a32(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function analyticalFingerprint(value: unknown): string {
  const serialized = stableSerialize(value);
  const left = fnv1a32(serialized, 0x811c9dc5).toString(16).padStart(8, "0");
  const right = fnv1a32(serialized, 0x9e3779b9).toString(16).padStart(8, "0");
  return `${left}${right}`;
}

export function deriveAnalyticalRunStatus(
  diagnostics: readonly AnalyticalDiagnostic[],
  explicit?: AnalyticalRunStatus,
): AnalyticalRunStatus {
  if (explicit) return explicit;
  if (diagnostics.some((diagnostic) => diagnostic.blocking && diagnostic.severity === "critical")) return "blocked";
  if (diagnostics.some((diagnostic) => diagnostic.severity === "critical" || diagnostic.severity === "watch")) return "partial";
  return "success";
}

function errorDiagnostic(error: unknown): AnalyticalDiagnostic {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    id: "execution-error",
    label: "MODEL EXECUTION FAILED",
    severity: "critical",
    detail,
    blocking: true,
  };
}

export function executeAnalyticalModel<TPayload>(
  definition: AnalyticalModelDefinition<TPayload>,
  payload: TPayload,
  context: AnalyticalExecutionContext = {},
): AnalyticalModelRun {
  const startedMs = Date.now();
  const startedAt = context.runAt ?? new Date(startedMs).toISOString();
  const inputs = definition.describeInputs(payload, context);
  const inputFingerprint = analyticalFingerprint(inputs);
  const reproducibilityHash = analyticalFingerprint({
    modelId: definition.id,
    modelVersion: definition.version,
    determinism: definition.determinism,
    objectId: context.objectId ?? null,
    scenarioId: context.scenario?.id ?? null,
    scenarioFingerprint: context.scenario?.fingerprint ?? null,
    inputs,
  });

  let result: AnalyticalExecutionResult;
  try {
    result = definition.execute(payload, context);
  } catch (error) {
    result = {
      status: "error",
      outputs: [],
      diagnostics: [errorDiagnostic(error)],
    };
  }

  const diagnostics = result.diagnostics ?? [];
  const evidence = result.evidence ?? [];
  const dependencies = result.dependencies ?? [];
  const completedMs = Date.now();
  const completedAt = new Date(completedMs).toISOString();
  const outputFingerprint = analyticalFingerprint(result.outputs);
  const runId = `${definition.id}:${startedAt}:${reproducibilityHash.slice(0, 10)}`;

  return {
    id: runId,
    modelId: definition.id,
    modelLabel: definition.label,
    modelVersion: definition.version,
    domain: definition.domain,
    determinism: definition.determinism,
    objectId: context.objectId,
    scenarioId: context.scenario?.id,
    status: deriveAnalyticalRunStatus(diagnostics, result.status),
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedMs - startedMs),
    inputs,
    outputs: result.outputs,
    diagnostics,
    evidence,
    dependencies,
    inputFingerprint,
    outputFingerprint,
    reproducibilityHash,
    metadata: { ...(context.metadata ?? {}), ...(result.metadata ?? {}) },
  };
}

export function primaryNumericOutput(run: AnalyticalModelRun): AnalyticalOutput | null {
  const primary = run.outputs.find((output) => output.role === "primary" && typeof output.value === "number" && Number.isFinite(output.value));
  if (primary) return primary;
  return run.outputs.find((output) => typeof output.value === "number" && Number.isFinite(output.value)) ?? null;
}
