import type { Express } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  brainApprovals,
  brainRuns,
  brainTasks,
  brainToolCalls,
  consensusAlertRules,
  consensusBenchmarks,
  consensusSnapshots,
  researchInvestigations,
  type BrainRun,
  type BrainTask,
} from "@shared/schema";
import { requireRole } from "./auth";
import { rejectIfMasterAiOff } from "./masterAiGate";
import { getDb } from "./db";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { unifiedResearchSearch } from "./researchSearch";
import { searchOfficialData } from "./researchOfficialCatalog";
import { getQuotes } from "./marketData";
import { buildConsensusSignals, buildRevisionSeries, compareConsensusBenchmarks, revisionAcceleration } from "./consensusService";
import {
  attachBrainLinkedContextToPlan,
  normalizeBrainLinkedContext,
  sanitizeBrainTaskInput,
} from "./brainLinkedContext";
import {
  BRAIN_TOOL_REGISTRY,
  brainApprovalSnapshotHash,
  buildBrainPlan,
  canInvokeBrainTool,
  extractOfficialCatalogQueries,
  findDownstreamTaskKeys,
  parseBrainIntent,
  shouldExecuteBrainTask,
  stableBrainHash,
  validateToolResult,
  type BrainAgentRole,
} from "./brainService";

const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;
const AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;
const createRunSchema = z.object({
  question: z.string().trim().min(10).max(4000),
  title: z.string().trim().min(3).max(200).optional(),
  primaryEntity: z.string().trim().max(40).nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  investigationId: z.number().int().positive().nullable().optional(),
  linkedContext: z.unknown().optional(),
});
const editTaskSchema = z.object({
  label: z.string().trim().min(3).max(200).optional(),
  completionCriteria: z.string().trim().min(3).max(1000).optional(),
  input: z.record(z.unknown()).optional(),
}).refine((value) => Object.keys(value).length > 0, "Provide at least one edit.");
const approvalSchema = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(2000).nullable().optional() });

type ToolExecution = {
  status: "completed" | "incomplete" | "failed";
  output: Record<string, unknown>;
  provenance: Array<Record<string, unknown>>;
  deterministicRefs: string[];
  provider?: string;
  modelId?: string;
  error?: string;
};

function organizationCondition(column: typeof brainRuns.organizationId | typeof consensusSnapshots.organizationId | typeof consensusBenchmarks.organizationId, organizationId: number | null) {
  return organizationId ? eq(column, organizationId) : isNull(column);
}

async function getOwnedRun(id: number, userId: number) {
  const db = getDb();
  const [run] = await db.select().from(brainRuns).where(and(eq(brainRuns.id, id), eq(brainRuns.ownerUserId, userId))).limit(1);
  return run;
}

async function getRunDetail(run: BrainRun) {
  const db = getDb();
  const [tasks, toolCalls, approvals] = await Promise.all([
    db.select().from(brainTasks).where(eq(brainTasks.runId, run.id)).orderBy(asc(brainTasks.id)),
    db.select().from(brainToolCalls).where(eq(brainToolCalls.runId, run.id)).orderBy(asc(brainToolCalls.id)),
    db.select().from(brainApprovals).where(eq(brainApprovals.runId, run.id)).orderBy(asc(brainApprovals.id)),
  ]);
  return { ...run, tasks, toolCalls, approvals };
}

function downstreamTasks(tasks: BrainTask[], taskKey: string): BrainTask[] {
  const keys = new Set(findDownstreamTaskKeys(tasks, taskKey));
  return tasks.filter((task) => keys.has(task.taskKey));
}

function compactResearchResult(item: Awaited<ReturnType<typeof unifiedResearchSearch>>["results"][number]) {
  return { resultId: item.resultId, title: item.title, excerpt: item.excerpt, evidenceType: item.evidenceType, evidenceKind: item.evidenceKind, sourceName: item.sourceName, provider: item.provider, sourceUrl: item.sourceUrl, sourceExternalId: item.sourceExternalId, publishedAt: item.publishedAt, effectiveAt: item.effectiveAt, retrievedAt: item.retrievedAt, sourceQuality: item.sourceQuality, relevanceScore: item.relevanceScore };
}

