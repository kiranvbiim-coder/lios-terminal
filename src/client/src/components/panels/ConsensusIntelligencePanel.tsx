import { useTerminalArtifactState, useTerminalArtifactSymbol } from "@/lib/terminalArtifactState";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, BarChart3, BellRing, Database, ExternalLink,
  GitCompareArrows, Plus, RefreshCw, Save, ShieldCheck, Target,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ReceiptSummary, runAdvancedManual, type AdvancedReceipt } from "./advancedMacroForecastResearch";

type Metric = "revenue" | "ebitda" | "ebit" | "eps" | "free_cash_flow" | "gross_margin" | "operating_margin" | "net_margin" | "capex" | "price_target" | "recommendation_score";
type View = "overview" | "revisions" | "benchmarks" | "blind_spots" | "divergence" | "input";

interface Snapshot {
  id: number; metric: Metric; fiscalPeriod: string; unit: string; currency: string | null;
  mean: number | null; median: number | null; high: number | null; low: number | null;
  contributorCount: number | null; estimateAsOf: string; sourceType: string;
  publishedAt: string | null; retrievedAt: string; availableAt: string;
  provider: string; sourceName: string; sourceUrl: string | null; snapshotHash: string;
}

interface RevisionPoint {
  snapshotId: number; estimateAsOf: string; median: number | null; mean: number | null;
  medianChange: number | null; medianChangePct: number | null; dispersionPct: number | null; breadth: number | null;
}

interface Comparison {
  benchmarkId: number; benchmarkKind: string; benchmarkValue: number; consensusSnapshotId: number;
  consensusMedian: number; difference: number; differencePct: number | null;
  evidenceIds: number[]; assumptionRefs: Array<{ label: string; value?: number | string | null; evidenceId?: number }>;
}

interface Signal {
  signalType: string; severity: "watch" | "material"; valuePct: number; thresholdPct: number;
  message: string; snapshotId: number; benchmarkId?: number;
}

interface Benchmark {
  id: number; metric: Metric; fiscalPeriod: string; benchmarkKind: string; value: number | null; low: number | null;
  high: number | null; unit: string; currency: string | null; effectiveAt: string; provider: string; sourceName: string;
  sourceUrl: string | null; modelName: string | null; modelVersion: string | null; evidenceIds: number[];
}

interface Analysis {
  symbol: string;
  coverage: { state: "available" | "unavailable"; snapshotCount: number; seriesCount: number; reason?: string };
  series: Array<{ key: string; metric: Metric; fiscalPeriod: string; latest: Snapshot; revisions: RevisionPoint[]; revisionAccelerationPct: number | null; comparisons: Comparison[]; signals: Signal[] }>;
  benchmarks: Benchmark[];
  alertRules: Array<{ id: number; metric: Metric | null; revisionThresholdPct: number; dispersionThresholdPct: number; divergenceThresholdPct: number }>;
}

interface ProviderResponse {
  providers: Array<{ id: string; label: string; status: "available" | "not_configured"; automatic: boolean; message: string }>;
}

interface Investigation { id: number; title: string; primarySymbol: string | null; organizationId: number | null }

const METRICS: Metric[] = ["revenue", "ebitda", "ebit", "eps", "free_cash_flow", "gross_margin", "operating_margin", "net_margin", "capex", "price_target", "recommendation_score"];
const VIEWS: View[] = ["overview", "revisions", "benchmarks", "blind_spots", "divergence", "input"];

