import crypto from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, isNull, isNotNull } from "drizzle-orm";
import {
  artifactInteractionReceipts,
  projectArtifactProposals,
  projectArtifactReferences,
  projectArtifactVersions,
  projectArtifacts,
  projects,
  projectChats,
  projectResources,
  projectSessions,
  type ProjectArtifact,
  type ProjectArtifactProposal,
  type ProjectArtifactReference,
  type ProjectArtifactVersion,
} from "@shared/schema";
import {
  artifactActionSchema,
  artifactContentSchema,
  artifactKindSchema,
  artifactOriginSchema,
  artifactReferenceTypeSchema,
  artifactRefreshSpecSchema,
  type ArtifactAction,
  type ArtifactContent,
  type ArtifactOrigin,
  type ArtifactRefreshSpec,
  type ArtifactReferenceType,
  type SpreadsheetCellDiff,
} from "@shared/artifactContracts";
import type { ConversationArtifactDraft } from "@shared/conversationRuntime";
import { trustManifestSchema, type TrustManifest } from "@shared/trustContracts";
import { projectWorkspaceSessionStateSchema } from "@shared/projectContracts";
import { defaultArtifactAdapterId } from "@shared/artifactAdapterRegistry";
import { guardSpreadsheetCellLineage, type SpreadsheetContent } from "@shared/spreadsheetCellLineage";
import type { TenantContext } from "./tenantContext";
import type { ArtifactModelMaintenanceReview } from "@shared/artifactModelMaintenance";
import type { ArtifactIntegratedModelReview } from "./artifactIntegratedModelInput";
import { loadArtifactIntegratedModelReview } from "./artifactIntegratedModelInput";

export type ArtifactReadContext = Pick<TenantContext, "userId" | "organizationId">;

export interface CreatedArtifact {
  artifact: ProjectArtifact;
  version: ProjectArtifactVersion;
}
import { getDb, type DrizzleDb } from "./db";
import { getProject } from "./projectStore";
import { appendLedgerEventInTransaction, hashLedgerValue, sanitizeLedgerPayload } from "./ledgerStore";
import { loadIntegratedModelArtifactSource } from "./integratedModelArtifact";
import { mergeMaintainedWorkbook } from "./artifactModelMaintenance";
import { applyArtifactPatch, applySpreadsheetDiffs, compareArtifactContents, normalizeConversationDraft } from "./artifactDiff";

const SECRET_KEY = /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|authorization|cookie|private[_-]?key)/i;
const SECRET_REF = /(?:[?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|key|secret|password)=|\b(?:authorization|bearer)\s*[:= ]\s*\S+)/i;
const SECRET_REPLAY_TEXT = /(?:\b(?:api[_\s-]?key|access[_\s-]?token|refresh[_\s-]?token|password|private[_\s-]?key)\b\s*[:=]\s*\S{8,}|\bbearer\s+\S{8,})/i;

function tenantOrgClause(column: any, ctx: ArtifactReadContext) {
  return ctx.organizationId === null ? isNull(column) : eq(column, ctx.organizationId);
}

function artifactTenantFilter(ctx: ArtifactReadContext, artifactId?: string) {
  return and(
    eq(projectArtifacts.ownerUserId, ctx.userId),
    tenantOrgClause(projectArtifacts.organizationId, ctx),
    ...(artifactId ? [eq(projectArtifacts.id, artifactId)] : []),
  );
}

export function assertArtifactContentSafe(value: unknown, path = "content", depth = 0, decisionBody = false): void {
  if (depth > 30) throw new Error("Artifact content exceeds the maximum nesting depth.");
  if (!value || typeof value !== "object") return;
  decisionBody ||= "kind" in value && value.kind === "decision";
  if (depth === 0 && "kind" in value && value.kind === "spreadsheet") {
    const content = artifactContentSchema.parse(value);
    if (content.kind === "spreadsheet") for (const sheet of content.sheets) for (const cell of Object.values(sheet.cells)) {
      if (cell.lineage) assertArtifactRefsSafe(cell.lineage.sourceRefs, "cell lineage sourceRefs");
    }
  }
  if (depth === 0 && "kind" in value && value.kind === "table") {
    const content = artifactContentSchema.parse(value);
    if (content.kind === "table") for (const evidence of content.numericalEvidence ?? []) {
      const first = evidence.transformations[0];
      const last = evidence.transformations.at(-1)!;
      const digest = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
      if (first.inputHash !== digest(evidence.rawValue) || last.outputHash !== digest(evidence.normalizedValue)) {
        throw new Error("Numerical evidence hashes do not match the exact source and output values.");
      }
    }
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertArtifactContentSafe(item, `${path}[${index}]`, depth + 1, decisionBody));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) throw new Error(`Artifact content must not contain credential-shaped field "${path}.${key}".`);
    if (decisionBody && /^(?:approval|approvalStatus|decisionApprovalLink|serverApprovalId|approvedReceiptVersionId|reviewerUserId)$/i.test(key)) {
      throw new Error("Decision Artifact approval authority is server-derived linkage metadata, never authored content.");
    }
    assertArtifactContentSafe(nested, `${path}.${key}`, depth + 1, decisionBody);
  }
}

export function assertArtifactRefsSafe(refs: readonly string[], label = "sourceRefs"): void {
  for (const ref of refs) {
    if (SECRET_REF.test(ref)) throw new Error(`${label} must not contain credential-bearing references.`);
  }
}

export function artifactTrustSourceRefs(manifest: TrustManifest | null | undefined): string[] {
  if (!manifest) return [];
  return [...new Set([
    ...manifest.evidence.map((item) => item.sourceRef),
    ...manifest.claims.flatMap((item) => item.sourceRefs),
    ...manifest.conflicts.flatMap((item) => item.sourceRefs),
    ...manifest.methodology.flatMap((item) => item.sourceRefs),
  ])];
}

export function assertArtifactTrustSafe(manifest: TrustManifest): void {
  assertArtifactContentSafe(manifest, "trustManifest");
  assertArtifactRefsSafe(artifactTrustSourceRefs(manifest), "trustManifest source refs");
}

export function assertArtifactRefreshSpecSafe(spec: ArtifactRefreshSpec): void {
  assertArtifactContentSafe(spec, "refreshSpec");
  if (spec.message && SECRET_REPLAY_TEXT.test(spec.message)) {
    throw new Error("Artifact replay metadata must not contain credential-bearing text.");
  }
}

function resolveArtifactDependencyRefs(
  explicitRefs: readonly string[] | undefined,
  trustManifest: TrustManifest | null,
): string[] {
  const refs = [...new Set([...(explicitRefs ?? []), ...artifactTrustSourceRefs(trustManifest)])];
  assertArtifactRefsSafe(refs, "dependencyRefs");
  return refs;
}

function contentHash(content: ArtifactContent): string {
  return hashLedgerValue(content);
}

async function validateArtifactProject(ctx: TenantContext, projectId: number): Promise<void> {
  await getProject(ctx, projectId);
}

/** A retained Artifact belongs to a real Project or a real persistent Chat, never an invented Project. */
async function validateArtifactOwner(ctx: ArtifactReadContext, input: { projectId: number | null; owningChatId?: number | null }, db: Pick<DrizzleDb, "select"> = getDb()): Promise<void> {
  if (input.owningChatId != null) {
    const [chat] = await db.select().from(projectChats).where(and(
      eq(projectChats.id, input.owningChatId),
      eq(projectChats.ownerUserId, ctx.userId),
      tenantOrgClause(projectChats.organizationId, ctx),
      isNull(projectChats.trashedAt),
    )).limit(1).for("share");
    if (!chat || chat.projectId !== input.projectId
      || (input.projectId === null && chat.scope !== "quick")) throw new Error("Artifact owning Chat not found or not owned within this ownership boundary.");
  } else if (input.projectId === null) {
    throw new Error("A persistent Chat is required for an Artifact without a Project.");
  }
  if (input.projectId !== null) {
    const [project] = await db.select().from(projects).where(and(
      eq(projects.id, input.projectId), eq(projects.ownerUserId, ctx.userId),
      tenantOrgClause(projects.organizationId, ctx), isNull(projects.trashedAt),
    )).limit(1).for("share");
    if (!project) throw new Error("Artifact Project not found or not owned within this ownership boundary.");
  }
}

function artifactScopeClause(column: typeof projectArtifacts.projectId | typeof projectArtifacts.owningChatId | typeof projectArtifactReferences.projectId, value: number | null) {
  return value === null ? isNull(column) : eq(column, value);
}

async function insertInteractionReceipt(
  tx: any,
  ctx: TenantContext,
  input: {
    artifactId: string;
    action: ArtifactAction;
    actorType: "user" | "conversation" | "system";
    fromVersion?: number | null;
    toVersion?: number | null;
    requestId?: string | null;
    detail?: Record<string, unknown>;
  },
) {
  if (input.detail && Object.hasOwn(input.detail, "decisionApprovalLink")) {
    throw new Error("Decision approval linkage requires the dedicated server-verified existing receipt link operation.");
  }
  const id = crypto.randomUUID();
  const [row] = await tx.insert(artifactInteractionReceipts).values({
    id,
    artifactId: input.artifactId,
    action: artifactActionSchema.parse(input.action),
    actorType: input.actorType,
    fromVersion: input.fromVersion ?? null,
    toVersion: input.toVersion ?? null,
    requestId: input.requestId ?? null,
    detail: sanitizeLedgerPayload(input.detail ?? {}) as Record<string, unknown>,
    createdByUserId: ctx.userId,
  }).returning();
  return row;
}

export function assertResearchClaimRefsSafe(content: ArtifactContent): void {
  if (content.kind !== "research") return;
  assertArtifactRefsSafe(content.claims.flatMap((claim) => claim.sourceRefs), "research claim sourceRefs");
}

