import * as React from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, CheckCircle2, Clock3, ExternalLink, Radar, Search, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { pulseStoryTimestamp, safePulseSourceUrl } from "@/lib/pulseStoryPresentation";
import { LicensedEditorialImage } from "./LicensedEditorialImage";
import {
  ATTENTION_FILTERS, filterHomeAttention, homeAttentionCounts,
  homeAttentionEntries, homeAttentionReasons, type AttentionFilter, type HomeAttentionEntry,
} from "@/lib/homeIntelligenceDiscovery";
import type { ActionInboxItem, IntelligenceCard } from "@shared/waveDContracts";
import { homeAttentionReadPresentation } from "@/lib/homeAttentionReadPresentation";

interface HomeAttention {
  asOf?: string;
  cards: IntelligenceCard[];
  actionInbox: ActionInboxItem[];
}

/** One Home view over the existing Wave D Pulse and Action Inbox, not another feed or scheduler. */
export function HomeAttentionPanel() {
  const [open, setOpen] = useState(false);
  return (
    <details
      data-testid="lios-home-attention"
      className="mt-3 overflow-hidden rounded-xl border border-border/60 bg-background/50"
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-3 font-ui text-sm font-semibold text-foreground outline-none hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300/70">
        <Radar aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-200" />
        Home intelligence
      </summary>
      {open && <HomeAttentionContents />}
    </details>
  );
}

