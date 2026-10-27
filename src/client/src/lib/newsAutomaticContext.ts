/** Public news only: bounded Commons context discovery, never an editorial photo grant. */
import type { CommonsCandidate } from "@shared/commonsMedia";
import { safeCommonsFilePage, safeCommonsPreview } from "@shared/commonsMedia";

const COMMON_WORDS = new Set([
  "about", "after", "against", "amid", "amidst", "among", "ahead",
  "breaking", "company", "could", "from", "global", "latest",
  "market", "markets", "more", "new", "news", "over", "report",
  "reports", "says", "shares", "stock", "stocks", "their", "this",
  "today", "update", "what", "when", "where", "which", "while",
  "with", "world", "year", "years",
]);

/** Public publisher headline → minimal subject, not the user's private query. */
export function automaticContextSearchTerm(title: unknown): string | null {
  if (typeof title !== "string" || title.length > 300) return null;
  const words = title.normalize("NFKC").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/)
    .filter(word => word.length >= 3 && word.length <= 24 &&
      !COMMON_WORDS.has(word.toLowerCase()) && !/^\d+$/.test(word));
  const distinct = [...new Set(words.map(word => word.toLowerCase()))].slice(0, 2);
  const term = distinct.join(" ");
  return term.length >= 3 && term.length <= 100 ? term : null;
}

/** Reject injected image links, non-CC0 grants and unrelated image names.
 * Commons metadata is never treated as event-photography verification.
 */
export function chooseAutomaticContextImage(payload: unknown, term: string): CommonsCandidate | null {
  if (!payload || typeof payload !== "object" || !term) return null;
  const found = payload as { status?: unknown; results?: unknown };
  if (found.status !== "unreviewed" || !Array.isArray(found.results)) return null;
  const keywords = term.toLowerCase().split(/\s+/).filter(word => word.length >= 3);
  for (const value of found.results.slice(0, 8)) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as CommonsCandidate;
    if (candidate.license !== "CC0 1.0" ||
      candidate.licenseUrl !== "https://creativecommons.org/publicdomain/zero/1.0/" ||
      typeof candidate.fileTitle !== "string" ||
      !candidate.fileTitle.startsWith("File:") ||
      typeof candidate.creator !== "string" ||
      !safeCommonsPreview(candidate) || !safeCommonsFilePage(candidate)) continue;
    const fileName = candidate.fileTitle.toLowerCase().replace(/[_\-]/g, " ");
    if (!keywords.some(keyword => fileName.includes(keyword))) continue;
    return candidate;
  }
  return null;
}
