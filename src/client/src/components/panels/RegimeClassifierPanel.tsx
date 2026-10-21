import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useQuotes, useMarketSentiment, useNews } from "@/lib/useFinance";
import { Cpu, RefreshCw, Plus, X, Sigma } from "lucide-react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import type { ViewMode } from "@/lib/terminalTypes";
import type { OHLCVSeries } from "@/lib/finance";
import { fitGaussianHMM } from "@/lib/quantModels";
import { assertWeights, parseNumberList, runAdvancedPortfolioRisk } from "@/lib/advancedPortfolioRisk";
import { AdvancedPortfolioRiskReceipt } from "@/lib/advancedPortfolioRiskReceipt";
import { StructuredJsonEditor, applySchemaDefaults, type JsonFieldSchema } from "@/components/ui/StructuredJsonEditor";
import { ReceiptSummary, runAdvancedManual, type AdvancedReceipt } from "./advancedMacroForecastResearch";
interface Props { onNav: (v: ViewMode) => void; onSymbol: (s: string) => void; }
type RegimeBlendResult = { weights: Record<string, number> };

interface RegimeAsset { label: string; sym: string; riskOn: boolean; }

// These 7 directly drive the regime score formula below by name (sp500, tlt,
// gold, ...) -- they aren't removable, since the formula has no generic way
// to fold an arbitrary asset into "goldilocks"/"stagflation"/etc. scoring.
const CORE_ASSETS: RegimeAsset[] = [
  { label: "US EQUITIES",    sym: "^GSPC",    riskOn: true  },
  { label: "US BONDS",       sym: "TLT",      riskOn: false },
  { label: "GOLD",           sym: "GC=F",     riskOn: false },
  { label: "USD INDEX",      sym: "DX-Y.NYB", riskOn: false },
  { label: "OIL",            sym: "CL=F",     riskOn: true  },
  { label: "BTC",            sym: "BTC-USD",  riskOn: true  },
  { label: "VIX",            sym: "^VIX",     riskOn: false },
];
// Purely contextual watchlist entries shown alongside the core signals --
// these don't feed the score, so they're freely editable.
const DEFAULT_WATCHLIST: RegimeAsset[] = [
  { label: "GLOBAL EQ",   sym: "ACWI", riskOn: true },
  { label: "EM EQUITIES", sym: "EEM",  riskOn: true },
];
const MAX_WATCHLIST = 10;

const REGIMES = [
  { id: "goldilocks",    label: "🟢 GOLDILOCKS",      color: "hsl(142,71%,45%)", desc: "Strong growth, low inflation. Best for equities and risk assets." },
  { id: "reflation",     label: "🟡 REFLATION",       color: "hsl(38,95%,55%)",  desc: "Rising growth & inflation. Commodities, EM, value stocks outperform." },
  { id: "stagflation",   label: "🔴 STAGFLATION",     color: "hsl(0,80%,55%)",   desc: "Rising inflation, weak growth. Gold, commodities, defensive equities." },
  { id: "deflation",     label: "⚫ DEFLATION",       color: "hsl(220,60%,55%)", desc: "Falling prices, weak demand. Bonds, USD, cash outperform." },
  { id: "riskoff",       label: "🟠 RISK-OFF",        color: "hsl(20,90%,55%)",  desc: "Fear dominates. Flight to quality: bonds, gold, USD." },
  { id: "riskOn",        label: "🔵 RISK-ON",         color: "hsl(200,80%,55%)", desc: "Greed dominates. Equities, crypto, EM, small cap surge." },
];

