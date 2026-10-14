import crypto from "node:crypto";
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import {
  decisionArtifactApprovalBaseSchema,
  decisionArtifactApprovalLinkInputSchema,
  decisionArtifactApprovalLinkSchema,
  decisionArtifactContentSchema,
  type DecisionArtifactApprovalBaseInput,
  type DecisionArtifactApprovalInspection,
  type DecisionArtifactApprovalLink,
  type DecisionArtifactApprovalLinkInput,
  type DecisionArtifactApprovalOptions,
} from "@shared/artifactContracts";
import { modelAssuranceArtifactSchema } from "@shared/modelAssurance";
import {
  artifactInteractionReceipts, brainRuns, decisionApprovals, decisionCases, decisionReceiptVersions,
  projectArtifacts, projectArtifactVersions, projects, researchInvestigations,
  type DecisionApproval, type DecisionCase, type DecisionReceiptVersion, type ProjectArtifact,
} from "@shared/schema";
import { getDb, type DrizzleDb } from "./db";
import { getArtifact, getArtifactVersion } from "./artifactStore";
import { getProject } from "./projectStore";
import { criticalityForDecision, evaluateAssuranceArtifactForDecision } from "./decisionAssuranceGate";
import { decisionSnapshotHash } from "./decisionEngine";
import { appendLedgerEventInTransaction, hashLedgerValue } from "./ledgerStore";
import type { TenantContext } from "./tenantContext";

type ReadDb = Pick<DrizzleDb, "select">;
const storedConfidenceSchema = z.object({ assurance: modelAssuranceArtifactSchema.nullable().optional() }).passthrough();
const storedLinkSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("link"), snapshot: decisionArtifactApprovalLinkSchema }).strict(),
  z.object({ operation: z.literal("unlink"), snapshot: z.null() }).strict(),
]);

export class DecisionObjectArtifactError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message); }
}
function missing(): never { throw new DecisionObjectArtifactError(404, "Owned decision or linked scope not found."); }
function stale(message: string): never { throw new DecisionObjectArtifactError(409, message); }
function sameOwner(ctx: TenantContext, row: { ownerUserId: number; organizationId: number | null }): boolean {
  return row.ownerUserId === ctx.userId && row.organizationId === ctx.organizationId;
}
function artifactScope(ctx: TenantContext, artifactId: string) {
  return and(eq(projectArtifacts.id, artifactId), eq(projectArtifacts.ownerUserId, ctx.userId),
    ctx.organizationId === null ? isNull(projectArtifacts.organizationId) : eq(projectArtifacts.organizationId, ctx.organizationId),
    isNull(projectArtifacts.trashedAt));
}

// Decision cases have no Project column. Linking is an explicit owner-selected reference
// from this owned Project's exact P4 version, not a claim of decision Project membership.
async function loadOwnedDecision(db: ReadDb, ctx: TenantContext, decisionId: number): Promise<DecisionCase> {
  const [decision] = await db.select().from(decisionCases).where(eq(decisionCases.id, decisionId)).limit(1);
  if (!decision || !sameOwner(ctx, decision)) return missing();
  const investigation = decision.investigationId === null ? null : (await db.select().from(researchInvestigations)
    .where(eq(researchInvestigations.id, decision.investigationId)).limit(1))[0];
  const brainRun = decision.brainRunId === null ? null : (await db.select().from(brainRuns)
    .where(eq(brainRuns.id, decision.brainRunId)).limit(1))[0];
  if ((decision.investigationId !== null && (!investigation || !sameOwner(ctx, investigation)))
    || (decision.brainRunId !== null && (!brainRun || !sameOwner(ctx, brainRun)))) return missing();
  if (brainRun?.investigationId && brainRun.investigationId !== investigation?.id) return missing();
  return decision;
}

