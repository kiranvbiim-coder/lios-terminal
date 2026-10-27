import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Focus, Minus, Move, Network, Plus, Search, X } from "lucide-react";
import { buildCrossDomainGraph, crossDomainBridges, type CrossDomainNodeDomain, type CrossDomainEdge } from "@/lib/terminalCrossDomainGraph";
import { graphNodeConnections, presentCrossDomainGraph } from "@/lib/graphExplorerPresentation";
import { GraphExplorerCompactList } from "./GraphExplorerCompactList";
import { loadIntelligenceObjects, subscribeIntelligenceObjects, type IntelligenceObject } from "@/lib/terminalIntelligenceObjects";
import { actionsForIntelligenceObject, requestIntelligenceObjectAction } from "@/lib/terminalObjectActions";

interface Props { activeSymbol?: string; onClose: () => void }

const DOMAIN_ORDER: CrossDomainNodeDomain[] = ["finance", "market", "macro", "policy", "supply-chain", "sustainability", "portfolio", "research"];
const DOMAIN_LABEL: Record<CrossDomainNodeDomain, string> = {
  finance: "Finance", market: "Market", macro: "Macro", policy: "Policy",
  "supply-chain": "Supply chain", sustainability: "Sustainability",
  portfolio: "Portfolio", research: "Research",
};
const DOMAIN_COLOR: Record<CrossDomainNodeDomain, string> = {
  finance: "border-amber-300/45", market: "border-blue-300/45",
  macro: "border-cyan-300/45", policy: "border-purple-300/45",
  "supply-chain": "border-emerald-300/45", sustainability: "border-teal-300/45",
  portfolio: "border-orange-300/45", research: "border-fuchsia-300/45",
};

/** Deterministic read-only layout, not an inferred semantic relationship. */
function nodePosition(domain: CrossDomainNodeDomain, index: number): { x: number; y: number } {
  const axis = (DOMAIN_ORDER.indexOf(domain) / DOMAIN_ORDER.length) * Math.PI * 2 - Math.PI / 2;
  const lane = (index % 3) - 1;
  const ring = Math.floor(index / 3);
  const radius = Math.min(44, 24 + ring * 9);
  const angle = axis + lane * 0.17;
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
}

