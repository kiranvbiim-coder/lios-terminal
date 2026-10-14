import type { P7ProjectDocument } from "@shared/p7ResearchContracts";
import { buildUnifiedTimeline } from "./p7ProjectIntelligence";

export type P7TimelineIntelligenceKind = "filing" | "decision" | "transaction" | "change" | "event";

export interface P7TimelineChangeLink {
  relation: "supersedes" | "changes";
  targetRef: string;
}

export interface P7TimelineIntelligenceEvent {
  id: string;
  at: string;
  effectiveAt: string | null;
  kind: P7TimelineIntelligenceKind;
  title: string;
  summary: string;
  sourceRef: string;
  sourceRefs: string[];
  entityRefs: string[];
  instrumentRefs: string[];
  artifactRefs: string[];
  modelRefs: string[];
  decisionRef: string | null;
  transactionRef: string | null;
  eventType: string | null;
  changeLinks: P7TimelineChangeLink[];
}

export interface P7TimelineIntelligence {
  schemaVersion: "1";
  projectId: number | null;
  deterministic: true;
  events: P7TimelineIntelligenceEvent[];
  counts: Partial<Record<P7TimelineIntelligenceKind, number>>;
  truncation: {
    truncated: boolean;
    maxEvents: number;
    omittedEvents: number;
  };
}

const EXPLICIT_CHANGE_TIMELINE_TYPES = new Set(["metric_revision", "model_change"]);
const EXPLICIT_CHANGE_LEDGER_TYPES = new Set([
  "state.changed",
  "state.reverted",
  "policy.changed",
  "artifact.versioned",
]);

function metadataString(document: P7ProjectDocument, key: string): string | null {
  const value = document.metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataStrings(document: P7ProjectDocument, key: string): string[] {
  const value = document.metadata[key];
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim()))];
}

function explicitChangeLinks(document: P7ProjectDocument): P7TimelineChangeLink[] {
  const raw = Array.isArray(document.metadata.relations) ? document.metadata.relations : [];
  const links: P7TimelineChangeLink[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const relation = item as Record<string, unknown>;
    if (relation.type !== "supersedes" && relation.type !== "changes") continue;
    const targetRef = typeof relation.targetRef === "string" ? relation.targetRef.trim() : "";
    if (!targetRef || targetRef === document.sourceRef) continue;
    links.push({ relation: relation.type, targetRef });
  }
  return [...new Map(links.map((link) => [`${link.relation}\u0000${link.targetRef}`, link])).values()]
    .sort((left, right) => left.relation.localeCompare(right.relation) || left.targetRef.localeCompare(right.targetRef));
}

function classifyTimelineEvent(
  document: P7ProjectDocument,
  changeLinks: readonly P7TimelineChangeLink[],
): P7TimelineIntelligenceKind {
  const timelineEventType = metadataString(document, "timelineEventType");
  const eventType = metadataString(document, "eventType");
  const transactionRef = metadataString(document, "transactionRef");

  if (timelineEventType === "transaction" || transactionRef) return "transaction";
  if (document.sourceType === "filing" || timelineEventType === "filing") return "filing";
  if (document.sourceType === "decision" || timelineEventType === "decision" || eventType === "decision.recorded") return "decision";
  if (
    (timelineEventType && EXPLICIT_CHANGE_TIMELINE_TYPES.has(timelineEventType))
    || (eventType && EXPLICIT_CHANGE_LEDGER_TYPES.has(eventType))
    || changeLinks.length > 0
  ) return "change";
  return "event";
}

export function buildP7TimelineIntelligence(
  documents: readonly P7ProjectDocument[],
  options: { maxEvents?: number } = {},
): P7TimelineIntelligence {
  const projectIds = [...new Set(documents.map((document) => document.projectId))];
  if (projectIds.length > 1) throw new Error("Timeline intelligence cannot combine multiple Projects.");

  const maxEvents = Math.min(Math.max(Math.trunc(options.maxEvents ?? 1_000), 1), 5_000);
  const byId = new Map(documents.map((document) => [document.id, document]));
  const baseTimeline = buildUnifiedTimeline([...documents]);
  const projected = baseTimeline.map((base): P7TimelineIntelligenceEvent => {
    const documentId = base.id.startsWith("timeline:") ? base.id.slice("timeline:".length) : "";
    const document = byId.get(documentId);
    if (!document) throw new Error("Timeline intelligence lost its canonical Project document linkage.");
    const changeLinks = explicitChangeLinks(document);
    const timelineEventType = metadataString(document, "timelineEventType");
    const eventType = metadataString(document, "eventType");
    return {
      id: `timeline-intelligence:${document.id}`,
      at: base.at,
      effectiveAt: metadataString(document, "effectiveAt"),
      kind: classifyTimelineEvent(document, changeLinks),
      title: base.title,
      summary: base.summary,
      sourceRef: document.sourceRef,
      sourceRefs: base.sourceRefs,
      entityRefs: base.entityRefs,
      instrumentRefs: metadataStrings(document, "instrumentRefs"),
      artifactRefs: base.artifactRefs,
      modelRefs: base.modelRefs,
      decisionRef: base.decisionRef,
      transactionRef: metadataString(document, "transactionRef"),
      eventType: timelineEventType ?? eventType,
      changeLinks,
    };
  });

  const events = projected.slice(0, maxEvents);
  const counts: Partial<Record<P7TimelineIntelligenceKind, number>> = {};
  for (const event of events) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  const omittedEvents = Math.max(0, projected.length - events.length);
  return {
    schemaVersion: "1",
    projectId: projectIds[0] ?? null,
    deterministic: true,
    events,
    counts,
    truncation: {
      truncated: omittedEvents > 0,
      maxEvents,
      omittedEvents,
    },
  };
}
