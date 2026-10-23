import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { datasetSnapshots, financialModelRuns, projectChats, users, type DatasetSnapshot, type FinancialModelRun, type DataEntitlementPolicy } from "@shared/schema";
import { canonicalFinancialPeriodSchema, financialDatasetPayloadSchema, type FinancialDatasetPayload } from "@shared/pointInTimeData";
import { integratedModelAssumptionsSchema, specializedModelSchedulesSchema } from "@shared/integratedFinancialModel";
import { spreadsheetArtifactContentSchema, spreadsheetCellLineageSchema, type ArtifactContent, type SpreadsheetCellLineage } from "@shared/artifactContracts";
import { getDb, type DrizzleDb } from "./db";
import { getProject, ProjectAccessDeniedError } from "./projectStore";
import { canAccessDatasetSnapshot } from "./columnarArtifactStore";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
import { stableSnapshotHash, getDatasetSnapshot } from "./pointInTimeDatasetStore";
import { getArtifact, getArtifactVersion, persistConversationDraft, retainedConversationArtifactId } from "./artifactStore";
import type { TenantContext } from "./tenantContext";

export const integratedModelArtifactRequestSchema = z.object({
  projectId: z.number().int().positive().nullable(),
  owningChatId: z.number().int().positive().optional(),
}).strict().refine(input => input.projectId === null ? input.owningChatId !== undefined : input.owningChatId === undefined, { message: "Select one real Project or an explicit persistent owning Chat." });
export class IntegratedModelArtifactError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

// These are projection bounds, not permission to truncate an engine result.
const MAX_ROWS = 5_000;
const MAX_COLUMNS = 32;
const MAX_CELLS = 50_000;
const MAX_BYTES = 2 * 1024 * 1024;
const numericRecord = z.record(z.number().finite());
const periodChecks = z.object({ balanceSheet: z.number().finite(), cashRollForward: z.number().finite(), debtNonNegative: z.boolean(), sharesPositive: z.boolean(), circularConverged: z.boolean(), passed: z.boolean() }).strict();
const resultSchema = z.object({
  symbol: z.string().min(1).max(40), datasetSnapshotId: z.string().uuid(), modelVersion: z.string().min(1).max(80),
  assumptions: integratedModelAssumptionsSchema, specializedSchedules: specializedModelSchedulesSchema,
  historicalPeriod: canonicalFinancialPeriodSchema,
  forecast: z.array(z.object({ fiscalYear: z.string().min(1).max(80), income: numericRecord, balance: numericRecord, cashflow: numericRecord, schedules: numericRecord, checks: periodChecks }).strict()).min(1).max(10),
  openingReconciliation: z.object({ amount: z.number().finite(), classification: z.enum(["other_assets", "other_liabilities", "none"]) }).strict(),
  checks: z.object({ passed: z.boolean(), maxBalanceDifference: z.number().finite(), maxCashDifference: z.number().finite(), balanceTolerance: z.number().finite(), cashTolerance: z.number().finite(), circularConverged: z.boolean(), maxCircularDifference: z.number().finite(), warnings: z.array(z.string().max(4_000)).max(100) }).strict(),
}).strict();

type Sheet = Extract<ArtifactContent, { kind: "spreadsheet" }>["sheets"][number];
type Scalar = string | number | boolean | null;
type WithoutCapture<T> = T extends unknown ? Omit<T, "capturedRaw" | "capturedFormat"> : never;
function scalarText(value: Scalar): string {
  if (value === null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new IntegratedModelArtifactError(422, "Model output contains a non-finite number.");
    // Native JS round-trip text: no scaling, rounding or claim of original source decimal precision.
    return String(value);
  }
  const raw = String(value);
  if (raw.length > 4_000) throw new IntegratedModelArtifactError(422, "Model projection cell exceeds 4000 characters.");
  // Labels/provider metadata are text, never spreadsheet formulas.
  return /^[=+@-]/.test(raw) ? `'${raw}` : raw;
}
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
function sheet(id: string, name: string, rows: Scalar[][]): Sheet {
  if (rows.length > MAX_ROWS) throw new IntegratedModelArtifactError(422, "Model workbook exceeds projection row/column limits.");
  const columns = Math.max(...rows.map(row => row.length), 1);
  if (columns > MAX_COLUMNS) throw new IntegratedModelArtifactError(422, "Model workbook exceeds projection row/column limits.");
  const cells: Sheet["cells"] = {};
  rows.forEach((row, r) => row.forEach((value, c) => { cells[`${columnName(c)}${r + 1}`] = { raw: scalarText(value), format: null }; }));
  return { id, name, cells, names: {}, rowCount: Math.max(rows.length, 1), columnCount: columns };
}
function label(key: string): string { return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, char => char.toUpperCase()); }
function flatten(value: unknown, prefix = "", rows: Scalar[][] = [], depth = 0): Scalar[][] {
  if (depth > 8 || rows.length >= MAX_ROWS) throw new IntegratedModelArtifactError(422, "Model metadata exceeds projection limits.");
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) rows.push([prefix, Array.isArray(value) ? "No entries" : "No fields"]);
    for (const [key, item] of entries) flatten(item, prefix ? `${prefix}.${key}` : key, rows, depth + 1);
  } else if (value === null || ["string", "number", "boolean"].includes(typeof value)) rows.push([prefix, value as Scalar]);
  else throw new IntegratedModelArtifactError(422, "Model metadata contains an unsupported value.");
  return rows;
}
function requireBounded(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_BYTES) throw new IntegratedModelArtifactError(422, "Model projection exceeds the 2 MiB content limit.");
}

