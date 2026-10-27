/** Only user-initiated REMOTE playback of a declared RSS enclosure. No reuse rights. */
import { safePublicSourceUrl } from "./publicSourceUrl";

export interface NewsMediaPreview {
  kind: "audio" | "video";
  url: string;
  mime: "audio/mpeg" | "audio/mp4" | "audio/ogg" | "video/mp4" | "video/webm";
  source: "rss";
  rights: "publisher_stream_only";
}

const TYPES: Record<NewsMediaPreview["mime"], NewsMediaPreview["kind"]> = {
  "audio/mpeg": "audio", "audio/mp4": "audio", "audio/ogg": "audio",
  "video/mp4": "video", "video/webm": "video",
};

export function safeNewsMediaPreview(value: unknown): NewsMediaPreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<NewsMediaPreview>;
  if (!input.mime || !Object.prototype.hasOwnProperty.call(TYPES, input.mime) ||
    input.kind !== TYPES[input.mime] || input.source !== "rss" ||
    input.rights !== "publisher_stream_only" || typeof input.url !== "string" ||
    input.url.length > 2048 || safePublicSourceUrl(input.url) !== input.url) return null;
  try {
    const u = new URL(input.url);
    if (u.protocol !== "https:" || (u.port && u.port !== "443") ||
      u.username || u.password || u.search || u.hash || !u.hostname.includes(".") ||
      /^(?:[0-9.]+|\[.*\])$/.test(u.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|onion|arpa)$/.test(u.hostname)) return null;
  } catch { return null; }
  return { kind: input.kind, url: input.url, mime: input.mime, source: "rss", rights: "publisher_stream_only" };
}
