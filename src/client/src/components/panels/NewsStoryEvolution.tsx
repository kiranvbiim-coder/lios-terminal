import * as React from "react";
import {
  changedNewsFields, newsStoryRevisions, type NewsStoryRevision,
} from "@/lib/newsStoryEvolution";
import { relatedNewsCoverage } from "@/lib/newsRelatedCoverage";
import { safePulseSourceUrl } from "@/lib/pulseStoryPresentation";
import { recordedIsoTimestamp } from "@/lib/recordedIsoTimestamp";
import type { NewsStoryObservation } from "@/lib/newsStoryEvolution";
import { OptionalTimelineBoundary } from "../terminal/OptionalTimelineBoundary";

const NewsObservedRevisionTimeline = React.lazy(() => import("./NewsObservedRevisionTimeline"));
const RelatedPublisherTimeline = React.lazy(() => import("./NewsObservedRevisionTimeline")
  .then(module => ({ default: module.RelatedPublisherTimeline })));

function utcDateTime(value: string): string {
  const instant = recordedIsoTimestamp(value);
  return instant
    ? new Date(instant).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"
    : "Time unavailable";
}

/** Exact-URL read-through, recording only changes seen while this News panel is mounted. */
export function NewsStoryEvolution({
  exactUrl, history, coverage = [], onSelectRelated,
}: {
  exactUrl: string;
  history: readonly NewsStoryRevision[];
  coverage?: readonly NewsStoryObservation[];
  onSelectRelated?: (url: string) => void;
}) {
  const [timelineVisible, setTimelineVisible] = React.useState(false);
  const [relatedTimelineVisible, setRelatedTimelineVisible] = React.useState(false);
  React.useEffect(() => {
    setTimelineVisible(false);
    setRelatedTimelineVisible(false);
  }, [exactUrl]);
  const versions = newsStoryRevisions(history, exactUrl);
  const anchor = coverage.find(item => item.url === exactUrl);
  const related = anchor ? relatedNewsCoverage(anchor, coverage) : [];
  const changes = versions.slice(0, -1).map((later, index) => ({
    later, before: versions[index + 1],
    fields: changedNewsFields(versions[index + 1], later),
  }));
  return (
    <section className="my-4 rounded-xl border border-border/70 bg-white/[0.02] p-3"
      data-testid="news-story-evolution" aria-label="Observed story feed changes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-ui text-sm font-semibold text-foreground">Story Evolution</h3>
        <span className="font-ui text-[11px] text-muted-foreground">
          {changes.length} observed {changes.length === 1 ? "change" : "changes"}
        </span>
      </div>
      <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">
        Same article URL only. Records feed changes observed while this News view is open;
        not a complete publication history, independent corroboration, or a record of when the event changed.
      </p>
      {changes.length === 0 ? (
        <p role="status" className="mt-3 font-ui text-xs text-muted-foreground">
          No revisions observed in this view. The current feed item is the baseline.
        </p>
      ) : (
        <details className="mt-3 text-sm" data-testid="news-story-changes">
          <summary className="cursor-pointer font-ui text-xs font-semibold text-amber-200 focus-visible:outline-2 focus-visible:outline-amber-300">
            Inspect recorded changes
          </summary>
          <button type="button" aria-expanded={timelineVisible}
            onClick={() => setTimelineVisible(visible => !visible)}
            className="mt-3 min-h-10 rounded-md border border-border/60 px-3 py-2 font-ui text-xs text-amber-100 focus-visible:outline-2 focus-visible:outline-amber-300">
            {timelineVisible ? "Hide visual timeline" : "Explore visual timeline"}
          </button>
          {timelineVisible && <OptionalTimelineBoundary key={exactUrl}>
            <React.Suspense fallback={<p role="status" className="mt-3 font-ui text-xs text-muted-foreground">Loading recorded timeline…</p>}>
              <NewsObservedRevisionTimeline versions={versions} />
            </React.Suspense>
          </OptionalTimelineBoundary>}
          <ol className="mt-3 space-y-3 border-l border-border/70 pl-3">
            {changes.map(({ later, before, fields }) => (
              <li key={later.observedAt + later.url} className="space-y-1 font-ui text-xs text-muted-foreground">
                <time dateTime={later.observedAt} className="font-medium text-foreground">
                  Observed {utcDateTime(later.observedAt)}
                </time>
                <p>Feed fields updated: {fields.join(", ")}.</p>
                {fields.includes("headline") && (
                  <p className="break-words">Headline: <span className="line-through">{before.title}</span> → <span className="text-foreground">{later.title}</span></p>
                )}
                {fields.includes("summary") && (
                  <p className="break-words">Summary was revised in the fetched feed. Compare the article at its original source before relying on it.</p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
      {related.length > 0 && <section className="mt-4 border-t border-border/60 pt-3"
        data-testid="news-related-coverage" aria-label="Other publisher headlines">
        <h4 className="font-ui text-sm font-semibold text-foreground">Related publisher headlines</h4>
        <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">
          Shared headline terms within 72 hours suggest further reading, not proof that they report the same event or corroborate its claims.
        </p>
        {related.length > 1 && <>
          <button type="button" aria-expanded={relatedTimelineVisible}
            onClick={() => setRelatedTimelineVisible(visible => !visible)}
            className="mt-3 min-h-10 rounded-md border border-border/60 px-3 py-2 font-ui text-xs text-amber-100 focus-visible:outline-2 focus-visible:outline-amber-300">
            {relatedTimelineVisible ? "Hide publication timeline" : "Explore publication timeline"}
          </button>
          {relatedTimelineVisible && <OptionalTimelineBoundary key={exactUrl}>
            <React.Suspense fallback={<p role="status" className="font-ui text-xs text-muted-foreground">Loading publisher chronology…</p>}>
              <RelatedPublisherTimeline headlines={related} />
            </React.Suspense>
          </OptionalTimelineBoundary>}
        </>}
        <ul className="mt-3 space-y-2">{related.map(item => (
          <li key={item.url} className="rounded-lg border border-border/60 p-2">
            <p className="font-ui text-[11px] text-amber-200">{item.source} · <time dateTime={item.publishedAt}>{utcDateTime(item.publishedAt)}</time></p>
            <p className="mt-1 font-ui text-sm leading-5 text-foreground">{item.title}</p>
            <div className="mt-2 flex flex-wrap gap-3">
              {onSelectRelated && <button type="button" onClick={() => onSelectRelated(item.url)}
                className="min-h-10 font-ui text-xs text-amber-100 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-amber-300">
                Read in LiOS
              </button>}
              {safePulseSourceUrl(item.url) && <a href={item.url} target="_blank"
                rel="noopener noreferrer" referrerPolicy="no-referrer"
                className="inline-flex min-h-10 items-center font-ui text-xs text-muted-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-amber-300">
                Open publisher
              </a>}
            </div>
          </li>
        ))}</ul>
      </section>}
    </section>
  );
}