async function loadReceiptAuthority(db: ReadDb, decision: DecisionCase, receiptVersionId: number) {
  const [receipt] = await db.select().from(decisionReceiptVersions).where(and(
    eq(decisionReceiptVersions.decisionId, decision.id), eq(decisionReceiptVersions.id, receiptVersionId),
  )).limit(1);
  const [latestReceipt] = await db.select({ id: decisionReceiptVersions.id }).from(decisionReceiptVersions)
    .where(eq(decisionReceiptVersions.decisionId, decision.id)).orderBy(desc(decisionReceiptVersions.version)).limit(1);
  // Approval rows, not authored Artifact fields, are the only review authority.
  const [approval] = await db.select().from(decisionApprovals).where(eq(decisionApprovals.decisionId, decision.id))
    .orderBy(desc(decisionApprovals.createdAt), desc(decisionApprovals.id)).limit(1);
  return { receipt: receipt ?? null, approval: approval ?? null, latestReceiptId: latestReceipt?.id ?? null };
}

export function decisionReceiptApprovalProblem(
  decision: DecisionCase, receipt: DecisionReceiptVersion | null, approval: DecisionApproval | null,
  latestReceiptId: number | null, now = new Date(),
): string | null {
  if (!receipt || receipt.decisionId !== decision.id) return "Decision receipt is unavailable.";
  const { id: _id, snapshotHash: _hash, createdAt: _createdAt, ...payload } = receipt;
  if (decisionSnapshotHash(payload) !== receipt.snapshotHash) return "Canonical decision receipt hash verification failed.";
  if (latestReceiptId !== receipt.id) return "Decision receipt is no longer the latest reviewed version.";
  if (decision.status !== "approved" || decision.approvedReceiptVersionId !== receipt.id) return "Decision case no longer approves this exact receipt.";
  if (decision.expiresAt && decision.expiresAt.getTime() <= now.getTime()) return "Decision case approval has expired.";
  if (!approval || approval.decisionId !== decision.id || approval.receiptVersionId !== receipt.id
    || approval.snapshotHash !== receipt.snapshotHash || !["approved", "waived"].includes(approval.outcome)) {
    return "Current canonical approval does not approve this exact receipt hash.";
  }
  if (approval.outcome === "approved" && receipt.completeness.complete !== true) return "Canonical receipt is incomplete.";
  if (approval.outcome === "waived" && !approval.waiverReason?.trim()) return "Canonical approval waiver has no documented reason.";
  const confidence = storedConfidenceSchema.safeParse(receipt.confidence);
  if (!confidence.success) return "Canonical receipt confidence metadata is invalid.";
  const criticality = criticalityForDecision(decision.materiality, decision.organizationId);
  const gate = evaluateAssuranceArtifactForDecision(confidence.data.assurance ?? null, criticality, now.toISOString());
  if (!gate.permitted && (approval.outcome === "approved" || criticality === "material_decision")) {
    return "Current canonical receipt assurance does not permit this approval.";
  }
  return null;
}

async function loadArtifactBody(ctx: TenantContext, artifactId: string, requestedVersion?: number) {
  const artifact = await getArtifact(ctx, artifactId);
  if (artifact.kind !== "decision" || !sameOwner(ctx, artifact)) throw new DecisionObjectArtifactError(400, "Decision approval links require an owned decision Artifact.");
  await getProject(ctx, artifact.projectId);
  const version = await getArtifactVersion(ctx, artifact.id, requestedVersion);
  const content = decisionArtifactContentSchema.parse(version.content);
  // New authored fields are optional so historical content bytes and hashes stay exact.
  if (hashLedgerValue(version.content) !== version.contentHash) return stale("Artifact body hash verification failed.");
  return { artifact, version, content };
}

