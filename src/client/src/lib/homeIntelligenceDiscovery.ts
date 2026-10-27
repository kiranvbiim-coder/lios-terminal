import type { ActionInboxItem, IntelligenceCard } from "@shared/waveDContracts";

export type AttentionFilter = "all" | "needs_review" | "research" | "markets" | "signals";

export const ATTENTION_FILTERS: ReadonlyArray<{ key: AttentionFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "needs_review", label: "Needs review" },
  { key: "research", label: "Research" },
  { key: "markets", label: "Markets" },
  { key: "signals", label: "Signals" },
];

export interface HomeAttentionEntry {
  card: IntelligenceCard;
  inbox: ActionInboxItem | null;
  /** Null means this is contextual intelligence, not a persisted review task. */
  reviewStatus: ActionInboxItem["status"] | null;
}

const RESEARCH_KINDS = new Set(["news", "research", "report", "ai_insight", "community_idea"]);
const MARKET_KINDS = new Set(["market_move", "earnings", "portfolio", "valuation", "macro"]);
const SIGNAL_KINDS = new Set(["alert", "workflow", "email"]);

/** Canonical server cards and Inbox records are authoritative. Never synthesize a review task. */
export function homeAttentionEntries(
  cards: readonly IntelligenceCard[],
  actionInbox: readonly ActionInboxItem[],
): HomeAttentionEntry[] {
  const inboxByCard = new Map(actionInbox.map(item => [item.sourceCardId, item]));
  return cards
    .filter(card => card.priority !== "fyi" || inboxByCard.has(card.id))
    .map(card => {
      const inbox = inboxByCard.get(card.id) ?? null;
      return { card, inbox, reviewStatus: inbox?.status ?? null };
    });
}

export function filterHomeAttention(
  entries: readonly HomeAttentionEntry[],
  filter: AttentionFilter,
  search: string,
): HomeAttentionEntry[] {
  const terms = search.trim().toLocaleLowerCase().slice(0, 120).split(/\s+/).filter(Boolean);
  return entries.filter(({ card, reviewStatus }) => {
    if (filter === "needs_review" && reviewStatus !== "open") return false;
    if (filter === "research" && !RESEARCH_KINDS.has(card.kind)) return false;
    if (filter === "markets" && !MARKET_KINDS.has(card.kind)) return false;
    if (filter === "signals" && !SIGNAL_KINDS.has(card.kind)) return false;
    if (!terms.length) return true;
    const fields = [
      card.title, card.whatHappened, card.whyItMattersToUser,
      card.subjectKey ?? "", card.symbol ?? "", card.kind,
      ...(card.evidence ?? []).map(item => item.source),
    ].join(" ").toLocaleLowerCase();
    return terms.every(term => fields.includes(term));
  });
}

export function homeAttentionCounts(entries: readonly HomeAttentionEntry[]): Record<AttentionFilter, number> {
  return {
    all: entries.length,
    needs_review: entries.filter(entry => entry.reviewStatus === "open").length,
    research: entries.filter(entry => RESEARCH_KINDS.has(entry.card.kind)).length,
    markets: entries.filter(entry => MARKET_KINDS.has(entry.card.kind)).length,
    signals: entries.filter(entry => SIGNAL_KINDS.has(entry.card.kind)).length,
  };
}

/**
 * Explain recorded relevance signals, not invented model reasoning.
 * The server owns ranking; missing feature inputs are never assumed to be zero.
 */
export function homeAttentionReasons(card: IntelligenceCard): string[] {
  const reasons = [
    `Server classified this item as ${card.priority} priority.`,
  ];
  if (card.portfolioExposure != null && Number.isFinite(card.portfolioExposure) && card.portfolioExposure > 0) reasons.push("A portfolio-exposure ranking input was recorded.");
  if (card.thesisRelevance != null && Number.isFinite(card.thesisRelevance) && card.thesisRelevance > 0) reasons.push("A thesis-relevance ranking input was recorded.");
  if (card.upcomingEvent != null && Number.isFinite(card.upcomingEvent) && card.upcomingEvent > 0) reasons.push("An upcoming-event ranking input was recorded.");
  if (card.magnitude != null && Number.isFinite(card.magnitude) && card.magnitude > 0) reasons.push("An event-magnitude ranking input was recorded.");
  if (!card.evidence?.length) reasons.push("No attributable source evidence is attached to this item.");
  else reasons.push(`${card.evidence.length} source reference${card.evidence.length === 1 ? "" : "s"} attached; verify them independently.`);
  return reasons;
}
