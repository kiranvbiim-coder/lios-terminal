import { createHash } from "node:crypto";
import type { ValidationEvidence } from "./modelAssurance";
import { compareNumeric, type NumericComparison, type ToleranceProfile } from "./modelAssurance";

export interface GoldenOutputExpectation {
  expected: number;
  tolerance: ToleranceProfile;
}

export interface GoldenInvariant {
  id: string;
  description: string;
  check: (outputs: Record<string, number>) => boolean;
}

export interface GoldenCase {
  id: string;
  modelId: string;
  input: unknown;
  expected: Record<string, GoldenOutputExpectation>;
  invariants?: GoldenInvariant[];
}

export interface ValidationRunContext {
  modelVersion: string;
  engineVersion: string;
  dataSnapshotHash?: string | null;
  providerIds?: string[];
  deterministic: boolean;
  seed?: number | null;
}

export type GoldenCaseExecutor = (
  input: unknown,
  context: ValidationRunContext,
) => Record<string, number> | Promise<Record<string, number>>;

export interface GoldenOutputResult extends NumericComparison {
  name: string;
}

export interface GoldenInvariantResult {
  id: string;
  description: string;
  pass: boolean;
  error?: string;
}

export interface GoldenCaseResult {
  id: string;
  modelId: string;
  pass: boolean;
  outputResults: GoldenOutputResult[];
  invariantResults: GoldenInvariantResult[];
  missingOutputs: string[];
  unexpectedNonFiniteOutputs: string[];
  inputHash: string;
  outputHash: string;
  resultHash: string;
}

