/**
 * LIOS editorial story card.
 * Adapted from Watermelon UI's expandable-event-card presentation:
 * https://github.com/WatermelonCorp/watermellon-registry/blob/86052b8fd12bc19bf3bac07625a7f93736c42b17/src/components/watermelon-ui/expandable-event-card-base.tsx
 * Upstream: MIT, Copyright (c) 2025-present Watermelon Contributors; this adaptation uses the installed framer-motion
 * package and selects LIOS's existing read-through instead of creating a second modal.
 * Full notice: third_party/licenses/watermellon-registry-MIT.txt.\n * No donor demo images, third-party media, backend state or synthetic content are copied.
 */
import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Newspaper } from "lucide-react";
import type { ReactNode } from "react";
import type { EditorialMedia } from "@shared/editorialMedia";
import { LicensedEditorialImage } from "../terminal/LicensedEditorialImage";

type Sentiment = "positive" | "negative" | "neutral";

interface NewsEditorialStoryCardProps {
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  ageLabel: string;
  sentiment?: Sentiment;
  statusBadge: ReactNode;
  active: boolean;
  lead: boolean;
  onSelect: () => void;
  media?: EditorialMedia;
  sourceEvidenceId?: string;
}

const tone: Record<Sentiment, string> = {
  positive: "bg-emerald-400",
  negative: "bg-rose-400",
  neutral: "bg-amber-300",
};

/** Presentation only: the parent remains the sole owner of selection and the article. */
export default function NewsEditorialStoryCard({
  title, summary, source, publishedAt, ageLabel, sentiment = "neutral",
  statusBadge, active, lead, onSelect, media, sourceEvidenceId,
}: NewsEditorialStoryCardProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.button
      type="button"
      layout={reduceMotion ? false : "position"}
      initial={false}
      whileHover={reduceMotion ? undefined : { y: -2 }}
      transition={{ type: "spring", stiffness: 350, damping: 30 }}
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`Read story: ${title}`}
      data-news-editorial-card="true"
      data-testid={`news-item-${source.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      data-analytical-row
      className={`group relative block w-full overflow-hidden rounded-xl border px-4 py-3.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${active
        ? "border-amber-300/50 bg-amber-300/[0.065] shadow-[inset_3px_0_0_rgba(252,211,77,0.75)]"
        : "border-border/60 bg-white/[0.015] hover:border-border hover:bg-white/[0.035]"}`}
    >
      {lead && <LicensedEditorialImage media={media}
        sourceIds={sourceEvidenceId ? [sourceEvidenceId] : []}
        className="mb-3"
        fallback={<div
          className="pointer-events-none relative mb-3 flex h-16 items-center justify-between overflow-hidden rounded-lg border border-border/35 bg-[radial-gradient(circle_at_85%_25%,rgba(251,191,36,0.13),transparent_64%)] px-4"
          aria-hidden="true"
        >
          <span className="font-ui text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-200/85">
            Story overview
          </span>
          <Newspaper className="h-10 w-10 text-amber-200/30" strokeWidth={1.2} />
        </div>} />}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone[sentiment]}`} aria-hidden="true" />
        <span className="max-w-full truncate font-ui text-[11px] font-semibold text-amber-200">{source}</span>
        <span className="shrink-0">{statusBadge}</span>
        <time className="ml-auto font-ui text-[11px] text-muted-foreground" dateTime={publishedAt}>{ageLabel}</time>
      </div>
      <div className="mt-2.5 flex min-w-0 items-start gap-3">
        {!lead && <LicensedEditorialImage media={media}
          sourceIds={sourceEvidenceId ? [sourceEvidenceId] : []}
          variant="compact" className="w-24 shrink-0 sm:w-28" />}
        <div className="min-w-0 flex-1">
          <h3 className={`font-ui font-semibold leading-snug text-foreground ${lead ? "line-clamp-3 text-[17px]" : "line-clamp-2 text-[14px]"}`}>
            {title}
          </h3>
          {summary && (
            <p className="mt-1.5 line-clamp-3 font-ui text-[12px] leading-5 text-muted-foreground">{summary}</p>
          )}
        </div>
        <ArrowUpRight className={`mt-0.5 h-4 w-4 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${active ? "text-amber-200" : "text-muted-foreground"}`} aria-hidden="true" />
      </div>
      <span className={`mt-3 block font-ui text-[11px] font-medium ${active ? "text-amber-200" : "text-muted-foreground group-hover:text-foreground"}`}>
        {active ? "Reading in the source pane" : "Open story and inspect source"}
      </span>
    </motion.button>
  );
}