async function recordedLink(db: ReadDb, ctx: TenantContext, artifact: ProjectArtifact, version: number) {
  const rows = await db.select().from(artifactInteractionReceipts).where(and(
    eq(artifactInteractionReceipts.artifactId, artifact.id), eq(artifactInteractionReceipts.action, "reference"),
    eq(artifactInteractionReceipts.actorType, "system"), eq(artifactInteractionReceipts.createdByUserId, ctx.userId),
    lte(artifactInteractionReceipts.toVersion, version),
  )).orderBy(desc(artifactInteractionReceipts.createdAt), desc(artifactInteractionReceipts.id));
  for (const row of rows) {
    if (!Object.hasOwn(row.detail, "decisionApprovalLink")) continue;
    const parsed = storedLinkSchema.safeParse(row.detail.decisionApprovalLink);
    if (!parsed.success || row.fromVersion !== row.toVersion) return { invalid: true as const, snapshot: null, createdAt: row.createdAt };
    const snapshot = parsed.data.snapshot;
    if (snapshot && (snapshot.artifactVersion !== row.toVersion || snapshot.projectId !== artifact.projectId || snapshot.linkedAt !== row.createdAt.toISOString())) {
      return { invalid: true as const, snapshot: null, createdAt: row.createdAt };
    }
    return { invalid: false as const, snapshot, createdAt: row.createdAt };
  }
  return { invalid: false as const, snapshot: null, createdAt: null };
}

export async function getDecisionObjectArtifactApprovalLinkSnapshot(ctx: TenantContext, artifactId: string, version?: number): Promise<DecisionArtifactApprovalLink | null> {
  const body = await loadArtifactBody(ctx, artifactId, version);
  const recorded = await recordedLink(getDb(), ctx, body.artifact, body.version.version);
  return recorded.invalid ? null : recorded.snapshot;
}

export async function getDecisionObjectArtifactApproval(ctx: TenantContext, artifactId: string, requestedVersion?: number): Promise<DecisionArtifactApprovalInspection> {
  const { artifact, version, content } = await loadArtifactBody(ctx, artifactId, requestedVersion);
  const recorded = await recordedLink(getDb(), ctx, artifact, version.version);
  const result: DecisionArtifactApprovalInspection = {
    artifactId, approvalScope: "linked_receipt_only", version: version.version, contentHash: version.contentHash,
    state: "unlinked", reason: null, link: recorded.snapshot, currentApproval: null,
  };
  if (recorded.invalid) return { ...result, state: "unavailable", reason: "Recorded P4 approval linkage metadata is invalid." };
  const link = recorded.snapshot;
  if (!link) return result;
  if (link.artifactContentHash !== version.contentHash) return { ...result, state: "stale", reason: "Decision Artifact body changed after this approval reference was linked." };
  const [boundVersion] = await getDb().select().from(projectArtifactVersions).where(and(
    eq(projectArtifactVersions.artifactId, artifactId), eq(projectArtifactVersions.version, link.artifactVersion),
  )).limit(1);
  if (!boundVersion || boundVersion.contentHash !== link.artifactContentHash
    || hashLedgerValue(boundVersion.content) !== boundVersion.contentHash
    || hashLedgerValue(boundVersion.sourceRefs) !== hashLedgerValue(version.sourceRefs)) {
    return { ...result, state: "stale", reason: "Bound P4 body or evidence source references no longer match." };
  }
  if (content.caseRef != null && content.caseRef !== `decision:${link.decisionId}`) return { ...result, state: "stale", reason: "Authored case reference no longer matches the linked decision." };
  try {
    const decision = await loadOwnedDecision(getDb(), ctx, link.decisionId);
    const authority = await loadReceiptAuthority(getDb(), decision, link.receiptVersionId);
    const problem = decisionReceiptApprovalProblem(decision, authority.receipt, authority.approval, authority.latestReceiptId);
    if (problem) return { ...result, state: "stale", reason: problem };
    if (!authority.receipt || !authority.approval || authority.receipt.version !== link.receiptVersion
      || authority.receipt.snapshotHash !== link.receiptHash || authority.approval.id !== link.serverApprovalId
      || authority.approval.outcome !== link.outcome || authority.approval.reviewerUserId !== link.reviewerUserId
      || authority.approval.createdAt.toISOString() !== link.approvedAt) {
      return { ...result, state: "stale", reason: "Canonical receipt or review changed after this reference was linked." };
    }
    return { ...result, state: link.outcome, currentApproval: link };
  } catch (error) {
    if (error instanceof DecisionObjectArtifactError && error.status === 404) return { ...result, state: "unavailable", reason: "Linked decision is no longer available in the requesting owner's organization scope." };
    throw error;
  }
}