function validateIntegratedModelRun(run: FinancialModelRun, snapshot: DatasetSnapshot) {
  requireBounded({ result: run.result, payload: snapshot.payload, lineage: snapshot.lineage, quality: snapshot.quality });
  const result = resultSchema.parse(run.result);
  const payload: FinancialDatasetPayload = financialDatasetPayloadSchema.parse(snapshot.payload);
  if (payload.periods.length + 2 > MAX_COLUMNS) throw new IntegratedModelArtifactError(422, "Model workbook exceeds projection row/column limits.");
  const latestHistorical = [...payload.periods].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1)!;
  if (stableSnapshotHash(result.historicalPeriod) !== stableSnapshotHash(latestHistorical)) throw new IntegratedModelArtifactError(422, "Persisted model historical period does not match the source snapshot.");
  if (result.datasetSnapshotId !== snapshot.id || result.modelVersion !== run.modelVersion || result.symbol !== payload.symbol || run.symbol !== result.symbol || stableSnapshotHash(run.assumptions) !== stableSnapshotHash(result.assumptions) || result.forecast.length !== result.assumptions.projectionYears) {
    throw new IntegratedModelArtifactError(422, "Persisted model run and dataset identity do not match.");
  }
  const expectedHash = stableSnapshotHash({ modelVersion: result.modelVersion, datasetContentHash: snapshot.contentHash, assumptions: result.assumptions, specializedSchedules: result.specializedSchedules, forecast: result.forecast });
  if (expectedHash !== run.resultHash) throw new IntegratedModelArtifactError(422, "Persisted model result hash does not match its native outputs.");
  const inputHash = stableSnapshotHash({ datasetContentHash: snapshot.contentHash, assumptions: result.assumptions, specializedSchedules: result.specializedSchedules });
  return { result, payload, inputHash, latestHistorical };
}

/** Read an existing owned run only after current actor/source admission; never rerun on reopening. */
export async function readIntegratedModelRun(ctx: TenantContext, runId: string) {
  z.string().uuid().parse(runId);
  await requireCurrentModelActor(ctx, getDb(), false);
  const [identity] = await getDb().select({ datasetSnapshotId: financialModelRuns.datasetSnapshotId }).from(financialModelRuns)
    .where(and(eq(financialModelRuns.id, runId), eq(financialModelRuns.createdByUserId, ctx.userId))).limit(1);
  if (!identity) throw new IntegratedModelArtifactError(404, "Owned integrated model run not found.");
  const requiredUses = ["display", "derived_output", "model_input"];
  const { snapshot, revision } = await loadIntegratedModelDatasetSource(ctx, identity.datasetSnapshotId, requiredUses);
  const [run] = await getDb().select().from(financialModelRuns)
    .where(and(eq(financialModelRuns.id, runId), eq(financialModelRuns.createdByUserId, ctx.userId))).limit(1);
  if (!run || run.datasetSnapshotId !== snapshot.id) throw new IntegratedModelArtifactError(404, "Owned model source changed during reopening.");
  const { result, inputHash } = validateIntegratedModelRun(run, snapshot);
  const restoredSnapshot = await getDatasetSnapshot(snapshot.id);
  if (!restoredSnapshot || restoredSnapshot.contentHash !== snapshot.contentHash) throw new IntegratedModelArtifactError(409, "Saved model snapshot changed during reopening.");
  await assertIntegratedModelDatasetSourceCurrent(ctx, snapshot.id, revision, requiredUses);
  return { result, snapshot: restoredSnapshot, receipt: { runId: run.id, resultHash: run.resultHash, datasetSnapshotId: snapshot.id,
    datasetContentHash: snapshot.contentHash, inputHash, calculatedAt: run.createdAt.toISOString(), deterministic: true } };
}

