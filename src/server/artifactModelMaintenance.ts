import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { artifactInteractionReceipts, datasetSnapshots } from "@shared/schema";
import type { DatasetSnapshot, DataEntitlementPolicy, FinancialModelRun } from "@shared/schema";
import { spreadsheetArtifactContentSchema } from "@shared/artifactContracts";
import type { SpreadsheetCellLineage } from "@shared/artifactContracts";
import { financialDatasetPayloadSchema } from "@shared/pointInTimeData";
import type { FinancialDatasetPayload, CanonicalFinancialPeriod } from "@shared/pointInTimeData";
import { INTEGRATED_FINANCIAL_MODEL_VERSION, runIntegratedFinancialModel } from "@shared/integratedFinancialModel";
import type { ArtifactModelMaintenanceOptions, ArtifactModelMaintenanceTarget, ArtifactModelMaintenanceSource, ArtifactModelMaintenanceReview, ArtifactModelMaintenanceResult, ArtifactModelMaintenanceChange, ArtifactModelMaintenancePreservedCell } from "@shared/artifactModelMaintenance";
import { getDb } from "./db";
import { canAccessDatasetSnapshot } from "./columnarArtifactStore";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";
import { hashLedgerValue } from "./ledgerStore";
import { getArtifact, getArtifactVersion, createArtifactVersion } from "./artifactStore";
import { loadArtifactIntegratedModelReview } from "./artifactIntegratedModelInput";
import { IntegratedModelArtifactError, loadIntegratedModelArtifactSource } from "./integratedModelArtifact";
import { saveFinancialModelRun } from "./financialModelRunStore";
import type { TenantContext } from "./tenantContext";
import type { SpreadsheetContent } from "@shared/spreadsheetCellLineage";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const artifactModelMaintenanceHeadSchema = z.object({ version: z.number().int().positive(), contentHash: hash }).strict();
export const artifactModelMaintenanceReviewSchema = artifactModelMaintenanceHeadSchema.extend({ targetDatasetSnapshotId: z.string().uuid(), targetContentHash: hash }).strict();
export const artifactModelMaintenanceApplySchema = artifactModelMaintenanceReviewSchema.extend({ reviewHash: hash }).strict();
function fail(status: number, message: string): never { throw new IntegratedModelArtifactError(status, message); }
function same(a: unknown, b: unknown): boolean { return stableSnapshotHash(a) === stableSnapshotHash(b); }
export function maintenancePeriodKey(period: Pick<CanonicalFinancialPeriod, "fiscalYear" | "period" | "periodEnd">): string { return `${period.fiscalYear}:${period.period}:${period.periodEnd}`; }
function sourceMetadata(source: { run: FinancialModelRun; snapshot: DatasetSnapshot }): ArtifactModelMaintenanceSource {
  return { runId: source.run.id, datasetSnapshotId: source.snapshot.id, datasetContentHash: source.snapshot.contentHash, periods: financialDatasetPayloadSchema.parse(source.snapshot.payload).periods.map(({ fiscalYear, period, periodEnd }) => ({ fiscalYear, period, periodEnd })) };
}
function targetMetadata(snapshot: DatasetSnapshot, policy: DataEntitlementPolicy, payload: FinancialDatasetPayload): ArtifactModelMaintenanceTarget {
  return { id: snapshot.id, contentHash: snapshot.contentHash, symbol: payload.symbol, currency: snapshot.currency, availableAt: snapshot.availableAt.toISOString(), provider: snapshot.provider, source: snapshot.source, periods: payload.periods.map(({ fiscalYear, period, periodEnd }) => ({ fiscalYear, period, periodEnd })), entitlementPolicyId: policy.id, entitlementPolicyHash: policy.contentHash };
}
async function loadTarget(ctx: TenantContext, id: string) {
  // Rights/tenant/availability are checked on metadata before fetching any source payload.
  const [identity] = await getDb().select({ id: datasetSnapshots.id, organizationId: datasetSnapshots.organizationId, createdByUserId: datasetSnapshots.createdByUserId, entitlementPolicyId: datasetSnapshots.entitlementPolicyId, provider: datasetSnapshots.provider, dataClass: datasetSnapshots.dataClass, availableAt: datasetSnapshots.availableAt, expiresAt: datasetSnapshots.expiresAt }).from(datasetSnapshots).where(eq(datasetSnapshots.id, id)).limit(1);
  const now = new Date();
  if (!identity || identity.dataClass !== "financial_statements" || !canAccessDatasetSnapshot(identity, ctx)) return fail(404, "Target snapshot is not accessible in the active tenant.");
  if (identity.availableAt > now || (identity.expiresAt && identity.expiresAt <= now)) return fail(422, "Target source is not currently available.");
  const policy = identity.entitlementPolicyId ? await getEntitlementPolicyById(identity.entitlementPolicyId) : null;
  if (!policy || policy.provider !== identity.provider || policy.dataClass !== identity.dataClass || policy.effectiveFrom > now || (policy.effectiveTo && policy.effectiveTo <= now) || !["model_input", "display", "derived_output", "export"].every(use => policy.permittedUses.includes(use)) || (policy.accessScope === "internal_only" && !ctx.role.startsWith("internal_"))) return fail(403, "Target rights do not currently permit model input, display, derived output and export.");
  const [snapshot] = await getDb().select().from(datasetSnapshots).where(eq(datasetSnapshots.id, id)).limit(1);
  if (!snapshot || !canAccessDatasetSnapshot(snapshot, ctx) || snapshot.entitlementPolicyId !== policy.id || snapshot.provider !== identity.provider || snapshot.availableAt > new Date()) return fail(409, "Target source access changed during review.");
  if (Buffer.byteLength(JSON.stringify(snapshot.payload), "utf8") > 2 * 1024 * 1024) return fail(422, "Target financial payload exceeds the complete review limit.");
  if (stableSnapshotHash({ payload: snapshot.payload, provider: snapshot.provider, lineage: snapshot.lineage }) !== snapshot.contentHash) return fail(409, "Target source payload does not match its immutable content hash.");
  const payload = financialDatasetPayloadSchema.parse(snapshot.payload);
  if (payload.periods.some(period => new Date(period.availableAt) > now)) return fail(422, "Target includes a reported period that is not yet available.");
  return { snapshot, policy, payload };
}