export function researchEvidenceLedgerProjection(
  content: ArtifactContent,
  artifactRef: string,
): { payload: Record<string, unknown>; nodes: any[]; edges: any[] } {
  if (content.kind !== "research") return { payload: {}, nodes: [], edges: [] };

  const quoteBlocks = content.blocks.filter((block) => block.type === "quote");
  const entries = content.evidence.map((evidence) => {
    const quote = quoteBlocks.find((block) => block.attrs.evidenceId === evidence.id)
      ?? quoteBlocks.find((block) => block.attrs.evidenceId === undefined
        && block.attrs.sourceRef === evidence.sourceRef
        && block.text === evidence.snippet)
      ?? (quoteBlocks.filter((block) => block.attrs.sourceRef === evidence.sourceRef).length === 1
        ? quoteBlocks.find((block) => block.attrs.sourceRef === evidence.sourceRef)
        : undefined);
    const attrs = (quote?.attrs ?? {}) as Record<string, unknown>;
    const provenance = attrs.provenance && typeof attrs.provenance === "object" && !Array.isArray(attrs.provenance)
      ? attrs.provenance as Record<string, unknown>
      : {};
    const truth = attrs.truth && typeof attrs.truth === "object" && !Array.isArray(attrs.truth)
      ? attrs.truth as Record<string, unknown>
      : {};
    const temporal = truth.temporal && typeof truth.temporal === "object" && !Array.isArray(truth.temporal)
      ? truth.temporal as Record<string, unknown>
      : {};
    const contentHashValue = typeof attrs.contentHash === "string" && /^[a-f0-9]{64}$/.test(attrs.contentHash)
      ? attrs.contentHash
      : null;
    const excerptHash = hashLedgerValue(evidence.snippet);
    const evidenceRef = `${artifactRef}#evidence:${evidence.id}`;
    const clocks = {
      observedAt: evidence.observedAt ?? null,
      retrievedAt: typeof provenance.retrievedAt === "string" ? provenance.retrievedAt : null,
      publishedAt: typeof provenance.publishedAt === "string" ? provenance.publishedAt : null,
      effectiveAt: typeof provenance.effectiveAt === "string" ? provenance.effectiveAt : null,
      asOfBasis: typeof temporal.asOfBasis === "string" ? temporal.asOfBasis : "unknown",
      modelPeriod: typeof temporal.modelPeriod === "string" ? temporal.modelPeriod : null,
    };
    const transformation = {
      evidenceKind: typeof provenance.evidenceKind === "string" ? provenance.evidenceKind : null,
      extraction: provenance.extraction ?? null,
      extractionCompleteness: typeof provenance.extractionCompleteness === "string" ? provenance.extractionCompleteness : null,
      acquisitionRef: typeof provenance.acquisitionRef === "string" ? provenance.acquisitionRef : null,
      acquisitionOutputHash: typeof provenance.acquisitionOutputHash === "string" ? provenance.acquisitionOutputHash : null,
    };
    const sourceQuality = truth.sourceQuality && typeof truth.sourceQuality === "object" && !Array.isArray(truth.sourceQuality)
      ? truth.sourceQuality as Record<string, unknown>
      : { tier: "unknown", claimVerification: "not_verified_by_digest" };
    return {
      evidenceRef,
      evidenceId: evidence.id,
      sourceRef: evidence.sourceRef,
      quoteBlockId: quote?.id ?? null,
      excerptHash,
      sourceContentHash: contentHashValue,
      clocks,
      transformation,
      sourceQuality,
    };
  });

  const nodes: any[] = [];
  const edges: any[] = [];
  const evidenceRefsBySource = new Map<string, string[]>();
  for (const entry of entries) {
    nodes.push({
      kind: "evidence",
      ref: entry.evidenceRef,
      version: null,
      hash: entry.sourceContentHash ?? entry.excerptHash,
      asOf: entry.clocks.effectiveAt ?? entry.clocks.publishedAt ?? entry.clocks.observedAt ?? entry.clocks.retrievedAt,
      metadata: {
        evidenceId: entry.evidenceId,
        sourceRef: entry.sourceRef,
        quoteBlockId: entry.quoteBlockId,
        excerptHash: entry.excerptHash,
        sourceContentHash: entry.sourceContentHash,
        clocks: entry.clocks,
        transformation: entry.transformation,
        sourceQuality: entry.sourceQuality,
      },
    });
    edges.push({ from: entry.sourceRef, to: entry.evidenceRef, relation: "produced" });
    edges.push({ from: entry.evidenceRef, to: artifactRef, relation: "used" });
    const refs = evidenceRefsBySource.get(entry.sourceRef) ?? [];
    refs.push(entry.evidenceRef);
    evidenceRefsBySource.set(entry.sourceRef, refs);
  }

  const claimEntries = content.claims.map((claim) => {
    const claimRef = `${artifactRef}#claim:${claim.id}`;
    const statementHash = hashLedgerValue(claim.text);
    const sourceRefs = [...new Set(claim.sourceRefs)];
    const relation = claim.provenance === "source_backed" ? "supports" : "derived_from";
    nodes.push({
      kind: "claim",
      ref: claimRef,
      version: null,
      hash: statementHash,
      asOf: null,
      metadata: {
        claimId: claim.id,
        statementHash,
        declaredProvenance: claim.provenance,
        sourceRefs,
        traceability: sourceRefs.length ? "source_linked" : "unattributed",
      },
    });

    for (const sourceRef of sourceRefs) {
      const evidenceRefs = evidenceRefsBySource.get(sourceRef) ?? [];
      if (evidenceRefs.length) {
        for (const evidenceRef of evidenceRefs) edges.push({ from: evidenceRef, to: claimRef, relation });
      } else {
        nodes.push({ kind: "source", ref: sourceRef, version: null, hash: null, asOf: null, metadata: {} });
        edges.push({ from: sourceRef, to: claimRef, relation });
      }
    }
    edges.push({ from: claimRef, to: artifactRef, relation: "used" });
    return {
      claimRef,
      claimId: claim.id,
      statementHash,
      declaredProvenance: claim.provenance,
      sourceRefs,
      traceability: sourceRefs.length ? "source_linked" : "unattributed",
      downstreamRef: artifactRef,
    };
  });

  return {
    payload: {
      evidenceLedger: entries.map((entry) => ({
        evidenceRef: entry.evidenceRef,
        evidenceId: entry.evidenceId,
        sourceRef: entry.sourceRef,
        quoteBlockId: entry.quoteBlockId,
        excerptHash: entry.excerptHash,
        sourceContentHash: entry.sourceContentHash,
        clocks: entry.clocks,
        transformation: entry.transformation,
        sourceQuality: entry.sourceQuality,
        downstreamRef: artifactRef,
      })),
      claimProvenance: claimEntries,
    },
    nodes,
    edges,
  };
}

export function numericalEvidenceLedgerProjection(content: ArtifactContent, artifactRef: string) {
  if (content.kind !== "table" || !content.numericalEvidence?.length) return { payload: {}, nodes: [], edges: [] };
  const entries = content.numericalEvidence.map(evidence => ({
    evidenceRef: `${artifactRef}#numeric:${evidence.id}`,
    sourceRef: evidence.source.sourceRef,
    sourceContentHash: evidence.source.contentHash,
    sourceField: evidence.source.field,
    period: evidence.source.period,
    unit: evidence.source.unit,
    currency: evidence.source.currency,
    sourceAnchor: {
      tableRef: evidence.source.tableRef,
      row: evidence.source.row,
      column: evidence.source.column,
      pageNumber: evidence.source.pageNumber,
      lineRange: evidence.source.lineRange,
    },
    provider: evidence.source.provider,
    receiptRef: evidence.source.receiptRef,
    transformations: evidence.transformations,
    unknowns: evidence.unknowns,
    downstreamRef: `${artifactRef}#cell:${evidence.target.row}:${evidence.target.column}`,
  }));
  return {
    payload: { numericalEvidenceLedger: entries },
    nodes: entries.map(entry => ({
      kind: "evidence",
      ref: entry.evidenceRef,
      version: null,
      hash: entry.transformations.at(-1)!.outputHash,
      asOf: null,
      metadata: entry,
    })),
    edges: entries.flatMap(entry => [
      { from: entry.sourceRef, to: entry.evidenceRef, relation: "derived_from" },
      { from: entry.evidenceRef, to: artifactRef, relation: "used" },
    ]),
  };
}

async function ledgerArtifactEvent(
  tx: any,
  ctx: TenantContext,
  input: {
    projectId: number | null;
    eventType: "artifact.created" | "artifact.versioned" | "artifact.forked" | "artifact.reference.created" | "artifact.proposal.created" | "artifact.proposal.accepted" | "artifact.proposal.rejected" | "artifact.action" | "artifact.exported" | "artifact.imported";
    artifactId: string;
    version?: number | null;
    contentHash?: string | null;
    actorType?: "user" | "system" | "engine" | "ai";
    requestId?: string | null;
    payload?: Record<string, unknown>;
    sourceRefs?: string[];
    parentArtifactRef?: string | null;
    content?: ArtifactContent;
  },
) {
  const artifactRef = input.version ? `${input.artifactId}@v${input.version}` : input.artifactId;
  const nodes: any[] = [{
    kind: "artifact",
    ref: artifactRef,
    version: input.version ? String(input.version) : null,
    hash: input.contentHash ?? null,
    asOf: null,
    metadata: {},
  }];
  const edges: any[] = [];
  for (const ref of input.sourceRefs ?? []) {
    nodes.push({ kind: "source", ref, version: null, hash: null, asOf: null, metadata: {} });
    edges.push({ from: ref, to: artifactRef, relation: "used" });
  }
  if (input.parentArtifactRef) {
    nodes.push({ kind: "artifact", ref: input.parentArtifactRef, version: null, hash: null, asOf: null, metadata: {} });
    edges.push({ from: input.parentArtifactRef, to: artifactRef, relation: "forked_from" });
  }
  const evidenceProjection = input.content
    ? researchEvidenceLedgerProjection(input.content, artifactRef)
    : { payload: {}, nodes: [], edges: [] };
  nodes.push(...evidenceProjection.nodes);
  edges.push(...evidenceProjection.edges);
  const numericalProjection = input.content
    ? numericalEvidenceLedgerProjection(input.content, artifactRef)
    : { payload: {}, nodes: [], edges: [] };
  nodes.push(...numericalProjection.nodes);
  edges.push(...numericalProjection.edges);
  const lineageNodes = [...new Map(nodes.map((node) => [`${node.kind}\u0000${node.ref}`, node])).values()];
  const lineageEdges = [...new Map(edges.map((edge) => [`${edge.from}\u0000${edge.relation}\u0000${edge.to}`, edge])).values()];
  return appendLedgerEventInTransaction(tx, ctx, {
    projectId: input.projectId,
    chatId: input.projectId === null
      ? (await tx.select({ owningChatId: projectArtifacts.owningChatId }).from(projectArtifacts).where(eq(projectArtifacts.id, input.artifactId)).limit(1))[0]?.owningChatId ?? null
      : null,
    eventType: input.eventType,
    actorType: input.actorType ?? "user",
    requestId: input.requestId ?? null,
    payload: {
      artifactId: input.artifactId,
      version: input.version ?? null,
      ...(input.payload ?? {}),
      ...evidenceProjection.payload,
      ...numericalProjection.payload,
    },
    lineage: { nodes: lineageNodes, edges: lineageEdges },
  });
}

