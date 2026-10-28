/**
 * Related coverage discovery from EXISTING recorded RSS headlines only.
 * This is NOT story identity, claim corroboration or a synthetic event cluster.
 */
import { safePulseSourceUrl } from "./pulseStoryPresentation";
import type { NewsStoryObservation } from "./newsStoryEvolution";

const IGNORE = new Set([
  "about", "after", "against", "ahead", "amid", "company", "could",
  "earnings", "finance", "financial", "global", "latest", "market",
  "markets", "more", "report", "reports", "rise", "rises", "says",
  "shares", "stock", "stocks", "their", "today", "update", "with",
  "world", "year", "years",
]);
const MAX_DISTANCE_MS = 72 * 60 * 60 * 1000;

function topics(text: string): Set<string> {
  const normalized = text.toLowerCase().normalize("NFKC");
  return new Set(normalized.replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/).filter(word => word.length >= 4 && word.length < 32 &&
      !IGNORE.has(word) && !/^\d+$/.test(word)));
}

export function relatedNewsCoverage(
  anchor: NewsStoryObservation,
  feed: readonly NewsStoryObservation[],
  maximum = 4,
): NewsStoryObservation[] {
  const baseDate = Date.parse(anchor.publishedAt);
  if (!Number.isFinite(baseDate) || safePulseSourceUrl(anchor.url) !== anchor.url) return [];
  const subject = topics(anchor.title);
  if (subject.size < 2) return [];
  const rows: Array<{ item: NewsStoryObservation; score: number; distance: number }> = [];
  const seen = new Set<string>();
  for (const candidate of feed.slice(0, 100)) {
    if (!candidate || candidate.url === anchor.url || seen.has(candidate.url) ||
      candidate.source.trim().toLowerCase() === anchor.source.trim().toLowerCase() ||
      safePulseSourceUrl(candidate.url) !== candidate.url) continue;
    const when = Date.parse(candidate.publishedAt);
    const distance = Math.abs(when - baseDate);
    if (!Number.isFinite(when) || distance > MAX_DISTANCE_MS) continue;
    const words = topics(candidate.title);
    if (words.size < 2) continue;
    const matches = [...subject].filter(word => words.has(word));
    if (matches.length < 2 || matches.length / Math.max(subject.size, words.size) < .4) continue;
    seen.add(candidate.url);
    rows.push({ item: candidate, score: matches.length, distance });
  }
  return rows.sort((a, b) => b.score - a.score || a.distance - b.distance ||
    a.item.url.localeCompare(b.item.url)).slice(0, Math.max(0, Math.min(4, Math.floor(maximum)))).map(row => row.item);
}
