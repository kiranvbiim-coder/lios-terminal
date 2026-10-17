import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import {
  projectIntelligenceDocuments,
  projectIntelligenceDocumentVersions,
  projectIntelligenceSnapshots,
  type ProjectIntelligenceDocumentRow,
  type ProjectIntelligenceDocumentVersionRow,
  type ProjectIntelligenceSnapshotRow,
} from "@shared/schema";
import { artifactContentSchema, type ArtifactContent } from "@shared/artifactContracts";
import {
  P7_SCHEMA_VERSION,
  p7HistoricalStateSchema,
  p7ProjectDocumentSchema,
  p7ProjectSnapshotSchema,
  p7SearchRequestSchema,
  type P7ContextGraph,
  type P7Delta,
  type P7HistoricalState,
  type P7ProjectDocument,
  type P7ProjectSnapshot,
  type P7SearchHit,
  type P7SourceType,
} from "@shared/p7ResearchContracts";
import type { TenantContext } from "./tenantContext";
import { getDb } from "./db";
import { getProject } from "./projectStore";
import { listProjectChats, listProjectChatMessages } from "./projectChatStore";
import { listProjectResources } from "./projectResourceStore";
import { findProjectAttachmentResource, resolveProjectConversationAttachments } from "./projectAttachmentService";
import { PROJECT_ATTACHMENT_RESOURCE_KIND } from "./projectAttachmentStore";
import { getArtifactVersion, listProjectArtifacts } from "./artifactStore";
import { listProjectLedgerEvents } from "./ledgerStore";
import {
  buildReactiveContextGraph,
  buildResearchGraph,
  buildUnifiedTimeline,
  compileDeterministicInsights,
  createProjectSnapshot,
  diffProjectSnapshots,
  p7DocumentId,
  p7Hash,
  searchProjectDocuments,
} from "./p7ProjectIntelligence";
import { extractStructuredDocument, type P7StructuredDocument } from "./p7StructuredExtraction";

const SECRET_KEY = /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|authorization|cookie|private[_-]?key)/i;
const SECRET_REF = /(?:[?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|key|secret|password)=|\\b(?:authorization|bearer)\\s*[:= ]\\s*\\S+)/i;
const MAX_INDEX_BODY = 300_000;

function tenantOrgClause(column: any, ctx: TenantContext) {
  return ctx.organizationId === null ? isNull(column) : eq(column, ctx.organizationId);
}

function safeText(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.slice(0, 2_000).map((item) => safeText(item, depth + 1)).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SECRET_KEY.test(key))
    .slice(0, 2_000)
    .map(([key, nested]) => {
      const text = safeText(nested, depth + 1);
      return text ? key + ": " + text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function cap(text: string): string {
  return text.replace(/\u0000/g, "").slice(0, MAX_INDEX_BODY);
}

function sanitizeIndexValue(value: unknown, depth = 0): unknown {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") return value.slice(0, 50_000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 2_000).map((item) => sanitizeIndexValue(item, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SECRET_KEY.test(key))
      .slice(0, 2_000)
      .map(([key, nested]) => [key, sanitizeIndexValue(nested, depth + 1)]),
  );
}

function safeMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return sanitizeIndexValue(value ?? {}) as Record<string, unknown>;
}

function safeRefs(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter((value) => value && !SECRET_REF.test(value)))];
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return [];
}

function explicitRefs(metadata: Record<string, unknown>, key: string): string[] {
  return strings(metadata[key]).map((value) => value.trim()).filter(Boolean).slice(0, 500);
}

const P7_CONTEXT_DIMENSIONS = ["entity","metric","period","date","event","portfolio","benchmark","scenario","geography","currency"] as const;

function normalizeContextRefs(
  raw: unknown,
  entityRefs: string[],
  sourceRefs: string[],
): Record<(typeof P7_CONTEXT_DIMENSIONS)[number], string[]> {
  const result: Record<(typeof P7_CONTEXT_DIMENSIONS)[number], string[]> = {
    entity: [],
    metric: [],
    period: [],
    date: [],
    event: [],
    portfolio: [],
    benchmark: [],
    scenario: [],
    geography: [],
    currency: [],
  };
  const add = (dimension: (typeof P7_CONTEXT_DIMENSIONS)[number], value: string) => {
    const normalized = value.trim();
    if (normalized && !SECRET_REF.test(normalized) && !result[dimension].includes(normalized) && result[dimension].length < 2_000) result[dimension].push(normalized);
  };
  for (const entityRef of entityRefs) add("entity", entityRef);
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    for (const dimension of P7_CONTEXT_DIMENSIONS) {
      for (const value of strings(record[dimension])) add(dimension, value);
    }
  }
  for (const sourceRef of sourceRefs) {
    const match = /^(entity|metric|period|date|event|portfolio|benchmark|scenario|geography|currency):(.+)$/i.exec(sourceRef);
    if (match) add(match[1].toLowerCase() as (typeof P7_CONTEXT_DIMENSIONS)[number], match[2]);
  }
  return result;
}