export async function getArtifactIncludingTrash(ctx: ArtifactReadContext, artifactId: string): Promise<ProjectArtifact> {
  const [artifact] = await getDb().select().from(projectArtifacts)
    .where(artifactTenantFilter(ctx, artifactId)).limit(1);
  if (!artifact) throw new Error("Artifact not found or not owned by the requesting user.");
  return artifact;
}

export async function getArtifact(ctx: ArtifactReadContext, artifactId: string): Promise<ProjectArtifact> {
  const artifact = await getArtifactIncludingTrash(ctx, artifactId);
  if (artifact.trashedAt) throw new Error("Artifact not found or not owned by the requesting user.");
  await validateArtifactOwner(ctx, artifact);
  return artifact;
}

export async function getArtifactVersion(
  ctx: ArtifactReadContext,
  artifactId: string,
  version?: number,
): Promise<ProjectArtifactVersion> {
  const artifact = await getArtifact(ctx, artifactId);
  const resolvedVersion = version ?? artifact.headVersion;
  const [row] = await getDb().select().from(projectArtifactVersions)
    .where(and(eq(projectArtifactVersions.artifactId, artifactId), eq(projectArtifactVersions.version, resolvedVersion)))
    .limit(1);
  if (!row) throw new Error("Artifact version not found.");
  artifactContentSchema.parse(row.content);
  return row;
}

export async function listProjectArtifacts(
  ctx: TenantContext,
  projectId: number,
  input: { status?: "active" | "archived"; trash?: boolean; kind?: string; limit?: number; offset?: number } = {},
): Promise<ProjectArtifact[]> {
  await validateArtifactProject(ctx, projectId);
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const offset = z.number().int().min(0).max(1_000_000).parse(input.offset ?? 0);
  const status = input.status ?? (input.trash ? "archived" : "active");
  const conditions = [
    artifactTenantFilter(ctx),
    eq(projectArtifacts.projectId, projectId),
    eq(projectArtifacts.status, status),
    input.trash ? isNotNull(projectArtifacts.trashedAt) : isNull(projectArtifacts.trashedAt),
    ...(input.kind ? [eq(projectArtifacts.kind, artifactKindSchema.parse(input.kind))] : []),
  ];
  return getDb().select().from(projectArtifacts).where(and(...conditions)).orderBy(desc(projectArtifacts.updatedAt), desc(projectArtifacts.id)).limit(limit).offset(offset);
}

export async function listChatArtifacts(
  ctx: TenantContext,
  chatId: number,
  input: { status?: "active" | "archived"; trash?: boolean; limit?: number } = {},
): Promise<ProjectArtifact[]> {
  const [chat] = await getDb().select().from(projectChats).where(and(
    eq(projectChats.id, chatId), eq(projectChats.ownerUserId, ctx.userId),
    tenantOrgClause(projectChats.organizationId, ctx), isNull(projectChats.trashedAt),
  )).limit(1);
  if (!chat) throw new Error("Artifact owning Chat not found or not owned within this ownership boundary.");
  await validateArtifactOwner(ctx, { projectId: chat.projectId, owningChatId: chatId });
  return getDb().select().from(projectArtifacts).where(and(
    artifactTenantFilter(ctx), eq(projectArtifacts.owningChatId, chatId),
    artifactScopeClause(projectArtifacts.projectId, chat.projectId),
    eq(projectArtifacts.status, input.status ?? (input.trash ? "archived" : "active")),
    input.trash ? isNotNull(projectArtifacts.trashedAt) : isNull(projectArtifacts.trashedAt),
  )).orderBy(desc(projectArtifacts.updatedAt)).limit(Math.min(Math.max(input.limit ?? 100, 1), 500));
}

export async function listOwnedArtifacts(
  ctx: TenantContext,
  input: { status?: "active" | "archived"; trash?: boolean; limit?: number } = {},
): Promise<ProjectArtifact[]> {
  const limit = Math.min(Math.max(input.limit ?? 500, 1), 500);
  const status = input.status ?? (input.trash ? "archived" : "active");
  return getDb().select().from(projectArtifacts).where(and(
    artifactTenantFilter(ctx),
    eq(projectArtifacts.status, status),
    input.trash ? isNotNull(projectArtifacts.trashedAt) : isNull(projectArtifacts.trashedAt),
  )).orderBy(desc(projectArtifacts.updatedAt)).limit(limit);
}

export async function listArtifactVersions(ctx: TenantContext, artifactId: string): Promise<ProjectArtifactVersion[]> {
  await getArtifact(ctx, artifactId);
  return getDb().select().from(projectArtifactVersions)
    .where(eq(projectArtifactVersions.artifactId, artifactId))
    .orderBy(desc(projectArtifactVersions.version));
}

/** Bounded native history discovery never loads retained work bodies merely to list version identities. */
export async function listArtifactVersionSummaries(ctx: TenantContext, artifactId: string, input: { offset: number; limit: number }) {
  await getArtifact(ctx, artifactId);
  const offset = z.number().int().min(0).max(1_000_000).parse(input.offset);
  const limit = z.number().int().min(1).max(101).parse(input.limit);
  return getDb().select({ version: projectArtifactVersions.version, contentHash: projectArtifactVersions.contentHash, createdAt: projectArtifactVersions.createdAt })
    .from(projectArtifactVersions).where(eq(projectArtifactVersions.artifactId, artifactId))
    .orderBy(desc(projectArtifactVersions.version)).limit(limit).offset(offset);
}

export async function listArtifactReferences(ctx: TenantContext, artifactId: string): Promise<ProjectArtifactReference[]> {
  const artifact = await getArtifact(ctx, artifactId);
  return getDb().select().from(projectArtifactReferences)
    .where(and(eq(projectArtifactReferences.artifactId, artifactId), artifactScopeClause(projectArtifactReferences.projectId, artifact.projectId)))
    .orderBy(desc(projectArtifactReferences.createdAt));
}

export async function listArtifactProposals(ctx: TenantContext, artifactId: string): Promise<ProjectArtifactProposal[]> {
  await getArtifact(ctx, artifactId);
  return getDb().select().from(projectArtifactProposals)
    .where(eq(projectArtifactProposals.artifactId, artifactId))
    .orderBy(desc(projectArtifactProposals.createdAt));
}

async function validateInitialSpreadsheetLineage(ctx: TenantContext, projectId: number | null, content: SpreadsheetContent, owningChatId?: number | null): Promise<void> {
  const runs = new Map<string, SpreadsheetContent>();
  for (const sheet of content.sheets) for (const [ref, cell] of Object.entries(sheet.cells)) {
    const lineage = cell.lineage;
    if (!lineage) continue;
    assertArtifactRefsSafe(lineage.sourceRefs, "cell lineage sourceRefs");
    if (lineage.custody !== "server_projection") {
      guardSpreadsheetCellLineage(null, { ...content, sheets: [{ ...sheet, cells: { [ref]: cell } }] });
      continue;
    }
    if (projectId === null && owningChatId == null) throw new Error("Server model projection lineage requires its owning persistent context.");
    if (!lineage.modelRunId) throw new Error("Verified cell lineage requires an owned persisted model run.");
    let projected = runs.get(lineage.modelRunId);
    if (!projected) {
      // The source module imports this store only for callable retention functions; neither side initializes a projection at module load.
      projected = (await loadIntegratedModelArtifactSource(ctx, lineage.modelRunId, projectId, false, owningChatId)).projection.content;
      runs.set(lineage.modelRunId, projected);
    }
    const sourceCell = projected.sheets.find(item => item.id === sheet.id)?.cells[ref];
    if (!sourceCell?.lineage || hashLedgerValue(sourceCell.lineage) !== hashLedgerValue(lineage)
      || cell.raw !== sourceCell.raw || cell.format !== sourceCell.format) {
      throw new Error("Cell lineage does not match the exact verified source/run projection.");
    }
  }
}

export async function createArtifact(
  ctx: TenantContext,
  input: {
    projectId: number | null;
    owningChatId?: number | null;
    title: string;
    content: ArtifactContent;
    origin?: ArtifactOrigin;
    adapterId?: string | null;
    sourceRefs?: string[];
    executionReceiptIds?: string[];
    assumptionRefs?: string[];
    trustManifest?: TrustManifest | null;
    dependencyRefs?: string[];
    refreshSpec?: ArtifactRefreshSpec | null;
    actorType?: "user" | "conversation" | "system";
    requestId?: string | null;
    note?: string | null;
  },
): Promise<CreatedArtifact> {
  return createArtifactRecord(ctx, input);
}

