/**
 * Story Evolution: observations from this mounted News view only.
 * No AI rewriting, headline clustering, hidden persistence, or cross-publisher
 * relationship inference. A different URL is always a different story.
 */
import { safePulseSourceUrl } from "./pulseStoryPresentation";

export interface NewsStoryObservation {
  url: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
}
export interface NewsStoryRevision extends NewsStoryObservation {
  /** Local observation time, NOT when the publisher changed the story. */
  observedAt: string;
  /** Latest successful feed observation, including unchanged responses. */
  lastObservedAt?: string;
}
export type StoryChangedField = "headline" | "summary" | "source" | "publication time";
export const MAX_NEWS_STORIES = 80;
export const MAX_NEWS_REVISIONS_PER_STORY = 6;

function clean(value: string, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function validObservation(item: NewsStoryObservation): NewsStoryObservation | null {
  const url = typeof item.url === "string" ? item.url.trim() : "";
  // Exact source identity and safe navigation; reject credentialed or malformed links.
  if (url.length > 2048 || safePulseSourceUrl(url) !== url) return null;
  const title = clean(item.title, 240);
  const source = clean(item.source, 160);
  const summary = clean(item.summary, 1400);
  const published = Date.parse(item.publishedAt);
  if (!title || !source || !Number.isFinite(published)) return null;
  return { url, title, source, summary, publishedAt: new Date(published).toISOString() };
}

/** Comparison of two recorded feed observations, NOT claims about the event. */
export function changedNewsFields(before: NewsStoryObservation, after: NewsStoryObservation): StoryChangedField[] {
  if (before.url !== after.url) return [];
  const fields: StoryChangedField[] = [];
  if (before.title !== after.title) fields.push("headline");
  if (before.summary !== after.summary) fields.push("summary");
  if (before.source !== after.source) fields.push("source");
  if (before.publishedAt !== after.publishedAt) fields.push("publication time");
  return fields;
}

/**
 * Only append when the exact URL's feed text/metadata changed. The first read
 * is an observation, not a publisher revision. Bounded in memory per view.
 */
export function observeNewsFeed(
  previous: readonly NewsStoryRevision[],
  items: readonly NewsStoryObservation[],
  observationTime: number,
): NewsStoryRevision[] {
  if (!Number.isFinite(observationTime) || observationTime <= 0) return [...previous];
  const observedAt = new Date(observationTime).toISOString();
  let next = [...previous];
  const seenThisFeed = new Set<string>();
  for (const raw of items.slice(0, 100)) {
    const item = validObservation(raw);
    if (!item || seenThisFeed.has(item.url)) continue;
    seenThisFeed.add(item.url);
    const latest = next.find(record => record.url === item.url);
    // Switching between cached React Query keys can surface an older response
    // after a newer one. Never reclassify old feed data as a fresh revision.
    if (latest) {
      const lastSeen = Date.parse(latest.lastObservedAt ?? latest.observedAt);
      if (!Number.isFinite(lastSeen) || observationTime <= lastSeen) continue;
      if (changedNewsFields(latest, item).length === 0) {
        next = next.map(record => record === latest ? { ...record, lastObservedAt: observedAt } : record);
        continue;
      }
    }
    next = [{ ...item, observedAt, lastObservedAt: observedAt }, ...next];
  }
  // Retain the last 6 actual observed versions of the last 80 unique stories.
  const storyCounts = new Map<string, number>();
  next = next.filter(record => {
    if (!storyCounts.has(record.url) && storyCounts.size >= MAX_NEWS_STORIES) return false;
    const count = storyCounts.get(record.url) ?? 0;
    if (count >= MAX_NEWS_REVISIONS_PER_STORY) return false;
    storyCounts.set(record.url, count + 1);
    return true;
  });
  return next;
}

export function newsStoryRevisions(history: readonly NewsStoryRevision[], exactUrl: string): NewsStoryRevision[] {
  return history.filter(item => item.url === exactUrl).slice(0, MAX_NEWS_REVISIONS_PER_STORY);
}