/** Complete semantic source diff: source decimals stay their native JS representation; no scale/currency inference. */
export function compareMaintenanceSources(oldSnapshot: DatasetSnapshot, nextSnapshot: DatasetSnapshot): ArtifactModelMaintenanceChange[] {
  const old = financialDatasetPayloadSchema.parse(oldSnapshot.payload), next = financialDatasetPayloadSchema.parse(nextSnapshot.payload);
  if (oldSnapshot.id === nextSnapshot.id || oldSnapshot.entityKey !== nextSnapshot.entityKey || old.symbol !== next.symbol || oldSnapshot.schemaVersion !== nextSnapshot.schemaVersion || oldSnapshot.frequency !== nextSnapshot.frequency || oldSnapshot.currency !== nextSnapshot.currency) return fail(422, "Target must be a different immutable source for the same entity, symbol, schema, frequency and currency.");
  if (nextSnapshot.availableAt < oldSnapshot.availableAt || nextSnapshot.retrievedAt < oldSnapshot.retrievedAt) return fail(422, "Target cannot regress source availability or retrieval time.");
  const oldPeriods = new Map(old.periods.map(period => [maintenancePeriodKey(period), period]));
  const nextPeriods = new Map(next.periods.map(period => [maintenancePeriodKey(period), period]));
  if (oldPeriods.size !== old.periods.length || nextPeriods.size !== next.periods.length) return fail(422, "Duplicate financial period identities cannot be maintained.");
  for (const key of oldPeriods.keys()) if (!nextPeriods.has(key)) return fail(422, "Target must retain every existing reported period identity; period deletion/reinterpretation is not maintenance.");
  const changes: ArtifactModelMaintenanceChange[] = [];
  let economicChange = false;
  const latest = old.periods.map(period => period.periodEnd).sort().at(-1)!;
  for (const period of next.periods) {
    const periodKey = maintenancePeriodKey(period), before = oldPeriods.get(periodKey);
    if (before && before.currency !== period.currency) return fail(422, "A reported period currency changed; no economic unit conversion is inferred.");
    if (!before && (period.periodEnd <= latest || !old.periods.some(item => item.period === period.period && item.currency === period.currency))) return fail(422, "Added actuals require an explicitly newer period with the same period convention and currency.");
    const record = (path: string, a: string | number | null, b: string | number | null) => { if (!Object.is(a, b)) changes.push({ kind: before ? "changed" : "added", periodKey, path, before: a, after: b, oldSourceHash: oldSnapshot.contentHash, newSourceHash: nextSnapshot.contentHash }); };
    if (!before) { economicChange = true; record("period", null, periodKey); }
    for (const key of ["filingDate", "availableAt", "currency"] as const) record(key, before?.[key] ?? null, period[key]);
    record("sources", before ? JSON.stringify(before.sources) : null, JSON.stringify(period.sources));
    for (const group of ["income", "balance", "cashflow", "segments", "geographies"] as const) for (const key of [...new Set([...Object.keys(before?.[group] ?? {}), ...Object.keys(period[group])])].sort()) {
      const a = before?.[group][key] ?? null, b = period[group][key] ?? null;
      if (!Object.is(a, b)) economicChange = true;
      record(`${group}.${key}`, a, b);
    }
  }
  if (!economicChange) return fail(422, "Target contains no added reported period or changed reported value; maintenance would be a no-op.");
  return changes;
}
function column(index: number): string { let result = ""; for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result; }
function columnIndex(ref: string): number { let n = 0; for (const c of ref.match(/^[A-Z]+/)![0]) n = n * 26 + c.charCodeAt(0) - 64; return n; }
function semantic(lineage: SpreadsheetCellLineage): string {
  if (lineage.kind === "reported_actual") return `actual:${lineage.fiscalYear}:${lineage.period}:${lineage.periodEnd}:${lineage.statement}:${lineage.canonicalKey}`;
  if (lineage.kind === "engine_output") return `forecast:${lineage.fiscalYear}:${lineage.resultPath?.split(".").slice(2).join(".")}`;
  return `input:${lineage.resultPath}`;
}
export function maintenancePreservedCells(current: SpreadsheetContent, baseline: SpreadsheetContent): ArtifactModelMaintenancePreservedCell[] {
  const protectedCells: ArtifactModelMaintenancePreservedCell[] = [];
  for (const sheet of current.sheets) {
    const old = baseline.sheets.find(item => item.id === sheet.id);
    const boundCells = new Map(Object.values(old?.cells ?? {}).flatMap(value => value.lineage ? [[semantic(value.lineage), value] as const] : []));
    for (const [cell, value] of Object.entries(sheet.cells)) {
      const original = value.lineage ? boundCells.get(semantic(value.lineage)) : old?.cells[cell];
      const reason = /^=/.test(value.raw) ? "formula" : value.lineage?.custody === "imported_history" ? "user_override" : !original ? "custom" : value.raw !== original.raw ? "user_override" : null;
      if (reason) protectedCells.push({ sheetId: sheet.id, cell, raw: value.raw, format: value.format, reason });
    }
  }
  return protectedCells;
}