async function createArtifactRecord(
  ctx: TenantContext,
  input: Parameters<typeof createArtifact>[1],
  retention?: { artifactId: string; draftType: string },
): Promise<CreatedArtifact> {
  await validateArtifactOwner(ctx, input);
  // A Project takes lifecycle ownership; the originating Chat remains provenance, not a cascading parent.
  const owningChatId = input.projectId === null ? input.owningChatId ?? null : null;
  const content = artifactContentSchema.parse(input.content);
  if (content.kind === "spreadsheet") await validateInitialSpreadsheetLineage(ctx, input.projectId, content, owningChatId);
  assertArtifactContentSafe(content);
  assertResearchClaimRefsSafe(content);
  const origin = artifactOriginSchema.parse(input.origin ?? "direct");
  assertArtifactRefsSafe(input.sourceRefs ?? []);
  assertArtifactRefsSafe(input.dependencyRefs ?? [], "dependencyRefs");
  const trustManifest = input.trustManifest == null ? null : trustManifestSchema.parse(input.trustManifest);
  if (trustManifest) assertArtifactTrustSafe(trustManifest);
  const dependencyRefs = resolveArtifactDependencyRefs(input.dependencyRefs, trustManifest);
  const refreshSpec = input.refreshSpec == null ? null : artifactRefreshSpecSchema.parse(input.refreshSpec);
  if (refreshSpec) assertArtifactRefreshSpecSafe(refreshSpec);
  const id = retention?.artifactId ?? `artifact:${crypto.randomUUID()}`;
  const versionId = `artifact-version:${crypto.randomUUID()}`;
  const hash = contentHash(content);
  const adapterId = input.adapterId?.trim() || defaultArtifactAdapterId(content.kind);
  const retentionHash = retention ? hashLedgerValue({
    draftType: retention.draftType,
    title: input.title.trim(),
    contentHash: hash,
    sourceRefs: input.sourceRefs ?? [],
    executionReceiptIds: input.executionReceiptIds ?? [],
    trustManifest,
    dependencyRefs,
    refreshSpec,
  }) : null;
  const now = new Date();
  const db: any = getDb();
  return db.transaction(async (tx: any) => {
    await validateArtifactOwner(ctx, input, tx);
    let insertion = tx.insert(projectArtifacts).values({
      id,
      projectId: input.projectId,
      owningChatId,
      ownerUserId: ctx.userId,
      organizationId: ctx.organizationId,
      kind: content.kind,
      title: input.title.trim(),
      status: "active",
      origin,
      headVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    // The Artifact primary key arbitrates concurrent retention; losing calls write no versions or receipts.
    if (retention) insertion = insertion.onConflictDoNothing({ target: projectArtifacts.id });
    const [artifact] = await insertion.returning();
    if (!artifact) {
      const [existing] = await tx.select().from(projectArtifacts).where(and(
        artifactTenantFilter(ctx, id),
        artifactScopeClause(projectArtifacts.projectId, input.projectId),
        artifactScopeClause(projectArtifacts.owningChatId, owningChatId),
      )).limit(1);
      if (!existing) throw new Error("Retained Artifact not found or not owned by the requesting user.");
      const [receipt] = await tx.select().from(artifactInteractionReceipts).where(and(
        eq(artifactInteractionReceipts.artifactId, id),
        eq(artifactInteractionReceipts.action, "keep"),
        eq(artifactInteractionReceipts.actorType, "conversation"),
        eq(artifactInteractionReceipts.toVersion, 1),
        eq(artifactInteractionReceipts.createdByUserId, ctx.userId),
      )).limit(1);
      // Creation receipts are immutable, unlike the Artifact title or later head versions.
      if (!retention || receipt?.detail?.draftRetentionHash !== retentionHash) {
        throw new Error("Conversation draft retention key already contains different content.");
      }
      const [version] = await tx.select().from(projectArtifactVersions).where(and(
        eq(projectArtifactVersions.artifactId, id),
        eq(projectArtifactVersions.version, 1),
      )).limit(1);
      if (!version) throw new Error("Retained Artifact initial version not found.");
      return { artifact: existing, version };
    }
    const [version] = await tx.insert(projectArtifactVersions).values({
      id: versionId,
      artifactId: id,
      version: 1,
      parentVersionId: null,
      adapterId,
      content: content as unknown as Record<string, unknown>,
      contentHash: hash,
      sourceRefs: input.sourceRefs ?? [],
      executionReceiptIds: input.executionReceiptIds ?? [],
      assumptionRefs: input.assumptionRefs ?? [],
      trustManifest: trustManifest as unknown as Record<string, unknown> | null,
      dependencyRefs,
      refreshSpec: refreshSpec as unknown as Record<string, unknown> | null,
      note: input.note ?? null,
      createdByUserId: ctx.userId,
      createdAt: now,
    }).returning();
    await insertInteractionReceipt(tx, ctx, {
      artifactId: id,
      action: origin === "import" ? "import" : "keep",
      actorType: input.actorType ?? (origin === "import" ? "system" : "user"),
      toVersion: 1,
      requestId: input.requestId ?? null,
      detail: {
        origin,
        trustId: trustManifest?.trustId ?? null,
        dependencyCount: dependencyRefs.length,
        refreshKind: refreshSpec?.kind ?? null,
        ...(retention ? { draftRetentionHash: retentionHash } : {}),
      },
    });
    await ledgerArtifactEvent(tx, ctx, {
      projectId: input.projectId,
      eventType: origin === "import" ? "artifact.imported" : "artifact.created",
      artifactId: id,
      version: 1,
      contentHash: hash,
      actorType: input.actorType === "conversation" ? "system" : "user",
      requestId: input.requestId ?? null,
      sourceRefs: input.sourceRefs,
      content,
      payload: {
        kind: content.kind,
        title: input.title,
        adapterId,
        origin,
        trustId: trustManifest?.trustId ?? null,
        dependencyCount: dependencyRefs.length,
        refreshKind: refreshSpec?.kind ?? null,
        ...(retention ? { draftRetentionHash: retentionHash } : {}),
      },
    });
    return { artifact, version };
  });
}

export function retainedConversationArtifactId(ctx: TenantContext, projectId: number | null, requestId: string, draftId: string, owningChatId?: number | null): string {
  // Preserve existing Project replay IDs. Projectless identity includes its owning Chat.
  const identityHash = hashLedgerValue({ ownerUserId: ctx.userId, organizationId: ctx.organizationId, projectId, requestId, draftId, ...(projectId === null ? { owningChatId: owningChatId ?? null } : {}) });
  const variant = ((parseInt(identityHash[16], 16) & 3) | 8).toString(16);
  return `artifact:${identityHash.slice(0, 8)}-${identityHash.slice(8, 12)}-8${identityHash.slice(13, 16)}-${variant}${identityHash.slice(17, 20)}-${identityHash.slice(20, 32)}`;
}

export async function persistConversationDraft(
  ctx: TenantContext,
  input: {
    projectId: number | null;
    owningChatId?: number | null;
    draft: ConversationArtifactDraft;
    requestId: string;
    trustManifest?: TrustManifest | null;
    dependencyRefs?: string[];
    refreshSpec?: ArtifactRefreshSpec | null;
  },
): Promise<CreatedArtifact> {
  if (input.draft.projectId !== input.projectId) throw new Error("Draft belongs to a different Project.");
  if (input.draft.persistence === "ephemeral") throw new Error("Temporary Artifact drafts cannot be retained.");
  const content = normalizeConversationDraft(input.draft);
  const id = retainedConversationArtifactId(ctx, input.projectId, input.requestId, input.draft.artifactId, input.owningChatId);
  return createArtifactRecord(ctx, {
    projectId: input.projectId,
    owningChatId: input.owningChatId ?? null,
    title: input.draft.title,
    content,
    origin: "conversation",
    sourceRefs: input.draft.sourceRefs,
    executionReceiptIds: input.draft.executionReceiptIds,
    trustManifest: input.trustManifest ?? null,
    dependencyRefs: input.dependencyRefs ?? input.draft.sourceRefs,
    refreshSpec: input.refreshSpec ?? null,
    actorType: "conversation",
    requestId: input.requestId,
    note: `Automatically retained from conversation draft ${input.draft.artifactId}`,
  }, { artifactId: id, draftType: input.draft.artifactType });
}

export async function keepConversationDraft(
  ctx: TenantContext,
  input: {
    projectId: number | null;
    owningChatId?: number | null;
    draft: ConversationArtifactDraft;
    requestId?: string | null;
    sessionId?: string | null;
    trustManifest?: TrustManifest | null;
    dependencyRefs?: string[];
    refreshSpec?: ArtifactRefreshSpec | null;
  },
) {
  if (input.draft.projectId !== null && input.draft.projectId !== input.projectId) throw new Error("Draft belongs to a different Project.");
  if (input.draft.persistence === "ephemeral") throw new Error("Temporary Artifact drafts cannot be retained.");
  const content = normalizeConversationDraft(input.draft);
  const created = await createArtifact(ctx, {
    projectId: input.projectId,
    owningChatId: input.owningChatId ?? null,
    title: input.draft.title,
    content,
    origin: "conversation",
    sourceRefs: input.draft.sourceRefs,
    executionReceiptIds: input.draft.executionReceiptIds,
    trustManifest: input.trustManifest ?? null,
    dependencyRefs: input.dependencyRefs ?? input.draft.sourceRefs,
    refreshSpec: input.refreshSpec ?? null,
    actorType: "conversation",
    requestId: input.requestId ?? null,
    note: `Promoted from conversation draft ${input.draft.artifactId}`,
  });
  if (input.sessionId) {
    await createArtifactReference(ctx, {
      artifactId: created.artifact.id,
      version: created.artifact.headVersion,
      targetType: "session",
      targetRef: input.sessionId,
      label: "Conversation Session",
    });
  }
  return created;
}

export async function keepConversationDraftVersion(
  ctx: TenantContext,
  input: {
    artifactId: string;
    draft: ConversationArtifactDraft;
    requestId?: string | null;
    trustManifest?: TrustManifest | null;
    dependencyRefs?: string[];
    refreshSpec?: ArtifactRefreshSpec | null;
  },
) {
  const artifact = await getArtifact(ctx, input.artifactId);
  if (input.draft.persistence === "ephemeral") throw new Error("Temporary Artifact drafts cannot be retained.");
  if (input.draft.projectId !== artifact.projectId) throw new Error("Draft belongs to a different Artifact ownership context.");
  const content = normalizeConversationDraft(input.draft);
  if (content.kind !== artifact.kind) {
    throw new Error(`Conversation work product kind "${content.kind}" cannot replace ${artifact.kind} Artifact ${artifact.id}. Keep it as a new Artifact instead.`);
  }
  const version = await createArtifactVersion(ctx, {
    artifactId: artifact.id,
    baseVersion: artifact.headVersion,
    content,
    sourceRefs: input.draft.sourceRefs,
    executionReceiptIds: input.draft.executionReceiptIds,
    trustManifest: input.trustManifest ?? null,
    dependencyRefs: input.dependencyRefs ?? input.draft.sourceRefs,
    refreshSpec: input.refreshSpec ?? null,
    actorType: "conversation",
    requestId: input.requestId ?? null,
    note: `Refreshed from conversation work product ${input.draft.artifactId}`,
    action: "rerun",
  });
  return { artifact: await getArtifact(ctx, artifact.id), version };
}

/** Internal verified-run proof; no public Artifact write schema accepts this argument. */
interface ArtifactModelMaintenanceProof {
  kind?: "maintenance";
  runId: string;
  baseContentHash: string;
  review: ArtifactModelMaintenanceReview;
}

interface ArtifactModelRecomputeProof {
  kind: "recompute";
  runId: string;
  baseContentHash: string;
  review: ArtifactIntegratedModelReview;
}

type ArtifactModelWriteProof = ArtifactModelMaintenanceProof | ArtifactModelRecomputeProof;

async function validateModelMaintenanceWrite(ctx: TenantContext, artifact: ProjectArtifact, base: ProjectArtifactVersion, content: SpreadsheetContent, proof: ArtifactModelWriteProof) {
  if (artifact.ownerUserId !== ctx.userId || (artifact.projectId === null && artifact.owningChatId === null) || base.contentHash !== proof.baseContentHash
    || proof.review.artifactId !== artifact.id || proof.review.version !== base.version || proof.review.contentHash !== base.contentHash) throw new Error("Maintenance proof does not match the owned immutable model head.");
  const engineRef = base.refreshSpec?.engineRef;
  const priorRef = typeof engineRef === "string" ? engineRef.match(/^integrated_financial_model:([^:]+):run:([0-9a-f-]{36})$/) : null;
  if (!priorRef) throw new Error("Maintenance requires an existing persisted integrated model run.");
  const previous = await loadIntegratedModelArtifactSource(ctx, priorRef[2], artifact.projectId, true, artifact.owningChatId);
  const next = await loadIntegratedModelArtifactSource(ctx, proof.runId, artifact.projectId, true, artifact.owningChatId);
  const nativeResult = next.run.result;
  if (proof.kind === "recompute") {
    const current = await loadArtifactIntegratedModelReview(ctx, artifact.id, base.version);
    if (current.review.reviewHash !== proof.review.reviewHash
      || previous.run.id !== proof.review.source.runId
      || previous.run.resultHash !== proof.review.source.runResultHash
      || previous.snapshot.id !== proof.review.source.datasetSnapshotId
      || previous.snapshot.contentHash !== proof.review.source.datasetContentHash
      || next.snapshot.id !== previous.snapshot.id || next.snapshot.contentHash !== previous.snapshot.contentHash
      || next.policy.id !== proof.review.source.entitlementPolicyId || next.policy.contentHash !== proof.review.source.entitlementPolicyHash) throw new Error("Recompute proof no longer matches the exact reviewed source, rights and workbook inputs.");
  } else if (next.snapshot.id !== proof.review.targetDatasetSnapshotId || next.snapshot.contentHash !== proof.review.targetContentHash) {
    throw new Error("Maintenance proof does not match the current owned target snapshot.");
  }
  if (next.run.modelVersion !== proof.review.engineRev
    || hashLedgerValue(nativeResult.assumptions) !== hashLedgerValue(proof.review.assumptions)
    || hashLedgerValue(nativeResult.specializedSchedules) !== hashLedgerValue(proof.review.schedules)) throw new Error("Maintenance proof does not match the current owned native run and reviewed inputs.");
  const baseContent = artifactContentSchema.parse(base.content);
  if (baseContent.kind !== "spreadsheet") throw new Error("Maintenance requires a model workbook.");
  const expected = mergeMaintainedWorkbook(baseContent, previous.projection.content, next.projection.content);
  if (hashLedgerValue(content) !== hashLedgerValue(expected)) throw new Error("Maintenance changed protected user cells, formulas or native workbook metadata.");
  // Custom/native coordinates may differ. Source/result paths are resolved against the actual owned projection.
  const projectedCells = new Map(next.projection.content.sheets.flatMap(sheet => Object.values(sheet.cells).flatMap(cell => {
    const lineage = cell.lineage;
    if (!lineage) return [];
    return [[`${lineage.kind}:${lineage.sourcePath ?? lineage.resultPath}`, cell] as const];
  })));
  for (const sheet of content.sheets) for (const cell of Object.values(sheet.cells)) {
    if (cell.lineage?.modelRunId !== next.run.id) continue;
    const lineage = cell.lineage;
    const projected = projectedCells.get(`${lineage.kind}:${lineage.sourcePath ?? lineage.resultPath}`);
    if (!projected?.lineage || hashLedgerValue({ ...projected.lineage, capturedFormat: cell.format }) !== hashLedgerValue(lineage)
      || (lineage.kind !== "user_assumption" && cell.raw !== projected.raw)) throw new Error("Maintenance cell binding does not match its semantic verified source/run projection.");
  }
  return next;
}

export async function createArtifactVersion(
  ctx: TenantContext,
  input: {
    artifactId: string;
    baseVersion: number;
    content: ArtifactContent;
    adapterId?: string | null;
    sourceRefs?: string[];
    executionReceiptIds?: string[];
    assumptionRefs?: string[];
    trustManifest?: TrustManifest | null;
    dependencyRefs?: string[];
    refreshSpec?: ArtifactRefreshSpec | null;
    actorType?: "user" | "conversation" | "system";
    requestId?: string | null;
    note?: string | null;
    action?: ArtifactAction;
  },
  maintenanceProof?: ArtifactModelWriteProof,
): Promise<ProjectArtifactVersion> {
  const artifact = await getArtifact(ctx, input.artifactId);
  let content = artifactContentSchema.parse(input.content);
  if (content.kind !== artifact.kind) throw new Error("Artifact kind cannot change across versions.");
  assertArtifactContentSafe(content);
  assertResearchClaimRefsSafe(content);
  assertArtifactRefsSafe(input.sourceRefs ?? []);
  assertArtifactRefsSafe(input.dependencyRefs ?? [], "dependencyRefs");
  const base = await getArtifactVersion(ctx, input.artifactId, input.baseVersion);
  const baseContent = artifactContentSchema.parse(base.content);
  if (maintenanceProof) {
    if (content.kind !== "spreadsheet") throw new Error("Model maintenance cannot change Artifact kind.");
    const verified = await validateModelMaintenanceWrite(ctx, artifact, base, content, maintenanceProof);
    const proofKind = maintenanceProof.kind === "recompute" ? "model-recompute" : "model-maintenance";
    const expectedRefs = [...verified.projection.sourceRefs, `${proofKind}-run:${verified.run.id}`, `${proofKind}-review-sha256:${maintenanceProof.review.reviewHash}`];
    if (hashLedgerValue(input.sourceRefs) !== hashLedgerValue([...new Set(expectedRefs)])
      || input.refreshSpec?.engineRef !== `integrated_financial_model:${verified.run.modelVersion}:run:${verified.run.id}`
      || input.trustManifest !== null || (input.executionReceiptIds?.length ?? 0) !== 0) throw new Error("Maintenance metadata must bind the new native run, never prior trust or execution authority.");
  } else if (content.kind === "spreadsheet") content = guardSpreadsheetCellLineage(baseContent.kind === "spreadsheet" ? baseContent : null, content);
  const trustManifest = input.trustManifest === undefined
    ? (base.trustManifest ? trustManifestSchema.parse(base.trustManifest) : null)
    : input.trustManifest == null ? null : trustManifestSchema.parse(input.trustManifest);
  if (trustManifest) assertArtifactTrustSafe(trustManifest);
  const dependencyRefs = resolveArtifactDependencyRefs(
    input.dependencyRefs === undefined ? (base.dependencyRefs ?? []) : input.dependencyRefs,
    trustManifest,
  );
  const refreshSpec = input.refreshSpec === undefined
    ? (base.refreshSpec ? artifactRefreshSpecSchema.parse(base.refreshSpec) : null)
    : input.refreshSpec == null ? null : artifactRefreshSpecSchema.parse(input.refreshSpec);
  if (refreshSpec) assertArtifactRefreshSpecSafe(refreshSpec);
  const nextVersion = artifact.headVersion + 1;
  if (artifact.headVersion !== input.baseVersion) throw new Error(`Artifact head moved to v${artifact.headVersion}; refresh before applying this edit.`);
  const hash = contentHash(content);
  const adapterId = input.adapterId?.trim() || base.adapterId || defaultArtifactAdapterId(content.kind);
  const now = new Date();
  const db: any = getDb();
  return db.transaction(async (tx: any) => {
    await validateArtifactOwner(ctx, artifact, tx);
    const [advanced] = await tx.update(projectArtifacts).set({
      headVersion: nextVersion,
      updatedAt: now,
    }).where(and(
      artifactTenantFilter(ctx, artifact.id),
      eq(projectArtifacts.headVersion, input.baseVersion),
    )).returning({ id: projectArtifacts.id });
    if (!advanced) throw new Error("Artifact was edited concurrently; refresh before retrying.");
    const id = `artifact-version:${crypto.randomUUID()}`;
    const [version] = await tx.insert(projectArtifactVersions).values({
      id,
      artifactId: artifact.id,
      version: nextVersion,
      parentVersionId: base.id,
      adapterId,
      content: content as unknown as Record<string, unknown>,
      contentHash: hash,
      sourceRefs: input.sourceRefs ?? base.sourceRefs,
      executionReceiptIds: input.executionReceiptIds ?? base.executionReceiptIds,
      assumptionRefs: input.assumptionRefs ?? base.assumptionRefs,
      trustManifest: trustManifest as unknown as Record<string, unknown> | null,
      dependencyRefs,
      refreshSpec: refreshSpec as unknown as Record<string, unknown> | null,
      note: input.note ?? null,
      createdByUserId: ctx.userId,
      createdAt: now,
    }).returning();
    await insertInteractionReceipt(tx, ctx, {
      artifactId: artifact.id,
      action: input.action ?? "create_version",
      actorType: input.actorType ?? "user",
      fromVersion: input.baseVersion,
      toVersion: nextVersion,
      requestId: input.requestId ?? null,
      detail: {
        contentHash: hash,
        adapterId,
        trustId: trustManifest?.trustId ?? null,
        dependencyCount: dependencyRefs.length,
        refreshKind: refreshSpec?.kind ?? null,
        ...(maintenanceProof ? { [maintenanceProof.kind === "recompute" ? "modelRecompute" : "modelMaintenance"]: { runId: maintenanceProof.runId, review: maintenanceProof.review } } : {}),
      },
    });
    await ledgerArtifactEvent(tx, ctx, {
      projectId: artifact.projectId,
      eventType: "artifact.versioned",
      artifactId: artifact.id,
      version: nextVersion,
      contentHash: hash,
      actorType: input.actorType === "conversation" ? "system" : "user",
      requestId: input.requestId ?? null,
      sourceRefs: input.sourceRefs ?? base.sourceRefs,
      content,
      payload: {
        fromVersion: input.baseVersion,
        adapterId,
        action: input.action ?? "create_version",
        trustId: trustManifest?.trustId ?? null,
        dependencyCount: dependencyRefs.length,
        refreshKind: refreshSpec?.kind ?? null,
      },
    });
    return version;
  });
}

export async function compareArtifactVersions(ctx: TenantContext, artifactId: string, leftVersion: number, rightVersion: number) {
  const [left, right] = await Promise.all([
    getArtifactVersion(ctx, artifactId, leftVersion),
    getArtifactVersion(ctx, artifactId, rightVersion),
  ]);
  return compareArtifactContents({
    artifactId,
    leftVersion,
    rightVersion,
    left: artifactContentSchema.parse(left.content),
    right: artifactContentSchema.parse(right.content),
  });
}

export async function forkArtifact(
  ctx: TenantContext,
  input: { artifactId: string; version?: number; title?: string | null; projectId?: number | null },
) {
  const sourceArtifact = await getArtifact(ctx, input.artifactId);
  const sourceVersion = await getArtifactVersion(ctx, sourceArtifact.id, input.version);
  const targetProjectId = input.projectId ?? sourceArtifact.projectId;
  const owningChatId = targetProjectId === null ? sourceArtifact.owningChatId : null;
  await validateArtifactOwner(ctx, { projectId: targetProjectId, owningChatId });
  const content = artifactContentSchema.parse(sourceVersion.content);
  assertResearchClaimRefsSafe(content);
  const id = `artifact:${crypto.randomUUID()}`;
  const versionId = `artifact-version:${crypto.randomUUID()}`;
  const now = new Date();
  const db: any = getDb();
  return db.transaction(async (tx: any) => {
    const [artifact] = await tx.insert(projectArtifacts).values({
      id,
      projectId: targetProjectId,
      owningChatId,
      ownerUserId: ctx.userId,
      organizationId: ctx.organizationId,
      kind: sourceArtifact.kind,
      title: input.title?.trim() || `${sourceArtifact.title} — Fork`,
      status: "active",
      origin: "fork",
      headVersion: 1,
      forkedFromArtifactId: sourceArtifact.id,
      forkedFromVersion: sourceVersion.version,
      createdAt: now,
      updatedAt: now,
    }).returning();
    const [version] = await tx.insert(projectArtifactVersions).values({
      id: versionId,
      artifactId: id,
      version: 1,
      parentVersionId: null,
      adapterId: sourceVersion.adapterId,
      content: content as unknown as Record<string, unknown>,
      contentHash: sourceVersion.contentHash,
      sourceRefs: sourceVersion.sourceRefs,
      executionReceiptIds: sourceVersion.executionReceiptIds,
      assumptionRefs: sourceVersion.assumptionRefs,
      trustManifest: sourceVersion.trustManifest,
      dependencyRefs: sourceVersion.dependencyRefs ?? [],
      refreshSpec: sourceVersion.refreshSpec,
      note: `Forked from ${sourceArtifact.id}@v${sourceVersion.version}`,
      createdByUserId: ctx.userId,
      createdAt: now,
    }).returning();
    await insertInteractionReceipt(tx, ctx, {
      artifactId: id,
      action: "fork",
      actorType: "user",
      toVersion: 1,
      detail: { sourceArtifactId: sourceArtifact.id, sourceVersion: sourceVersion.version },
    });
    await ledgerArtifactEvent(tx, ctx, {
      projectId: targetProjectId,
      eventType: "artifact.forked",
      artifactId: id,
      version: 1,
      contentHash: version.contentHash,
      parentArtifactRef: `${sourceArtifact.id}@v${sourceVersion.version}`,
      sourceRefs: sourceVersion.sourceRefs,
      content,
      payload: { sourceArtifactId: sourceArtifact.id, sourceVersion: sourceVersion.version },
    });
    return { artifact, version };
  });
}

async function validateReferenceTarget(
  ctx: TenantContext,
  artifact: ProjectArtifact,
  type: ArtifactReferenceType,
  ref: string,
): Promise<void> {
  const db = getDb();
  if (type === "project") {
    if (artifact.projectId === null || String(artifact.projectId) !== ref) throw new Error("Artifact can only reference its owning Project as a Project target.");
    return;
  }
  if (type === "session") {
    const [row] = await db.select({ id: projectSessions.id, projectId: projectSessions.projectId }).from(projectSessions)
      .where(and(eq(projectSessions.id, ref), eq(projectSessions.ownerUserId, ctx.userId), tenantOrgClause(projectSessions.organizationId, ctx))).limit(1);
    if (!row || row.projectId !== artifact.projectId) throw new Error("Session reference is outside the Artifact Project.");
    return;
  }
  if (type === "chat") {
    const chatId = Number(ref);
    const [row] = await db.select({ id: projectChats.id, projectId: projectChats.projectId }).from(projectChats)
      .where(and(eq(projectChats.id, chatId), eq(projectChats.ownerUserId, ctx.userId), tenantOrgClause(projectChats.organizationId, ctx))).limit(1);
    if (!row || row.projectId !== artifact.projectId || (artifact.projectId === null && row.id !== artifact.owningChatId)) throw new Error("Chat reference is outside the Artifact ownership boundary.");
    return;
  }
  if (type === "resource") {
    const [row] = await db.select({ id: projectResources.id, projectId: projectResources.projectId }).from(projectResources)
      .where(and(eq(projectResources.id, ref), eq(projectResources.ownerUserId, ctx.userId), tenantOrgClause(projectResources.organizationId, ctx))).limit(1);
    if (!row || row.projectId !== artifact.projectId) throw new Error("Resource reference is outside the Artifact Project.");
    return;
  }
  const target = await getArtifact(ctx, ref);
  if (target.projectId !== artifact.projectId || (artifact.projectId === null && target.owningChatId !== artifact.owningChatId)) throw new Error("Cross-context Artifact references require an explicit fork.");
}

export async function createArtifactReference(
  ctx: TenantContext,
  input: { artifactId: string; version?: number | null; targetType: ArtifactReferenceType; targetRef: string; label?: string | null },
): Promise<ProjectArtifactReference> {
  const artifact = await getArtifact(ctx, input.artifactId);
  const targetType = artifactReferenceTypeSchema.parse(input.targetType);
  if (input.version) await getArtifactVersion(ctx, artifact.id, input.version);
  await validateReferenceTarget(ctx, artifact, targetType, input.targetRef);
  const db: any = getDb();
  return db.transaction(async (tx: any) => {
    const [row] = await tx.insert(projectArtifactReferences).values({
      id: `artifact-ref:${crypto.randomUUID()}`,
      projectId: artifact.projectId,
      artifactId: artifact.id,
      version: input.version ?? null,
      targetType,
      targetRef: input.targetRef,
      label: input.label ?? null,
      createdByUserId: ctx.userId,
    }).onConflictDoNothing().returning();
    const reference = row ?? (await tx.select().from(projectArtifactReferences).where(and(
      eq(projectArtifactReferences.artifactId, artifact.id),
      input.version == null ? isNull(projectArtifactReferences.version) : eq(projectArtifactReferences.version, input.version),
      eq(projectArtifactReferences.targetType, targetType),
      eq(projectArtifactReferences.targetRef, input.targetRef),
    )).limit(1))[0];
    if (targetType === "session") {
      const [session] = await tx.select().from(projectSessions).where(and(
        eq(projectSessions.id, input.targetRef),
        eq(projectSessions.ownerUserId, ctx.userId),
        tenantOrgClause(projectSessions.organizationId, ctx),
      )).limit(1);
      if (session) {
        const state = projectWorkspaceSessionStateSchema.parse(session.workspaceState);
        const artifactVersionRef = `${artifact.id}@v${input.version ?? artifact.headVersion}`;
        const provenance = state.provenance ?? {
          layoutStateRef: null,
          sourcePolicyRef: null,
          strategyRef: null,
          backtestRef: null,
          assumptionRefs: [],
          artifactVersionRefs: [],
        };
        if (!provenance.artifactVersionRefs.includes(artifactVersionRef)) {
          const nextState = projectWorkspaceSessionStateSchema.parse({
            ...state,
            provenance: {
              ...provenance,
              artifactVersionRefs: [...provenance.artifactVersionRefs, artifactVersionRef],
            },
          });
          await tx.update(projectSessions).set({
            workspaceState: nextState as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          }).where(eq(projectSessions.id, session.id));
          await appendLedgerEventInTransaction(tx, ctx, {
            projectId: artifact.projectId,
            chatId: session.chatId,
            sessionId: session.id,
            eventType: "session.updated",
            actorType: "user",
            payload: {
              sessionId: session.id,
              artifactReferenceAdded: artifactVersionRef,
              workspaceStateHash: hashLedgerValue(nextState),
            },
            lineage: {
              nodes: [
                { kind: "session", ref: session.id, version: null, hash: hashLedgerValue(nextState), asOf: null, metadata: {} },
                { kind: "artifact", ref: artifactVersionRef, version: String(input.version ?? artifact.headVersion), hash: null, asOf: null, metadata: {} },
              ],
              edges: [{ from: artifactVersionRef, to: session.id, relation: "configured_by" }],
            },
          });
        }
      }
    }

    await insertInteractionReceipt(tx, ctx, {
      artifactId: artifact.id,
      action: "reference",
      actorType: "user",
      fromVersion: input.version ?? artifact.headVersion,
      detail: { targetType, targetRef: input.targetRef },
    });
    await ledgerArtifactEvent(tx, ctx, {
      projectId: artifact.projectId,
      eventType: "artifact.reference.created",
      artifactId: artifact.id,
      version: input.version ?? artifact.headVersion,
      payload: { referenceId: reference.id, targetType, targetRef: input.targetRef },
    });
    return reference;
  });
}

export async function relinkImportedArtifactFork(
  ctx: TenantContext,
  artifactId: string,
  sourceArtifactId: string,
  sourceVersion: number,
): Promise<ProjectArtifact> {
  const [artifact, source] = await Promise.all([getArtifact(ctx, artifactId), getArtifact(ctx, sourceArtifactId)]);
  if (artifact.projectId !== source.projectId || (artifact.projectId === null && artifact.owningChatId !== source.owningChatId)) throw new Error("Imported fork ancestry must remain inside one ownership context.");
  await getArtifactVersion(ctx, sourceArtifactId, sourceVersion);
  const db: any = getDb();
  return db.transaction(async (tx: any) => {
    const [updated] = await tx.update(projectArtifacts).set({
      forkedFromArtifactId: sourceArtifactId,
      forkedFromVersion: sourceVersion,
      updatedAt: new Date(),
    }).where(artifactTenantFilter(ctx, artifactId)).returning();
    await insertInteractionReceipt(tx, ctx, {
      artifactId,
      action: "import",
      actorType: "system",
      fromVersion: artifact.headVersion,
      detail: { relinkedForkFromArtifactId: sourceArtifactId, sourceVersion },
    });
    await ledgerArtifactEvent(tx, ctx, {
      projectId: artifact.projectId,
      eventType: "artifact.imported",
      artifactId,
      version: artifact.headVersion,
      parentArtifactRef: `${sourceArtifactId}@v${sourceVersion}`,
      payload: { relinkedForkFromArtifactId: sourceArtifactId, sourceVersion },
    });
    return updated;
  });
}

export async function setArtifactStatus(ctx: TenantContext, artifactId: string, status: "active" | "archived") {
  const artifact = await getArtifact(ctx, artifactId);
  if (artifact.status === status && !artifact.trashedAt) return artifact;
  const now = new Date();
  const db: any = getDb();
  return db.transaction(async (tx: any) => {
    const [updated] = await tx.update(projectArtifacts).set({
      status,
      archivedAt: status === "archived" ? now : null,
      trashedAt: null,
      trashedByProjectId: null,
      trashedFromStatus: null,
      updatedAt: now,
    }).where(artifactTenantFilter(ctx, artifact.id)).returning();
    await insertInteractionReceipt(tx, ctx, {
      artifactId: artifact.id,
      action: status === "archived" ? "archive" : "restore",
      actorType: "user",
      fromVersion: artifact.headVersion,
      detail: { status },
    });
    await ledgerArtifactEvent(tx, ctx, {
      projectId: artifact.projectId,
      eventType: "artifact.action",
      artifactId: artifact.id,
      version: artifact.headVersion,
      payload: { action: status === "archived" ? "archive" : "restore" },
    });
    return updated;
  });
}

export async function trashArtifact(ctx: TenantContext, artifactId: string): Promise<ProjectArtifact> {
  const artifact = await getArtifact(ctx, artifactId);
  const now = new Date();
  const [updated] = await getDb().update(projectArtifacts).set({
    status: "archived",
    archivedAt: artifact.status === "active" ? now : artifact.archivedAt,
    trashedAt: now,
    trashedByProjectId: null,
    trashedFromStatus: artifact.status,
    updatedAt: now,
  }).where(artifactTenantFilter(ctx, artifact.id)).returning();
  if (!updated) throw new Error("Artifact not found or not owned by the requesting user.");
  return updated;
}

export async function restoreTrashedArtifact(ctx: TenantContext, artifactId: string): Promise<ProjectArtifact> {
  const artifact = await getArtifactIncludingTrash(ctx, artifactId);
  if (!artifact.trashedAt) throw new Error("Artifact is not in Trash.");
  await validateArtifactOwner(ctx, artifact);
  const restoredStatus = artifact.trashedFromStatus === "archived" ? "archived" : "active";
  const [updated] = await getDb().update(projectArtifacts).set({
    status: restoredStatus,
    ...(restoredStatus === "active" ? { archivedAt: null } : {}),
    trashedAt: null,
    trashedByProjectId: null,
    trashedFromStatus: null,
    updatedAt: new Date(),
  }).where(and(artifactTenantFilter(ctx, artifact.id), isNotNull(projectArtifacts.trashedAt))).returning();
  if (!updated) throw new Error("Artifact was changed before it could be restored.");
  return updated;
}

export async function permanentlyDeleteArtifact(ctx: TenantContext, artifactId: string): Promise<void> {
  const artifact = await getArtifactIncludingTrash(ctx, artifactId);
  if (!artifact.trashedAt) throw new Error("Artifact must be in Trash before permanent deletion.");
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(projectArtifactReferences).where(eq(projectArtifactReferences.artifactId, artifactId));
    await tx.delete(projectArtifactProposals).where(eq(projectArtifactProposals.artifactId, artifactId));
    await tx.delete(projectArtifactVersions).where(eq(projectArtifactVersions.artifactId, artifactId));
    await tx.delete(artifactInteractionReceipts).where(eq(artifactInteractionReceipts.artifactId, artifactId));
    const deleted = await tx.delete(projectArtifacts).where(and(artifactTenantFilter(ctx, artifactId), isNotNull(projectArtifacts.trashedAt))).returning();
    if (!deleted.length) throw new Error("Artifact was changed before it could be permanently deleted.");
  });
}

