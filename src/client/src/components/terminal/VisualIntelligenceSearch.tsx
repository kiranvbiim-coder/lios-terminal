import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { BookOpenText, ExternalLink, Radar, Sparkles } from "lucide-react";
import type { IntelligenceCard } from "@shared/waveDContracts";
import { pulseStoryTimestamp, safePulseSourceUrl, pulseStoryMediaSourceIds } from "@/lib/pulseStoryPresentation";
import { LicensedEditorialImage } from "./LicensedEditorialImage";
import { RecordedContextPicture } from "./RecordedContextPicture";
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
  const [presentation, setPresentation] = useState<"cards" | "table" | "timeline">("cards");
  const [foregroundRevision, setForegroundRevision] = useState(0);
  const activeQuery = query.trim().slice(0, 120);
  const searchReady = activeQuery.length >= 2;

  useEffect(() => {
    if (!searchReady) return;
    // An authenticated snapshot is not valid indefinitely across sign-out,
    // account switching, permission revocation or saved Follow/Mute changes.
    // Only recheck when the panel regains foreground; never per keystroke.
    let lastForegroundCheck = Date.now();
    const onForegroundChange = () => {
      if (document.visibilityState === "hidden") {
        // Hide the last authorized records immediately and abort an in-flight
        // fetch via the revision-driven effect cleanup.
        setSnapshot(null);
        setFailure(null);
        setPending(false);
        setForegroundRevision(value => value + 1);
        lastForegroundCheck = 0;
        return;
      }
      const now = Date.now();
      // Focus and visibilitychange often arrive together: one network read.
      if (now - lastForegroundCheck < 500) return;
      lastForegroundCheck = now;
      setSnapshot(null);
      setFailure(null);
      setActionError(null);
      setPending(true);
      setForegroundRevision(value => value + 1);
    };
    window.addEventListener("focus", onForegroundChange);
    document.addEventListener("visibilitychange", onForegroundChange);
    return () => {
      window.removeEventListener("focus", onForegroundChange);
      document.removeEventListener("visibilitychange", onForegroundChange);
    };
  }, [searchReady]);

  useEffect(() => {
    // Fetch one authorized snapshot when this panel becomes searchable.
    // Further keystrokes filter locally; they MUST NOT refetch the entire
    // upstream Pulse or trigger extra provider calls.
    setSnapshot(null);
    setFailure(null);
    setActionError(null);
    if (!searchReady || document.visibilityState === "hidden") { setPending(false); return; }
    const controller = new AbortController();
    setPending(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/wave-d/pulse", {
          signal: controller.signal, credentials: "same-origin", cache: "no-store",
        });
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
  }, [searchReady, foregroundRevision]);

  const cards = snapshot?.cards ?? [];
  const counts = useMemo(() => intelligenceSearchCounts(cards), [cards]);
  const found = useMemo(() => searchRecordedIntelligence(cards, activeQuery, facet), [cards, activeQuery, facet]);
  const asOf = pulseStoryTimestamp(snapshot?.asOf);
  const datedResults = useMemo(() => found.results
    .flatMap(card => { const at = pulseStoryTimestamp(card.createdAt); return at ? [{ card, at }] : []; })
    .sort((a, b) => b.at.localeCompare(a.at) || a.card.id.localeCompare(b.card.id)), [found.results]);

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
            <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2" role="group" aria-label="Intelligence results presentation">
              {(["cards", "table", "timeline"] as const).map(mode => <button key={mode} type="button"
                aria-pressed={presentation === mode} onClick={() => setPresentation(mode)}
                className={`min-h-10 rounded-lg border px-3 py-2 font-ui text-xs focus-visible:ring-2 focus-visible:ring-amber-300/70 ${presentation === mode ? "border-amber-300/50 text-foreground" : "border-border/60 text-muted-foreground"}`}>
                {mode === "timeline" ? "Recorded timeline" : mode === "table" ? "Table" : "Cards"}
              </button>)}
            </div>
            <p role="status" className="px-4 py-3 font-ui text-xs text-muted-foreground">
              {found.total} matches within {cards.length} returned intelligence items.
              {asOf && <> Source snapshot <time dateTime={asOf}>{new Date(asOf).toLocaleString()}</time>.</>}
              {found.limited && ` Showing first ${found.results.length}; narrow the query for more.`}
            </p>
            {found.total === 0 ? <p className="px-5 py-8 text-center font-ui text-sm text-muted-foreground">No matching recorded intelligence. Try another subject or filter.</p>
              : presentation === "table" ? (
                <div className="max-h-[50vh] overflow-auto p-3" aria-label="Recorded intelligence table">
                  <table className="w-full min-w-[520px] border-collapse text-left font-ui text-xs">
                    <caption className="pb-2 text-left text-muted-foreground">Only the currently authorized, recorded source snapshot. No inferred rows.</caption>
                    <thead><tr className="border-b border-border/60 text-muted-foreground">
                      <th scope="col" className="p-2">Subject</th><th scope="col" className="p-2">Kind</th>
                      <th scope="col" className="p-2">Recorded time</th><th scope="col" className="p-2">Sources</th>
                      <th scope="col" className="p-2">Action</th>
                    </tr></thead>
                    <tbody>{found.results.map(card => {
                      const recordedAt = pulseStoryTimestamp(card.createdAt);
                      return <tr key={card.id} className="border-b border-border/40">
                        <th scope="row" className="min-w-[180px] max-w-[340px] break-words p-2 font-medium text-foreground">{card.title}</th>
                        <td className="p-2 capitalize text-muted-foreground">{card.kind.replaceAll("_", " ")}</td>
                        <td className="whitespace-nowrap p-2 text-muted-foreground">{recordedAt ? <time dateTime={recordedAt}>{new Date(recordedAt).toLocaleString()}</time> : "Not recorded"}</td>
                        <td className="p-2 text-muted-foreground"><VisualIntelligenceSourceDisclosure card={card} /></td>
                        <td className="p-2"><button type="button" disabled={stagingId !== null} onClick={() => void stage(card)}
                          aria-label={`Ask LiOS about ${card.title}`}
                          className="min-h-10 rounded-lg border border-border/60 px-3 text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-40">Ask LiOS</button></td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              ) : presentation === "timeline" ? (
                <div className="max-h-[50vh] overflow-y-auto p-3" aria-label="Recorded intelligence chronology">
                  <p className="mb-3 font-ui text-xs text-muted-foreground">Ordered by the source card's recorded timestamp, not verified event chronology or publisher revisions.</p>
                  {datedResults.length ? <ol className="space-y-2 border-l border-border/65 pl-4">{datedResults.map(({ card, at }) =>
                    <li key={card.id} className="relative rounded-lg border border-border/60 p-3">
                      <span className="absolute -left-[21px] top-5 h-2.5 w-2.5 rounded-full border border-amber-300/60 bg-background" aria-hidden="true"/>
                      <time dateTime={at} className="font-ui text-xs text-muted-foreground">{new Date(at).toLocaleString()}</time>
                      <h3 className="mt-1 font-ui text-sm font-semibold text-foreground">{card.title}</h3>
                      <p className="mt-1 line-clamp-2 font-ui text-xs leading-5 text-muted-foreground">{card.whatHappened}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 font-ui text-xs text-muted-foreground">
                        <VisualIntelligenceSourceDisclosure card={card} />
                        <button type="button" disabled={stagingId !== null} onClick={() => void stage(card)}
                          aria-label={`Ask LiOS about ${card.title}`}
                          className="min-h-10 rounded-lg border border-border/60 px-3 text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-40">Ask LiOS</button>
                      </div>
                    </li>)}</ol> : <p role="status" className="font-ui text-xs text-muted-foreground">No source items have valid recorded times. Open Cards or Table to inspect the original records.</p>}
                  {datedResults.length < found.results.length && <p className="mt-3 font-ui text-xs text-muted-foreground">{found.results.length - datedResults.length} item(s) lack a recorded time and are not placed on this timeline.</p>}
                </div>
              ) : <div className="grid max-h-[50vh] min-w-0 gap-3 overflow-y-auto p-3 sm:grid-cols-2" aria-label="Recorded intelligence matches">
                {found.results.map(card => <VisualIntelligenceResultCard key={card.id} card={card} disabled={stagingId !== null} onAsk={() => void stage(card)} />)}
              </div>}
          </>}
        </>
      )}
    </section>
  );
}