function doc(input: {
  projectId: number;
  sourceType: P7SourceType;
  sourceRef: string;
  title: string;
  body: string;
  occurredAt?: Date | string | null;
  sourceRefs?: string[];
  entityRefs?: string[];
  contextRefs?: unknown;
  metadata?: Record<string, unknown>;
  embedding?: number[] | null;
}): P7ProjectDocument {
  if (SECRET_REF.test(input.sourceRef)) throw new Error("Project Intelligence sourceRef must not contain credential-bearing material.");
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt.toISOString() : input.occurredAt ?? null;
  const body = cap(input.body);
  const sourceRefs = safeRefs(input.sourceRefs);
  const entityRefs = [...new Set(input.entityRefs ?? [])].map((value) => value.trim()).filter(Boolean).slice(0, 500);
  const metadata = safeMetadata(input.metadata);
  const contextRefs = normalizeContextRefs(input.contextRefs ?? input.metadata?.contextRefs, entityRefs, sourceRefs);
  return p7ProjectDocumentSchema.parse({
    schemaVersion: P7_SCHEMA_VERSION,
    id: p7DocumentId(input.projectId, input.sourceType, input.sourceRef),
    projectId: input.projectId,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    title: input.title.trim().slice(0, 1_000) || input.sourceRef,
    body,
    contentHash: p7Hash({ title: input.title, body, sourceRefs, entityRefs, contextRefs, metadata }),
    occurredAt,
    sourceRefs: sourceRefs.slice(0, 2_000),
    entityRefs,
    contextRefs,
    metadata,
    embedding: input.embedding ?? null,
  });
}

function artifactSourceType(content: ArtifactContent): P7SourceType {
  if (content.kind === "research") return "research_evidence";
  if (content.kind === "report") return "report";
  if (content.kind === "decision") return "decision";
  if (content.kind === "thesis") return "thesis";
  return "artifact";
}

function artifactEntityRefs(content: ArtifactContent): string[] {
  const refs: string[] = [];
  if ("symbol" in content && typeof content.symbol === "string" && content.symbol) refs.push(content.symbol.toUpperCase());
  if (content.kind === "thesis" && content.entityRef) refs.push(content.entityRef);
  if (content.kind === "portfolio" && content.portfolioRef) refs.push(content.portfolioRef);
  return [...new Set(refs)];
}

function artifactContextRefs(content: ArtifactContent): Record<string, string[]> {
  const refs: Record<string, string[]> = {};
  if ("symbol" in content && typeof content.symbol === "string" && content.symbol) refs.entity = [content.symbol.toUpperCase()];
  if (content.kind === "thesis" && content.entityRef) refs.entity = [...new Set([...(refs.entity ?? []), content.entityRef])];
  if (content.kind === "portfolio" && content.portfolioRef) refs.portfolio = [content.portfolioRef];
  if (content.kind === "timeline") {
    refs.event = [...new Set(content.events.map((event) => event.id))];
    refs.date = [...new Set(content.events.map((event) => event.at))];
  }
  return refs;
}