export async function createArtifactProposal(
  ctx: TenantContext,
  input: {
    artifactId: string;
    baseVersion: number;
    type: "spreadsheet_ai_diff" | "document_edit" | "artifact_patch";
    summary: string;
    diffs?: SpreadsheetCellDiff[];
    patch?: Record<string, unknown>;
    actorType?: "user" | "conversation";
    requestId?: string | null;
  },
  /** Server-only durable operation identity; never accepted by a client proposal schema. */
  stableIdentity?: { key: string; payloadHash: string },
): Promise<ProjectArtifactProposal> {
  const artifact = await getArtifact(ctx, input.artifactId);
  const id = stableIdentity
    ? `artifact-proposal:${hashLedgerValue({ owner: ctx.userId, organizationId: ctx.organizationId, artifactId: artifact.id, key: stableIdentity.key })}`
    : `artifact-proposal:${crypto.randomUUID()}`;
  const db = getDb();
  async function matchReplay(proposal: ProjectArtifactProposal): Promise<ProjectArtifactProposal> {
    const receipts = await db.select().from(artifactInteractionReceipts).where(and(
      eq(artifactInteractionReceipts.artifactId, artifact.id),
      eq(artifactInteractionReceipts.action, "propose_change"),
    ));
    const receipt = receipts.find(row => row.detail.proposalId === id);
    if (!stableIdentity || proposal.artifactId !== artifact.id || proposal.createdByUserId !== ctx.userId
      || proposal.baseVersion !== input.baseVersion || proposal.proposalType !== input.type
      || proposal.summary !== input.summary || receipt?.detail.proposalInputHash !== stableIdentity.payloadHash
      || hashLedgerValue(proposal.patch) !== hashLedgerValue(input.patch ?? {})
      || hashLedgerValue(proposal.diffs) !== hashLedgerValue(input.diffs ?? [])) {
      throw new Error("Artifact proposal identity was replayed with different content.");
    }
    return proposal;
  }
  if (stableIdentity) {
    const [existing] = await db.select().from(projectArtifactProposals).where(eq(projectArtifactProposals.id, id)).limit(1);
    if (existing) return matchReplay(existing);
  }
  if (artifact.headVersion !== input.baseVersion) throw new Error("Proposal base version is stale.");
  const baseVersion = await getArtifactVersion(ctx, artifact.id, input.baseVersion);
  const baseContent = artifactContentSchema.parse(baseVersion.content);
  let proposed = input.type === "spreadsheet_ai_diff"
    ? applySpreadsheetDiffs(baseContent, input.diffs ?? [])
    : applyArtifactPatch(baseContent, input.patch ?? {});
  if (proposed.kind === "spreadsheet") proposed = guardSpreadsheetCellLineage(baseContent.kind === "spreadsheet" ? baseContent : null, proposed);
  assertArtifactContentSafe(proposed);
  assertResearchClaimRefsSafe(proposed);
  const hash = contentHash(proposed);
  // Primary-key uniqueness arbitrates concurrent writers; only the winner writes P3/interaction receipts.
  const inserted = await db.transaction(async tx => {
    const [proposal] = await tx.insert(projectArtifactProposals).values({
      id,
      artifactId: artifact.id,
      baseVersion: input.baseVersion,
      proposalType: input.type,
      status: "pending",
      summary: input.summary,
      diffs: (input.diffs ?? []) as unknown as Array<Record<string, unknown>>,
      patch: input.patch ?? {},
      proposedContentHash: hash,
      createdByUserId: ctx.userId,
    }).onConflictDoNothing({ target: projectArtifactProposals.id }).returning();
    if (!proposal) return null;
    const [current] = await tx.select({ headVersion: projectArtifacts.headVersion }).from(projectArtifacts)
      .where(artifactTenantFilter(ctx, artifact.id)).limit(1);
    if (!current || current.headVersion !== input.baseVersion) throw new Error("Proposal base version is stale.");
    await insertInteractionReceipt(tx, ctx, {
      artifactId: artifact.id,
      action: "propose_change",
      actorType: input.actorType ?? "user",
      fromVersion: input.baseVersion,
      requestId: input.requestId ?? null,
      detail: { proposalId: id, type: input.type, proposedContentHash: hash, ...(stableIdentity ? { proposalInputHash: stableIdentity.payloadHash } : {}) },
    });
    await ledgerArtifactEvent(tx, ctx, {
      projectId: artifact.projectId,
      eventType: "artifact.proposal.created",
      artifactId: artifact.id,
      version: input.baseVersion,
      requestId: input.requestId ?? null,
      payload: { proposalId: id, type: input.type, proposedContentHash: hash },
    });
    return proposal;
  });
  if (inserted) return inserted;
  const [existing] = await db.select().from(projectArtifactProposals).where(eq(projectArtifactProposals.id, id)).limit(1);
  if (!existing) throw new Error("Artifact proposal replay could not resolve its durable record.");
  return matchReplay(existing);
}