function HomeAttentionContents() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<AttentionFilter>("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(9);

  const query = useQuery<HomeAttention>({
    queryKey: ["/api/wave-d/pulse"],
    queryFn: async () => (await apiRequest("GET", "/api/wave-d/pulse")).json(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ActionInboxItem["status"] }) => {
      await apiRequest("POST", `/api/wave-d/action-inbox/${encodeURIComponent(id)}`, { status });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/wave-d/pulse"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/wave-d/action-inbox"] }),
      ]);
    },
  });

  const entries = useMemo(
    () => homeAttentionEntries(query.data?.cards ?? [], query.data?.actionInbox ?? []),
    [query.data],
  );
  const counts = useMemo(() => homeAttentionCounts(entries), [entries]);
  const filtered = useMemo(() => filterHomeAttention(entries, filter, search), [entries, filter, search]);
  const page = filtered.slice(0, visibleCount);
  const asOf = pulseStoryTimestamp(query.data?.asOf);
  const readState = homeAttentionReadPresentation({
    hasData: Boolean(query.data),
    pending: query.isPending,
    fetching: query.isFetching,
    failed: query.isError,
    matchingCount: filtered.length,
  });
  const disableWrite = mutation.isPending || !readState.mayReview;

  const changeFilter = (next: AttentionFilter) => { setFilter(next); setVisibleCount(9); };
  const changeSearch = (next: string) => { setSearch(next); setVisibleCount(9); };

  const update = (entry: HomeAttentionEntry, status: ActionInboxItem["status"]) => {
    // Never invent an Inbox ID from an unrelated story. Only server-issued Inbox
    // records may be mutated by these buttons; the server still owns validation.
    if (disableWrite || !entry.inbox) return;
    mutation.mutate({ id: entry.inbox.id, status });
  };

  return (
    <div className="space-y-4 border-t border-border/60 p-3 sm:p-4" data-testid="home-intelligence-discovery">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-ui text-base font-semibold text-foreground">{readState.heading}</h3>
          {asOf && <p className="mt-1 flex items-center gap-1.5 font-ui text-xs text-muted-foreground">
            <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
            Source snapshot <time dateTime={asOf}>{new Date(asOf).toLocaleString()}</time>
          </p>}
        </div>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="min-h-11 rounded-lg border border-border/65 px-3 py-2 font-ui text-sm font-medium text-foreground hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-50"
        >
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {query.isPending && <p role="status" className="rounded-lg border border-border/50 px-3 py-4 font-ui text-sm text-muted-foreground">{readState.availabilityText}</p>}
      {query.isError && <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300/30 bg-amber-300/[0.05] p-3 font-ui text-sm leading-6 text-amber-100">
        <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        {readState.availabilityText}
      </p>}
      {mutation.isError && <p role="alert" className="rounded-lg border border-rose-300/25 p-3 font-ui text-sm text-rose-200">{mutation.error instanceof Error ? mutation.error.message : "The review update could not be saved."}</p>}
      {mutation.isPending && <p role="status" className="font-ui text-sm text-muted-foreground">Saving review status…</p>}
      {mutation.isSuccess && !mutation.isPending && <p role="status" className="flex items-center gap-1.5 font-ui text-sm text-emerald-200"><CheckCircle2 aria-hidden="true" className="h-4 w-4" />Review status saved.</p>}

      {query.data && (
        <>
          {query.isError && <p role="status" className="font-ui text-sm text-muted-foreground">Source snapshot is historical. Review controls remain disabled until a verified refresh.</p>}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter Home intelligence">
            {ATTENTION_FILTERS.map(item => (
              <button
                key={item.key}
                type="button"
                data-testid={`home-attention-filter-${item.key}`}
                aria-pressed={filter === item.key}
                onClick={() => changeFilter(item.key)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 font-ui text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 ${filter === item.key ? "border-amber-300/40 bg-amber-300/[0.075] text-foreground" : "border-border/60 text-muted-foreground hover:bg-white/[0.045] hover:text-foreground"}`}
              >
                {item.label}
                <span className="font-ui text-xs tabular-nums opacity-75">{counts[item.key]}</span>
              </button>
            ))}
          </div>

          <div className="flex min-h-11 items-center gap-2 rounded-lg border border-border/65 bg-white/[0.02] px-3 focus-within:ring-2 focus-within:ring-amber-300/65">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <label className="sr-only" htmlFor="lios-home-attention-search">Search recorded Home intelligence</label>
            <input
              id="lios-home-attention-search"
              type="search"
              value={search}
              onChange={event => changeSearch(event.target.value)}
              maxLength={120}
              placeholder="Search subjects and sources"
              className="min-w-0 flex-1 bg-transparent py-2 font-ui text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div role="status" className="font-ui text-xs tabular-nums text-muted-foreground">
            Showing {page.length} of {readState.countText ?? "unverified items"}
          </div>

          {!filtered.length && <div className="rounded-xl border border-dashed border-border/65 px-4 py-8 text-center font-ui text-sm text-muted-foreground">
            {query.isError ? readState.emptyText : entries.length === 0 ? readState.emptyText : "No matching recorded items. Try another filter or search."}
          </div>}

          <div className="grid min-w-0 gap-3 lg:grid-cols-2" aria-label="Home intelligence items">
            {page.map(entry => (
              <HomeIntelligenceCard
                key={entry.card.id}
                entry={entry}
                disabled={disableWrite}
                saving={mutation.isPending && mutation.variables?.id === entry.inbox?.id}
                onUpdate={status => update(entry, status)}
              />
            ))}
          </div>

          {page.length < filtered.length && <button
            type="button"
            onClick={() => setVisibleCount(count => count + 9)}
            className="min-h-11 rounded-lg border border-border/65 px-4 py-2 font-ui text-sm font-medium text-foreground hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-amber-300/70"
          >Show more ({filtered.length - page.length} remaining)</button>}
        </>
      )}
    </div>
  );
}

export function HomeIntelligenceCard({ entry, onUpdate, disabled, saving }: {
  entry: HomeAttentionEntry;
  onUpdate: (status: ActionInboxItem["status"]) => void;
  disabled: boolean;
  saving: boolean;
}) {
  const { card, inbox, reviewStatus } = entry;
  const timestamp = pulseStoryTimestamp(card.createdAt);
  const reasons = homeAttentionReasons(card);
  const evidence = card.evidence ?? [];

  return (
    <article data-testid="home-intelligence-card" data-card-kind={card.kind} className="min-w-0 space-y-3 rounded-xl border border-border/60 bg-gradient-to-br from-white/[0.042] to-transparent p-4">
      <div className="flex flex-wrap items-center gap-2 font-ui text-xs">
        <span className="rounded-md border border-border/65 px-2 py-1 text-muted-foreground">{card.kind.replaceAll("_", " ")}</span>
        <span className="rounded-md border border-amber-300/25 px-2 py-1 font-semibold capitalize text-amber-100">{card.priority}</span>
        <span className="ml-auto tabular-nums text-muted-foreground">{Number.isFinite(card.score) ? card.score.toFixed(0) : "—"} relevance</span>
      </div>
      <LicensedEditorialImage media={card.media} sourceIds={evidence.map(source => source.id)} variant="compact" className="w-full" />
      <h4 className="font-ui text-base font-semibold leading-snug tracking-tight text-foreground">{card.title}</h4>
      <p className="font-ui text-sm leading-6 text-muted-foreground">{card.whatHappened}</p>
      {card.whyItMattersToUser && <p className="border-l-2 border-amber-300/35 pl-3 font-ui text-sm leading-6 text-foreground/85">{card.whyItMattersToUser}</p>}
      <div className="flex flex-wrap items-center gap-2 font-ui text-xs text-muted-foreground">
        <span>{reviewStatus === "open" ? "Awaiting review" : reviewStatus === "resolved" ? "Reviewed" : reviewStatus === "snoozed" ? "Snoozed" : "For reference"}</span>
        {timestamp && <time dateTime={timestamp}>· {new Date(timestamp).toLocaleDateString()}</time>}
        <span className="ml-auto inline-flex items-center gap-1"><BookOpenText aria-hidden="true" className="h-3.5 w-3.5" />{evidence.length} sources</span>
      </div>

      <details className="rounded-lg border border-border/55 px-3 py-2 font-ui text-sm text-muted-foreground">
        <summary className="min-h-9 cursor-pointer py-1 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70">Why this appeared</summary>
        <ul className="mt-2 list-disc space-y-1.5 border-t border-border/50 pb-1 pl-4 pt-3 text-sm leading-5">
          {reasons.map(reason => <li key={reason}>{reason}</li>)}
        </ul>
      </details>

      <details className="rounded-lg border border-border/55 px-3 py-2 font-ui text-sm text-muted-foreground">
        <summary className="min-h-9 cursor-pointer py-1 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70">Inspect recorded sources ({evidence.length})</summary>
        {evidence.length ? <ul className="mt-2 space-y-2 border-t border-border/50 pt-3">
          {evidence.map((source, index) => {
            const href = safePulseSourceUrl(source.url);
            const asOf = pulseStoryTimestamp(source.availableAt);
            return <li key={`${source.id}:${index}`} className="break-words text-sm leading-6">
              <span className="font-medium text-foreground">{source.source}</span>
              {source.provider && <span> · {source.provider}</span>}
              {asOf && <span> · <time dateTime={asOf}>{new Date(asOf).toLocaleDateString()}</time></span>}
              {href && <> · <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-flex items-center gap-1 font-medium text-amber-200 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70">Open recorded source <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></a></>}
            </li>;
          })}
        </ul> : <p className="mt-2 border-t border-border/50 pt-3 text-sm leading-6">No attributed sources attached. Verify independently before acting.</p>}
      </details>

      {inbox && <div className="flex flex-wrap gap-2 border-t border-border/55 pt-3">
        {reviewStatus === "open" ? <>
          <button type="button" disabled={disabled} onClick={() => onUpdate("resolved")} className="min-h-10 rounded-lg border border-amber-300/35 bg-amber-300/[0.09] px-3 py-2 font-ui text-sm font-medium text-foreground hover:bg-amber-300/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-50">{saving ? "Saving…" : "Mark reviewed"}</button>
          <button type="button" disabled={disabled} onClick={() => onUpdate("snoozed")} className="min-h-10 rounded-lg border border-border/70 px-3 py-2 font-ui text-sm font-medium text-foreground hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-50">Snooze</button>
        </> : <button type="button" disabled={disabled} onClick={() => onUpdate("open")} className="min-h-10 rounded-lg border border-border/70 px-3 py-2 font-ui text-sm font-medium text-foreground hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-50">Reopen for review</button>}
      </div>}
    </article>
  );
}
