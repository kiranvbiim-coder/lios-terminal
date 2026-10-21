import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { spreadsheetArtifactContentSchema } from "@shared/artifactContracts";
import type { ArtifactContent } from "@shared/artifactContracts";
import { financialDatasetPayloadSchema } from "@shared/pointInTimeData";
import { integratedModelAssumptionsSchema, specializedModelSchedulesSchema, runIntegratedFinancialModel, INTEGRATED_FINANCIAL_MODEL_VERSION } from "@shared/integratedFinancialModel";
import type { IntegratedModelAssumptions, SpecializedModelSchedules } from "@shared/integratedFinancialModel";
import { artifactInteractionReceipts, projectArtifactVersions } from "@shared/schema";
import type { ProjectArtifact, ProjectArtifactVersion } from "@shared/schema";
import { getDb } from "./db";
import { createArtifactVersion, getArtifact, getArtifactVersion } from "./artifactStore";
import { hashLedgerValue } from "./ledgerStore";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";
import { saveFinancialModelRun } from "./financialModelRunStore";
import { createModelInputLineage } from "./modelInputLineage";
import type { ModelInputLineage } from "./modelInputLineage";
import { IntegratedModelArtifactError, loadIntegratedModelArtifactSource } from "./integratedModelArtifact";
import { mergeMaintainedWorkbook } from "./artifactModelMaintenance";
import type { TenantContext } from "./tenantContext";

export const artifactIntegratedModelReviewSchema = z.object({ version: z.number().int().positive() }).strict();
export const artifactIntegratedModelRunSchema = artifactIntegratedModelReviewSchema.extend({ contentHash: z.string().regex(/^[a-f0-9]{64}$/), reviewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Workbook = Extract<ArtifactContent, { kind: "spreadsheet" }>;
type Scalar = string | number | boolean | null;
export interface IntegratedModelInputChange { sheetId: "assumptions" | "schedule-inputs"; cell: string; path: string; before: Scalar; after: Scalar }
export interface ArtifactIntegratedModelReview {
  artifactId: string; version: number; contentHash: string; reviewHash: string; engineRev: string;
  source: { runId: string; runResultHash: string; datasetSnapshotId: string; datasetContentHash: string; entitlementPolicyId: string; entitlementPolicyHash: string };
  assumptions: IntegratedModelAssumptions; schedules: SpecializedModelSchedules; changedFields: IntegratedModelInputChange[]; sourceRefs: string[]; inputHash: string;
}
export interface ArtifactIntegratedModelRun {
  review: ArtifactIntegratedModelReview;
  outputArtifact: ProjectArtifact;
  outputVersion: ProjectArtifactVersion;
  receipt: { runId: string; resultHash: string; datasetSnapshotId: string; datasetContentHash: string; inputHash: string; calculatedAt: string; deterministic: true };
  lineage: { modelInput: ModelInputLineage | null };
}
function invalid(message: string): never { throw new IntegratedModelArtifactError(422, message); }
function same(a: unknown, b: unknown): boolean { return stableSnapshotHash(a) === stableSnapshotHash(b); }

// Decimal equivalence to the native JS round-trip string, not a claim of binary/source-decimal exactness.
function decimalIdentity(raw: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) return invalid("Numeric input must be decimal text, not a formula, fraction, unit or expression.");
  let digits = `${match[2]}${match[3] ?? ""}`.replace(/^0+/, "");
  if (!digits) return "0";
  let exponent = BigInt(match[4] ?? "0") - BigInt((match[3] ?? "").length);
  while (digits.endsWith("0")) { digits = digits.slice(0, -1); exponent += 1n; }
  return `${match[1]}${digits}e${exponent}`;
}
function parseScalar(raw: string, original: Exclude<Scalar, null>, path: string): Exclude<Scalar, null> {
  if (!raw.trim() || raw !== raw.trim() || /^[=+@]/.test(raw)) return invalid(`${path}: blank, formula or non-native input is not allowed.`);
  if (typeof original === "boolean") {
    if (raw !== "true" && raw !== "false") return invalid(`${path}: boolean input must be true or false.`);
    return raw === "true";
  }
  if (typeof original === "string") {
    const nativeRaw = /^[=+@-]/.test(original) ? `'${original}` : original;
    if (raw === nativeRaw) return original;
    return /^'[=+@-]/.test(raw) ? raw.slice(1) : raw;
  }
  const number = Number(raw);
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER || decimalIdentity(raw) !== decimalIdentity(String(number))) return invalid(`${path}: unsafe or inexact numeric text cannot be passed to the engine.`);
  return number;
}