/** Projects existing persisted engine values only; it does not call the engine or a provider. */
export function projectIntegratedModelWorkbook(run: FinancialModelRun, snapshot: DatasetSnapshot, policy: DataEntitlementPolicy): { content: Extract<ArtifactContent, { kind: "spreadsheet" }>; sourceRefs: string[]; inputHash: string } {
  const { result, payload, inputHash, latestHistorical } = validateIntegratedModelRun(run, snapshot);
  const runRef = `financial-model-run:${run.id}`;
  const datasetRef = `dataset-snapshot:${snapshot.id}`;
  const sourceRefs = [runRef, `financial-model-result-sha256:${run.resultHash}`, `financial-model-payload-sha256:${stableSnapshotHash(run.result)}`, datasetRef, `dataset-content-sha256:${snapshot.contentHash}`, `dataset-payload-sha256:${stableSnapshotHash(snapshot.payload)}`, `provider:${snapshot.provider}`, `entitlement-policy:${policy.id}`, `entitlement-policy-sha256:${policy.contentHash}`];
  for (const period of payload.periods) for (const source of period.sources) sourceRefs.push(`provider:${source.provider}`);
  if (Array.isArray(snapshot.lineage.sourceRefs)) {
    for (const ref of snapshot.lineage.sourceRefs) {
      if (typeof ref !== "string" || !ref.trim() || ref.length > 1_000) throw new IntegratedModelArtifactError(422, "Source lineage contains an invalid source reference.");
      sourceRefs.push(ref);
    }
  }
  const uniqueRefs = [...new Set(sourceRefs)];
  if (uniqueRefs.length > 100) throw new IntegratedModelArtifactError(422, "Model projection exceeds the 100 source reference limit.");
  sourceRefs.splice(0, sourceRefs.length, ...uniqueRefs);
  const provenance: Scalar[][] = [
    ["Integrated financial model", result.symbol],
    ["Output semantics", "Native persisted engine outputs; no spreadsheet recalculation, scaling or invented formulas."],
    ["Numeric representation", "JS number round-trip strings; binary engine outputs are not original source decimal evidence."],
    ["Editing", "This immutable version records one run. To change assumptions and recompute forecasts, explicitly run the engine again and retain the new run."],
    ["Run ID", run.id], ["Model version", run.modelVersion], ["Result hash", run.resultHash], ["Full result payload hash", stableSnapshotHash(run.result)],
    ["Input hash", inputHash], ["Calculated at", run.createdAt.toISOString()], ["Retention request identity", run.id],
    ["Dataset snapshot ID", snapshot.id], ["Dataset key", snapshot.datasetKey], ["Dataset content hash", snapshot.contentHash],
    ["Dataset provider", snapshot.provider], ["Dataset source", snapshot.source], ["Dataset currency", snapshot.currency],
    ["Unit policy", "Values retain native engine/source units; currency codes are context, not evidence of scale. Ratios are unscaled fractions; days and shares retain native units."],
    ["Available at", snapshot.availableAt.toISOString()], ["Retrieved at", snapshot.retrievedAt.toISOString()],
    ["Entitlement policy ID", policy.id], ["License type", policy.licenseType], ["Access scope", policy.accessScope], ["Redistribution", policy.redistribution],
    ["Permitted uses", policy.permittedUses.join(", ")], ["Attribution", policy.attribution], ["Terms URL", policy.termsUrl], ["Rights review at", policy.reviewedAt?.toISOString() ?? "Not reviewed"], ["Rights notes", policy.notes],
    ...sourceRefs.map(ref => ["Source reference", ref] as Scalar[]),
    ...flatten(snapshot.lineage, "Source lineage"), ...flatten(snapshot.quality, "Source quality"),
  ];
  const historical = payload.periods;
  const actualRows: Scalar[][] = [["Statement", "Metric / native units", ...historical.map(period => `${period.fiscalYear} ${period.period}`)], ["Period", "Period end", ...historical.map(period => period.periodEnd)], ["Period", "Currency (no scale inferred)", ...historical.map(period => period.currency)], ["Period", "Available at", ...historical.map(period => period.availableAt)]];
  actualRows.push(["Period", "Recorded statement providers", ...historical.map(period => period.sources.map(source => `${source.statementType}: ${source.provider}`).join("; "))]);
  for (const group of ["income", "balance", "cashflow", "segments", "geographies"] as const) {
    const keys = [...new Set(historical.flatMap(period => Object.keys(period[group])))].sort();
    for (const key of keys) actualRows.push([label(group), `${label(key)} [${key}]`, ...historical.map(period => period[group][key] ?? null)]);
  }
  const forecastSheets = (["income", "balance", "cashflow", "schedules"] as const).map(group => {
    const keys = [...new Set(result.forecast.flatMap(period => Object.keys(period[group])))].sort();
    return sheet(`forecast-${group}`, group === "schedules" ? "Forecast Schedules" : `Forecast ${label(group)}`, [
      ["Native engine output (read-only projection)", ...result.forecast.map(period => period.fiscalYear)],
      ...keys.map(key => [`${label(key)} [${key}]`, ...result.forecast.map(period => period[group][key] ?? null)]),
    ]);
  });
  const checks: Scalar[][] = [["Validation", "Native engine value"], ...flatten(result.checks, "Run checks"), ...flatten(result.openingReconciliation, "Opening reconciliation"), ["Period checks", ...result.forecast.map(period => period.fiscalYear)], ...Object.keys(result.forecast[0].checks).map(key => [label(key), ...result.forecast.map(period => period.checks[key as keyof typeof period.checks])])];
  const scheduleInputs = flatten(result.specializedSchedules);
  const sheets = [sheet("provenance", "Run and Sources", provenance), sheet("assumptions", "Assumptions", [["Assumption", "Native value (ratios unscaled)"], ...Object.entries(result.assumptions).map(([key, value]) => [`${label(key)} [${key}]`, value])]), sheet("actuals", "Historical Actuals", actualRows), ...forecastSheets, sheet("schedule-inputs", "Schedule Inputs", [["Input path", "Native value"], ...scheduleInputs]), sheet("validation", "Validation Checks", checks)];
  const common = {
    custody: "server_projection" as const,
    datasetSnapshotId: snapshot.id, contentHash: snapshot.contentHash,
    modelRunId: run.id, resultHash: run.resultHash,
    sourceRefs, entitlementPolicyRef: `entitlement-policy:${policy.id}`,
  };
  function bind(target: Sheet, ref: string, metadata: WithoutCapture<SpreadsheetCellLineage>, numeric = true): void {
    const cell = target.cells[ref];
    cell.lineage = spreadsheetCellLineageSchema.parse({
      ...metadata, capturedRaw: cell.raw, capturedFormat: cell.format, capturedValueHash: stableSnapshotHash(cell.raw),
      ...(numeric ? { numericRepresentation: "js_number_roundtrip" } : {}),
    });
  }
  const actualSheet = sheets.find(item => item.id === "actuals")!;
  let actualRow = 6;
  for (const group of ["income", "balance", "cashflow", "segments", "geographies"] as const) {
    const keys = [...new Set(historical.flatMap(period => Object.keys(period[group])))].sort();
    for (const key of keys) {
      historical.forEach((period, index) => {
        if (typeof period[group][key] !== "number") return; // Missing values and labels are not reported numbers.
        bind(actualSheet, `${columnName(index + 2)}${actualRow}`, {
          ...common, kind: "reported_actual", statement: group, canonicalKey: key,
          sourcePath: `periods.${index}.${group}.${key}`,
          period: period.period, fiscalYear: period.fiscalYear, periodEnd: period.periodEnd,
          availableAt: period.availableAt, currency: period.currency,
        });
      });
      actualRow++;
    }
  }
  for (const group of ["income", "balance", "cashflow", "schedules"] as const) {
    const target = sheets.find(item => item.id === `forecast-${group}`)!;
    const keys = [...new Set(result.forecast.flatMap(period => Object.keys(period[group])))].sort();
    keys.forEach((key, row) => result.forecast.forEach((period, index) => {
      if (typeof period[group][key] !== "number") return;
      bind(target, `${columnName(index + 1)}${row + 2}`, {
        ...common, kind: "engine_output", resultPath: `forecast.${index}.${group}.${key}`,
        fiscalYear: period.fiscalYear, currency: latestHistorical.currency,
      });
    }));
  }
  // The persisted run stores resolved inputs, not which values were user-entered versus engine defaults.
  const assumptionsSheet = sheets.find(item => item.id === "assumptions")!;
  Object.entries(result.assumptions).forEach(([key, value], row) => bind(assumptionsSheet, `B${row + 2}`, {
    ...common, kind: "user_assumption", assumptionOrigin: "persisted_run_input", resultPath: `assumptions.${key}`,
  }, typeof value === "number"));
  const scheduleSheet = sheets.find(item => item.id === "schedule-inputs")!;
  for (let row = 2; row <= scheduleSheet.rowCount; row++) {
    const cell = scheduleSheet.cells[`B${row}`];
    if (!cell?.raw || ["No entries", "No fields"].includes(cell.raw)) continue;
    bind(scheduleSheet, `B${row}`, {
      ...common, kind: "user_assumption", assumptionOrigin: "persisted_run_input",
      resultPath: `specializedSchedules.${scheduleSheet.cells[`A${row}`].raw}`,
    }, typeof scheduleInputs[row - 2][1] === "number");
  }
  const cellCount = sheets.reduce((total, item) => total + Object.keys(item.cells).length, 0);
  if (cellCount > MAX_CELLS) throw new IntegratedModelArtifactError(422, "Model workbook exceeds the 50000 cell projection limit.");
  const content = spreadsheetArtifactContentSchema.parse({ kind: "spreadsheet", sheets, activeSheetId: "provenance", rendererPreference: "builtin", calculationMode: "manual" });
  requireBounded(content);
  if (stableSnapshotHash({ payload: snapshot.payload, provider: snapshot.provider, lineage: snapshot.lineage }) !== snapshot.contentHash) {
    throw new IntegratedModelArtifactError(422, "Persisted dataset content hash does not match its source values.");
  }
  return { content, sourceRefs, inputHash };
}