async function executeTool(run: BrainRun, task: BrainTask, allTasks: BrainTask[]): Promise<ToolExecution> {
  if (!task.toolId) return { status: "failed", output: {}, provenance: [], deterministicRefs: [], error: "Tool implementation unavailable." };
  if (task.toolId === "research.search") {
    const query = String(task.input.query ?? run.question);
    const entity = typeof task.input.entity === "string" ? task.input.entity : undefined;
    const response = await unifiedResearchSearch({ query, filters: { entity, sourceClasses: run.decisionType === "policy" ? ["news", "official_data", "published_content", "private_data"] : undefined }, organizationId: run.organizationId, limit: 8 });
    const results = response.results.slice(0, 20).map(compactResearchResult);
    return { status: results.length ? "completed" : "incomplete", output: { results, sources: response.sources, resultCount: results.length }, provenance: results.map((item) => ({ provider: item.provider, sourceName: item.sourceName, sourceUrl: item.sourceUrl, publishedAt: item.publishedAt, retrievedAt: item.retrievedAt, resultId: item.resultId })), deterministicRefs: [`research-search:${stableBrainHash({ query, entity, sources: response.sources, resultIds: results.map((item) => item.resultId) })}`], provider: "Limuria Unified Research" };
  }
  if (task.toolId === "market.quote") {
    const symbol = typeof task.input.symbol === "string" ? task.input.symbol : null;
    if (!symbol) return { status: "incomplete", output: { reason: "No market symbol was identified." }, provenance: [], deterministicRefs: [`market-quote:unavailable:${run.id}`] };
    const [quote] = await getQuotes([symbol]);
    if (!quote) return { status: "incomplete", output: { reason: "Quote provider returned no result.", symbol }, provenance: [], deterministicRefs: [`market-quote:unavailable:${symbol}`] };
    const output = { symbol: quote.symbol, name: quote.name, price: quote.price, change: quote.change, changePercent: quote.changePercent, currency: quote.currency, exchange: quote.exchange, status: quote.status };
    return { status: "completed", output, provenance: [{ provider: quote.status.provider, asOf: quote.status.asOf, freshness: quote.status.freshness, delayLabel: quote.status.delayLabel, symbol: quote.symbol }], deterministicRefs: [`market-quote:${quote.symbol}:${quote.status.asOf ?? "undated"}`], provider: quote.status.provider };
  }
  if (task.toolId === "official.catalog") {
    const query = String(task.input.query ?? run.question);
    const catalogQueries = extractOfficialCatalogQueries(query);
    const seen = new Set<string>();
    const results = catalogQueries.flatMap((catalogQuery) => searchOfficialData({ query: catalogQuery, filters: {}, limit: 20 }))
      .filter((item) => !seen.has(item.resultId) && Boolean(seen.add(item.resultId)))
      .slice(0, 20)
      .map(compactResearchResult);
    return { status: results.length ? "completed" : "incomplete", output: { results, resultCount: results.length, catalogQueries, dataState: "catalog_metadata_only" }, provenance: results.map((item) => ({ provider: item.provider, sourceName: item.sourceName, sourceUrl: item.sourceUrl, resultId: item.resultId, retrievedAt: item.retrievedAt })), deterministicRefs: [`official-catalog:${stableBrainHash({ query, catalogQueries, resultIds: results.map((item) => item.resultId) })}`], provider: "FRED / World Bank catalogs" };
  }
  if (task.toolId === "consensus.analysis") {
    const symbol = typeof task.input.symbol === "string" ? task.input.symbol : null;
    if (!symbol) return { status: "incomplete", output: { coverage: { state: "unavailable", reason: "No symbol was identified." } }, provenance: [], deterministicRefs: [`consensus:unavailable:${run.id}`] };
    const db = getDb();
    const [snapshots, benchmarks, rules] = await Promise.all([
      db.select().from(consensusSnapshots).where(and(eq(consensusSnapshots.symbol, symbol), organizationCondition(consensusSnapshots.organizationId, run.organizationId))).orderBy(asc(consensusSnapshots.estimateAsOf)),
      db.select().from(consensusBenchmarks).where(and(eq(consensusBenchmarks.symbol, symbol), organizationCondition(consensusBenchmarks.organizationId, run.organizationId))).orderBy(asc(consensusBenchmarks.effectiveAt)),
      db.select().from(consensusAlertRules).where(and(eq(consensusAlertRules.ownerUserId, run.ownerUserId), eq(consensusAlertRules.symbol, symbol), run.organizationId ? eq(consensusAlertRules.organizationId, run.organizationId) : isNull(consensusAlertRules.organizationId), eq(consensusAlertRules.enabled, true))),
    ]);
    const grouped = new Map<string, typeof snapshots>();
    for (const snapshot of snapshots) { const key = `${snapshot.metric}:${snapshot.fiscalPeriod}`; grouped.set(key, [...(grouped.get(key) ?? []), snapshot]); }
    const series = Array.from(grouped.entries()).map(([key, items]) => {
      const matching = benchmarks.filter((item) => `${item.metric}:${item.fiscalPeriod}` === key);
      const revisions = buildRevisionSeries(items);
      const rule = rules.find((item) => item.metric === items[0].metric) ?? rules.find((item) => item.metric == null);
      const thresholds = rule ? { revisionPct: rule.revisionThresholdPct, dispersionPct: rule.dispersionThresholdPct, divergencePct: rule.divergenceThresholdPct } : undefined;
      return { key, metric: items[0].metric, fiscalPeriod: items[0].fiscalPeriod, latest: items.at(-1), revisions, revisionAccelerationPct: revisionAcceleration(revisions), comparisons: compareConsensusBenchmarks(items, matching), signals: buildConsensusSignals(items, matching, thresholds) };
    });
    const refs = snapshots.map((item) => `consensus-snapshot:${item.id}:${item.snapshotHash}`);
    return { status: snapshots.length ? "completed" : "incomplete", output: { symbol, coverage: snapshots.length ? { state: "available", snapshotCount: snapshots.length, seriesCount: series.length } : { state: "unavailable", reason: "No licensed or user-supplied consensus exists for this scope." }, series }, provenance: snapshots.map((item) => ({ provider: item.provider, sourceName: item.sourceName, sourceUrl: item.sourceUrl, estimateAsOf: item.estimateAsOf, snapshotHash: item.snapshotHash })), deterministicRefs: refs.length ? refs : [`consensus:unavailable:${symbol}:${run.organizationId ?? "global"}`], provider: "Limuria Consensus" };
  }
  const prior = allTasks.filter((item) => item.id !== task.id && ["completed", "incomplete", "failed"].includes(item.status));
  if (task.toolId === "evidence.challenge") {
    const gaps = prior.filter((item) => item.status !== "completed" || (!item.provenance.length && !item.deterministicRefs.length)).map((item) => ({ taskKey: item.taskKey, status: item.status, reason: item.error ?? (item.status === "incomplete" ? "Evidence is unavailable or partial." : "No source or deterministic reference was recorded.") }));
    return { status: "completed", output: { gaps, challengedTaskCount: prior.length, gapCount: gaps.length }, provenance: [], deterministicRefs: [`brain-challenge:${stableBrainHash(prior.map((item) => ({ key: item.taskKey, status: item.status, refs: item.deterministicRefs })))}`], provider: "Limuria deterministic challenge" };
  }
  if (task.toolId === "provenance.verify") {
    const missing = prior.filter((item) => item.toolId && !item.provenance.length && !item.deterministicRefs.length).map((item) => item.taskKey);
    const incomplete = prior.filter((item) => item.status !== "completed").map((item) => item.taskKey);
    return { status: missing.length ? "incomplete" : "completed", output: { passed: missing.length === 0, missingReferences: missing, incompleteTasks: incomplete, checkedTaskCount: prior.length }, provenance: [], deterministicRefs: [`brain-verification:${stableBrainHash({ missing, incomplete, tasks: prior.map((item) => item.id) })}`], provider: "Limuria provenance verifier" };
  }
  if (task.toolId === "synthesis.assemble") {
    const evidenceTasks = prior.filter((item) => !["approval", "synthesis"].includes(item.taskKey));
    const incomplete = evidenceTasks.filter((item) => item.status !== "completed");
    const lines = [
      `# ${run.title}`,
      `**Question:** ${run.question}`,
      `**Decision type:** ${run.decisionType}`,
      "## Execution record",
      ...evidenceTasks.map((item) => `- ${item.label}: ${item.status}; ${item.provenance.length} source reference(s); ${item.deterministicRefs.length} deterministic reference(s).`),
      "## Evidence boundary",
      incomplete.length ? `Incomplete components: ${incomplete.map((item) => item.label).join(", ")}. These remain explicit gaps.` : "All planned evidence components completed.",
      "## Decision state",
      "The evidence package passed its human review boundary. This synthesis assembles recorded outputs only and does not introduce unsupported calculations or figures.",
    ];
    return { status: incomplete.length ? "incomplete" : "completed", output: { markdown: lines.join("\n\n"), incompleteTaskKeys: incomplete.map((item) => item.taskKey), evidenceTaskCount: evidenceTasks.length }, provenance: evidenceTasks.flatMap((item) => item.provenance), deterministicRefs: [`brain-synthesis:${stableBrainHash({ runId: run.id, tasks: evidenceTasks.map((item) => ({ id: item.id, status: item.status, refs: item.deterministicRefs })) })}`], provider: "Limuria deterministic assembler", modelId: "brain-assembler-v1" };
  }
  return { status: "failed", output: {}, provenance: [], deterministicRefs: [], error: "Tool implementation unavailable." };
}

