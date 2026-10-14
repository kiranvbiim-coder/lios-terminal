import crypto from "crypto";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { datasetSnapshots, quantExperiments, quantRuns, researchInvestigations, type QuantExperiment, type QuantRun } from "@shared/schema";
import { compareQuantOutputs, quantModelWorkspace, type CreateQuantExperiment, type QuantRunRequest } from "@shared/quantLab";
import type { QuantModelRegistryEntry, QuantRunEnvelope } from "@shared/quantModelRegistry";
import { getDb } from "./db";
import { notifyDataChanged } from "./gatewayRuntime";
import { callPythonService, getPythonServiceEnvironment, PythonServiceDataError } from "./pythonService";
import { QUANT_MODEL_REGISTRY } from "./quantModelRegistry";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";

const MAX_CONCURRENCY = Math.max(1, Math.min(Number(process.env.QUANT_LAB_CONCURRENCY) || 2, 8));
const MAX_ACTIVE_PER_USER = 5;
const MAX_DAILY_RUNS_PER_USER = 100;
const MAX_INPUT_BYTES = 1_000_000;
const MAX_OUTPUT_BYTES = 5_000_000;
const queue: string[] = [];
const active = new Map<string, AbortController>();
let initialized = false;

export function executableQuantModels(): QuantModelRegistryEntry[] {
  return QUANT_MODEL_REGISTRY.filter((model) => model.engine === "python_sidecar" && Boolean(model.engineEndpoint) && model.status !== "planned");
}

function resolveModel(modelId: string): QuantModelRegistryEntry {
  const model = QUANT_MODEL_REGISTRY.find((entry) => entry.id === modelId);
  if (!model) throw new Error("Quant model is not registered.");
  if (model.engine !== "python_sidecar" || !model.engineEndpoint || model.status === "planned") {
    throw new Error("This model is catalogued but is not executable through the Quant Lab runtime.");
  }
  return model;
}

async function environmentFor(model: QuantModelRegistryEntry) {
  const python = await getPythonServiceEnvironment();
  return {
    runtime: "limuria-quant-lab",
    runtimeVersion: "1.0.0",
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    engine: model.engine,
    engineEndpoint: model.engineEndpoint,
    python: python.python,
  };
}

async function libraryVersionsFor(model: QuantModelRegistryEntry): Promise<Record<string, string>> {
  const python = await getPythonServiceEnvironment();
  return { registry: "1.0.0", model: model.version, pythonSidecarContract: "1.0.0", ...python.packages };
}

function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

async function snapshotHashes(ids: string[], organizationId: number | null): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const rows = await getDb().select({ id: datasetSnapshots.id, hash: datasetSnapshots.contentHash, organizationId: datasetSnapshots.organizationId })
    .from(datasetSnapshots).where(inArray(datasetSnapshots.id, ids));
  if (rows.length !== new Set(ids).size) throw new Error("One or more dataset snapshots do not exist.");
  for (const row of rows) {
    if (row.organizationId !== null && row.organizationId !== organizationId) {
      throw new Error("A private dataset snapshot must match the experiment organization.");
    }
  }
  return Object.fromEntries(rows.map((row) => [row.id, row.hash]));
}

async function validateInvestigation(investigationId: number | null, organizationId: number | null): Promise<void> {
  if (!investigationId) return;
  const [row] = await getDb().select({ id: researchInvestigations.id, organizationId: researchInvestigations.organizationId })
    .from(researchInvestigations).where(eq(researchInvestigations.id, investigationId)).limit(1);
  if (!row) throw new Error("Investigation not found.");
  if (row.organizationId !== null && row.organizationId !== organizationId) {
    throw new Error("Experiment and investigation organization scopes must match.");
  }
}

