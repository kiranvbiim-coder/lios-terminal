import { financialEventSchema, type FinancialEvent, type FinancialEventClass } from "@shared/financialEventContracts";
import type { P7ProjectDocument } from "@shared/p7ResearchContracts";
import type { TenantContext } from "./tenantContext";
import { listProjectIntelligenceDocuments } from "./p7ProjectIntelligenceStore";
import { p7Hash } from "./p7ProjectIntelligence";
import { buildProjectEvidenceTruth, type ProjectEvidenceTruthPosture } from "./projectEvidenceTruth";

export interface ProjectFinancialEvent {
  ref: string;
  event: FinancialEvent;
  title: string;
  excerpt: string;
  observedAt: string | null;
  sourceRef: string;
  contentHash: string;
  artifactRef: string | null;
  truth: ProjectEvidenceTruthPosture;
}
export interface ProjectFinancialEventGraph {
  nodes: Array<{ ref: string; kind: "event" | "referenced_subject"; eventClass?: FinancialEventClass }>;
  edges: Array<{
    ref: string; eventRef: string; fromRef: string; toRef: string;
    relation: FinancialEvent["relationships"][number]["relation"];
    impact: FinancialEvent["relationships"][number]["impact"];
    sourceRefs: string[]; contentHash: string;
  }>;
}
export interface ProjectFinancialEvents {
  status: "available" | "unknown" | "unavailable";
  events: ProjectFinancialEvent[];
  graph: ProjectFinancialEventGraph;
  omittedEvents: number;
  invalidDeclarations: number;
  reason: string | null;
}

/** Pure bounded projection over existing source-policy-filtered P7 documents; no prose inference or event persistence. */
export function projectFinancialEventProjection(
  documents: readonly P7ProjectDocument[],
  options: { eventClasses?: FinancialEventClass[]; entityRef?: string; limit?: number; allowedSourceRefs?: string[]; maxOutputBytes?: number } = {},
): ProjectFinancialEvents {
  if (new Set(documents.map(doc => doc.projectId)).size > 1) throw new Error("Financial event projection cannot combine Projects.");
  const allowed = new Set(options.allowedSourceRefs ?? []);
  const classes = new Set(options.eventClasses ?? []);
  const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 20)));
  let invalidDeclarations = 0;
  const candidates: ProjectFinancialEvent[] = [];
  for (const doc of documents) {
    const wholeDocumentAllowed = !allowed.size || allowed.has(doc.sourceRef);
    if (!wholeDocumentAllowed && !doc.sourceRefs.some(ref => allowed.has(ref))) continue;
    if (doc.metadata.financialEvent === undefined) continue;
    const parsed = financialEventSchema.safeParse(doc.metadata.financialEvent);
    if (!parsed.success) { invalidDeclarations += 1; continue; }
    const declared = parsed.data;
    if (classes.size && !classes.has(declared.eventClass)) continue;
    if (options.entityRef && !declared.entityRefs.includes(options.entityRef)) continue;
    const sourceRefs = declared.sourceRefs.filter(ref => wholeDocumentAllowed || allowed.has(ref));
    if (!sourceRefs.length) continue;
    const citations = new Set(sourceRefs);
    const event: FinancialEvent = {
      ...declared, sourceRefs,
      relationships: declared.relationships.filter(relationship => relationship.sourceRefs.every(ref => citations.has(ref))),
    };
    const artifactId = typeof doc.metadata.artifactId === "string" ? doc.metadata.artifactId : null;
    const version = typeof doc.metadata.artifactVersion === "number" ? doc.metadata.artifactVersion : null;
    candidates.push({
      ref: `financial-event:${p7Hash({ sourceRef: doc.sourceRef, contentHash: doc.contentHash, id: event.id }).slice(0, 32)}`,
      event, title: doc.title.slice(0, 300), excerpt: doc.body.slice(0, 700),
      observedAt: doc.occurredAt, sourceRef: doc.sourceRef, contentHash: doc.contentHash,
      artifactRef: artifactId && version ? `${artifactId}@v${version}` : null,
      truth: buildProjectEvidenceTruth({ observedAt: doc.occurredAt, metadata: { ...doc.metadata, effectiveAt: event.effectiveAt, modelPeriod: event.period } }),
    });
  }
  const chronologicalTime = (item: ProjectFinancialEvent) => {
    const at = item.event.effectiveAt ?? item.observedAt;
    return at ? Date.parse(at) : Number.NEGATIVE_INFINITY;
  };
  candidates.sort((a, b) => chronologicalTime(b) - chronologicalTime(a) || a.ref.localeCompare(b.ref));
  const events = candidates.slice(0, limit);
  const maxOutputBytes = Math.min(512 * 1024, Math.max(1_024, options.maxOutputBytes ?? 128 * 1024));
  const graphFor = (): ProjectFinancialEventGraph => {
    const nodes = new Map<string, ProjectFinancialEventGraph["nodes"][number]>();
    const edges: ProjectFinancialEventGraph["edges"] = [];
    for (const item of events) nodes.set(item.ref, { ref: item.ref, kind: "event", eventClass: item.event.eventClass });
    const addSubject = (reference: string) => {
      if (!nodes.has(reference)) nodes.set(reference, { ref: reference, kind: "referenced_subject" });
    };
    for (const item of events) {
      for (const reference of [...item.event.entityRefs, ...item.event.instrumentRefs]) addSubject(reference);
      for (const relationship of item.event.relationships) {
        addSubject(relationship.fromRef);
        addSubject(relationship.toRef);
        edges.push({
          ref: `financial-impact:${p7Hash({ eventRef: item.ref, relationship }).slice(0, 32)}`,
          eventRef: item.ref, ...relationship, contentHash: item.contentHash,
        });
      }
    }
    return { nodes: [...nodes.values()], edges };
  };
  const resultFor = (): ProjectFinancialEvents => ({
    status: events.length ? "available" : candidates.length ? "unavailable" : "unknown", events,
    graph: graphFor(), omittedEvents: Math.max(0, candidates.length - events.length), invalidDeclarations,
    reason: events.length ? null : candidates.length
      ? "Matching financial events exceed the bounded result budget; no partial event was represented as complete."
      : "No matching permitted structured financial event is declared; LiOS did not infer one from prose.",
  });
  let result = resultFor();
  while (events.length && Buffer.byteLength(JSON.stringify(result), "utf8") > maxOutputBytes) {
    events.pop();
    result = resultFor();
  }
  return result;
}

export async function currentProjectFinancialEvents(
  ctx: TenantContext, projectId: number,
  options: Parameters<typeof projectFinancialEventProjection>[1] = {},
): Promise<ProjectFinancialEvents> {
  // Intentionally no lazy rebuild: this read must never write or parse additional files without approval.
  return projectFinancialEventProjection(await listProjectIntelligenceDocuments(ctx, projectId), options);
}