async function executeRun(run: BrainRun, user: Express.User) {
  const db = getDb();
  let tasks = await db.select().from(brainTasks).where(eq(brainTasks.runId, run.id)).orderBy(asc(brainTasks.id));
  for (const task of tasks) {
    const [runState] = await db.select({ status: brainRuns.status }).from(brainRuns).where(eq(brainRuns.id, run.id)).limit(1);
    if (runState?.status === "paused") return getRunDetail((await getOwnedRun(run.id, user.id))!);
    if (!shouldExecuteBrainTask(task.status)) continue;
    const byKey = new Map(tasks.map((item) => [item.taskKey, item]));
    const dependencies = task.dependencies.map((key) => byKey.get(key));
    if (dependencies.some((item) => !item || !["completed", "incomplete"].includes(item.status))) {
      await db.update(brainTasks).set({ status: "blocked", error: "A required dependency did not reach a reviewable state.", updatedAt: new Date() }).where(eq(brainTasks.id, task.id));
      continue;
    }
    if (task.agentRole === "human") {
      const snapshotHash = brainApprovalSnapshotHash(tasks, task.id);
      await db.update(brainTasks).set({ status: "awaiting_approval", startedAt: new Date(), updatedAt: new Date() }).where(eq(brainTasks.id, task.id));
      const [existing] = await db.select({ id: brainApprovals.id }).from(brainApprovals).where(and(eq(brainApprovals.taskId, task.id), eq(brainApprovals.snapshotHash, snapshotHash))).limit(1);
      if (!existing) await db.insert(brainApprovals).values({ runId: run.id, taskId: task.id, requestedByUserId: user.id, snapshotHash });
      await db.update(brainRuns).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(brainRuns.id, run.id));
      await recordAuditEvent(user.id, "brain_approval_requested", { runId: run.id, taskId: task.id, snapshotHash, ...auditActor(user) });
      return getRunDetail((await getOwnedRun(run.id, user.id))!);
    }
    if (!task.toolId || !canInvokeBrainTool(task.toolId, task.agentRole as BrainAgentRole, user.role)) {
      await db.update(brainTasks).set({ status: "failed", error: "The assigned agent or user role is not granted this tool.", attemptCount: task.attemptCount + 1, completedAt: new Date(), updatedAt: new Date() }).where(eq(brainTasks.id, task.id));
      tasks = await db.select().from(brainTasks).where(eq(brainTasks.runId, run.id)).orderBy(asc(brainTasks.id));
      continue;
    }
    const started = Date.now();
    await db.update(brainTasks).set({ status: "running", startedAt: new Date(), attemptCount: task.attemptCount + 1, error: null, updatedAt: new Date() }).where(eq(brainTasks.id, task.id));
    let result: ToolExecution;
    try { result = await executeTool(run, task, tasks); }
    catch (error) { result = { status: "incomplete", output: { reason: "Tool execution failed explicitly." }, provenance: [], deterministicRefs: [`tool-failure:${task.toolId}:${run.id}:${task.id}`], error: error instanceof Error ? error.message : "Unknown tool failure" }; }
    const validation = validateToolResult(result);
    if (validation.length && result.status === "completed") result = { ...result, status: "incomplete", error: validation.join(", ") };
    const completedAt = new Date();
    await db.update(brainTasks).set({ status: result.status, output: result.output, provenance: result.provenance, deterministicRefs: result.deterministicRefs, error: result.error ?? null, completedAt, updatedAt: completedAt }).where(eq(brainTasks.id, task.id));
    await db.insert(brainToolCalls).values({ runId: run.id, taskId: task.id, toolId: task.toolId, agentRole: task.agentRole, status: result.status, input: task.input, output: result.output, provenance: result.provenance, deterministicRefs: result.deterministicRefs, provider: result.provider ?? null, modelId: result.modelId ?? null, error: result.error ?? null, latencyMs: Date.now() - started, completedAt });
    if (task.taskKey === "synthesis") await db.update(brainRuns).set({ synthesis: String(result.output.markdown ?? ""), status: result.status === "completed" ? "completed" : "incomplete", completionSummary: { incompleteTaskKeys: result.output.incompleteTaskKeys ?? [], synthesisRef: result.deterministicRefs[0] }, completedAt, updatedAt: completedAt }).where(eq(brainRuns.id, run.id));
    tasks = await db.select().from(brainTasks).where(eq(brainTasks.runId, run.id)).orderBy(asc(brainTasks.id));
  }
  const refreshed = (await getOwnedRun(run.id, user.id))!;
  if (refreshed.status === "running") await db.update(brainRuns).set({ status: tasks.some((item) => item.status === "failed" || item.status === "blocked") ? "failed" : "incomplete", updatedAt: new Date() }).where(eq(brainRuns.id, run.id));
  return getRunDetail((await getOwnedRun(run.id, user.id))!);
}