type ModelSourceDb = Pick<DrizzleDb, "select">;
const financialSourceMetadata = {
  id: datasetSnapshots.id, organizationId: datasetSnapshots.organizationId, createdByUserId: datasetSnapshots.createdByUserId,
  entitlementPolicyId: datasetSnapshots.entitlementPolicyId, provider: datasetSnapshots.provider, dataClass: datasetSnapshots.dataClass,
  contentHash: datasetSnapshots.contentHash, availableAt: datasetSnapshots.availableAt, expiresAt: datasetSnapshots.expiresAt,
};
type FinancialSourceMetadata = Pick<DatasetSnapshot, keyof typeof financialSourceMetadata>;

async function requireCurrentModelActor(ctx: TenantContext, db: ModelSourceDb, lock: boolean) {
  if (!["internal_admin", "internal_analyst"].includes(ctx.role)) throw new IntegratedModelArtifactError(403, "Integrated models require an author role.");
  const query = db.select({ id: users.id, active: users.active }).from(users).where(and(eq(users.id, ctx.userId), eq(users.role, ctx.role), ctx.organizationId === null ? isNull(users.organizationId) : eq(users.organizationId, ctx.organizationId)));
  const [actor] = await (lock ? query.for("share") : query).limit(1);
  if (!actor?.active) throw new IntegratedModelArtifactError(403, "Current tenant access changed; sign in again.");
}

