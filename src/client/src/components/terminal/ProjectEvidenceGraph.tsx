import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Focus, Minus, Move, Plus } from "lucide-react";
import type { P7ContextGraph, P7Insight } from "@shared/p7ResearchContracts";
import { projectEvidenceGraphProjection } from "@/lib/projectEvidenceGraphPresentation";

const WIDTH = 900;
const HEIGHT = 540;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.9;
const clamp = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

/** Non-editable viewport: no ReactFlow graph database or tool execution owner.
 * Buttons/list are real keyboard targets; drawing lines never implies causality. */
export function ProjectEvidenceGraph({ projectId, graph, insight }: {
  projectId: number;
  graph: P7ContextGraph | null | undefined;
  insight: P7Insight | null | undefined;
}) {
  const result = useMemo(() => projectEvidenceGraphProjection(projectId, graph, insight), [projectId, graph, insight]);
  const [chosenNode, setChosenNode] = useState<string | null>(null);
  const [chosenEdge, setChosenEdge] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.65);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const hostRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ pointer: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const node = result.nodes.find(item => item.id === chosenNode) ?? null;
  const edge = result.edges.find(item => item.id === chosenEdge) ?? null;

  const fit = () => {
    const width = hostRef.current?.clientWidth ?? 700;
    const height = hostRef.current?.clientHeight ?? 420;
    const next = clamp(Math.min(1, (width - 24) / WIDTH, (height - 24) / HEIGHT));
    setZoom(next);
    setOffset({ x: Math.max(0, (width - WIDTH * next) / 2), y: Math.max(0, (height - HEIGHT * next) / 2) });
  };
  useEffect(() => {
    fit();
    const update = () => fit();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [projectId, insight?.id, graph?.contentHash]);

  const selectNode = (id: string) => { setChosenNode(id); setChosenEdge(null); };
  const selectEdge = (id: string) => { setChosenEdge(id); setChosenNode(null); };

  if (!result.nodes.length) return <p role="status" className="rounded-lg border border-dashed border-border/60 p-3 font-ui text-sm text-muted-foreground">
    No recorded graph nodes connect to this selected insight. No relationships have been inferred.
  </p>;

  return <div data-testid="project-evidence-graph" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p role="status" className="font-ui text-xs leading-5 text-muted-foreground">
        {result.nodes.length} Project nodes · {result.edges.length} recorded links
        {result.omittedNodes + result.omittedEdges > 0 ? ` · ${result.omittedNodes} nodes, ${result.omittedEdges} links outside view` : ""}
      </p>
      <div role="group" aria-label="Graph viewport controls" className="flex flex-wrap gap-1.5">
        <button type="button" aria-label="Zoom graph out" title="Zoom out" onClick={() => setZoom(value => clamp(value - 0.15))}
          className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-border/60 focus-visible:ring-2 focus-visible:ring-amber-300/70"><Minus className="h-4 w-4" aria-hidden="true"/></button>
        <button type="button" aria-label="Zoom graph in" title="Zoom in" onClick={() => setZoom(value => clamp(value + 0.15))}
          className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-border/60 focus-visible:ring-2 focus-visible:ring-amber-300/70"><Plus className="h-4 w-4" aria-hidden="true"/></button>
        <button type="button" aria-label="Fit graph to viewport" onClick={fit}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border/60 px-3 font-ui text-xs focus-visible:ring-2 focus-visible:ring-amber-300/70"><Focus className="h-4 w-4" aria-hidden="true"/>Fit</button>
      </div>
    </div>
    <div ref={hostRef} role="region" aria-label="Interactive recorded Project graph. Drag empty space to pan, use zoom buttons, Tab between nodes."
      tabIndex={0} data-testid="project-evidence-graph-viewport"
      className="relative h-[320px] min-w-0 touch-none overflow-hidden rounded-lg border border-border/55 bg-background/80 outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 sm:h-[440px]"
      onWheel={event => {
        // A focused graph may zoom; normal page scrolling remains available otherwise.
        if (document.activeElement !== event.currentTarget &&
            !event.currentTarget.contains(document.activeElement)) return;
        if (event.cancelable) event.preventDefault();
        setZoom(value => clamp(value + (event.deltaY < 0 ? 0.09 : -0.09)));
      }}
      onPointerDown={event => {
        if (event.button !== 0 || event.target !== event.currentTarget) return;
        dragging.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: offset.x, startY: offset.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const drag = dragging.current;
        if (drag?.pointer !== event.pointerId) return;
        setOffset({ x: drag.startX + event.clientX - drag.x, y: drag.startY + event.clientY - drag.y });
      }}
      onPointerUp={event => {
        if (dragging.current?.pointer === event.pointerId) dragging.current = null;
      }}
      onPointerCancel={() => { dragging.current = null; }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const dx = event.key === "ArrowLeft" ? -40 : event.key === "ArrowRight" ? 40 : 0;
        const dy = event.key === "ArrowUp" ? -40 : event.key === "ArrowDown" ? 40 : 0;
        if (dx || dy) { event.preventDefault(); setOffset(point => ({ x: point.x + dx, y: point.y + dy })); }
        if (event.key === "Home") { event.preventDefault(); fit(); }
      }}>
      <div className="pointer-events-none absolute inset-0 opacity-20" aria-hidden="true"
        style={{ backgroundImage: "linear-gradient(to right,currentColor 1px,transparent 1px),linear-gradient(to bottom,currentColor 1px,transparent 1px)", backgroundSize: "38px 38px" }}/>
      <div className="absolute left-0 top-0" style={{
        width: WIDTH, height: HEIGHT, transform: `translate(${offset.x}px,${offset.y}px) scale(${zoom})`,
        transformOrigin: "top left",
      }}>
        <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="pointer-events-none absolute inset-0" aria-hidden="true">
          <defs><marker id="lios-evidence-arrow" markerWidth="8" markerHeight="8" refX="8" refY="3" orient="auto">
            <path d="M0 0 L8 3 L0 6" fill="none" stroke="currentColor" strokeOpacity=".65"/>
          </marker></defs>
          {result.edges.map(item => <line key={item.id}
            x1={item.fromX} y1={item.fromY} x2={item.toX} y2={item.toY}
            stroke="currentColor" strokeOpacity={item.evidenceRefs.length ? ".53" : ".25"}
            strokeDasharray={item.evidenceRefs.length ? undefined : "5 5"}
            strokeWidth="1.6" markerEnd="url(#lios-evidence-arrow)"/>)}
        </svg>
        {result.nodes.map(item => <button key={item.id} type="button"
          data-testid="p7-recorded-graph-node" aria-pressed={chosenNode === item.id}
          title={item.label} onClick={() => selectNode(item.id)}
          className={`absolute flex h-[68px] w-[156px] flex-col justify-center overflow-hidden rounded-lg border bg-zinc-950/95 px-2 text-left font-ui shadow-sm outline-none focus-visible:ring-4 focus-visible:ring-amber-300/70 ${chosenNode === item.id
            ? "border-amber-300 text-foreground" : item.directlyMatched ? "border-amber-300/55 text-foreground" : "border-border/70 text-muted-foreground"}`}
          style={{ left: item.x - 78, top: item.y - 34 }}>
          <span className="block truncate text-[10px] capitalize text-amber-200">{item.kind.replaceAll("_", " ")}</span>
          <span className="block line-clamp-2 text-xs font-semibold">{item.label}</span>
        </button>)}
      </div>
      <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-md border border-border/45 bg-background/90 px-2 py-1 font-ui text-[11px] text-muted-foreground" aria-hidden="true">
        <Move className="h-3 w-3"/>Pan · {Math.round(zoom * 100)}%
      </div>
    </div>
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">
      <section aria-label="Selected graph object evidence" className="min-w-0 rounded-lg border border-border/55 p-3 font-ui text-sm">
        <h5 className="font-semibold text-foreground">{node ? "Selected recorded node" : edge ? "Selected recorded link" : "Inspect evidence"}</h5>
        {node ? <div className="mt-2 space-y-2 text-muted-foreground">
          <p className="break-words font-medium text-foreground">{node.label}</p>
          <p>Type: {node.kind.replaceAll("_", " ")}</p>
          <p>{node.directlyMatched ? "Directly referenced by this insight" : "Recorded neighboring object"}</p>
          {node.sourceRef ? <p className="break-all">Source ID: <code>{node.sourceRef}</code></p> : <p>No source ID attached to this node.</p>}
          {node.occurredAt && <p>Recorded time: <time dateTime={node.occurredAt}>{new Date(node.occurredAt).toLocaleString()}</time></p>}
        </div> : edge ? <div className="mt-2 space-y-2 text-muted-foreground">
          <p className="break-words font-medium text-foreground">{result.nodes.find(item => item.id === edge.from)?.label} → {edge.type.replaceAll("_", " ")} → {result.nodes.find(item => item.id === edge.to)?.label}</p>
          {edge.evidenceRefs.length ? <ul className="list-disc space-y-1 pl-4">
            {edge.evidenceRefs.map((ref, index) => <li key={index} className="break-all"><code>{ref}</code></li>)}
          </ul> : <p>No edge-level source IDs recorded. Adjacency is not verification.</p>}
        </div> : <p className="mt-2 text-muted-foreground">Select a node or an edge from the lists. Source IDs are references, not public URLs or proof of causality.</p>}
      </section>
      <section aria-label="Recorded relationship list" className="min-w-0 space-y-2 rounded-lg border border-border/55 p-3">
        <h5 className="font-ui text-sm font-semibold text-foreground">Recorded relationships ({result.edges.length})</h5>
        {result.edges.length ? <ul className="max-h-48 space-y-1 overflow-y-auto">
          {result.edges.map(item => <li key={item.id}>
            <button type="button" aria-pressed={chosenEdge === item.id} onClick={() => selectEdge(item.id)}
              className="min-h-10 w-full break-words rounded-md border border-border/50 px-2 py-2 text-left font-ui text-xs text-foreground hover:border-amber-300/40 focus-visible:ring-2 focus-visible:ring-amber-300/70">
              {result.nodes.find(node => node.id === item.from)?.label} · {item.type.replaceAll("_", " ")} · {result.nodes.find(node => node.id === item.to)?.label}
              <span className="block text-muted-foreground">{item.evidenceRefs.length} edge source ID(s)</span>
            </button>
          </li>)}
        </ul> : <p className="font-ui text-xs text-muted-foreground">No recorded relation joins these exact sources.</p>}
      </section>
    </div>
    <p className="font-ui text-xs leading-5 text-muted-foreground">Read-only Project P7 evidence. Links show stored adjacency, never an inferred cause, exposure, or action. The visualization does not write to the graph or call external services.</p>
  </div>;
}
