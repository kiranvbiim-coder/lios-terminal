import { z } from "zod";
import type { P7ProjectDocument } from "@shared/p7ResearchContracts";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { comparePrimarySourceFilings } from "./p7FilingDiff";
import { listProjectIntelligenceDocuments } from "./p7ProjectIntelligenceStore";
import { p7Hash } from "./p7ProjectIntelligence";
import { buildProjectEvidenceTruth, type ProjectEvidenceTruthPosture } from "./projectEvidenceTruth";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
import { tenantContext } from "./tenantContext";

export type DisclosureKind = "filing" | "transcript" | "presentation" | "disclosure";
export type DisclosureMateriality = "material" | "not_material" | "unknown";

export interface DisclosureSourcePosture {
  sourceRef: string;
  contentHash: string;
  title: string;
  kind: DisclosureKind;
  entityRefs: string[];
  seriesRef: string | null;
  materiality: DisclosureMateriality;
  sectionMode: "structured_sections" | "parent_body_fallback";
  truth: ProjectEvidenceTruthPosture;
}

export interface DisclosureSectionChange {
  id: string;
  title: string;
  kind: "added" | "removed" | "modified";
  before: string;
  after: string;
  materiality: DisclosureMateriality;
  priorSourceRef: string;
  priorContentHash: string;
  currentSourceRef: string;
  currentContentHash: string;
  evidenceRefs: string[];
}

export interface DisclosureChangeIntelligence {
  prior: DisclosureSourcePosture;
  current: DisclosureSourcePosture;
  changes: DisclosureSectionChange[];
  unchangedSections: number;
  omittedChanges: number;
  historicalContext: Array<{
    sourceRef: string;
    contentHash: string;
    title: string;
    kind: DisclosureKind;
    entityRefs: string[];
    seriesRef: string | null;
    truth: ProjectEvidenceTruthPosture;
  }>;
}

type DisclosureSection = {
  id: string;
  title: string;
  text: string;
  evidenceRef: string;
  contentHash: string;
  materiality: DisclosureMateriality;
};

const disclosureKinds = new Set<DisclosureKind>(["filing", "transcript", "presentation", "disclosure"]);

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function declaredMateriality(metadata: Record<string, unknown>): DisclosureMateriality {
  return metadata.materiality === "material" || metadata.materiality === "not_material"
    ? metadata.materiality
    : "unknown";
}

function disclosureKind(document: P7ProjectDocument): DisclosureKind | null {
  if (document.sourceType === "filing") return "filing";
  const declared = stringValue(document.metadata.disclosureKind);
  return declared && disclosureKinds.has(declared as DisclosureKind) ? declared as DisclosureKind : null;
}

function disclosureSeries(document: P7ProjectDocument): string | null {
  return stringValue(document.metadata.disclosureSeries);
}

function permitted(document: P7ProjectDocument, allowed: ReadonlySet<string>): boolean {
  return !allowed.size || allowed.has(document.sourceRef) || document.sourceRefs.some((ref) => allowed.has(ref));
}

function logicalSectionTitle(document: P7ProjectDocument): string {
  const explicit = stringValue(document.metadata.sectionTitle);
  if (explicit) return explicit;
  const parts = document.title.split(" · ").map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? document.title;
}

function sectionIdentity(document: P7ProjectDocument): string {
  const donorRef = stringValue(document.metadata.donorRef);
  if (donorRef) return "donor:" + donorRef;
  const normalizedTitle = logicalSectionTitle(document).toLowerCase().replace(/\s+/g, " ").trim();
  return "section:" + p7Hash(normalizedTitle).slice(0, 24);
}

function canonicalSections(
  documents: readonly P7ProjectDocument[],
  parent: P7ProjectDocument,
  allowed: ReadonlySet<string>,
): { mode: DisclosureSourcePosture["sectionMode"]; sections: DisclosureSection[] } {
  const children = documents
    .filter((document) =>
      document.metadata.structureKind === "section"
      && document.metadata.parentSourceRef === parent.sourceRef
      && permitted(document, allowed))
    .sort((left, right) => {
      const leftStart = typeof left.metadata.startLine === "number" ? left.metadata.startLine : Number.MAX_SAFE_INTEGER;
      const rightStart = typeof right.metadata.startLine === "number" ? right.metadata.startLine : Number.MAX_SAFE_INTEGER;
      return leftStart - rightStart || left.sourceRef.localeCompare(right.sourceRef);
    });

  if (!children.length) {
    return {
      mode: "parent_body_fallback",
      sections: [{
        id: "document",
        title: parent.title,
        text: parent.body,
        evidenceRef: parent.sourceRef,
        contentHash: parent.contentHash,
        materiality: declaredMateriality(parent.metadata),
      }],
    };
  }

  const ids = new Set<string>();
  const sections = children.map((child) => {
    const id = sectionIdentity(child);
    if (ids.has(id)) throw new Error("Disclosure section identity is ambiguous; duplicate canonical section titles or donor refs were found.");
    ids.add(id);
    const materiality = declaredMateriality(child.metadata) !== "unknown"
      ? declaredMateriality(child.metadata)
      : declaredMateriality(parent.metadata);
    return {
      id,
      title: logicalSectionTitle(child),
      text: child.body,
      evidenceRef: child.sourceRef,
      contentHash: child.contentHash,
      materiality,
    };
  });
  return { mode: "structured_sections", sections };
}

