import * as React from "react";
import {
  changedNewsFields, newsStoryRevisions, type NewsStoryRevision,
} from "@/lib/newsStoryEvolution";

function utcDateTime(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"
    : "Time unavailable";
}

/** Exact-URL read-through, recording only changes seen while this News panel is mounted. */
export function NewsStoryEvolution({
  exactUrl, history,
}: {
  exactUrl: string;
  history: readonly NewsStoryRevision[];
}) {
  const versions = newsStoryRevisions(history, exactUrl);
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
    </section>
  );
}
