import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { BookOpenText, ExternalLink, Radar, Sparkles } from "lucide-react";
import type { IntelligenceCard } from "@shared/waveDContracts";
import { pulseStoryTimestamp, safePulseSourceUrl } from "@/lib/pulseStoryPresentation";
import {
  INTELLIGENCE_SEARCH_FACETS,
  intelligenceSearchCounts,
  searchRecordedIntelligence,
  type IntelligenceSearchFacet,
} from "@/lib/intelligenceVisualSearch";

interface RecordedPulseResponse {
  asOf?: string;
  cards: IntelligenceCard[];
}

function hasRecordedPulseCards(value: unknown): value is RecordedPulseResponse {
  if (!value || typeof value !== "object") return false;
  const payload = value as { cards?: unknown; asOf?: unknown };
  return Array.isArray(payload.cards) && (payload.asOf === undefined || typeof payload.asOf === "string")
    && payload.cards.every((card: unknown) => {
      if (!card || typeof card !== "object") return false;
      const item = card as Partial<IntelligenceCard>;
      return typeof item.id === "string" && typeof item.title === "string"
        && typeof item.kind === "string" && typeof item.createdAt === "string"
        && typeof item.whatHappened === "string"
        && typeof item.score === "number" && Number.isFinite(item.score)
        && Array.isArray(item.evidence)
        && item.evidence.every(source => typeof source?.id === "string" && typeof source?.source === "string");
    });
}