export async function createQuantExperiment(input: CreateQuantExperiment, ownerUserId: number) {
  const model = resolveModel(input.modelId);
  if (input.workspace !== quantModelWorkspace(model) && !["dataset", "results", "registry"].includes(input.workspace)) {
    throw new Error(`Model ${model.label} belongs in the ${quantModelWorkspace(model)} workspace.`);
  }
  await validateInvestigation(input.investigationId, input.organizationId);
  await snapshotHashes(input.datasetSnapshotIds, input.organizationId);
  if (byteSize(input.parameters) > MAX_INPUT_BYTES) throw new Error("Experiment parameters exceed the 1 MB input limit.");
  const [created] = await getDb().insert(quantExperiments).values({
    id: crypto.randomUUID(), ...input, modelVersion: model.version, ownerUserId,
  }).returning();
  return created;
}

export async function listQuantExperiments(ownerUserId: number, includeAll = false) {
  const query = getDb().select().from(quantExperiments);
  return includeAll
    ? query.orderBy(desc(quantExperiments.updatedAt)).limit(250)
    : query.where(eq(quantExperiments.ownerUserId, ownerUserId)).orderBy(desc(quantExperiments.updatedAt)).limit(250);
}

export async function getQuantExperiment(id: string, ownerUserId?: number) {
  const filters = [eq(quantExperiments.id, id)];
  if (ownerUserId !== undefined) filters.push(eq(quantExperiments.ownerUserId, ownerUserId));
  const [experiment] = await getDb().select().from(quantExperiments).where(and(...filters)).limit(1);
  return experiment ?? null;
}

export async function editQuantExperiment(id: string, ownerUserId: number, patch: Partial<CreateQuantExperiment> & { status?: "active" | "archived" }) {
  const existing = await getQuantExperiment(id, ownerUserId);
  if (!existing) return null;
  const model = patch.modelId ? resolveModel(patch.modelId) : resolveModel(existing.modelId);
  const workspace = patch.workspace ?? existing.workspace;
  if (workspace !== quantModelWorkspace(model) && !["dataset", "results", "registry"].includes(workspace)) {
    throw new Error(`Model ${model.label} belongs in the ${quantModelWorkspace(model)} workspace.`);
  }
  const organizationId = patch.organizationId === undefined ? existing.organizationId : patch.organizationId;
  const investigationId = patch.investigationId === undefined ? existing.investigationId : patch.investigationId;
  const datasetIds = patch.datasetSnapshotIds ?? existing.datasetSnapshotIds;
  await validateInvestigation(investigationId, organizationId);
  await snapshotHashes(datasetIds, organizationId);
  if (patch.parameters && byteSize(patch.parameters) > MAX_INPUT_BYTES) throw new Error("Experiment parameters exceed the 1 MB input limit.");
  const [updated] = await getDb().update(quantExperiments).set({ ...patch, modelVersion: model.version, updatedAt: new Date() })
    .where(and(eq(quantExperiments.id, id), eq(quantExperiments.ownerUserId, ownerUserId))).returning();
  return updated ?? null;
}

export async function cloneQuantExperiment(id: string, ownerUserId: number) {
  const source = await getQuantExperiment(id, ownerUserId);
  if (!source) return null;
  const [clone] = await getDb().insert(quantExperiments).values({
    id: crypto.randomUUID(), name: `${source.name} (Clone)`, description: source.description,
    workspace: source.workspace, status: "active", modelId: source.modelId, modelVersion: source.modelVersion,
    parameters: source.parameters, datasetSnapshotIds: source.datasetSnapshotIds, seed: source.seed,
    timeoutMs: source.timeoutMs, investigationId: source.investigationId, organizationId: source.organizationId,
    ownerUserId, parentExperimentId: source.id,
  }).returning();
  return clone;
}

async function nextSequence(experimentId: string): Promise<number> {
  const [updated] = await getDb().update(quantExperiments).set({
    nextRunSequence: sql`${quantExperiments.nextRunSequence} + 1`, updatedAt: new Date(),
  }).where(eq(quantExperiments.id, experimentId)).returning();
  if (!updated) throw new Error("Experiment not found.");
  return updated.nextRunSequence - 1;
}

