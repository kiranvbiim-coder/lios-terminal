import { useMemo, useState } from "react";
import { Compass, GitBranch, MapPinned, MessageSquareText, Network } from "lucide-react";
import type { P7ContextGraph, P7InsightLens } from "@shared/p7ResearchContracts";
import {
  consequenceTrailChatPrompt,
  investigationViewIntentSchema,
  recordedConsequenceTrail,
  recordedGeographicPoints,
  type InvestigationViewIntent,
} from "@/lib/phase3InvestigationPresentation";

/**
 * A Project-specific investigation lens over existing P7 evidence.
 * No new provider request, route, source storage or agent executor is created.
 */
export function ProjectInvestigationDesk({ projectId, graph, lens, onInvestigate }: {
  projectId: number;
  graph: P7ContextGraph | null | undefined;
  lens: P7InsightLens | null | undefined;
  onInvestigate?: (prompt: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [view, setView] = useState<InvestigationViewIntent["kind"]>("evidence");
  const [showAllSources, setShowAllSources] = useState(false);
  const validGraph = graph?.projectId === projectId ? graph : null;
  const validLens = lens?.projectId === projectId ? lens : null;
  const selected = (validLens?.insights ?? []).find(item => item.id === selectedId)
    ?? validLens?.insights[0] ?? null;

  const trail = useMemo(() => recordedConsequenceTrail(projectId, validGraph, selected), [projectId, validGraph, selected]);
  const geographic = useMemo(() => recordedGeographicPoints(projectId, validGraph), [projectId, validGraph]);
  const localGeographic = useMemo(() => {
    const implicated = new Set([
      ...trail.matchedNodes.map(node => node.id),
      ...trail.links.flatMap(link => [link.from.id, link.to.id]),
    ]);
    return geographic.filter(point => implicated.has(point.id));
  }, [geographic, trail]);
  const displayedSources = showAllSources ? trail.sourceRefs.slice(0, 60) : trail.sourceRefs.slice(0, 6);

  if (!validGraph || !validLens) return (
    <section data-testid="project-investigation-desk" aria-label="Project investigation" className="rounded-xl border border-border/60 p-4">
      <p role="status" className="font-ui text-sm text-muted-foreground">Investigation evidence is not available for this Project. No relationships or map locations have been inferred.</p>
    </section>
  );

  return <section data-testid="project-investigation-desk" aria-label="Project investigation" className="mt-4 space-y-4 rounded-xl border border-border/60 bg-white/[0.015] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="inline-flex items-center gap-2 font-ui text-base font-semibold text-foreground">
        <Compass aria-hidden="true" className="h-4 w-4 text-amber-200"/>Investigate
      </h3>
      <span className="font-ui text-xs text-muted-foreground">{validLens.insights.length} recorded insights</span>
    </div>
    {validLens.insights.length === 0 ? <p className="font-ui text-sm text-muted-foreground">
      No recorded insights are available. Refresh the existing Project Intelligence index before investigating.
    </p> : <>
      <label className="block space-y-1.5 font-ui text-sm">
        <span className="text-muted-foreground">Recorded Project insight</span>
        <select aria-label="Choose an insight to investigate" value={selected?.id ?? ""} onChange={event => { setSelectedId(event.target.value); setShowAllSources(false); }}
          className="min-h-11 w-full min-w-0 rounded-lg border border-border/65 bg-background px-3 py-2 text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">
          {validLens.insights.slice(0, 100).map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
        </select>
      </label>
      {selected && <>
        <div className="space-y-1">
          <p className="font-ui text-sm font-semibold text-foreground">{selected.title}</p>
          <p className="font-ui text-sm leading-6 text-muted-foreground">{selected.summary}</p>
          <p className="font-ui text-xs text-muted-foreground">{selected.kind.replaceAll("_", " ")} · {selected.severity} · {selected.occurredAt ? new Date(selected.occurredAt).toLocaleDateString() : "No recorded event date"}</p>
        </div>
        <div role="group" aria-label="Investigation perspectives" className="flex flex-wrap gap-2">
          {(["evidence", "relationships", "geography"] as const).map(kind => {
            // All UI states must be schema-valid; no arbitrary JSX-like renderer intent.
            const intent = investigationViewIntentSchema.parse({ projectId, insightId: selected.id, kind });
            return <button key={kind} type="button" aria-pressed={view === intent.kind}
              onClick={() => setView(intent.kind)}
              className={`min-h-10 rounded-lg border px-3 py-2 font-ui text-sm capitalize focus-visible:ring-2 focus-visible:ring-amber-300/70 ${view === kind ? "border-amber-300/45 bg-amber-300/[0.07] text-foreground" : "border-border/60 text-muted-foreground"}`}>{kind}</button>;
          })}
        </div>
        {view === "evidence" && <section aria-label="Recorded insight evidence" className="rounded-lg border border-border/50 p-3">
          <p className="font-ui text-sm text-foreground">{trail.sourceRefs.length} source identifier{trail.sourceRefs.length === 1 ? "" : "s"} recorded for this insight</p>
          <p className="mt-1 font-ui text-xs text-muted-foreground">Source IDs are evidence references, not verified public URLs.</p>
          {displayedSources.length ? <ul className="mt-2 space-y-1.5">{displayedSources.map((ref, index) => <li key={index} className="break-all rounded-md border border-border/40 p-2 font-mono text-xs text-muted-foreground">{ref}</li>)}</ul>
            : <p className="mt-3 text-sm text-amber-200">No explicit evidence references attached. Verification is required before relying on this insight.</p>}
          {trail.sourceRefs.length > displayedSources.length && <button type="button" onClick={() => setShowAllSources(true)} className="mt-3 min-h-10 rounded border border-border/60 px-3 py-2 text-sm">Inspect more source identifiers ({Math.min(60, trail.sourceRefs.length) - displayedSources.length})</button>}
          {trail.sourceRefs.length > 60 && <p className="mt-1 text-xs text-muted-foreground">Showing at most 60 of {trail.sourceRefs.length} identifiers in this bounded view.</p>}
        </section>}
        {view === "relationships" && <section aria-label="Recorded graph relationships" className="space-y-2 rounded-lg border border-border/50 p-3">
          <h4 className="inline-flex items-center gap-2 font-ui text-sm font-semibold text-foreground"><Network aria-hidden="true" className="h-4 w-4"/>Linked Project objects</h4>
          <p className="font-ui text-xs text-muted-foreground">{trail.matchedNodes.length} directly identified graph object{trail.matchedNodes.length === 1 ? "" : "s"} · {trail.totalLinks} stored adjacency link{trail.totalLinks === 1 ? "" : "s"}. Adjacency does not prove consequence or exposure.</p>
          {trail.links.length ? <ul className="space-y-2">{trail.links.map(link => <li key={link.id} className="rounded-lg border border-border/50 px-3 py-2">
            <p className="break-words font-ui text-sm font-medium text-foreground">{link.from.label} <span className="text-amber-200">→ {link.relation.replaceAll("_", " ")} →</span> {link.to.label}</p>
            <p className="mt-1 font-ui text-xs text-muted-foreground">{link.evidenceRefs.length} explicit edge evidence reference{link.evidenceRefs.length === 1 ? "" : "s"}</p>
          </li>)}</ul> : <p className="font-ui text-sm text-muted-foreground">No graph link joins these exact source/entity identifiers. Impact cannot be inferred.</p>}
          {trail.omittedLinks > 0 && <p className="text-xs text-muted-foreground">{trail.omittedLinks} additional recorded graph links are outside the bounded view.</p>}
        </section>}
        {view === "geography" && <section aria-label="Verified geographic coordinates" className="space-y-2 rounded-lg border border-border/50 p-3">
          <h4 className="inline-flex items-center gap-2 font-ui text-sm font-semibold text-foreground"><MapPinned aria-hidden="true" className="h-4 w-4"/>Geographic evidence</h4>
          <p className="font-ui text-xs leading-5 text-muted-foreground">Only current Project geography nodes with explicit numeric latitude/longitude are plotted. This coordinate diagram does not claim source map tiles, country boundaries or place-name geocoding.</p>
          <GeographicEvidenceDiagram points={localGeographic.length ? localGeographic : []} />
          {localGeographic.length === 0 && <p className="font-ui text-sm text-muted-foreground">{geographic.length > 0 ? `${geographic.length} Project locations have coordinates, but none are directly linked to the chosen insight.` : "No verified coordinate-bearing geography nodes are recorded in this Project."}</p>}
        </section>}
        <div className="flex flex-wrap gap-2 border-t border-border/55 pt-3">
          {onInvestigate && <button type="button" onClick={() => onInvestigate(consequenceTrailChatPrompt(selected, projectId))}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300/35 bg-amber-300/[0.08] px-3 py-2 font-ui text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70"><MessageSquareText aria-hidden="true" className="h-4 w-4"/>Investigate in Chat</button>}
          <span className="inline-flex items-center gap-1.5 font-ui text-xs text-muted-foreground"><GitBranch aria-hidden="true" className="h-3.5 w-3.5"/>Actions require existing Chat permissions and explicit review.</span>
        </div>
      </>}
    </>}
  </section>;
}

function GeographicEvidenceDiagram({ points }: { points: ReturnType<typeof recordedGeographicPoints> }) {
  if (!points.length) return null;
  return <div className="w-full overflow-x-auto" role="img" aria-label={`Coordinate diagram showing ${points.length} recorded Project locations`}>
    <svg viewBox="0 0 720 350" className="h-auto min-w-[320px] w-full rounded-lg border border-border/55 bg-background/80" aria-hidden="true">
      {[0,90,180,270,360,450,540,630,720].map(x=><line key={"lon"+x} x1={x} x2={x} y1="0" y2="350" stroke="currentColor" strokeOpacity="0.13" strokeWidth=".6"/>)}
      {[0,87.5,175,262.5,350].map(y=><line key={"lat"+y} x1="0" x2="720" y1={y} y2={y} stroke="currentColor" strokeOpacity="0.13" strokeWidth=".6"/>)}
      <line x1="360" x2="360" y1="0" y2="350" stroke="currentColor" strokeOpacity=".35" strokeDasharray="5 5"/>
      <line x1="0" x2="720" y1="175" y2="175" stroke="currentColor" strokeOpacity=".35" strokeDasharray="5 5"/>
      {points.slice(0, 60).map(point => <g key={point.id}>
        <circle cx={(point.longitude+180)*2} cy={(90-point.latitude)*350/180} r="5.5" fill="rgb(251,191,36)" fillOpacity=".85" stroke="currentColor" strokeWidth="1.5"/>
      </g>)}
    </svg>
    <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
      {points.slice(0, 12).map(point => <li key={point.id} className="break-words font-ui text-xs text-muted-foreground"><span className="font-medium text-foreground">{point.label}</span> · {point.latitude.toFixed(4)}, {point.longitude.toFixed(4)}{point.sourceRef ? ` · ${point.sourceRef}` : ""}</li>)}
    </ul>
    {points.length > 12 && <p className="mt-1 text-xs text-muted-foreground">Showing 12 of {points.length} labels. The coordinate diagram shows at most 60 points.</p>}
  </div>;
}