/** Same secured Wave D read model as Home. No second index, route, or image fetch. */
export default function VisualIntelligenceSearch({ query, onAsk }: {
  query: string;
  onAsk: (card: IntelligenceCard) => boolean | Promise<boolean>;
}) {
  const [snapshot, setSnapshot] = useState<RecordedPulseResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stagingId, setStagingId] = useState<string | null>(null);
  const [facet, setFacet] = useState<IntelligenceSearchFacet>("all");
  const activeQuery = query.trim().slice(0, 120);
  const searchReady = activeQuery.length >= 2;

  useEffect(() => {
    // Fetch one authorized snapshot when this panel becomes searchable.
    // Further keystrokes filter locally; they MUST NOT refetch the entire
    // upstream Pulse or trigger extra provider calls.
    setSnapshot(null);
    setFailure(null);
    setActionError(null);
    if (!searchReady) { setPending(false); return; }
    const controller = new AbortController();
    setPending(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/wave-d/pulse", { signal: controller.signal });
        if (!response.ok) throw new Error("Current intelligence is unavailable or access was denied.");
        const payload: unknown = await response.json();
        if (!hasRecordedPulseCards(payload)) throw new Error("Current intelligence returned an unsupported response.");
        if (!controller.signal.aborted) setSnapshot(payload);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setFailure(cause instanceof Error ? cause.message : "Current intelligence could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    }, 160);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [searchReady]);

  const cards = snapshot?.cards ?? [];
  const counts = useMemo(() => intelligenceSearchCounts(cards), [cards]);
  const found = useMemo(() => searchRecordedIntelligence(cards, activeQuery, facet), [cards, activeQuery, facet]);
  const asOf = pulseStoryTimestamp(snapshot?.asOf);

  const stage = async (card: IntelligenceCard) => {
    if (stagingId) return;
    setStagingId(card.id);
    setActionError(null);
    try {
      const staged = await onAsk(card);
      if (!staged) setActionError("Cannot open Chat while another action or unsaved Artifact is active. Your search is preserved.");
    } catch {
      setActionError("Could not stage this source in Chat. Your search is preserved.");
    } finally {
      setStagingId(null);
    }
  };

  return (
    <section data-testid="lios-visual-intelligence-search" aria-label="Search recorded intelligence" className="min-w-0">
      {activeQuery.length < 2 ? <p role="status" className="px-5 py-8 font-ui text-sm text-muted-foreground">
        Enter at least 2 characters to explore currently recorded intelligence.
      </p> : (
        <>
          {pending && <p role="status" className="px-4 py-3 font-ui text-sm text-muted-foreground">Reading current intelligence…</p>}
          {failure && <p role="alert" className="mx-3 my-2 rounded-lg border border-amber-300/30 px-3 py-2 font-ui text-sm text-amber-100">{failure} No results have been inferred.</p>}
          {actionError && <p role="alert" className="mx-3 my-2 rounded-lg border border-amber-300/30 px-3 py-2 font-ui text-sm text-amber-100">{actionError}</p>}
          {snapshot && !pending && !failure && <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-3" role="group" aria-label="Intelligence subjects">
              {INTELLIGENCE_SEARCH_FACETS.map(item => <button
                type="button" key={item.value} aria-pressed={facet === item.value}
                onClick={() => setFacet(item.value)}
                className={`min-h-10 rounded-lg border px-3 py-2 font-ui text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 ${facet === item.value ? "border-amber-300/40 bg-amber-300/[0.09] text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
              >{item.label} <span aria-hidden="true">({counts[item.value]})</span></button>)}
            </div>
            <p role="status" className="px-4 py-3 font-ui text-xs text-muted-foreground">
              {found.total} matches within {cards.length} returned intelligence items.
              {asOf && <> Source snapshot <time dateTime={asOf}>{new Date(asOf).toLocaleString()}</time>.</>}
              {found.limited && ` Showing first ${found.results.length}; narrow the query for more.`}
            </p>
            {found.total === 0 ? <p className="px-5 py-8 text-center font-ui text-sm text-muted-foreground">No matching recorded intelligence. Try another subject or filter.</p>
              : <div className="grid max-h-[50vh] min-w-0 gap-3 overflow-y-auto p-3 sm:grid-cols-2" aria-label="Recorded intelligence matches">
                {found.results.map(card => <VisualIntelligenceResultCard key={card.id} card={card} disabled={stagingId !== null} onAsk={() => void stage(card)} />)}
              </div>}
          </>}
        </>
      )}
    </section>
  );
}

export function VisualIntelligenceResultCard({ card, disabled, onAsk }: {
  card: IntelligenceCard;
  disabled: boolean;
  onAsk: () => void;
}) {
  const timestamp = pulseStoryTimestamp(card.createdAt);
  const evidence = card.evidence ?? [];
  const kindLabel = card.kind.replaceAll("_", " ");
  return <article data-testid="lios-visual-intelligence-result" className="min-w-0 overflow-hidden rounded-xl border border-border/65 bg-gradient-to-br from-amber-300/[0.055] via-white/[0.018] to-transparent">
    <div className="flex items-center gap-3 border-b border-border/45 px-4 py-3">
      <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-300/25 bg-amber-300/[0.06]"><Radar className="h-5 w-5 text-amber-200" /></span>
      <div className="min-w-0 flex-1">
        <span className="block font-ui text-xs font-semibold capitalize text-foreground">{kindLabel}</span>
        <span className="block font-ui text-xs text-muted-foreground">{card.priority} · {card.score.toFixed(0)} relevance</span>
      </div>
      {timestamp && <time dateTime={timestamp} className="shrink-0 font-ui text-xs text-muted-foreground">{new Date(timestamp).toLocaleDateString()}</time>}
    </div>
    <div className="space-y-2 px-4 py-3">
      <h3 className="font-ui text-base font-semibold leading-snug text-foreground">{card.title}</h3>
      <p className="line-clamp-3 font-ui text-sm leading-6 text-muted-foreground">{card.whatHappened}</p>
      {card.whyItMattersToUser && <p className="line-clamp-2 font-ui text-sm leading-5 text-foreground/85">{card.whyItMattersToUser}</p>}
      <details className="font-ui text-sm">
        <summary className="min-h-9 cursor-pointer py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"><BookOpenText aria-hidden="true" className="mr-2 inline h-4 w-4" />Recorded sources ({evidence.length})</summary>
        <ul className="mt-1 space-y-2 border-t border-border/50 py-2">
          {evidence.map((source, index) => {
            const href = safePulseSourceUrl(source.url);
            return <li key={`${source.id}:${index}`} className="break-words text-xs text-muted-foreground">
              <span>{source.source}</span>{source.provider && <> · {source.provider}</>}
              {href && <> · <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-flex items-center gap-1 text-amber-200 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">Open recorded source <ExternalLink aria-hidden="true" className="h-3 w-3" /></a></>}
            </li>;
          })}
          {!evidence.length && <li>No attributed source evidence attached. Verify before relying on this item.</li>}
        </ul>
      </details>
      <button type="button" disabled={disabled} onClick={onAsk}
        aria-label={`Ask LiOS about ${card.title}`}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/[0.09] px-3 py-2 font-ui text-sm font-medium text-foreground hover:bg-amber-300/[0.15] focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-50">
        <Sparkles aria-hidden="true" className="h-4 w-4" />Ask LiOS
      </button>
    </div>
  </article>;
}
