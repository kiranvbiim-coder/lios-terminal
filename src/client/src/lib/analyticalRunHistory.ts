import {
  analyticalFingerprint,
  stableSerialize,
  type AnalyticalDependency,
  type AnalyticalDiagnostic,
  type AnalyticalEvidence,
  type AnalyticalInput,
  type AnalyticalModelRun,
  type AnalyticalOutput,
  type AnalyticalPrimitive,
} from "./analyticalCore";

export interface AnalyticalRunSnapshot {
  id: string;
  runId: string;
  modelId: string;
  modelLabel: string;
  modelVersion: string;
  objectId?: string;
  scenarioId?: string;
  status: AnalyticalModelRun["status"];
  startedAt: string;
  completedAt: string;
  capturedAt: string;
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

export type AnalyticalChangeKind = "added" | "removed" | "changed";

export interface AnalyticalPrimitiveChange {
  id: string;
  label: string;
  kind: AnalyticalChangeKind;
  before: AnalyticalPrimitive | undefined;
  after: AnalyticalPrimitive | undefined;
  unit?: string;
  absoluteDelta?: number;
  percentDelta?: number | null;
}

export interface AnalyticalRecordChange<T> {
  id: string;
  kind: AnalyticalChangeKind;
  before?: T;
  after?: T;
}

export interface AnalyticalRunDiff {
  id: string;
  baseSnapshotId: string;
  nextSnapshotId: string;
  modelChanged: boolean;
  statusChanged: boolean;
  reproducibilityChanged: boolean;
  inputChanges: AnalyticalPrimitiveChange[];
  outputChanges: AnalyticalPrimitiveChange[];
  diagnosticChanges: AnalyticalRecordChange<AnalyticalDiagnostic>[];
  evidenceChanges: AnalyticalRecordChange<AnalyticalEvidence>[];
  dependencyChanges: AnalyticalRecordChange<AnalyticalDependency>[];
  metadataChanged: boolean;
  materialChangeCount: number;
}

function snapshotClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function recordMap<T extends { id: string }>(records: readonly T[]): Map<string, T> {
  return new Map(records.map((record) => [record.id, record]));
}

function idsAcross<T extends { id: string }>(before: readonly T[], after: readonly T[]): string[] {
  return Array.from(new Set([...before.map((item) => item.id), ...after.map((item) => item.id)])).sort((a, b) => a.localeCompare(b));
}

function numericDelta(before: AnalyticalPrimitive | undefined, after: AnalyticalPrimitive | undefined): Pick<AnalyticalPrimitiveChange, "absoluteDelta" | "percentDelta"> {
  if (typeof before !== "number" || typeof after !== "number" || !Number.isFinite(before) || !Number.isFinite(after)) return {};
  const absoluteDelta = after - before;
  return {
    absoluteDelta,
    percentDelta: before === 0 ? (absoluteDelta === 0 ? 0 : null) : (absoluteDelta / Math.abs(before)) * 100,
  };
}

function primitiveChanges<T extends { id: string; label: string; value: AnalyticalPrimitive; unit?: string }>(before: readonly T[], after: readonly T[]): AnalyticalPrimitiveChange[] {
  const beforeMap = recordMap(before);
  const afterMap = recordMap(after);
  const changes: AnalyticalPrimitiveChange[] = [];

  for (const id of idsAcross(before, after)) {
    const left = beforeMap.get(id);
    const right = afterMap.get(id);
    if (!left && right) {
      changes.push({ id, label: right.label, kind: "added", before: undefined, after: right.value, unit: right.unit });
      continue;
    }
    if (left && !right) {
      changes.push({ id, label: left.label, kind: "removed", before: left.value, after: undefined, unit: left.unit });
      continue;
    }
    if (!left || !right || stableSerialize(left) === stableSerialize(right)) continue;
    changes.push({
      id,
      label: right.label || left.label,
      kind: "changed",
      before: left.value,
      after: right.value,
      unit: right.unit ?? left.unit,
      ...numericDelta(left.value, right.value),
    });
  }
  return changes;
}

function recordChanges<T extends { id: string }>(before: readonly T[], after: readonly T[]): AnalyticalRecordChange<T>[] {
  const beforeMap = recordMap(before);
  const afterMap = recordMap(after);
  const changes: AnalyticalRecordChange<T>[] = [];

  for (const id of idsAcross(before, after)) {
    const left = beforeMap.get(id);
    const right = afterMap.get(id);
    if (!left && right) changes.push({ id, kind: "added", after: snapshotClone(right) });
    else if (left && !right) changes.push({ id, kind: "removed", before: snapshotClone(left) });
    else if (left && right && stableSerialize(left) !== stableSerialize(right)) {
      changes.push({ id, kind: "changed", before: snapshotClone(left), after: snapshotClone(right) });
    }
  }
  return changes;
}

export function createAnalyticalRunSnapshot(run: AnalyticalModelRun, capturedAt = run.completedAt): AnalyticalRunSnapshot {
  const snapshotCore = {
    runId: run.id,
    modelId: run.modelId,
    modelLabel: run.modelLabel,
    modelVersion: run.modelVersion,
    ...(run.objectId !== undefined ? { objectId: run.objectId } : {}),
    ...(run.scenarioId !== undefined ? { scenarioId: run.scenarioId } : {}),
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    capturedAt,
    inputs: run.inputs,
    outputs: run.outputs,
    diagnostics: run.diagnostics,
    evidence: run.evidence,
    dependencies: run.dependencies,
    inputFingerprint: run.inputFingerprint,
    outputFingerprint: run.outputFingerprint,
    reproducibilityHash: run.reproducibilityHash,
    metadata: run.metadata,
  };
  const cloned = snapshotClone(snapshotCore);
  return {
    id: `snapshot:${analyticalFingerprint(cloned)}`,
    ...cloned,
  };
}

export function diffAnalyticalRunSnapshots(base: AnalyticalRunSnapshot, next: AnalyticalRunSnapshot): AnalyticalRunDiff {
  const inputChanges = primitiveChanges(base.inputs, next.inputs);
  const outputChanges = primitiveChanges(base.outputs, next.outputs);
  const diagnosticChanges = recordChanges(base.diagnostics, next.diagnostics);
  const evidenceChanges = recordChanges(base.evidence, next.evidence);
  const dependencyChanges = recordChanges(base.dependencies, next.dependencies);
  const metadataChanged = stableSerialize(base.metadata) !== stableSerialize(next.metadata);
  const modelChanged = base.modelId !== next.modelId || base.modelVersion !== next.modelVersion;
  const statusChanged = base.status !== next.status;
  const reproducibilityChanged = base.reproducibilityHash !== next.reproducibilityHash;
  const materialChangeCount = inputChanges.length
    + outputChanges.length
    + diagnosticChanges.length
    + evidenceChanges.length
    + dependencyChanges.length
    + Number(metadataChanged)
    + Number(modelChanged)
    + Number(statusChanged);

  const diffCore = {
    baseSnapshotId: base.id,
    nextSnapshotId: next.id,
    modelChanged,
    statusChanged,
    reproducibilityChanged,
    inputChanges,
    outputChanges,
    diagnosticChanges,
    evidenceChanges,
    dependencyChanges,
    metadataChanged,
    materialChangeCount,
  };
  return {
    id: `run-diff:${analyticalFingerprint(diffCore)}`,
    ...diffCore,
  };
}

export function summarizeAnalyticalRunDiff(diff: AnalyticalRunDiff): string {
  if (diff.materialChangeCount === 0) return "No material analytical changes.";
  const segments: string[] = [];
  if (diff.inputChanges.length) segments.push(`${diff.inputChanges.length} input${diff.inputChanges.length === 1 ? "" : "s"}`);
  if (diff.outputChanges.length) segments.push(`${diff.outputChanges.length} output${diff.outputChanges.length === 1 ? "" : "s"}`);
  if (diff.diagnosticChanges.length) segments.push(`${diff.diagnosticChanges.length} diagnostic${diff.diagnosticChanges.length === 1 ? "" : "s"}`);
  if (diff.evidenceChanges.length) segments.push(`${diff.evidenceChanges.length} evidence item${diff.evidenceChanges.length === 1 ? "" : "s"}`);
  if (diff.dependencyChanges.length) segments.push(`${diff.dependencyChanges.length} dependenc${diff.dependencyChanges.length === 1 ? "y" : "ies"}`);
  if (diff.statusChanged) segments.push("status");
  if (diff.modelChanged) segments.push("model/version");
  if (diff.metadataChanged) segments.push("metadata");
  return `Changed: ${segments.join(", ")}.`;
}
