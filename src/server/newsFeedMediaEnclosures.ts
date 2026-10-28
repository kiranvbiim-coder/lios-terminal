/** RSS enclosure metadata only. Never proxy, cache or redistribute publisher media. */
import { safeNewsMediaPreview, type NewsMediaPreview } from "../shared/newsMediaPreview";

export function extractRssMediaPreview(record: unknown): NewsMediaPreview | undefined {
  if (!record || typeof record !== "object" || Array.isArray(record)) return undefined;
  const item = record as Record<string, unknown>;
  for (const field of ["enclosure", "media:content"]) {
    const found = Array.isArray(item[field]) ? item[field] as unknown[] : [item[field]];
    for (const entry of found.slice(0, 4)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const media = entry as { url?: unknown; type?: unknown };
      if (typeof media.url !== "string" || typeof media.type !== "string") continue;
      const mime = media.type.trim().toLowerCase();
      const kind = mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : null;
      if (!kind) continue;
      const safe = safeNewsMediaPreview({
        kind, url: media.url, mime, source: "rss", rights: "publisher_stream_only",
      });
      if (safe) return safe;
    }
  }
  return undefined;
}