// Additive: forecasting/regime-conditioned wired directly from this panel's
// own fitted Gaussian HMM state probabilities (below) -- the analyst only
// has to supply one forecast path per fitted state, not the probabilities
// themselves. Kept separate from the portfolio regime-blend workflow above,
// which owns portfolio allocation blending, not raw forecast blending.
const REGIME_FORECASTS_SCHEMA: JsonFieldSchema[] = [
  {
    kind: "numberMatrix",
    key: "regimeForecasts",
    label: "REGIME FORECAST PATHS (ONE ROW PER FITTED HMM STATE)",
    default: [[1.0, 1.05], [0.98, 0.9]],
    help: "One manual forecast path per fitted HMM state, in state order.",
  },
];
type HmmFit = { result: { currentStateProbs: number[] }; labels: string[] };
function RegimeConditionedForecastRunner({ hmm }: { hmm: HmmFit | null }) {
  const [regimeForecastsState, setRegimeForecastsState] = useTerminalArtifactState<Record<string, unknown>>("RegimeConditionedForecastRunner.regimeForecastsState", () => applySchemaDefaults(REGIME_FORECASTS_SCHEMA, {}));
  const [result, setResult] = useState<(Record<string, unknown> & { receipt?: AdvancedReceipt }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    if (!hmm) { setError("Fit the statistical regime model above first."); return; }
    const regimeForecasts = regimeForecastsState.regimeForecasts;
    if (!Array.isArray(regimeForecasts) || regimeForecasts.length !== hmm.result.currentStateProbs.length || regimeForecasts.some((path) => !Array.isArray(path) || path.some((v) => typeof v !== "number" || !Number.isFinite(v)))) {
      setError(`Provide exactly ${hmm.result.currentStateProbs.length} finite forecast paths, one per fitted HMM state, in state order (${hmm.labels.join(", ")}).`);
      return;
    }
    setLoading(true); setError(null); setResult(null);
    try {
      setResult(await runAdvancedManual("forecasting", "regime-conditioned", {
        regimeProbabilities: hmm.result.currentStateProbs,
        regimeForecasts,
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Regime-conditioned forecast unavailable."); }
    finally { setLoading(false); }
  };
  return <div className="border border-border bg-[#080808] p-3 space-y-2">
    <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">REGIME-CONDITIONED FORECAST</div>
    <div className="font-terminal text-[7px] leading-relaxed text-muted-foreground">
      {hmm ? `Reuses the fitted HMM state probabilities above: ${hmm.labels.map((label, i) => `${label} ${(hmm.result.currentStateProbs[i] * 100).toFixed(1)}%`).join(" / ")}. Enter one manual forecast path per state, in that order.` : "Fit the statistical regime model above to populate real state probabilities here."}
    </div>
    <StructuredJsonEditor schema={REGIME_FORECASTS_SCHEMA} value={regimeForecastsState} onChange={setRegimeForecastsState} />
    <button disabled={!hmm || loading} onClick={() => void run()} className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40">{loading ? "RUNNING…" : "RUN REGIME-CONDITIONED FORECAST"}</button>
    {error && <div className="font-terminal text-[7px] text-red-300">{error}</div>}
    {result && <><pre className="max-h-36 overflow-auto whitespace-pre-wrap border border-border p-2 font-mono text-[7px] text-muted-foreground">{JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key]) => key !== "receipt")), null, 2)}</pre><ReceiptSummary receipt={result.receipt} /></>}
  </div>;
}