function formatMetric(metric: string) { return metric.replaceAll("_", " ").toUpperCase(); }
function formatDate(value: string | null | undefined) { return value ? new Date(value).toLocaleDateString() : "Not dated"; }
function formatNumber(value: number | null | undefined, unit?: string, currency?: string | null) {
  if (value == null) return "Unavailable";
  const prefix = currency ? `${currency} ` : "";
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (Math.abs(value) >= 1e9) return `${prefix}${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${prefix}${(value / 1e6).toFixed(2)}M`;
  return `${prefix}${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

// Additive: research/consensus-divergence fed by this panel's own captured
// consensus ledger -- analystEstimates is the series of recorded median
// values across this metric/period's frozen snapshots (a real, immutable
// history), not a fabricated per-analyst breakdown. internalEstimate and
// marketPrice remain explicit analyst-supplied inputs.
function ConsensusDivergenceRunner({ series }: { series: Analysis["series"] }) {
  const [selectedKey, setSelectedKey] = useTerminalArtifactState("ConsensusDivergenceRunner.selectedKey", "");
  const [internalEstimate, setInternalEstimate] = useTerminalArtifactState("ConsensusDivergenceRunner.internalEstimate", "");
  const [marketPrice, setMarketPrice] = useTerminalArtifactState("ConsensusDivergenceRunner.marketPrice", "");
  const [result, setResult] = useState<(Record<string, unknown> & { receipt?: AdvancedReceipt }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const item = series.find((entry) => entry.key === selectedKey) ?? null;
  const analystEstimates = item ? item.revisions.map((revision) => revision.median).filter((value): value is number => value !== null) : [];
  const run = async () => {
    if (!item) { setError("Select a metric/period from the captured consensus ledger."); return; }
    if (analystEstimates.length < 2) { setError("This metric/period has fewer than two recorded median snapshots in the ledger."); return; }
    const internal = Number(internalEstimate);
    if (!Number.isFinite(internal)) { setError("Provide a finite internal estimate."); return; }
    const marketValue = marketPrice.trim() === "" ? undefined : Number(marketPrice);
    if (marketValue !== undefined && !Number.isFinite(marketValue)) { setError("Market price must be finite, or left blank."); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      setResult(await runAdvancedManual("research", "consensus-divergence", { analystEstimates, internalEstimate: internal, ...(marketValue !== undefined ? { marketPrice: marketValue } : {}) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Consensus divergence unavailable."); }
    finally { setLoading(false); }
  };
  return <section className="p-4 space-y-3 border-b border-border">
    <div className="flex items-center gap-2"><GitCompareArrows className="w-3.5 h-3.5 text-amber-300" /><span className="font-terminal text-[9px]">CONSENSUS DIVERGENCE / EXPECTATION GAP</span></div>
    <div className="font-mono text-[8px] text-muted-foreground">analystEstimates is fed from this metric/period's captured consensus ledger — the recorded median at each frozen revision snapshot.</div>
    <select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} className="h-8 bg-black border border-border px-2 font-terminal text-[8px]">
      <option value="">SELECT METRIC / PERIOD</option>
      {series.map((entry) => <option key={entry.key} value={entry.key}>{formatMetric(entry.metric)} / {entry.fiscalPeriod} ({entry.revisions.length} snapshots)</option>)}
    </select>
    {item && <div className="font-mono text-[8px] text-muted-foreground">{analystEstimates.length} recorded medians bound: {analystEstimates.map((value) => value.toFixed(2)).join(", ") || "none"}</div>}
    <div className="grid grid-cols-2 gap-2 max-w-md">
      <input value={internalEstimate} onChange={(event) => setInternalEstimate(event.target.value)} placeholder="INTERNAL ESTIMATE" type="number" step="any" className="h-8 bg-black border border-border px-2 font-mono text-[8px]" />
      <input value={marketPrice} onChange={(event) => setMarketPrice(event.target.value)} placeholder="MARKET PRICE (OPTIONAL)" type="number" step="any" className="h-8 bg-black border border-border px-2 font-mono text-[8px]" />
    </div>
    <button disabled={loading || !item || !internalEstimate.trim()} onClick={() => void run()} className="h-9 px-4 border border-amber-400/40 text-amber-300 font-terminal text-[9px] uppercase disabled:opacity-40">{loading ? "RUNNING…" : "RUN CONSENSUS DIVERGENCE"}</button>
    {error && <div role="alert" className="font-mono text-[8px] text-red-300">{error}</div>}
    {result && <><pre className="max-h-56 overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-[7px] text-muted-foreground">{JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key]) => key !== "receipt")), null, 2)}</pre><ReceiptSummary receipt={result.receipt} /></>}
  </section>;
}
function signedPct(value: number | null | undefined) { return value == null ? "Unavailable" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }

export default function ConsensusIntelligencePanel({ symbol, role }: { symbol: string; role: string }) {
  const canAuthor = role === "internal_admin" || role === "internal_analyst";
  const [activeSymbol, setActiveSymbol] = useTerminalArtifactSymbol((symbol || "AAPL").toUpperCase());
  const [symbolInput, setSymbolInput] = useTerminalArtifactState("ConsensusIntelligencePanel.symbolInput", activeSymbol);
  const [view, setView] = useTerminalArtifactState<View>("ConsensusIntelligencePanel.view", "overview");
  const [message, setMessage] = useState("");
  const [metric, setMetric] = useTerminalArtifactState<Metric>("ConsensusIntelligencePanel.metric", "eps");
  const [fiscalPeriod, setFiscalPeriod] = useTerminalArtifactState("ConsensusIntelligencePanel.fiscalPeriod", "FY2027");
  const [unit, setUnit] = useTerminalArtifactState("ConsensusIntelligencePanel.unit", "per_share");
  const [currency, setCurrency] = useTerminalArtifactState("ConsensusIntelligencePanel.currency", "USD");
  const [estimateAsOf, setEstimateAsOf] = useTerminalArtifactState("ConsensusIntelligencePanel.estimateAsOf", new Date().toISOString().slice(0, 10));
  const [sourceType, setSourceType] = useTerminalArtifactState("ConsensusIntelligencePanel.sourceType", "user_supplied");
  const [provider, setProvider] = useTerminalArtifactState("ConsensusIntelligencePanel.provider", "User supplied");
  const [sourceName, setSourceName] = useTerminalArtifactState("ConsensusIntelligencePanel.sourceName", "Analyst-provided estimate set");
  const [sourceUrl, setSourceUrl] = useTerminalArtifactState("ConsensusIntelligencePanel.sourceUrl", "");
  const [observations, setObservations] = useTerminalArtifactState("ConsensusIntelligencePanel.observations", "");
  const [mean, setMean] = useTerminalArtifactState("ConsensusIntelligencePanel.mean", "");
  const [median, setMedian] = useTerminalArtifactState("ConsensusIntelligencePanel.median", "");
  const [high, setHigh] = useTerminalArtifactState("ConsensusIntelligencePanel.high", "");
  const [low, setLow] = useTerminalArtifactState("ConsensusIntelligencePanel.low", "");
  const [contributors, setContributors] = useTerminalArtifactState("ConsensusIntelligencePanel.contributors", "");
  const [upward, setUpward] = useTerminalArtifactState("ConsensusIntelligencePanel.upward", "");
  const [downward, setDownward] = useTerminalArtifactState("ConsensusIntelligencePanel.downward", "");
  const [unchanged, setUnchanged] = useTerminalArtifactState("ConsensusIntelligencePanel.unchanged", "");
  const [benchmarkKind, setBenchmarkKind] = useTerminalArtifactState("ConsensusIntelligencePanel.benchmarkKind", "company_guidance");
  const [benchmarkValue, setBenchmarkValue] = useTerminalArtifactState("ConsensusIntelligencePanel.benchmarkValue", "");
  const [benchmarkLow, setBenchmarkLow] = useTerminalArtifactState("ConsensusIntelligencePanel.benchmarkLow", "");
  const [benchmarkHigh, setBenchmarkHigh] = useTerminalArtifactState("ConsensusIntelligencePanel.benchmarkHigh", "");
  const [effectiveAt, setEffectiveAt] = useTerminalArtifactState("ConsensusIntelligencePanel.effectiveAt", new Date().toISOString().slice(0, 10));
  const [modelName, setModelName] = useTerminalArtifactState("ConsensusIntelligencePanel.modelName", "");
  const [modelVersion, setModelVersion] = useTerminalArtifactState("ConsensusIntelligencePanel.modelVersion", "");
  const [assumption, setAssumption] = useTerminalArtifactState("ConsensusIntelligencePanel.assumption", "");
  const [investigationId, setInvestigationId] = useTerminalArtifactState("ConsensusIntelligencePanel.investigationId", "");
  const [evidenceIds, setEvidenceIds] = useTerminalArtifactState("ConsensusIntelligencePanel.evidenceIds", "");

  useEffect(() => { if (symbol) { setActiveSymbol(symbol.toUpperCase()); setSymbolInput(symbol.toUpperCase()); } }, [symbol]);
  const query = `/api/consensus/analysis?symbol=${encodeURIComponent(activeSymbol)}`;
  const { data: analysis, isLoading, refetch } = useQuery<Analysis>({ queryKey: [query] });
  const { data: providers } = useQuery<ProviderResponse>({ queryKey: ["/api/consensus/providers"] });
  const { data: investigations = [] } = useQuery<Investigation[]>({ queryKey: ["/api/research/investigations"] });
  const relevantInvestigations = useMemo(() => investigations.filter((item) => !item.primarySymbol || item.primarySymbol.toUpperCase() === activeSymbol), [investigations, activeSymbol]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: [query] });
    await queryClient.invalidateQueries({ queryKey: ["/api/consensus/alerts"] });
  };
  const asNumber = (value: string) => value.trim() === "" ? null : Number(value);
  const selectedInvestigation = investigations.find((item) => item.id === Number(investigationId));

  const createSnapshot = useMutation({
    mutationFn: async () => {
      const parsedObservations = observations.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean).map(Number);
      const response = await apiRequest("POST", "/api/consensus/snapshots", {
        symbol: activeSymbol, organizationId: selectedInvestigation?.organizationId ?? null, investigationId: selectedInvestigation?.id ?? null,
        metric, fiscalPeriod, unit, currency: currency || null, estimateAsOf, sourceType, provider, sourceName, sourceUrl: sourceUrl || null,
        observations: parsedObservations.length ? parsedObservations : undefined,
        aggregate: parsedObservations.length ? undefined : { mean: asNumber(mean), median: asNumber(median), high: asNumber(high), low: asNumber(low), contributorCount: contributors ? Number(contributors) : null },
        upwardRevisionCount: upward ? Number(upward) : null, downwardRevisionCount: downward ? Number(downward) : null, unchangedRevisionCount: unchanged ? Number(unchanged) : null,
      });
      return response.json();
    },
    onSuccess: async () => { setMessage("Consensus snapshot recorded."); setObservations(""); setMean(""); setMedian(""); setHigh(""); setLow(""); await refresh(); setView("overview"); },
    onError: (error: Error) => setMessage(error.message),
  });

  const captureProvider = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/consensus/capture/${encodeURIComponent(activeSymbol)}`, {});
      return response.json() as Promise<{ createdCount: number; reusedCount: number }>;
    },
    onSuccess: async (result) => { setMessage(`Provider capture complete: ${result.createdCount} new / ${result.reusedCount} reused.`); await refresh(); setView("overview"); },
    onError: (error: Error) => setMessage(error.message),
  });

  const createBenchmark = useMutation({
    mutationFn: async () => {
      const ids = evidenceIds.split(/[\s,;]+/).map(Number).filter((value) => Number.isInteger(value) && value > 0);
      const response = await apiRequest("POST", "/api/consensus/benchmarks", {
        symbol: activeSymbol, organizationId: selectedInvestigation?.organizationId ?? null, investigationId: selectedInvestigation?.id ?? null,
        metric, fiscalPeriod, unit, currency: currency || null, benchmarkKind, value: asNumber(benchmarkValue), low: asNumber(benchmarkLow), high: asNumber(benchmarkHigh), effectiveAt,
        provider, sourceName, sourceUrl: sourceUrl || null, modelName: modelName || null, modelVersion: modelVersion || null,
        evidenceIds: ids, assumptionRefs: assumption ? [{ label: assumption }] : [],
      });
      return response.json();
    },
    onSuccess: async () => { setMessage("Benchmark recorded with provenance."); setBenchmarkValue(""); setBenchmarkLow(""); setBenchmarkHigh(""); await refresh(); setView("benchmarks"); },
    onError: (error: Error) => setMessage(error.message),
  });

  const createAlert = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/consensus/alerts", { symbol: activeSymbol, metric, revisionThresholdPct: 5, dispersionThresholdPct: 20, divergenceThresholdPct: 10 }),
    onSuccess: async () => { setMessage("Alert rule enabled for this metric."); await refresh(); },
    onError: (error: Error) => setMessage(error.message),
  });

  const signals = analysis?.series.flatMap((item) => item.signals.map((signal) => ({ ...signal, metric: item.metric, fiscalPeriod: item.fiscalPeriod }))) ?? [];
  const comparisons = analysis?.series.flatMap((item) => item.comparisons.map((comparison) => ({ ...comparison, metric: item.metric, fiscalPeriod: item.fiscalPeriod }))) ?? [];

  return <div className="h-full min-h-0 flex flex-col bg-[#050505]">
    <header className="shrink-0 border-b border-border bg-[#070707] px-4 py-3 flex flex-wrap items-center gap-3">
      <Target className="w-4 h-4 text-amber-300" />
      <div><div className="font-terminal text-[10px] tracking-widest">CONSENSUS & VARIANT PERCEPTION</div><div className="font-terminal text-[7px] text-muted-foreground mt-0.5">EXPECTATIONS, REVISIONS, GUIDANCE, SURPRISE, AND MODEL DIVERGENCE</div></div>
      <form onSubmit={(event) => { event.preventDefault(); setActiveSymbol(symbolInput.trim().toUpperCase()); }} className="ml-auto flex items-center gap-1">
        <input value={symbolInput} onChange={(event) => setSymbolInput(event.target.value)} maxLength={30} aria-label="Symbol" className="h-8 w-28 bg-black border border-border px-2 font-mono text-[10px] uppercase outline-none focus:border-amber-400/50" />
        <button title="Load symbol" className="w-8 h-8 border border-amber-400/40 text-amber-300 flex items-center justify-center"><RefreshCw className="w-3.5 h-3.5" /></button>
      </form>
      {canAuthor && <button onClick={() => captureProvider.mutate()} disabled={captureProvider.isPending} title="Capture the current provider aggregate into the immutable consensus ledger" className="h-8 border border-amber-400/40 px-3 font-terminal text-[7px] text-amber-300 disabled:opacity-40"><Database className="inline w-3.5 h-3.5 mr-2" />{captureProvider.isPending ? "CAPTURING" : "CAPTURE LIVE"}</button>}
    </header>

    <div className="shrink-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)] border-b border-border">
      <div className="p-3 flex flex-wrap items-center gap-2">
        <span className={`px-2 py-1 border font-terminal text-[8px] uppercase ${analysis?.coverage.state === "available" ? "border-emerald-400/40 text-emerald-300" : "border-amber-400/40 text-amber-300"}`}>{analysis?.coverage.state ?? "loading"}</span>
        <span className="font-terminal text-[9px]">{activeSymbol}</span>
        <span className="font-mono text-[8px] text-muted-foreground">{analysis?.coverage.snapshotCount ?? 0} snapshots / {analysis?.coverage.seriesCount ?? 0} series</span>
        {analysis?.coverage.reason && <span className="w-full text-[10px] text-muted-foreground">{analysis.coverage.reason}</span>}
      </div>
      <div className="border-t lg:border-t-0 lg:border-l border-border p-2 flex flex-wrap gap-1 items-center">
        {providers?.providers.map((item) => <span key={item.id} title={item.message} className={`px-1.5 py-1 border font-terminal text-[7px] uppercase ${item.status === "available" ? "border-emerald-400/30 text-emerald-300" : "border-border text-muted-foreground"}`}>{item.label} / {item.status.replace("_", " ")}</span>)}
      </div>
    </div>

    <nav className="h-10 shrink-0 px-2 border-b border-border flex items-stretch overflow-x-auto">
      {VIEWS.map((item) => <button key={item} onClick={() => setView(item)} className={`px-3 border-b-2 whitespace-nowrap font-terminal text-[8px] uppercase ${view === item ? "border-amber-400 text-amber-300" : "border-transparent text-muted-foreground"}`}>{item.replace("_", " ")}</button>)}
      {canAuthor && <button onClick={() => createAlert.mutate()} title="Create default alert rule" className="ml-auto shrink-0 w-9 flex items-center justify-center text-muted-foreground hover:text-amber-300"><BellRing className="w-3.5 h-3.5" /></button>}
    </nav>

    {message && <button onClick={() => setMessage("")} className="shrink-0 text-left px-4 py-2 border-b border-border font-terminal text-[8px] text-amber-300">{message}</button>}

    <main className="flex-1 min-h-0 overflow-y-auto">
      {isLoading ? <div className="p-6 font-terminal text-[9px] text-muted-foreground">Loading consensus ledger...</div> : null}

      {view === "overview" && <section>
        {!analysis?.series.length ? <div className="p-8 max-w-2xl"><Database className="w-6 h-6 text-muted-foreground/50 mb-3" /><h2 className="font-terminal text-[11px]">NO CONSENSUS COVERAGE RECORDED</h2><p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">Unavailable coverage is not interpreted as zero. Add an attributed licensed aggregate or user-supplied observation set to begin a reproducible series.</p></div> : <>
          <div className="hidden xl:grid grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr_1fr_1.3fr] px-4 py-2 border-b border-border bg-[#080808] font-terminal text-[7px] text-muted-foreground"><span>METRIC / PERIOD</span><span>MEDIAN</span><span>MEAN</span><span>RANGE</span><span>CONTRIB.</span><span>AS OF</span><span>SOURCE</span></div>
          {analysis.series.map((item) => <article key={item.key} className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr_1fr_1fr_0.8fr_1fr_1.3fr] gap-2 xl:gap-0 px-4 py-3 border-b border-border/70 items-center">
            <div><div className="font-terminal text-[9px] text-amber-300">{formatMetric(item.metric)}</div><div className="font-mono text-[8px] text-muted-foreground mt-1">{item.fiscalPeriod}</div></div>
            <div className="font-mono text-[10px]">{formatNumber(item.latest.median, item.latest.unit, item.latest.currency)}</div>
            <div className="font-mono text-[9px] text-muted-foreground">{formatNumber(item.latest.mean, item.latest.unit, item.latest.currency)}</div>
            <div className="font-mono text-[8px] text-muted-foreground">{formatNumber(item.latest.low, item.latest.unit, item.latest.currency)} - {formatNumber(item.latest.high, item.latest.unit, item.latest.currency)}</div>
            <div className="font-mono text-[9px]">{item.latest.contributorCount ?? "N/A"}</div>
            <div className="font-mono text-[8px] text-muted-foreground">{formatDate(item.latest.estimateAsOf)}</div>
            <div className="min-w-0"><div className="font-terminal text-[8px] truncate">{item.latest.sourceName}</div><div className="font-mono text-[7px] text-muted-foreground truncate">{item.latest.provider} / AVAILABLE {formatDate(item.latest.availableAt)} / {item.latest.snapshotHash.slice(0, 10)}</div></div>
          </article>)}
        </>}
      </section>}

      {view === "revisions" && <section>
        {!analysis?.series.length ? <div className="p-8 font-terminal text-[9px] text-muted-foreground">No revision series is available.</div> : analysis.series.map((item) => <article key={item.key} className="border-b border-border">
          <div className="px-4 py-3 flex flex-wrap items-center gap-3"><Activity className="w-3.5 h-3.5 text-amber-300" /><span className="font-terminal text-[9px]">{formatMetric(item.metric)} / {item.fiscalPeriod}</span><span className="ml-auto font-mono text-[8px] text-muted-foreground">Acceleration {signedPct(item.revisionAccelerationPct)}</span></div>
          <div className="overflow-x-auto"><div className="min-w-[720px]">
            <div className="grid grid-cols-7 px-4 py-1.5 bg-black/40 font-terminal text-[7px] text-muted-foreground"><span>AS OF</span><span>MEDIAN</span><span>MEAN</span><span>CHANGE</span><span>MOMENTUM</span><span>DISPERSION</span><span>BREADTH</span></div>
            {item.revisions.map((point) => <div key={point.snapshotId} className="grid grid-cols-7 px-4 py-2 border-t border-border/60 font-mono text-[8px]"><span>{formatDate(point.estimateAsOf)}</span><span>{formatNumber(point.median)}</span><span>{formatNumber(point.mean)}</span><span>{formatNumber(point.medianChange)}</span><span className={(point.medianChangePct ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}>{signedPct(point.medianChangePct)}</span><span>{signedPct(point.dispersionPct)}</span><span>{point.breadth == null ? "Unavailable" : point.breadth.toFixed(2)}</span></div>)}
          </div></div>
        </article>)}
      </section>}

      {view === "benchmarks" && <section>
        {comparisons.length === 0 ? <div className="p-8 font-terminal text-[9px] text-muted-foreground">No period-aligned guidance, actual, or Limuria-model comparison is available.</div> : comparisons.map((item) => <article key={`${item.benchmarkId}-${item.consensusSnapshotId}`} className="p-4 border-b border-border/70 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr_1fr_1fr] gap-3">
          <div><div className="font-terminal text-[8px] text-amber-300">{formatMetric(item.benchmarkKind)}</div><div className="mt-1 font-terminal text-[9px]">{formatMetric(item.metric)} / {item.fiscalPeriod}</div></div>
          <div><div className="font-terminal text-[7px] text-muted-foreground">CONSENSUS</div><div className="font-mono text-[10px] mt-1">{formatNumber(item.consensusMedian)}</div></div>
          <div><div className="font-terminal text-[7px] text-muted-foreground">BENCHMARK</div><div className="font-mono text-[10px] mt-1">{formatNumber(item.benchmarkValue)}</div></div>
          <div><div className="font-terminal text-[7px] text-muted-foreground">DIVERGENCE</div><div className={`font-mono text-[10px] mt-1 ${(item.differencePct ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}>{signedPct(item.differencePct)}</div><div className="font-terminal text-[7px] text-muted-foreground mt-1">{item.evidenceIds.length} evidence / {item.assumptionRefs.length} assumptions</div></div>
        </article>)}
        {analysis?.benchmarks.map((item) => <div key={item.id} className="px-4 py-2 border-b border-border/60 flex flex-wrap items-center gap-3 font-terminal text-[8px] text-muted-foreground"><span>#{item.id}</span><span>{formatMetric(item.benchmarkKind)}</span><span>{formatMetric(item.metric)} / {item.fiscalPeriod}</span><span>{formatDate(item.effectiveAt)}</span><span>{item.sourceName}</span>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-amber-300 flex items-center gap-1">Source <ExternalLink className="w-3 h-3" /></a>}</div>)}
      </section>}

      {view === "blind_spots" && <section>
        {signals.length === 0 ? <div className="p-8 max-w-2xl"><ShieldCheck className="w-6 h-6 text-emerald-300 mb-3" /><h2 className="font-terminal text-[11px]">NO THRESHOLD BREACHES</h2><p className="mt-2 text-[11px] text-muted-foreground">This is a deterministic result over available data, not a claim that no blind spot exists. Missing series remain unavailable.</p></div> : signals.map((item, index) => <article key={`${item.signalType}-${item.snapshotId}-${index}`} className="p-4 border-b border-border/70 grid grid-cols-[28px_minmax(0,1fr)_auto] gap-3 items-start">
          <div className={`w-7 h-7 border flex items-center justify-center ${item.severity === "material" ? "border-red-400/50 text-red-300" : "border-amber-400/50 text-amber-300"}`}><AlertTriangle className="w-3.5 h-3.5" /></div>
          <div><div className="font-terminal text-[8px] uppercase text-amber-300">{formatMetric(item.signalType)} / {formatMetric(item.metric)} / {item.fiscalPeriod}</div><p className="mt-1 text-[11px]">{item.message}</p></div>
          <span className={`px-2 py-1 border font-terminal text-[7px] uppercase ${item.severity === "material" ? "border-red-400/40 text-red-300" : "border-amber-400/40 text-amber-300"}`}>{item.severity}</span>
        </article>)}
      </section>}

      {view === "divergence" && <ConsensusDivergenceRunner series={analysis?.series ?? []} />}

      {view === "input" && <section className="grid grid-cols-1 2xl:grid-cols-2">
        {!canAuthor && <div className="2xl:col-span-2 p-4 border-b border-border font-terminal text-[9px] text-muted-foreground">Compliance review mode. Consensus records and thresholds are read-only.</div>}
        {canAuthor && <form onSubmit={(event) => { event.preventDefault(); createSnapshot.mutate(); }} className="p-4 border-b 2xl:border-r border-border space-y-3">
          <div className="flex items-center gap-2"><BarChart3 className="w-3.5 h-3.5 text-amber-300" /><span className="font-terminal text-[9px]">ADD CONSENSUS SNAPSHOT</span></div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <select value={metric} onChange={(event) => setMetric(event.target.value as Metric)} className="h-8 bg-black border border-border px-2 font-terminal text-[8px] uppercase">{METRICS.map((item) => <option key={item} value={item}>{formatMetric(item)}</option>)}</select>
            <input value={fiscalPeriod} onChange={(event) => setFiscalPeriod(event.target.value)} required placeholder="FISCAL PERIOD" className="h-8 bg-black border border-border px-2 font-terminal text-[8px]" />
            <input value={unit} onChange={(event) => setUnit(event.target.value)} required placeholder="UNIT" className="h-8 bg-black border border-border px-2 font-terminal text-[8px]" />
            <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} placeholder="CURRENCY" className="h-8 bg-black border border-border px-2 font-terminal text-[8px]" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2"><input type="date" value={estimateAsOf} onChange={(event) => setEstimateAsOf(event.target.value)} required className="h-8 bg-black border border-border px-2 font-mono text-[8px]" /><select value={sourceType} onChange={(event) => setSourceType(event.target.value)} className="h-8 bg-black border border-border px-2 font-terminal text-[8px]"><option value="user_supplied">USER SUPPLIED</option><option value="manual">MANUAL AGGREGATE</option><option value="licensed_provider">LICENSED PROVIDER</option></select><input value={provider} onChange={(event) => setProvider(event.target.value)} required placeholder="PROVIDER" className="h-8 bg-black border border-border px-2 font-terminal text-[8px]" /><input value={sourceName} onChange={(event) => setSourceName(event.target.value)} required placeholder="SOURCE NAME" className="h-8 bg-black border border-border px-2 font-terminal text-[8px]" /></div>
          <textarea value={observations} onChange={(event) => setObservations(event.target.value)} placeholder="USER-SUPPLIED OBSERVATIONS, COMMA SEPARATED. LEAVE BLANK FOR AN ATTRIBUTED AGGREGATE." className="min-h-20 w-full resize-y bg-black border border-border p-2 font-mono text-[9px] outline-none focus:border-amber-400/50" />
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">{[[mean,setMean,"MEAN"],[median,setMedian,"MEDIAN"],[low,setLow,"LOW"],[high,setHigh,"HIGH"],[contributors,setContributors,"CONTRIBUTORS"]].map(([value,setter,label]) => <input key={label as string} type="number" step="any" min={label === "CONTRIBUTORS" ? 0 : undefined} value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} placeholder={label as string} className="h-8 bg-black border border-border px-2 font-mono text-[8px]" />)}</div>
          <div className="grid grid-cols-3 gap-2">{[[upward,setUpward,"UP REVISIONS"],[downward,setDownward,"DOWN REVISIONS"],[unchanged,setUnchanged,"UNCHANGED"]].map(([value,setter,label]) => <input key={label as string} type="number" min="0" value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} placeholder={label as string} className="h-8 bg-black border border-border px-2 font-mono text-[8px]" />)}</div>
          <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="SOURCE URL (WHEN AVAILABLE)" className="h-8 w-full bg-black border border-border px-2 font-terminal text-[8px]" />
          <select value={investigationId} onChange={(event) => setInvestigationId(event.target.value)} className="h-8 w-full bg-black border border-border px-2 font-terminal text-[8px]"><option value="">UNSCOPED / NO INVESTIGATION</option>{relevantInvestigations.map((item) => <option key={item.id} value={item.id}>#{item.id} {item.title}</option>)}</select>
          <button disabled={createSnapshot.isPending} className="h-9 w-full bg-amber-400 text-black font-terminal text-[9px] font-bold uppercase disabled:opacity-40 flex items-center justify-center gap-2"><Save className="w-3.5 h-3.5" /> Freeze snapshot</button>
        </form>}

        {canAuthor && <form onSubmit={(event) => { event.preventDefault(); createBenchmark.mutate(); }} className="p-4 border-b border-border space-y-3">
          <div className="flex items-center gap-2"><GitCompareArrows className="w-3.5 h-3.5 text-amber-300" /><span className="font-terminal text-[9px]">ADD GUIDANCE, ACTUAL, OR LIMURIA MODEL</span></div>
          <div className="grid grid-cols-2 gap-2"><select value={benchmarkKind} onChange={(event) => setBenchmarkKind(event.target.value)} className="h-8 bg-black border border-border px-2 font-terminal text-[8px]"><option value="company_guidance">COMPANY GUIDANCE</option><option value="reported_actual">REPORTED ACTUAL</option><option value="limuria_model">LIMURIA MODEL</option></select><input type="date" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required className="h-8 bg-black border border-border px-2 font-mono text-[8px]" /></div>
          <div className="grid grid-cols-3 gap-2">{[[benchmarkValue,setBenchmarkValue,"POINT VALUE"],[benchmarkLow,setBenchmarkLow,"LOW"],[benchmarkHigh,setBenchmarkHigh,"HIGH"]].map(([value,setter,label]) => <input key={label as string} type="number" step="any" value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} placeholder={label as string} className="h-8 bg-black border border-border px-2 font-mono text-[8px]" />)}</div>
          {benchmarkKind === "limuria_model" && <div className="grid grid-cols-2 gap-2"><input value={modelName} onChange={(event) => setModelName(event.target.value)} required placeholder="MODEL NAME" className="h-8 bg-black border border-border px-2 font-terminal text-[8px]" /><input value={modelVersion} onChange={(event) => setModelVersion(event.target.value)} required placeholder="MODEL VERSION" className="h-8 bg-black border border-border px-2 font-terminal text-[8px]" /><input value={assumption} onChange={(event) => setAssumption(event.target.value)} placeholder="KEY ASSUMPTION REFERENCE" className="col-span-2 h-8 bg-black border border-border px-2 font-terminal text-[8px]" /></div>}
          <input value={evidenceIds} onChange={(event) => setEvidenceIds(event.target.value)} placeholder="LINKED EVIDENCE IDS, COMMA SEPARATED" className="h-8 w-full bg-black border border-border px-2 font-terminal text-[8px]" />
          <button disabled={createBenchmark.isPending} className="h-9 w-full border border-amber-400/40 text-amber-300 font-terminal text-[9px] uppercase disabled:opacity-40 flex items-center justify-center gap-2"><Plus className="w-3.5 h-3.5" /> Record benchmark</button>
        </form>}
      </section>}
    </main>
  </div>;
}