function artifactDocuments(projectId: number, artifact: {
  id: string;
  title: string;
  kind: string;
  updatedAt: Date;
  headVersion: number;
}, version: {
  content: Record<string, unknown>;
  sourceRefs: string[];
  assumptionRefs: string[];
  contentHash: string;
  createdAt: Date;
}): P7ProjectDocument[] {
  const content = artifactContentSchema.parse(version.content);
  const sourceRef = artifact.id + "@v" + artifact.headVersion;
  const relations = version.sourceRefs.map((targetRef) => ({ type: "derived_from", targetRef }));
  const rows: P7ProjectDocument[] = [doc({
    projectId,
    sourceType: artifactSourceType(content),
    sourceRef,
    title: artifact.title,
    body: safeText(content),
    occurredAt: artifact.updatedAt,
    sourceRefs: version.sourceRefs,
    entityRefs: artifactEntityRefs(content),
    contextRefs: artifactContextRefs(content),
    metadata: { artifactId: artifact.id, artifactKind: content.kind, version: artifact.headVersion, contentHash: version.contentHash, relations },
  })];

  for (const assumptionRef of version.assumptionRefs) {
    rows.push(doc({
      projectId,
      sourceType: "assumption",
      sourceRef: artifact.id + ":assumption:" + assumptionRef,
      title: "Assumption · " + assumptionRef,
      body: assumptionRef,
      occurredAt: version.createdAt,
      sourceRefs: [sourceRef],
      metadata: { artifactId: artifact.id, relations: [{ type: "assumes", targetRef: sourceRef }] },
    }));
  }

  if (content.kind === "research") {
    for (const claim of content.claims) {
      rows.push(doc({
        projectId,
        sourceType: "research_evidence",
        sourceRef: artifact.id + ":claim:" + claim.id,
        title: "Research claim",
        body: claim.text,
        occurredAt: version.createdAt,
        sourceRefs: claim.sourceRefs,
        metadata: {
          claimId: claim.id,
          relations: [
            { type: "derived_from", targetRef: sourceRef },
            ...claim.sourceRefs.map((targetRef) => ({ type: "evidences", targetRef })),
          ],
        },
      }));
    }

    for (const evidence of content.evidence) {
      rows.push(doc({
        projectId,
        sourceType: evidence.sourceType === "filing" ? "filing" : evidence.sourceType === "document" ? "document" : "research_evidence",
        sourceRef: artifact.id + ":evidence:" + evidence.id,
        title: evidence.title,
        body: evidence.snippet || evidence.title,
        occurredAt: evidence.observedAt ?? version.createdAt,
        sourceRefs: [evidence.sourceRef, ...(evidence.url ? [evidence.url] : [])],
        metadata: {
          researchArtifactId: artifact.id,
          evidenceId: evidence.id,
          sourceType: evidence.sourceType,
          relations: [
            { type: "derived_from", targetRef: sourceRef },
            { type: "evidences", targetRef: evidence.sourceRef },
          ],
        },
      }));
    }
    for (const contradiction of content.contradictions.filter((item) => item.status === "open")) {
      rows.push(doc({
        projectId,
        sourceType: "research_evidence",
        sourceRef: artifact.id + ":contradiction:" + contradiction.id,
        title: "Research contradiction",
        body: contradiction.summary,
        occurredAt: version.createdAt,
        sourceRefs: contradiction.evidenceRefs,
        metadata: {
          researchArtifactId: artifact.id,
          contradictionId: contradiction.id,
          relations: contradiction.claimRefs.map((targetRef) => ({ type: "contradicts", targetRef })),
        },
      }));
    }
  }

  if (content.kind === "timeline") {
    const entityRefs = artifactEntityRefs(content);
    for (const event of content.events) {
      const eventSourceType: P7SourceType = event.type === "filing"
        ? "filing"
        : event.type === "research"
          ? "research_evidence"
          : event.type === "decision"
            ? "decision"
            : "artifact";
      rows.push(doc({
        projectId,
        sourceType: eventSourceType,
        sourceRef: artifact.id + ":timeline:" + event.id,
        title: event.title,
        body: event.summary || event.title,
        occurredAt: event.at,
        sourceRefs: [...new Set([...event.sourceRefs, ...(event.financialEvent?.sourceRefs ?? []), ...event.artifactRefs, ...(event.decisionRef ? [event.decisionRef] : [])])],
        entityRefs: [...new Set([...entityRefs, ...(event.financialEvent?.entityRefs ?? [])])],
        contextRefs: { event: [event.id], date: [event.at], entity: [...new Set([...entityRefs, ...(event.financialEvent?.entityRefs ?? [])])] },
        metadata: {
          artifactId: artifact.id,
          artifactVersion: artifact.headVersion,
          timelineEventType: event.type,
          artifactRefs: event.artifactRefs,
          decisionRef: event.decisionRef,
          ...(event.financialEvent ? {
            financialEvent: event.financialEvent,
            effectiveAt: event.financialEvent.effectiveAt,
            instrumentRefs: event.financialEvent.instrumentRefs,
          } : {}),
          relations: [{ type: "derived_from", targetRef: sourceRef }],
        },
      }));
    }
  }

  if (content.kind === "thesis") {
    const parentRelation = [{ type: "derived_from", targetRef: sourceRef }];
    for (const claim of content.claims) {
      rows.push(doc({
        projectId, sourceType: "thesis", sourceRef: artifact.id + ":claim:" + claim.id,
        title: "Thesis claim · " + claim.status, body: claim.text, occurredAt: claim.updatedAt ?? version.createdAt,
        sourceRefs: [...claim.evidenceRefs, ...claim.counterEvidenceRefs], entityRefs: content.entityRef ? [content.entityRef] : [],
        metadata: { thesisArtifactId: artifact.id, thesisItemType: "claim", thesisItemId: claim.id, relations: parentRelation },
      }));
    }
    for (const outcome of content.expectedOutcomes) rows.push(doc({
      projectId, sourceType: "thesis", sourceRef: artifact.id + ":outcome:" + outcome.id,
      title: "Thesis expected outcome · " + outcome.status, body: outcome.text, occurredAt: artifact.updatedAt,
      sourceRefs: outcome.evidenceRefs, entityRefs: content.entityRef ? [content.entityRef] : [],
      metadata: { insightKind: "expected_outcome", thesisArtifactId: artifact.id, thesisItemId: outcome.id, relations: parentRelation },
    }));
    for (const risk of content.risks) rows.push(doc({
      projectId, sourceType: "thesis", sourceRef: artifact.id + ":risk:" + risk.id,
      title: "Thesis risk · " + risk.status, body: risk.text, occurredAt: artifact.updatedAt,
      sourceRefs: risk.evidenceRefs, entityRefs: content.entityRef ? [content.entityRef] : [],
      metadata: { insightKind: "risk", thesisArtifactId: artifact.id, thesisItemId: risk.id, relations: parentRelation },
    }));
    for (const catalyst of content.catalysts) rows.push(doc({
      projectId, sourceType: "thesis", sourceRef: artifact.id + ":catalyst:" + catalyst.id,
      title: "Thesis catalyst · " + catalyst.status, body: catalyst.text, occurredAt: artifact.updatedAt,
      sourceRefs: catalyst.evidenceRefs, entityRefs: content.entityRef ? [content.entityRef] : [],
      metadata: { insightKind: "catalyst", thesisArtifactId: artifact.id, thesisItemId: catalyst.id, relations: parentRelation },
    }));
    for (const question of content.openQuestions.filter((item) => item.status === "open")) rows.push(doc({
      projectId, sourceType: "thesis", sourceRef: artifact.id + ":question:" + question.id,
      title: "Open thesis question", body: question.text, occurredAt: artifact.updatedAt,
      sourceRefs: question.evidenceRefs, entityRefs: content.entityRef ? [content.entityRef] : [],
      metadata: { insightKind: "open_question", thesisArtifactId: artifact.id, thesisItemId: question.id, relations: parentRelation },
    }));
  }
  return rows;
}

