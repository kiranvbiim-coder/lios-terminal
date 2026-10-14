import { useEffect, useMemo, useState } from "react";
import { Network, X } from "lucide-react";
import { buildCrossDomainGraph, crossDomainBridges, domainExposure, type CrossDomainNodeDomain } from "@/lib/terminalCrossDomainGraph";
import { loadIntelligenceObjects, subscribeIntelligenceObjects, type IntelligenceObject } from "@/lib/terminalIntelligenceObjects";
import { actionsForIntelligenceObject, requestIntelligenceObjectAction } from "@/lib/terminalObjectActions";

interface Props { activeSymbol?: string; onClose: () => void }

const DOMAIN_ORDER: CrossDomainNodeDomain[] = ["finance", "market", "macro", "policy", "supply-chain", "sustainability", "portfolio", "research"];
const DOMAIN_LABEL: Record<CrossDomainNodeDomain, string> = {
  finance: "FINANCE", market: "MARKET", macro: "MACRO", policy: "POLICY", "supply-chain": "SUPPLY CHAIN", sustainability: "SUSTAINABILITY", portfolio: "PORTFOLIO", research: "RESEARCH",
};

function nodePosition(domain: CrossDomainNodeDomain, index: number, total: number): { x: number; y: number } {
  const domainIndex = DOMAIN_ORDER.indexOf(domain);
  const angle = (domainIndex / DOMAIN_ORDER.length) * Math.PI * 2 - Math.PI / 2;
  const baseX = 50 + Math.cos(angle) * 31;
  const baseY = 50 + Math.sin(angle) * 31;
  const spread = total <= 1 ? 0 : ((index / (total - 1)) - .5) * 12;
  return { x: baseX + Math.cos(angle + Math.PI / 2) * spread, y: baseY + Math.sin(angle + Math.PI / 2) * spread };
}

