import type { IntelligenceCard } from "@shared/waveDContracts";

/** Display-only facets over already-authorized Wave D intelligence. */
export type IntelligenceSearchFacet = "all" | "research" | "markets" | "signals";
export const INTELLIGENCE_SEARCH_FACETS: ReadonlyArray<{ value: IntelligenceSearchFacet; label: string }> = [
  { value: "all", label: "All" },
  { value: "research", label: "Research" },
  { value: "markets", label: "Markets" },
  { value: "signals", label: "Signals" },
];

const RESEARCH = new Set<IntelligenceCard["kind"]>(["news", "research", "report", "ai_insight", "community_idea"]);
const MARKETS = new Set<IntelligenceCard["kind"]>(["market_move", "earnings", "portfolio", "valuation", "macro"]);
const SIGNALS = new Set<IntelligenceCard["kind"]>(["alert", "workflow", "email"]);

export function intelligenceMatchesFacet(card: IntelligenceCard, facet: IntelligenceSearchFacet): boolean {
  if (facet === "all") return true;
  return facet === "research" ? RESEARCH.has(card.kind)
    : facet === "markets" ? MARKETS.has(card.kind) : SIGNALS.has(card.kind);
}

/**
 * Search only current, server-returned cards; no inferred media, no web calls,
 * no scores re-ranked on the client, and no fabricated search results.
 * Search source names only, never URL/query strings containing credentials.
 */
export function searchRecordedIntelligence(cards: readonly IntelligenceCard[], query: string, facet: IntelligenceSearchFacet, limit = 24) {
  const terms = query.trim().toLocaleLowerCase().slice(0, 120).split(/\s+/).filter(Boolean);
  if (terms.join("").length < 2) return { results: [] as IntelligenceCard[], total: 0, limited: false };
  const matches = cards.filter(card => {
    if (!intelligenceMatchesFacet(card, facet)) return false;
    const haystack = [
      card.title, card.whatHappened, card.whyItMatters, card.whyItMattersToUser,
      card.subjectKey ?? "", card.symbol ?? "", card.kind,
      ...(card.evidence ?? []).map(source => [source.source, source.provider ?? ""].join(" ")),
    ].join(" ").toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  });
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(48, Math.floor(limit))) : 24;
  return { results: matches.slice(0, n), total: matches.length, limited: matches.length > n };
}

export function intelligenceSearchCounts(cards: readonly IntelligenceCard[]): Record<IntelligenceSearchFacet, number> {
  return {
    all: cards.length,
    research: cards.filter(card => RESEARCH.has(card.kind)).length,
    markets: cards.filter(card => MARKETS.has(card.kind)).length,
    signals: cards.filter(card => SIGNALS.has(card.kind)).length,
  };
}