function modelSourceRevision(source: FinancialSourceMetadata, policy: DataEntitlementPolicy) {
  return stableSnapshotHash({ source: {
    id: source.id, organizationId: source.organizationId, createdByUserId: source.createdByUserId,
    entitlementPolicyId: source.entitlementPolicyId, provider: source.provider, dataClass: source.dataClass,
    contentHash: source.contentHash, availableAt: source.availableAt.toISOString(), expiresAt: source.expiresAt?.toISOString() ?? null,
  }, policy: { ...policy, effectiveFrom: policy.effectiveFrom.toISOString(), effectiveTo: policy.effectiveTo?.toISOString() ?? null, reviewedAt: policy.reviewedAt?.toISOString() ?? null, createdAt: policy.createdAt.toISOString() } });
}

async function admitIntegratedModelDatasetSource(ctx: TenantContext, snapshotId: string, requiredUses: readonly string[], db: ModelSourceDb, lock: boolean) {
  await requireCurrentModelActor(ctx, db, lock);
  const query = db.select(financialSourceMetadata).from(datasetSnapshots).where(eq(datasetSnapshots.id, snapshotId));
  const [identity] = await (lock ? query.for("share") : query).limit(1);
  if (!identity || identity.dataClass !== "financial_statements" || !canAccessDatasetSnapshot(identity, ctx)) throw new IntegratedModelArtifactError(404, "Financial dataset snapshot not found in the active tenant.");
  const now = new Date();
  if (identity.availableAt > now || (identity.expiresAt && identity.expiresAt <= now)) throw new IntegratedModelArtifactError(409, "Financial dataset snapshot is not currently available.");
  const policy = identity.entitlementPolicyId ? await getEntitlementPolicyById(identity.entitlementPolicyId, db, lock) : null;
  if (!policy || policy.provider !== identity.provider || policy.dataClass !== identity.dataClass || policy.effectiveFrom > now || (policy.effectiveTo && policy.effectiveTo <= now) || !requiredUses.every(use => policy.permittedUses.includes(use)) || (policy.accessScope === "internal_only" && !ctx.role.startsWith("internal_"))) {
    throw new IntegratedModelArtifactError(403, "The linked source entitlement policy does not currently permit this model operation.");
  }
  return { policy, revision: modelSourceRevision(identity, policy) };
}