function rowToDocument(row: ProjectIntelligenceDocumentRow): P7ProjectDocument {
  return p7ProjectDocumentSchema.parse({
    schemaVersion: P7_SCHEMA_VERSION,
    id: row.id,
    projectId: row.projectId,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    title: row.title,
    body: row.body,
    contentHash: row.contentHash,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    sourceRefs: row.sourceRefs,
    entityRefs: row.entityRefs,
    contextRefs: row.contextRefs,
    metadata: row.metadata,
    embedding: row.embedding ?? null,
  });
}

function versionRowToDocument(row: ProjectIntelligenceDocumentVersionRow): P7ProjectDocument {
  return p7ProjectDocumentSchema.parse({
    schemaVersion: P7_SCHEMA_VERSION,
    id: row.documentId,
    projectId: row.projectId,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    title: row.title,
    body: row.body,
    contentHash: row.contentHash,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    sourceRefs: row.sourceRefs,
    entityRefs: row.entityRefs,
    contextRefs: row.contextRefs,
    metadata: row.metadata,
    embedding: row.embedding ?? null,
  });
}

function documentVersionValues(ctx: TenantContext, item: P7ProjectDocument) {
  return {
    id: "p7version:" + p7Hash({ projectId: item.projectId, sourceType: item.sourceType, sourceRef: item.sourceRef, contentHash: item.contentHash }).slice(0, 40),
    documentId: item.id,
    projectId: item.projectId,
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    sourceType: item.sourceType,
    sourceRef: item.sourceRef,
    title: item.title,
    body: item.body,
    contentHash: item.contentHash,
    occurredAt: item.occurredAt ? new Date(item.occurredAt) : null,
    sourceRefs: item.sourceRefs,
    entityRefs: item.entityRefs,
    contextRefs: item.contextRefs,
    metadata: item.metadata,
    embedding: item.embedding,
    createdAt: new Date(),
  };
}

function currentDocumentValues(ctx: TenantContext, item: P7ProjectDocument) {
  return {
    id: item.id,
    projectId: item.projectId,
    ownerUserId: ctx.userId,
    organizationId: ctx.organizationId,
    sourceType: item.sourceType,
    sourceRef: item.sourceRef,
    title: item.title,
    body: item.body,
    contentHash: item.contentHash,
    occurredAt: item.occurredAt ? new Date(item.occurredAt) : null,
    sourceRefs: item.sourceRefs,
    entityRefs: item.entityRefs,
    contextRefs: item.contextRefs,
    metadata: item.metadata,
    embedding: item.embedding,
    indexedAt: new Date(),
  };
}

function rowToSnapshot(row: ProjectIntelligenceSnapshotRow): P7ProjectSnapshot {
  return p7ProjectSnapshotSchema.parse({
    schemaVersion: P7_SCHEMA_VERSION,
    id: row.id,
    projectId: row.projectId,
    generatedAt: row.generatedAt.toISOString(),
    contentHash: row.contentHash,
    graphHash: row.graphHash,
    manifest: row.manifest,
  });
}

export async function listProjectIntelligenceDocuments(ctx: TenantContext, projectId: number): Promise<P7ProjectDocument[]> {
  await getProject(ctx, projectId);
  const rows = await getDb().select().from(projectIntelligenceDocuments)
    .where(and(
      eq(projectIntelligenceDocuments.projectId, projectId),
      eq(projectIntelligenceDocuments.ownerUserId, ctx.userId),
      tenantOrgClause(projectIntelligenceDocuments.organizationId, ctx),
    ))
    .orderBy(desc(projectIntelligenceDocuments.occurredAt), desc(projectIntelligenceDocuments.indexedAt));
  return rows.map(rowToDocument);
}

