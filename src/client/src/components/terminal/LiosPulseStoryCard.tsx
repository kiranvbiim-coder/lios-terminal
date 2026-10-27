/**
 * Adapted from Watermelon Platform's ExpandableEventCard and beUI's Citations
 * presentation patterns. Original sources:
 * WatermelonCorp/watermelon-platform@7b93bcfe8d8b44a462dc676d842bb54056faab0f
 *   src/data/contents/animated-components/expandable-event-card/base.tsx
 * starc007/ui-components@41a330ba66684696c445d58ca5d77c0133d4059a
 *   components/agents/citations.tsx
 * Both MIT; see third_party/licenses/*. No donor demo media, invented market
 * observations or remote favicon requests are included.
 */
import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, BookOpenText, ChevronDown, ExternalLink, Radar, Sparkles } from "lucide-react";
import { pulseStoryQuestion, pulseStoryTimestamp, safePulseSourceUrl, type PulseStoryView } from "@/lib/pulseStoryPresentation";
import { LicensedEditorialImage } from "./LicensedEditorialImage";

interface Props {
  card: PulseStoryView;
  featured?: boolean;
  onAsk: (question: string) => void;
  onOpenSymbol?: (symbol: string) => void;
}

const priorityTone = {
  critical: "border-rose-300/30 text-rose-200",
  important: "border-amber-300/30 text-amber-200",
  fyi: "border-cyan-300/25 text-cyan-200",
} as const;

export default function LiosPulseStoryCard({ card, featured = false, onAsk, onOpenSymbol }: Props) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const reduceMotion = useReducedMotion();
  const evidence = card.evidence ?? [];
  const timestamp = pulseStoryTimestamp(card.createdAt);
  const focusLabel = card.kind === "news" ? "News" : card.kind === "research" ? "Research" : card.kind === "alert" ? "Signal" : card.kind === "market_move" ? "Market" : "Intelligence";

  return (
    <article
      data-testid="lios-pulse-story-card"
      data-source-count={evidence.length}
      data-featured={featured ? "true" : "false"}
      className={`group relative min-w-0 overflow-hidden rounded-xl border border-border/65 bg-gradient-to-br from-white/[0.045] via-white/[0.015] to-transparent shadow-[0_8px_30px_rgba(0,0,0,0.12)] ${featured ? "md:col-span-2" : ""}`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((value) => !value)}
        className="w-full min-w-0 p-4 text-left outline-none transition-colors hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300/70 sm:p-5"
      >
        {featured && <LicensedEditorialImage media={card.media}
          sourceIds={evidence.map(item => item.id)}
          className="mb-4"
          fallback={<div aria-hidden="true" className="relative mb-4 flex h-28 items-center justify-between overflow-hidden rounded-lg border border-amber-200/10 bg-gradient-to-br from-amber-200/[0.09] via-zinc-500/[0.035] to-cyan-300/[0.045] px-6">
            <div className="absolute -right-10 top-[-90px] h-52 w-52 rounded-full border border-amber-200/15" />
            <div className="absolute -right-3 top-[-63px] h-44 w-44 rounded-full border border-amber-200/10" />
            <Radar className="relative h-10 w-10 text-amber-200/65" strokeWidth={1} />
            <span className="relative font-ui text-xs font-medium tracking-[0.19em] text-foreground/50">LIOS INTELLIGENCE</span>
          </div>} />}
        {!featured && <LicensedEditorialImage media={card.media} sourceIds={evidence.map(item => item.id)} variant="compact" className="mb-3 w-28" />}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md border border-border/65 px-2 py-1 font-medium text-muted-foreground">{focusLabel}</span>
          <span className={`rounded-md border px-2 py-1 text-xs font-medium capitalize ${priorityTone[card.priority]}`}>{card.priority === "fyi" ? "For review" : card.priority}</span>
          {card.symbol && <span className="font-medium text-foreground/75">{card.symbol}</span>}
          <span className="ml-auto font-medium tabular-nums text-muted-foreground">{card.score.toFixed(0)} relevance</span>
        </div>
        <h3 className={`mt-3 font-ui font-semibold tracking-tight text-foreground ${featured ? "text-xl leading-snug sm:text-2xl" : "text-base leading-snug"}`}>{card.title}</h3>
        <p className="mt-2 line-clamp-3 font-ui text-sm leading-6 text-muted-foreground">{card.whatHappened}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><BookOpenText className="h-3.5 w-3.5" />{evidence.length ? `${evidence.length} recorded source${evidence.length === 1 ? "" : "s"}` : "Sources not attached"}</span>
          {timestamp && <time dateTime={timestamp}>{new Date(timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</time>}
          <span className="ml-auto inline-flex items-center gap-1.5 font-medium text-foreground/80">{expanded ? "Close details" : "Inspect"}<ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} /></span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="story-details"
            id={detailsId}
            role="region"
            aria-label={`Evidence and actions for ${card.title}`}
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden border-t border-border/60"
          >
            <div className="space-y-4 px-4 py-4 sm:px-5">
              {(card.whyItMattersToUser || card.whyItMatters) && (
                <div>
                  <h4 className="font-ui text-xs font-semibold uppercase tracking-wider text-amber-200">Why it matters</h4>
                  <p className="mt-1.5 font-ui text-sm leading-6 text-foreground/85">{card.whyItMattersToUser || card.whyItMatters}</p>
                </div>
              )}
              <section aria-label="Recorded evidence">
                <div className="mb-2 flex items-center gap-2 font-ui text-xs font-semibold text-foreground">
                  <BookOpenText className="h-4 w-4 text-cyan-200" /> Sources
                  <span className="rounded-full bg-white/[0.055] px-2 py-0.5 font-medium tabular-nums text-muted-foreground">{evidence.length}</span>
                </div>
                {evidence.length ? (
                  <div className="space-y-1.5">
                    {evidence.map((source) => {
                      const href = safePulseSourceUrl(source.url);
                      const date = pulseStoryTimestamp(source.availableAt);
                      const contents = (
                        <>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-ui text-sm font-medium text-foreground">{source.source}</span>
                            <span className="mt-0.5 block truncate font-ui text-xs text-muted-foreground">{[source.provider, date ? new Date(date).toLocaleDateString() : null].filter(Boolean).join(" · ") || "Recorded evidence"}</span>
                          </span>
                          {href && <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        </>
                      );
                      const classes = "flex min-h-12 items-center gap-2 rounded-lg border border-border/50 bg-black/[0.08] px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70";
                      return href ? <a key={source.id} href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={`${classes} hover:border-amber-200/30`}>{contents}</a> : <div key={source.id} className={classes}>{contents}</div>;
                    })}
                  </div>
                ) : <p className="font-ui text-sm text-muted-foreground">No attributed evidence was provided for this item. Verify independent sources before acting.</p>}
              </section>
              <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">
                <button type="button" onClick={() => onAsk(pulseStoryQuestion(card))} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/[0.09] px-3 py-2 font-ui text-sm font-medium text-foreground transition-colors hover:bg-amber-300/[0.15] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"><Sparkles className="h-4 w-4 text-amber-200" />Ask LiOS</button>
                {card.symbol && onOpenSymbol && <button type="button" onClick={() => onOpenSymbol(card.symbol!)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border/70 px-3 py-2 font-ui text-sm font-medium text-foreground hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">Open analysis<ArrowUpRight className="h-4 w-4" /></button>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