export async function listDecisionObjectArtifactApprovalOptions(ctx: TenantContext, artifactId: string, version?: number): Promise<DecisionArtifactApprovalOptions> {
  await loadArtifactBody(ctx, artifactId, version);
  const db = getDb();
  const cases = await db.select().from(decisionCases).where(and(eq(decisionCases.ownerUserId, ctx.userId),
    ctx.organizationId === null ? isNull(decisionCases.organizationId) : eq(decisionCases.organizationId, ctx.organizationId),
  )).orderBy(desc(decisionCases.updatedAt), desc(decisionCases.id)).limit(200);
  const result: DecisionArtifactApprovalOptions = { cases: [] };
  for (const item of cases) {
    try { await loadOwnedDecision(db, ctx, item.id); } catch (error) {
      if (error instanceof DecisionObjectArtifactError && error.status === 404) continue;
      throw error;
    }
    const receipts = await db.select().from(decisionReceiptVersions).where(eq(decisionReceiptVersions.decisionId, item.id))
      .orderBy(desc(decisionReceiptVersions.version));
    const [approval] = await db.select().from(decisionApprovals).where(eq(decisionApprovals.decisionId, item.id))
      .orderBy(desc(decisionApprovals.createdAt), desc(decisionApprovals.id)).limit(1);
    result.cases.push({ id: item.id, title: item.title, status: item.status, receipts: receipts.map(receipt => {
      const reason = decisionReceiptApprovalProblem(item, receipt, approval ?? null, receipts[0]?.id ?? null);
      return { id: receipt.id, version: receipt.version, snapshotHash: receipt.snapshotHash, recommendation: receipt.recommendation, eligible: reason === null, reason };
    }) });
  }
  return result;
}