export async function indexProjectDocument(ctx: TenantContext, input: {
  projectId: number;
  sourceType: "research_evidence" | "filing" | "document";
  sourceRef: string;
  title: string;
  body: string;
  occurredAt?: string | null;
  sourceRefs?: string[];
  entityRefs?: string[];
  contextRefs?: Record<string, string[]>;
  metadata?: Record<string, unknown>;
  embedding?: number[] | null;
}): Promise<P7ProjectDocument> {
  await getProject(ctx, input.projectId);
  const parsed = doc({
    ...input,
    metadata: { ...(input.metadata ?? {}), preserveOnRebuild: true },
  });
  const db: any = getDb();
  return db.transaction(async (tx: any) => {
    await tx.insert(projectIntelligenceDocumentVersions).values(documentVersionValues(ctx, parsed)).onConflictDoNothing();
    const [row] = await tx.insert(projectIntelligenceDocuments).values(currentDocumentValues(ctx, parsed)).onConflictDoUpdate({
      target: [projectIntelligenceDocuments.projectId, projectIntelligenceDocuments.sourceType, projectIntelligenceDocuments.sourceRef],
      set: {
        title: parsed.title,
        body: parsed.body,
        contentHash: parsed.contentHash,
        occurredAt: parsed.occurredAt ? new Date(parsed.occurredAt) : null,
        sourceRefs: parsed.sourceRefs,
        entityRefs: parsed.entityRefs,
        contextRefs: parsed.contextRefs,
        metadata: parsed.metadata,
        embedding: parsed.embedding,
        indexedAt: new Date(),
      },
    }).returning();
    return rowToDocument(row);
  });
}