/** Only existing typed scalar cells are inputs. Structural null/empty-array markers cannot create new schedules. */
export function parseIntegratedModelWorkbookInputs(content: unknown, baseline: Workbook, original: { assumptions: IntegratedModelAssumptions; specializedSchedules: SpecializedModelSchedules }) {
  const parsed = spreadsheetArtifactContentSchema.safeParse(content);
  if (!parsed.success) return invalid("Current Artifact is not a valid canonical workbook.");
  if (Buffer.byteLength(JSON.stringify(content), "utf8") > 2 * 1024 * 1024) return invalid("Current model workbook exceeds the 2 MiB input limit.");
  if (!same(parsed.data, content)) return invalid("Current workbook requires missing-field defaults or identifier normalization; save a canonical version before reviewing inputs.");
  const originalAssumptions = integratedModelAssumptionsSchema.strict().safeParse(original.assumptions);
  const originalSchedules = specializedModelSchedulesSchema.strict().safeParse(original.specializedSchedules);
  if (!originalAssumptions.success || !originalSchedules.success || !same(original.assumptions, originalAssumptions.data) || !same(original.specializedSchedules, originalSchedules.data)) return invalid("Persisted engine input keys/types are incomplete or unrecognized; no defaults are permitted.");
  const workbook = parsed.data;
  if (workbook.sheets.length !== baseline.sheets.length) return invalid("Integrated model input requires the exact nine-sheet projection.");
  for (let index = 0; index < baseline.sheets.length; index += 1) {
    const expected = baseline.sheets[index], actual = workbook.sheets[index];
    if (actual.id !== expected.id || actual.name !== expected.name || actual.rowCount !== expected.rowCount || actual.columnCount !== expected.columnCount || !same(actual.names, expected.names) || !same(Object.keys(actual.cells).sort(), Object.keys(expected.cells).sort())) return invalid(`Sheet ${expected.id}: missing, duplicate or unrecognized input structure.`);
    if (actual.id === "provenance" && !same(actual.cells, expected.cells)) return invalid("Run and source provenance cells are immutable engine identity, not editable inputs.");
  }
  const changedFields: IntegratedModelInputChange[] = [];
  function read(sheetId: "assumptions" | "schedule-inputs", row: number, path: string, before: Scalar): Scalar {
    const expected = baseline.sheets.find(item => item.id === sheetId)!;
    const actual = workbook.sheets.find(item => item.id === sheetId)!;
    const cell = `B${row}`;
    if (actual.cells[`A${row}`].raw !== expected.cells[`A${row}`].raw) return invalid(`${sheetId}!A${row}: unknown or duplicate input key/path.`);
    if (before === null) {
      if (actual.cells[cell].raw !== expected.cells[cell].raw) return invalid(`${path}: missing schedule remains explicit; it cannot be fabricated from a blank cell.`);
      return null;
    }
    const after = parseScalar(actual.cells[cell].raw, before, path);
    if (!Object.is(before, after)) changedFields.push({ sheetId, cell, path, before, after });
    return after;
  }
  for (const id of ["assumptions", "schedule-inputs"] as const) {
    const expected = baseline.sheets.find(item => item.id === id)!;
    const actual = workbook.sheets.find(item => item.id === id)!;
    if (actual.cells.A1.raw !== expected.cells.A1.raw || actual.cells.B1.raw !== expected.cells.B1.raw) return invalid(`${id}: unrecognized input headers.`);
  }
  const assumptions: Record<string, Scalar> = {};
  // PostgreSQL JSONB key order is not projection order; the same native schemas restore declared row ordering.
  Object.entries(originalAssumptions.data).forEach(([key, value], index) => { assumptions[key] = read("assumptions", index + 2, `assumptions.${key}`, value); });
  let scheduleRow = 2;
  function rebuild(value: unknown, path: string): unknown {
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value);
      if (!entries.length) {
        const expected = baseline.sheets.find(item => item.id === "schedule-inputs")!;
        const actual = workbook.sheets.find(item => item.id === "schedule-inputs")!;
        if (actual.cells[`A${scheduleRow}`].raw !== path || actual.cells[`B${scheduleRow}`].raw !== expected.cells[`B${scheduleRow}`].raw) return invalid(`${path}: empty schedule structure cannot be replaced by a scalar.`);
        scheduleRow += 1;
        return Array.isArray(value) ? [] : {};
      }
      const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
      for (const [key, item] of entries) (result as Record<string, unknown>)[key] = rebuild(item, path ? `${path}.${key}` : key);
      return result;
    }
    return read("schedule-inputs", scheduleRow++, path, value as Scalar);
  }
  const schedules = rebuild(originalSchedules.data, "");
  const normalizedAssumptions = integratedModelAssumptionsSchema.strict().safeParse(assumptions);
  const normalizedSchedules = specializedModelSchedulesSchema.strict().safeParse(schedules);
  if (!normalizedAssumptions.success || !normalizedSchedules.success) return invalid(`Workbook inputs violate the engine parameter schema: ${JSON.stringify([...(!normalizedAssumptions.success ? normalizedAssumptions.error.issues : []), ...(!normalizedSchedules.success ? normalizedSchedules.error.issues : [])])}`);
  // Existing defaults/unknown-key stripping are never allowed to repair a workbook input.
  if (!same(assumptions, normalizedAssumptions.data) || !same(schedules, normalizedSchedules.data)) return invalid("Engine input normalization would replace missing or unknown workbook inputs.");
  return { assumptions: normalizedAssumptions.data, schedules: normalizedSchedules.data, changedFields };
}

