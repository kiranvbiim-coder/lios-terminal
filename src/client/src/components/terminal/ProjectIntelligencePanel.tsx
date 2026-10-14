import { useState } from "react";
import { GitCompareArrows, Network, RefreshCw, Search, Sparkles } from "lucide-react";
import {
  getProjectIntelligenceAsKnownOn,
  getProjectIntelligenceSnapshotState,
  rebuildProjectIntelligence,
  searchProjectIntelligence,
  useInvalidateProjectIntelligence,
  useProjectInsightLens,
  useProjectIntelligence,
  useProjectIntelligenceSnapshots,
} from "@/lib/useProjectIntelligence";
import type { P7HistoricalState, P7SearchHit } from "@shared/p7ResearchContracts";

export function ProjectIntelligencePanel({ projectId }: { projectId: number }) {
  const intelligence = useProjectIntelligence(projectId);
  const insights = useProjectInsightLens(projectId);
  const snapshots = useProjectIntelligenceSnapshots(projectId);
  const invalidate = useInvalidateProjectIntelligence();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<P7SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asKnownAt, setAsKnownAt] = useState("");
  const [historical, setHistorical] = useState<P7HistoricalState | null>(null);
  const [timelineType, setTimelineType] = useState("all");
  const [timelineRef, setTimelineRef] = useState("");

  const rebuild = async () => {
    setBusy(true); setError(null);
    try { await rebuildProjectIntelligence(projectId); invalidate(projectId); }
    catch (e) { setError(e instanceof Error ? e.message : "Project Intelligence rebuild failed."); }
    finally { setBusy(false); }
  };
  const search = async () => {
    if (!query.trim()) return;
    setBusy(true); setError(null);
    try { setHits(await searchProjectIntelligence(projectId, query.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : "Project search failed."); }
    finally { setBusy(false); }
  };

  const loadAsKnownOn = async () => {
    if (!asKnownAt) return;
    setBusy(true); setError(null);
    try { setHistorical(await getProjectIntelligenceAsKnownOn(projectId, new Date(asKnownAt).toISOString())); }
    catch (e) { setError(e instanceof Error ? e.message : "Historical Project state is unavailable."); }
    finally { setBusy(false); }
  };
  const loadSnapshot = async (snapshotId: string) => {
    setBusy(true); setError(null);
    try { setHistorical(await getProjectIntelligenceSnapshotState(projectId, snapshotId)); }
    catch (e) { setError(e instanceof Error ? e.message : "Historical Project state is unavailable."); }
    finally { setBusy(false); }
  };

  const lens = insights.data;
  const summary = intelligence.data;
  const snapshotRows = snapshots.data ?? [];
  const topInsights = lens?.insights.slice(0, 6) ?? [];
  const timelineNeedle = timelineRef.trim().toLowerCase();
  const timelineRows = (summary?.timeline ?? []).filter((event) =>
    (timelineType === "all" || event.type === timelineType)
    && (!timelineNeedle || [
      ...event.sourceRefs,
      ...event.entityRefs,
      ...event.artifactRefs,
      ...event.modelRefs,
      ...(event.decisionRef ? [event.decisionRef] : []),
    ].some((ref) => ref.toLowerCase().includes(timelineNeedle)))
  );

  return <section className="mt-4 rounded-xl border border-border/60 bg-white/[0.015] p-4" data-p7-project-intelligence>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><Network className="h-3.5 w-3.5 text-amber-300"/><div className="font-ui text-[10px] font-semibold">Project Intelligence</div></div>
        <div className="mt-1 font-ui text-[8px] text-muted-foreground">Reactive Context Graph · Insight Lens · Time Machine · Research Graph</div>
      </div>
      <button onClick={() => void rebuild()} disabled={busy} className="flex items-center gap-1 rounded border border-border/60 px-2.5 py-1.5 font-ui text-[7px] text-muted-foreground hover:text-foreground disabled:opacity-40"><RefreshCw className="h-3 w-3"/>{busy ? "Working…" : "Refresh index"}</button>
    </div>

    <div className="mt-3 grid gap-2 sm:grid-cols-4">
      <Metric label="Indexed sources" value={summary?.documentCount ?? 0}/>
      <Metric label="Graph nodes" value={summary?.graph.nodes.length ?? 0}/>
      <Metric label="Insights" value={lens?.insights.length ?? 0}/>
      <Metric label="Snapshots" value={snapshotRows.length}/>
    </div>

    <div className="mt-3 flex gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded border border-border/60 bg-black/20 px-2"><Search className="h-3 w-3 text-muted-foreground"/><input value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter")void search()}} placeholder="Search across permitted Project chats, resources, Artifacts, evidence and ledger…" className="min-w-0 flex-1 bg-transparent py-2 font-ui text-[8px] outline-none"/></div>
      <button onClick={() => void search()} disabled={busy||!query.trim()} className="rounded border border-amber-300/25 px-3 font-ui text-[7px] text-amber-200 disabled:opacity-40">Search</button>
    </div>

    {error&&<div className="mt-2 rounded border border-red-300/20 px-2 py-1.5 font-ui text-[7px] text-red-200">{error}</div>}
    {!!hits.length&&<div className="mt-3 space-y-1.5">{hits.slice(0,8).map((hit)=><div key={hit.documentId} className="rounded border border-border/45 p-2.5"><div className="flex gap-2"><span className="font-terminal text-[6px] text-cyan-300">{hit.sourceType.toUpperCase()}</span><span className="truncate font-ui text-[8px] font-medium">{hit.title}</span><span className="ml-auto font-terminal text-[6px] text-muted-foreground">{hit.combinedScore.toFixed(2)}</span></div><div className="mt-1 line-clamp-2 font-ui text-[7px] leading-4 text-muted-foreground">{hit.excerpt}</div></div>)}</div>}

    <details className="mt-4 rounded-lg border border-border/50 p-3" open>
      <summary className="cursor-pointer font-ui text-[8px] font-semibold">Intelligence Timeline · evidence-linked Project history</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-[180px_1fr]">
        <select value={timelineType} onChange={(e)=>setTimelineType(e.target.value)} className="rounded border border-border/50 bg-[#090909] px-2 py-1.5 font-terminal text-[6px]">
          <option value="all">All event types</option>
          {["chat","resource","artifact","ledger","filing","research","decision","thesis","document"].map((type)=><option key={type} value={type}>{type}</option>)}
        </select>
        <input value={timelineRef} onChange={(e)=>setTimelineRef(e.target.value)} placeholder="Filter source / entity / model / Artifact / decision ref" className="rounded border border-border/50 bg-black/20 px-2 py-1.5 font-terminal text-[7px] outline-none"/>
      </div>
      <div className="mt-2 space-y-1.5">{timelineRows.slice(0,8).map((event)=><div key={event.id} className="rounded border border-border/40 px-2 py-1.5">
        <div className="flex gap-2"><span className="font-terminal text-[6px] text-cyan-300">{event.type.toUpperCase()}</span><span className="truncate font-ui text-[7px]">{event.title}</span><span className="ml-auto font-terminal text-[6px] text-muted-foreground">{new Date(event.at).toLocaleString()}</span></div>
        <div className="mt-1 font-terminal text-[5px] text-muted-foreground">{event.artifactRefs.length} ARTIFACT · {event.modelRefs.length} MODEL · {event.sourceRefs.length} SOURCE REF{event.sourceRefs.length===1?"":"S"}{event.decisionRef?" · DECISION LINKED":""}</div>
      </div>)}{!timelineRows.length&&<div className="font-ui text-[7px] text-muted-foreground">No timeline event matches these explicit filters.</div>}</div>
    </details>

    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <div className="rounded-lg border border-border/50 p-3">
        <div className="flex items-center gap-2"><Sparkles className="h-3 w-3 text-amber-300"/><span className="font-ui text-[8px] font-semibold">Insight Lens</span></div>
        <div className="mt-2 space-y-1.5">{topInsights.length?topInsights.map((item)=><div key={item.id} className="rounded border border-border/40 px-2 py-1.5"><div className="flex gap-2"><span className={`font-terminal text-[6px] ${item.severity==="material"?"text-red-300":item.severity==="watch"?"text-amber-200":"text-muted-foreground"}`}>{item.kind.toUpperCase()}</span><span className="font-ui text-[7px]">{item.title}</span></div></div>):<div className="font-ui text-[7px] text-muted-foreground">No deterministic changes, contradictions, stale evidence, risks, catalysts or open questions surfaced yet.</div>}</div>
      </div>
      <div className="rounded-lg border border-border/50 p-3">
        <div className="flex items-center gap-2"><GitCompareArrows className="h-3 w-3 text-fuchsia-300"/><span className="font-ui text-[8px] font-semibold">Time Machine · As Known On</span></div>
        <div className="mt-2 flex gap-1.5"><input type="datetime-local" value={asKnownAt} onChange={(e)=>setAsKnownAt(e.target.value)} className="min-w-0 flex-1 rounded border border-border/50 bg-black/20 px-2 py-1.5 font-terminal text-[6px]"/><button disabled={!asKnownAt||busy} onClick={()=>void loadAsKnownOn()} className="rounded border border-fuchsia-300/20 px-2 font-ui text-[7px] text-fuchsia-200 disabled:opacity-40">Load</button></div>
        <div className="mt-2 space-y-1.5">{snapshotRows.slice(0,5).map((snapshot)=><button key={snapshot.id} onClick={()=>void loadSnapshot(snapshot.id)} className="flex w-full items-center justify-between rounded border border-border/40 px-2 py-1.5 text-left hover:bg-white/[0.025]"><span className="font-terminal text-[6px] text-muted-foreground">{new Date(snapshot.generatedAt).toLocaleString()}</span><span className="font-terminal text-[6px] text-muted-foreground">{snapshot.manifest.length} SOURCES · {snapshot.contentHash.slice(0,8)}</span></button>)}{!snapshotRows.length&&<div className="font-ui text-[7px] text-muted-foreground">Refresh the index to create the first immutable Project snapshot.</div>}</div>
        {historical&&<div className="mt-2 rounded border border-fuchsia-300/15 bg-fuchsia-300/[0.02] p-2"><div className="font-terminal text-[6px] text-fuchsia-200">AS KNOWN {new Date(historical.snapshot.generatedAt).toLocaleString()} · {historical.documents.length} RETAINED SOURCES</div><div className="mt-1 space-y-1">{historical.documents.slice(0,5).map((doc)=><div key={doc.id+"-"+doc.contentHash} className="truncate font-ui text-[7px] text-muted-foreground">{doc.sourceType} · {doc.title}</div>)}</div></div>}
      </div>
    </div>
  </section>;
}

function Metric({label,value}:{label:string;value:number}) {
  return <div className="rounded border border-border/45 p-2"><div className="font-terminal text-[6px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 font-ui text-[13px] font-semibold">{value.toLocaleString()}</div></div>;
}
