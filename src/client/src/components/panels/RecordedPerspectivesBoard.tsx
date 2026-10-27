import * as React from "react";
import { useState } from "react";
import {
  ArrowRight, ArrowUpRight, BookOpenCheck, GitBranch, GitCompareArrows,
  Link2, Search, ShieldAlert, ShieldCheck, SplitSquareHorizontal,
} from "lucide-react";
import { safeHref } from "@/lib/chatMarkdown";
import { RecordedEvidenceFlowPanel } from "./RecordedEvidenceFlowPanel";
import {
  buildPerspectiveModel, filterPerspectiveLinks, filterUnlinkedEvidence,
  perspectivePublishedDate, type PerspectiveEvidence, type PerspectiveGroup,
  type PerspectiveLink, type PerspectiveRelation,
} from "@/lib/researchPerspectives";

const LANE: Record<PerspectiveGroup, { label: string; meaning: string; tone: string; border: string }> = {
  support: {
    label: "Supporting links", meaning: "Explicit supports relationships between recorded evidence",
    tone: "text-emerald-200", border: "border-emerald-300/25",
  },
  challenge: {
    label: "Challenging links", meaning: "Explicit contradicts relationships between recorded evidence",
    tone: "text-rose-200", border: "border-rose-300/25",
  },
  context: {
    label: "Other relationships", meaning: "Cites, supersedes, derives from, or affects — not agreement claims",
    tone: "text-cyan-200", border: "border-cyan-300/25",
  },
};

function recordedLink(url: string | null): string | null {
  if (!url) return null;
  const href = safeHref(url);
  return href && /^https?:\/\//i.test(href) ? href : null;
}

export function PerspectiveSource({ item }: { item: PerspectiveEvidence }) {
  const href = recordedLink(item.sourceUrl);
  return <article className="min-w-0 space-y-2 rounded-xl border border-border/60 bg-background/55 p-3" data-perspective-evidence={item.id}>
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded border border-border/60 px-2 py-1 font-ui text-[11px] text-muted-foreground">
        Evidence E{item.id} · {item.evidenceKind.replaceAll("_", " ")}
      </span>
      <span className="font-ui text-[11px] text-muted-foreground">{item.evidenceType.replaceAll("_", " ")}</span>
    </div>
    <h4 className="break-words font-ui text-sm font-semibold leading-5 text-foreground">{item.title}</h4>
    <p className="break-words font-ui text-xs leading-5 text-muted-foreground">
      {item.sourceName || "Publisher not recorded"}{item.provider && item.provider !== item.sourceName ? ` · ${item.provider}` : ""}
    </p>
    <time className="block font-ui text-[11px] text-muted-foreground" dateTime={item.publishedAt && Number.isFinite(Date.parse(item.publishedAt)) ? item.publishedAt : undefined}>
      {perspectivePublishedDate(item.publishedAt)}
    </time>
    <div className="max-h-52 overflow-y-auto rounded-lg border-l-2 border-amber-300/35 bg-white/[0.015] py-2 pl-3 pr-2">
      <p className="whitespace-pre-wrap break-words font-ui text-sm leading-6 text-foreground/85">
        {item.excerpt || "No excerpt recorded for this evidence."}
      </p>
    </div>
    {item.annotation && <p className="whitespace-pre-wrap break-words rounded-lg bg-white/[0.03] p-2 font-ui text-xs leading-5 text-foreground/80">Analyst annotation · {item.annotation}</p>}
    {href ? <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex min-h-10 items-center gap-1.5 font-ui text-xs text-cyan-200 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
      Open recorded source <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
    </a> : <p className="font-ui text-[11px] text-muted-foreground">No safe source URL recorded</p>}
  </article>;
}

function PerspectivePair({ link, active, onSelect }: {
  link: PerspectiveLink; active: boolean; onSelect: () => void;
}) {
  return <button type="button" aria-pressed={active} onClick={onSelect}
    data-perspective-link={link.id}
    className={`min-h-28 w-full rounded-xl border bg-background/55 p-3 text-left transition-colors hover:bg-white/[0.045] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${active ? "border-amber-300/65 bg-amber-300/[0.04]" : "border-border/55"}`}>
    <span className="block font-ui text-[11px] font-semibold text-muted-foreground">
      E{link.from.id} <ArrowRight className="inline h-3 w-3" aria-hidden="true" /> E{link.to.id}
      <span className="ml-2 text-cyan-200">{link.type.replaceAll("_", " ")}</span>
    </span>
    <span className="mt-1.5 block line-clamp-2 font-ui text-sm font-semibold leading-5 text-foreground">{link.from.title}</span>
    <span className="mt-1.5 block font-ui text-xs text-muted-foreground">Related to</span>
    <span className="mt-1 block line-clamp-2 font-ui text-sm leading-5 text-foreground/90">{link.to.title}</span>
    {link.note && <span className="mt-2 block line-clamp-2 border-t border-border/45 pt-2 font-ui text-xs leading-5 text-muted-foreground">Recorded relationship note · {link.note}</span>}
    <span className="mt-2 block font-ui text-[11px] text-amber-200">Inspect both records</span>
  </button>;
}

