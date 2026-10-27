/**
 * Extract image metadata from fetched RSS. A publisher-supplied image URL is
 * NOT a license to display, cache, fetch, proxy or redistribute its pixels.
 * The candidate stays informational until an independent rights review.
 */
export interface RssImageCandidate {
  url: string;
  source: "rss";
  rights: "unverified";
  attribution?: string;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function safeImageReference(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = new URL(value.trim());
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password
      || !parsed.hostname.includes(".") || parsed.hostname.endsWith(".local")
      || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname)) return null;
    return parsed.toString();
  } catch { return null; }
}

/**
 * No additional HTTP request is performed. Only an explicit media element in
 * the RSS record counts; inline HTML or a feed's general logo never becomes
 * a story photograph. A candidate is never an EditorialMedia grant.
 */
export function extractRssImageCandidate(value: unknown): RssImageCandidate | undefined {
  const item = record(value);
  if (!item) return undefined;
  for (const key of ["media:content", "media:thumbnail", "enclosure"]) {
    const media = record(first(item[key]));
    if (!media) continue;
    const kind = typeof media.type === "string" ? media.type.toLowerCase() : "";
    if (key === "enclosure" && !/^image\/(?:jpeg|jpg|png|webp|avif)$/.test(kind)) continue;
    if (key === "media:content" && kind && !/^image\/(?:jpeg|jpg|png|webp|avif)$/.test(kind)) continue;
    const url = safeImageReference(media.url);
    if (!url) continue;
    const credit = first(item["media:credit"]);
    const attributionNode = record(credit);
    const raw = typeof credit === "string" ? credit : attributionNode?.["#text"];
    const attribution = typeof raw === "string" ? raw.trim().slice(0, 160) : "";
    return { url, source: "rss", rights: "unverified", ...(attribution ? { attribution } : {}) };
  }
  return undefined;
}
