import { useTerminalArtifactContext } from "@/lib/terminalArtifactState";
import { useTerminalQuantRun } from "@/lib/useTerminalQuantRun";
import { useTerminalArtifactState, useTerminalArtifactSymbol } from "@/lib/terminalArtifactState";
import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useOHLCV } from "@/lib/useFinance";
import { computeDailyReturns } from "@/lib/statistics";
import { getCurrencySymbol } from "@/lib/finance";
import {
  sortinoRatio, informationRatio, calmarRatio, cagr, maxDrawdownPct,
  parametricVaR, historicalVaR, expectedShortfall, monteCarloVaR, ewmaVolatility,
  fitGPD, evtVaR, evtExpectedShortfall, type GPDFit,
} from "@/lib/quantModels";
import { RangeSelector } from "@/components/panels/RangeSelector";
import { withManualProvenance, type AdvancedRiskResponse } from "@/lib/advancedPortfolioRisk";
import { AdvancedPortfolioRiskReceipt } from "@/lib/advancedPortfolioRiskReceipt";
import { FixedIncomeCreditControls } from "@/components/panels/FixedIncomeCreditControls";
import { StructuredJsonEditor, applySchemaDefaults, type JsonFieldSchema } from "@/components/ui/StructuredJsonEditor";
const RANGES = ["3M", "6M", "1Y", "2Y"] as const;
const CONFIDENCE_LEVELS = [95, 99];
const EVT_CONFIDENCE_LEVELS = [99, 99.5, 99.9];

const LIQUIDITY_VAR_SCHEMA: JsonFieldSchema[] = [
  {
    kind: "objectArray", key: "positions", label: "Positions",
    itemFields: [
      { kind: "string", key: "name", label: "Name" },
      { kind: "number", key: "marketValue", label: "Market Value" },
      { kind: "number", key: "dailyVolumeValue", label: "Daily Volume Value" },
      { kind: "number", key: "bidAskSpreadBps", label: "Bid/Ask Spread (bps)" },
      { kind: "number", key: "dailyVolatilityPct", label: "Daily Volatility %" },
      { kind: "number", key: "liquidationDays", label: "Liquidation Days" },
    ],
    default: [{ name: "AAPL", marketValue: 100000, dailyVolumeValue: 5000000, bidAskSpreadBps: 8, dailyVolatilityPct: 2, liquidationDays: 1 }],
  },
  { kind: "number", key: "participationRatePct", label: "Participation Rate %", min: 0, max: 100, step: 1, default: 20 },
  { kind: "number", key: "confidencePct", label: "Confidence %", min: 90, max: 99.9, step: 0.5, default: 99 },
];

const CREDIT_METRICS_SCHEMA: JsonFieldSchema[] = [
  {
    kind: "objectArray", key: "exposures", label: "Exposures",
    itemFields: [
      { kind: "string", key: "name", label: "Name" },
      { kind: "number", key: "ead", label: "EAD", min: 0 },
      { kind: "number", key: "pdPct", label: "PD %", min: 0, max: 100 },
      { kind: "number", key: "lgdPct", label: "LGD %", min: 0, max: 100 },
      { kind: "string", key: "sector", label: "Sector" },
    ],
    default: [
      { name: "IssuerA", ead: 5000000, pdPct: 2.5, lgdPct: 45, sector: "Industrials" },
      { name: "IssuerB", ead: 3000000, pdPct: 1.2, lgdPct: 40, sector: "Financials" },
    ],
  },
  { kind: "number", key: "assetCorrelation", label: "Asset Correlation", min: 0, max: 0.99, step: 0.05, default: 0.2 },
  { kind: "number", key: "confidencePct", label: "Confidence %", min: 90, max: 99.9, step: 0.5, default: 99 },
  { kind: "number", key: "nSimulations", label: "Simulations", min: 5000, max: 500000, step: 5000, default: 50000 },
  { kind: "number", key: "seed", label: "Reproducible Seed", default: 42 },
];