function sourcePosture(
  parent: P7ProjectDocument,
  mode: DisclosureSourcePosture["sectionMode"],
): DisclosureSourcePosture {
  const kind = disclosureKind(parent);
  if (!kind) throw new Error("Source is not a declared filing, transcript, presentation, or disclosure.");
  return {
    sourceRef: parent.sourceRef,
    contentHash: parent.contentHash,
    title: parent.title.slice(0, 300),
    kind,
    entityRefs: [...parent.entityRefs],
    seriesRef: disclosureSeries(parent),
    materiality: declaredMateriality(parent.metadata),
    sectionMode: mode,
    truth: buildProjectEvidenceTruth({ observedAt: parent.occurredAt, metadata: parent.metadata }),
  };
}

function sourceTime(document: P7ProjectDocument): number {
  const truth = buildProjectEvidenceTruth({ observedAt: document.occurredAt, metadata: document.metadata });
  const value = truth.temporal.asOfAt ? Date.parse(truth.temporal.asOfAt) : Number.NaN;
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function historicalContext(
  documents: readonly P7ProjectDocument[],
  prior: P7ProjectDocument,
  current: P7ProjectDocument,
  allowed: ReadonlySet<string>,
  limit: number,
): DisclosureChangeIntelligence["historicalContext"] {
  const series = new Set([disclosureSeries(prior), disclosureSeries(current)].filter((value): value is string => Boolean(value)));
  const entities = new Set([...prior.entityRefs, ...current.entityRefs]);
  if (!series.size && !entities.size) return [];

  return documents
    .filter((document) => {
      if (document.sourceRef === prior.sourceRef || document.sourceRef === current.sourceRef) return false;
      if (document.metadata.structureKind === "section" || document.metadata.structureKind === "table") return false;
      if (!disclosureKind(document) || !permitted(document, allowed)) return false;
      const seriesMatch = Boolean(disclosureSeries(document) && series.has(disclosureSeries(document)!));
      const entityMatch = document.entityRefs.some((entity) => entities.has(entity));
      return seriesMatch || entityMatch;
    })
    .sort((left, right) => sourceTime(left) - sourceTime(right) || left.sourceRef.localeCompare(right.sourceRef))
    .slice(0, limit)
    .map((document) => ({
      sourceRef: document.sourceRef,
      contentHash: document.contentHash,
      title: document.title.slice(0, 300),
      kind: disclosureKind(document)!,
      entityRefs: [...document.entityRefs],
      seriesRef: disclosureSeries(document),
      truth: buildProjectEvidenceTruth({ observedAt: document.occurredAt, metadata: document.metadata }),
    }));
}

export function buildDisclosureChangeIntelligence(
  documents: readonly P7ProjectDocument[],
  input: {
    priorSourceRef: string;
    currentSourceRef: string;
    allowedSourceRefs?: string[];
    historyLimit?: number;
  },
): DisclosureChangeIntelligence {
  if (input.priorSourceRef === input.currentSourceRef) throw new Error("Prior and current disclosure source refs must be distinct.");
  if (new Set(documents.map((document) => document.projectId)).size > 1) throw new Error("Disclosure comparison cannot combine Projects.");

  const allowed = new Set((input.allowedSourceRefs ?? []).filter(Boolean));
  const prior = documents.find((document) => document.sourceRef === input.priorSourceRef);
  const current = documents.find((document) => document.sourceRef === input.currentSourceRef);
  if (!prior || !current) throw new Error("A requested disclosure source is missing or outside the current Project.");
  if (!permitted(prior, allowed) || !permitted(current, allowed)) throw new Error("A requested disclosure source is excluded or unavailable under the active source allow-list.");
  if (!disclosureKind(prior) || !disclosureKind(current)) throw new Error("Both sources must be declared filings, transcripts, presentations, or disclosures.");

  const priorStructure = canonicalSections(documents, prior, allowed);
  const currentStructure = canonicalSections(documents, current, allowed);
  const priorById = new Map(priorStructure.sections.map((section) => [section.id, section]));
  const currentById = new Map(currentStructure.sections.map((section) => [section.id, section]));
  const diff = comparePrimarySourceFilings({
    priorRef: prior.sourceRef,
    filingRef: current.sourceRef,
    priorSections: priorStructure.sections.map(({ id, title, text }) => ({ id, title, text })),
    currentSections: currentStructure.sections.map(({ id, title, text }) => ({ id, title, text })),
  });

  const changeRows: DisclosureSectionChange[] = [];
  for (const section of diff.addedSections) {
    const after = currentById.get(section.id)!;
    changeRows.push({
      id: section.id,
      title: section.title,
      kind: "added",
      before: "",
      after: section.text.slice(0, 4_000),
      materiality: after.materiality,
      priorSourceRef: prior.sourceRef,
      priorContentHash: prior.contentHash,
      currentSourceRef: current.sourceRef,
      currentContentHash: current.contentHash,
      evidenceRefs: [...new Set([prior.sourceRef, current.sourceRef, after.evidenceRef])],
    });
  }
  for (const section of diff.removedSections) {
    const before = priorById.get(section.id)!;
    changeRows.push({
      id: section.id,
      title: section.title,
      kind: "removed",
      before: section.text.slice(0, 4_000),
      after: "",
      materiality: before.materiality,
      priorSourceRef: prior.sourceRef,
      priorContentHash: prior.contentHash,
      currentSourceRef: current.sourceRef,
      currentContentHash: current.contentHash,
      evidenceRefs: [...new Set([prior.sourceRef, current.sourceRef, before.evidenceRef])],
    });
  }
  for (const section of diff.changedSections) {
    const before = priorById.get(section.id)!;
    const after = currentById.get(section.id)!;
    changeRows.push({
      id: section.id,
      title: section.title,
      kind: "modified",
      before: section.beforeExcerpt.slice(0, 4_000),
      after: section.afterExcerpt.slice(0, 4_000),
      materiality: after.materiality !== "unknown" ? after.materiality : before.materiality,
      priorSourceRef: prior.sourceRef,
      priorContentHash: prior.contentHash,
      currentSourceRef: current.sourceRef,
      currentContentHash: current.contentHash,
      evidenceRefs: [...new Set([prior.sourceRef, current.sourceRef, before.evidenceRef, after.evidenceRef])],
    });
  }

  const maxChanges = 60;
  const historyLimit = Math.min(20, Math.max(0, Math.trunc(input.historyLimit ?? 8)));
  return {
    prior: sourcePosture(prior, priorStructure.mode),
    current: sourcePosture(current, currentStructure.mode),
    changes: changeRows.slice(0, maxChanges),
    unchangedSections: diff.unchangedSectionCount,
    omittedChanges: Math.max(0, changeRows.length - maxChanges),
    historicalContext: historicalContext(documents, prior, current, allowed, historyLimit),
  };
}

const inputSchema = z.object({
  priorSourceRef: z.string().trim().min(1).max(1_000),
  currentSourceRef: z.string().trim().min(1).max(1_000),
  historyLimit: z.number().int().min(0).max(20).default(8),
}).strict();
const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();
const outputSchema = z.object({
  output: z.unknown(),
  summary: z.string().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().max(1_000)).max(100),
}).strict();

