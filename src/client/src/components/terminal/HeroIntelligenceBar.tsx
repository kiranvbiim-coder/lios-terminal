import { useEffect, useMemo, useState } from "react";
import { Boxes, ChevronUp, Clock3, Database, GitBranch, MoreHorizontal, Network, ScanSearch, ShieldCheck, Sparkles, Target } from "lucide-react";
import { getHeroIntelligenceConfig, publishHeroEvidenceObjects } from "@/lib/terminalHeroIntelligence";
import { getEvidenceSnapshot, subscribeEvidence, type EvidenceSnapshot } from "@/lib/terminalEvidence";
import { getActiveScenario, subscribeScenarioUniverse, type TerminalScenario } from "@/lib/terminalScenarioUniverse";
import { publishScenarioContext } from "@/lib/terminalScenarioPropagation";
import { loadTerminalTimeContext, subscribeTerminalTimeContext, type TerminalTimeContext } from "@/lib/terminalTimeTravel";
import { buildTrustLedger } from "@/lib/terminalTrustLedger";
import { openTerminalInspector } from "@/lib/terminalInspector";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  view: ViewMode;
  symbol?: string;
  compact?: boolean;
}

function latestMetric(evidence: EvidenceSnapshot): { key: string; value: string | number | boolean | null } | null {
  const receipt = evidence.receipts[0];
  if (!receipt) return null;
  const entry = Object.entries(receipt.outputs)[0];
  return entry ? { key: entry[0], value: entry[1] } : null;
}

function trustTone(score: number): string {
  if (score >= 85) return "text-emerald-300";
  if (score >= 65) return "text-cyan-300";
  if (score >= 35) return "text-[hsl(38,100%,60%)]";
  return "text-red-300";
}

