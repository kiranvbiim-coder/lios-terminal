/**
 * Read-only Perspectives projection over an authorized InvestigationDetail.
 * "Supports" and "contradicts" describe explicitly recorded *evidence edges*,
 * never an inferred publisher stance, political leaning or truth classification.
 * No new source of truth, moderation model, sentiment inference or API.
 */
export interface PerspectiveEvidence {
  id: number;
  evidenceType: string;
  evidenceKind: string;
  title: string;
  excerpt: string | null;
  annotation: string | null;
  sourceName: string;
  provider: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  retrievedAt: string;
}

export type PerspectiveRelationType = "supports" | "contradicts" | "supersedes" | "derived_from" | "affects" | "cites";
export interface PerspectiveRelation {
  id: number;
  fromEvidenceId: number;
  toEvidenceId: number;
  relationshipType: PerspectiveRelationType;
  note: string | null;
}

export type PerspectiveGroup = "support" | "challenge" | "context";
export interface PerspectiveLink {
  id: number;
  group: PerspectiveGroup;
  type: PerspectiveRelationType;
  note: string | null;
  from: PerspectiveEvidence;
  to: PerspectiveEvidence;
}

export interface PerspectiveModel {
  links: PerspectiveLink[];
  unlinked: PerspectiveEvidence[];
  unresolvedCount: number;
  sourceCount: number;
  providerCount: number;
  supportCount: number;
  challengeCount: number;
  contextCount: number;
  evidenceCount: number;
}

export function relationshipGroup(type: PerspectiveRelationType): PerspectiveGroup {
  if (type === "supports") return "support";
  if (type === "contradicts") return "challenge";
  return "context";
}

export function buildPerspectiveModel(
  evidence: readonly PerspectiveEvidence[],
  relationships: readonly PerspectiveRelation[],
): PerspectiveModel {
  const byId = new Map(evidence.map(item => [item.id, item]));
  const linkedIds = new Set<number>();
  let unresolvedCount = 0;
  const links: PerspectiveLink[] = [];
  for (const relation of relationships) {
    const from = byId.get(relation.fromEvidenceId);
    const to = byId.get(relation.toEvidenceId);
    if (!from || !to) { unresolvedCount++; continue; }
    linkedIds.add(from.id);
    linkedIds.add(to.id);
    links.push({
      id: relation.id, type: relation.relationshipType, group: relationshipGroup(relation.relationshipType),
      note: relation.note, from, to,
    });
  }
  const providers = new Set(evidence.map(item => item.provider.trim()).filter(Boolean));
  const sources = new Set(evidence.map(item => item.sourceName.trim()).filter(Boolean));
  return {
    links,
    unlinked: evidence.filter(item => !linkedIds.has(item.id)),
    unresolvedCount,
    sourceCount: sources.size,
    providerCount: providers.size,
    supportCount: links.filter(link => link.group === "support").length,
    challengeCount: links.filter(link => link.group === "challenge").length,
    contextCount: links.filter(link => link.group === "context").length,
    evidenceCount: evidence.length,
  };
}

/** Text search matches *recorded* content only; it cannot label a source's opinion. */
export function filterPerspectiveLinks(
  links: readonly PerspectiveLink[],
  query: string,
  group: PerspectiveGroup | "all",
): PerspectiveLink[] {
  const q = query.trim().toLocaleLowerCase();
  return links.filter(link => {
    if (group !== "all" && link.group !== group) return false;
    if (!q) return true;
    return [
      link.type, link.note, link.from.title, link.from.excerpt, link.from.annotation,
      link.from.sourceName, link.from.provider, link.to.title, link.to.excerpt,
      link.to.annotation, link.to.sourceName, link.to.provider,
    ].some(value => value?.toLocaleLowerCase().includes(q));
  });
}

export function filterUnlinkedEvidence(evidence: readonly PerspectiveEvidence[], query: string): PerspectiveEvidence[] {
  const q = query.trim().toLocaleLowerCase();
  return q ? evidence.filter(item => [
    item.title, item.excerpt, item.sourceName, item.provider, item.annotation, item.evidenceKind,
  ].some(value => value?.toLocaleLowerCase().includes(q))) : [...evidence];
}

export function perspectivePublishedDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Publication date not recorded";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

// This is a lens on a single SAVED evidence record, not a generated claim or
// classifier. Only incoming "supports" / "contradicts" edges describe
// explicit relationships TO this target; other edges remain context.
export interface RecordedEvidenceClaimLens {
  target: PerspectiveEvidence;
  supporting: PerspectiveLink[];
  challenging: PerspectiveLink[];
  context: PerspectiveLink[];
  outgoing: PerspectiveLink[];
  unlinked: boolean;
}

export function inspectRecordedEvidenceClaim(
  evidence: readonly PerspectiveEvidence[],
  relations: readonly PerspectiveRelation[],
  targetId: number,
): RecordedEvidenceClaimLens | null {
  const target = evidence.find(row => row.id === targetId);
  if (!target) return null;
  const related = buildPerspectiveModel(evidence, relations).links;
  const incoming = related.filter(edge => edge.to.id === targetId && edge.from.id !== targetId);
  const outgoing = related.filter(edge => edge.from.id === targetId && edge.to.id !== targetId);
  return {
    target,
    supporting: incoming.filter(edge => edge.type === "supports"),
    challenging: incoming.filter(edge => edge.type === "contradicts"),
    context: incoming.filter(edge => edge.type !== "supports" && edge.type !== "contradicts"),
    outgoing,
    unlinked: !incoming.length && !outgoing.length,
  };
}