export interface GoldenValidationReport {
  modelId: string;
  pass: boolean;
  passedCases: number;
  totalCases: number;
  cases: GoldenCaseResult[];
  contextHash: string;
  reportHash: string;
  evidence: ValidationEvidence;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value: unknown, seen = new WeakSet<object>(), path = "$"): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Validation payload contains non-finite number at ${path}`);
    if (Object.is(value, -0)) return 0;
    return value;
  }
  if (typeof value === "bigint") {
    throw new Error(`Validation payload contains bigint at ${path}; serialize it explicitly as a decimal string`);
  }
  if (typeof value === "undefined") {
    throw new Error(`Validation payload contains undefined at ${path}`);
  }
  if (typeof value === "function") {
    throw new Error(`Validation payload contains function at ${path}`);
  }
  if (typeof value === "symbol") {
    throw new Error(`Validation payload contains symbol at ${path}`);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error(`Validation payload contains circular reference at ${path}`);
    seen.add(value);
    const normalized = value.map((item, index) => canonicalize(item, seen, `${path}[${index}]`));
    seen.delete(value);
    return normalized;
  }

  if (typeof value === "object") {
    const objectValue = value as object;
    if (seen.has(objectValue)) throw new Error(`Validation payload contains circular reference at ${path}`);
    if (value instanceof Date) {
      throw new Error(`Validation payload contains Date at ${path}; serialize dates explicitly as ISO-8601 strings`);
    }
    if (!isPlainObject(objectValue)) {
      const constructorName = objectValue.constructor?.name ?? "unknown";
      throw new Error(`Validation payload contains unsupported object type ${constructorName} at ${path}`);
    }

    seen.add(objectValue);
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(objectValue).sort()) {
      normalized[key] = canonicalize(objectValue[key], seen, `${path}.${key}`);
    }
    seen.delete(objectValue);
    return normalized;
  }

  throw new Error(`Validation payload contains unsupported value at ${path}`);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function validationDigest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function canonicalContext(context: ValidationRunContext): ValidationRunContext {
  return {
    modelVersion: context.modelVersion,
    engineVersion: context.engineVersion,
    dataSnapshotHash: context.dataSnapshotHash ?? null,
    providerIds: [...(context.providerIds ?? [])].sort(),
    deterministic: context.deterministic,
    seed: context.seed ?? null,
  };
}

function evaluateInvariants(
  invariants: GoldenInvariant[] | undefined,
  outputs: Record<string, number>,
): GoldenInvariantResult[] {
  return (invariants ?? []).map((invariant) => {
    try {
      return {
        id: invariant.id,
        description: invariant.description,
        pass: invariant.check(outputs) === true,
      };
    } catch (error) {
      return {
        id: invariant.id,
        description: invariant.description,
        pass: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export async function runGoldenCase(
  goldenCase: GoldenCase,
  context: ValidationRunContext,
  executor: GoldenCaseExecutor,
): Promise<GoldenCaseResult> {
  const outputs = await executor(goldenCase.input, context);
  const outputResults: GoldenOutputResult[] = [];
  const missingOutputs: string[] = [];
  const unexpectedNonFiniteOutputs: string[] = [];

  for (const [name, expectation] of Object.entries(goldenCase.expected)) {
    if (!(name in outputs)) {
      missingOutputs.push(name);
      continue;
    }
    const actual = outputs[name];
    if (!Number.isFinite(actual)) {
      unexpectedNonFiniteOutputs.push(name);
      continue;
    }
    outputResults.push({ name, ...compareNumeric(actual, expectation.expected, expectation.tolerance) });
  }

  for (const [name, value] of Object.entries(outputs)) {
    if (!Number.isFinite(value) && !unexpectedNonFiniteOutputs.includes(name)) {
      unexpectedNonFiniteOutputs.push(name);
    }
  }

  const invariantResults = evaluateInvariants(goldenCase.invariants, outputs);
  const pass =
    missingOutputs.length === 0 &&
    unexpectedNonFiniteOutputs.length === 0 &&
    outputResults.length === Object.keys(goldenCase.expected).length &&
    outputResults.every((result) => result.pass) &&
    invariantResults.every((result) => result.pass);

  const inputHash = validationDigest(goldenCase.input);
  const outputHash = unexpectedNonFiniteOutputs.length === 0
    ? validationDigest(outputs)
    : validationDigest(Object.fromEntries(Object.entries(outputs).map(([name, value]) => [name, Number.isFinite(value) ? value : "__NON_FINITE__"])));
  const resultHash = validationDigest({
    id: goldenCase.id,
    modelId: goldenCase.modelId,
    pass,
    outputResults,
    invariantResults,
    missingOutputs: [...missingOutputs].sort(),
    unexpectedNonFiniteOutputs: [...unexpectedNonFiniteOutputs].sort(),
    inputHash,
    outputHash,
    context: canonicalContext(context),
  });

  return {
    id: goldenCase.id,
    modelId: goldenCase.modelId,
    pass,
    outputResults,
    invariantResults,
    missingOutputs,
    unexpectedNonFiniteOutputs,
    inputHash,
    outputHash,
    resultHash,
  };
}

export async function runGoldenValidation(
  modelId: string,
  cases: GoldenCase[],
  context: ValidationRunContext,
  executor: GoldenCaseExecutor,
): Promise<GoldenValidationReport> {
  if (cases.length === 0) throw new Error("At least one golden case is required");
  if (cases.some((item) => item.modelId !== modelId)) {
    throw new Error(`All golden cases must target model ${modelId}`);
  }
  if (!context.deterministic && context.seed == null) {
    throw new Error("Stochastic validation runs require an explicit seed");
  }

  const canonicalRunContext = canonicalContext(context);
  const contextHash = validationDigest(canonicalRunContext);
  const results: GoldenCaseResult[] = [];
  for (const goldenCase of cases) {
    results.push(await runGoldenCase(goldenCase, canonicalRunContext, executor));
  }

  const passedCases = results.filter((result) => result.pass).length;
  const pass = passedCases === results.length;
  const reportHash = validationDigest({
    modelId,
    contextHash,
    caseResults: results.map((result) => ({ id: result.id, resultHash: result.resultHash, pass: result.pass })),
  });

  return {
    modelId,
    pass,
    passedCases,
    totalCases: results.length,
    cases: results,
    contextHash,
    reportHash,
    evidence: {
      kind: "known_answer",
      passed: pass,
      independent: true,
      details: `${passedCases}/${results.length} golden cases passed; report=${reportHash}`,
    },
  };
}