/** Maintenance extracts declared engine inputs without treating custom cells as engine inputs. */
export function parseMaintenanceWorkbookInputs(content: unknown, baseline: Workbook, original: { assumptions: IntegratedModelAssumptions; specializedSchedules: SpecializedModelSchedules }) {
  const workbook = spreadsheetArtifactContentSchema.parse(content);
  if (!same(workbook, content)) return invalid("Save a canonical workbook before maintenance.");
  if (new Set(workbook.sheets.map(sheet => sheet.id)).size !== workbook.sheets.length) return invalid("Workbook sheet identities must be unique.");
  for (const sheet of workbook.sheets) for (const ref of Object.keys(sheet.cells)) if (!/^[A-Z]{1,4}[1-9]\d*$/.test(ref)) return invalid(`${sheet.id}: unrecognized native cell coordinate ${ref}.`);
  const extracted = structuredClone(baseline);
  for (const expected of baseline.sheets) {
    const actual = workbook.sheets.find(sheet => sheet.id === expected.id);
    if (!actual) return invalid(`Missing integrated model sheet ${expected.id}.`);
    if (expected.id === "provenance") {
      for (const [ref, cell] of Object.entries(expected.cells)) {
        if (actual.cells[ref]?.raw !== cell.raw) return invalid("Run and source provenance is protected engine identity.");
      }
    }
    if (expected.id !== "assumptions" && expected.id !== "schedule-inputs") continue;
    for (let row = 1; row <= expected.rowCount; row++) {
      const label = expected.cells[`A${row}`].raw;
      const matches = Object.entries(actual.cells).filter(([ref, cell]) => /^A[1-9]\d*$/.test(ref) && cell.raw === label);
      if (matches.length !== 1) return invalid(`${expected.id}: missing or duplicate declared input label ${label}.`);
      const value = actual.cells[`B${matches[0][0].slice(1)}`];
      if (!value) return invalid(`${expected.id}: missing native input value for ${label}.`);
      // Existing strict parser refuses formulas and unsafe decimal text; no cached/default value is invented.
      extracted.sheets.find(sheet => sheet.id === expected.id)!.cells[`B${row}`] = { ...value };
    }
  }
  return parseIntegratedModelWorkbookInputs(extracted, baseline, original);
}