export default function GraphExplorer({ activeSymbol, onClose }: Props) {
  const [objects, setObjects] = useState<IntelligenceObject[]>(() => loadIntelligenceObjects());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [symbolOnly, setSymbolOnly] = useState(Boolean(activeSymbol));
  const [bridgesOnly, setBridgesOnly] = useState(false);
  useEffect(() => subscribeIntelligenceObjects(setObjects), []);

  const visibleObjects = useMemo(() => (symbolOnly && activeSymbol ? objects.filter((object) => !object.symbol || object.symbol === activeSymbol) : objects).slice(0, 120), [activeSymbol, objects, symbolOnly]);
  const graph = useMemo(() => buildCrossDomainGraph(visibleObjects), [visibleObjects]);
  const bridges = useMemo(() => crossDomainBridges(graph), [graph]);
  const exposure = useMemo(() => domainExposure(graph), [graph]);
  const edges = bridgesOnly ? bridges : graph.edges;
  const selected = visibleObjects.find((object) => object.id === selectedId) ?? null;

  const groups = useMemo(() => {
    const map = new Map<CrossDomainNodeDomain, typeof graph.nodes>();
    for (const domain of DOMAIN_ORDER) map.set(domain, graph.nodes.filter((node) => node.domain === domain));
    return map;
  }, [graph.nodes]);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const domain of DOMAIN_ORDER) {
      const nodes = groups.get(domain) ?? [];
      nodes.forEach((node, index) => map.set(node.objectId, nodePosition(domain, index, nodes.length)));
    }
    return map;
  }, [groups]);

  return (
    <div className="fixed inset-0 z-[92] bg-black/80 p-3 backdrop-blur-[5px]" onMouseDown={onClose}>
      <section className="lios-v4-overlay mx-auto flex h-[min(860px,calc(100vh-24px))] w-full max-w-[1500px] flex-col overflow-hidden border" onMouseDown={(event) => event.stopPropagation()} aria-label="LiOS Cross-Domain Graph Explorer">
        <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center border border-[hsl(38,100%,50%)/30%] bg-[hsl(38,100%,50%)/7%]"><Network className="h-4 w-4 text-[hsl(38,100%,58%)]" /></div>
          <div className="min-w-0 flex-1"><div className="text-[11px] font-bold tracking-[.13em]">CROSS-DOMAIN INTELLIGENCE GRAPH</div><div className="mt-1 text-[8px] text-muted-foreground">FINANCE ↔ MARKET ↔ MACRO ↔ POLICY ↔ SUPPLY CHAIN ↔ SUSTAINABILITY ↔ PORTFOLIO ↔ RESEARCH</div></div>
          <button onClick={() => setSymbolOnly((value) => !value)} className={`border px-2.5 py-1.5 text-[8px] ${symbolOnly ? "border-[hsl(38,100%,50%)/35%] text-[hsl(38,100%,60%)]" : "border-border text-muted-foreground"}`}>{activeSymbol ? `${activeSymbol} CONTEXT` : "SYMBOL CONTEXT"}</button>
          <button onClick={() => setBridgesOnly((value) => !value)} className={`border px-2.5 py-1.5 text-[8px] ${bridgesOnly ? "border-cyan-500/35 text-cyan-300" : "border-border text-muted-foreground"}`}>CROSS-DOMAIN BRIDGES {bridges.length}</button>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px]">
          <main className="relative min-h-0 overflow-hidden bg-[radial-gradient(circle_at_center,rgba(245,160,0,.035),transparent_34%),#050505]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Cross-domain graph">
              {edges.map((edge, index) => {
                const a = positions.get(edge.sourceId); const b = positions.get(edge.targetId); if (!a || !b) return null;
                const isBridge = bridges.some((item) => item.sourceId === edge.sourceId && item.targetId === edge.targetId && item.relation === edge.relation);
                return <line key={`${edge.sourceId}-${edge.targetId}-${index}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" stroke={isBridge ? "rgba(70,210,230,.42)" : "rgba(245,160,0,.18)"} strokeWidth={isBridge ? 1.1 : .7} strokeDasharray={isBridge ? "0" : "2 3"} />;
              })}
            </svg>
            {DOMAIN_ORDER.map((domain) => {
              const angle = (DOMAIN_ORDER.indexOf(domain) / DOMAIN_ORDER.length) * Math.PI * 2 - Math.PI / 2;
              const x = 50 + Math.cos(angle) * 42; const y = 50 + Math.sin(angle) * 42;
              return <div key={domain} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 border border-border/50 bg-black/75 px-2 py-1 text-[6.5px] font-bold tracking-widest text-muted-foreground" style={{ left: `${x}%`, top: `${y}%` }}>{DOMAIN_LABEL[domain]} · {exposure[domain].toFixed(1)}</div>;
            })}
            {graph.nodes.map((node) => {
              const position = positions.get(node.objectId); if (!position) return null;
              const active = selectedId === node.objectId;
              return <button key={node.objectId} onClick={() => setSelectedId(node.objectId)} className={`absolute w-[118px] -translate-x-1/2 -translate-y-1/2 border p-2 text-left shadow-xl transition-transform hover:z-20 hover:scale-[1.03] ${active ? "z-20 border-[hsl(38,100%,50%)/55%] bg-[#15110a]" : "border-border/70 bg-[#0a0a0a]/94"}`} style={{ left: `${position.x}%`, top: `${position.y}%` }} title={`${DOMAIN_LABEL[node.domain]} · ${node.label}`}><div className="truncate text-[6px] font-bold tracking-wider text-cyan-300/80">{DOMAIN_LABEL[node.domain]}</div><div className="mt-1 truncate text-[7px] font-bold text-foreground">{node.label}</div>{node.symbol && <div className="mt-1 text-[6px] text-[hsl(38,100%,60%)]">{node.symbol}</div>}</button>;
            })}
            {!graph.nodes.length && <div className="absolute inset-0 grid place-items-center text-[8px] text-muted-foreground">CAPTURE OR PUBLISH INTELLIGENCE OBJECTS TO BUILD THE GRAPH</div>}
          </main>

          <aside className="min-h-0 overflow-y-auto border-l border-border/60 bg-black/20 p-3 scrollbar-thin">
            {!selected ? <div className="grid h-full place-items-center text-center text-[8px] text-muted-foreground"><div><Network className="mx-auto h-6 w-6" /><div className="mt-3">SELECT A NODE TO INSPECT LINKS AND ACTIONS</div></div></div> : <div className="space-y-4">
              <section className="border border-border/70 bg-white/[.012] p-3"><div className="text-[7px] font-bold tracking-widest text-[hsl(38,100%,58%)]">{selected.kind.toUpperCase()}</div><div className="mt-2 text-[10px] font-bold">{selected.label}</div><div className="mt-1 text-[7px] text-muted-foreground">{selected.symbol ?? "GLOBAL"} · {selected.status.toUpperCase()}</div><p className="mt-3 text-[8px] leading-relaxed text-muted-foreground">{selected.description || "No description published."}</p></section>
              <section><div className="mb-2 text-[7px] font-bold tracking-widest text-muted-foreground">RELATIONSHIPS</div><div className="space-y-1.5">{selected.relations.map((relation) => { const target = visibleObjects.find((object) => object.id === relation.targetId); return <button key={`${relation.kind}-${relation.targetId}`} onClick={() => setSelectedId(relation.targetId)} className="w-full border border-border/60 bg-white/[.01] p-2 text-left hover:border-cyan-500/25"><div className="text-[6.5px] font-bold text-cyan-300">{relation.kind.toUpperCase()}</div><div className="mt-1 truncate text-[8px]">{target?.label ?? relation.targetId}</div></button>; })}{!selected.relations.length && <div className="border border-dashed border-border/60 p-3 text-center text-[7px] text-muted-foreground">NO EXPLICIT RELATIONSHIPS</div>}</div></section>
              <section><div className="mb-2 text-[7px] font-bold tracking-widest text-muted-foreground">ACTIONS</div><div className="grid gap-1.5">{actionsForIntelligenceObject(selected).slice(0, 9).map((action) => <button key={action.id} onClick={() => requestIntelligenceObjectAction(action)} className="border border-border/60 px-2 py-2 text-left text-[7px] text-muted-foreground hover:border-[hsl(38,100%,50%)/25%] hover:text-foreground">{action.label.toUpperCase()}</button>)}</div></section>
            </div>}
          </aside>
        </div>
      </section>
    </div>
  );
}