/** Existing snapshot/entitlement owners admit metadata before any financial payload is selected.
 * Pass a transaction and lock=true when admission must remain valid through persistence. */
export async function loadIntegratedModelDatasetSource(ctx: TenantContext, snapshotId: string, requiredUses: readonly string[], db: ModelSourceDb = getDb(), lock = false) {
  const { policy, revision } = await admitIntegratedModelDatasetSource(ctx, snapshotId, requiredUses, db, lock);
  const [snapshot] = await db.select().from(datasetSnapshots).where(eq(datasetSnapshots.id, snapshotId)).limit(1);
  if (!snapshot || !canAccessDatasetSnapshot(snapshot, ctx) || modelSourceRevision(snapshot, policy) !== revision) throw new IntegratedModelArtifactError(409, "Financial model source access changed during admission.");
  if (stableSnapshotHash({ payload: snapshot.payload, provider: snapshot.provider, lineage: snapshot.lineage }) !== snapshot.contentHash) throw new IntegratedModelArtifactError(409, "Financial dataset content does not match its immutable revision.");
  const payload = financialDatasetPayloadSchema.safeParse(snapshot.payload);
  if (!payload.success) throw new IntegratedModelArtifactError(409, "Financial dataset content does not match its financial schema.");
  return { snapshot: { ...snapshot, payload: payload.data }, policy, revision };
}

/** Metadata-only release fence; a transactional caller rolls back newly saved runs on denial. */
export async function assertIntegratedModelDatasetSourceCurrent(ctx: TenantContext, snapshotId: string, revision: string, requiredUses: readonly string[], db: ModelSourceDb = getDb()) {
  const current = await admitIntegratedModelDatasetSource(ctx, snapshotId, requiredUses, db, false);
  if (current.revision !== revision) throw new IntegratedModelArtifactError(409, "Financial model source changed during calculation.");
}

