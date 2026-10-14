/**
 * GraphRAG-derived, source-scoped relationship ranking under LiOS P7.
 *
 * Original: microsoft/graphrag @ 769542fbf1d8e5b4c6a8677fefc34621c87894c5 (MIT)
 * - packages/graphrag/graphrag/query/input/retrieval/relationships.py
 *   get_in_network_relationships, sort_relationships_by_rank
 * - packages/graphrag/graphrag/query/context_builder/source_context.py
 *   source-evidence selection for a bounded context
 *
 * LiOS adaptation: project/tenant and entitlement filtering MUST happen in
 * the canonical P7 source composer before this pure ranking helper is called.
 * This code never accepts graph nodes, third-party services, or model-written
 * citations; a link is a co-mention, not a verified causal relationship.
 * No GraphRAG DB, embeddings, prompt, source index or model runtime imported.
 */
import type { ComposedResearchSource } from "@shared/researchSourceComposition";
import { z } from "zod";

export const GRAPHRAG_SOURCE_LINEAGE = Object.freeze({
  repository: "microsoft/graphrag",
  commit: "769542fbf1d8e5b4c6a8677fefc34621c87894c5",
  license: "MIT",
  kind: "source_scoped_retrieval_mechanics",
  importedRuntime: false,
});

export const permittedEvidenceLinkSchema = z.object({
  leftSourceRef: z.string().trim().min(1).max(1_000),
  rightSourceRef: z.string().trim().min(1).max(1_000),
  sharedEntityCount: z.number().int().min(1).max(500),
}).strict();
export type PermittedEvidenceLink = z.infer<typeof permittedEvidenceLinkSchema>;

type AllowedSource = Pick<ComposedResearchSource, "sourceRef" | "entityRefs">;

/**
 * Only compare explicitly AI-permitted P7 sources. Never deduce missing edges
 * or include blocked/unentitled document IDs. Rank independent source pairs by
 * number of exact canonical P5 entity references they share; no source prose.
 */
export function rankPermittedEvidenceLinks(
  allowed: readonly AllowedSource[],
  { maxLinks = 50 }: { maxLinks?: number } = {},
): PermittedEvidenceLink[] {
  if (!Number.isSafeInteger(maxLinks) || maxLinks < 0 || maxLinks > 100) {
    throw new RangeError("GraphRAG links require an explicit budget of 0–100.");
  }
  if (!Array.isArray(allowed) || allowed.length > 50) {
    throw new RangeError("GraphRAG links accept only the 50-source bounded P7 composition.");
  }
  const seen = new Set<string>();
  const normalized = allowed.map(item => {
    if (!item || typeof item.sourceRef !== "string" || !item.sourceRef.trim()
      || item.sourceRef.length > 1_000 || !Array.isArray(item.entityRefs)
      || item.entityRefs.length > 500) {
      throw new TypeError("GraphRAG context requires existing P7 source refs and entity refs.");
    }
    const ref = item.sourceRef.trim();
    if (seen.has(ref)) throw new Error("Duplicate canonical source reference in context.");
    seen.add(ref);
    const entities = new Set<string>();
    for (const id of item.entityRefs) {
      if (typeof id !== "string" || !id.trim() || id.length > 500) {
        throw new TypeError("GraphRAG relationship keys must be canonical nonempty entity references.");
      }
      entities.add(id.trim());
    }
    return { ref, entities };
  }).sort((a, b) => a.ref.localeCompare(b.ref, "en"));

  const links: PermittedEvidenceLink[] = [];
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const left = normalized[i], right = normalized[j];
      let count = 0;
      for (const entity of left.entities) if (right.entities.has(entity)) count += 1;
      if (count) links.push({
        leftSourceRef: left.ref, rightSourceRef: right.ref,
        sharedEntityCount: count,
      });
    }
  }
  links.sort((a,b) =>
    b.sharedEntityCount-a.sharedEntityCount ||
    a.leftSourceRef.localeCompare(b.leftSourceRef,"en") ||
    a.rightSourceRef.localeCompare(b.rightSourceRef,"en")
  );
  return links.slice(0,maxLinks).map(link => permittedEvidenceLinkSchema.parse(link));
}

/**
 * A GraphRAG-inspired relationship neighborhood over P7-authorized sources.
 * This adapts get_candidate_relationships / get_in_network_relationships and
 * source_context.count_relationships without importing donor models or data.
 *
 * Direct/two-hop references are only co-mention navigation hints. A two-hop
 * path is NOT evidence that the endpoints mention the same entity, that any
 * relationship is causal, or that an underlying claim is verified.
 */
export const permittedEvidenceNeighborhoodSchema = z.object({
  sourceRef: z.string().trim().min(1).max(1_000),
  directSourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(49),
  twoHopSourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(49),
  directLinkCount: z.number().int().min(1).max(49),
  sharedEntityMentions: z.number().int().min(1).max(24_500),
}).strict();
export type PermittedEvidenceNeighborhood = z.infer<typeof permittedEvidenceNeighborhoodSchema>;

export function buildPermittedEvidenceNeighborhoods(
  allowed: readonly AllowedSource[],
  links: readonly PermittedEvidenceLink[],
): PermittedEvidenceNeighborhood[] {
  // The source list is the P7-rights-gated authority; edges must be derived
  // from precisely this list, not from a broader upstream or shadow graph.
  if (!Array.isArray(allowed) || allowed.length > 50 || !Array.isArray(links) || links.length > 100) {
    throw new RangeError("GraphRAG neighborhoods exceed the bounded permitted source context.");
  }
  const sourceRefs = new Set<string>();
  for (const source of allowed) {
    if (!source || typeof source.sourceRef !== "string" || !source.sourceRef.trim() ||
        source.sourceRef.length > 1_000 || sourceRefs.has(source.sourceRef.trim())) {
      throw new TypeError("GraphRAG neighborhoods require unique canonical permitted source references.");
    }
    sourceRefs.add(source.sourceRef.trim());
  }
  const adjacency = new Map<string, Map<string,number>>();
  for (const ref of sourceRefs) adjacency.set(ref,new Map());
  for (const raw of links) {
    const link = permittedEvidenceLinkSchema.parse(raw);
    const {leftSourceRef: left,rightSourceRef: right,sharedEntityCount: count} = link;
    if (left === right || !sourceRefs.has(left) || !sourceRefs.has(right) ||
        adjacency.get(left)!.has(right)) {
      throw new Error("GraphRAG neighborhood contains a duplicate or unpermitted source edge.");
    }
    adjacency.get(left)!.set(right,count);
    adjacency.get(right)!.set(left,count);
  }
  const out: PermittedEvidenceNeighborhood[] = [];
  for (const ref of [...sourceRefs].sort((a,b)=>a.localeCompare(b,"en"))) {
    const direct=adjacency.get(ref)!;
    if (!direct.size) continue;
    const oneHop=[...direct].sort(([a,ac],[b,bc])=>bc-ac||a.localeCompare(b,"en")).map(([name])=>name);
    const twoHop=new Set<string>();
    for (const neighbor of direct.keys()) {
      for (const possible of adjacency.get(neighbor)!.keys()) {
        if (possible!==ref && !direct.has(possible)) twoHop.add(possible);
      }
    }
    out.push(permittedEvidenceNeighborhoodSchema.parse({
      sourceRef:ref,
      directSourceRefs:oneHop,
      twoHopSourceRefs:[...twoHop].sort((a,b)=>a.localeCompare(b,"en")),
      directLinkCount:direct.size,
      sharedEntityMentions:[...direct.values()].reduce((sum,n)=>sum+n,0),
    }));
  }
  return out;
}
