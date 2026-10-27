import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BellRing, Clock3, GitCompareArrows, Radar, ShieldAlert, Target } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import { subscribeChangeIntelligence } from "@/lib/terminalChangeIntelligence";
import { subscribeDecisionObjects } from "@/lib/terminalDecisionObjects";
import { subscribeIntelligenceObjects } from "@/lib/terminalIntelligenceObjects";
import { buildIntelligencePulse, buildScenarioMatrix, type IntelligencePulseItem, type PulsePriority } from "@/lib/terminalIntelligencePulse";
import { setActiveScenario, subscribeScenarioUniverse } from "@/lib/terminalScenarioUniverse";
import { subscribeTerminalTimeContext } from "@/lib/terminalTimeTravel";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";
import { useProactiveInboxReview } from "@/lib/useProactivePulse";
import { buildActionInboxChatDraft } from "@/lib/actionInboxReview";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onStageAiReview: (draft: string) => boolean;
  onClose: () => void;
}

type Tab = "pulse" | "matrix" | "proactive";

const PRIORITY_STYLE: Record<PulsePriority, string> = {
  critical: "border-red-500/35 bg-red-500/[.045] text-red-300",
  high: "border-orange-500/30 bg-orange-500/[.035] text-orange-300",
  medium: "border-[hsl(38,100%,50%)/28%] bg-[hsl(38,100%,50%)/3%] text-[hsl(38,100%,60%)]",
  low: "border-border/70 bg-white/[.01] text-muted-foreground",
};

function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return "NOW";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}M`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}H`;
  return `${Math.floor(delta / 86_400_000)}D`;
}

function PulseIcon({ item }: { item: IntelligencePulseItem }) {
  if (item.kind === "reversal") return <ShieldAlert className="h-3.5 w-3.5" />;
  if (item.kind === "decision-risk") return <Target className="h-3.5 w-3.5" />;
  if (item.kind === "monitor") return <BellRing className="h-3.5 w-3.5" />;
  if (item.kind === "time-context") return <Clock3 className="h-3.5 w-3.5" />;
  if (item.kind === "scenario") return <GitCompareArrows className="h-3.5 w-3.5" />;
  return <Activity className="h-3.5 w-3.5" />;
}