const REGIME_BLEND_WEIGHTS_SCHEMA: JsonFieldSchema[] = [
  {
    kind: "numberMatrix",
    key: "regimeWeights",
    label: "REGIME WEIGHTS (ONE ROW PER REGIME PROBABILITY, ONE COLUMN PER ASSET)",
    default: [[0.7, 0.25, 0.05], [0.3, 0.6, 0.1], [0.15, 0.35, 0.5]],
    help: "Each row is a full allocation across the asset list for that regime.",
  },
];
export default function RegimeClassifierPanel({ onSymbol, onNav }: Props) {
  const [blendAssets, setBlendAssets] = useTerminalArtifactState("RegimeClassifierPanel.blendAssets", "");
  const [blendProbabilities, setBlendProbabilities] = useTerminalArtifactState("RegimeClassifierPanel.blendProbabilities", "");
  const [blendWeightsState, setBlendWeightsState] = useTerminalArtifactState<Record<string, unknown>>("RegimeClassifierPanel.blendWeightsState", () => applySchemaDefaults(REGIME_BLEND_WEIGHTS_SCHEMA, {}));
  const regimeBlend = useMutation({
    mutationFn: async () => {
      const assets = blendAssets.split(",").map((asset) => asset.trim().toUpperCase()).filter(Boolean);
      const probabilities = parseNumberList(blendProbabilities, "Regime probabilities");
      const weights = (blendWeightsState.regimeWeights ?? []) as number[][];
      if (!assets.length || new Set(assets).size !== assets.length || probabilities.some((value) => value < 0) || weights.length !== probabilities.length) throw new Error("Provide unique assets, non-negative probabilities, and one regime-weight vector per probability.");
      for (const weight of weights) {
        if (weight.some((value) => value < 0)) throw new Error("Regime weights must be non-negative.");
        assertWeights(weight, assets.length, "Each regime weight vector");
      }
      return runAdvancedPortfolioRisk<RegimeBlendResult>("portfolio/regime-blend", { assets, regimeProbabilities: probabilities, regimeWeights: weights });
    },
  });
  const [watchlist, setWatchlist] = useTerminalArtifactState<RegimeAsset[]>("RegimeClassifierPanel.watchlist", DEFAULT_WATCHLIST);
  const [watchInput, setWatchInput] = useTerminalArtifactState("RegimeClassifierPanel.watchInput", "");
  const ASSETS = useMemo(() => [...CORE_ASSETS, ...watchlist], [watchlist]);

  const addWatchAsset = () => {
    const t = watchInput.trim().toUpperCase();
    if (t && !ASSETS.some((a) => a.sym === t) && watchlist.length < MAX_WATCHLIST) {
      setWatchlist((prev) => [...prev, { label: t, sym: t, riskOn: true }]);
      setWatchInput("");
    }
  };
  const removeWatchAsset = (sym: string) => setWatchlist((prev) => prev.filter((a) => a.sym !== sym));

  const syms = ASSETS.map(a => a.sym);
  const { data: quotes = [] } = useQuotes(syms);
  const { data: sentiment }   = useMarketSentiment();
  const { data: news = [] }   = useNews();

  const qMap = useMemo(() => new Map(quotes.map(q => [q.symbol, q])), [quotes]);

  const sp500 = qMap.get("^GSPC");
  const tlt   = qMap.get("TLT");
  const gold  = qMap.get("GC=F");
  const vix   = qMap.get("^VIX");
  const btc   = qMap.get("BTC-USD");
  const dxy   = qMap.get("DX-Y.NYB");
  const oil   = qMap.get("CL=F");

  // Derive regime scores from cross-asset signals
  const signals = useMemo(() => {
    const eq  = sp500?.changePercent ?? 0;
    const bd  = tlt?.changePercent   ?? 0;
    const gd  = gold?.changePercent  ?? 0;
    const vx  = vix?.price           ?? 20;
    const bk  = btc?.changePercent   ?? 0;
    const dx  = dxy?.changePercent   ?? 0;
    const ol  = oil?.changePercent   ?? 0;
    const sent= sentiment?.score     ?? 50;

    const scores = {
      goldilocks:  Math.max(0, eq*3 + bk*0.5 - vx*0.5 + sent*0.3 - gd*0.5),
      reflation:   Math.max(0, ol*2 + gd*2 + eq*1 - bd*2),
      stagflation: Math.max(0, gd*2 + ol*2 - eq*2 + vx*0.5 - sent*0.3),
      deflation:   Math.max(0, bd*3 + dx*2 - eq*2 - ol*2 - gd*1),
      riskoff:     Math.max(0, vx*0.8 + gd*1.5 + bd*1.5 - eq*2 - bk*0.5),
      riskOn:      Math.max(0, eq*2 + bk*1.5 + ol*0.5 + sent*0.3 - vx*0.5),
    };

    // Normalize to percentages
    const total = Object.values(scores).reduce((s,v) => s+v, 0) || 1;
    return Object.fromEntries(Object.entries(scores).map(([k,v]) => [k, Math.round(v/total*100)]));
  }, [sp500, tlt, gold, vix, btc, dxy, oil, sentiment]);

  const dominant = Object.entries(signals).sort(([,a],[,b]) => b-a)[0];
  const dominantRegime = REGIMES.find(r => r.id === dominant[0]) ?? REGIMES[0];

  const radarData = REGIMES.map(r => ({ subject: r.label.split(" ").slice(1).join(" "), value: signals[r.id] ?? 0 }));

  // Asset matrix: how each performs in current regime
  const assetImpact = useMemo(() => {
    return ASSETS.map(a => {
      const q = qMap.get(a.sym);
      const chg = q?.changePercent ?? 0;
      const riskAlignment = dominant[0] === "riskOn" ? (a.riskOn ? 1 : -1) : dominant[0] === "riskoff" ? (!a.riskOn ? 1 : -1) : 0;
      return { ...a, chg, price: q?.price ?? 0, riskAlignment };
    });
  }, [qMap, dominant]);

  // ── Statistical regime model (HMM) ──────────────────────────────────────
  // A real fitted 2-state Gaussian Hidden Markov Model over S&P 500 daily
  // returns (Baum-Welch/EM, see quantModels.ts) -- distinct from the
  // hand-tuned score heuristic above. States aren't pre-labeled; the fitted
  // state with the higher mean/lower variance is interpreted as "calm" and
  // the other as "stressed" after fitting.
  const [hmmStates, setHmmStates] = useTerminalArtifactState<2 | 3>("RegimeClassifierPanel.hmmStates", 2);
  const { data: spxHistory, isLoading: hmmLoading } = useQuery<OHLCVSeries>({
    queryKey: ["/api/finance/ohlcv", "^GSPC", "2Y", "1d"],
    queryFn: async () => {
      const params = new URLSearchParams({ symbol: "^GSPC", range: "2Y", interval: "1d" });
      const res = await fetch(`/api/finance/ohlcv?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch S&P 500 history");
      return res.json();
    },
    staleTime: 300_000,
  });

  const hmm = useMemo(() => {
    const bars = spxHistory?.bars ?? [];
    if (bars.length < hmmStates * 10) return null;
    const returns: number[] = [];
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1].close;
      if (prev > 0) returns.push(((bars[i].close - prev) / prev) * 100);
    }
    if (returns.length < hmmStates * 10) return null;
    try {
      const result = fitGaussianHMM(returns, hmmStates, 150);
      // Rank states by a simple risk score (higher variance, lower mean = riskier)
      // so labels are consistent regardless of which numeric index EM assigned.
      const riskScore = result.means.map((m, s) => -m + Math.sqrt(result.variances[s]));
      const order = riskScore.map((_, i) => i).sort((a, b) => riskScore[a] - riskScore[b]);
      const labels = hmmStates === 2 ? ["CALM / BULLISH", "STRESSED / VOLATILE"] : ["CALM / BULLISH", "TRANSITIONAL", "STRESSED / VOLATILE"];
      const stateLabel = new Map(order.map((stateIdx, rank) => [stateIdx, labels[rank]]));
      const dates = bars.slice(-returns.length).map((b) => b.date);
      const chartData = result.stateProbs.map((probs, t) => {
        const row: Record<string, number | string> = { date: dates[t]?.slice(5) ?? "" };
        probs.forEach((p, s) => { row[stateLabel.get(s) ?? `State ${s}`] = Math.round(p * 1000) / 10; });
        return row;
      }).filter((_, i) => i % 3 === 0); // thin for chart readability
      return { result, stateLabel, chartData, labels: order.map((s) => stateLabel.get(s)!) };
    } catch {
      return null;
    }
  }, [spxHistory, hmmStates]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <Cpu className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">GLOBAL MACRO REGIME CLASSIFIER</span>
        <div className="flex items-center gap-1 ml-auto">
          <input
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && addWatchAsset()}
            disabled={watchlist.length >= MAX_WATCHLIST}
            placeholder="WATCH TICKER…"
            className="w-28 px-2 py-0.5 bg-[#0c0c0c] border border-border font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%] disabled:opacity-40"
          />
          <button
            onClick={addWatchAsset}
            disabled={watchlist.length >= MAX_WATCHLIST}
            className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"
          >
            <Plus className="w-2.5 h-2.5" /> ADD
          </button>
        </div>
        <span className="font-terminal text-[8px] text-muted-foreground tracking-widest">REGIME</span>
      </div>

      {/* Dominant regime banner */}
      <div className="shrink-0 px-5 py-3 border-b border-border" style={{ borderLeft: `4px solid ${dominantRegime.color}`, backgroundColor: `${dominantRegime.color}10` }}>
        <div className="font-terminal text-[8px] text-muted-foreground tracking-widest">CURRENT REGIME (LIMURIA AI CLASSIFICATION)</div>
        <div className="flex items-end gap-3 mt-1">
          <span className="font-terminal text-xl font-bold" style={{ color: dominantRegime.color }}>{dominantRegime.label}</span>
          <span className="font-terminal text-[9px] text-muted-foreground mb-0.5">Confidence: {dominant[1]}%</span>
        </div>
        <div className="font-terminal text-[9px] text-muted-foreground mt-1">{dominantRegime.desc}</div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Radar + scores */}
        <div className="flex-1 flex flex-col p-4 space-y-4 overflow-y-auto scrollbar-thin">
          {/* Radar chart */}
          <div>
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">REGIME PROBABILITY DISTRIBUTION</div>
            <div className="bg-[#080808] border border-border p-3 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke="hsl(0,0%,12%)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7, fill: "hsl(0,0%,55%)" }} />
                  <Radar name="Regime Score" dataKey="value" stroke="hsl(38,95%,55%)" fill="hsl(38,95%,55%)" fillOpacity={0.25} strokeWidth={1.5} dot={{ r: 2, fill: "hsl(38,95%,55%)" }} />
                  <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [`${v}%`, "Probability"]} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Score breakdown */}
          <div>
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">REGIME SCORE BREAKDOWN</div>
            <div className="space-y-1.5">
              {REGIMES.map(r => (
                <div key={r.id} className="flex items-center gap-3">
                  <span className="font-terminal text-[8px] w-28" style={{ color: r.color }}>{r.label.split(" ").slice(1).join(" ")}</span>
                  <div className="flex-1 h-2 bg-[#111]">
                    <div className="h-full transition-all duration-700" style={{ width: `${signals[r.id] ?? 0}%`, backgroundColor: r.color }} />
                  </div>
                  <span className="font-terminal text-[9px] tabular-nums w-8 text-right" style={{ color: r.color }}>{signals[r.id] ?? 0}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-border bg-[#080808] p-3 space-y-2">
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">REGIME-CONDITIONED PORTFOLIO BLEND</div>
            <div className="font-terminal text-[7px] leading-relaxed text-muted-foreground">Enter the investable asset set, analyst regime probabilities, and one full allocation per regime. Live quote/HMM signals above lack an immutable portfolio/regime snapshot, so they are contextual only and never silently submitted here.</div>
            <input value={blendAssets} onChange={(event) => setBlendAssets(event.target.value)} placeholder="ASSETS: EQUITY,BONDS,CASH" className="w-full border border-border bg-transparent px-1 py-1 font-mono text-[7px] text-foreground" />
            <input value={blendProbabilities} onChange={(event) => setBlendProbabilities(event.target.value)} placeholder="REGIME PROBABILITIES: 0.60,0.30,0.10" className="w-full border border-border bg-transparent px-1 py-1 font-mono text-[7px] text-foreground" />
            <StructuredJsonEditor schema={REGIME_BLEND_WEIGHTS_SCHEMA} value={blendWeightsState} onChange={setBlendWeightsState} />
            <button disabled={regimeBlend.isPending || !blendAssets.trim() || !blendProbabilities.trim()} onClick={() => regimeBlend.mutate()} className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40">{regimeBlend.isPending ? "BLENDING…" : "RUN REGIME BLEND"}</button>
            {regimeBlend.error && <div className="font-terminal text-[7px] text-red-300">{regimeBlend.error.message}</div>}
            {regimeBlend.data && <><div className="font-terminal text-[8px] text-foreground">BLENDED WEIGHTS {Object.entries(regimeBlend.data.weights).map(([asset, weight]) => `${asset} ${(weight * 100).toFixed(2)}%`).join(" / ")}</div><AdvancedPortfolioRiskReceipt receipt={regimeBlend.data.receipt} /></>}
          </div>
          {/* Statistical regime model -- a real fitted HMM, distinct from the heuristic above */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground flex items-center gap-1.5">
                <Sigma className="w-3 h-3" /> STATISTICAL REGIME MODEL (2Y S&P 500, GAUSSIAN HMM)
              </div>
              <div className="flex items-center gap-px">
                {([2, 3] as const).map((n) => (
                  <button key={n} onClick={() => setHmmStates(n)}
                    className={`px-2 py-0.5 font-terminal text-[7.5px] border transition-all ${hmmStates === n ? "border-[hsl(186,80%,50%)] bg-[hsl(186,80%,50%)/10%] text-[hsl(186,80%,55%)]" : "border-border text-muted-foreground"}`}>
                    {n} STATES
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-[#080808] border border-border p-3">
              {hmmLoading ? (
                <div className="font-terminal text-[9px] text-muted-foreground py-4 text-center">Fitting model…</div>
              ) : !hmm ? (
                <div className="font-terminal text-[9px] text-muted-foreground py-4 text-center">Not enough history to fit</div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-terminal text-[9px] text-muted-foreground">CURRENT STATE:</span>
                    <span className="font-terminal text-[11px] font-bold text-[hsl(186,80%,55%)]">{hmm.stateLabel.get(hmm.result.currentState)}</span>
                    <span className="font-terminal text-[9px] text-muted-foreground">
                      {(hmm.result.currentStateProbs[hmm.result.currentState] * 100).toFixed(1)}% confidence
                    </span>
                  </div>
                  <div className="h-28">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={hmm.chartData} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
                        <CartesianGrid stroke="#111" />
                        <XAxis dataKey="date" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 6, fill: "hsl(0,0%,45%)" }} tickLine={false} interval="preserveStartEnd" />
                        <YAxis domain={[0, 100]} tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7, fill: "hsl(0,0%,45%)" }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 8 }} />
                        {hmm.labels.map((label, i) => (
                          <Area key={label} type="monotone" dataKey={label} stackId="1"
                            stroke={["hsl(142,71%,45%)", "hsl(38,95%,55%)", "hsl(0,80%,55%)"][i]}
                            fill={["hsl(142,71%,45%)", "hsl(38,95%,55%)", "hsl(0,80%,55%)"][i]}
                            fillOpacity={0.35} strokeWidth={1} />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid gap-1.5 mt-2" style={{ gridTemplateColumns: `repeat(${hmmStates}, 1fr)` }}>
                    {hmm.labels.map((label, rank) => {
                      const stateIdx = Array.from(hmm.stateLabel.entries()).find(([, l]) => l === label)![0];
                      return (
                        <div key={label} className="bg-[#0a0a0a] border border-border p-1.5">
                          <div className="font-terminal text-[7px] text-muted-foreground truncate">{label}</div>
                          <div className="font-terminal text-[8px] tabular-nums">
                            μ={hmm.result.means[stateIdx].toFixed(2)}% σ={Math.sqrt(hmm.result.variances[stateIdx]).toFixed(2)}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="font-terminal text-[7px] text-muted-foreground/70 mt-2 leading-relaxed">
                    Fitted via Baum-Welch/EM ({hmm.result.iterations} iterations) -- states are recovered directly from S&P 500 return data, not hand-labeled. μ/σ are each state's fitted daily mean/volatility.
                  </div>
                </>
              )}
            </div>
          </div>
          <RegimeConditionedForecastRunner hmm={hmm} />
        </div>

        {/* Right: asset positioning */}
        <div className="w-72 shrink-0 border-l border-border bg-[#060606] p-4 space-y-4 overflow-y-auto scrollbar-thin">
          <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">CROSS-ASSET LIVE SIGNALS</div>
          {assetImpact.map(a => {
            const isUp = a.chg >= 0;
            const aligned = a.riskAlignment === 1;
            const contra  = a.riskAlignment === -1;
            const isCore = CORE_ASSETS.some((c) => c.sym === a.sym);
            return (
              <div key={a.sym} className="py-2 border-b border-border/30 cursor-pointer hover:bg-white/[1%]" onClick={() => onSymbol(a.sym)}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-terminal text-[9px] text-foreground flex items-center gap-1.5">
                    {!isCore && (
                      <button onClick={(e) => { e.stopPropagation(); removeWatchAsset(a.sym); }} className="text-muted-foreground hover:text-[hsl(0,80%,55%)]"><X className="w-2.5 h-2.5" /></button>
                    )}
                    {a.label}
                  </span>
                  <span className={`font-terminal text-[10px] font-bold tabular-nums ${isUp ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>
                    {isUp ? "+" : ""}{a.chg.toFixed(2)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-terminal text-[7.5px] text-muted-foreground">{a.sym}</span>
                  {aligned && <span className="font-terminal text-[7px] text-[hsl(142,71%,55%)] border border-[hsl(142,71%,25%)] px-1">FAVORED IN {dominantRegime.label.split(" ").slice(1).join(" ")}</span>}
                  {contra  && <span className="font-terminal text-[7px] text-[hsl(0,80%,55%)] border border-[hsl(0,80%,25%)] px-1">UNFAVORED</span>}
                </div>
              </div>
            );
          })}

          <div className="font-terminal text-[7.5px] text-muted-foreground/70 border border-border/30 p-2 leading-relaxed">
            Regime classification uses real-time cross-asset momentum signals. Not financial advice. Rebalances every 15 seconds.
          </div>
        </div>
      </div>
    </div>
  );
}