/** Metadata-first access guard shared by retention and explicit Artifact input execution. */
export async function loadIntegratedModelArtifactSource(ctx: TenantContext, runId: string, projectId: number | null, modelInput = false, owningChatId?: number | null) {
  z.string().uuid().parse(runId);
  await requireCurrentModelActor(ctx, getDb(), false);
  if (projectId !== null) {
    integratedModelArtifactRequestSchema.parse({ projectId });
    try { await getProject(ctx, projectId); }
    catch (error) { if (error instanceof ProjectAccessDeniedError) throw new IntegratedModelArtifactError(404, error.message); throw error; }
  } else {
    const chatId = z.number().int().positive().parse(owningChatId);
    const [chat] = await getDb().select({ id: projectChats.id }).from(projectChats).where(and(
      eq(projectChats.id, chatId), eq(projectChats.ownerUserId, ctx.userId),
      ctx.organizationId === null ? isNull(projectChats.organizationId) : eq(projectChats.organizationId, ctx.organizationId),
      isNull(projectChats.projectId), eq(projectChats.scope, "quick"), isNull(projectChats.trashedAt),
    )).limit(1);
    if (!chat) throw new IntegratedModelArtifactError(404, "Owned persistent Chat not found.");
  }
  // Metadata first: never read a foreign run's result or inaccessible snapshot payload.
  const [runIdentity] = await getDb().select({ datasetSnapshotId: financialModelRuns.datasetSnapshotId }).from(financialModelRuns).where(and(eq(financialModelRuns.id, runId), eq(financialModelRuns.createdByUserId, ctx.userId))).limit(1);
  if (!runIdentity) throw new IntegratedModelArtifactError(404, "Owned integrated model run not found.");
  const requiredUses = ["display", "derived_output", "export", ...(modelInput ? ["model_input"] : [])];
  const { snapshot, policy, revision } = await loadIntegratedModelDatasetSource(ctx, runIdentity.datasetSnapshotId, requiredUses);
  const [run] = await getDb().select().from(financialModelRuns).where(and(eq(financialModelRuns.id, runId), eq(financialModelRuns.createdByUserId, ctx.userId))).limit(1);
  if (!run || run.datasetSnapshotId !== snapshot.id) throw new IntegratedModelArtifactError(404, "Model source access changed during retention.");
  await assertIntegratedModelDatasetSourceCurrent(ctx, snapshot.id, revision, requiredUses);
  const projection = projectIntegratedModelWorkbook(run, snapshot, policy);
  return { run, snapshot, policy, projection };
}

export async function retainIntegratedModelArtifact(ctx: TenantContext, runId: string, projectId: number | null, lineage?: { requestId: string; sourceRefs: string[] }, owningChatId?: number | null) {
  const { run, projection } = await loadIntegratedModelArtifactSource(ctx, runId, projectId, lineage !== undefined, owningChatId);
  const sourceRefs = [...new Set([...projection.sourceRefs, ...(lineage?.sourceRefs ?? [])])];
  if (sourceRefs.length > 100) throw new IntegratedModelArtifactError(422, "Model projection exceeds the 100 source reference limit.");
  const requestId = lineage ? z.string().uuid().parse(lineage.requestId) : run.id;
  try {
    // P4's existing deterministic keeper arbitrates concurrent retention via the Artifact primary key.
    // runId is an actual persisted identity, not a manufactured execution receipt.
    return await persistConversationDraft(ctx, {
      projectId, owningChatId, requestId,
      draft: { schemaVersion: "1", artifactId: run.id, artifactType: "financial.integrated.spreadsheet", title: `${run.symbol} integrated model · ${run.modelVersion}`, projectId, sourceRefs, executionReceiptIds: [], data: projection.content, persistence: projectId === null ? "chat_candidate" : "project_candidate" },
      dependencyRefs: sourceRefs,
      refreshSpec: { kind: "engine", sourceScope: "my_data", executionMode: "deterministic_first", capabilityIds: [], message: "Immutable projection of a persisted integrated financial model run. Recompute only through an explicit new engine run.", selection: null, engineRef: `integrated_financial_model:${run.modelVersion}:run:${run.id}` },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("retention key already contains different content")) {
      const artifact = await getArtifact(ctx, retainedConversationArtifactId(ctx, projectId, requestId, run.id, owningChatId));
      const version = await getArtifactVersion(ctx, artifact.id, 1);
      const historical = spreadsheetArtifactContentSchema.parse(version.content);
      const withoutLineage = {
        ...projection.content,
        sheets: projection.content.sheets.map(sheet => ({
          ...sheet, cells: Object.fromEntries(Object.entries(sheet.cells).map(([ref, cell]) => [ref, { raw: cell.raw, format: cell.format }])),
        })),
      };
      // A prior exact run projection is immutable: repeat retention returns it, never backfills lineage.
      if (artifact.projectId === projectId && (projectId !== null || artifact.owningChatId === owningChatId)
        && historical.sheets.every(sheet => Object.values(sheet.cells).every(cell => !cell.lineage))
        && stableSnapshotHash(historical) === stableSnapshotHash(withoutLineage)
        && stableSnapshotHash(version.sourceRefs) === stableSnapshotHash(sourceRefs)
        && version.refreshSpec?.engineRef === `integrated_financial_model:${run.modelVersion}:run:${run.id}`) {
        return { artifact, version };
      }
      throw new IntegratedModelArtifactError(409, "This model run retention identity already contains different content.");
    }
    throw error;
  }
}
