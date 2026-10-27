import type { PerspectiveGroup, PerspectiveLink } from "./researchPerspectives";

/** One saved relationship, counted as ONE recorded ledger edge.
 * The three stages are role-separated to avoid Sankey cycles (A↔B) and
 * preserve identity. They are not physical flows or numerical weights. */
export interface RecordedFlowRow {
  id: number;
  fromEvidenceId: number;
  fromTitle: string;
  toEvidenceId: number;
  toTitle: string;
  relationType: string;
  group: PerspectiveGroup;
  note: string | null;
}
export interface RecordedEvidenceFlow {
  rows: RecordedFlowRow[];
  nodes: Array<{ name: string; label: string; itemStyle: { color: string } }>;
  links: Array<{ source: string; target: string; value: 1 }>;
  totalRecordedLinks: number;
  omittedLinks: number;
}

export const RECORDED_FLOW_LIMIT = 16;
const GROUP_TONES: Record<PerspectiveGroup, string> = {
  support: "#6ee7b7",
  challenge: "#fda4af",
  context: "#67e8f9",
};

/** Pure typed source projection, never a new relationship/AI opinion engine.
 * Caller supplies only authorized, source-resolved PerspectiveLinks after
 * canonical search/group filters. Does not create cross-linked Sankey nodes. */
export function projectRecordedEvidenceFlow(
  links: readonly PerspectiveLink[],
  maxLinks = RECORDED_FLOW_LIMIT,
): RecordedEvidenceFlow {
  const limit = Number.isFinite(maxLinks) ? Math.max(1, Math.min(32, Math.floor(maxLinks))) : RECORDED_FLOW_LIMIT;
  const accepted: PerspectiveLink[] = [];
  const seenIds = new Set<number>();
  for (const link of links) {
    if (!Number.isSafeInteger(link.id) || !Number.isSafeInteger(link.from?.id) || !Number.isSafeInteger(link.to?.id) ||
      !link.from || !link.to || seenIds.has(link.id) ||
      !["supports", "contradicts", "supersedes", "derived_from", "affects", "cites"].includes(link.type)) continue;
    seenIds.add(link.id);
    accepted.push(link);
  }
  const visible = accepted.slice(0, limit);
  const nodeMap = new Map<string, RecordedEvidenceFlow["nodes"][number]>();
  const edges: RecordedEvidenceFlow["links"] = [];
  const rows: RecordedFlowRow[] = [];
  const add = (name: string, label: string, color: string) => {
    if (!nodeMap.has(name)) nodeMap.set(name, { name, label, itemStyle: { color } });
  };
  for (const link of visible) {
    const from = `from:${link.from.id}`;
    const via = `relation:${link.id}`;
    const to = `to:${link.to.id}`;
    add(from, `E${link.from.id} · ${link.from.title.slice(0, 70)}`, "#d4d4d8");
    add(via, link.type.replaceAll("_", " "), GROUP_TONES[link.group]);
    add(to, `E${link.to.id} · ${link.to.title.slice(0, 70)}`, "#d4d4d8");
    edges.push({ source: from, target: via, value: 1 });
    edges.push({ source: via, target: to, value: 1 });
    rows.push({
      id: link.id, fromEvidenceId: link.from.id, toEvidenceId: link.to.id,
      fromTitle: link.from.title, toTitle: link.to.title, relationType: link.type,
      group: link.group, note: link.note,
    });
  }
  return {
    rows, nodes: [...nodeMap.values()], links: edges,
    totalRecordedLinks: accepted.length,
    omittedLinks: Math.max(0, accepted.length - visible.length),
  };
}
