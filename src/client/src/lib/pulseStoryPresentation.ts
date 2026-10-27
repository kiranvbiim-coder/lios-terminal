import type { IntelligenceCard } from "@shared/waveDContracts";

/**
 * Display-only view over the canonical Wave D card. Synthetic market-move
 * fallbacks can omit evidence; they must not invent sources or observations.
 */
export type PulseStoryView =
  Pick<IntelligenceCard, "id" | "title" | "whatHappened" | "priority" | "score"> &
  Partial<Pick<IntelligenceCard, "kind" | "symbol" | "createdAt" | "whyItMatters" | "whyItMattersToUser" | "evidence">>;

export function safePulseSourceUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) return null;
    // We only navigate to source pages. A renderer may never turn a source URL into image rights.
    return url.href;
  } catch {
    return null;
  }
}

export function pulseStoryTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function pulseStoryQuestion(card: PulseStoryView): string {
  const title = card.title.trim().slice(0, 300);
  return `Investigate this intelligence item: "${title}". Verify its claims against available sources, distinguish observed facts from inferences, and explain what is unknown.`;
}