export async function rebuildProjectIntelligence(ctx: TenantContext, projectId: number): Promise<{
  documents: P7ProjectDocument[];
  graph: P7ContextGraph;
  snapshot: P7ProjectSnapshot;
}> {
  await getProject(ctx, projectId);
  const documents: P7ProjectDocument[] = [];
  const chats = await listProjectChats(ctx, { projectId, status: "active" });
  for (const chat of chats) {
    documents.push(doc({
      projectId, sourceType: "chat", sourceRef: "chat:" + chat.id, title: chat.title,
      body: chat.title, occurredAt: chat.updatedAt, metadata: { chatId: chat.id },
    }));
    const messages = await listProjectChatMessages(ctx, chat.id);
    for (const message of messages) {
      const metadata = message.metadata ?? {};
      documents.push(doc({
        projectId,
        sourceType: "chat_message",
        sourceRef: "chat:" + chat.id + ":message:" + message.id,
        title: chat.title + " · " + message.role,
        body: message.content,
        occurredAt: message.createdAt,
        sourceRefs: explicitRefs(metadata, "sourceRefs"),
        entityRefs: explicitRefs(metadata, "entityRefs"),
        contextRefs: metadata.contextRefs,
        metadata: { chatId: chat.id, role: message.role, contextRefs: metadata.contextRefs, relations: [{ type: "derived_from", targetRef: "chat:" + chat.id }] },
      }));
    }
  }

  const resources = (await listProjectResources(ctx, projectId)).filter((resource) => resource.contextMode !== "excluded");
  for (const resource of resources) {
    const metadata = resource.metadata ?? {};
    const sourceRightsMetadata = {
      ...(typeof metadata.provider === "string" ? { provider: metadata.provider } : {}),
      ...(metadata.researchSource !== undefined ? { researchSource: metadata.researchSource } : {}),
    };
    let attachmentText = "";
    let attachmentProjection: Record<string, unknown> = {};
    let attachmentStructure: P7StructuredDocument | null = null;

    if (resource.kind === PROJECT_ATTACHMENT_RESOURCE_KIND) {
      const attachmentSha256 = typeof metadata.sha256 === "string" ? metadata.sha256 : null;
      const attachmentKind = metadata.kind;
      attachmentProjection = {
        ...(attachmentSha256 ? { attachmentSha256 } : {}),
        originClass: "untrusted",
      };

      if (attachmentKind === "image") {
        // SI-03.04: Project knowledge never invents OCR or persists base64 for images.
        attachmentProjection.attachmentExtraction = "metadata_only_image";
      } else {
        const attachmentId = typeof metadata.attachmentId === "string" ? metadata.attachmentId : null;
        if (attachmentId) {
          try {
            // Reuse the canonical P1 attachment reference/integrity boundary and P12 bounded parser.
            // Excluded resources were removed before this loop and are therefore never read.
            const { reference } = await findProjectAttachmentResource(ctx, projectId, attachmentId, [resource]);
            const [resolved] = await resolveProjectConversationAttachments(
              ctx,
              projectId,
              [resource],
              [reference],
              true,
            );
            attachmentText = resolved?.textContent ?? "";
            attachmentProjection.attachmentExtraction = resolved?.textContent
              ? {
                  kind: "bounded_text",
                  incomplete: Boolean(resolved.textTruncation),
                  ...(resolved.textTruncation ? { truncation: resolved.textTruncation } : {}),
                }
              : { kind: "metadata_only", incomplete: true };
            if (attachmentText) {
              attachmentStructure = resolved?.documentStructure ?? extractStructuredDocument(attachmentText, {
                incomplete: Boolean(resolved?.textTruncation),
              });
              attachmentProjection.structuredExtraction = {
                schemaVersion: attachmentStructure.schemaVersion,
                version: attachmentStructure.version,
                sourceMode: attachmentStructure.sourceMode,
                incomplete: attachmentStructure.incomplete,
                sectionCount: attachmentStructure.sections.length,
                tableCount: attachmentStructure.tables.length,
                unitHints: attachmentStructure.unitHints,
                relationshipCount: attachmentStructure.relationshipCount,
                documentRelationshipCount: attachmentStructure.documentRelationshipCount,
                financialRowCount: attachmentStructure.financialRowCount,
                truncation: attachmentStructure.truncation,
              };
              if (attachmentStructure.documentRelationships.length) {
                attachmentProjection.documentRelationships = attachmentStructure.documentRelationships;
              }
            }
          } catch {
            // P7 is rebuildable derived state. Extraction failure must not fabricate content
            // or prevent unrelated Project knowledge from rebuilding.
            attachmentProjection.attachmentExtraction = {
              kind: "metadata_only",
              incomplete: true,
              reason: "extraction_unavailable",
            };
          }
        } else {
          attachmentProjection.attachmentExtraction = {
            kind: "metadata_only",
            incomplete: true,
            reason: "attachment_identity_unavailable",
          };
        }
      }
    }

    const resourceBody = [
      resource.label,
      typeof metadata.summary === "string" ? metadata.summary : "",
      typeof metadata.text === "string" ? metadata.text : "",
      typeof metadata.excerpt === "string" ? metadata.excerpt : "",
      attachmentText,
    ].filter(Boolean).join("\n");
    const inheritedEntityRefs = explicitRefs(metadata, "entityRefs");
    documents.push(doc({
      projectId, sourceType: "resource", sourceRef: resource.id, title: resource.label,
      body: resourceBody || resource.resourceRef || resource.label,
      occurredAt: resource.updatedAt,
      sourceRefs: resource.resourceRef ? [resource.resourceRef] : [],
      entityRefs: inheritedEntityRefs,
      contextRefs: metadata.contextRefs,
      metadata: {
        kind: resource.kind,
        contextMode: resource.contextMode,
        resourceRef: resource.resourceRef,
        contextRefs: metadata.contextRefs,
        ...sourceRightsMetadata,
        ...attachmentProjection,
      },
    }));

    if (attachmentStructure) {
      const structureSourceRefs = resource.resourceRef
        ? [resource.resourceRef, resource.id]
        : [resource.id];

      for (const section of attachmentStructure.sections) {
        documents.push(doc({
          projectId,
          sourceType: "document",
          sourceRef: `${resource.id}#section:${section.id}`,
          title: `${resource.label} · ${section.title}`,
          body: section.text || section.title,
          occurredAt: resource.updatedAt,
          sourceRefs: structureSourceRefs,
          entityRefs: inheritedEntityRefs,
          metadata: {
            ...sourceRightsMetadata,
            structureKind: "section",
            parentSourceRef: resource.id,
            attachmentSourceRef: resource.resourceRef,
            sectionId: section.id,
            sectionKind: section.kind,
            donorRef: section.donorRef,
            headingLevel: section.level,
            startLine: section.startLine,
            endLine: section.endLine,
            anchor: section.anchor,
            unitHints: section.unitHints,
            incomplete: attachmentStructure.incomplete,
            relations: [{ type: "derived_from", targetRef: resource.id }],
          },
        }));
      }

      for (const table of attachmentStructure.tables) {
        const metrics = [...new Set(table.financialRows.map((row) => row.metric).filter(Boolean))];
        const periods = [...new Set(table.financialRows.map((row) => row.period).filter((value): value is string => Boolean(value)))];
        const currencies = [...new Set(table.financialRows.map((row) => row.currency).filter((value): value is string => Boolean(value)))];
        documents.push(doc({
          projectId,
          sourceType: "document",
          sourceRef: `${resource.id}#table:${table.id}`,
          title: `${resource.label} · ${table.sectionTitle ? table.sectionTitle + " · " : ""}Table ${table.id.slice(1)}`,
          body: table.markdown,
          occurredAt: resource.updatedAt,
          sourceRefs: structureSourceRefs,
          entityRefs: inheritedEntityRefs,
          contextRefs: {
            metric: metrics,
            period: periods,
            currency: currencies,
          },
          metadata: {
            ...sourceRightsMetadata,
            structureKind: "table",
            parentSourceRef: resource.id,
            attachmentSourceRef: resource.resourceRef,
            tableId: table.id,
            donorRef: table.donorRef,
            sectionId: table.sectionId,
            sectionTitle: table.sectionTitle,
            startLine: table.startLine,
            endLine: table.endLine,
            anchor: table.anchor,
            headers: table.headers,
            rowCount: table.rowCount,
            columnCount: table.columnCount,
            cells: table.cells,
            unitHints: table.unitHints,
            relationships: table.relationships,
            financialRows: table.financialRows,
            financialStructure: table.financialStructure,
            incomplete: attachmentStructure.incomplete || table.truncated,
            relations: [{ type: "derived_from", targetRef: resource.id }],
          },
        }));
      }
    }
  }

  const artifacts = await listProjectArtifacts(ctx, projectId, { status: "active", limit: 500 });
  for (const artifact of artifacts) {
    const version = await getArtifactVersion(ctx, artifact.id, artifact.headVersion);
    documents.push(...artifactDocuments(projectId, artifact, version));
  }

  const ledger = await listProjectLedgerEvents(ctx, projectId, { limit: 500 });
  for (const event of ledger) {
    const payload = event.payload ?? {};
    const sourceRefs = explicitRefs(payload, "sourceRefs");
    const entityRefs = explicitRefs(payload, "entityRefs");
    documents.push(doc({
      projectId, sourceType: "ledger_event", sourceRef: event.id,
      title: event.eventType, body: safeText(payload), occurredAt: event.createdAt,
      sourceRefs, entityRefs,
      contextRefs: payload.contextRefs,
      metadata: { eventType: event.eventType, sequence: event.sequence, actorType: event.actorType, lineage: event.lineage, contextRefs: payload.contextRefs },
    }));
  }

  const preserved = await listProjectIntelligenceDocuments(ctx, projectId);
  for (const existing of preserved) {
    if (existing.metadata.preserveOnRebuild === true) documents.push(existing);
  }

  const uniqueDocuments = [...new Map(documents.map((item) => [item.sourceType + "\n" + item.sourceRef, item])).values()];
  const graph = buildReactiveContextGraph({ projectId, documents: uniqueDocuments });
  const snapshot = createProjectSnapshot({ projectId, graph, documents: uniqueDocuments });

  const db: any = getDb();
  await db.transaction(async (tx: any) => {
    if (uniqueDocuments.length) {
      await tx.insert(projectIntelligenceDocumentVersions)
        .values(uniqueDocuments.map((item) => documentVersionValues(ctx, item)))
        .onConflictDoNothing();
    }
    await tx.delete(projectIntelligenceDocuments).where(and(
      eq(projectIntelligenceDocuments.projectId, projectId),
      eq(projectIntelligenceDocuments.ownerUserId, ctx.userId),
      tenantOrgClause(projectIntelligenceDocuments.organizationId, ctx),
    ));
    if (uniqueDocuments.length) {
      await tx.insert(projectIntelligenceDocuments).values(uniqueDocuments.map((item) => currentDocumentValues(ctx, item)));
    }
    await tx.insert(projectIntelligenceSnapshots).values({
      id: snapshot.id,
      projectId,
      ownerUserId: ctx.userId,
      organizationId: ctx.organizationId,
      generatedAt: new Date(snapshot.generatedAt),
      contentHash: snapshot.contentHash,
      graphHash: snapshot.graphHash,
      manifest: snapshot.manifest,
    }).onConflictDoNothing();
  });

  return { documents: uniqueDocuments, graph, snapshot };
}