export async function decideArtifactProposal(ctx: TenantContext, proposalId: string, decision: "accept" | "reject") {
  const [proposal] = await getDb().select().from(projectArtifactProposals)
    .where(eq(projectArtifactProposals.id, proposalId)).limit(1);
  if (!proposal) throw new Error("Artifact proposal not found.");
  const artifact = await getArtifact(ctx, proposal.artifactId);
  if (proposal.status !== "pending") throw new Error(`Artifact proposal is already ${proposal.status}.`);
  if (decision === "reject") {
    const now = new Date();
    const db: any = getDb();
    return db.transaction(async (tx: any) => {
      const [updated] = await tx.update(projectArtifactProposals).set({
        status: "rejected",
        decidedByUserId: ctx.userId,
        decidedAt: now,
      }).where(and(eq(projectArtifactProposals.id, proposalId), eq(projectArtifactProposals.status, "pending"))).returning();
      if (!updated) throw new Error("Artifact proposal was decided concurrently.");
      await insertInteractionReceipt(tx, ctx, {
        artifactId: artifact.id,
        action: "reject_change",
        actorType: "user",
        fromVersion: proposal.baseVersion,
        detail: { proposalId },
      });
      await ledgerArtifactEvent(tx, ctx, {
        projectId: artifact.projectId,
        eventType: "artifact.proposal.rejected",
        artifactId: artifact.id,
        version: proposal.baseVersion,
        payload: { proposalId },
      });
      return { proposal: updated, version: null };
    });
  }

  if (artifact.headVersion !== proposal.baseVersion) throw new Error("Artifact changed after this proposal was created; reject or recreate the proposal.");
  const base = await getArtifactVersion(ctx, artifact.id, proposal.baseVersion);
  const baseContent = artifactContentSchema.parse(base.content);
  let proposedContent = proposal.proposalType === "spreadsheet_ai_diff"
    ? applySpreadsheetDiffs(baseContent, proposal.diffs as unknown as SpreadsheetCellDiff[])
    : applyArtifactPatch(baseContent, proposal.patch);
  if (proposedContent.kind === "spreadsheet") proposedContent = guardSpreadsheetCellLineage(baseContent.kind === "spreadsheet" ? baseContent : null, proposedContent);
  assertArtifactContentSafe(proposedContent);
  assertResearchClaimRefsSafe(proposedContent);
  if ((proposedContent.kind === "report" || proposedContent.kind === "research") && proposedContent.blocks.some(block => block.type === "image" || block.attrs.sourceArtifactId || block.attrs.sourceAttachmentId)) {
    const { revalidateArtifactComposition } = await import("./artifactComposition");
    await revalidateArtifactComposition(ctx, proposedContent, [...base.sourceRefs, ...(base.dependencyRefs ?? [])]);
  }
  const compositionRefs = proposedContent.kind === "report" || proposedContent.kind === "research"
    ? proposedContent.blocks.flatMap(block => Array.isArray(block.attrs.sourceRefs) ? block.attrs.sourceRefs.filter((ref): ref is string => typeof ref === "string") : [])
    : [];
  const sourceRefs = [...new Set([...base.sourceRefs, ...compositionRefs])];
  const dependencyRefs = [...new Set([...(base.dependencyRefs ?? []), ...compositionRefs])];
  assertArtifactRefsSafe(sourceRefs);
  assertArtifactRefsSafe(dependencyRefs, "dependencyRefs");
  // Proposal review authorizes the edit; it is not a new source verification or deterministic execution.
  const changedContent = contentHash(baseContent) !== contentHash(proposedContent);
  const trustManifest = changedContent ? null : base.trustManifest;
  const trustNote = changedContent
    ? " Current edited content is unverified; prior trust and execution receipts remain historical source custody only."
    : "";
  const nextVersion = proposal.baseVersion + 1;
  const hash = contentHash(proposedContent);
  const now = new Date();
  const db: any = getDb();
  return db.transaction(async (tx: any) => {
    const [claimed] = await tx.update(projectArtifactProposals).set({
      status: "accepted",
      decidedByUserId: ctx.userId,
      decidedAt: now,
    }).where(and(
      eq(projectArtifactProposals.id, proposalId),
      eq(projectArtifactProposals.status, "pending"),
    )).returning();
    if (!claimed) throw new Error("Artifact proposal was decided concurrently.");

    const [advanced] = await tx.update(projectArtifacts).set({
      headVersion: nextVersion,
      updatedAt: now,
    }).where(and(
      artifactTenantFilter(ctx, artifact.id),
      eq(projectArtifacts.headVersion, proposal.baseVersion),
    )).returning({ id: projectArtifacts.id });
    if (!advanced) throw new Error("Artifact changed while accepting this proposal.");

    const [version] = await tx.insert(projectArtifactVersions).values({
      id: `artifact-version:${crypto.randomUUID()}`,
      artifactId: artifact.id,
      version: nextVersion,
      parentVersionId: base.id,
      adapterId: base.adapterId,
      content: proposedContent as unknown as Record<string, unknown>,
      contentHash: hash,
      sourceRefs,
      executionReceiptIds: base.executionReceiptIds,
      assumptionRefs: base.assumptionRefs,
      trustManifest,
      dependencyRefs,
      refreshSpec: base.refreshSpec,
      note: `Accepted proposal ${proposal.id}: ${proposal.summary}${trustNote}`,
      createdByUserId: ctx.userId,
      createdAt: now,
    }).returning();

    await insertInteractionReceipt(tx, ctx, {
      artifactId: artifact.id,
      action: "accept_change",
      actorType: "user",
      fromVersion: proposal.baseVersion,
      toVersion: nextVersion,
      detail: { proposalId, proposedContentHash: hash },
    });
    await ledgerArtifactEvent(tx, ctx, {
      projectId: artifact.projectId,
      eventType: "artifact.versioned",
      artifactId: artifact.id,
      version: nextVersion,
      contentHash: hash,
      sourceRefs,
      content: proposedContent,
      payload: { fromVersion: proposal.baseVersion, action: "accept_change", proposalId },
    });
    await ledgerArtifactEvent(tx, ctx, {
      projectId: artifact.projectId,
      eventType: "artifact.proposal.accepted",
      artifactId: artifact.id,
      version: nextVersion,
      contentHash: hash,
      payload: { proposalId, baseVersion: proposal.baseVersion },
    });
    return { proposal: claimed, version };
  });
}