/** Keep native coordinates and every authored cell. New periods/metrics append; matching is by semantic identity. */
export function mergeMaintainedWorkbook(current: SpreadsheetContent, baseline: SpreadsheetContent, projected: SpreadsheetContent): SpreadsheetContent {
  const result = structuredClone(current);
  const protectedCells = new Set(maintenancePreservedCells(current, baseline).map(item => `${item.sheetId}!${item.cell}`));
  for (const next of projected.sheets) {
    const target = result.sheets.find(item => item.id === next.id)!;
    const previous = baseline.sheets.find(item => item.id === next.id)!;
    if (next.id === "provenance") {
      // Engine provenance is protected, unlike custom user worksheets. Existing native names/formats remain.
      for (const [ref, cell] of Object.entries(next.cells)) {
        if (protectedCells.has(`${target.id}!${ref}`)) return fail(422, "New run provenance overlaps an authored cell; move that authored cell before maintenance.");
        target.cells[ref] = { ...cell, format: target.cells[ref]?.format ?? cell.format };
      }
      for (const ref of Object.keys(previous.cells)) if (!next.cells[ref]) delete target.cells[ref];
      target.rowCount = Math.max(target.rowCount, next.rowCount); target.columnCount = Math.max(target.columnCount, next.columnCount);
      continue;
    }
    if (next.id === "assumptions" || next.id === "schedule-inputs") {
      for (let row = 2; row <= next.rowCount; row++) {
        const ref = Object.entries(target.cells).find(([ref, cell]) => /^A[1-9]\d*$/.test(ref) && cell.raw === next.cells[`A${row}`].raw)?.[0];
        const value = next.cells[`B${row}`];
        if (!ref || !value?.lineage) continue;
        const at = `B${ref.slice(1)}`, currentValue = target.cells[at];
        target.cells[at] = { ...currentValue, lineage: { ...value.lineage, capturedFormat: currentValue.format } };
      }
      continue;
    }
    if (next.id !== "actuals" && !next.id.startsWith("forecast-")) {
      for (const [ref, value] of Object.entries(next.cells)) {
        if (protectedCells.has(`${target.id}!${ref}`)) continue;
        if (!target.cells[ref] || target.cells[ref].raw === previous.cells[ref]?.raw) target.cells[ref] = { ...value, format: target.cells[ref]?.format ?? value.format };
      }
      target.rowCount = Math.max(target.rowCount, next.rowCount); target.columnCount = Math.max(target.columnCount, next.columnCount);
      continue;
    }
    const actual = next.id === "actuals", firstDataColumn = actual ? 3 : 2;
    const oldColumns = new Map<string, number>();
    const rowMap = new Map<string, number>();
    for (const [ref, cell] of Object.entries(target.cells)) {
      const row = Number(ref.match(/\d+$/)![0]);
      if (cell.lineage?.kind === "reported_actual") oldColumns.set(`${cell.lineage.fiscalYear}:${cell.lineage.period}:${cell.lineage.periodEnd}`, columnIndex(ref));
      else if (cell.lineage?.kind === "engine_output") oldColumns.set(cell.lineage.fiscalYear ?? "", columnIndex(ref));
      if (actual && /^B[1-9]\d*$/.test(ref) && row >= 6) rowMap.set(`${target.cells[`A${row}`]?.raw}:${cell.raw}`, row);
      if (!actual && /^A[1-9]\d*$/.test(ref) && row >= 2) rowMap.set(cell.raw, row);
    }
    const columns = new Map<number, number>();
    for (let c = firstDataColumn; c <= next.columnCount; c++) {
      const example = Object.entries(next.cells).find(([ref, cell]) => columnIndex(ref) === c && cell.lineage)?.[1].lineage;
      const key = example?.kind === "reported_actual" ? `${example.fiscalYear}:${example.period}:${example.periodEnd}` : example?.fiscalYear;
      if (!key) return fail(422, "Projected period has no verified semantic values.");
      let at = oldColumns.get(key);
      if (!at) { at = ++target.columnCount; oldColumns.set(key, at); }
      columns.set(c, at);
      for (let row = 1; row < (actual ? 6 : 2); row++) {
        const sourceRef = `${column(c)}${row}`, ref = `${column(at)}${row}`, cell = next.cells[sourceRef];
        if (cell && !protectedCells.has(`${target.id}!${ref}`)) target.cells[ref] = { ...cell, format: target.cells[ref]?.format ?? cell.format };
      }
    }
    for (let row = actual ? 6 : 2; row <= next.rowCount; row++) {
      const label = actual ? `${next.cells[`A${row}`].raw}:${next.cells[`B${row}`].raw}` : next.cells[`A${row}`].raw;
      let at = rowMap.get(label);
      if (!at) { at = ++target.rowCount; rowMap.set(label, at); for (let c = 1; c < firstDataColumn; c++) target.cells[`${column(c)}${at}`] = { ...next.cells[`${column(c)}${row}`] }; }
      for (let c = firstDataColumn; c <= next.columnCount; c++) {
        const value = next.cells[`${column(c)}${row}`], ref = `${column(columns.get(c)!)}${at}`;
        if (!value) continue;
        const prior = target.cells[ref];
        if (protectedCells.has(`${target.id}!${ref}`)) { if (prior?.lineage) prior.lineage = { ...prior.lineage, custody: "imported_history" }; continue; }
        target.cells[ref] = { ...value, format: prior?.format ?? value.format, ...(value.lineage ? { lineage: { ...value.lineage, capturedFormat: prior?.format ?? value.format } } : {}) };
      }
    }
    // Forecasts outside the new horizon remain historical, not falsely current new-run output.
    for (const cell of Object.values(target.cells)) if (cell.lineage?.modelRunId && cell.lineage.modelRunId !== projected.sheets.find(item => item.id === "assumptions")?.cells.B2.lineage?.modelRunId) cell.lineage = { ...cell.lineage, custody: "imported_history" };
  }
  const parsed = spreadsheetArtifactContentSchema.parse(result);
  if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > 2 * 1024 * 1024) return fail(422, "Maintained workbook exceeds the 2 MiB canonical limit; no user work was truncated.");
  return parsed;
}