export async function loadArtifactIntegratedModelReview(ctx: TenantContext, artifactId: string, requestedVersion: number, maintenance = false) {
  artifactIntegratedModelReviewSchema.parse({ version: requestedVersion });
  const artifact = await getArtifact(ctx, artifactId);
  if (artifact.kind !== "spreadsheet" || artifact.ownerUserId !== ctx.userId) return invalid("Integrated model inputs require an owned spreadsheet Artifact.");
  if (artifact.headVersion !== requestedVersion) throw new IntegratedModelArtifactError(409, "Artifact head moved; review the current version before running.");
  // No workbook/result/source payload is read before the live actor, run, tenant and entitlement guards.
  const [metadata] = await getDb().select({ refreshSpec: projectArtifactVersions.refreshSpec, sourceRefs: projectArtifactVersions.sourceRefs, contentHash: projectArtifactVersions.contentHash }).from(projectArtifactVersions).where(and(eq(projectArtifactVersions.artifactId, artifactId), eq(projectArtifactVersions.version, requestedVersion))).limit(1);
  const ref = metadata?.refreshSpec?.kind === "engine" ? metadata.refreshSpec.engineRef : null;
  const match = typeof ref === "string" ? /^integrated_financial_model:([^:]+):run:([0-9a-f-]{36})$/.exec(ref) : null;
  if (!metadata || !match) return invalid("Artifact has no recognized integrated engine run identity.");
  const source = await loadIntegratedModelArtifactSource(ctx, match[2], artifact.projectId, true, artifact.owningChatId);
  if (source.run.modelVersion !== match[1]) return invalid("Artifact engine revision does not match its persisted run.");
  const version = await getArtifactVersion(ctx, artifactId, requestedVersion);
  const origins = await getDb().select().from(projectArtifactVersions).where(eq(projectArtifactVersions.artifactId, artifactId));
  const origin = origins.filter(item => item.refreshSpec?.engineRef === ref && same(item.sourceRefs, version.sourceRefs)).sort((a, b) => a.version - b.version)[0];
  const [maintenanceReceipt] = origin ? await getDb().select({ detail: artifactInteractionReceipts.detail }).from(artifactInteractionReceipts).where(and(eq(artifactInteractionReceipts.artifactId, artifactId), eq(artifactInteractionReceipts.toVersion, origin.version), eq(artifactInteractionReceipts.createdByUserId, ctx.userId))).limit(1) : [];
  const proof = maintenanceReceipt?.detail.modelMaintenance ?? maintenanceReceipt?.detail.modelRecompute;
  const verifiedMaintenance = proof !== null && typeof proof === "object" && "runId" in proof && proof.runId === source.run.id
    && maintenanceReceipt?.detail.contentHash === origin?.contentHash
    && (origin?.sourceRefs.includes(`model-maintenance-run:${source.run.id}`) || origin?.sourceRefs.includes(`model-recompute-run:${source.run.id}`));
  if (!origin || version.refreshSpec?.engineRef !== ref || !same(origin.sourceRefs, version.sourceRefs) || !source.projection.sourceRefs.every(item => version.sourceRefs.includes(item)) || (!same(origin.content, source.projection.content) && !verifiedMaintenance)) return invalid("Artifact run/source provenance no longer matches its immutable engine projection.");
  if (hashLedgerValue(version.content) !== version.contentHash || metadata.contentHash !== version.contentHash) return invalid("Current Artifact content hash does not match its recorded workbook.");
  const original = source.run.result as unknown as { assumptions: IntegratedModelAssumptions; specializedSchedules: SpecializedModelSchedules };
  const inputs = maintenance || verifiedMaintenance
    ? parseMaintenanceWorkbookInputs(version.content, source.projection.content, original)
    : parseIntegratedModelWorkbookInputs(version.content, source.projection.content, original);
  const inputHash = stableSnapshotHash({ datasetContentHash: source.snapshot.contentHash, assumptions: inputs.assumptions, specializedSchedules: inputs.schedules });
  const reviewWithoutHash = {
    artifactId, version: version.version, contentHash: version.contentHash, engineRev: INTEGRATED_FINANCIAL_MODEL_VERSION,
    source: { runId: source.run.id, runResultHash: source.run.resultHash, datasetSnapshotId: source.snapshot.id, datasetContentHash: source.snapshot.contentHash, entitlementPolicyId: source.policy.id, entitlementPolicyHash: source.policy.contentHash },
    ...inputs, sourceRefs: version.sourceRefs, inputHash,
  };
  const reviewHash = hashLedgerValue({ ...reviewWithoutHash, owner: ctx, projectId: artifact.projectId, owningChatId: artifact.owningChatId, artifactOwnerUserId: artifact.ownerUserId, artifactOrganizationId: artifact.organizationId, artifactStatus: artifact.status, versionId: version.id, parentVersionId: version.parentVersionId, versionCreatedAt: version.createdAt, refreshSpec: version.refreshSpec, dependencyRefs: version.dependencyRefs, sourceRun: source.run, sourceSnapshot: source.snapshot, currentPolicy: source.policy });
  // A concurrent head change invalidates even a preview; execution independently reloads every guard/hash.
  if ((await getArtifact(ctx, artifactId)).headVersion !== requestedVersion) throw new IntegratedModelArtifactError(409, "Artifact head moved during review.");
  return { review: { ...reviewWithoutHash, reviewHash } satisfies ArtifactIntegratedModelReview, source, projectId: artifact.projectId, artifact, version };
}
export async function reviewArtifactIntegratedModelInputs(ctx: TenantContext, artifactId: string, request: z.infer<typeof artifactIntegratedModelReviewSchema>) {
  return (await loadArtifactIntegratedModelReview(ctx, artifactId, artifactIntegratedModelReviewSchema.parse(request).version)).review;
}
async function replayIntegratedModelRun(ctx: TenantContext, artifactId: string, request: z.infer<typeof artifactIntegratedModelRunSchema>): Promise<ArtifactIntegratedModelRun | null> {
  const artifact = await getArtifact(ctx, artifactId);
  const [receipt] = await getDb().select().from(artifactInteractionReceipts).where(and(
    eq(artifactInteractionReceipts.artifactId, artifactId),
    eq(artifactInteractionReceipts.requestId, `model-recompute:${request.reviewHash}`),
    eq(artifactInteractionReceipts.createdByUserId, ctx.userId),
  )).limit(1);
  if (!receipt?.toVersion) return null;
  if (artifact.headVersion !== receipt.toVersion) throw new IntegratedModelArtifactError(409, "Artifact head advanced after this recomputation; review the current revision before retrying.");
  const proof = receipt.detail.modelRecompute as { runId?: string; review?: ArtifactIntegratedModelReview } | undefined;
  if (!proof?.runId || !proof.review) throw new IntegratedModelArtifactError(409, "Recompute replay receipt is incomplete.");
  const review = proof.review;
  if (review.version !== request.version || review.contentHash !== request.contentHash || review.reviewHash !== request.reviewHash) throw new IntegratedModelArtifactError(409, "Recompute replay does not match the reviewed request; review again.");
  const source = await loadIntegratedModelArtifactSource(ctx, proof.runId, artifact.projectId, true, artifact.owningChatId);
  const original = await loadIntegratedModelArtifactSource(ctx, review.source.runId, artifact.projectId, true, artifact.owningChatId);
  if (review.engineRev !== INTEGRATED_FINANCIAL_MODEL_VERSION || source.policy.contentHash !== review.source.entitlementPolicyHash
    || original.snapshot.contentHash !== review.source.datasetContentHash || source.snapshot.id !== review.source.datasetSnapshotId) throw new IntegratedModelArtifactError(409, "Recompute replay source rights or revision changed; review again.");
  const outputVersion = await getArtifactVersion(ctx, artifactId, receipt.toVersion);
  return { review, outputArtifact: artifact, outputVersion, receipt: { runId: source.run.id, resultHash: source.run.resultHash, datasetSnapshotId: source.snapshot.id, datasetContentHash: source.snapshot.contentHash, inputHash: review.inputHash, calculatedAt: source.run.createdAt.toISOString(), deterministic: true }, lineage: { modelInput: null } };
}
export async function runArtifactIntegratedModelInputs(ctx: TenantContext, artifactId: string, rawRequest: z.infer<typeof artifactIntegratedModelRunSchema>): Promise<ArtifactIntegratedModelRun> {
  const request = artifactIntegratedModelRunSchema.parse(rawRequest);
  const replay = await replayIntegratedModelRun(ctx, artifactId, request);
  if (replay) return replay;
  const { review, source, projectId, artifact, version } = await loadArtifactIntegratedModelReview(ctx, artifactId, request.version);
  if (request.contentHash !== review.contentHash || request.reviewHash !== review.reviewHash) throw new IntegratedModelArtifactError(409, "Reviewed inputs, source rights or engine revision changed; review again before running.");
  const result = runIntegratedFinancialModel({ datasetSnapshotId: source.snapshot.id, payload: financialDatasetPayloadSchema.parse(source.snapshot.payload), assumptions: review.assumptions, schedules: review.schedules });
  if (result.modelVersion !== review.engineRev || !same(result.assumptions, review.assumptions) || !same(result.specializedSchedules, review.schedules)) return invalid("Native engine did not preserve the exact reviewed parameters/revision.");
  const resultHash = stableSnapshotHash({ modelVersion: result.modelVersion, datasetContentHash: source.snapshot.contentHash, assumptions: result.assumptions, specializedSchedules: result.specializedSchedules, forecast: result.forecast });
  const run = await saveFinancialModelRun({ result, resultHash, createdByUserId: ctx.userId });
  if (!run || run.createdByUserId !== ctx.userId) throw new IntegratedModelArtifactError(409, "Existing identical model result is not owned by the current actor; no foreign run was retained.");
  // Recheck current source/head/rights before publishing any newly calculated output.
  const latest = await loadArtifactIntegratedModelReview(ctx, artifactId, request.version);
  if (latest.review.reviewHash !== review.reviewHash) throw new IntegratedModelArtifactError(409, "Reviewed source changed during execution; output was not retained.");
  const fresh = await loadIntegratedModelArtifactSource(ctx, run.id, projectId, true, artifact.owningChatId);
  const artifactRef = `${artifactId}@v${review.version}`;
  const sourceRefs = [...new Set([...fresh.projection.sourceRefs, `model-recompute-run:${run.id}`, `model-recompute-review-sha256:${review.reviewHash}`])];
  const dependencyRefs = [...new Set([...version.dependencyRefs, ...version.sourceRefs, `${artifactId}@v${review.version}`])];
  const outputVersion = await createArtifactVersion(ctx, {
    artifactId, baseVersion: review.version,
    content: mergeMaintainedWorkbook(spreadsheetArtifactContentSchema.parse(version.content), source.projection.content, fresh.projection.content),
    sourceRefs, dependencyRefs, trustManifest: null, executionReceiptIds: [], actorType: "system",
    requestId: `model-recompute:${review.reviewHash}`,
    refreshSpec: { kind: "engine", sourceScope: "my_data", executionMode: "deterministic_first", capabilityIds: [], message: "Explicitly reviewed native model recomputation; authored overrides remain preserved, not engine outputs.", selection: null, engineRef: `integrated_financial_model:${run.modelVersion}:run:${run.id}` },
    note: `Explicit model recomputation from ${artifactRef}; ${review.changedFields.length} reviewed input changes.`,
  }, { kind: "recompute", runId: run.id, baseContentHash: review.contentHash, review });
  const modelInput = ctx.organizationId ? createModelInputLineage({ organizationId: ctx.organizationId, modelId: "integrated_financial_model", modelVersionId: result.modelVersion, datasetVersionId: source.snapshot.id, transformationNodeIds: [run.id, artifactRef], sourceCellRefs: [artifactRef, ...review.changedFields.map(change => `${artifactRef}#${change.sheetId}!${change.cell}`)], targetCellRefs: result.forecast.flatMap(period => [`${period.fiscalYear}:income.revenue`, `${period.fiscalYear}:balance.totalAssets`, `${period.fiscalYear}:cashflow.cashFromOperations`]), inputHash: review.inputHash, createdByUserId: ctx.userId }) : null;
  return { review, outputArtifact: await getArtifact(ctx, artifactId), outputVersion, receipt: { runId: run.id, resultHash, datasetSnapshotId: source.snapshot.id, datasetContentHash: source.snapshot.contentHash, inputHash: review.inputHash, calculatedAt: run.createdAt.toISOString(), deterministic: true as const }, lineage: { modelInput } };
}
