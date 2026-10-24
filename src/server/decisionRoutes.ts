import { tenantContext } from "./tenantContext";
import { terminalExecutionTargetSchema } from "@shared/terminalArtifact";
import { validateTerminalExecutionTarget } from "./terminalArtifactTool";
import { createTerminalArtifactEngineVersion } from "./artifactStore";
import { executeOriginalDecisionAnalysis, executeOriginalDecisionReverseDcf } from "./advancedQuantExecution";
import { randomUUID } from "node:crypto";
import type { DeviceReviewBinding } from "@shared/deviceOutbox";
import type { Express, Request, Response } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { assertDecisionPermission, DecisionAuthorizationError, getDecisionAuthorization, requireDecisionPermission } from "./decisionAuthorization";
import type { DecisionAuthorization } from "./decisionAuthorization";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { getDb, type DrizzleDb } from "./db";
import {
  brainRuns,
  brainTasks,
  decisionApprovals,
  decisionCases,
  decisionMonitoringRules,
  decisionReceiptVersions,
  decisionReplays,
  organizations,
  researchEvidence,
  researchInvestigations,
} from "@shared/schema";
import {
  buildScenarioDecisionArtifact,
  scenarioArtifactCalculation,
  scenarioArtifactFromCalculations,
  scenarioPipelineCalculationFromCalculations,
  validateScenarioPipelineCalculation,
  type ScenarioDecisionArtifact,
} from "./scenarioDecisionArtifact";
import { modelAssuranceArtifactSchema } from "@shared/modelAssurance";
import {
  assessReceiptCompleteness,
  calculateDecisionConfidence,
  calculateReverseDcf,
  decisionSnapshotHash,
  evaluateMonitoringRule,
  findDecisionBoundary,
  runModelTournament,
  stressThesis,
  type AssumptionInput,
  type ContradictionInput,
  type EvidenceInput,
  type ModelCandidate,
  type ScenarioInput,
} from "./decisionEngine";
import { criticalityForDecision, evaluateAssuranceArtifactForDecision } from "./decisionAssuranceGate";
import type { ScenarioActionInput } from "./scenarioActionEngine";

const nullableId = z.number().int().positive().nullable().optional();
const finite = z.number().finite();
const score = finite.min(0).max(1);

const assumptionSchema = z.object({
  label: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(500),
  uncertainty: score,
  basis: z.string().trim().max(2000),
  invalidationCondition: z.string().trim().max(2000),
});
const scenarioSchema = z.object({
  name: z.string().trim().min(1).max(120),
  probability: score.optional(),
  outcome: finite,
  decision: z.string().trim().min(1).max(500),
});
const modelSchema = z.object({
  name: z.string().trim().min(1).max(160),
  version: z.string().trim().min(1).max(120),
  output: finite,
  methodologyQuality: score,
  sourceCoverage: score,
  validationScore: score,
  independence: score,
});
const contradictionSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  resolved: z.boolean(),
  resolution: z.string().trim().max(2000).optional(),
});
const calculationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  value: z.union([z.string().max(500), finite]),
  deterministicRef: z.string().trim().max(500),
  modelVersion: z.string().trim().max(120).optional(),
});
const alternativeSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(3000),
  rejectedReason: z.string().trim().max(2000).optional(),
});
const counterargumentSchema = z.object({
  argument: z.string().trim().min(1).max(3000),
  response: z.string().trim().max(3000).optional(),
});
const triggerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  indicator: z.string().trim().min(1).max(200),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq"]),
  threshold: finite,
  unit: z.string().trim().min(1).max(50),
  action: z.string().trim().min(1).max(1000),
  sourceUrl: z.string().url().max(4000).optional(),
});
const scenarioSourceSchema = z.object({
  status: z.enum(["manual", "source", "provider", "private"]).optional(),
  source: z.string().trim().max(2000).optional(),
  provider: z.string().trim().max(200).optional(),
  asOf: z.string().trim().max(120).optional(),
  period: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(120).optional(),
}).passthrough();
const scenarioNodeSchema = scenarioSourceSchema.extend({ node: z.string().trim().min(1).max(200), change: finite }).passthrough();
const scenarioAssetSchema = scenarioSourceSchema.extend({
  assetId: z.string().trim().min(1).max(200),
  scenarioImpact: finite.optional(),
  impact: finite.optional(),
  riskImpact: finite.optional(),
  risk: finite.optional(),
  liquidity: finite.optional(),
  node: z.string().trim().max(200).optional(),
}).passthrough();
const scenarioExposureSchema = z.object({ assetId: z.string().trim().min(1).max(200), weight: finite.optional(), exposure: finite.optional() }).passthrough();
const scenarioAlternativeSchema = z.object({
  type: z.enum(["hold", "reduce", "increase", "hedge", "defer"]),
  label: z.string().trim().max(200).optional(),
  assetId: z.string().trim().max(200).optional(),
  targetWeight: finite.optional(),
  weightDelta: finite.optional(),
  cost: finite.optional(),
  hedgeRatio: finite.optional(),
}).passthrough();
const scenarioConstraintsSchema = z.object({
  maxWeight: z.union([finite, z.record(finite)]).optional(),
  minLiquidity: finite.optional(),
  maxTurnover: finite.optional(),
  riskBudget: finite.optional(),
}).passthrough();
const scenarioAlternativeInputSchema = z.union([
  scenarioAlternativeSchema,
  z.enum(["hold", "reduce", "increase", "hedge", "defer"]),
]);
const scenarioActionInputSchema = z.object({
  nodeImpacts: z.union([z.array(scenarioNodeSchema), z.record(finite)]).optional(),
  scenarioNodeImpacts: z.union([z.array(scenarioNodeSchema), z.record(finite)]).optional(),
  assetImpacts: z.array(scenarioAssetSchema).optional(),
  assets: z.array(scenarioAssetSchema).optional(),
  exposures: z.union([z.array(scenarioExposureSchema), z.record(finite)]).optional(),
  currentExposure: z.record(finite).optional(),
  currentWeights: z.record(finite).optional(),
  actionAlternatives: z.union([z.array(scenarioAlternativeInputSchema), z.array(z.string())]).optional(),
  actions: z.union([z.array(scenarioAlternativeInputSchema), z.array(z.string())]).optional(),
  constraints: scenarioConstraintsSchema.optional(),
  costs: z.record(finite).optional(),
  source: scenarioSourceSchema.optional(),
}).passthrough();
const scenarioArtifactRequestSchema = z.object({
  receiptVersionId: z.number().int().positive(),
  scenarioInputs: scenarioActionInputSchema.optional(),
  inputs: scenarioActionInputSchema.optional(),
  modelVersion: z.string().trim().min(1).max(200).optional(),
  modelHash: z.string().trim().min(1).max(2000).optional(),
}).passthrough();