async function loadHead(ctx: TenantContext, artifactId: string, request: z.infer<typeof artifactModelMaintenanceHeadSchema>) {
  const loaded = await loadArtifactIntegratedModelReview(ctx, artifactId, request.version, true);
  if (loaded.version.contentHash !== request.contentHash) return fail(409, "Workbook content changed; review the current head.");
  if (loaded.source.snapshot.availableAt > new Date()) return fail(422, "Current model source is not yet available.");
  return loaded;
}
export async function listArtifactModelMaintenanceOptions(ctx: TenantContext, artifactId: string, raw: z.infer<typeof artifactModelMaintenanceHeadSchema>): Promise<ArtifactModelMaintenanceOptions> {
  const request = artifactModelMaintenanceHeadSchema.parse(raw), loaded = await loadHead(ctx, artifactId, request);
  const candidates = await getDb().select({ id: datasetSnapshots.id, organizationId: datasetSnapshots.organizationId, createdByUserId: datasetSnapshots.createdByUserId }).from(datasetSnapshots).where(and(eq(datasetSnapshots.entityKey, loaded.source.snapshot.entityKey), eq(datasetSnapshots.dataClass, "financial_statements")));
  const targets: ArtifactModelMaintenanceTarget[] = [];
  for (const candidate of candidates) {
    if (candidate.id === loaded.source.snapshot.id || !canAccessDatasetSnapshot(candidate, ctx)) continue;
    try { const target = await loadTarget(ctx, candidate.id); compareMaintenanceSources(loaded.source.snapshot, target.snapshot); targets.push(targetMetadata(target.snapshot, target.policy, target.payload)); }
    catch (error) { if (!(error instanceof IntegratedModelArtifactError) && !(error instanceof z.ZodError)) throw error; }
  }
  if ((await getArtifact(ctx, artifactId)).headVersion !== request.version) return fail(409, "Artifact head moved during option discovery.");
  return { artifactId, ...request, engineRev: INTEGRATED_FINANCIAL_MODEL_VERSION, source: sourceMetadata(loaded.source), targets, canApply: true };
}
async function loadMaintenanceReview(ctx: TenantContext, artifactId: string, raw: z.infer<typeof artifactModelMaintenanceReviewSchema>) {
  const request = { version: raw.version, contentHash: raw.contentHash, targetDatasetSnapshotId: raw.targetDatasetSnapshotId, targetContentHash: raw.targetContentHash };
  const loaded = await loadHead(ctx, artifactId, request);
  const target = await loadTarget(ctx, request.targetDatasetSnapshotId);
  if (target.snapshot.contentHash !== request.targetContentHash) return fail(409, "Selected target source hash changed; select and review again.");
  const changes = compareMaintenanceSources(loaded.source.snapshot, target.snapshot);
  const content = spreadsheetArtifactContentSchema.parse(loaded.version.content);
  const withoutHash = { artifactId, ...request, engineRev: INTEGRATED_FINANCIAL_MODEL_VERSION, source: sourceMetadata(loaded.source), target: targetMetadata(target.snapshot, target.policy, target.payload), assumptions: loaded.review.assumptions, schedules: loaded.review.schedules, inputHash: stableSnapshotHash({ datasetContentHash: target.snapshot.contentHash, assumptions: loaded.review.assumptions, specializedSchedules: loaded.review.schedules }), changes, preservedCells: maintenancePreservedCells(content, loaded.source.projection.content), sourceRefs: loaded.review.sourceRefs };
  const reviewHash = hashLedgerValue({ ...withoutHash, ctx, originalReviewHash: loaded.review.reviewHash, targetSnapshot: target.snapshot, targetPolicy: target.policy });
  if ((await getArtifact(ctx, artifactId)).headVersion !== request.version) return fail(409, "Artifact head moved during maintenance review.");
  return { ...loaded, target, content, review: { ...withoutHash, reviewHash } satisfies ArtifactModelMaintenanceReview };
}
export async function reviewArtifactModelMaintenance(ctx: TenantContext, artifactId: string, raw: z.infer<typeof artifactModelMaintenanceReviewSchema>): Promise<ArtifactModelMaintenanceReview> {
  return (await loadMaintenanceReview(ctx, artifactId, artifactModelMaintenanceReviewSchema.parse(raw))).review;
}
function requestIdentity(ctx: TenantContext, artifactId: string, request: z.infer<typeof artifactModelMaintenanceApplySchema>): string { return `model-maintenance:${hashLedgerValue({ actor: ctx.userId, organizationId: ctx.organizationId, artifactId, request })}`; }
async function replayMaintenance(ctx: TenantContext, artifactId: string, request: z.infer<typeof artifactModelMaintenanceApplySchema>): Promise<ArtifactModelMaintenanceResult | null> {
  const artifact = await getArtifact(ctx, artifactId);
  if (artifact.ownerUserId !== ctx.userId) return fail(404, "Owned model Artifact not found.");
  const [receipt] = await getDb().select().from(artifactInteractionReceipts).where(and(eq(artifactInteractionReceipts.artifactId, artifactId), eq(artifactInteractionReceipts.requestId, requestIdentity(ctx, artifactId, request)), eq(artifactInteractionReceipts.createdByUserId, ctx.userId))).limit(1);
  if (!receipt?.toVersion) return null;
  const detail = receipt.detail.modelMaintenance;
  if (!detail || typeof detail !== "object" || !("runId" in detail) || typeof detail.runId !== "string" || !("review" in detail)) return fail(409, "Maintenance replay receipt is incomplete.");
  // A receipt is replay identity, never continuing source authorization.
  const source = await loadIntegratedModelArtifactSource(ctx, detail.runId, artifact.projectId, true, artifact.owningChatId);
  const target = await loadTarget(ctx, request.targetDatasetSnapshotId);
  if (target.snapshot.contentHash !== request.targetContentHash || source.snapshot.id !== target.snapshot.id) return fail(409, "Maintenance replay source changed.");
  const review = detail.review as ArtifactModelMaintenanceReview;
  const original = await loadIntegratedModelArtifactSource(ctx, review.source.runId, artifact.projectId, true, artifact.owningChatId);
  if (review.engineRev !== INTEGRATED_FINANCIAL_MODEL_VERSION || original.snapshot.contentHash !== review.source.datasetContentHash
    || !original.projection.sourceRefs.every(ref => review.sourceRefs.includes(ref))
    || target.policy.contentHash !== review.target.entitlementPolicyHash) return fail(409, "Maintenance replay source rights or engine revision changed.");
  if (review.reviewHash !== request.reviewHash || review.contentHash !== request.contentHash || review.version !== request.version) return fail(409, "Maintenance replay does not match the exact reviewed request.");
  const version = await getArtifactVersion(ctx, artifactId, receipt.toVersion);
  return { review, artifact, version, receipt: { runId: source.run.id, resultHash: source.run.resultHash, datasetSnapshotId: source.snapshot.id, datasetContentHash: source.snapshot.contentHash, reviewHash: request.reviewHash, replayed: true } };
}
export async function applyArtifactModelMaintenance(ctx: TenantContext, artifactId: string, raw: z.infer<typeof artifactModelMaintenanceApplySchema>): Promise<ArtifactModelMaintenanceResult> {
  const request = artifactModelMaintenanceApplySchema.parse(raw);
  const replay = await replayMaintenance(ctx, artifactId, request); if (replay) return replay;
  const loaded = await loadMaintenanceReview(ctx, artifactId, request);
  if (loaded.review.reviewHash !== request.reviewHash) return fail(409, "Reviewed head, source, policy or engine revision changed; review again.");
  const result = runIntegratedFinancialModel({ datasetSnapshotId: loaded.target.snapshot.id, payload: loaded.target.payload, assumptions: loaded.review.assumptions, schedules: loaded.review.schedules });
  if (result.modelVersion !== loaded.review.engineRev || !same(result.assumptions, loaded.review.assumptions) || !same(result.specializedSchedules, loaded.review.schedules)) return fail(422, "Engine did not preserve the exact reviewed assumptions, schedules and revision.");
  const resultHash = stableSnapshotHash({ modelVersion: result.modelVersion, datasetContentHash: loaded.target.snapshot.contentHash, assumptions: result.assumptions, specializedSchedules: result.specializedSchedules, forecast: result.forecast });
  const run = await saveFinancialModelRun({ result, resultHash, createdByUserId: ctx.userId });
  if (!run || run.createdByUserId !== ctx.userId) return fail(409, "Identical globally deduplicated run belongs to another actor; no foreign result was used.");
  const fresh = await loadIntegratedModelArtifactSource(ctx, run.id, loaded.projectId, true, loaded.artifact.owningChatId);
  const latest = await loadMaintenanceReview(ctx, artifactId, request);
  if (latest.review.reviewHash !== request.reviewHash) return fail(409, "Source, rights or head changed while the engine ran; no workbook was published.");
  const content = mergeMaintainedWorkbook(loaded.content, loaded.source.projection.content, fresh.projection.content);
  const sourceRefs = [...new Set([...fresh.projection.sourceRefs, `model-maintenance-run:${run.id}`, `model-maintenance-review-sha256:${request.reviewHash}`])];
  const dependencyRefs = [...new Set([...loaded.version.dependencyRefs, ...loaded.version.sourceRefs, ...sourceRefs, `${artifactId}@v${request.version}`])];
  try {
    const version = await createArtifactVersion(ctx, { artifactId, baseVersion: request.version, content, sourceRefs, dependencyRefs, refreshSpec: { kind: "engine", sourceScope: "my_data", executionMode: "deterministic_first", capabilityIds: [], message: "Explicit reviewed immutable-source maintenance; custom/formula/override cells remain authored or historical, not recalculated engine outputs.", selection: null, engineRef: `integrated_financial_model:${run.modelVersion}:run:${run.id}` }, trustManifest: null, executionReceiptIds: [], actorType: "system", requestId: requestIdentity(ctx, artifactId, request), note: `Model maintenance: ${loaded.review.changes.length} complete reported source changes; formulas and raw overrides preserved.` }, { runId: run.id, baseContentHash: request.contentHash, review: loaded.review });
    return { review: loaded.review, artifact: await getArtifact(ctx, artifactId), version, receipt: { runId: run.id, resultHash, datasetSnapshotId: fresh.snapshot.id, datasetContentHash: fresh.snapshot.contentHash, reviewHash: request.reviewHash, replayed: false } };
  } catch (error) {
    const raced = await replayMaintenance(ctx, artifactId, request); if (raced) return raced;
    if (error instanceof Error && /head moved|concurrently/.test(error.message)) return fail(409, "Artifact head moved; maintenance was not applied.");
    throw error;
  }
}