export async function listProjectIntelligenceSnapshots(ctx: TenantContext, projectId: number, limit = 50): Promise<P7ProjectSnapshot[]> {
  await getProject(ctx, projectId);
  const rows = await getDb().select().from(projectIntelligenceSnapshots)
    .where(and(
      eq(projectIntelligenceSnapshots.projectId, projectId),
      eq(projectIntelligenceSnapshots.ownerUserId, ctx.userId),
      tenantOrgClause(projectIntelligenceSnapshots.organizationId, ctx),
    ))
    .orderBy(desc(projectIntelligenceSnapshots.generatedAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(rowToSnapshot);
}

export async function getProjectIntelligenceSnapshot(ctx: TenantContext, projectId: number, snapshotId: string): Promise<P7ProjectSnapshot> {
  await getProject(ctx, projectId);
  const [row] = await getDb().select().from(projectIntelligenceSnapshots)
    .where(and(
      eq(projectIntelligenceSnapshots.id, snapshotId),
      eq(projectIntelligenceSnapshots.projectId, projectId),
      eq(projectIntelligenceSnapshots.ownerUserId, ctx.userId),
      tenantOrgClause(projectIntelligenceSnapshots.organizationId, ctx),
    )).limit(1);
  if (!row) throw new Error("Project Intelligence snapshot not found.");
  return rowToSnapshot(row);
}

export async function getProjectIntelligenceHistoricalState(
  ctx: TenantContext,
  projectId: number,
  snapshotId: string,
): Promise<P7HistoricalState> {
  const snapshot = await getProjectIntelligenceSnapshot(ctx, projectId, snapshotId);
  if (!snapshot.manifest.length) return p7HistoricalStateSchema.parse({ snapshot, documents: [] });

  const hashes = [...new Set(snapshot.manifest.map((entry) => entry.contentHash))];
  const rows: ProjectIntelligenceDocumentVersionRow[] = [];
  const db = getDb();
  for (let offset = 0; offset < hashes.length; offset += 500) {
    const chunk = hashes.slice(offset, offset + 500);
    const batch = await db.select().from(projectIntelligenceDocumentVersions)
      .where(and(
        eq(projectIntelligenceDocumentVersions.projectId, projectId),
        eq(projectIntelligenceDocumentVersions.ownerUserId, ctx.userId),
        tenantOrgClause(projectIntelligenceDocumentVersions.organizationId, ctx),
        inArray(projectIntelligenceDocumentVersions.contentHash, chunk),
      ));
    rows.push(...batch);
  }

  const byManifestKey = new Map(rows.map((row) => [
    row.sourceType + "\n" + row.sourceRef + "\n" + row.contentHash,
    versionRowToDocument(row),
  ]));
  const documents = snapshot.manifest.map((entry) => {
    const item = byManifestKey.get(entry.sourceType + "\n" + entry.sourceRef + "\n" + entry.contentHash);
    if (!item) throw new Error("Historical Project Intelligence state is incomplete for source " + entry.sourceRef + ".");
    return item;
  });
  return p7HistoricalStateSchema.parse({ snapshot, documents });
}

export async function projectIntelligenceAsKnownOn(
  ctx: TenantContext,
  projectId: number,
  at: string | Date,
): Promise<P7HistoricalState> {
  await getProject(ctx, projectId);
  const asOf = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(asOf.getTime())) throw new Error("As Known On requires a valid date/time.");
  const [row] = await getDb().select().from(projectIntelligenceSnapshots)
    .where(and(
      eq(projectIntelligenceSnapshots.projectId, projectId),
      eq(projectIntelligenceSnapshots.ownerUserId, ctx.userId),
      tenantOrgClause(projectIntelligenceSnapshots.organizationId, ctx),
      lte(projectIntelligenceSnapshots.generatedAt, asOf),
    ))
    .orderBy(desc(projectIntelligenceSnapshots.generatedAt))
    .limit(1);
  if (!row) throw new Error("No Project Intelligence snapshot exists on or before the requested As Known On time.");
  return getProjectIntelligenceHistoricalState(ctx, projectId, row.id);
}

export async function currentProjectIntelligence(ctx: TenantContext, projectId: number): Promise<{
  documents: P7ProjectDocument[];
  graph: P7ContextGraph;
  researchGraph: P7ContextGraph;
  timeline: ReturnType<typeof buildUnifiedTimeline>;
}> {
  let documents = await listProjectIntelligenceDocuments(ctx, projectId);
  if (!documents.length) documents = (await rebuildProjectIntelligence(ctx, projectId)).documents;
  const graph = buildReactiveContextGraph({ projectId, documents });
  return { documents, graph, researchGraph: buildResearchGraph(graph), timeline: buildUnifiedTimeline(documents) };
}

export async function currentPermittedProjectSearchDocuments(ctx: TenantContext, projectId: number): Promise<P7ProjectDocument[]> {
  const [project, indexed, snapshots] = await Promise.all([
    getProject(ctx, projectId),
    listProjectIntelligenceDocuments(ctx, projectId),
    listProjectIntelligenceSnapshots(ctx, projectId, 1),
  ]);
  let documents = indexed;
  if (!documents.length || !snapshots[0] || Math.max(project.updatedAt.getTime(), project.lastActivityAt.getTime()) >= Date.parse(snapshots[0].generatedAt)) {
    documents = (await rebuildProjectIntelligence(ctx, projectId)).documents;
  }
  // Current eligibility is authoritative even if source changes raced snapshot construction.
  const [resources, chats, artifacts] = await Promise.all([
    listProjectResources(ctx, projectId), listProjectChats(ctx, { projectId, status: "active" }), listProjectArtifacts(ctx, projectId),
  ]);
  const resourceIds = new Set(resources.filter(resource => resource.contextMode !== "excluded").map(resource => resource.id));
  const chatIds = new Set(chats.map(chat => chat.id));
  const artifactIds = new Set(artifacts.map(artifact => artifact.id));
  documents = documents.filter(document => {
    const parent = typeof document.metadata.parentSourceRef === "string" ? document.metadata.parentSourceRef : document.sourceRef;
    if (parent.startsWith("prjres:") && !resourceIds.has(parent.split("#", 1)[0])) return false;
    if (typeof document.metadata.chatId === "number" && !chatIds.has(document.metadata.chatId)) return false;
    const artifactId = document.metadata.artifactId;
    if (typeof artifactId === "string" && /^artifact:[0-9a-f-]{36}$/i.test(artifactId) && !artifactIds.has(artifactId)) return false;
    return true;
  });
  return documents;
}

export async function searchProjectIntelligence(ctx: TenantContext, projectId: number, request: unknown): Promise<P7SearchHit[]> {
  const parsed = p7SearchRequestSchema.parse(request);
  return searchProjectDocuments(await currentPermittedProjectSearchDocuments(ctx, projectId), parsed);
}

export async function projectIntelligenceDelta(ctx: TenantContext, projectId: number, fromId: string, toId: string): Promise<P7Delta> {
  const [from, to] = await Promise.all([
    getProjectIntelligenceSnapshot(ctx, projectId, fromId),
    getProjectIntelligenceSnapshot(ctx, projectId, toId),
  ]);
  return diffProjectSnapshots(from, to);
}

export async function currentInsightLens(ctx: TenantContext, projectId: number) {
  let documents = await listProjectIntelligenceDocuments(ctx, projectId);
  if (!documents.length) documents = (await rebuildProjectIntelligence(ctx, projectId)).documents;
  const snapshots = await listProjectIntelligenceSnapshots(ctx, projectId, 2);
  const delta = snapshots.length >= 2 ? diffProjectSnapshots(snapshots[1], snapshots[0]) : null;
  return compileDeterministicInsights({ projectId, documents, delta });
}

export function projectIntelligenceFingerprint(documents: P7ProjectDocument[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(documents.map((item) => [item.sourceRef, item.contentHash]).sort())).digest("hex");
}