export function RecordedPerspectivesBoard({ title, question, thesis, evidence, relationships, onOpenInvestigation }: {
  title: string;
  question: string;
  thesis: string | null;
  evidence: readonly PerspectiveEvidence[];
  relationships: readonly PerspectiveRelation[];
  onOpenInvestigation: () => void;
}) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<PerspectiveGroup | "all">("all");
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [visiblePerLane, setVisiblePerLane] = useState(4);
  const model = buildPerspectiveModel(evidence, relationships);
  const filtered = filterPerspectiveLinks(model.links, search, group);
  const unlinked = group === "all" ? filterUnlinkedEvidence(model.unlinked, search) : [];
  const selected = filtered.find(link => link.id === focusedId) ?? filtered[0] ?? null;
  const groups: PerspectiveGroup[] = group === "all" ? ["support", "challenge", "context"] : [group];
  const maxPerLane = visiblePerLane;

  return <section data-testid="research-perspectives-explorer" aria-label="Research Perspectives Explorer" className="min-h-full space-y-5 p-3 sm:p-5">
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-6 w-6 text-amber-200" aria-hidden="true" />
          <div>
            <h2 className="font-ui text-xl font-semibold text-foreground">Perspectives Explorer</h2>
            <p className="mt-1 font-ui text-xs text-muted-foreground">Recorded arguments and challenges — not AI-assigned publisher opinions.</p>
          </div>
        </div>
        <button type="button" onClick={onOpenInvestigation}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300/35 px-3 font-ui text-sm text-amber-200 hover:bg-amber-300/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
          <BookOpenCheck className="h-4 w-4" aria-hidden="true"/> Open investigation
        </button>
      </div>
      <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-amber-300/[0.045] to-background p-4">
        <h3 className="break-words font-ui text-lg font-semibold text-foreground">{title}</h3>
        <p className="mt-2 font-ui text-xs font-semibold text-muted-foreground">Decision question</p>
        <p className="mt-1 whitespace-pre-wrap break-words font-ui text-sm leading-6 text-foreground/90">{question}</p>
        <p className="mt-3 font-ui text-xs font-semibold text-muted-foreground">Working thesis · recorded analyst position</p>
        <p className="mt-1 whitespace-pre-wrap break-words font-ui text-sm leading-6 text-foreground/90">{thesis || "No analyst thesis recorded."}</p>
      </div>
    </header>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Recorded evidence coverage">
      {[
        ["Evidence records", model.evidenceCount],
        ["Supporting links", model.supportCount],
        ["Challenging links", model.challengeCount],
        ["Unlinked records", model.unlinked.length],
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-border/60 bg-card/70 p-3">
        <p className="font-ui text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 font-ui text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      </div>)}
    </div>
    <p className="font-ui text-xs leading-5 text-muted-foreground">
      {model.sourceCount} distinct recorded source names · {model.providerCount} distinct provider names · {model.contextCount} other links
      {model.unresolvedCount > 0 ? ` · ${model.unresolvedCount} relationships have unavailable evidence endpoints` : ""}.
      Coverage counts do not measure publisher independence, reliability or consensus.
    </p>

    <div className="flex flex-wrap gap-2">
      <label className="flex min-h-11 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3">
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true"/>
        <span className="sr-only">Search evidence relationships</span>
        <input type="search" value={search} onChange={event => { setSearch(event.target.value); setVisiblePerLane(4); setFocusedId(null); }}
          placeholder="Search exact source titles, excerpts and notes"
          className="min-w-0 flex-1 bg-transparent py-2 font-ui text-sm text-foreground outline-none placeholder:text-muted-foreground" />
      </label>
      <label className="flex items-center gap-2 font-ui text-xs text-muted-foreground">
        <span>Show</span>
        <select aria-label="Filter explicit relationship types" value={group}
          onChange={event => { setGroup(event.target.value as PerspectiveGroup | "all"); setVisiblePerLane(4); setFocusedId(null); }}
          className="min-h-11 rounded-lg border border-border/70 bg-background px-3 font-ui text-sm text-foreground">
          <option value="all">All links</option>
          <option value="support">Supports links</option>
          <option value="challenge">Contradicts links</option>
          <option value="context">Other links</option>
        </select>
      </label>
    </div>

    {model.evidenceCount > 0 && <RecordedEvidenceFlowPanel links={filtered} selectedId={selected?.id ?? null} onSelect={setFocusedId} />}

    {!model.evidenceCount ? <div role="status" className="rounded-xl border border-dashed border-border/65 p-8 text-center">
      <ShieldAlert className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true"/>
      <h3 className="mt-2 font-ui text-sm font-semibold">No retained evidence yet</h3>
      <p className="mt-2 font-ui text-xs leading-5 text-muted-foreground">Open the investigation and attach source records. LIOS will not invent viewpoints to fill an empty comparison.</p>
    </div> : <>
      {filtered.length ? <>
        <div className="grid gap-3 lg:grid-cols-3">
          {groups.map(kind => {
            const lane = LANE[kind];
            const items = filtered.filter(link => link.group === kind);
            return <section key={kind} aria-label={lane.label}
              className={`min-w-0 space-y-3 rounded-2xl border bg-card/40 p-3 ${lane.border}`}>
              <div>
                <h3 className={`font-ui text-sm font-semibold ${lane.tone}`}>{lane.label} · {items.length}</h3>
                <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">{lane.meaning}</p>
              </div>
              {items.length ? items.slice(0, maxPerLane).map(link => <PerspectivePair
                key={link.id} link={link} active={selected?.id === link.id} onSelect={() => setFocusedId(link.id)} />)
                : <p className="rounded-lg border border-dashed border-border/50 p-4 font-ui text-xs leading-5 text-muted-foreground">No matching recorded links in this category.</p>}
              {items.length > maxPerLane && <p className="font-ui text-[11px] text-muted-foreground">{items.length - maxPerLane} more links not yet shown</p>}
            </section>;
          })}
        </div>
        {filtered.some(link => groups.some(kind => link.group === kind) && filtered.filter(item => item.group === link.group).length > maxPerLane) && <button type="button"
          onClick={() => setVisiblePerLane(n => n + 12)}
          className="min-h-10 w-full rounded-lg border border-border/70 font-ui text-sm text-foreground hover:bg-white/[0.05]">
          Show more recorded relationships
        </button>}
        {selected && <section aria-label="Inspect both ends of an explicit relationship" className="rounded-2xl border border-amber-300/25 bg-card/65 p-4" data-testid="perspectives-source-comparison">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SplitSquareHorizontal className="h-5 w-5 text-amber-200" aria-hidden="true"/>
            <h3 className="font-ui text-sm font-semibold text-foreground">Inspect both records</h3>
            <span className="rounded border border-border/70 px-2 py-1 font-ui text-xs text-cyan-200">{selected.type.replaceAll("_", " ")} · explicitly recorded</span>
          </div>
          <p className="mb-3 font-ui text-xs leading-5 text-muted-foreground">This relationship connects two pieces of evidence; it does not classify the publisher, prove a claim or establish agreement among all sources.</p>
          {selected.note && <p className="mb-3 rounded-lg border border-border/55 p-3 font-ui text-xs text-foreground/85">Recorded analyst relationship note · {selected.note}</p>}
          <div className="grid gap-3 lg:grid-cols-2">
            <PerspectiveSource item={selected.from}/>
            <PerspectiveSource item={selected.to}/>
          </div>
        </section>}
      </> : <p role="status" className="rounded-xl border border-dashed border-border/60 p-5 font-ui text-sm text-muted-foreground">
        No recorded evidence links match these filters.
      </p>}
      {unlinked.length > 0 && <details className="rounded-2xl border border-border/65 bg-card/40 p-4" data-testid="perspectives-unlinked">
        <summary className="cursor-pointer font-ui text-sm font-semibold text-foreground">Evidence without recorded links · {unlinked.length}</summary>
        <p className="mt-2 font-ui text-xs leading-5 text-muted-foreground">Unlinked means no explicit relationship was retained, not that a source is neutral, wrong or irrelevant.</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {unlinked.slice(0, 12).map(item => <PerspectiveSource key={item.id} item={item}/>)}
        </div>
        {unlinked.length > 12 && <p className="mt-2 font-ui text-xs text-muted-foreground">{unlinked.length - 12} additional unlinked records. Open the investigation to inspect all evidence.</p>}
      </details>}
    </>}
    <footer className="rounded-lg border border-border/60 bg-background/40 p-3 font-ui text-xs leading-5 text-muted-foreground">
      <ShieldCheck className="mr-2 inline h-4 w-4 text-cyan-200" aria-hidden="true"/>
      Perspectives are based exclusively on relationships and source details retained in this authorized investigation. Nothing is scored as politically left/right, categorized as publisher sentiment or silently added to the evidence ledger.
      <span className="ml-1 inline-flex items-center gap-1 text-amber-200"><GitBranch className="h-3 w-3" aria-hidden="true"/> Record or correct links in Investigation.</span>
    </footer>
  </section>;
}
