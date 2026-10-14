import { useMemo } from "react";
import { ArrowRight, GitBranch, Sparkles } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { getLatestAnalyticalSnapshot, getChangesSincePrevious } from "@/lib/terminalChangeIntelligence";
import { buildAnalyticalStoryline } from "@/lib/terminalStoryline";
import { getRelatedToolActions } from "@/lib/terminalToolGraph";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";

interface Props {
  view: ViewMode;
  symbol?: string;
  mode: "analysis" | "thesis";
  isInternal?: boolean;
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return String(value);
}

export default function PaneSemanticSummary({ view, symbol, mode, isInternal = false }: Props) {
  const capability = getTerminalCapability(view);
  const snapshot = useMemo(() => getLatestAnalyticalSnapshot(view, symbol), [symbol, view]);
  const changes = useMemo(() => getChangesSincePrevious(view, symbol).filter((item) => item.severity !== "info").slice(0, mode === "thesis" ? 8 : 4), [mode, symbol, view]);
  const storyline = useMemo(() => buildAnalyticalStoryline(view, symbol), [symbol, view]);
  const next = useMemo(() => getRelatedToolActions(view, isInternal).filter((item) => item.relationship === "next" || item.relationship === "monitor").slice(0, 4), [isInternal, view]);
  const entries = Object.entries(snapshot?.values ?? {}).slice(0, mode === "thesis" ? 10 : 5);

  if (mode === "analysis") {
    return <div className="grid shrink-0 grid-cols-[1fr_auto] gap-3 border-b border-border/45 bg-white/[0.012] px-3 py-2"><div className="min-w-0"><div className="flex flex-wrap gap-2">{entries.length ? entries.map(([key, value]) => <span key={key} className="font-ui text-[7px] text-muted-foreground"><span className="text-foreground/75">{key}</span> <span className="lios-number text-cyan-200/85">{fmt(value)}</span></span>) : <span className="font-ui text-[7px] text-muted-foreground">No published key-output snapshot yet.</span>}</div>{changes.length > 0 && <div className="font-ui mt-1 text-[7px] text-amber-300/80">{changes.length} material change{changes.length === 1 ? "" : "s"} since prior snapshot</div>}</div><button onClick={() => openTerminalUxSurface("innovation-studio")} className="font-ui self-center rounded-md border border-border/50 px-2 py-1 text-[7px] text-muted-foreground hover:text-foreground">Studio</button></div>;
  }

  return <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_20%_0%,rgba(251,191,36,.035),transparent_34%)] p-4 scrollbar-thin"><div className="mx-auto max-w-4xl space-y-4"><section className="rounded-2xl border border-border/55 bg-white/[0.012] p-5"><div className="flex items-start justify-between gap-3"><div><div className="font-ui text-[14px] font-semibold text-foreground">{symbol ? `${symbol} · ` : ""}{capability.label}</div><p className="font-ui mt-2 max-w-2xl text-[9px] leading-relaxed text-muted-foreground">{capability.description}</p></div><span className="lios-pane-code rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-2 py-1 text-[7px] text-amber-200">THESIS ZOOM</span></div></section>
    <section className="grid gap-3 md:grid-cols-2"><div className="rounded-2xl border border-border/55 p-4"><div className="font-ui text-[9px] font-semibold text-foreground">Key analytical state</div><div className="mt-3 grid grid-cols-2 gap-2">{entries.length ? entries.map(([key, value]) => <div key={key} className="rounded-xl border border-border/40 bg-white/[0.012] p-2.5"><div className="font-ui truncate text-[7px] text-muted-foreground">{key}</div><div className="lios-number mt-1 text-[9px] text-foreground">{fmt(value)}</div></div>) : <div className="col-span-2 rounded-xl border border-dashed border-border/50 p-4 font-ui text-[8px] text-muted-foreground">This panel has not published a summary snapshot yet. Full detail remains available in Detail Zoom.</div>}</div></div>
    <div className="rounded-2xl border border-border/55 p-4"><div className="font-ui text-[9px] font-semibold text-foreground">What changed</div><div className="mt-3 space-y-1">{changes.length ? changes.map((change) => <div key={change.key} className="flex items-center justify-between gap-2 rounded-lg border border-border/40 px-2 py-2"><span className="font-ui truncate text-[7px] text-muted-foreground">{change.key}</span><span className={`lios-pane-code text-[6px] ${change.severity === "critical" ? "text-red-300" : "text-amber-300"}`}>{change.percentDelta === undefined ? change.direction.toUpperCase() : `${change.percentDelta >= 0 ? "+" : ""}${change.percentDelta.toFixed(1)}%`}</span></div>) : <div className="font-ui text-[8px] text-muted-foreground">No material snapshot changes available.</div>}</div></div></section>
    {storyline && <section className="rounded-2xl border border-border/55 p-4"><div className="flex items-center gap-2"><GitBranch className="h-3.5 w-3.5 text-cyan-300" /><div className="font-ui text-[9px] font-semibold text-foreground">{storyline.journeyLabel}</div></div><div className="mt-3 flex gap-1.5">{storyline.stages.map((stage) => <div key={stage.label} className="min-w-0 flex-1"><div className={`h-1.5 rounded-full ${stage.state === "active" ? "bg-amber-300" : stage.state === "complete" ? "bg-cyan-300/55" : "bg-white/[0.08]"}`} /><div className="font-ui mt-1.5 truncate text-[6px] text-muted-foreground">{stage.label}</div></div>)}</div></section>}
    <section className="rounded-2xl border border-border/55 p-4"><div className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-amber-300" /><div className="font-ui text-[9px] font-semibold text-foreground">Continue analysis</div></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{next.map((action) => <button key={`${action.relationship}-${action.view}`} onClick={() => openTerminalUxSurface("innovation-studio")} className="group rounded-xl border border-border/45 p-3 text-left hover:border-amber-400/20 hover:bg-amber-400/[0.02]"><div className="flex items-center justify-between"><span className="font-ui text-[8px] font-medium text-foreground">{action.label}</span><ArrowRight className="h-3 w-3 text-muted-foreground group-hover:text-amber-300" /></div><p className="font-ui mt-1 text-[7px] leading-relaxed text-muted-foreground">{action.reason}</p></button>)}</div></section>
    <button onClick={() => openTerminalUxSurface("innovation-studio")} className="font-ui rounded-xl border border-amber-400/25 bg-amber-400/[0.035] px-4 py-2 text-[8px] font-semibold text-amber-200">Open Analytical Studio</button></div></div>;
}
