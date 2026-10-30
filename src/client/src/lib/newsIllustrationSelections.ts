/**
 * Persistent, user-authored P4 News panel selections. Metadata only.
 * This is not an editorial-media license, screenshot, downloaded image or
 * source-verification grant. Remote pixels never load simply by restoring.
 */
import type { CommonsCandidate } from "@shared/commonsMedia";
import { commonsLicenseValid, safeCommonsFilePage, safeCommonsPreview } from "@shared/commonsMedia";
import { safePulseSourceUrl } from "./pulseStoryPresentation";

export const MAX_SAVED_NEWS_ILLUSTRATIONS = 12;
export const NEWS_ILLUSTRATION_MAX_AGE_MS = 30 * 86400_000;
export interface SavedNewsIllustration {
  storyUrl: string;
  candidate: CommonsCandidate;
  savedAt: string;
}

/** Reject credentials, untrusted origins, malformed metadata and overlong fields. */
export function validNewsIllustration(storyUrl: string, candidate: unknown): candidate is CommonsCandidate {
  if (typeof storyUrl !== "string" || storyUrl.length > 2048 || safePulseSourceUrl(storyUrl) !== storyUrl) return false;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const item = candidate as Partial<CommonsCandidate>;
  return commonsLicenseValid(item as CommonsCandidate)
    && typeof item.fileTitle === "string" && item.fileTitle.startsWith("File:") && item.fileTitle.length <= 260
    && typeof item.creator === "string" && item.creator.length <= 260
    && typeof item.filePage === "string" && item.filePage.length <= 2048
    && typeof item.previewUrl === "string" && item.previewUrl.length <= 2048
    && ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(item.mime ?? "")
    && safeCommonsFilePage(item as CommonsCandidate) !== null
    && safeCommonsPreview(item as CommonsCandidate) !== null;
}

export function readSavedNewsIllustrations(value: unknown, now = Date.now()): SavedNewsIllustration[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, MAX_SAVED_NEWS_ILLUSTRATIONS * 2).flatMap((entry): SavedNewsIllustration[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Partial<SavedNewsIllustration>;
    if (!validNewsIllustration(item.storyUrl ?? "", item.candidate)) return [];
    const saved = typeof item.savedAt === "string" ? Date.parse(item.savedAt) : NaN;
    if (!Number.isFinite(saved) || saved > now || now - saved > NEWS_ILLUSTRATION_MAX_AGE_MS
      || seen.has(item.storyUrl!)) return [];
    seen.add(item.storyUrl!);
    return [{ storyUrl: item.storyUrl!, candidate: item.candidate!, savedAt: new Date(saved).toISOString() }];
  }).slice(0, MAX_SAVED_NEWS_ILLUSTRATIONS);
}

/** Explicit P4 authored-panel update. Replaces the same article, never another article's preview. */
export function rememberNewsIllustration(
  value: unknown, storyUrl: string, candidate: CommonsCandidate, now = Date.now(),
): SavedNewsIllustration[] {
  if (!validNewsIllustration(storyUrl, candidate)) return readSavedNewsIllustrations(value, now);
  return [
    { storyUrl, candidate, savedAt: new Date(now).toISOString() },
    ...readSavedNewsIllustrations(value, now).filter(entry => entry.storyUrl !== storyUrl),
  ].slice(0, MAX_SAVED_NEWS_ILLUSTRATIONS);
}

export function forgetNewsIllustration(value: unknown, storyUrl: string, now = Date.now()): SavedNewsIllustration[] {
  return readSavedNewsIllustrations(value, now).filter(entry => entry.storyUrl !== storyUrl);
}

/** Fresh Commons lookup is mandatory; the saved image reference alone cannot reopen a preview. */
export function restoredNewsIllustration(saved: SavedNewsIllustration, refreshed: CommonsCandidate): CommonsCandidate | null {
  if (!validNewsIllustration(saved.storyUrl, refreshed)) return null;
  return saved.candidate.fileTitle === refreshed.fileTitle
    && saved.candidate.filePage === refreshed.filePage ? refreshed : null;
}