export default function IntelligencePulse({ onOpen, onStageAiReview, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("pulse");
  const [opener] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [proactiveEnabled, setProactiveEnabled] = useState(false);
  const [expandedInboxItemId, setExpandedInboxItemId] = useState<string | null>(null);
  const [reviewHandoffMessage, setReviewHandoffMessage] = useState("");
  const { result: proactive, refresh: refreshInbox } = useProactiveInboxReview(tab === "proactive" && proactiveEnabled);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => subscribeChangeIntelligence(refresh), [refresh]);
  useEffect(() => subscribeDecisionObjects(refresh), [refresh]);
  useEffect(() => subscribeIntelligenceObjects(refresh), [refresh]);
  useEffect(() => subscribeScenarioUniverse(refresh), [refresh]);
  useEffect(() => subscribeTerminalTimeContext(refresh), [refresh]);

  const pulse = useMemo(() => buildIntelligencePulse(100), [revision]);
  const matrix = useMemo(() => buildScenarioMatrix(), [revision]);

  const openItem = (item: IntelligencePulseItem) => {
    if (item.kind === "decision-risk" || item.kind === "reversal") {
      openTerminalUxSurface("decision-center");
      return;
    }
    if (item.kind === "scenario") {
      openTerminalUxSurface("scenario-workbench");
      return;
    }
    if (item.objectId && item.kind === "monitor") {
      openTerminalUxSurface("object-workbench");
      return;
    }
    if (item.view) onOpen(item.view, "tab", item.symbol);
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        aria-label="LiOS Intelligence Pulse"
        className="lios-v4-overlay !z-[94] !flex !h-[min(860px,calc(100dvh-24px))] !w-[calc(100vw-24px)] !max-w-7xl !flex-col !gap-0 !overflow-hidden !rounded-xl !p-0 !pr-0"
        overlayProps={{ className: "!z-[93] bg-black/82 backdrop-blur-[3px]" }}
        onCloseAutoFocus={event => { event.preventDefault(); if (opener?.isConnected) opener.focus(); }}
      >
        <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center border border-[hsl(38,100%,50%)/32%] bg-[hsl(38,100%,50%)/7%]"><Radar className="h-4 w-4 text-[hsl(38,100%,60%)]" /></div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[13px] font-bold tracking-[.11em] text-foreground">INTELLIGENCE PULSE</DialogTitle>
            <DialogDescription className="mt-1 text-xs text-muted-foreground">What changed · What is at risk · What needs attention</DialogDescription>
          </div>
          <div className="hidden items-center gap-1.5 lg:flex">
            {(["critical", "high", "medium", "low"] as PulsePriority[]).map((priority) => <span key={priority} className={`border px-2 py-1 text-[7px] font-bold tracking-wider ${PRIORITY_STYLE[priority]}`}>{priority.toUpperCase()} {pulse.counts[priority]}</span>)}
          </div>
          <button onClick={() => openTerminalUxSurface("decision-center")} className="lios-v5-hero-action"><Target className="h-3 w-3" /> DECISIONS</button>

        </header>

        <div className="flex items-center border-b border-border/60 bg-black/20 px-2">
          <button onClick={() => setTab("pulse")} className={`border-b-2 px-3 py-2 text-[8px] font-bold tracking-widest ${tab === "pulse" ? "border-[hsl(38,100%,50%)] text-[hsl(38,100%,60%)]" : "border-transparent text-muted-foreground"}`}>ATTENTION QUEUE</button>
          <button onClick={() => setTab("matrix")} className={`border-b-2 px-3 py-2 text-[8px] font-bold tracking-widest ${tab === "matrix" ? "border-cyan-400 text-cyan-300" : "border-transparent text-muted-foreground"}`}>SCENARIO MATRIX</button>
          <button type="button" aria-pressed={tab === "proactive"} onClick={() => setTab("proactive")} className={`min-h-10 border-b-2 px-3 py-2 text-xs font-semibold ${tab === "proactive" ? "border-cyan-400 text-cyan-200" : "border-transparent text-muted-foreground"}`}>PROACTIVE REVIEW</button>
          <div className="ml-auto px-2 text-[7px] text-muted-foreground">{pulse.activeScenario ? `SCENARIO ${pulse.activeScenario.name}` : "NO ACTIVE SCENARIO"}</div>
        </div>

        {tab === "pulse" ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
            <main className="min-h-0 overflow-y-auto p-3 scrollbar-thin">
              {pulse.items.length ? <div className="space-y-2">{pulse.items.map((item) => (
                <button key={item.id} onClick={() => openItem(item)} className={`group flex w-full items-start gap-3 border p-3 text-left transition-colors hover:bg-white/[.025] ${PRIORITY_STYLE[item.priority]}`}>
                  <div className="mt-0.5 shrink-0"><PulseIcon item={item} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="truncate text-[9px] font-bold text-foreground">{item.title}</span>{item.symbol && <span className="shrink-0 text-[7px] font-bold text-[hsl(38,100%,60%)]">{item.symbol}</span>}</div>
                    <div className="mt-1 text-[7.5px] leading-relaxed text-muted-foreground">{item.detail}</div>
                    <div className="mt-2 flex gap-2 text-[6.5px] tracking-wider text-muted-foreground/75"><span>{item.kind.toUpperCase()}</span><span>· SCORE {item.score}</span><span>· {relativeTime(item.createdAt)}</span></div>
                  </div>
                  <span className="mt-0.5 text-[7px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">OPEN →</span>
                </button>
              ))}</div> : <div className="grid h-full min-h-64 place-items-center border border-dashed border-border/70 text-center"><div><Activity className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-[9px] font-bold">NO MATERIAL PULSE ITEMS</div><div className="mt-1 text-[7px] text-muted-foreground">As analytical snapshots, monitors and decisions accumulate, LiOS will prioritize them here.</div></div></div>}
            </main>
            <aside className="border-l border-border/60 bg-black/20 p-3">
              <div className="text-[8px] font-bold tracking-widest text-muted-foreground">FAST ROUTES</div>
              <div className="mt-3 space-y-1.5">
                <button onClick={() => openTerminalUxSurface("scenario-workbench")} className="w-full border border-border/65 p-2.5 text-left text-[8px] hover:border-[hsl(38,100%,50%)/30%]">SCENARIO WORKBENCH</button>
                <button onClick={() => openTerminalUxSurface("decision-center")} className="w-full border border-border/65 p-2.5 text-left text-[8px] hover:border-[hsl(38,100%,50%)/30%]">DECISION CENTER</button>
                <button onClick={() => openTerminalUxSurface("graph-explorer")} className="w-full border border-border/65 p-2.5 text-left text-[8px] hover:border-cyan-400/30">CROSS-DOMAIN GRAPH</button>
                <button onClick={() => openTerminalUxSurface("object-workbench")} className="w-full border border-border/65 p-2.5 text-left text-[8px] hover:border-cyan-400/30">OBJECT WORKBENCH</button>
              </div>
              <div className="mt-5 border border-border/60 bg-white/[.012] p-3">
                <div className="flex items-center gap-2 text-[8px] font-bold"><AlertTriangle className="h-3 w-3 text-[hsl(38,100%,60%)]" /> DETERMINISTIC PRIORITY</div>
                <p className="mt-2 text-[7px] leading-relaxed text-muted-foreground">Pulse ranking is computed from published snapshot deltas, explicit decision evidence, reversal thresholds and monitor state. It does not invent market explanations.</p>
              </div>
            </aside>
          </div>
        ) : tab === "matrix" ? (
          <div className="min-h-0 flex-1 overflow-auto p-4 scrollbar-thin">
            <div className="mb-3 flex items-center justify-between"><div><div className="text-[9px] font-bold">SCENARIO ASSUMPTION MATRIX</div><div className="mt-1 text-[7px] text-muted-foreground">Compare assumptions across Base / Bull / Bear / Stress / custom branches. Largest numeric spreads rise to the top.</div></div><button onClick={() => openTerminalUxSurface("scenario-workbench")} className="lios-v5-hero-action"><GitCompareArrows className="h-3 w-3" /> EDIT SCENARIOS</button></div>
            {matrix.scenarios.length ? <table className="lios-signature-table min-w-full border-collapse text-[8px]">
              <thead><tr><th className="sticky left-0 z-10 bg-[#080808] p-2 text-left">ASSUMPTION</th><th className="p-2 text-right">SPREAD</th>{matrix.scenarios.map((scenario) => <th key={scenario.id} className="min-w-28 p-2 text-right"><button onClick={() => { setActiveScenario(scenario.id); openTerminalUxSurface("scenario-workbench"); }} className="hover:text-[hsl(38,100%,60%)]"><span className="block text-[7px] text-muted-foreground">{scenario.kind.toUpperCase()} · {scenario.probability ?? 0}%</span><span className="mt-1 block text-[8px] text-foreground">{scenario.name}</span></button></th>)}</tr></thead>
              <tbody>{matrix.rows.map((row) => <tr key={row.key}><td className="sticky left-0 bg-[#070707] p-2"><span className="font-bold text-foreground">{row.label}</span>{row.unit && <span className="ml-1 text-muted-foreground">{row.unit}</span>}</td><td className="p-2 text-right tabular-nums text-cyan-300">{typeof row.spread === "number" ? row.spread.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"}</td>{matrix.scenarios.map((scenario) => <td key={scenario.id} className="p-2 text-right tabular-nums">{row.values[scenario.id] === undefined || row.values[scenario.id] === null ? "—" : String(row.values[scenario.id])}</td>)}</tr>)}</tbody>
            </table> : <div className="grid min-h-64 place-items-center border border-dashed border-border/70 text-[8px] text-muted-foreground">CREATE SCENARIOS TO BUILD THE MATRIX</div>}
          </div>

        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin" aria-label="Proactive action inbox review">
            <div className="mx-auto max-w-4xl space-y-4">
              <header className="space-y-2">
                <h2 className="font-ui text-lg font-semibold text-foreground">Your Action Inbox</h2>
                <p className="font-ui text-sm leading-relaxed text-muted-foreground">
                  Review existing user-entitled Wave D alerts and their source evidence. This does not start an AI agent,
                  place trades, write to sources, or authorize suggested actions.
                </p>
              </header>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 p-3">
                <label className="flex items-center gap-3 font-ui text-sm text-foreground">
                  <input type="checkbox" checked={proactiveEnabled}
                    onChange={event => { setProactiveEnabled(event.target.checked); setExpandedInboxItemId(null); }}
                    className="h-4 w-4 accent-cyan-500" />
                  Enable this foreground review
                </label>
                <button type="button" onClick={refreshInbox} disabled={!proactiveEnabled || proactive.state === "loading"}
                  className="min-h-10 rounded-lg border border-border px-3 text-sm font-medium text-foreground disabled:opacity-45">
                  Check for updates
                </button>
              </div>
              <div aria-live="polite" role="status" className="font-ui text-sm text-muted-foreground">
                {!proactiveEnabled || proactive.state === "idle"
                  ? "Off. The Action Inbox is not being requested."
                  : proactive.state === "loading" ? "Checking your permitted Action Inbox…"
                  : proactive.state === "not_authorized" ? "Action Inbox access is not authorized for this account or entitlement."
                  : proactive.state === "unavailable" ? "Action Inbox unavailable. No all-clear is implied; try again when the service is accessible."
                  : proactive.review.openCount > 0
                    ? `${proactive.review.openCount} open items require review · ${proactive.review.totalCount} in the current inbox`
                    : `No open items in the returned inbox · ${proactive.review.totalCount} total records`}
              </div>
              {reviewHandoffMessage && <p role="alert" className="rounded-lg border border-amber-500/25 p-3 font-ui text-sm text-amber-200">{reviewHandoffMessage}</p>}
              {proactive.state === "ready" && (
                <div className="space-y-3">
                  <p className="font-ui text-xs text-muted-foreground">
                    Server snapshot: {new Date(proactive.review.asOf!).toLocaleString()}.
                    {proactive.review.hiddenCount > 0 ? ` Showing the first ${proactive.review.items.length} of ${proactive.review.totalCount} items.` : ""}
                    {" "}Materiality is determined by existing Wave D source rules, not generated here.
                  </p>
                  {proactive.review.items.length === 0 && <p className="rounded-xl border border-dashed border-border p-5 font-ui text-sm text-muted-foreground">
                    The returned Action Inbox is empty. Existing Project automations and future monitoring still require their own permissions and setup.
                  </p>}
                  {proactive.review.items.map(item => (
                    <article key={item.id} className="rounded-xl border border-border/70 bg-white/[.015] p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="min-w-0 flex-1 break-words font-ui text-sm text-foreground">{item.title}</strong>
                        <span className="font-ui text-xs text-muted-foreground">{item.priority} · {item.status}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words font-ui text-sm leading-relaxed text-muted-foreground">{item.reason}</p>
                      <p className="mt-2 font-ui text-xs text-muted-foreground">Observed card: {item.sourceCardId} · {new Date(item.createdAt).toLocaleString()}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button type="button" onClick={() => {
                          if (proactive.state !== "ready") return;
                          const drafted = buildActionInboxChatDraft(item, proactive.review.asOf!);
                          if (onStageAiReview(drafted)) onClose();
                          else setReviewHandoffMessage("Keep or review your unsaved Workbench edits before switching to Chat. No AI request was sent.");
                        }} className="min-h-10 rounded-lg border border-cyan-500/35 px-3 font-ui text-sm font-semibold text-cyan-200">
                          Draft review in Chat
                        </button>
                        <button type="button" className="min-h-10 rounded-lg border border-border px-3 font-ui text-sm text-foreground"
                          aria-expanded={expandedInboxItemId === item.id}
                          onClick={() => setExpandedInboxItemId(previous => previous === item.id ? null : item.id)}>
                          {expandedInboxItemId === item.id ? "Hide source evidence" : `Inspect evidence (${item.evidence.length})`}
                        </button>
                        <span className="font-ui text-xs text-muted-foreground">
                          Suggested only: {item.suggestedActions.join(", ") || "none"}
                        </span>
                      </div>
                      {expandedInboxItemId === item.id && <div className="mt-3 rounded-lg border border-border/70 p-3">
                        <h3 className="font-ui text-sm font-semibold text-foreground">Attributed source evidence</h3>
                        {item.evidence.length === 0
                          ? <p className="mt-2 font-ui text-sm text-muted-foreground">No source references were included. Do not treat the alert as verified evidence.</p>
                          : <ul className="mt-2 space-y-2">{item.evidence.map(evidence => (
                            <li key={evidence.id} className="break-words font-ui text-sm text-muted-foreground">
                              <strong className="text-foreground">{evidence.source}</strong>
                              {evidence.provider ? ` · ${evidence.provider}` : ""}
                              {evidence.availableAt ? ` · ${new Date(evidence.availableAt).toLocaleString()}` : ""}
                              {evidence.url && <a className="ml-2 underline underline-offset-2" href={evidence.url} target="_blank" rel="noopener noreferrer">View source</a>}
                            </li>
                          ))}</ul>}
                      </div>}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </main>
        )}
      </DialogContent>
    </Dialog>
  );
}