const scenarioPipelineAttachmentRequestSchema = z.object({
  receiptVersionId: z.number().int().positive(),
  pipelineCalculation: z.unknown(),
});

const createCaseSchema = z.object({
  title: z.string().trim().min(2).max(200),
  question: z.string().trim().min(5).max(5000),
  decisionType: z.string().trim().min(2).max(100).default("investment"),
  materiality: z.enum(["routine", "material", "critical"]).default("material"),
  symbol: z.string().trim().max(30).nullable().optional(),
  investigationId: nullableId,
  brainRunId: nullableId,
  organizationId: nullableId,
  reviewDate: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

const receiptSchema = z.object({
  recommendation: z.string().trim().min(1).max(10000),
  interpretation: z.string().trim().min(1).max(10000),
  requiredEvidenceCount: z.number().int().min(1).max(100).default(3),
  evidenceAssessments: z.array(z.object({ id: z.number().int().positive(), supports: z.enum(["supports", "contradicts", "neutral"]) })).default([]),
  assumptions: z.array(assumptionSchema).max(100),
  calculations: z.array(calculationSchema).max(100).default([]),
  models: z.array(modelSchema).max(50),
  scenarios: z.array(scenarioSchema).max(50),
  alternatives: z.array(alternativeSchema).max(50),
  counterarguments: z.array(counterargumentSchema).max(100),
  contradictions: z.array(contradictionSchema).max(100).default([]),
  monitoringTriggers: z.array(triggerSchema).max(100).default([]),
  assuranceArtifact: modelAssuranceArtifactSchema.optional(),
});

const storedConfidenceSchema = z.object({
  assurance: modelAssuranceArtifactSchema.nullable().optional(),
}).passthrough();

const analysisSchema = receiptSchema.pick({ assumptions: true, models: true, scenarios: true, contradictions: true }).extend({
  evidence: z.array(z.object({
    id: z.number().int().positive().optional(), title: z.string().min(1), kind: z.string().min(1),
    supports: z.enum(["supports", "contradicts", "neutral"]),
    quality: z.object({ authority: score, directness: score, recency: score, corroboration: score, extractionConfidence: score }),
  })),
  boundary: z.object({ points: z.array(z.object({ assumptionValue: finite, outcome: finite })).min(2), threshold: finite }).optional(),
});

function parseId(value: unknown): number | null {
  if (Array.isArray(value)) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function loadDecision(id: number) {
  const db = getDb();
  const [decision] = await db.select().from(decisionCases).where(eq(decisionCases.id, id)).limit(1);
  return decision ?? null;
}

function evidenceQuality(item: typeof researchEvidence.$inferSelect) {
  return {
    authority: item.sourceQuality.authority,
    directness: item.sourceQuality.directness,
    recency: item.sourceQuality.recency,
    corroboration: item.sourceQuality.corroboration,
    extractionConfidence: item.sourceQuality.extractionConfidence,
  };
}

function receiptHashPayload(receipt: typeof decisionReceiptVersions.$inferSelect) {
  const { id: _id, snapshotHash: _hash, createdAt: _createdAt, ...payload } = receipt;
  return payload;
}
type DecisionScope = {
  decision: typeof decisionCases.$inferSelect;
  investigation: typeof researchInvestigations.$inferSelect | null;
  brainRun: typeof brainRuns.$inferSelect | null;
};

function canAccessOwner(user: Express.User, ownerUserId: number, write: boolean): boolean {
  if (user.role === "internal_admin") return true;
  if (write) return ownerUserId === user.id;
  return user.role === "internal_compliance" || ownerUserId === user.id;
}

async function loadDecisionScope(id: number, user: Express.User, write = false): Promise<DecisionScope | null> {
  const decision = await loadDecision(id);
  if (!decision || !canAccessOwner(user, decision.ownerUserId, write)) return null;
  if (decision.organizationId !== null && decision.organizationId !== user.organizationId) return null;
  const db = getDb();
  let investigation: typeof researchInvestigations.$inferSelect | null = null;
  let brainRun: typeof brainRuns.$inferSelect | null = null;
  if (decision.investigationId) {
    [investigation] = await db.select().from(researchInvestigations).where(eq(researchInvestigations.id, decision.investigationId)).limit(1);
    if (!investigation || !canAccessOwner(user, investigation.ownerUserId, write)) return null;
  }
  if (decision.brainRunId) {
    [brainRun] = await db.select().from(brainRuns).where(eq(brainRuns.id, decision.brainRunId)).limit(1);
    if (!brainRun || !canAccessOwner(user, brainRun.ownerUserId, write)) return null;
    if (brainRun.investigationId && !decision.investigationId) return null;
  }
  const investigationOrg = investigation?.organizationId ?? null;
  const brainOrg = brainRun?.organizationId ?? null;
  if (investigation && brainRun && investigationOrg !== brainOrg) return null;
  if ((decision.organizationId ?? null) !== (investigation ? investigationOrg : brainRun ? brainOrg : null)) return null;
  if (investigation && brainRun && brainRun.investigationId !== investigation.id) return null;
  return { decision, investigation, brainRun };
}

async function validateNewDecisionScope(
  input: z.infer<typeof createCaseSchema>,
  user: Express.User,
): Promise<{ organizationId: number | null; error?: string; status?: number }> {
  const db = getDb();
  let investigation: typeof researchInvestigations.$inferSelect | null = null;
  let brainRun: typeof brainRuns.$inferSelect | null = null;
  if (input.investigationId) {
    [investigation] = await db.select().from(researchInvestigations).where(eq(researchInvestigations.id, input.investigationId)).limit(1);
    if (!investigation || !canAccessOwner(user, investigation.ownerUserId, true)) return { organizationId: null, error: "Investigation not found.", status: 404 };
  }
  if (input.brainRunId) {
    [brainRun] = await db.select().from(brainRuns).where(eq(brainRuns.id, input.brainRunId)).limit(1);
    if (!brainRun || !canAccessOwner(user, brainRun.ownerUserId, true)) return { organizationId: null, error: "Brain run not found.", status: 404 };
  }
  if (brainRun?.investigationId && (!investigation || brainRun.investigationId !== investigation.id)) {
    return { organizationId: null, error: "Investigation and Brain run links must match.", status: 400 };
  }
  const investigationOrg = investigation?.organizationId ?? null;
  const brainOrg = brainRun?.organizationId ?? null;
  if (investigation && brainRun && investigationOrg !== brainOrg) return { organizationId: null, error: "Investigation and Brain organization scopes must match.", status: 400 };
  const organizationId = investigation ? investigationOrg : brainRun ? brainOrg : null;
  if ((input.organizationId ?? null) !== organizationId) return { organizationId: null, error: "Decision organization scope must match its linked resources.", status: 400 };
  if (organizationId !== null && organizationId !== user.organizationId) return { organizationId: null, error: "Decision belongs to another organization.", status: 403 };
  if (organizationId != null) {
    const [organization] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!organization) return { organizationId: null, error: "Organization not found.", status: 400 };
  }
  return { organizationId };
}
function scenarioOwnershipError(user: Express.User, decision: typeof decisionCases.$inferSelect): string | null {
  if (decision.organizationId !== null && user.organizationId !== decision.organizationId) {
    return "Decision belongs to another organization.";
  }
  if (user.role !== "internal_admin" && decision.ownerUserId !== user.id) {
    return "Only the decision owner or an internal administrator can attach scenario candidates.";
  }
  return null;
}

type DecisionCaseRow = typeof decisionCases.$inferSelect;
type DecisionReceiptRow = typeof decisionReceiptVersions.$inferSelect;
type DecisionReceiptInsert = typeof decisionReceiptVersions.$inferInsert;

export interface ScenarioPipelineAttachmentRouteStore {
  loadDecision: (id: number) => Promise<DecisionCaseRow | null>;
  loadReceipt: (decisionId: number, receiptVersionId: number) => Promise<DecisionReceiptRow | null>;
  listReceipts: (decisionId: number) => Promise<DecisionReceiptRow[]>;
  persistAttachment: (payload: DecisionReceiptInsert, decisionId: number) => Promise<DecisionReceiptRow>;
}

const defaultScenarioPipelineAttachmentStore: ScenarioPipelineAttachmentRouteStore = {
  loadDecision,
  async loadReceipt(decisionId, receiptVersionId) {
    const db = getDb();
    const [receipt] = await db.select().from(decisionReceiptVersions).where(and(
      eq(decisionReceiptVersions.id, receiptVersionId),
      eq(decisionReceiptVersions.decisionId, decisionId),
    )).limit(1);
    return receipt ?? null;
  },
  async listReceipts(decisionId) {
    return getDb().select().from(decisionReceiptVersions).where(eq(decisionReceiptVersions.decisionId, decisionId));
  },
  async persistAttachment(payload, decisionId) {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(decisionReceiptVersions).values(payload).returning();
      await tx.update(decisionCases).set({
        status: "review",
        approvedReceiptVersionId: null,
        updatedAt: new Date(),
      }).where(eq(decisionCases.id, decisionId));
      return created;
    });
  },
};

