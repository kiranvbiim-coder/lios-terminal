import crypto from "node:crypto";
import type { ArtifactContent } from "@shared/artifactContracts";
import { evaluateFinanceFormula, extractFinanceFormulaDependencies } from "@shared/financeFormula";
import {
  P8_SCHEMA_VERSION,
  p8ChangeReviewSchema,
  p8FormulaDraftSchema,
  p8FormulaValidationSchema,
  p8ScenarioComparisonSchema,
  p8ScenarioSnapshotSchema,
  type P8ChangeReview,
  type P8ComparableScalar,
  type P8FormulaDraft,
  type P8FormulaValidation,
  type P8ScenarioComparison,
  type P8ScenarioKind,
  type P8ScenarioSnapshot,
} from "@shared/p8ScenarioContracts";

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_FLAT_ENTRIES = 20_000;

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function scalar(value: unknown): value is P8ComparableScalar {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function flatten(value: unknown, prefix = "", out: Record<string, P8ComparableScalar> = {}): Record<string, P8ComparableScalar> {
  if (Object.keys(out).length >= MAX_FLAT_ENTRIES) return out;
  if (scalar(value)) {
    if (prefix) out[prefix] = value;
    return out;
  }
  if (Array.isArray(value)) {
    value.slice(0, 2_000).forEach((item, index) => flatten(item, prefix ? prefix + "." + index : String(index), out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 5_000)) {
    if (FORBIDDEN_SEGMENTS.has(key)) continue;
    flatten(nested, prefix ? prefix + "." + key : key, out);
    if (Object.keys(out).length >= MAX_FLAT_ENTRIES) break;
  }
  return out;
}

function scenarioSections(content: ArtifactContent): { assumptions: Record<string, P8ComparableScalar>; outputs: Record<string, P8ComparableScalar> } {
  if (content.kind === "valuation") return { assumptions: flatten(content.assumptions), outputs: flatten(content.outputs) };
  if (content.kind === "backtest") return { assumptions: flatten(content.assumptions), outputs: flatten(content.metrics) };
  if (content.kind === "strategy") return { assumptions: flatten(content.parameters), outputs: {} };
  if (content.kind === "portfolio") return { assumptions: {}, outputs: { ...flatten(content.summary, "summary"), ...flatten(content.risk, "risk") } };
  if (content.kind === "screen") return { assumptions: flatten(content.state), outputs: {} };
  return { assumptions: {}, outputs: {} };
}

function comparableEqual(left: P8ComparableScalar | undefined, right: P8ComparableScalar | undefined): boolean {
  return Object.is(left, right);
}

export function buildP8ScenarioSnapshot(input: {
  artifactId: string;
  artifactVersion: number;
  title: string;
  artifactKind: string;
  scenarioKind: P8ScenarioKind;
  contentHash: string;
  forkedFromArtifactId: string | null;
  forkedFromVersion: number | null;
  content: ArtifactContent;
}): P8ScenarioSnapshot {
  const sections = scenarioSections(input.content);
  return p8ScenarioSnapshotSchema.parse({
    schemaVersion: P8_SCHEMA_VERSION,
    artifactId: input.artifactId,
    artifactVersion: input.artifactVersion,
    title: input.title,
    artifactKind: input.artifactKind,
    scenarioKind: input.scenarioKind,
    contentHash: input.contentHash,
    forkedFromArtifactId: input.forkedFromArtifactId,
    forkedFromVersion: input.forkedFromVersion,
    assumptions: sections.assumptions,
    outputs: sections.outputs,
  });
}

export function compareP8ScenarioSnapshots(input: {
  projectId: number;
  rootArtifactId: string;
  base: P8ScenarioSnapshot;
  branches: P8ScenarioSnapshot[];
}): P8ScenarioComparison {
  const snapshots = [input.base, ...input.branches];
  const assumptionKeys = [...new Set(snapshots.flatMap((item) => Object.keys(item.assumptions)))].sort();
  const outputKeys = [...new Set(snapshots.flatMap((item) => Object.keys(item.outputs)))].sort();
  const matrix = [
    ...assumptionKeys.map((key) => {
      const values = Object.fromEntries(snapshots.map((item) => [item.artifactId, item.assumptions[key] ?? null]));
      return {
        key,
        section: "assumption" as const,
        values,
        changed: snapshots.slice(1).some((item) => !comparableEqual(input.base.assumptions[key], item.assumptions[key])),
      };
    }),
    ...outputKeys.map((key) => {
      const values = Object.fromEntries(snapshots.map((item) => [item.artifactId, item.outputs[key] ?? null]));
      return {
        key,
        section: "output" as const,
        values,
        changed: snapshots.slice(1).some((item) => !comparableEqual(input.base.outputs[key], item.outputs[key])),
      };
    }),
  ];
  const waterfall = input.branches.flatMap((branch) => assumptionKeys.flatMap((key) => {
    const baseValue = input.base.assumptions[key];
    const branchValue = branch.assumptions[key];
    if (typeof baseValue !== "number" || typeof branchValue !== "number" || Object.is(baseValue, branchValue)) return [];
    return [{
      branchArtifactId: branch.artifactId,
      key,
      baseValue,
      branchValue,
      delta: branchValue - baseValue,
    }];
  }));
  return p8ScenarioComparisonSchema.parse({
    schemaVersion: P8_SCHEMA_VERSION,
    projectId: input.projectId,
    rootArtifactId: input.rootArtifactId,
    base: input.base,
    branches: input.branches,
    matrix,
    waterfall,
    changedAssumptionKeys: matrix.filter((row) => row.section === "assumption" && row.changed).map((row) => row.key),
    changedOutputKeys: matrix.filter((row) => row.section === "output" && row.changed).map((row) => row.key),
  });
}

function assumptionsContainer(content: ArtifactContent): { key: "assumptions" | "parameters" | "state"; value: Record<string, unknown> } {
  if (content.kind === "valuation" || content.kind === "backtest") return { key: "assumptions", value: content.assumptions };
  if (content.kind === "strategy") return { key: "parameters", value: content.parameters };
  if (content.kind === "screen") return { key: "state", value: content.state };
  throw new Error("This Artifact kind does not expose mergeable structured assumptions.");
}

function readPath(root: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".").filter(Boolean);
  let current: unknown = root;
  for (const segment of segments) {
    if (FORBIDDEN_SEGMENTS.has(segment)) throw new Error("Unsafe assumption path.");
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function writePath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".").filter(Boolean);
  if (!segments.length) throw new Error("Assumption path is empty.");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (FORBIDDEN_SEGMENTS.has(segment)) throw new Error("Unsafe assumption path.");
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }
    const next = current[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function buildSelectedAssumptionPatch(source: ArtifactContent, target: ArtifactContent, keys: string[]): Record<string, unknown> {
  const sourceContainer = assumptionsContainer(source);
  const targetContainer = assumptionsContainer(target);
  if (sourceContainer.key !== targetContainer.key) throw new Error("Source and target assumption models are incompatible.");
  const next = cloneRecord(targetContainer.value);
  for (const key of [...new Set(keys)]) {
    const value = readPath(sourceContainer.value, key);
    if (value === undefined) throw new Error("Source assumption is unavailable: " + key);
    writePath(next, key, value);
  }
  return { [targetContainer.key]: next };
}

function flattenUnknown(value: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (Object.keys(out).length >= 50_000) return out;
  if (value === null || typeof value !== "object") {
    if (prefix) out[prefix] = value;
    return out;
  }
  if (Array.isArray(value)) {
    value.slice(0, 5_000).forEach((item, index) => flattenUnknown(item, prefix ? prefix + "." + index : String(index), out));
    return out;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 10_000)) {
    if (FORBIDDEN_SEGMENTS.has(key)) continue;
    flattenUnknown(nested, prefix ? prefix + "." + key : key, out);
  }
  return out;
}

export function buildP8ChangeReview(before: ArtifactContent, after: ArtifactContent): P8ChangeReview {
  const left = flattenUnknown(before);
  const right = flattenUnknown(after);
  const paths = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const changedPaths = paths.flatMap((path) => {
    const a = left[path];
    const b = right[path];
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    const numericDelta = typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
    return [{ path, before: a ?? null, after: b ?? null, numericDelta }];
  });
  return p8ChangeReviewSchema.parse({ changed: changedPaths.length > 0, changedPaths });
}

export function validateP8FormulaDraft(raw: P8FormulaDraft): P8FormulaValidation {
  const draft = p8FormulaDraftSchema.parse(raw);
  const dependencies = extractFinanceFormulaDependencies(draft.expression);
  const parserProbeValues = Object.fromEntries(dependencies.map((dependency) => [dependency, 1]));
  const parserProbe = evaluateFinanceFormula(draft.expression, parserProbeValues);
  const sampleResult = evaluateFinanceFormula(draft.expression, draft.sampleValues);
  const errors = parserProbe.error ? [parserProbe.error] : [];
  const missingSampleValues = dependencies.filter((dependency) => !(dependency in draft.sampleValues));
  const fingerprint = hash({
    schemaVersion: P8_SCHEMA_VERSION,
    expression: draft.expression,
    targetSurface: draft.targetSurface,
    targetKey: draft.targetKey,
    targetArtifactId: draft.targetArtifactId,
    dependencies,
  });
  return p8FormulaValidationSchema.parse({
    schemaVersion: P8_SCHEMA_VERSION,
    status: errors.length ? "invalid" : "valid",
    expression: draft.expression,
    targetSurface: draft.targetSurface,
    targetKey: draft.targetKey,
    dependencies,
    missingSampleValues,
    sampleValue: !errors.length && !sampleResult.error && !sampleResult.missing.length ? sampleResult.value : null,
    errors,
    fingerprint,
  });
}