export async function restoreArtifactRevision(ctx: TenantContext, artifactId: string, baseVersion: number, targetVersion: number) {
  const artifact = await getArtifact(ctx, artifactId);
  if (targetVersion >= baseVersion) throw new Error("Select an earlier revision to restore.");
  const revision = await getArtifactVersion(ctx, artifact.id, targetVersion);
  return createArtifactVersion(ctx, {
    artifactId: artifact.id, baseVersion,
    content: artifactContentSchema.parse(revision.content),
    adapterId: revision.adapterId,
    sourceRefs: revision.sourceRefs,
    executionReceiptIds: revision.executionReceiptIds,
    assumptionRefs: revision.assumptionRefs,
    trustManifest: revision.trustManifest ? trustManifestSchema.parse(revision.trustManifest) : null,
    dependencyRefs: revision.dependencyRefs,
    refreshSpec: revision.refreshSpec ? artifactRefreshSpecSchema.parse(revision.refreshSpec) : null,
    note: `Restored revision ${targetVersion} as a new version after v${baseVersion}`,
    action: "undo",
  });
}

export async function undoArtifactHead(ctx: TenantContext, artifactId: string) {
  const artifact = await getArtifact(ctx, artifactId);
  if (artifact.headVersion <= 1) throw new Error("Artifact has no earlier version to restore.");
  const current = await getArtifactVersion(ctx, artifact.id, artifact.headVersion);
  const parent = current.parentVersionId
    ? (await getDb().select().from(projectArtifactVersions).where(eq(projectArtifactVersions.id, current.parentVersionId)).limit(1))[0]
    : null;
  if (!parent) throw new Error("Artifact head has no restorable parent version.");
  return restoreArtifactRevision(ctx, artifact.id, artifact.headVersion, parent.version);
}

