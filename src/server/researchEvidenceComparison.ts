/**
 * P7 evidence comparison over the exact currently AI-permitted source set.
 * Literal matches are citations for review, not adjudicated facts or contradictions.
 */
import { z } from "zod";
import type { ComposedResearchSource } from "@shared/researchSourceComposition";

export const researchComparisonFacetsSchema = z.array(z.string().trim().min(2).max(80))
  .max(6).default([]).refine(
    items => new Set(items.map(item => item.toLowerCase())).size === items.length,
    "Research comparison facets must be distinct.",
  );

export const researchEvidenceComparisonRowSchema = z.object({
  documentId: z.string().trim().min(1).max(300),
  sourceRef: z.string().trim().min(1).max(1000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceClass: z.enum(["public_external", "broker_research", "expert_content", "internal_research", "user_file"]),
  occurredAt: z.string().datetime({ offset: true }).nullable(),
  passage: z.string().trim().min(1).max(420),
}).strict();

export const researchEvidenceComparisonFacetSchema = z.object({
  facet: z.string().trim().min(2).max(80),
  status: z.enum(["observed_in_retrieved_excerpts", "not_observed_in_retrieved_excerpts"]),
  matchingSources: z.number().int().min(0).max(50),
  inspectedSources: z.number().int().min(0).max(50),
  omittedMatches: z.number().int().min(0).max(50),
  agreement: z.literal("not_assessed"),
  rows: z.array(researchEvidenceComparisonRowSchema).max(12),
}).strict();

export const RESEARCH_EVIDENCE_COMPARISON_LIMITATION =
  "Only literal phrase matches in retrieved excerpts of AI-permitted, current-revision sources are reported. No match does not prove the topic is absent. Agreement, contradictions, units, periods, source independence and truth are not established.";

type PermittedSource = Pick<ComposedResearchSource,
  "documentId" | "sourceRef" | "sourceClass" | "occurredAt" | "contentHash">;
export interface FacetHits {
  facet: string;
  hits: readonly { documentId: string; contentHash: string; excerpt: string }[];
}

function phrasePassage(excerpt: string, facet: string): string | null {
  const text = excerpt.toLocaleLowerCase();
  const needle = facet.toLocaleLowerCase();
  let from = 0;
  while (from < text.length) {
    const index = text.indexOf(needle, from);
    if (index === -1) return null;
    const after = index + needle.length;
    const beforeCharacter = text[index - 1];
    const afterCharacter = text[after];
    const isWord = (character: string | undefined) => Boolean(character && /[\p{L}\p{N}]/u.test(character));
    if (!isWord(beforeCharacter) && !isWord(afterCharacter)) {
      return excerpt.slice(Math.max(0, index - 100), Math.min(excerpt.length, after + 180))
        .replace(/\s+/g, " ").trim().slice(0, 420);
    }
    from = after;
  }
  return null;
}

/** Caller must compose entitlement-filtered P7 sources before invoking. */
export function comparePermittedResearchEvidence(
  rawFacets: readonly string[], sources: readonly PermittedSource[], results: readonly FacetHits[],
): z.infer<typeof researchEvidenceComparisonFacetSchema>[] {
  const facets = researchComparisonFacetsSchema.parse([...rawFacets]);
  if (sources.length > 50 || results.length > 6 || results.some(item => item.hits.length > 50)) {
    throw new RangeError("Research comparison exceeds its permitted source/facet budget.");
  }
  const permitted = new Map<string, PermittedSource>();
  for (const source of sources) {
    if (permitted.has(source.documentId)) throw new Error("Duplicate permitted research document.");
    permitted.set(source.documentId, source);
  }
  const byFacet = new Map<string, FacetHits["hits"]>();
  for (const result of results) {
    const key = result.facet.toLowerCase();
    if (byFacet.has(key)) throw new Error("Duplicate research comparison facet search.");
    byFacet.set(key, result.hits);
  }
  return facets.map(facet => {
    const rows: z.infer<typeof researchEvidenceComparisonRowSchema>[] = [];
    const seen = new Set<string>();
    for (const hit of byFacet.get(facet.toLowerCase()) ?? []) {
      const source = permitted.get(hit.documentId);
      if (!source || source.contentHash !== hit.contentHash || seen.has(source.sourceRef)) continue;
      const passage = phrasePassage(hit.excerpt, facet);
      if (!passage) continue;
      seen.add(source.sourceRef);
      rows.push({
        documentId: source.documentId, sourceRef: source.sourceRef,
        contentHash: source.contentHash, sourceClass: source.sourceClass,
        occurredAt: source.occurredAt, passage,
      });
    }
    return researchEvidenceComparisonFacetSchema.parse({
      facet,
      status: rows.length ? "observed_in_retrieved_excerpts" : "not_observed_in_retrieved_excerpts",
      matchingSources: rows.length, inspectedSources: sources.length,
      omittedMatches: Math.max(0, rows.length - 12),
      agreement: "not_assessed", rows: rows.slice(0, 12),
    });
  });
}