function fmtMoney(v: number, curr: string): string {
  return v >= 1_000_000 ? `${curr}${(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `${curr}${(v / 1_000).toFixed(1)}K` : `${curr}${v.toFixed(0)}`;
}
function fmt(v: number | null, digits = 2): string {
  return v === null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

type TailRiskResult = { historicalVaR: number; historicalES: number; studentTMonteCarloVaR: number; maxDrawdownPct: number; drawdownAtRiskPct: number; seed: number };
type LiquidityRiskResult = { liquidityVaR: number; estimatedLiquidationCost: number };
type CreditMetricsResult = { expectedLoss: number; unexpectedLossStd: number; creditVar: number; economicCapital: number; tailExpectedShortfall: number; seed: number };

export default function AdvancedRiskPanel({ symbol: initialSymbol }: { symbol?: string }) {
  const terminal = useTerminalArtifactContext();
  const quant = useTerminalQuantRun();
  const nativeScope = `AdvancedRiskPanel.${terminal?.symbol ?? "manual"}`;
  function runAdvancedPortfolioRisk<T extends Record<string, unknown>>(path: string, parameters: Record<string, unknown>): Promise<AdvancedRiskResponse<T>> {
    return quant.run<AdvancedRiskResponse<T>>(path, withManualProvenance(parameters), `${nativeScope}.${path}`);
  }
  const [input, setInput] = useTerminalArtifactState("AdvancedRiskPanel.input", initialSymbol || "AAPL");
  const [symbol, setSymbol] = useTerminalArtifactSymbol(initialSymbol || "AAPL");
  const [benchmark, setBenchmark] = useTerminalArtifactState("AdvancedRiskPanel.benchmark", "^GSPC");
  const [range, setRange] = useTerminalArtifactState("AdvancedRiskPanel.range", "1Y");
  const [positionValue, setPositionValue] = useTerminalArtifactState("AdvancedRiskPanel.positionValue", 100000);
  const [tailSeed, setTailSeed] = useTerminalArtifactState("AdvancedRiskPanel.tailSeed", 42);
  const [liquidityInput, setLiquidityInput] = useTerminalArtifactState<Record<string, unknown>>("AdvancedRiskPanel.liquidityInput", () => applySchemaDefaults(LIQUIDITY_VAR_SCHEMA, {}));
  const [creditMetricsInput, setCreditMetricsInput] = useTerminalArtifactState<Record<string, unknown>>("AdvancedRiskPanel.creditMetricsInput", () => applySchemaDefaults(CREDIT_METRICS_SCHEMA, {}));
  const tailReportMutation = useMutation({
    mutationFn: async () => {
      if (returns.length < 30 || !Number.isFinite(positionValue) || positionValue <= 0) throw new Error("Tail report requires 30+ observed returns and a positive position value.");
      return runAdvancedPortfolioRisk<TailRiskResult>("risk/tail-report", {
        assets: [symbol], returnsMatrixPct: returns.map(value => [value]), weights: [1],
        portfolioValue: positionValue, confidencePct: 99, ewmaLambda: 0.94, evtThresholdPct: 95,
        monteCarloSims: 20000, studentTDegreesFreedom: 6, seed: tailSeed,
      });
    },
  });
  const tailReport = { ...tailReportMutation, data: terminal?.target ? quant.stored?.[`${nativeScope}.risk/tail-report`] as typeof tailReportMutation.data : tailReportMutation.data };
  const liquidityVarMutation = useMutation({
    mutationFn: async () => {
      const payload = liquidityInput as { positions?: Array<{ name?: string; marketValue?: number; dailyVolumeValue?: number; bidAskSpreadBps?: number; dailyVolatilityPct?: number; liquidationDays?: number }>; participationRatePct?: number; confidencePct?: number };
      if (!payload.positions?.length || payload.positions.some((position) => !position.name || !Number.isFinite(position.marketValue) || !Number.isFinite(position.dailyVolumeValue) || position.dailyVolumeValue! <= 0 || !Number.isFinite(position.bidAskSpreadBps) || position.bidAskSpreadBps! < 0 || !Number.isFinite(position.dailyVolatilityPct) || position.dailyVolatilityPct! < 0 || !Number.isFinite(position.liquidationDays) || position.liquidationDays! <= 0)) throw new Error("Each manual liquidity position requires name, finite marketValue, positive dailyVolumeValue/liquidationDays, and non-negative spread/volatility.");
      if (!Number.isFinite(payload.participationRatePct) || payload.participationRatePct! <= 0 || payload.participationRatePct! > 100 || !Number.isFinite(payload.confidencePct) || payload.confidencePct! < 90 || payload.confidencePct! > 99.9) throw new Error("Participation must be (0, 100] and confidence must be 90–99.9.");
      return runAdvancedPortfolioRisk<LiquidityRiskResult>("risk/liquidity-var", payload as Record<string, unknown>);
    },
  });
  const liquidityVar = { ...liquidityVarMutation, data: terminal?.target ? quant.stored?.[`${nativeScope}.risk/liquidity-var`] as typeof liquidityVarMutation.data : liquidityVarMutation.data };
  const creditMetricsRunMutation = useMutation({
    mutationFn: async () => {
      const { exposures, assetCorrelation, confidencePct, nSimulations, seed } = creditMetricsInput as { exposures?: Array<{ name?: string; ead?: number; pdPct?: number; lgdPct?: number; sector?: string }>; assetCorrelation?: number; confidencePct?: number; nSimulations?: number; seed?: number };
      if (!Array.isArray(exposures) || exposures.length === 0 || exposures.some((e) => !e.name || !Number.isFinite(e.ead) || (e.ead as number) < 0 || !Number.isFinite(e.pdPct) || (e.pdPct as number) < 0 || (e.pdPct as number) > 100 || !Number.isFinite(e.lgdPct) || (e.lgdPct as number) < 0 || (e.lgdPct as number) > 100)) throw new Error("Every exposure requires a name, non-negative EAD, and pdPct/lgdPct in [0, 100].");
      if (!Number.isFinite(assetCorrelation) || assetCorrelation! < 0 || assetCorrelation! >= 1) throw new Error("Asset correlation must be in [0, 1).");
      if (!Number.isFinite(confidencePct) || confidencePct! < 90 || confidencePct! >= 100) throw new Error("Confidence must be in [90, 100).");
      if (!Number.isFinite(nSimulations) || nSimulations! < 5000 || nSimulations! > 500000) throw new Error("Simulations must be between 5,000 and 500,000.");
      return runAdvancedPortfolioRisk<CreditMetricsResult>("credit/creditmetrics", { exposures, assetCorrelation, confidencePct, nSimulations, seed });
    },
  });
  const creditMetricsRun = { ...creditMetricsRunMutation, data: terminal?.target ? quant.stored?.[`${nativeScope}.credit/creditmetrics`] as typeof creditMetricsRunMutation.data : creditMetricsRunMutation.data };

  const curr = getCurrencySymbol(symbol);
  const { data: series, isLoading } = useOHLCV(symbol, range, "1d");
  const { data: benchSeries } = useOHLCV(benchmark, range, "1d");

  const bars = series?.bars ?? [];
  const closes = useMemo(() => bars.map((b) => b.close), [bars]);
  const returns = useMemo(() => computeDailyReturns(closes), [closes]);
  const benchReturns = useMemo(() => computeDailyReturns((benchSeries?.bars ?? []).map((b) => b.close)), [benchSeries]);

  const equityCurve = closes;
  const years = bars.length > 1 ? bars.length / 252 : 0;
  const startPrice = closes[0] ?? 0;
  const endPrice = closes[closes.length - 1] ?? 0;
  const portfolioCagr = years > 0 ? cagr(startPrice, endPrice, years) : 0;
  const maxDD = maxDrawdownPct(equityCurve);

  const sortino = sortinoRatio(returns, 0, 252);
  const infoRatio = informationRatio(returns, benchReturns, 252);
  const calmar = calmarRatio(portfolioCagr, maxDD);

  const dailyVol = useMemo(() => {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
    const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance);
  }, [returns]);
  const dailyDrift = returns.length ? returns.reduce((s, v) => s + v, 0) / returns.length : 0;

  const varTable = useMemo(() => {
    if (returns.length < 2) return [];
    return CONFIDENCE_LEVELS.map((conf) => ({
      confidence: conf,
      parametric: parametricVaR(positionValue, dailyVol, conf, 1),
      historical: historicalVaR(positionValue, returns, conf),
      monteCarlo: monteCarloVaR(positionValue, dailyVol, dailyDrift, conf, 1, 3000),
      cvar: expectedShortfall(positionValue, returns, conf),
    }));
  }, [positionValue, dailyVol, dailyDrift, returns]);

  // EVT (Peaks-Over-Threshold GPD) tail fit -- needs enough data for a
  // reliable 90th-percentile threshold with 8+ exceedances above it.
  const gpd: GPDFit | null = useMemo(() => {
    try { return fitGPD(returns, 90); } catch { return null; }
  }, [returns]);
  const evtTable = useMemo(() => {
    if (!gpd) return [];
    return EVT_CONFIDENCE_LEVELS.map((conf) => ({
      confidence: conf,
      var: evtVaR(positionValue, gpd, conf),
      es: evtExpectedShortfall(positionValue, gpd, conf),
    }));
  }, [gpd, positionValue]);

  const ewmaSeries = useMemo(() => {
    const vols = ewmaVolatility(returns);
    return bars.slice(1).map((b, i) => ({ date: b.date.slice(5), vol: (vols[i] ?? 0) * Math.sqrt(252) }));
  }, [returns, bars]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <ShieldAlert className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">ADVANCED RISK METRICS</span>
        <form onSubmit={(e) => { e.preventDefault(); setSymbol(input.toUpperCase()); }}>
          <input value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="TICKER..." className="bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground w-24 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        </form>
        <input value={positionValue} onChange={(e) => setPositionValue(Number(e.target.value) || 0)} placeholder={`POSITION ${curr}...`} className="bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <RangeSelector ranges={RANGES} value={range} onChange={setRange} />
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">RISK</span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-5">
          {isLoading && <p role="status" className="text-sm">Loading current observations; saved native results below remain available.</p>}
          {returns.length < 2 ? <p role="status" className="text-sm text-amber-200">Observed return history is unavailable. Automatic performance and VaR comparisons are not calculated from zero prices or missing returns. Manual native engines and retained results remain available below.</p> : <>
          {/* Risk-adjusted ratios */}
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">RISK-ADJUSTED PERFORMANCE ({range})</div>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">SORTINO RATIO</div>
                <div className="font-terminal text-[15px] font-bold tabular-nums text-foreground">{fmt(sortino)}</div>
                <div className="font-terminal text-[7px] text-muted-foreground/70 mt-0.5">downside-only Sharpe (target=0%)</div>
              </div>
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">INFORMATION RATIO</div>
                <div className="font-terminal text-[15px] font-bold tabular-nums text-foreground">{fmt(infoRatio)}</div>
                <div className="font-terminal text-[7px] text-muted-foreground/70 mt-0.5">vs {benchmark}</div>
              </div>
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">CALMAR RATIO</div>
                <div className="font-terminal text-[15px] font-bold tabular-nums text-foreground">{fmt(calmar)}</div>
                <div className="font-terminal text-[7px] text-muted-foreground/70 mt-0.5">CAGR {fmt(portfolioCagr, 1)}% / MaxDD {fmt(maxDD, 1)}%</div>
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="font-terminal text-[7.5px] text-muted-foreground">BENCHMARK:</span>
              {["^GSPC", "^IXIC", "^DJI"].map((b) => (
                <button key={b} onClick={() => setBenchmark(b)} className={`px-2 py-0.5 border font-terminal text-[7.5px] ${benchmark === b ? "border-[hsl(38,95%,55%)] text-[hsl(38,95%,55%)]" : "border-border text-muted-foreground"}`}>{b}</button>
              ))}
            </div>
          </div>

          {/* VaR / CVaR comparison */}
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">VALUE AT RISK — METHOD COMPARISON (1-DAY HORIZON)</div>
            <div className="border border-border overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border bg-[#070707]">
                    <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">CONFIDENCE</th>
                    <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">PARAMETRIC VAR</th>
                    <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">HISTORICAL VAR</th>
                    <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">MONTE CARLO VAR</th>
                    <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-[hsl(0,80%,60%)] tracking-wider">EXPECTED SHORTFALL (CVaR)</th>
                  </tr>
                </thead>
                <tbody>
                  {varTable.map((row) => (
                    <tr key={row.confidence} className="border-b border-border/30 last:border-b-0">
                      <td className="px-3 py-2 font-terminal text-[10px] font-bold text-foreground">{row.confidence}%</td>
                      <td className="px-3 py-2 font-terminal text-[10px] tabular-nums text-right">{fmtMoney(row.parametric, curr)}</td>
                      <td className="px-3 py-2 font-terminal text-[10px] tabular-nums text-right">{fmtMoney(row.historical, curr)}</td>
                      <td className="px-3 py-2 font-terminal text-[10px] tabular-nums text-right">{fmtMoney(row.monteCarlo, curr)}</td>
                      <td className="px-3 py-2 font-terminal text-[10px] tabular-nums text-right font-bold text-[hsl(0,80%,60%)]">{fmtMoney(row.cvar, curr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-1.5 font-terminal text-[7.5px] text-muted-foreground/70">
              Parametric assumes normal returns; Historical uses the empirical distribution (captures real skew/fat tails); Monte Carlo simulates 3,000 GBM paths; CVaR is the average loss beyond the VaR cutoff.
            </div>
          </div>

          {/* EVT tail fit -- extreme quantiles beyond what historical VaR can reliably estimate */}
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">EXTREME VALUE THEORY — TAIL RISK (GENERALIZED PARETO FIT)</div>
            {!gpd ? (
              <div className="border border-border bg-[#0a0a0a] p-3 font-terminal text-[9px] text-muted-foreground">
                Not enough history to fit a reliable tail (need a longer range — try 1Y or 2Y).
              </div>
            ) : (
              <>
                <div className="border border-border overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-[#070707]">
                        <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">CONFIDENCE</th>
                        <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">EVT VAR</th>
                        <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-[hsl(0,80%,60%)] tracking-wider">EVT EXPECTED SHORTFALL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evtTable.map((row) => (
                        <tr key={row.confidence} className="border-b border-border/30 last:border-b-0">
                          <td className="px-3 py-2 font-terminal text-[10px] font-bold text-foreground">{row.confidence}%</td>
                          <td className="px-3 py-2 font-terminal text-[10px] tabular-nums text-right">{fmtMoney(row.var, curr)}</td>
                          <td className="px-3 py-2 font-terminal text-[10px] tabular-nums text-right font-bold text-[hsl(0,80%,60%)]">{Number.isFinite(row.es) ? fmtMoney(row.es, curr) : "undefined (ξ≥1)"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-1.5 font-terminal text-[7.5px] text-muted-foreground/70">
                  Fit above the 90th-percentile loss threshold ({gpd.numExceedances} exceedances). Shape ξ={gpd.shape.toFixed(3)} ({gpd.shape > 0.1 ? "fat-tailed" : gpd.shape < -0.1 ? "thin-tailed" : "near-normal"} tail behavior) -- by the Pickands-Balkema-de Haan theorem, exceedances over a high threshold converge to this Generalized Pareto shape regardless of the parent return distribution, which is why it extrapolates to 99.9% more reliably than a raw historical percentile of {returns.length} observations can.
                </div>
              </>
            )}
          </div>
          </>}

          <div className="border border-border bg-[#080808] p-3 space-y-3">
            <div className="font-terminal text-[9px] tracking-widest text-muted-foreground">ADVANCED TAIL &amp; LIQUIDITY ENGINES</div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="font-terminal text-[8px] text-foreground">TAIL RISK REPORT / {symbol} HISTORY</div>
                <div className="font-terminal text-[7px] text-muted-foreground leading-relaxed">Uses the displayed return history as exact MANUAL run parameters because this panel does not retain an immutable OHLCV snapshot/provider binding. It is not presented as a live source-bound report.</div>
                <label className="font-terminal text-[7px] text-muted-foreground">REPRODUCIBLE SEED <input type="number" value={tailSeed} onChange={(event) => setTailSeed(Math.trunc(Number(event.target.value) || 0))} className="ml-2 w-20 border border-border bg-transparent px-1 py-0.5 text-foreground" /></label>
                <button disabled={tailReport.isPending || returns.length < 30} onClick={() => tailReport.mutate()} className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40">{tailReport.isPending ? "RUNNING…" : "RUN TAIL REPORT"}</button>
                {tailReport.error && <div className="font-terminal text-[7px] text-red-300">{tailReport.error.message}</div>}
                {tailReport.data && <><div className="grid grid-cols-3 gap-1 font-terminal text-[7px]"><span>HIST VAR {fmtMoney(tailReport.data.historicalVaR, curr)}</span><span>HIST ES {fmtMoney(tailReport.data.historicalES, curr)}</span><span>t-MC VAR {fmtMoney(tailReport.data.studentTMonteCarloVaR, curr)}</span><span>MAX DD {tailReport.data.maxDrawdownPct.toFixed(2)}%</span><span>DA-R {tailReport.data.drawdownAtRiskPct.toFixed(2)}%</span><span>SEED {tailReport.data.seed}</span></div><AdvancedPortfolioRiskReceipt receipt={tailReport.data.receipt} /></>}
              </div>
              <div className="space-y-2">
                <div className="font-terminal text-[8px] text-foreground">LIQUIDITY VaR / MANUAL POSITIONS</div>
                <StructuredJsonEditor schema={LIQUIDITY_VAR_SCHEMA} value={liquidityInput} onChange={setLiquidityInput} />
                <div className="font-terminal text-[7px] text-muted-foreground">Manual client position inputs only. A holdings volume/spread connector and immutable snapshot are unavailable here; no default is passed off as live.</div>
                <button disabled={liquidityVar.isPending || !(Array.isArray(liquidityInput.positions) && (liquidityInput.positions as unknown[]).length > 0)} onClick={() => liquidityVar.mutate()} className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40">{liquidityVar.isPending ? "RUNNING…" : "RUN LIQUIDITY VaR"}</button>
                {liquidityVar.error && <div className="font-terminal text-[7px] text-red-300">{liquidityVar.error.message}</div>}
                {liquidityVar.data && <><div className="grid grid-cols-2 gap-1 font-terminal text-[7px]"><span>LIQUIDITY VaR {fmtMoney(liquidityVar.data.liquidityVaR, curr)}</span><span>LIQUIDATION COST {fmtMoney(liquidityVar.data.estimatedLiquidationCost, curr)}</span></div><AdvancedPortfolioRiskReceipt receipt={liquidityVar.data.receipt} /></>}
              </div>
            </div>
          </div>

          <div className="border border-border bg-[#080808] p-3 space-y-3" data-testid="advanced-risk-institutional-credit">
            <div className="font-terminal text-[9px] tracking-widest text-muted-foreground">INSTITUTIONAL FI / CREDIT · MANUAL ANALYST INPUTS</div>
            <div className="font-terminal text-[7px] leading-relaxed text-muted-foreground">SOURCE STATUS: CreditMetrics is MANUAL-only in this panel; private cached import is explicit on the rating, stress and covenant routes below. No ratings, PDs, exposures, covenants, provider, as-of date or reporting period are inferred from the equity history shown above.</div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2" data-testid="advanced-risk-creditmetrics">
                <div className="font-terminal text-[8px] text-foreground">CREDITMETRICS PORTFOLIO SIMULATION / MANUAL EXPOSURES</div>
                <div className="font-terminal text-[7px] text-muted-foreground leading-relaxed">Manual analyst-entered exposure book (name, EAD, PD%, LGD%). One-factor Gaussian-copula Monte Carlo credit-loss simulation over the asset correlation below; not a live credit-bureau or ratings-agency feed.</div>
                <div aria-label="CreditMetrics manual exposures" data-testid="creditmetrics-input">
                  <StructuredJsonEditor schema={CREDIT_METRICS_SCHEMA} value={creditMetricsInput} onChange={setCreditMetricsInput} />
                </div>
                <button type="button" data-testid="creditmetrics-run" disabled={creditMetricsRun.isPending || !(Array.isArray(creditMetricsInput.exposures) && (creditMetricsInput.exposures as unknown[]).length > 0)} onClick={() => creditMetricsRun.mutate()} className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40">{creditMetricsRun.isPending ? "RUNNING…" : "RUN CREDITMETRICS"}</button>
                {creditMetricsRun.error && <div role="alert" data-testid="creditmetrics-error" className="font-terminal text-[7px] text-red-300">{(creditMetricsRun.error as Error).message}</div>}
                {creditMetricsRun.data && <div data-testid="creditmetrics-result"><div className="grid grid-cols-3 gap-1 font-terminal text-[7px]"><span>EXPECTED LOSS {fmtMoney(creditMetricsRun.data.expectedLoss, curr)} · NOTIONAL CURRENCY UNITS</span><span>UL STD {fmtMoney(creditMetricsRun.data.unexpectedLossStd, curr)} · NOTIONAL CURRENCY UNITS</span><span>CREDIT VaR {fmtMoney(creditMetricsRun.data.creditVar, curr)} · NOTIONAL CURRENCY UNITS</span><span>ECON CAPITAL {fmtMoney(creditMetricsRun.data.economicCapital, curr)} · NOTIONAL CURRENCY UNITS</span><span>TAIL ES {fmtMoney(creditMetricsRun.data.tailExpectedShortfall, curr)} · NOTIONAL CURRENCY UNITS</span><span>SEED {creditMetricsRun.data.seed} · INTEGER</span></div><AdvancedPortfolioRiskReceipt receipt={creditMetricsRun.data.receipt} /></div>}
              </div>
              <FixedIncomeCreditControls
                title="RATING / STRESS / COVENANT ROUTES"
                paths={["credit/rating-migration", "credit/stress-pd", "credit/covenant-headroom"]}
              />
            </div>
          </div>
          {/* EWMA volatility trend */}
          {returns.length >= 2 && <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">EWMA VOLATILITY (ANNUALIZED, λ=0.94)</div>
            <div className="h-36 border border-border bg-[#0a0a0a] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ewmaSeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ewmaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(0,80%,60%)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="hsl(0,80%,60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                  <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={40} domain={["auto", "auto"]} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                  <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [`${v.toFixed(1)}%`, "EWMA Vol"]} />
                  <Area type="monotone" dataKey="vol" stroke="hsl(0,80%,60%)" strokeWidth={1.5} fill="url(#ewmaFill)" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>}
        </div>

      <div className="px-4 py-1.5 border-t border-border bg-[#060606] shrink-0">
        <span className="font-terminal text-[7.5px] text-muted-foreground/70">EWMA (RiskMetrics convention) reacts faster to volatility shifts than the flat-window GARCH(1,1) elsewhere in this terminal.</span>
      </div>
    </div>
  );
}