async function enforceQuota(ownerUserId: number): Promise<void> {
  const activeRuns = await getDb().select({ id: quantRuns.id }).from(quantRuns)
    .where(and(eq(quantRuns.ownerUserId, ownerUserId), inArray(quantRuns.status, ["queued", "running"]))).limit(MAX_ACTIVE_PER_USER + 1);
  if (activeRuns.length >= MAX_ACTIVE_PER_USER) throw new Error(`Active-run quota reached (${MAX_ACTIVE_PER_USER}).`);
  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
  const daily = await getDb().select({ id: quantRuns.id }).from(quantRuns)
    .where(and(eq(quantRuns.ownerUserId, ownerUserId), gte(quantRuns.queuedAt, midnight))).limit(MAX_DAILY_RUNS_PER_USER + 1);
  if (daily.length >= MAX_DAILY_RUNS_PER_USER) throw new Error(`Daily-run quota reached (${MAX_DAILY_RUNS_PER_USER}).`);
}

export async function enqueueQuantRun(experimentId: string, ownerUserId: number, request: QuantRunRequest) {
  const experiment = await getQuantExperiment(experimentId, ownerUserId);
  if (!experiment) throw new Error("Experiment not found.");
  if (experiment.status !== "active") throw new Error("Archived experiments cannot run.");
  await enforceQuota(ownerUserId);
  const model = resolveModel(experiment.modelId);
  const parameters = request.parameters ?? experiment.parameters;
  const datasetSnapshotIds = request.datasetSnapshotIds ?? experiment.datasetSnapshotIds;
  const seed = request.seed === undefined ? experiment.seed : request.seed;
  const timeoutMs = request.timeoutMs ?? experiment.timeoutMs;
  if (byteSize(parameters) > MAX_INPUT_BYTES) throw new Error("Run parameters exceed the 1 MB input limit.");
  const hashes = await snapshotHashes(datasetSnapshotIds, experiment.organizationId);
  if (model.determinism === "seeded_stochastic" && (seed === null || seed === undefined)) {
    throw new Error("Seeded stochastic models require an explicit seed.");
  }
  const normalizedParameters = model.determinism === "seeded_stochastic" ? { ...parameters, seed } : parameters;
  const environment = await environmentFor(model); const libraryVersions = await libraryVersionsFor(model);
  const environmentHash = stableSnapshotHash({ environment, libraryVersions });
  const inputHash = stableSnapshotHash({ modelId: model.id, modelVersion: model.version, parameters: normalizedParameters, datasetSnapshotHashes: hashes, seed });
  const cacheKey = stableSnapshotHash({ ownerUserId, inputHash, environmentHash });
  const sequence = await nextSequence(experiment.id);
  if (!request.bypassCache) {
    const [cached] = await getDb().select().from(quantRuns).where(and(
      eq(quantRuns.ownerUserId, ownerUserId), eq(quantRuns.cacheKey, cacheKey), eq(quantRuns.status, "succeeded"),
    )).orderBy(desc(quantRuns.completedAt)).limit(1);
    if (cached) {
      const now = new Date();
      const [created] = await getDb().insert(quantRuns).values({
        id: crypto.randomUUID(), experimentId: experiment.id, sequence, status: "succeeded", progressPct: 100,
        modelId: model.id, modelVersion: model.version, engine: model.engine, engineEndpoint: model.engineEndpoint!,
        parameters: normalizedParameters, datasetSnapshotIds, datasetSnapshotHashes: hashes, seed, timeoutMs,
        inputHash, cacheKey, cachedFromRunId: cached.id, environment, environmentHash, libraryVersions,
        output: cached.output, outputHash: cached.outputHash, diagnostics: { ...(cached.diagnostics ?? {}), cacheHit: true },
        warnings: cached.warnings, ownerUserId, startedAt: now, completedAt: now, durationMs: 0,
      }).returning();
      return created;
    }
  }
  const [created] = await getDb().insert(quantRuns).values({
    id: crypto.randomUUID(), experimentId: experiment.id, sequence, status: "queued", progressPct: 0,
    modelId: model.id, modelVersion: model.version, engine: model.engine, engineEndpoint: model.engineEndpoint!,
    parameters: normalizedParameters, datasetSnapshotIds, datasetSnapshotHashes: hashes, seed, timeoutMs,
    inputHash, cacheKey, environment, environmentHash, libraryVersions, warnings: model.limitations, ownerUserId,
  }).returning();
  queue.push(created.id); pump();
  return created;
}