export default function GraphExplorer({ activeSymbol, onClose }: Props) {
  const [objects, setObjects] = useState<IntelligenceObject[]>(() => loadIntelligenceObjects());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [symbolOnly, setSymbolOnly] = useState(Boolean(activeSymbol));
  const [bridgesOnly, setBridgesOnly] = useState(false);
  const [relation, setRelation] = useState<CrossDomainEdge["relation"] | "">("");
  const [neighborsOnly, setNeighborsOnly] = useState(false);
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{pointer: number; clientX: number; clientY: number; originX: number; originY: number} | null>(null);
  const [zoom, setZoom] = useState(0.7);
  const [pan, setPan] = useState({x: 0, y: 0});
  const zoomClamp = (value: number) => Math.min(1.8, Math.max(0.35, value));
  const fit = () => {
    const width = viewportRef.current?.clientWidth ?? 700;
    const height = viewportRef.current?.clientHeight ?? 440;
    const size = zoomClamp(Math.min(1, (width - 24) / 900, (height - 24) / 600));
    setZoom(size);
    setPan({x: Math.max(0, (width - 900 * size) / 2), y: Math.max(0, (height - 600 * size) / 2)});
  };
  useEffect(() => {
    fit();
    const resized = () => fit();
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  // Keep the Escape handler current without re-running the modal focus trap on parent renders.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => subscribeIntelligenceObjects(setObjects), []);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchRef.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),a[href],select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      )).filter(element => element.getClientRects().length > 0);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!dialogRef.current.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previouslyFocused?.focus();
    };
  }, []);

  // The existing local Intelligence Object store is the sole graph authority.
  // 120 is a bounded source read, not a claim that all retained objects are shown.
  const contextualObjects = useMemo(() =>
    symbolOnly && activeSymbol
      ? objects.filter(object => !object.symbol || object.symbol === activeSymbol)
      : objects, [activeSymbol, objects, symbolOnly]);
  const graphObjects = useMemo(() => contextualObjects.slice(0, 120), [contextualObjects]);
  const graph = useMemo(() => buildCrossDomainGraph(graphObjects), [graphObjects]);
  const bridges = useMemo(() => crossDomainBridges(graph), [graph]);
  const relations = useMemo(() => Array.from(new Set(graph.edges.map(edge => edge.relation))).sort(), [graph]);
  const presentation = useMemo(() => presentCrossDomainGraph(graph, {
    query, selectedId, neighborsOnly, bridgesOnly, relation: relation || undefined, maxNodes: 48,
  }), [graph, query, selectedId, neighborsOnly, bridgesOnly, relation]);
  const selected = graphObjects.find(object => object.id === selectedId) ?? null;
  const selectedVisible = presentation.nodes.some(node => node.objectId === selectedId);
  const selectedConnections = useMemo(() => selected ? graphNodeConnections(graph, selected.id).filter(link => !relation || link.relation === relation) : [], [graph, selected, relation]);
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const domain of DOMAIN_ORDER) {
      presentation.nodes.filter(node => node.domain === domain).forEach((node, index) => map.set(node.objectId, nodePosition(domain, index)));
    }
    return map;
  }, [presentation.nodes]);

  const selectAndFocus = (id: string) => {
    setSelectedId(id);
    setNeighborsOnly(true);
    setQuery("");
  };

  return (
    <div className="fixed inset-0 z-[92] bg-black/80 p-2 backdrop-blur-[5px] sm:p-3" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="LiOS Cross-Domain Intelligence Graph Explorer"
        className="lios-v4-overlay mx-auto flex h-[min(900px,calc(100vh-16px))] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-border/65 sm:h-[min(900px,calc(100vh-24px))]"
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="shrink-0 space-y-3 border-b border-border/70 p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber-300/30 bg-amber-300/[0.06]"><Network className="h-5 w-5 text-amber-200" aria-hidden="true" /></div>
            <div className="min-w-0 flex-1">
              <h2 className="font-ui text-base font-semibold text-foreground sm:text-lg">Intelligence Graph</h2>
              <p className="mt-0.5 font-ui text-xs text-muted-foreground">Explore recorded connections across the terminal’s domains.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close Intelligence Graph"
              className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-border/60 text-muted-foreground hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-10 min-w-[190px] flex-1 items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Search graph objects</span>
              <input ref={searchRef} type="search" value={query} onChange={event => setQuery(event.target.value)}
                placeholder="Search objects, symbols or domains"
                className="min-w-0 flex-1 bg-transparent py-2 font-ui text-sm text-foreground outline-none placeholder:text-muted-foreground" />
            </label>
            {activeSymbol && <button type="button" aria-pressed={symbolOnly} onClick={() => { setSymbolOnly(value => !value); setSelectedId(null); setNeighborsOnly(false); }}
              className={`min-h-10 rounded-lg border px-3 font-ui text-xs ${symbolOnly ? "border-amber-300/45 bg-amber-300/[0.07] text-amber-200" : "border-border/70 text-muted-foreground hover:text-foreground"}`}>
              {activeSymbol} + global
            </button>}
            <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border/70 px-3 font-ui text-xs text-muted-foreground">
              <span>Link type</span>
              <select aria-label="Filter recorded relationship type" value={relation}
                onChange={event => { setRelation(event.target.value as CrossDomainEdge["relation"] | ""); setSelectedId(null); setNeighborsOnly(false); }}
                className="max-w-36 bg-background text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                <option value="">All recorded</option>
                {relations.map(item => <option key={item} value={item}>{item.replaceAll("-", " ")}</option>)}
              </select>
            </label>
            <button type="button" aria-pressed={bridgesOnly} onClick={() => setBridgesOnly(value => !value)}
              className={`min-h-10 rounded-lg border px-3 font-ui text-xs ${bridgesOnly ? "border-cyan-300/45 bg-cyan-300/[0.06] text-cyan-200" : "border-border/70 text-muted-foreground hover:text-foreground"}`}>
              Domain bridges ({bridges.length})
            </button>
            <button type="button" aria-pressed={neighborsOnly} disabled={!selected} onClick={() => setNeighborsOnly(value => !value)}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 font-ui text-xs disabled:cursor-not-allowed disabled:opacity-35 ${neighborsOnly ? "border-amber-300/45 bg-amber-300/[0.07] text-amber-200" : "border-border/70 text-muted-foreground hover:text-foreground"}`}>
              <Focus className="h-3.5 w-3.5" aria-hidden="true"/> Direct links
            </button>
            {(query || selectedId || neighborsOnly || bridgesOnly || relation) && <button type="button" onClick={() => { setQuery(""); setSelectedId(null); setNeighborsOnly(false); setBridgesOnly(false); setRelation(""); }}
              className="min-h-10 rounded-lg border border-border/70 px-3 font-ui text-xs text-muted-foreground hover:text-foreground">Reset view</button>}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Cross-domain graph viewport controls">
            <button type="button" aria-label="Zoom cross-domain graph out" onClick={() => setZoom(current => zoomClamp(current - 0.15))}
              className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-border/60 focus-visible:ring-2 focus-visible:ring-amber-300/70"><Minus className="h-4 w-4" aria-hidden="true"/></button>
            <button type="button" aria-label="Zoom cross-domain graph in" onClick={() => setZoom(current => zoomClamp(current + 0.15))}
              className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-border/60 focus-visible:ring-2 focus-visible:ring-amber-300/70"><Plus className="h-4 w-4" aria-hidden="true"/></button>
            <button type="button" aria-label="Fit cross-domain graph" onClick={fit}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border/60 px-3 font-ui text-xs focus-visible:ring-2 focus-visible:ring-amber-300/70"><Focus className="h-4 w-4" aria-hidden="true"/>Fit graph</button>
            <span className="font-ui text-xs text-muted-foreground" role="status">{Math.round(zoom * 100)}%</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-ui text-xs text-muted-foreground" role="status">
            <span>{presentation.nodes.length} shown · {graph.nodes.length} objects loaded</span>
            <span>{presentation.edges.length} recorded links shown{relation ? ` · ${relation.replaceAll("-", " ")} only` : ""}</span>
            {query && <span>{presentation.matchingCount} direct search matches</span>}
            {presentation.omittedCount > 0 && <span>{presentation.omittedCount} not drawn — refine search</span>}
            {contextualObjects.length > graphObjects.length && <span>Only the 120 most recent objects loaded — additional records not shown</span>}
          </div>
        </header>
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(280px,1fr)_minmax(180px,0.6fr)] lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1">
          <main ref={viewportRef} role="region" tabIndex={0}
            className="relative min-h-0 touch-pan-y overflow-y-auto bg-[radial-gradient(circle_at_center,rgba(245,160,0,.045),transparent_43%),#050505] outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 md:touch-none md:overflow-hidden"
            aria-label="Intelligence graph canvas. Drag empty space to pan, use zoom and fit controls, Tab to inspect objects."
            onWheel={event => {
              if (document.activeElement !== event.currentTarget && !event.currentTarget.contains(document.activeElement)) return;
              if (event.cancelable) event.preventDefault();
              setZoom(value => zoomClamp(value + (event.deltaY < 0 ? 0.09 : -0.09)));
            }}
            onPointerDown={event => {
              if (event.button !== 0 || event.target !== event.currentTarget) return;
              dragRef.current = {pointer:event.pointerId,clientX:event.clientX,clientY:event.clientY,originX:pan.x,originY:pan.y};
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              const drag = dragRef.current;
              if (drag?.pointer !== event.pointerId) return;
              setPan({x:drag.originX + event.clientX - drag.clientX,y:drag.originY + event.clientY - drag.clientY});
            }}
            onPointerUp={event => {if(dragRef.current?.pointer===event.pointerId) dragRef.current=null;}}
            onPointerCancel={() => {dragRef.current=null;}}
            onKeyDown={event => {
              if(event.target!==event.currentTarget) return;
              const dx=event.key==="ArrowLeft"?-40:event.key==="ArrowRight"?40:0;
              const dy=event.key==="ArrowUp"?-40:event.key==="ArrowDown"?40:0;
              if(dx||dy){event.preventDefault();setPan(position=>({x:position.x+dx,y:position.y+dy}));}
              if(event.key==="Home"){event.preventDefault();fit();}
            }}>
            <GraphExplorerCompactList nodes={presentation.nodes} selectedId={selectedId} onSelect={setSelectedId}
              emptyMessage={graph.nodes.length ? "No matching recorded objects. Reset search or filters." : "Capture or publish intelligence objects to build the graph."} />
            <div className="pointer-events-none absolute left-0 top-0 hidden h-[600px] w-[900px] md:block"
              style={{transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`,transformOrigin:"top left"}}>
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Recorded object relationships">
                {presentation.edges.map((edge, index) => {
                  const a = positions.get(edge.sourceId); const b = positions.get(edge.targetId);
                  if (!a || !b) return null;
                  const isBridge = graph.nodes.find(n => n.objectId === edge.sourceId)?.domain !== graph.nodes.find(n => n.objectId === edge.targetId)?.domain;
                  const highlighted = Boolean(selectedId && (edge.sourceId === selectedId || edge.targetId === selectedId));
                  return <line key={`${edge.sourceId}-${edge.targetId}-${edge.relation}-${index}`}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke"
                    stroke={highlighted ? "rgba(251,191,36,.95)" : isBridge ? "rgba(103,232,249,.5)" : "rgba(251,191,36,.25)"}
                    strokeWidth={highlighted ? 2 : isBridge ? 1.1 : .8} strokeDasharray={isBridge || highlighted ? undefined : "3 3"} />;
                })}
              </svg>
              {DOMAIN_ORDER.map(domain => {
                const axis = DOMAIN_ORDER.indexOf(domain) * 2 * Math.PI / DOMAIN_ORDER.length - Math.PI / 2;
                const x = 50 + Math.cos(axis) * 47;
                const y = 50 + Math.sin(axis) * 47;
                const count = presentation.nodes.filter(node => node.domain === domain).length;
                return <div key={domain}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-md border border-border/50 bg-black/80 px-2 py-1 font-ui text-[10px] font-semibold text-muted-foreground"
                  style={{ left: `${x}%`, top: `${y}%` }}>{DOMAIN_LABEL[domain]} · {count}</div>;
              })}
              {presentation.nodes.map(node => {
                const position = positions.get(node.objectId);
                if (!position) return null;
                const active = selectedId === node.objectId;
                const faded = Boolean(selectedId && !presentation.connectedIds.has(node.objectId));
                return <button key={node.objectId} type="button" aria-pressed={active}
                  data-graph-object={node.objectId} onClick={() => setSelectedId(node.objectId)}
                  aria-label={`Inspect ${node.label} in ${DOMAIN_LABEL[node.domain]}`}
                  className={`pointer-events-auto absolute w-[116px] -translate-x-1/2 -translate-y-1/2 rounded-lg border p-2.5 text-left shadow-xl transition-all focus-visible:z-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 ${DOMAIN_COLOR[node.domain]} ${active ? "z-20 bg-[#322312] ring-2 ring-amber-300/60" : "bg-[#101113] hover:z-20 hover:scale-[1.04]"} ${faded ? "opacity-40" : "opacity-100"}`}
                  style={{ left: `${position.x}%`, top: `${position.y}%` }}
                  title={`${DOMAIN_LABEL[node.domain]} · ${node.label}`}>
                  <span className="block truncate font-ui text-[10px] font-medium text-cyan-200/85">{DOMAIN_LABEL[node.domain]}</span>
                  <span className="mt-1 block line-clamp-2 font-ui text-xs font-semibold leading-4 text-foreground">{node.label}</span>
                  {node.symbol && <span className="mt-1 block truncate font-ui text-[10px] text-amber-200">{node.symbol}</span>}
                </button>;
              })}
              {!presentation.nodes.length && <div className="absolute inset-0 grid place-items-center p-5 text-center font-ui text-sm text-muted-foreground">
                {graph.nodes.length ? "No matching objects. Clear the search or turn off Direct links." : "Capture or publish intelligence objects to build the graph."}
              </div>}
            </div>
          </main>
          <aside className="min-h-0 overflow-y-auto border-t border-border/60 bg-background/40 p-4 scrollbar-thin lg:border-l lg:border-t-0" aria-label="Selected intelligence object details">
            {!selected ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Network className="h-7 w-7 text-amber-200/65" aria-hidden="true"/>
                <h3 className="font-ui text-sm font-semibold text-foreground">Explore a connection</h3>
                <p className="max-w-[270px] font-ui text-xs leading-5 text-muted-foreground">Select a recorded object to see its incoming and outgoing links, source information and available actions.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {!selectedVisible && <p role="status" className="rounded-lg border border-amber-300/30 p-3 font-ui text-xs text-amber-200">Selected object is hidden by the current filters. Reset the view to see its node.</p>}
                <section className="rounded-xl border border-border/60 bg-white/[0.025] p-4">
                  <span className="font-ui text-xs font-medium text-amber-200">{selected.kind.replaceAll("_", " ")} · {selected.status}</span>
                  <h3 className="mt-2 break-words font-ui text-base font-semibold text-foreground">{selected.label}</h3>
                  <p className="mt-1 font-ui text-xs text-muted-foreground">{selected.symbol ?? "No recorded symbol"}</p>
                  <p className="mt-3 whitespace-pre-wrap font-ui text-sm leading-6 text-foreground/80">{selected.description || "No description published."}</p>
                  {selected.source && <div className="mt-3 border-t border-border/50 pt-3">
                    <h4 className="font-ui text-xs font-semibold text-muted-foreground">Recorded source</h4>
                    <p className="mt-1 break-words font-ui text-xs text-foreground">{selected.source.label}</p>
                    {selected.source.provider && <p className="mt-1 font-ui text-xs text-muted-foreground">{selected.source.provider}</p>}
                    <p className="mt-2 font-ui text-[11px] text-muted-foreground">{selected.source.freshness ? `Recorded freshness: ${selected.source.freshness}` : "Freshness not recorded"} · {selected.source.effectiveAt ? `As of ${selected.source.effectiveAt}` : "As-of time unavailable"}</p>
                    {selected.source.sourceId && <p className="mt-1 break-all font-ui text-[11px] text-muted-foreground">Source ID: {selected.source.sourceId}</p>}
                  </div>}
                </section>
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-ui text-sm font-semibold text-foreground">Recorded relationships</h4>
                    <span className="font-ui text-xs text-muted-foreground">{selectedConnections.length} linked</span>
                  </div>
                  <p className="font-ui text-[11px] text-muted-foreground">Arrows show the direction of the recorded link. Categories are inferred for display, not verified exposure.</p>
                  {selectedConnections.map((link, index) => {
                    const Icon = link.direction === "outgoing" ? ArrowUpRight : ArrowDownLeft;
                    return <button key={`${link.direction}-${link.otherId}-${link.relation}-${index}`}
                      type="button" onClick={() => selectAndFocus(link.otherId)}
                      className="block min-h-12 w-full rounded-lg border border-border/60 bg-white/[0.02] p-3 text-left transition-colors hover:border-cyan-300/35 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                      <span className="flex items-center gap-2 font-ui text-xs font-semibold text-cyan-200"><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {link.direction === "outgoing" ? "Points to" : "Comes from"} · {link.relation.replaceAll("-", " ")}
                      </span>
                      <span className="mt-1 block break-words font-ui text-sm font-medium text-foreground">{link.otherLabel}</span>
                      <span className="mt-1 block font-ui text-[11px] text-muted-foreground">{DOMAIN_LABEL[link.otherDomain]}</span>
                      {link.explanation && <span className="mt-2 block break-words font-ui text-xs leading-5 text-muted-foreground">{link.explanation}</span>}
                    </button>;
                  })}
                  {!selectedConnections.length && <p className="rounded-lg border border-dashed border-border/60 p-4 font-ui text-xs text-muted-foreground">No explicit links between this object and the currently loaded objects.</p>}
                </section>
                <section className="space-y-2">
                  <h4 className="font-ui text-sm font-semibold text-foreground">Continue with this object</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {actionsForIntelligenceObject(selected).slice(0, 10).map(action => <button key={action.id}
                      type="button" onClick={() => requestIntelligenceObjectAction(action)}
                      className="min-h-10 rounded-lg border border-border/60 px-2 py-2 text-left font-ui text-xs text-foreground hover:border-amber-300/35 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                      {action.label}
                    </button>)}
                  </div>
                </section>
              </div>
            )}
          </aside>
        </div>
        <footer className="shrink-0 border-t border-border/60 px-4 py-2 font-ui text-[11px] text-muted-foreground">
          Lines are recorded object relations. Domain grouping is a label-based display aid—not a verified financial exposure or a new source of evidence.
        </footer>
      </section>
    </div>
  );
}