export default function HeroIntelligenceBar({ view, symbol, compact = false }: Props) {
  const config = getHeroIntelligenceConfig(view);
  const [evidence, setEvidence] = useState<EvidenceSnapshot>(() => getEvidenceSnapshot());
  const [scenario, setScenario] = useState<TerminalScenario | null>(() => getActiveScenario());
  const [timeContext, setTimeContext] = useState<TerminalTimeContext>(() => loadTerminalTimeContext());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => subscribeEvidence(setEvidence), []);
  useEffect(() => subscribeScenarioUniverse((_scenarios, active) => setScenario(active)), []);
  useEffect(() => subscribeTerminalTimeContext(setTimeContext), []);
  useEffect(() => setExpanded(false), [view, symbol]);

  useEffect(() => {
    if (!config) return;
    publishScenarioContext(view, symbol, scenario);
  }, [config, scenario, symbol, view]);

  useEffect(() => {
    if (!config || (!evidence.provenance.length && !evidence.receipts.length)) return;
    publishHeroEvidenceObjects({ view, symbol, evidence, scenario, timeContext });
  }, [config, evidence, scenario, symbol, timeContext, view]);

  const metric = useMemo(() => latestMetric(evidence), [evidence]);
  const trust = useMemo(() => buildTrustLedger(evidence), [evidence]);
  if (!config) return null;

  const inspect = () => {
    openTerminalInspector({
      view,
      symbol,
      label: metric?.key ?? `${config.label} CONTEXT`,
      value: metric?.value,
      metricKey: metric?.key,
      sourceHint: evidence.receipts[0]?.label ?? evidence.provenance[0]?.source,
    });
  };

  const evidenceCount = evidence.provenance.length + evidence.receipts.length;

  if (compact && !expanded) {
    return (
      <div className="lios-v5-hero-bar lios-v5-hero-bar-compact flex h-7 min-h-7 shrink-0 items-center gap-1.5 overflow-hidden border-b border-border/55 px-2" data-hero-view={view} data-hero-compact="true">
        <div className="flex min-w-0 items-center gap-1.5 text-[7px] font-bold tracking-[.11em] text-[hsl(38,100%,60%)]">
          <Sparkles className="h-3 w-3 shrink-0" />
          <span className="truncate">{config.label}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button onClick={() => openTerminalUxSurface("trust-ledger")} className={`lios-v5-hero-action ${trustTone(trust.coverageScore)}`} title={`Trust coverage ${trust.coverageScore}/100 · ${trust.grade}`}><ShieldCheck className="h-3 w-3" /> {trust.coverageScore}</button>
          <button onClick={() => openTerminalUxSurface("evidence")} className="lios-v5-hero-action" title="Open provenance and calculation receipts"><Database className="h-3 w-3" /> {evidenceCount}</button>
          <span className={`lios-v5-hero-status hidden sm:inline-flex ${timeContext.enabled ? "text-cyan-300" : ""}`} title={timeContext.enabled ? `As known on ${timeContext.asOfDate}` : "Latest available data"}><Clock3 className="h-3 w-3" /> {timeContext.enabled ? timeContext.asOfDate : "LATEST"}</span>
          <button type="button" onClick={() => setExpanded(true)} className="lios-v5-hero-action" title="Show intelligence actions" aria-label="Show intelligence actions" aria-expanded="false"><MoreHorizontal className="h-3 w-3" /></button>
        </div>
      </div>
    );
  }

  return (
    <div className="lios-v5-hero-bar flex min-h-8 shrink-0 items-center gap-2 overflow-x-auto border-b border-border/60 px-2 scrollbar-thin" data-hero-view={view} data-hero-compact={compact ? "expanded" : "false"}>
      <div className="flex shrink-0 items-center gap-1.5 text-[7px] font-bold tracking-[.13em] text-[hsl(38,100%,60%)]">
        <Sparkles className="h-3 w-3" /> {config.label}
      </div>
      <div className="h-4 w-px shrink-0 bg-border/60" />
      <div className="flex shrink-0 items-center gap-1">{config.lenses.slice(0, compact ? 3 : 6).map((lens) => (
        <span key={lens} className="border border-border/65 bg-black/20 px-1.5 py-0.5 text-[6.5px] font-bold tracking-wider text-muted-foreground">{lens.toUpperCase()}</span>
      ))}</div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button onClick={() => openTerminalUxSurface("cognitive-core")} className="lios-v5-hero-action" title="Open Cognitive Core"><Sparkles className="h-3 w-3" /> CORE</button>
        <button onClick={() => openTerminalUxSurface("object-workbench")} className="lios-v5-hero-action" title="Open reusable intelligence objects"><Boxes className="h-3 w-3" /> OBJECTS</button>
        <button onClick={() => openTerminalUxSurface("scenario-workbench")} className={`lios-v5-hero-action ${scenario ? "text-[hsl(38,100%,60%)]" : ""}`} title="Edit and explicitly propagate the active scenario"><GitBranch className="h-3 w-3" /> {scenario?.name ?? "BASE"}</button>
        <button onClick={() => openTerminalUxSurface("decision-center")} className="lios-v5-hero-action" title="Convert analysis into a monitored decision"><Target className="h-3 w-3" /> DECIDE</button>
        <button onClick={() => openTerminalUxSurface("graph-explorer")} className="lios-v5-hero-action" title="Explore cross-domain relationships"><Network className="h-3 w-3 text-cyan-300/80" /> GRAPH</button>
        <button onClick={() => openTerminalUxSurface("trust-ledger")} className={`lios-v5-hero-action ${trustTone(trust.coverageScore)}`} title={`Trust coverage ${trust.coverageScore}/100 · ${trust.grade}. Measures evidence/reproducibility coverage, not correctness.`}><ShieldCheck className="h-3 w-3" /> TRUST {trust.coverageScore}</button>
        <button onClick={() => openTerminalUxSurface("evidence")} className="lios-v5-hero-action" title="Open provenance and calculation receipts"><Database className="h-3 w-3 text-cyan-300/85" /> {evidenceCount}</button>
        <span className={`lios-v5-hero-status ${timeContext.enabled ? "text-cyan-300" : ""}`} title={timeContext.enabled ? `As known on ${timeContext.asOfDate}` : "Latest available data"}><Clock3 className="h-3 w-3" /> {timeContext.enabled ? timeContext.asOfDate : "LATEST"}</span>
        <button onClick={inspect} className="lios-v5-hero-action" title="Inspect current published metric/source"><ScanSearch className="h-3 w-3" /> INSPECT</button>
        {compact && <button type="button" onClick={() => setExpanded(false)} className="lios-v5-hero-action" title="Collapse intelligence actions" aria-label="Collapse intelligence actions" aria-expanded="true"><ChevronUp className="h-3 w-3" /></button>}
      </div>
    </div>
  );
}