async function executeRun(id: string): Promise<void> {
  const db = getDb();
  const [run] = await db.select().from(quantRuns).where(eq(quantRuns.id, id)).limit(1);
  if (!run || run.status !== "queued") return;
  const controller = new AbortController(); active.set(id, controller); const startedAt = new Date();
  await db.update(quantRuns).set({ status: "running", progressPct: 10, startedAt }).where(and(eq(quantRuns.id, id), eq(quantRuns.status, "queued")));
  notifyDataChanged("quantlab", { userId: run.ownerUserId });
  try {
    const output = await callPythonService<unknown>(run.engineEndpoint, run.parameters, { signal: controller.signal, timeoutMs: run.timeoutMs });
    const outputBytes = byteSize(output);
    if (outputBytes > MAX_OUTPUT_BYTES) throw new Error("Model output exceeded the 5 MB persistence limit.");
    const completedAt = new Date();
    await db.update(quantRuns).set({
      status: "succeeded", progressPct: 100, output, outputHash: stableSnapshotHash(output), completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(), diagnostics: {
        cacheHit: false, inputBytes: byteSize(run.parameters), outputBytes,
        queueWaitMs: startedAt.getTime() - run.queuedAt.getTime(), executionMs: completedAt.getTime() - startedAt.getTime(),
      },
    }).where(eq(quantRuns.id, id));
    notifyDataChanged("quantlab", { userId: run.ownerUserId });
  } catch (error) {
    const completedAt = new Date(); const reasonName = controller.signal.reason?.name;
    const status = reasonName === "TimeoutError" || (error instanceof Error && error.name === "TimeoutError") ? "timed_out" : controller.signal.aborted ? "cancelled" : "failed";
    const message = error instanceof PythonServiceDataError ? error.detail : error instanceof Error ? error.message : "Quant computation failed.";
    await db.update(quantRuns).set({ status, progressPct: 100, error: message.slice(0, 4000), completedAt, durationMs: completedAt.getTime() - startedAt.getTime() })
      .where(eq(quantRuns.id, id));
    notifyDataChanged("quantlab", { userId: run.ownerUserId });
  } finally {
    active.delete(id); pump();
  }
}

function pump(): void {
  while (active.size < MAX_CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    void executeRun(id);
  }
}

export async function initializeQuantLabRuntime(): Promise<void> {
  if (initialized) return; initialized = true;
  const db = getDb(); const now = new Date();
  await db.update(quantRuns).set({ status: "failed", progressPct: 100, error: "Runtime restarted while this job was executing.", completedAt: now })
    .where(eq(quantRuns.status, "running"));
  const queued = await db.select({ id: quantRuns.id }).from(quantRuns).where(eq(quantRuns.status, "queued")).orderBy(quantRuns.queuedAt);
  queue.push(...queued.map((row) => row.id)); pump();
}

export async function cancelQuantRun(id: string, ownerUserId: number) {
  const [run] = await getDb().select().from(quantRuns).where(and(eq(quantRuns.id, id), eq(quantRuns.ownerUserId, ownerUserId))).limit(1);
  if (!run) return null;
  if (run.status === "queued") {
    const index = queue.indexOf(id); if (index >= 0) queue.splice(index, 1);
    const now = new Date();
    const [updated] = await getDb().update(quantRuns).set({ status: "cancelled", progressPct: 100, completedAt: now, error: "Cancelled before execution." })
      .where(and(eq(quantRuns.id, id), eq(quantRuns.status, "queued"))).returning();
    notifyDataChanged("quantlab", { userId: run.ownerUserId });
    return updated ?? run;
  }
  if (run.status === "running") active.get(id)?.abort(new DOMException("Cancelled by user.", "AbortError"));
  return run;
}

