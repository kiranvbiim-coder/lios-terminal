import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Database, GitCompareArrows, History, Layers3, ShieldAlert, X } from "lucide-react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { TerminalInspectorRequest } from "@/lib/terminalInspector";
import { getEvidenceSnapshot, subscribeEvidence, type EvidenceSnapshot } from "@/lib/terminalEvidence";
import { rankProvenanceForContext, rankReceiptsForContext } from "@/lib/terminalEvidenceGravity";
import { getChangesSincePrevious } from "@/lib/terminalChangeIntelligence";
import { buildAnalyticalStoryline } from "@/lib/terminalStoryline";
import { getCrossDomainBridges } from "@/lib/terminalCrossDomainBridges";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  request: TerminalInspectorRequest;
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onClose: () => void;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—";
  return String(value);
}

export default function MiniInspector({ request, onOpen, onClose }: Props) {
  const [evidence, setEvidence] = useState<EvidenceSnapshot>(() => getEvidenceSnapshot());
  useEffect(() => subscribeEvidence(setEvidence), []);
  const capability = getTerminalCapability(request.view);
  const provenance = useMemo(() => rankProvenanceForContext(evidence.provenance, request.view, request.symbol).slice(0, 4), [evidence.provenance, request.symbol, request.view]);
  const receipts = useMemo(() => rankReceiptsForContext(evidence.receipts, request.view, request.symbol).slice(0, 3), [evidence.receipts, request.symbol, request.view]);
  const changes = useMemo(() => getChangesSincePrevious(request.view, request.symbol).slice(0, 8), [request.symbol, request.view]);
  const storyline = useMemo(() => buildAnalyticalStoryline(request.view, request.symbol), [request.symbol, request.view]);
  const bridges = useMemo(() => getCrossDomainBridges(request.view).slice(0, 4), [request.view]);

  return (
    <aside className="fixed right-3 top-12 z-[78] w-[min(390px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-border/80 bg-[#0a0b0d]/96 shadow-[0_24px_90px_rgba(0,0,0,.55)] backdrop-blur-xl" aria-label="Contextual mini inspector">
      <header className="flex items-start gap-3 border-b border-border/55 p-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/[0.045]"><Layers3 className="h-4 w-4 text-cyan-300" /></div>
        <div className="min-w-0 flex-1"><div className="font-ui text-[12px] font-semibold text-foreground">{request.label || capability.label}</div><div className="mt-1 flex items-center gap-2"><span className="lios-pane-code text-[7px] text-amber-300">{capability.shortLabel}</span>{request.symbol && <span className="lios-symbol text-[8px] text-cyan-300">{request.symbol}</span>}</div>{request.metricKey && <div className="mt-2 font-ui text-[8px] text-muted-foreground">{request.metricKey}: <span className="lios-number text-foreground">{formatValue(request.value)}</span></div>}</div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground" aria-label="Close inspector"><X className="h-3.5 w-3.5" /></button>
      </header>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-3 scrollbar-thin">
        {storyline && <section className="rounded-xl border border-border/55 bg-white/[0.012] p-3"><div className="font-ui text-[8px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Analytical storyline</div><div className="mt-2 flex gap-1">{storyline.stages.map((stage) => <div key={stage.label} title={stage.label} className={`h-1.5 flex-1 rounded-full ${stage.state === "active" ? "bg-amber-300/90" : stage.state === "complete" ? "bg-cyan-300/50" : stage.state === "available" ? "bg-white/20" : "bg-white/[0.06]"}`} />)}</div><div className="mt-2 font-ui text-[8px] text-muted-foreground">{storyline.journeyLabel} · {Math.round(storyline.progress * 100)}% path coverage</div></section>}

        <section><div className="mb-2 flex items-center gap-2"><Database className="h-3 w-3 text-cyan-300" /><span className="font-ui text-[8px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Evidence gravity</span></div>{provenance.length ? <div className="space-y-1.5">{provenance.map(({ item, score, reasons }) => <div key={item.id} className="rounded-lg border border-border/50 p-2.5"><div className="flex items-center justify-between gap-2"><span className="font-ui truncate text-[9px] font-medium text-foreground">{item.label}</span><span className="lios-pane-code text-[6px] text-cyan-300">{score}</span></div><div className="mt-1 font-ui text-[7px] text-muted-foreground">{item.provider || item.source} · {item.freshness}</div>{reasons.length > 0 && <div className="mt-1.5 font-ui text-[7px] text-muted-foreground/75">{reasons.join(" · ")}</div>}</div>)}</div> : <div className="rounded-lg border border-dashed border-border/60 p-3 font-ui text-[8px] text-muted-foreground">No published evidence for this surface yet.</div>}</section>

        {receipts.length > 0 && <section><div className="mb-2 flex items-center gap-2"><GitCompareArrows className="h-3 w-3 text-fuchsia-300" /><span className="font-ui text-[8px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Relevant calculations</span></div><div className="space-y-1.5">{receipts.map(({ item }) => <div key={item.id} className="rounded-lg border border-border/50 p-2.5"><div className="font-ui text-[9px] font-medium text-foreground">{item.label}</div><div className="mt-1 font-ui text-[7px] text-muted-foreground">{item.engine} · {item.reproducibilityId}</div><div className="mt-2 grid grid-cols-2 gap-1">{Object.entries(item.outputs).slice(0, 4).map(([key, value]) => <div key={key} className="rounded-md bg-white/[0.02] p-1.5"><div className="font-ui text-[6px] text-muted-foreground">{key}</div><div className="lios-number mt-0.5 text-[7px] text-foreground">{formatValue(value)}</div></div>)}</div></div>)}</div></section>}

        <section><div className="mb-2 flex items-center gap-2"><History className="h-3 w-3 text-amber-300" /><span className="font-ui text-[8px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">What changed</span></div>{changes.length ? <div className="space-y-1">{changes.map((change) => <div key={change.key} className="flex items-center justify-between gap-3 rounded-lg border border-border/45 px-2.5 py-2"><div className="min-w-0"><div className="font-ui truncate text-[8px] text-foreground">{change.key}</div><div className="mt-0.5 font-ui text-[7px] text-muted-foreground">{formatValue(change.before)} → {formatValue(change.after)}</div></div><span className={`lios-pane-code text-[6px] ${change.severity === "critical" ? "text-red-300" : change.severity === "material" ? "text-amber-300" : "text-muted-foreground"}`}>{change.percentDelta === undefined ? change.direction.toUpperCase() : `${change.percentDelta >= 0 ? "+" : ""}${change.percentDelta.toFixed(1)}%`}</span></div>)}</div> : <div className="rounded-lg border border-dashed border-border/60 p-3 font-ui text-[8px] text-muted-foreground">Capture two analytical states to see a deterministic change diff.</div>}</section>

        {bridges.length > 0 && <section><div className="mb-2 flex items-center gap-2"><ShieldAlert className="h-3 w-3 text-emerald-300" /><span className="font-ui text-[8px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Cross-domain bridges</span></div><div className="space-y-1">{bridges.map((bridge) => <button key={bridge.id} onClick={() => onOpen(bridge.to, "tab", bridge.symbolAware ? request.symbol : undefined)} className="group flex w-full items-start gap-2 rounded-lg border border-border/45 p-2.5 text-left hover:border-emerald-400/25 hover:bg-emerald-400/[0.025]"><div className="min-w-0 flex-1"><div className="font-ui text-[8px] font-medium text-foreground">{bridge.label}</div><div className="mt-1 font-ui text-[7px] leading-relaxed text-muted-foreground">{bridge.reason}</div></div><ArrowRight className="mt-0.5 h-3 w-3 text-muted-foreground group-hover:text-emerald-300" /></button>)}</div></section>}
      </div>
    </aside>
  );
}