export function createScenarioPipelineAttachmentHandler(
  store: ScenarioPipelineAttachmentRouteStore = defaultScenarioPipelineAttachmentStore,
  audit: typeof recordAuditEvent = recordAuditEvent,
) {
  return async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    if (!id) return void res.status(400).json({ error: "Invalid decision id." });
    const parsed = scenarioPipelineAttachmentRequestSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
    const validated = validateScenarioPipelineCalculation(parsed.data.pipelineCalculation);
    if (!validated) return void res.status(400).json({ error: "Invalid scenario pipeline calculation or trace hash." });
    const decision = await store.loadDecision(id);
    if (!decision) return void res.status(404).json({ error: "Decision not found." });
    const ownershipError = scenarioOwnershipError(req.user!, decision);
    if (ownershipError) return void res.status(403).json({ error: ownershipError });
    if (["approved", "rejected", "superseded", "expired"].includes(decision.status)) {
      return void res.status(409).json({ error: "Scenario pipeline calculations can only be attached while a decision is under review." });
    }
    const sourceReceipt = await store.loadReceipt(id, parsed.data.receiptVersionId);
    if (!sourceReceipt || sourceReceipt.decisionId !== id) return void res.status(404).json({ error: "Receipt version not found for this decision." });
    if (decisionSnapshotHash(receiptHashPayload(sourceReceipt)) !== sourceReceipt.snapshotHash) {
      return void res.status(409).json({ error: "Receipt hash verification failed." });
    }
    const receipts = await store.listReceipts(id);
    const existing = receipts.find((receipt) =>
      scenarioPipelineCalculationFromCalculations(receipt.calculations, validated.traceHash) !== null);
    if (existing) {
      return void res.json({
        ...exposeScenarioArtifact(existing),
        pipelineCalculation: validated.calculation,
        traceHash: validated.traceHash,
        idempotent: true,
      });
    }
    const latest = receipts.reduce<DecisionReceiptRow | null>(
      (current, receipt) => !current || receipt.version > current.version ? receipt : current,
      null,
    );
    const version = (latest?.version ?? 0) + 1;
    const calculations = [...sourceReceipt.calculations, validated.calculation as unknown as Record<string, unknown>];
    const payload: DecisionReceiptInsert = {
      decisionId: id,
      version,
      createdByUserId: req.user!.id,
      question: sourceReceipt.question,
      recommendation: sourceReceipt.recommendation,
      interpretation: sourceReceipt.interpretation,
      evidence: sourceReceipt.evidence,
      sources: sourceReceipt.sources,
      assumptions: sourceReceipt.assumptions,
      calculations,
      models: sourceReceipt.models,
      scenarios: sourceReceipt.scenarios,
      alternatives: sourceReceipt.alternatives,
      counterarguments: sourceReceipt.counterarguments,
      contradictions: sourceReceipt.contradictions,
      confidence: sourceReceipt.confidence,
      monitoringTriggers: sourceReceipt.monitoringTriggers,
      provenance: sourceReceipt.provenance,
      requiredEvidenceCount: sourceReceipt.requiredEvidenceCount,
      completeness: sourceReceipt.completeness,
      snapshotHash: "",
    };
    const { snapshotHash: _snapshotHash, ...hashPayload } = payload;
    payload.snapshotHash = decisionSnapshotHash(hashPayload);
    const receipt = await store.persistAttachment(payload, id);
    await audit(req.user!.id, "scenario_pipeline_calculation_attached", {
      decisionId: id,
      sourceReceiptVersionId: sourceReceipt.id,
      receiptId: receipt.id,
      receiptVersion: receipt.version,
      traceHash: validated.traceHash,
      approvalRequired: true,
      ...auditActor(req.user!),
    });
    return void res.status(201).json({
      ...exposeScenarioArtifact(receipt),
      pipelineCalculation: validated.calculation,
      traceHash: validated.traceHash,
    });
  };
}

export const scenarioPipelineAttachmentRouteHandler = createScenarioPipelineAttachmentHandler();

