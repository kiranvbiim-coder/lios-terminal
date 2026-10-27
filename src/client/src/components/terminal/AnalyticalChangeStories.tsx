/**
 * Cross-context "What Changed" cards from locally captured analytical snapshots.
 * Separate from the P6 Project What Changed PR: no Project joins, new feed, or
 * publisher citations fabricated from local comparison records.
 */
import * as React from "react";
import { useState } from "react";
import {
  Activity, ArrowRight, CalendarDays, ChevronDown, ChevronUp,
  FileClock, Search,
} from "lucide-react";
import type { AnalyticalChange, AnalyticalContextChange } from "@/lib/terminalChangeIntelligence";
import {
  countShownChanges, displayRecordedValue, recordedChangeCategory,
  recordedChangeDelta, validLocalSnapshotTime, visibleAnalyticalChanges,
  type ChangeStoryFilter,
} from "@/lib/analyticalChangeStories";

const FILTER_OPTIONS: Array<{ value: ChangeStoryFilter; label: string }> = [
  { value: "all", label: "All changes" },
  { value: "numeric", label: "Numeric values" },
  { value: "structure", label: "Added or removed" },
  { value: "text", label: "Text and status" },
];

function SnapshotTime({ value }: { value: number }) {
  const valid = validLocalSnapshotTime(value);
  return valid ? (
    <time dateTime={valid} className="font-ui text-[11px] text-muted-foreground">
      {new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
    </time>
  ) : <span className="font-ui text-[11px] text-muted-foreground">Time not recorded</span>;
}

export function RecordedAnalyticalDifference({ change }: { change: AnalyticalChange }) {
  const delta = recordedChangeDelta(change);
  const category = recordedChangeCategory(change);
  return (
    <div className="min-w-0 rounded-xl border border-border/55 bg-background/55 p-3" data-recorded-change={change.key}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="break-words font-ui text-sm font-semibold text-foreground">{change.key}</h4>
        <span className="rounded-md border border-border/65 px-2 py-1 font-ui text-[11px] text-muted-foreground">
          {change.direction === "added" ? "Field added" : change.direction === "removed" ? "Field removed" :
            category === "numeric" ? "Numeric value" : "Recorded change"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="min-w-0 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.035] p-3">
          <div className="font-ui text-[11px] text-cyan-200">Previous capture</div>
          <p className="mt-1 max-h-48 overflow-y-auto break-words font-ui text-sm font-semibold tabular-nums text-foreground">{displayRecordedValue(change.before)}</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 rounded-lg border border-amber-300/20 bg-amber-300/[0.035] p-3">
          <div className="font-ui text-[11px] text-amber-200">Latest capture</div>
          <p className="mt-1 break-words font-ui text-sm font-semibold tabular-nums text-foreground">{displayRecordedValue(change.after)}</p>
        </div>
      </div>
      {delta && <p className="mt-2 font-ui text-xs text-foreground/80">Recorded numeric difference: <span className="font-semibold tabular-nums">{delta}</span></p>}
    </div>
  );
}

export function AnalyticalChangeStories({ entries, onOpen }: {
  entries: readonly AnalyticalContextChange[];
  onOpen: (view: AnalyticalContextChange["view"], symbol?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChangeStoryFilter>("all");
  const [visibleCount, setVisibleCount] = useState(12);
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = visibleAnalyticalChanges(entries, query, filter);
  const visible = filtered.slice(0, visibleCount);

  return (
    <section data-testid="analytical-what-changed-stories" aria-label="What Changed across analytical snapshots"
      className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-ui text-lg font-semibold text-foreground">What Changed</h3>
          <p className="mt-1 max-w-3xl font-ui text-sm leading-6 text-muted-foreground">
            Inspect exact differences between the two most recent saved analytical captures for each context.
            These are <strong className="font-medium text-foreground">local snapshot differences</strong>, not live market alerts,
            verified source evidence or model-predicted causes.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 font-ui text-xs text-muted-foreground">
          <FileClock className="h-4 w-4 text-cyan-200" aria-hidden="true" />
          {filtered.length} contexts · {countShownChanges(filtered)} recorded differences
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex min-h-10 min-w-[190px] flex-1 items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search recorded analytical changes</span>
          <input type="search" value={query} onChange={event => { setQuery(event.target.value); setVisibleCount(12); }}
            placeholder="Find a symbol, metric, context or field"
            className="min-w-0 flex-1 bg-transparent py-2 font-ui text-sm text-foreground outline-none placeholder:text-muted-foreground" />
        </label>
        <label className="flex items-center gap-2 font-ui text-xs text-muted-foreground">
          <span>Type</span>
          <select aria-label="Filter analytical changes" value={filter}
            onChange={event => { setFilter(event.target.value as ChangeStoryFilter); setVisibleCount(12); }}
            className="min-h-10 rounded-lg border border-border/70 bg-background px-3 font-ui text-sm text-foreground">
            {FILTER_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
      </div>
      {!entries.length ? <div role="status" className="rounded-2xl border border-dashed border-border/60 p-7 text-center">
        <Activity className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
        <h4 className="mt-3 font-ui text-sm font-semibold text-foreground">No comparable snapshots yet</h4>
        <p className="mx-auto mt-2 max-w-md font-ui text-xs leading-5 text-muted-foreground">
          LIOS needs two distinct saved captures in the same analytical context to show a before-and-after change.
          Nothing is inferred from missing captures.
        </p>
      </div> : !filtered.length ? <p role="status" className="rounded-xl border border-border/60 p-5 font-ui text-sm text-muted-foreground">
        No recorded differences match the selected filters.
      </p> : <div className="grid gap-4 xl:grid-cols-2">
        {visible.map(entry => {
          const open = expanded === entry.contextKey;
          const latest = validLocalSnapshotTime(entry.capturedAt);
          const previous = validLocalSnapshotTime(entry.previousCapturedAt);
          const preview = entry.changes.slice(0, 2);
          return <article key={entry.contextKey} data-changed-context={entry.contextKey}
            className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/65 bg-card/70 shadow-sm transition-colors hover:border-amber-300/25">
            <div className="border-b border-border/50 bg-[radial-gradient(circle_at_90%_5%,rgba(251,191,36,.07),transparent_65%)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-ui text-[11px] font-medium uppercase tracking-wider text-cyan-200">{entry.view.replaceAll("_", " ")} {entry.symbol ? `· ${entry.symbol}` : ""}</span>
                <span className="rounded border border-border/70 px-2 py-1 font-ui text-[11px] text-muted-foreground">{entry.changes.length} changed fields</span>
              </div>
              <h4 className="mt-2 break-words font-ui text-base font-semibold leading-6 text-foreground">{entry.label}</h4>
              <div className="mt-3 flex flex-wrap gap-2 font-ui text-[11px] text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true"/>
                <span>Previous <SnapshotTime value={entry.previousCapturedAt}/></span>
                <span aria-hidden="true">→</span>
                <span>Latest <SnapshotTime value={entry.capturedAt}/></span>
              </div>
              {(!latest || !previous) && <p className="mt-2 font-ui text-xs text-amber-200">One or more capture dates are unavailable.</p>}
            </div>
            <div className="flex-1 space-y-2 p-4">
              {preview.map(change => <RecordedAnalyticalDifference key={change.key} change={change}/>)}
              {entry.changes.length > preview.length && !open &&
                <p className="font-ui text-xs text-muted-foreground">{entry.changes.length - preview.length} more recorded fields available below.</p>}
              {open && entry.changes.slice(2).map(change => <RecordedAnalyticalDifference key={change.key} change={change}/>)}
              <p className="pt-1 font-ui text-[11px] leading-5 text-muted-foreground">
                No publisher citation is attached to this local comparison. Open the original analytical pane to inspect its inputs and provenance.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border/50 p-3">
              {entry.changes.length > 2 && <button type="button" aria-expanded={open}
                onClick={() => setExpanded(value => value === entry.contextKey ? null : entry.contextKey)}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/70 px-3 font-ui text-xs text-foreground hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true"/> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true"/>}
                {open ? "Hide extra fields" : `Show all ${entry.changes.length} fields`}
              </button>}
              <button type="button" onClick={() => onOpen(entry.view, entry.symbol || undefined)}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-300/25 bg-amber-300/[0.055] px-3 font-ui text-xs font-medium text-amber-200 hover:bg-amber-300/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                Open analytical pane <ArrowRight className="h-3.5 w-3.5" aria-hidden="true"/>
              </button>
            </div>
          </article>;
        })}
      </div>}
      {filtered.length > visible.length && <button type="button" onClick={() => setVisibleCount(count => count + 12)}
        className="mt-5 min-h-10 w-full rounded-xl border border-border/70 font-ui text-sm text-foreground hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
        Show more change contexts · {filtered.length - visible.length} remaining
      </button>}
    </section>
  );
}
