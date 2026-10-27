import * as React from "react";
import { Timeline as BeuiTimeline, type TimelineEvent } from "../vendor/beui/BeuiTimeline";
import { changedNewsFields, type NewsStoryRevision, type NewsStoryObservation } from "@/lib/newsStoryEvolution";

/**
 * One display projection over exact-URL changes already observed by the News
 * panel. Nothing new is fetched, clustered, inferred or stored.
 */
export default function NewsObservedRevisionTimeline({ versions }: { versions: readonly NewsStoryRevision[] }) {
  if (versions.length < 2) return null;
  const ordered = [...versions].reverse();
  const events: TimelineEvent[] = ordered.map((version, i) => {
    const fields = i === 0 ? [] : changedNewsFields(ordered[i - 1], version);
    return {
      id: version.url + ":" + version.observedAt,
      date: version.observedAt,
      title: i === 0 ? "First observed" : "Feed change observed",
      media: <div className="flex h-full flex-col justify-center gap-2 overflow-hidden p-3 font-ui">
        <p className="line-clamp-3 break-words text-sm font-semibold leading-5 text-foreground">{version.title}</p>
        <p className="line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{version.summary || "No feed summary recorded"}</p>
      </div>,
      meta: <span className="line-clamp-1 break-words text-[11px] text-muted-foreground">
        {i === 0 ? "First recorded feed observation" : fields.length ? fields.join(", ") : "Recorded feed observation"}
      </span>,
    };
  });
  return <div data-testid="news-beui-recorded-timeline"
    className="mt-3 min-w-0 overflow-hidden rounded-xl border border-border/55 bg-background/50">
    <p className="px-3 pt-3 font-ui text-xs leading-5 text-muted-foreground">
      Observation times, not publication update times. Navigate with arrow keys or drag; source text remains available in the list below.
    </p>
    <BeuiTimeline events={events} defaultValue={events[events.length - 1].id}
      height={268} itemWidth={290} years={false} cables={false}
      aria-label="Recorded versions of the current article URL" />
  </div>;
}

/**
 * Related sources remain DISTINCT articles, ordered only by their recorded
 * publisher feed dates. Headline overlap is not proof of event identity.
 */
export function RelatedPublisherTimeline({ headlines }: { headlines: readonly NewsStoryObservation[] }) {
  if (headlines.length < 2) return null;
  const ordered = [...headlines]
    .filter(item => Number.isFinite(Date.parse(item.publishedAt)))
    .sort((left, right) => Date.parse(left.publishedAt) - Date.parse(right.publishedAt));
  if (ordered.length < 2) return null;
  const events: TimelineEvent[] = ordered.slice(0, 5).map((item, index) => ({
    id: item.url + ":published:" + index,
    date: item.publishedAt,
    title: item.source,
    media: <div className="flex h-full flex-col justify-center gap-2 overflow-hidden p-3 font-ui">
      <p className="line-clamp-3 break-words text-sm font-semibold leading-5 text-foreground">{item.title}</p>
      <p className="line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{item.summary || "No summary supplied by feed"}</p>
    </div>,
    meta: <span className="font-ui text-[11px] text-muted-foreground">Separate publisher feed item</span>,
  }));
  return <div data-testid="news-beui-related-timeline" className="mt-3 min-w-0 overflow-hidden rounded-xl border border-border/55 bg-background/50">
    <p className="px-3 pt-3 font-ui text-xs leading-5 text-muted-foreground">
      Source publication timestamps only. Similar headline subjects may describe different events; inspect each original publisher.
    </p>
    <BeuiTimeline events={events} defaultValue={events[events.length - 1].id}
      height={268} itemWidth={290} years={false} cables={false}
      aria-label="Separate related publisher headlines by feed publication time" />
  </div>;
}