async function writeLinkOperation(ctx: TenantContext, artifactId: string, base: DecisionArtifactApprovalBaseInput, request: DecisionArtifactApprovalLinkInput | null) {
  await loadArtifactBody(ctx, artifactId, base.baseVersion);
  await getDb().transaction(async tx => {
    // Serialize metadata mutations against P4 edits and each other without creating
    // another content store or pretending that linking performs reviewer approval.
    const [artifact] = await tx.select().from(projectArtifacts).where(artifactScope(ctx, artifactId)).limit(1).for("update");
    if (!artifact) return missing();
    const [project] = await tx.select().from(projects).where(eq(projects.id, artifact.projectId)).limit(1).for("share");
    if (!project || !sameOwner(ctx, project)) return missing();
    if (artifact.kind !== "decision" || artifact.headVersion !== base.baseVersion) return stale("Artifact head moved; inspect the current decision body before linking.");
    const [version] = await tx.select().from(projectArtifactVersions).where(and(eq(projectArtifactVersions.artifactId, artifactId), eq(projectArtifactVersions.version, base.baseVersion))).limit(1);
    if (!version || version.contentHash !== base.baseHash || hashLedgerValue(version.content) !== base.baseHash) return stale("Artifact base hash is stale or invalid.");
    const content = decisionArtifactContentSchema.parse(version.content);
    let snapshot: DecisionArtifactApprovalLink | null = null;
    const recorded = await recordedLink(tx, ctx, artifact, base.baseVersion);
    // Millisecond dates have ties; under the Artifact lock, advance the immutable
    // linkage clock beyond the preceding linkage receipt for deterministic replay.
    const linkedAt = new Date(Math.max(Date.now(), (recorded.createdAt?.getTime() ?? 0) + 1));
    if (request) {
      const [lockedCase] = await tx.select().from(decisionCases).where(eq(decisionCases.id, request.decisionId)).limit(1).for("share");
      if (!lockedCase || !sameOwner(ctx, lockedCase)) return missing();
      const decision = await loadOwnedDecision(tx, ctx, request.decisionId);
      const authority = await loadReceiptAuthority(tx, decision, request.receiptVersionId);
      const problem = decisionReceiptApprovalProblem(decision, authority.receipt, authority.approval, authority.latestReceiptId, linkedAt);
      if (problem) return stale(problem);
      if (!authority.receipt || !authority.approval || authority.receipt.snapshotHash !== request.receiptHash) return stale("Selected decision receipt hash is stale.");
      if (content.caseRef != null && content.caseRef !== `decision:${decision.id}`) return stale("Authored case reference differs from the selected existing decision.");
      snapshot = decisionArtifactApprovalLinkSchema.parse({
        decisionId: decision.id, receiptVersionId: authority.receipt.id, receiptVersion: authority.receipt.version,
        receiptHash: authority.receipt.snapshotHash, serverApprovalId: authority.approval.id, outcome: authority.approval.outcome,
        reviewerUserId: authority.approval.reviewerUserId, approvedAt: authority.approval.createdAt.toISOString(),
        linkedAt: linkedAt.toISOString(), artifactVersion: version.version, artifactContentHash: version.contentHash, projectId: artifact.projectId,
      });
    }
    const operation = request ? "link" : "unlink";
    const detail = { decisionApprovalLink: { operation, snapshot } };
    await tx.insert(artifactInteractionReceipts).values({
      id: `artifact-interaction:${crypto.randomUUID()}`, artifactId, action: "reference", actorType: "system",
      fromVersion: version.version, toVersion: version.version, detail, createdByUserId: ctx.userId, createdAt: linkedAt,
    });
    await tx.update(projectArtifacts).set({ updatedAt: linkedAt }).where(artifactScope(ctx, artifactId));
    const artifactRef = `${artifactId}@v${version.version}`;
    const receiptRef = snapshot ? `decision:${snapshot.decisionId}:receipt:${snapshot.receiptVersionId}` : null;
    await appendLedgerEventInTransaction(tx, ctx, {
      projectId: artifact.projectId, eventType: "artifact.reference.created", actorType: "user",
      payload: { artifactId, version: version.version, contentHash: version.contentHash, ...detail },
      lineage: {
        nodes: [{ kind: "artifact", ref: artifactRef, version: String(version.version), hash: version.contentHash, asOf: null, metadata: {} },
          ...(snapshot && receiptRef ? [{ kind: "source" as const, ref: receiptRef, version: String(snapshot.receiptVersion), hash: snapshot.receiptHash, asOf: snapshot.approvedAt, metadata: { serverApprovalId: snapshot.serverApprovalId } }] : [])],
        edges: receiptRef ? [{ from: receiptRef, to: artifactRef, relation: "used" }] : [],
      },
    });
  });
  return getDecisionObjectArtifactApproval(ctx, artifactId);
}

export async function linkDecisionObjectArtifactApproval(ctx: TenantContext, artifactId: string, raw: DecisionArtifactApprovalLinkInput): Promise<DecisionArtifactApprovalInspection> {
  const request = decisionArtifactApprovalLinkInputSchema.parse(raw);
  return writeLinkOperation(ctx, artifactId, request, request);
}
export async function unlinkDecisionObjectArtifactApproval(ctx: TenantContext, artifactId: string, raw: DecisionArtifactApprovalBaseInput): Promise<DecisionArtifactApprovalInspection> {
  return writeLinkOperation(ctx, artifactId, decisionArtifactApprovalBaseSchema.parse(raw), null);
}