export async function listArtifactInteractionReceipts(ctx: TenantContext, artifactId: string) {
  await getArtifact(ctx, artifactId);
  return getDb().select().from(artifactInteractionReceipts)
    .where(eq(artifactInteractionReceipts.artifactId, artifactId))
    .orderBy(desc(artifactInteractionReceipts.createdAt));
}

/** Version-bound append-only review notes reuse P4 interaction history, never decision approvals. */
export async function appendArtifactReviewNote(ctx: TenantContext, artifactId: string, raw: unknown) {
  const input = z.object({ version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), text: z.string().trim().min(1).max(10_000), anchor: z.string().max(500).default(""), status: z.enum(["open", "resolved"]).default("open"), supersedes: z.string().uuid().nullable().default(null) }).strict().parse(raw);
  const artifact = await getArtifact(ctx, artifactId);
  const version = await getArtifactVersion(ctx, artifactId, input.version);
  if (artifact.status !== "active" || version.contentHash !== input.contentHash) throw new Error("Review source is unavailable or its immutable hash does not match.");
  assertArtifactContentSafe({ text: input.text });
  if (input.supersedes) {
    const prior = (await listArtifactInteractionReceipts(ctx, artifactId)).find(receipt => receipt.id === input.supersedes);
    if (!prior?.detail.reviewNote || prior.toVersion !== input.version || prior.createdByUserId !== ctx.userId) throw new Error("Resolve only your own note on this exact Artifact revision.");
  }
  return getDb().transaction(async tx => {
    const receipt = await tx.insert(artifactInteractionReceipts).values({ id: crypto.randomUUID(), artifactId, action: "inspect_source", actorType: "user", fromVersion: input.version, toVersion: input.version, requestId: null, detail: { reviewNote: input }, createdByUserId: ctx.userId }).returning();
    await appendLedgerEventInTransaction(tx, ctx, { projectId: artifact.projectId, chatId: artifact.projectId === null ? artifact.owningChatId : null, eventType: "artifact.reference.created", actorType: "user", payload: { artifactId, version: input.version, reviewReceiptId: receipt[0].id, status: input.status, supersedes: input.supersedes }, lineage: { nodes: [{ kind: "artifact", ref: `${artifactId}@v${input.version}`, version: String(input.version), hash: version.contentHash, asOf: null, metadata: {} }], edges: [] } });
    return receipt[0];
  });
}