export async function listQuantRuns(ownerUserId: number, experimentId?: string, includeAll = false) {
  const filters = [];
  if (!includeAll) filters.push(eq(quantRuns.ownerUserId, ownerUserId));
  if (experimentId) filters.push(eq(quantRuns.experimentId, experimentId));
  const query = getDb().select().from(quantRuns);
  return filters.length ? query.where(and(...filters)).orderBy(desc(quantRuns.queuedAt)).limit(250) : query.orderBy(desc(quantRuns.queuedAt)).limit(250);
}

export async function listQuantDatasetCatalog(organizationId: number | null, limit = 250) {
  const scope = organizationId === null ? isNull(datasetSnapshots.organizationId) : or(isNull(datasetSnapshots.organizationId), eq(datasetSnapshots.organizationId, organizationId));
  return getDb().select({
    id: datasetSnapshots.id, entityKey: datasetSnapshots.entityKey, dataClass: datasetSnapshots.dataClass,
    provider: datasetSnapshots.provider, contentHash: datasetSnapshots.contentHash, availableAt: datasetSnapshots.availableAt,
    quality: datasetSnapshots.quality, organizationId: datasetSnapshots.organizationId,
  }).from(datasetSnapshots).where(scope).orderBy(desc(datasetSnapshots.availableAt)).limit(Math.min(Math.max(limit, 1), 500));
}

export async function getQuantRun(id: string, ownerUserId?: number) {
  const filters = [eq(quantRuns.id, id)]; if (ownerUserId !== undefined) filters.push(eq(quantRuns.ownerUserId, ownerUserId));
  const [run] = await getDb().select().from(quantRuns).where(and(...filters)).limit(1); return run ?? null;
}

export async function rerunQuantRun(id: string, ownerUserId: number, bypassCache = true) {
  const run = await getQuantRun(id, ownerUserId); if (!run) throw new Error("Run not found.");
  return enqueueQuantRun(run.experimentId, ownerUserId, { parameters: run.parameters, datasetSnapshotIds: run.datasetSnapshotIds, seed: run.seed, timeoutMs: run.timeoutMs, bypassCache });
}

export async function compareQuantRuns(leftId: string, rightId: string, ownerUserId: number) {
  const [left, right] = await Promise.all([getQuantRun(leftId, ownerUserId), getQuantRun(rightId, ownerUserId)]);
  if (!left || !right) throw new Error("Both runs must exist and belong to the current user.");
  return { left: summarizeRun(left), right: summarizeRun(right), comparison: compareQuantOutputs(left.output, right.output) };
}

function summarizeRun(run: QuantRun) {
  return { id: run.id, experimentId: run.experimentId, modelId: run.modelId, modelVersion: run.modelVersion, status: run.status, inputHash: run.inputHash, outputHash: run.outputHash, seed: run.seed, completedAt: run.completedAt };
}

export function quantRunEnvelope(run: QuantRun): QuantRunEnvelope | null {
  if (run.status !== "succeeded" || !run.outputHash) return null;
  return {
    modelId: run.modelId, modelVersion: run.modelVersion, runId: run.id, inputSnapshotHash: run.inputHash,
    outputSnapshotHash: run.outputHash, datasetSnapshotIds: run.datasetSnapshotIds, effectiveAt: null,
    calculatedAt: (run.completedAt ?? run.queuedAt).toISOString(), seed: run.seed, parameters: run.parameters,
    diagnostics: { ...run.diagnostics, environment: run.environment, environmentHash: run.environmentHash, libraryVersions: run.libraryVersions },
    warnings: run.warnings, result: run.output,
  };
}

export function runtimeStatus() {
  return { version: "1.0.0", concurrency: MAX_CONCURRENCY, active: active.size, queued: queue.length, limits: { activePerUser: MAX_ACTIVE_PER_USER, dailyRunsPerUser: MAX_DAILY_RUNS_PER_USER, inputBytes: MAX_INPUT_BYTES, outputBytes: MAX_OUTPUT_BYTES, timeoutMs: 120_000 }, executableModels: executableQuantModels().length };
}