/**
 * Compact publisher evidence used by Table and recorded chronology. Every
 * outbound URL passes the same credential-safe public-source gate as Cards.
 * Never infer supporting references from a news title or provider label.
 */
export function VisualIntelligenceSourceDisclosure({ card }: { card: IntelligenceCard }) {
  const sources = card.evidence ?? [];
  return <details className="min-w-[90px] font-ui text-xs">
    <summary className="min-h-10 cursor-pointer rounded-md px-1 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
      {sources.length} source{sources.length === 1 ? "" : "s"}
    </summary>
    <ul className="max-w-[250px] space-y-1.5 border-t border-border/50 pt-2">
      {sources.slice(0, 6).map((source, index) => {
        const safeUrl = safePulseSourceUrl(source.url);
        return <li key={`${source.id}:${index}`} className="min-w-0 break-words leading-5 text-muted-foreground">
          {safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
            className="underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
            {source.source}
          </a> : <span>{source.source}</span>}
          {source.provider && <span> · {source.provider}</span>}
        </li>;
      })}
      {sources.length > 6 && <li>{sources.length - 6} more source references in Cards view</li>}
      {!sources.length && <li>No recorded evidence attached.</li>}
    </ul>
  </details>;
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
      <LicensedEditorialImage media={card.media} sourceIds={pulseStoryMediaSourceIds(evidence)} variant="compact" className="w-full" />
      {!card.media && <RecordedContextPicture title={card.title}
        hasPublicEvidence={evidence.some(source => safePulseSourceUrl(source.url) !== null)} />}
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