export const disclosureChangesTool: ConversationToolDefinition = {
  id: "lios.project.disclosure_changes",
  label: "Compare permitted filing and IR disclosure changes with exact source lineage",
  kind: "retrieve",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema,
  outputSchema: outputSchema.transform((value): ConversationToolResult => ({ ...value, output: value.output })),
  maxOutputBytes: 256 * 1024,
  cancel: null,
  invoke: async (input, signal, call) => {
    assertNotAborted(signal);
    if (call.source === "agent" && call.resourceTransmissionAllowed === false) {
      throw new Error("Project resource transmission is disabled; no disclosure evidence was read.");
    }
    if (!sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
      throw new Error("Disclosure change intelligence requires Auto or My Data scope.");
    }
    const tenant = tenantSchema.parse(call.tenant);
    if (call.userId !== tenant.userId || !call.requestId || !Number.isSafeInteger(call.projectId) || (call.projectId ?? 0) <= 0) {
      throw new Error("Disclosure change intelligence requires authenticated Project context.");
    }
    const parsed = inputSchema.parse(input);
    const ctx = tenantContext({ id: tenant.userId, organizationId: tenant.organizationId, role: tenant.role });
    const documents = await listProjectIntelligenceDocuments(ctx, call.projectId!);
    const result = buildDisclosureChangeIntelligence(documents, {
      ...parsed,
      allowedSourceRefs: call.allowedSourceRefs,
    });
    assertNotAborted(signal);
    const sourceRefs = [...new Set([
      result.prior.sourceRef,
      result.current.sourceRef,
      ...result.changes.flatMap((change) => change.evidenceRefs),
      ...result.historicalContext.map((item) => item.sourceRef),
    ])].slice(0, 100);
    return {
      output: result,
      summary: result.changes.length
        ? result.changes.length + " deterministic disclosure section change(s); materiality is source-declared only and absent declarations remain unknown."
        : "No deterministic section change was found between the two permitted disclosure sources.",
      deterministic: true,
      sourceRefs,
    };
  },
};