function exposeScenarioArtifact(receipt: typeof decisionReceiptVersions.$inferSelect) {
  return {
    ...receipt,
    scenarioActionArtifact: scenarioArtifactFromCalculations(receipt.calculations),
  };
}

export const decisionApprovalInputSchema = z.object({
  receiptVersionId: z.number().int().positive(),
  outcome: z.enum(["approved", "rejected", "waived"]),
  finalDecision: z.string().trim().min(1).max(5000),
  rationale: z.string().trim().min(1).max(10000),
  note: z.string().trim().max(3000).optional(),
  waiverReason: z.string().trim().max(3000).optional(),
  requestId: z.string().uuid().optional(),
  policyDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export class DecisionReviewError extends Error {
  constructor(readonly statusCode: number, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

async function decisionAuthority(user: Express.User, permission: "read_decisions" | "author_decisions" | "review_decisions", db = getDb(), lock = false, organizationId?: number | null) {
  try {
    const authority = await getDecisionAuthorization(user, db, lock);
    assertDecisionPermission(authority, permission, organizationId);
    return authority;
  } catch (error) {
    if (error instanceof DecisionAuthorizationError) throw new DecisionReviewError(error.statusCode, error.message);
    throw error;
  }
}

function reviewDeniedReason(authority: DecisionAuthorization) {
  try { assertDecisionPermission(authority, "review_decisions"); return null; }
  catch (error) { if (error instanceof DecisionAuthorizationError) return error.message; throw error; }
}

/** Canonical DecisionCase head, excluding recency-only timestamps. */
export function decisionReviewHead(decision: DecisionCaseRow): string {
  return decisionSnapshotHash({
    id: decision.id, ownerUserId: decision.ownerUserId, organizationId: decision.organizationId,
    title: decision.title, question: decision.question, materiality: decision.materiality,
    status: decision.status, finalDecision: decision.finalDecision, rationale: decision.decisionRationale,
    approvedReceiptVersionId: decision.approvedReceiptVersionId, expiresAt: decision.expiresAt,
    investigationId: decision.investigationId, brainRunId: decision.brainRunId,
  });
}

export async function readCanonicalDecisionReview(id: number, user: Express.User) {
  const authority = await decisionAuthority(user, "read_decisions");
  const scope = await loadDecisionScope(id, user);
  if (!scope) throw new DecisionReviewError(404, "Decision not found.");
  const db = getDb();
  const [receipt] = await db.select().from(decisionReceiptVersions).where(eq(decisionReceiptVersions.decisionId, id)).orderBy(desc(decisionReceiptVersions.version)).limit(1);
  if (!receipt) throw new DecisionReviewError(409, "A current receipt is required before review.");
  if (decisionSnapshotHash(receiptHashPayload(receipt)) !== receipt.snapshotHash) throw new DecisionReviewError(409, "Receipt hash verification failed.");
  const [approval] = await db.select().from(decisionApprovals).where(and(eq(decisionApprovals.receiptVersionId, receipt.id), eq(decisionApprovals.reviewerUserId, user.id))).limit(1);
  return { decision: scope.decision, receipt, approval: approval ?? null, canReview: authority.grants.review_decisions, policyDigest: authority.digest, permissions: authority.grants, reviewDeniedReason: reviewDeniedReason(authority) };
}

/** One approval authority for HTTP and paired Gateway; outbox release never executes an action. */
export async function submitCanonicalDecisionReview(
  id: number, user: Express.User, input: z.infer<typeof decisionApprovalInputSchema>,
  continuation?: { binding: DeviceReviewBinding; revalidate: (db: DrizzleDb) => Promise<string> },
) {
  await decisionAuthority(user, "review_decisions");
  const scope = await loadDecisionScope(id, user);
  if (!scope) throw new DecisionReviewError(404, "Decision not found.");
  const requestId = input.requestId ?? randomUUID();
  const result = await getDb().transaction(async (transaction) => {
    const tx = transaction as unknown as DrizzleDb;
    // Row locks linearize revocation/current authority and DecisionCase finalization with review.
    const policyDigest = continuation ? await continuation.revalidate(tx) : null;
    const authority = await decisionAuthority(user, "review_decisions", tx, true);
    if (!continuation && input.policyDigest !== authority.digest) throw new DecisionReviewError(409, "Organization policy changed or is not bound to this review; inspect the current decision.");
    const requestHash = decisionSnapshotHash({ decisionId: id, ...input, requestId, binding: continuation?.binding ?? null, enterprisePolicyDigest: authority.digest });
    const [decision] = await tx.select().from(decisionCases).where(eq(decisionCases.id, id)).for("update").limit(1);
    if (!decision || !canAccessOwner(user, decision.ownerUserId, false)) throw new DecisionReviewError(404, "Decision not found.");
    if (decision.organizationId !== null && decision.organizationId !== authority.user.organizationId) throw new DecisionReviewError(403, "Decision belongs to another organization.");
    const [latest] = await tx.select().from(decisionReceiptVersions).where(eq(decisionReceiptVersions.decisionId, id)).orderBy(desc(decisionReceiptVersions.version)).limit(1);
    if (!latest || latest.id !== input.receiptVersionId) throw new DecisionReviewError(409, "Only the latest receipt version can be reviewed.");
    if (decisionSnapshotHash(receiptHashPayload(latest)) !== latest.snapshotHash) throw new DecisionReviewError(409, "Receipt hash verification failed.");
    if (decision.expiresAt && decision.expiresAt.getTime() <= Date.now()) throw new DecisionReviewError(409, "This decision has expired.");
    const completeness = latest.completeness as { complete?: boolean; missing?: string[] };
    if (input.outcome === "approved" && !completeness.complete) throw new DecisionReviewError(409, "Receipt is incomplete and cannot be approved.", { missing: completeness.missing ?? [] });
    const storedConfidence = storedConfidenceSchema.safeParse(latest.confidence);
    const outputCriticality = criticalityForDecision(decision.materiality, decision.organizationId);
    const assuranceGate = evaluateAssuranceArtifactForDecision(storedConfidence.success ? storedConfidence.data.assurance ?? null : null, outputCriticality, new Date().toISOString());
    if (input.outcome === "approved" && !assuranceGate.permitted) throw new DecisionReviewError(409, "Decision assurance gate rejected approval.", { assuranceGate });
    if (input.outcome === "waived" && outputCriticality === "material_decision" && !assuranceGate.permitted) throw new DecisionReviewError(409, "Institutional assurance cannot be waived for a material decision.", { assuranceGate });
    if (input.outcome === "waived") {
      if (user.role !== "internal_admin") throw new DecisionReviewError(403, "Only an internal administrator can document a waiver.");
      if (!input.waiverReason?.trim()) throw new DecisionReviewError(400, "waiverReason is required for a waiver.");
    }
    const binding = continuation?.binding;
    if (binding && (binding.decisionId !== id || binding.userId !== user.id || binding.receiptVersionId !== latest.id || binding.snapshotHash !== latest.snapshotHash || binding.policyDigest !== policyDigest)) throw new DecisionReviewError(409, "Review identity, receipt or current policy changed; inspect the current decision.");
    if (binding && (Date.parse(binding.expiresAt) <= Date.now() || Date.parse(binding.issuedAt) > Date.now() || Date.parse(binding.expiresAt) - Date.parse(binding.issuedAt) > 24 * 60 * 60 * 1000)) throw new DecisionReviewError(409, "This offline review binding has expired or is invalid.");
    const [existing] = await tx.select().from(decisionApprovals).where(and(eq(decisionApprovals.reviewerUserId, user.id), eq(decisionApprovals.reviewRequestId, requestId))).limit(1);
    const status = input.outcome === "rejected" ? "rejected" : "approved";
    if (existing) {
      if (existing.reviewRequestHash !== requestHash || existing.receiptVersionId !== latest.id || existing.snapshotHash !== latest.snapshotHash || decision.status !== status || decision.finalDecision !== input.finalDecision || decision.decisionRationale !== input.rationale || decision.approvedReceiptVersionId !== (input.outcome === "rejected" ? null : latest.id)) throw new DecisionReviewError(409, "Review request changed or its previously reviewed head is no longer current.");
      return { approval: existing, idempotent: true, assuranceGate, outputCriticality, requestHash };
    }
    if (binding && binding.decisionHead !== decisionReviewHead(decision)) throw new DecisionReviewError(409, "Decision head changed; inspect the current decision before releasing a new review.");
    // Device continuations cannot overwrite a finalized head; ordinary HTTP review retains its current semantics.
    if (binding && ["approved", "rejected", "superseded", "expired"].includes(decision.status)) throw new DecisionReviewError(409, "This decision is already finalized or expired.");
    const [other] = await tx.select().from(decisionApprovals).where(and(eq(decisionApprovals.reviewerUserId, user.id), eq(decisionApprovals.receiptVersionId, latest.id))).limit(1);
    if (other) throw new DecisionReviewError(409, "This receipt already has a review from this account.");
    const [approval] = await tx.insert(decisionApprovals).values({
      decisionId: id, receiptVersionId: latest.id, outcome: input.outcome, snapshotHash: latest.snapshotHash,
      note: input.note, waiverReason: input.waiverReason, reviewerUserId: user.id, reviewRequestId: requestId, reviewRequestHash: requestHash,
    }).returning();
    await tx.update(decisionCases).set({ status, finalDecision: input.finalDecision, decisionRationale: input.rationale, approvedReceiptVersionId: input.outcome === "rejected" ? null : latest.id, updatedAt: new Date() }).where(eq(decisionCases.id, id));
    return { approval, idempotent: false, assuranceGate, outputCriticality, requestHash };
  });
  if (!result.idempotent) await recordAuditEvent(user.id, "decision_reviewed", {
    decisionId: id, receiptId: result.approval.receiptVersionId, outcome: input.outcome,
    snapshotHash: result.approval.snapshotHash, requestId, requestHash: result.requestHash,
    assuranceCriticality: result.outputCriticality, assurancePermitted: result.assuranceGate.permitted,
    assuranceReasonCodes: result.assuranceGate.reasonCodes, ...auditActor(user),
  });
  return result;
}

export function registerDecisionRoutes(app: Express): void {
  app.get("/api/decisions", requireDecisionPermission("read_decisions"), async (req, res) => {
    const db = getDb();
    const rows = await db.select().from(decisionCases).orderBy(desc(decisionCases.updatedAt)).limit(200);
    res.json(rows.filter((item) => canAccessOwner(req.user!, item.ownerUserId, false) && (item.organizationId === null || item.organizationId === req.user!.organizationId)));
  });

  app.post("/api/decisions", requireDecisionPermission("author_decisions"), async (req, res) => {
    const parsed = createCaseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const scopeResult = await validateNewDecisionScope(parsed.data, req.user!);
    if (scopeResult.error) return res.status(scopeResult.status ?? 400).json({ error: scopeResult.error });
    const db = getDb();
    const [decision] = await db.insert(decisionCases).values({
      ...parsed.data,
      organizationId: scopeResult.organizationId,
      ownerUserId: req.user!.id,
    }).returning();
    await recordAuditEvent(req.user!.id, "decision_case_created", { decisionId: decision.id, ...auditActor(req.user!) });
    res.status(201).json(decision);
  });

  app.get("/api/decisions/:id", requireDecisionPermission("read_decisions"), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid decision id." });
    const scope = await loadDecisionScope(id, req.user!);
    if (!scope) return res.status(404).json({ error: "Decision not found." });
    const { decision } = scope;
    const db = getDb();
    const [receipts, approvals, monitoringRules, replays] = await Promise.all([
      db.select().from(decisionReceiptVersions).where(eq(decisionReceiptVersions.decisionId, id)).orderBy(desc(decisionReceiptVersions.version)),
      db.select().from(decisionApprovals).where(eq(decisionApprovals.decisionId, id)).orderBy(desc(decisionApprovals.createdAt)),
      db.select().from(decisionMonitoringRules).where(eq(decisionMonitoringRules.decisionId, id)).orderBy(asc(decisionMonitoringRules.id)),
      db.select().from(decisionReplays).where(eq(decisionReplays.decisionId, id)).orderBy(desc(decisionReplays.createdAt)),
    ]);
    const authority = await decisionAuthority(req.user!, "read_decisions", db, false, decision.organizationId);
    res.json({ decision, receipts: receipts.map(exposeScenarioArtifact), approvals, monitoringRules, replays, policyDigest: authority.digest, permissions: authority.grants, reviewDeniedReason: reviewDeniedReason(authority) });
  });

  app.post("/api/decisions/:id/receipts", requireDecisionPermission("author_decisions"), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid decision id." });
    const parsed = receiptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const scope = await loadDecisionScope(id, req.user!, true);
    if (!scope) return res.status(404).json({ error: "Decision not found." });
    const { decision } = scope;
    if (["approved", "rejected", "superseded"].includes(decision.status)) return res.status(409).json({ error: "Create a new decision case to revise a finalized decision." });
    const db = getDb();
    const linkedEvidence = decision.investigationId
      ? await db.select().from(researchEvidence).where(eq(researchEvidence.investigationId, decision.investigationId)).orderBy(asc(researchEvidence.id))
      : [];
    const assessment = new Map(parsed.data.evidenceAssessments.map((item) => [item.id, item.supports]));
    const linkedEvidenceIds = new Set(linkedEvidence.map((item) => item.id));
    if (parsed.data.evidenceAssessments.some((item) => !linkedEvidenceIds.has(item.id))) {
      return res.status(400).json({ error: "Every evidence assessment must belong to the linked investigation." });
    }
    const evidence: EvidenceInput[] = linkedEvidence.map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.evidenceKind,
      supports: assessment.get(item.id) ?? (item.evidenceKind === "counterargument" ? "contradicts" : "neutral"),
      quality: evidenceQuality(item),
    }));
    const sources = linkedEvidence.map((item) => ({
      evidenceId: item.id, title: item.title, sourceName: item.sourceName, provider: item.provider,
      sourceUrl: item.sourceUrl, sourceExternalId: item.sourceExternalId, retrievedAt: item.retrievedAt.toISOString(),
      contentFingerprint: item.contentFingerprint,
    }));
    const provenance = decision.brainRunId
      ? (await db.select().from(brainTasks).where(eq(brainTasks.runId, decision.brainRunId)).orderBy(asc(brainTasks.id)))
        .map((task) => ({ taskId: task.id, taskKey: task.taskKey, status: task.status, deterministicRefs: task.deterministicRefs, provenance: task.provenance }))
      : [];
    const decisionConfidence = calculateDecisionConfidence({
      evidence,
      requiredEvidenceCount: parsed.data.requiredEvidenceCount,
      assumptions: parsed.data.assumptions,
      scenarios: parsed.data.scenarios,
      models: parsed.data.models,
      contradictions: parsed.data.contradictions,
    });
    const outputCriticality = criticalityForDecision(decision.materiality, decision.organizationId);
    const assuranceGate = evaluateAssuranceArtifactForDecision(
      parsed.data.assuranceArtifact,
      outputCriticality,
      new Date().toISOString(),
    );
    const confidence = {
      ...decisionConfidence,
      assurance: parsed.data.assuranceArtifact ?? null,
      assuranceGate,
    };
    const completeness = assessReceiptCompleteness({
      question: decision.question,
      recommendation: parsed.data.recommendation,
      interpretation: parsed.data.interpretation,
      materiality: decision.materiality,
      requiredEvidenceCount: parsed.data.requiredEvidenceCount,
      evidence,
      assumptions: parsed.data.assumptions,
      calculations: parsed.data.calculations,
      models: parsed.data.models,
      scenarios: parsed.data.scenarios,
      alternatives: parsed.data.alternatives,
      counterarguments: parsed.data.counterarguments,
      contradictions: parsed.data.contradictions,
      monitoringTriggers: parsed.data.monitoringTriggers,
    });
    const [latest] = await db.select({ version: decisionReceiptVersions.version }).from(decisionReceiptVersions)
      .where(eq(decisionReceiptVersions.decisionId, id)).orderBy(desc(decisionReceiptVersions.version)).limit(1);
    const version = (latest?.version ?? 0) + 1;
    const payload = {
      decisionId: id,
      version,
      question: decision.question,
      recommendation: parsed.data.recommendation,
      interpretation: parsed.data.interpretation,
      evidence,
      sources,
      assumptions: parsed.data.assumptions,
      calculations: parsed.data.calculations,
      models: parsed.data.models,
      scenarios: parsed.data.scenarios,
      alternatives: parsed.data.alternatives,
      counterarguments: parsed.data.counterarguments,
      contradictions: parsed.data.contradictions,
      confidence,
      monitoringTriggers: parsed.data.monitoringTriggers,
      provenance,
      requiredEvidenceCount: parsed.data.requiredEvidenceCount,
      completeness,
      createdByUserId: req.user!.id,
    };
    const snapshotHash = decisionSnapshotHash(payload);
    const receipt = await db.transaction(async (tx) => {
      const [created] = await tx.insert(decisionReceiptVersions).values({ ...payload, snapshotHash }).returning();
      if (parsed.data.monitoringTriggers.length) {
        await tx.insert(decisionMonitoringRules).values(parsed.data.monitoringTriggers.map((trigger) => ({
          decisionId: id,
          receiptVersionId: created.id,
          ...trigger,
          sourceUrl: trigger.sourceUrl ?? null,
          createdByUserId: req.user!.id,
        })));
      }
      await tx.update(decisionCases).set({ status: "review", updatedAt: new Date() }).where(eq(decisionCases.id, id));
      return created;
    });
    await recordAuditEvent(req.user!.id, "decision_receipt_versioned", {
      decisionId: id,
      receiptId: receipt.id,
      version,
      snapshotHash,
      complete: completeness.complete,
      assuranceCriticality: outputCriticality,
      assurancePermitted: assuranceGate.permitted,
      assuranceBand: parsed.data.assuranceArtifact?.band ?? null,
      assuranceScore: parsed.data.assuranceArtifact?.score ?? null,
      ...auditActor(req.user!),
    });
    res.status(201).json(receipt);
  });

  app.post(
    "/api/decisions/:id/scenario-pipeline",
    requireDecisionPermission("author_decisions"),
    scenarioPipelineAttachmentRouteHandler,
  );

  app.post("/api/decisions/:id/scenario-actions", requireDecisionPermission("author_decisions"), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid decision id." });
    const parsed = scenarioArtifactRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const scenarioInputs = (parsed.data.scenarioInputs ?? parsed.data.inputs) as ScenarioActionInput | undefined;
    if (!scenarioInputs) return res.status(400).json({ error: "scenarioInputs is required." });
    const decision = await loadDecision(id);
    if (!decision) return res.status(404).json({ error: "Decision not found." });
    const ownershipError = scenarioOwnershipError(req.user!, decision);
    if (ownershipError) return res.status(403).json({ error: ownershipError });
    if (["approved", "rejected", "superseded", "expired"].includes(decision.status)) {
      return res.status(409).json({ error: "Scenario candidates can only be attached while a decision is under review." });
    }
    const db = getDb();
    const [sourceReceipt] = await db.select().from(decisionReceiptVersions).where(and(
      eq(decisionReceiptVersions.id, parsed.data.receiptVersionId),
      eq(decisionReceiptVersions.decisionId, id),
    )).limit(1);
    if (!sourceReceipt) return res.status(404).json({ error: "Receipt version not found for this decision." });
    if (decisionSnapshotHash(receiptHashPayload(sourceReceipt)) !== sourceReceipt.snapshotHash) {
      return res.status(409).json({ error: "Receipt hash verification failed." });
    }
    const { artifact } = buildScenarioDecisionArtifact({
      scenarioInputs,
      modelVersion: parsed.data.modelVersion,
      modelHash: parsed.data.modelHash,
    });
    const receipts = await db.select().from(decisionReceiptVersions)
      .where(eq(decisionReceiptVersions.decisionId, id));
    const existing = receipts.find((receipt) => scenarioArtifactFromCalculations(receipt.calculations)?.candidateHash === artifact.candidateHash);
    if (existing) {
      return res.json({ ...exposeScenarioArtifact(existing), candidateHash: artifact.candidateHash, idempotent: true });
    }
    const [latest] = receipts.sort((left, right) => right.version - left.version);
    const version = (latest?.version ?? 0) + 1;
    const calculations = [...sourceReceipt.calculations, scenarioArtifactCalculation(artifact)];
    const payload = {
      decisionId: id,
      version,
      question: sourceReceipt.question,
      recommendation: sourceReceipt.recommendation,
      interpretation: sourceReceipt.interpretation,
      evidence: sourceReceipt.evidence,
      sources: sourceReceipt.sources,
      assumptions: sourceReceipt.assumptions,
      calculations,
      models: sourceReceipt.models,
      scenarios: sourceReceipt.scenarios,
      alternatives: sourceReceipt.alternatives,
      counterarguments: sourceReceipt.counterarguments,
      contradictions: sourceReceipt.contradictions,
      confidence: sourceReceipt.confidence,
      monitoringTriggers: sourceReceipt.monitoringTriggers,
      provenance: sourceReceipt.provenance,
      requiredEvidenceCount: sourceReceipt.requiredEvidenceCount,
      completeness: sourceReceipt.completeness,
      createdByUserId: req.user!.id,
    };
    const snapshotHash = decisionSnapshotHash(payload);
    const receipt = await db.transaction(async (tx) => {
      const [created] = await tx.insert(decisionReceiptVersions).values({ ...payload, snapshotHash }).returning();
      await tx.update(decisionCases).set({
        status: "review",
        approvedReceiptVersionId: null,
        updatedAt: new Date(),
      }).where(eq(decisionCases.id, id));
      return created;
    });
    await recordAuditEvent(req.user!.id, "scenario_action_candidates_attached", {
      decisionId: id,
      sourceReceiptVersionId: sourceReceipt.id,
      receiptId: receipt.id,
      receiptVersion: receipt.version,
      candidateHash: artifact.candidateHash,
      candidateStatus: artifact.candidateStatus,
      approvalRequired: true,
      ...auditActor(req.user!),
    });
    res.status(201).json({ ...exposeScenarioArtifact(receipt), candidateHash: artifact.candidateHash });
  });

  app.post("/api/decisions/:id/scenario-actions/monitor", requireDecisionPermission("author_decisions"), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid decision id." });
    const parsed = z.object({
      receiptVersionId: z.number().int().positive(),
      trigger: triggerSchema.optional(),
      name: triggerSchema.shape.name.optional(),
      indicator: triggerSchema.shape.indicator.optional(),
      operator: triggerSchema.shape.operator.optional(),
      threshold: triggerSchema.shape.threshold.optional(),
      unit: triggerSchema.shape.unit.optional(),
      action: triggerSchema.shape.action.optional(),
      sourceUrl: triggerSchema.shape.sourceUrl,
    }).passthrough().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const trigger = parsed.data.trigger ?? {
      name: parsed.data.name,
      indicator: parsed.data.indicator,
      operator: parsed.data.operator,
      threshold: parsed.data.threshold,
      unit: parsed.data.unit,
      action: parsed.data.action,
      sourceUrl: parsed.data.sourceUrl,
    };
    const validTrigger = triggerSchema.safeParse(trigger);
    if (!validTrigger.success) return res.status(400).json({ error: validTrigger.error.flatten() });
    const decision = await loadDecision(id);
    if (!decision) return res.status(404).json({ error: "Decision not found." });
    const ownershipError = scenarioOwnershipError(req.user!, decision);
    if (ownershipError) return res.status(403).json({ error: ownershipError });
    if (decision.status !== "approved" || decision.approvedReceiptVersionId !== parsed.data.receiptVersionId) {
      return res.status(409).json({ error: "A monitor trigger requires the approved receipt version." });
    }
    const db = getDb();
    const [receipt] = await db.select().from(decisionReceiptVersions).where(and(
      eq(decisionReceiptVersions.id, parsed.data.receiptVersionId),
      eq(decisionReceiptVersions.decisionId, id),
    )).limit(1);
    if (!receipt) return res.status(404).json({ error: "Receipt version not found for this decision." });
    if (decisionSnapshotHash(receiptHashPayload(receipt)) !== receipt.snapshotHash) {
      return res.status(409).json({ error: "Receipt hash verification failed." });
    }
    const artifact = scenarioArtifactFromCalculations(receipt.calculations);
    if (!artifact) return res.status(409).json({ error: "The approved receipt has no scenario-action candidate artifact." });
    const [approval] = await db.select().from(decisionApprovals).where(and(
      eq(decisionApprovals.decisionId, id),
      eq(decisionApprovals.receiptVersionId, receipt.id),
    )).orderBy(desc(decisionApprovals.createdAt)).limit(1);
    if (!approval || !["approved", "waived"].includes(approval.outcome) || approval.snapshotHash !== receipt.snapshotHash) {
      return res.status(409).json({ error: "An approval for the exact receipt hash is required before creating a monitor." });
    }
    const [monitor] = await db.insert(decisionMonitoringRules).values({
      decisionId: id,
      receiptVersionId: receipt.id,
      ...validTrigger.data,
      sourceUrl: validTrigger.data.sourceUrl ?? null,
      createdByUserId: req.user!.id,
    }).returning();
    await recordAuditEvent(req.user!.id, "scenario_action_monitor_created", {
      decisionId: id,
      receiptVersionId: receipt.id,
      monitoringRuleId: monitor.id,
      candidateHash: artifact.candidateHash,
      approvalId: approval.id,
      ...auditActor(req.user!),
    });
    res.status(201).json(monitor);
  });

  app.post("/api/decisions/:id/approval", requireDecisionPermission("review_decisions"), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid decision id." });
    const parsed = decisionApprovalInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const result = await submitCanonicalDecisionReview(id, req.user!, parsed.data);
      return res.status(result.idempotent ? 200 : 201).json(result.approval);
    } catch (error) {
      if (error instanceof DecisionReviewError) return res.status(error.statusCode).json({ error: error.message, ...error.details });
      throw error;
    }
  });

  app.post("/api/decisions/:id/replay", requireDecisionPermission("author_decisions"), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid decision id." });
    const parsed = z.object({ receiptVersionId: z.number().int().positive(), asOf: z.coerce.date(), inputs: z.record(z.unknown()).default({}) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const scope = await loadDecisionScope(id, req.user!, true);
    if (!scope) return res.status(404).json({ error: "Decision not found." });
    const { decision } = scope;
    const db = getDb();
    const [receipt] = await db.select().from(decisionReceiptVersions).where(and(
      eq(decisionReceiptVersions.id, parsed.data.receiptVersionId), eq(decisionReceiptVersions.decisionId, id),
    )).limit(1);
    if (!receipt) return res.status(404).json({ error: "Receipt version not found." });
    const replayPayload = { original: receiptHashPayload(receipt), asOf: parsed.data.asOf.toISOString(), inputs: parsed.data.inputs };
    const replaySnapshotHash = decisionSnapshotHash(replayPayload);
    const changed = Object.keys(parsed.data.inputs).length > 0;
    const result = {
      reproducible: decisionSnapshotHash(receiptHashPayload(receipt)) === receipt.snapshotHash,
      changed,
      originalConfidence: receipt.confidence,
      inputKeys: Object.keys(parsed.data.inputs).sort(),
      message: Object.keys(parsed.data.inputs).length ? "Replay captured updated inputs for comparison; create a new receipt version to adopt them." : "Historical receipt reproduced with its original sources and model versions.",
    };
    const [replay] = await db.insert(decisionReplays).values({
      decisionId: id, receiptVersionId: receipt.id, originalSnapshotHash: receipt.snapshotHash,
      replaySnapshotHash, asOf: parsed.data.asOf, inputs: parsed.data.inputs, result, changed, createdByUserId: req.user!.id,
    }).returning();
    await recordAuditEvent(req.user!.id, "decision_replayed", { decisionId: id, replayId: replay.id, changed, ...auditActor(req.user!) });
    res.status(201).json(replay);
  });

  app.patch("/api/decision-monitors/:id/evaluate", requireDecisionPermission("author_decisions"), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid monitoring rule id." });
    const parsed = z.object({ currentValue: finite, sourceUrl: z.string().url().max(4000).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const db = getDb();
    const [rule] = await db.select().from(decisionMonitoringRules).where(eq(decisionMonitoringRules.id, id)).limit(1);
    if (!rule) return res.status(404).json({ error: "Monitoring rule not found." });
    if (!await loadDecisionScope(rule.decisionId, req.user!, true)) return res.status(404).json({ error: "Decision not found." });
    const breached = evaluateMonitoringRule(rule.operator, rule.threshold, parsed.data.currentValue);
    const now = new Date();
    const [updated] = await db.update(decisionMonitoringRules).set({
      currentValue: parsed.data.currentValue,
      sourceUrl: parsed.data.sourceUrl ?? rule.sourceUrl,
      status: breached ? "breached" : "active",
      breachedAt: breached ? now : null,
      acknowledgedAt: null,
      lastEvaluatedAt: now,
    }).where(eq(decisionMonitoringRules.id, id)).returning();
    await recordAuditEvent(req.user!.id, breached ? "decision_trigger_breached" : "decision_trigger_evaluated", { decisionId: rule.decisionId, monitoringRuleId: id, currentValue: parsed.data.currentValue, ...auditActor(req.user!) });
    res.json(updated);
  });

  app.patch("/api/decision-monitors/:id/acknowledge", requireDecisionPermission("review_decisions"), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid monitoring rule id." });
    const db = getDb();
    const [rule] = await db.select().from(decisionMonitoringRules).where(eq(decisionMonitoringRules.id, id)).limit(1);
    if (!rule || !await loadDecisionScope(rule.decisionId, req.user!)) return res.status(404).json({ error: "Decision not found." });
    const [updated] = await db.update(decisionMonitoringRules).set({ status: "acknowledged", acknowledgedAt: new Date() })
      .where(and(eq(decisionMonitoringRules.id, id), eq(decisionMonitoringRules.status, "breached"))).returning();
    if (!updated) return res.status(409).json({ error: "Only a breached trigger can be acknowledged." });
    await recordAuditEvent(req.user!.id, "decision_trigger_acknowledged", { decisionId: updated.decisionId, monitoringRuleId: id, ...auditActor(req.user!) });
    res.json(updated);
  });

  app.post("/api/decision-analysis", requireDecisionPermission("read_decisions"), async (req, res) => {
    const parsed = analysisSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const input = parsed.data;
    if (req.body?.terminalArtifact !== undefined) {
      try {
        const target = terminalExecutionTargetSchema.parse(req.body.terminalArtifact); const ctx = tenantContext(req.user!);
        await validateTerminalExecutionTarget(ctx, target, new AbortController().signal);
        const execution = await executeOriginalDecisionAnalysis(input, ctx.userId);
        const version = await createTerminalArtifactEngineVersion(ctx, target, execution);
        res.json({ ...execution.response, terminalArtifact: { artifactId: version.artifactId, baseVersion: target.baseVersion, version: version.version, contentHash: version.contentHash } });
      } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Original decision result could not be retained." }); }
      return;
    }
    res.json({
      tournament: runModelTournament(input.models),
      thesisStress: stressThesis(input),
      decisionBoundary: input.boundary ? findDecisionBoundary(input.boundary.points, input.boundary.threshold) : null,
    });
  });

  app.post("/api/decision-analysis/reverse-dcf", requireDecisionPermission("read_decisions"), async (req, res) => {
    const parsed = z.object({
      enterpriseValue: finite.positive(), currentFreeCashFlow: finite.positive(), forecastYears: z.number().int().min(1).max(30),
      discountRate: finite.gt(-1).lt(5), terminalGrowthRate: finite.gt(-1).lt(1),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (req.body?.terminalArtifact !== undefined) {
      try {
        const target = terminalExecutionTargetSchema.parse(req.body.terminalArtifact); const ctx = tenantContext(req.user!);
        await validateTerminalExecutionTarget(ctx, target, new AbortController().signal);
        const execution = await executeOriginalDecisionReverseDcf(parsed.data, ctx.userId);
        const version = await createTerminalArtifactEngineVersion(ctx, target, execution);
        res.json({ ...execution.response, terminalArtifact: { artifactId: version.artifactId, baseVersion: target.baseVersion, version: version.version, contentHash: version.contentHash } });
      } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : "Original reverse DCF result could not be retained." }); }
      return;
    }
    try { res.json(calculateReverseDcf(parsed.data)); }
    catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Reverse DCF failed." }); }
  });
}