export function registerBrainRoutes(app: Express): void {
  app.get("/api/brain/tools", requireRole(...READ_ROLES), (_req, res) => res.json({ tools: BRAIN_TOOL_REGISTRY, providerRouting: { mode: "provider_neutral", aiProviderRequired: false, unsupportedNumbersAllowed: false } }));

  app.get("/api/brain/runs", requireRole(...READ_ROLES), async (req, res) => {
    const db = getDb();
    res.json(await db.select().from(brainRuns).where(eq(brainRuns.ownerUserId, req.user!.id)).orderBy(desc(brainRuns.updatedAt)).limit(100));
  });

  app.get("/api/brain/runs/:id", requireRole(...READ_ROLES), async (req, res) => {
    const run = await getOwnedRun(Number(req.params.id), req.user!.id);
    if (!run) return res.status(404).json({ error: "Brain run not found." });
    res.json(await getRunDetail(run));
  });

  app.post("/api/brain/runs", requireRole(...AUTHOR_ROLES), async (req, res) => {
    if (await rejectIfMasterAiOff(req, res)) return;
    const parsed = createRunSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const db = getDb();
    if (parsed.data.investigationId) {
      const [investigation] = await db.select({ organizationId: researchInvestigations.organizationId }).from(researchInvestigations).where(eq(researchInvestigations.id, parsed.data.investigationId)).limit(1);
      if (!investigation) return res.status(400).json({ error: "Investigation not found." });
      if ((investigation.organizationId ?? null) !== (parsed.data.organizationId ?? null)) return res.status(400).json({ error: "Investigation and Brain organization scopes must match." });
    }
    const linkedContext = normalizeBrainLinkedContext(parsed.data.linkedContext);
    const primaryEntity = parsed.data.primaryEntity || linkedContext?.instrument || null;
    const intent = parseBrainIntent(parsed.data.question, primaryEntity);
    const title = parsed.data.title ?? parsed.data.question.slice(0, 120);
    const [run] = await db.insert(brainRuns).values({ title, question: parsed.data.question, decisionType: intent.decisionType, organizationId: parsed.data.organizationId ?? null, investigationId: parsed.data.investigationId ?? null, ownerUserId: req.user!.id, intent: { ...intent }, requiredOutputs: intent.requiredOutputs, policies: { providerNeutral: true, requireProvenance: true, humanApprovalRequired: true, unsupportedNumbersAllowed: false } }).returning();
    const plan = attachBrainLinkedContextToPlan(buildBrainPlan(parsed.data.question, intent, parsed.data.organizationId), linkedContext);
    await db.insert(brainTasks).values(plan.map((task) => ({ runId: run.id, taskKey: task.key, label: task.label, agentRole: task.agentRole, toolId: task.toolId, dependencies: task.dependencies, expectedEvidence: task.expectedEvidence, completionCriteria: task.completionCriteria, input: task.input })));
    await recordAuditEvent(req.user!.id, "brain_run_created", { runId: run.id, decisionType: run.decisionType, taskCount: plan.length, organizationId: run.organizationId, linkedContextApplied: Boolean(linkedContext), ...auditActor(req.user!) });
    res.status(201).json(await getRunDetail(run));
  });

  app.patch("/api/brain/runs/:runId/tasks/:taskId", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = editTaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const run = await getOwnedRun(Number(req.params.runId), req.user!.id);
    if (!run) return res.status(404).json({ error: "Brain run not found." });
    const db = getDb();
    const [task] = await db.select().from(brainTasks).where(and(eq(brainTasks.id, Number(req.params.taskId)), eq(brainTasks.runId, run.id))).limit(1);
    if (!task) return res.status(404).json({ error: "Task not found." });
    if (!["pending", "incomplete", "failed", "blocked"].includes(task.status)) return res.status(409).json({ error: "Only pending or explicitly incomplete tasks can be edited." });
    const safeEdit = parsed.data.input
      ? { ...parsed.data, input: sanitizeBrainTaskInput(parsed.data.input, task.input) }
      : parsed.data;
    const allTasks = await db.select().from(brainTasks).where(eq(brainTasks.runId, run.id));
    const downstream = downstreamTasks(allTasks, task.taskKey);
    const downstreamIds = downstream.map((item) => item.id);
    if (downstreamIds.length) await db.delete(brainApprovals).where(and(inArray(brainApprovals.taskId, downstreamIds), eq(brainApprovals.status, "pending")));
    for (const item of downstream) {
      await db.update(brainTasks).set({ ...(item.id === task.id ? safeEdit : {}), status: "pending", output: null, provenance: [], deterministicRefs: [], error: null, startedAt: null, completedAt: null, updatedAt: new Date() }).where(eq(brainTasks.id, item.id));
    }
    await db.update(brainRuns).set({ status: "planned", synthesis: null, completedAt: null, updatedAt: new Date() }).where(eq(brainRuns.id, run.id));
    await recordAuditEvent(req.user!.id, "brain_task_edited", { runId: run.id, taskId: task.id, fields: Object.keys(safeEdit), ...auditActor(req.user!) });
    res.json(await getRunDetail((await getOwnedRun(run.id, req.user!.id))!));
  });

  app.post("/api/brain/runs/:id/execute", requireRole(...AUTHOR_ROLES), async (req, res) => {
    if (await rejectIfMasterAiOff(req, res)) return;
    const run = await getOwnedRun(Number(req.params.id), req.user!.id);
    if (!run) return res.status(404).json({ error: "Brain run not found." });
    if (["completed", "rejected"].includes(run.status)) return res.status(409).json({ error: `Run is already ${run.status}.` });
    if (run.status === "paused") return res.status(409).json({ error: "Resume this run before executing it." });
    if (run.status === "awaiting_approval") return res.status(409).json({ error: "Human approval is required before execution can resume." });
    const db = getDb();
    const [claimed] = await db.update(brainRuns).set({ status: "running", updatedAt: new Date() }).where(and(
      eq(brainRuns.id, run.id),
      eq(brainRuns.ownerUserId, req.user!.id),
      eq(brainRuns.status, "planned"),
    )).returning();
    if (!claimed) return res.status(409).json({ error: "Run is not ready or another execution already claimed it." });
    const detail = await executeRun(claimed, req.user!);
    await recordAuditEvent(req.user!.id, "brain_run_executed", { runId: run.id, status: detail.status, ...auditActor(req.user!) });
    res.json(detail);
  });

  app.post("/api/brain/runs/:id/pause", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const run = await getOwnedRun(Number(req.params.id), req.user!.id);
    if (!run) return res.status(404).json({ error: "Brain run not found." });
    if (["completed", "rejected"].includes(run.status)) return res.status(409).json({ error: "Terminal runs cannot be paused." });
    const db = getDb();
    const [paused] = await db.update(brainRuns).set({ status: "paused", updatedAt: new Date() }).where(eq(brainRuns.id, run.id)).returning();
    await recordAuditEvent(req.user!.id, "brain_run_paused", { runId: run.id, ...auditActor(req.user!) });
    res.json(await getRunDetail(paused));
  });

  app.post("/api/brain/runs/:id/resume", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const run = await getOwnedRun(Number(req.params.id), req.user!.id);
    if (!run) return res.status(404).json({ error: "Brain run not found." });
    if (run.status !== "paused") return res.status(409).json({ error: "Only paused runs can be resumed." });
    const db = getDb();
    const [resumed] = await db.update(brainRuns).set({ status: "planned", updatedAt: new Date() }).where(eq(brainRuns.id, run.id)).returning();
    await recordAuditEvent(req.user!.id, "brain_run_resumed", { runId: run.id, ...auditActor(req.user!) });
    res.json(await getRunDetail(resumed));
  });

  app.post("/api/brain/runs/:runId/tasks/:taskId/retry", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const run = await getOwnedRun(Number(req.params.runId), req.user!.id);
    if (!run) return res.status(404).json({ error: "Brain run not found." });
    const db = getDb();
    const [task] = await db.select().from(brainTasks).where(and(eq(brainTasks.id, Number(req.params.taskId)), eq(brainTasks.runId, run.id))).limit(1);
    if (!task || !["incomplete", "failed", "blocked"].includes(task.status)) return res.status(409).json({ error: "Only incomplete, failed, or blocked tasks can be retried." });
    const allTasks = await db.select().from(brainTasks).where(eq(brainTasks.runId, run.id));
    const downstream = downstreamTasks(allTasks, task.taskKey);
    const downstreamIds = downstream.map((item) => item.id);
    if (downstreamIds.length) await db.delete(brainApprovals).where(and(inArray(brainApprovals.taskId, downstreamIds), eq(brainApprovals.status, "pending")));
    for (const item of downstream) await db.update(brainTasks).set({ status: "pending", output: null, provenance: [], deterministicRefs: [], error: null, startedAt: null, completedAt: null, updatedAt: new Date() }).where(eq(brainTasks.id, item.id));
    await db.update(brainRuns).set({ status: "planned", synthesis: null, completedAt: null, updatedAt: new Date() }).where(eq(brainRuns.id, run.id));
    await recordAuditEvent(req.user!.id, "brain_task_retry_requested", { runId: run.id, taskId: task.id, ...auditActor(req.user!) });
    res.json(await getRunDetail((await getOwnedRun(run.id, req.user!.id))!));
  });

  app.post("/api/brain/runs/:runId/approvals/:approvalId", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = approvalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const run = await getOwnedRun(Number(req.params.runId), req.user!.id);
    if (!run) return res.status(404).json({ error: "Brain run not found." });
    const db = getDb();
    const [approval] = await db.select().from(brainApprovals).where(and(eq(brainApprovals.id, Number(req.params.approvalId)), eq(brainApprovals.runId, run.id))).limit(1);
    if (!approval || approval.status !== "pending") return res.status(409).json({ error: "Pending approval not found." });
    const tasks = await db.select().from(brainTasks).where(eq(brainTasks.runId, run.id)).orderBy(asc(brainTasks.id));
    const approvalTask = tasks.find((task) => task.id === approval.taskId);
    const currentSnapshotHash = brainApprovalSnapshotHash(tasks, approval.taskId);
    if (approvalTask?.status !== "awaiting_approval" || currentSnapshotHash !== approval.snapshotHash) return res.status(409).json({ error: "The evidence changed after this approval was requested. Replay the materiality gate." });
    const decidedAt = new Date();
    await db.update(brainApprovals).set({ status: parsed.data.decision, note: parsed.data.note ?? null, decidedByUserId: req.user!.id, decidedAt }).where(eq(brainApprovals.id, approval.id));
    await db.update(brainTasks).set({ status: parsed.data.decision === "approved" ? "completed" : "rejected", output: { decision: parsed.data.decision, note: parsed.data.note ?? null, snapshotHash: approval.snapshotHash }, deterministicRefs: [`brain-approval:${approval.id}:${approval.snapshotHash}`], completedAt: decidedAt, updatedAt: decidedAt }).where(eq(brainTasks.id, approval.taskId));
    await db.update(brainRuns).set({ status: parsed.data.decision === "approved" ? "planned" : "rejected", updatedAt: decidedAt, completedAt: parsed.data.decision === "rejected" ? decidedAt : null }).where(eq(brainRuns.id, run.id));
    await recordAuditEvent(req.user!.id, `brain_run_${parsed.data.decision}`, { runId: run.id, approvalId: approval.id, snapshotHash: approval.snapshotHash, ...auditActor(req.user!) });
    res.json(await getRunDetail((await getOwnedRun(run.id, req.user!.id))!));
  });
}