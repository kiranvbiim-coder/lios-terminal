import { useTerminalArtifactState, useTerminalArtifactContext } from "@/lib/terminalArtifactState";
import { useTerminalQuantRun } from "@/lib/useTerminalQuantRun";
import { useState, useMemo, useEffect, type FormEvent, type ChangeEvent } from "react";
import { useQueries } from "@tanstack/react-query";
import { FlaskConical, Upload } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ScatterChart, Scatter, CartesianGrid, LineChart, Line, Legend, ComposedChart, BarChart, Bar } from "recharts";
import type { OHLCVSeries } from "@/lib/finance";
import { inferCurrencyFromSymbol } from "@/lib/finance";
import { computeDailyReturns } from "@/lib/statistics";
import { pca, engleGrangerTest, kalmanDynamicBeta, olsRegression, rollingVolatility, rollingBeta, rollingCorrelation, fitTCopula, type CopulaFit, fitHoltWinters, forecastHoltWinters, autoARIMA, forecastARIMA, fitGARCH11, computeCovarianceMatrix, riskDecomposition, maxDrawdownPct, detectHiddenRelationships, type HiddenRelationshipPair } from "@/lib/quantModels";
import { blackScholesMerton } from "@/lib/optionsModels";
import { useIndicators, useIndicatorDetail } from "@/lib/useEconomics";
import { AdvancedManualWorkflow, ReceiptSummary, type AdvancedReceipt } from "./advancedMacroForecastResearch";
import { ReadableValueTable } from "@/components/terminal/ReadableValueTable";

/** Original base models keep their URLs and numerical bodies; P4 alone retains results. */
function useOriginalQuantResult<T>(slot: string) {
  const terminal = useTerminalArtifactContext();
  const quant = useTerminalQuantRun();
  const [local, setLocal] = useState<T | null>(null);
  const result = terminal?.target ? quant.stored?.[slot] as T ?? null : local;
  const post = async (route: string, parameters: unknown): Promise<T> => {
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) throw new Error("Original model parameters must be an object.");
    const output = await quant.run<Record<string, unknown>>(route, parameters as Record<string, unknown>, slot, route);
    if (!terminal?.target) setLocal(output as T);
    return output as T;
  };
  return [result, setLocal, post] as const;
}

function originalRunParameters(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object" || !("receipt" in result)) return null;
  const receipt = result.receipt;
  if (!receipt || typeof receipt !== "object" || !("parameters" in receipt)) return null;
  return receipt.parameters && typeof receipt.parameters === "object" && !Array.isArray(receipt.parameters) ? receipt.parameters as Record<string, unknown> : null;
}

function RecordedOriginalRun({ result }: { result: unknown }) {
  const parameters = originalRunParameters(result);
  if (!parameters) return null;
  const run = result as { receipt?: AdvancedReceipt };
  return <details className="border border-border p-2 text-xs"><summary>Recorded original run · edited controls and refreshed observations do not recalculate it</summary><ReceiptSummary receipt={run.receipt}/><ReadableValueTable title="Exact submitted engine inputs" values={parameters} options={{ showExact: true }}/></details>;
}
type Tab = "pca" | "hidden" | "pairs" | "beta" | "rolling" | "copula" | "forecast" | "forecastupgrade" | "advancedforecast" | "bond" | "portfolio" | "creditrisk" | "oprisk" | "stats" | "panelcausal" | "tsecon" | "optionsvol" | "mlcluster";
const TABS: { key: Tab; label: string }[] = [
  { key: "pca", label: "PCA / FACTOR DECOMPOSITION" },
  { key: "hidden", label: "HIDDEN RELATIONSHIPS" },
  { key: "pairs", label: "PAIRS TRADING SCREENER" },
  { key: "beta", label: "DYNAMIC BETA (KALMAN)" },
  { key: "rolling", label: "ROLLING STATISTICS" },
  { key: "copula", label: "TAIL DEPENDENCE (COPULA)" },
  { key: "forecast", label: "FORECAST (ARIMA / HOLT-WINTERS)" },
  { key: "forecastupgrade", label: "SARIMAX / STL / CHANGEPOINT / GARCH" },
  { key: "advancedforecast", label: "ADVANCED FORECASTING / DATASET METHODS" },
  { key: "bond", label: "FIXED INCOME (QUANTLIB)" },
  { key: "portfolio", label: "PORTFOLIO OPTIMIZER (SCIPY)" },
  { key: "creditrisk", label: "CREDIT & COUNTERPARTY RISK" },
  { key: "oprisk", label: "OP RISK & LIQUIDITY" },
  { key: "stats", label: "STATISTICS SUITE (STATSMODELS)" },
  { key: "panelcausal", label: "PANEL & CAUSAL INFERENCE" },
  { key: "tsecon", label: "TIME SERIES ECONOMETRICS" },
  { key: "optionsvol", label: "OPTIONS VOLATILITY (SABR/HESTON)" },
  { key: "mlcluster", label: "MACHINE LEARNING (SKLEARN)" },
];

interface BondPriceResult {
  cleanPricePct: number;
  dirtyPricePct: number;
  accruedInterestPct: number;
  cleanPriceAmount: number;
  dirtyPriceAmount: number;
  accruedInterestAmount: number;
  macaulayDuration: number;
  modifiedDuration: number;
  convexityValue: number;
  dv01Amount: number;
  maturityDate: string;
  dayCountUsed: string;
  settlementDateUsed?: string;
  receipt?: AdvancedReceipt;
}

function useSymbolOHLCV(symbols: string[], range = "1Y") {
  return useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ["/api/finance/ohlcv", symbol, range, "1d"],
      queryFn: async () => {
        const params = new URLSearchParams({ symbol, range, interval: "1d" });
        const res = await fetch(`/api/finance/ohlcv?${params.toString()}`);
        if (!res.ok) throw new Error(`Failed to fetch ${symbol}`);
        return res.json() as Promise<OHLCVSeries>;
      },
      staleTime: 60000,
    })),
  });
}

// Inner-join two OHLCV bar sets by date, returning aligned close arrays.
function alignByDate(barsA: { date: string; close: number }[], barsB: { date: string; close: number }[]) {
  const mapB = new Map(barsB.map((b) => [b.date, b.close]));
  const dates: string[] = [], closesA: number[] = [], closesB: number[] = [];
  for (const a of barsA) {
    const cb = mapB.get(a.date);
    if (cb !== undefined) { dates.push(a.date); closesA.push(a.close); closesB.push(cb); }
  }
  return { dates, closesA, closesB };
}

// N-way version of alignByDate, for methods that can take 1-3 real ticker
// series instead of hand-typed numbers (StatisticsSuiteTab) -- inner-joins
// every series to the dates common to all of them, so returns are computed
// only over genuinely overlapping trading days.
function alignSeriesByDate(seriesList: { date: string; close: number }[][]): number[][] {
  if (seriesList.length === 0) return [];
  const maps = seriesList.map((bars) => new Map(bars.map((b) => [b.date, b.close])));
  const dates = seriesList[0].map((b) => b.date).filter((d) => maps.every((m) => m.has(d)));
  return maps.map((m) => dates.map((d) => m.get(d)!));
}

function fmt(v: number | null | undefined, digits = 3): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

function PcaTab() {
  const [tickerInput, setTickerInput] = useTerminalArtifactState("PcaTab.tickerInput", "AAPL,MSFT,GOOGL,AMZN,META,NVDA");
  const [symbols, setSymbols] = useTerminalArtifactState("PcaTab.symbols", tickerInput.split(",").map((s) => s.trim().toUpperCase()));
  const results = useSymbolOHLCV(symbols);
  const isLoading = results.some((r) => r.isLoading);

  const pcaResult = useMemo(() => {
    if (isLoading || results.some((r) => !r.data)) return null;
    const returnSeries = results.map((r) => computeDailyReturns((r.data!.bars ?? []).map((b) => b.close)));
    const minLen = Math.min(...returnSeries.map((s) => s.length));
    if (minLen < 10) return null;
    const trimmed = returnSeries.map((s) => s.slice(-minLen));
    return pca(trimmed);
  }, [results, isLoading]);

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); setSymbols(tickerInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)); }} className="flex items-center gap-2">
        <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)} placeholder="COMMA-SEPARATED TICKERS..." className="flex-1 bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <button type="submit" className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground">RUN PCA</button>
      </form>

      {isLoading ? (
        <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : !pcaResult ? (
        <div className="font-terminal text-[9px] text-muted-foreground">NOT ENOUGH OVERLAPPING DATA FOR THIS BASKET.</div>
      ) : (
        <>
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">VARIANCE EXPLAINED PER COMPONENT</div>
            <div className="space-y-1.5">
              {pcaResult.varianceExplainedPct.map((pct, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-10 shrink-0 font-terminal text-[9px] font-bold text-muted-foreground">PC{i + 1}</span>
                  <span className="flex-1 h-4 bg-[#111] relative overflow-hidden">
                    <span className="absolute inset-y-0 left-0 bg-[hsl(38,80%,45%)]" style={{ width: `${Math.max(1, pct)}%` }} />
                  </span>
                  <span className="w-14 shrink-0 text-right font-terminal text-[9px] tabular-nums text-foreground">{fmt(pct, 1)}%</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">FACTOR LOADINGS — PC1 (DOMINANT RISK FACTOR) & PC2</div>
            <div className="border border-border">
              <table className="w-full border-collapse">
                <thead><tr className="border-b border-border bg-[#070707]">
                  <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">ASSET</th>
                  <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">PC1 LOADING</th>
                  <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">PC2 LOADING</th>
                </tr></thead>
                <tbody>
                  {symbols.map((s, i) => (
                    <tr key={s} className="border-b border-border/30 last:border-b-0">
                      <td className="px-3 py-2 font-terminal text-[9px] font-bold text-foreground">{s}</td>
                      <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(pcaResult.eigenvectors[0]?.[i])}</td>
                      <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(pcaResult.eigenvectors[1]?.[i])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-1.5 font-terminal text-[7.5px] text-muted-foreground/70">PC1 explaining most of the variance with similar-sign loadings across assets usually means one dominant "market" factor is driving the whole basket.</div>
          </div>
        </>
      )}
    </div>
  );
}

function HiddenRelationshipsTab() {
  const [tickerInput, setTickerInput] = useTerminalArtifactState("HiddenRelationshipsTab.tickerInput", "AAPL,MSFT,GOOGL,AMZN,META,NVDA");
  const [symbols, setSymbols] = useTerminalArtifactState("HiddenRelationshipsTab.symbols", tickerInput.split(",").map((s) => s.trim().toUpperCase()));
  const results = useSymbolOHLCV(symbols);
  const isLoading = results.some((r) => r.isLoading);

  const hiddenResult = useMemo(() => {
    if (isLoading || results.some((r) => !r.data) || symbols.length < 3) return null;
    const returnSeries = results.map((r) => computeDailyReturns((r.data!.bars ?? []).map((b) => b.close)));
    const minLen = Math.min(...returnSeries.map((s) => s.length));
    if (minLen < 10) return null;
    const trimmed = returnSeries.map((s) => s.slice(-minLen));
    try {
      return detectHiddenRelationships(symbols, trimmed, 2, 0.05);
    } catch {
      return null;
    }
  }, [results, isLoading, symbols]);

  const significantCount = hiddenResult?.pairs.filter((p) => p.isSignificant).length ?? 0;

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); setSymbols(tickerInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)); }} className="flex items-center gap-2">
        <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)} placeholder="COMMA-SEPARATED TICKERS (3+)..." className="flex-1 bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <button type="submit" className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground">SCAN FOR HIDDEN RELATIONSHIPS</button>
      </form>

      {isLoading ? (
        <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : symbols.length < 3 ? (
        <div className="font-terminal text-[9px] text-muted-foreground">NEED AT LEAST 3 TICKERS — RESIDUALIZING AGAINST PRINCIPAL COMPONENTS NEEDS ENOUGH ASSETS TO SEPARATE COMMON FACTOR STRUCTURE FROM PAIRWISE CO-MOVEMENT.</div>
      ) : !hiddenResult ? (
        <div className="font-terminal text-[9px] text-muted-foreground">NOT ENOUGH OVERLAPPING DATA FOR THIS BASKET.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">COMPONENTS RESIDUALIZED OUT</div>
              <div className="font-terminal text-[16px] font-bold tabular-nums text-foreground">PC1–PC{hiddenResult.componentsUsed}</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">VARIANCE THOSE COMPONENTS EXPLAIN</div>
              <div className="font-terminal text-[16px] font-bold tabular-nums text-foreground">{fmt(hiddenResult.varianceExplainedByComponents, 1)}%</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">SIGNIFICANT HIDDEN PAIRS (p&lt;0.05)</div>
              <div className={`font-terminal text-[16px] font-bold tabular-nums ${significantCount > 0 ? "text-[hsl(38,95%,55%)]" : "text-foreground"}`}>{significantCount} / {hiddenResult.pairs.length}</div>
            </div>
          </div>
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">PAIRS RANKED BY RESIDUAL CORRELATION (FACTOR-ADJUSTED)</div>
            <div className="border border-border">
              <table className="w-full border-collapse">
                <thead><tr className="border-b border-border bg-[#070707]">
                  <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">PAIR</th>
                  <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">RESIDUAL CORR</th>
                  <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">RAW CORR</th>
                  <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">P-VALUE</th>
                  <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">SIGNIFICANT</th>
                </tr></thead>
                <tbody>
                  {hiddenResult.pairs.map((p: HiddenRelationshipPair) => (
                    <tr key={`${p.assetA}-${p.assetB}`} className="border-b border-border/30 last:border-b-0">
                      <td className="px-3 py-2 font-terminal text-[9px] font-bold text-foreground">{p.assetA} / {p.assetB}</td>
                      <td className={`px-3 py-2 font-terminal text-[9px] tabular-nums text-right ${p.isSignificant ? "text-[hsl(38,95%,55%)] font-bold" : "text-foreground"}`}>{fmt(p.residualCorrelation)}</td>
                      <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right text-muted-foreground">{fmt(p.rawCorrelation)}</td>
                      <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right text-muted-foreground">{p.pValue < 0.0001 ? "<0.0001" : fmt(p.pValue, 4)}</td>
                      <td className={`px-3 py-2 font-terminal text-[9px] text-right ${p.isSignificant ? "text-[hsl(142,71%,55%)]" : "text-muted-foreground"}`}>{p.isSignificant ? "YES" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-1.5 font-terminal text-[7.5px] text-muted-foreground/70">Each asset's returns are regressed against its beta to the top-{hiddenResult.componentsUsed} PCA factor score(s) (reusing the PCA tab's own eigendecomposition); the table correlates what's LEFT OVER after removing that shared structure. A pair with a large raw correlation that collapses in the residual column was only ever shared market/sector exposure. A pair with a meaningful residual correlation — especially one flagged significant via a two-tailed Fisher z-test on the residual correlation (H0: ρ=0, z=atanh(r), SE=1/√(n−3)) — is co-moving beyond what the dominant factor structure explains.</div>
          </div>
        </>
      )}
    </div>
  );
}

function PairsTab() {
  const [inputA, setInputA] = useTerminalArtifactState("PairsTab.inputA", "AAPL");
  const [inputB, setInputB] = useTerminalArtifactState("PairsTab.inputB", "MSFT");
  const [symA, setSymA] = useTerminalArtifactState("PairsTab.symA", "AAPL");
  const [symB, setSymB] = useTerminalArtifactState("PairsTab.symB", "MSFT");
  const [a, b] = useSymbolOHLCV([symA, symB]);

  // Cointegration/spread only means something when both legs are priced in
  // the same currency -- there's no historical FX-rate series wired up in
  // this app to normalize across currencies, so rather than silently
  // computing a hedge ratio and spread dominated by FX scale (e.g. AAPL in
  // USD vs RELIANCE.NS in INR, off by ~83x) the test is blocked with an
  // honest explanation instead of a misleading number.
  const currencyA = inferCurrencyFromSymbol(symA);
  const currencyB = inferCurrencyFromSymbol(symB);
  const currencyMismatch = currencyA !== currencyB;

  const result = useMemo(() => {
    if (currencyMismatch || !a.data || !b.data) return null;
    const { dates, closesA, closesB } = alignByDate(a.data.bars, b.data.bars);
    if (dates.length < 30) return null;
    const test = engleGrangerTest(closesA, closesB);
    const spreadSeries = dates.map((d, i) => ({ date: d.slice(5), spread: test.spread[i] }));
    return { test, spreadSeries };
  }, [a.data, b.data, currencyMismatch]);

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); setSymA(inputA.toUpperCase()); setSymB(inputB.toUpperCase()); }} className="flex items-center gap-2">
        <input value={inputA} onChange={(e) => setInputA(e.target.value)} placeholder="TICKER A..." className="bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <span className="font-terminal text-[9px] text-muted-foreground">vs</span>
        <input value={inputB} onChange={(e) => setInputB(e.target.value)} placeholder="TICKER B..." className="bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <button type="submit" className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground">TEST COINTEGRATION</button>
      </form>

      {a.isLoading || b.isLoading ? (
        <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : currencyMismatch ? (
        <div className="font-terminal text-[9px] text-[hsl(38,95%,55%)] border border-[hsl(38,95%,50%)/40%] bg-[hsl(38,95%,50%)/5%] p-3 leading-relaxed">
          {symA} is priced in {currencyA} and {symB} is priced in {currencyB} — the cointegration test needs both legs in the same currency, and this app doesn't have a historical FX-rate series wired up to normalize across them. Comparing raw prices across currencies would produce a hedge ratio and spread dominated by the FX rate, not genuine mean-reversion. Pick two tickers quoted in the same currency (e.g. both USD, or both INR).
        </div>
      ) : !result ? (
        <div className="font-terminal text-[9px] text-muted-foreground">NOT ENOUGH OVERLAPPING DATA FOR THIS PAIR.</div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">HEDGE RATIO</div>
              <div className="font-terminal text-[14px] font-bold tabular-nums text-foreground">{fmt(result.test.hedgeRatio, 3)}</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">ADF STATISTIC</div>
              <div className="font-terminal text-[14px] font-bold tabular-nums text-foreground">{fmt(result.test.adfStatistic, 2)}</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">VERDICT (~5% LEVEL)</div>
              <div className={`font-terminal text-[11px] font-bold ${result.test.isLikelyCointegrated ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{result.test.isLikelyCointegrated ? "LIKELY COINTEGRATED" : "NOT COINTEGRATED"}</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">CURRENT Z-SCORE</div>
              <div className={`font-terminal text-[14px] font-bold tabular-nums ${Math.abs(result.test.currentZScore) > 2 ? "text-[hsl(38,95%,55%)]" : "text-foreground"}`}>{fmt(result.test.currentZScore, 2)}</div>
            </div>
          </div>
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">SPREAD ({symA} − {fmt(result.test.hedgeRatio, 2)}×{symB})</div>
            <div className="h-40 border border-border bg-[#0a0a0a] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={result.spreadSeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs><linearGradient id="spreadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(186,80%,55%)" stopOpacity={0.25} /><stop offset="100%" stopColor="hsl(186,80%,55%)" stopOpacity={0} /></linearGradient></defs>
                  <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                  <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={40} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} />
                  <Area type="monotone" dataKey="spread" stroke="hsl(186,80%,55%)" strokeWidth={1.5} fill="url(#spreadFill)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1.5 font-terminal text-[7.5px] text-muted-foreground/70">ADF critical value ≈ -3.0 at the 5% level (MacKinnon approximation) — more negative means stronger evidence of mean-reversion. |Z| &gt; 2 is a common pairs-trade entry heuristic.</div>
          </div>
        </>
      )}
    </div>
  );
}

function BetaTab() {
  const [inputSym, setInputSym] = useTerminalArtifactState("BetaTab.inputSym", "AAPL");
  const [inputBench, setInputBench] = useTerminalArtifactState("BetaTab.inputBench", "^GSPC");
  const [symbol, setSymbol] = useTerminalArtifactState("BetaTab.symbol", "AAPL");
  const [bench, setBench] = useTerminalArtifactState("BetaTab.bench", "^GSPC");
  const [asset, market] = useSymbolOHLCV([symbol, bench]);

  const result = useMemo(() => {
    if (!asset.data || !market.data) return null;
    const { dates, closesA, closesB } = alignByDate(asset.data.bars, market.data.bars);
    if (dates.length < 30) return null;
    const retA = computeDailyReturns(closesA);
    const retB = computeDailyReturns(closesB);
    const kalman = kalmanDynamicBeta(retA, retB);
    const staticBeta = olsRegression(retA, [retB]).betas[0];
    const series = dates.slice(1).map((d, i) => ({ date: d.slice(5), beta: kalman.betas[i] }));
    return { series, staticBeta, currentBeta: kalman.betas[kalman.betas.length - 1] };
  }, [asset.data, market.data]);

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); setSymbol(inputSym.toUpperCase()); setBench(inputBench.toUpperCase()); }} className="flex items-center gap-2">
        <input value={inputSym} onChange={(e) => setInputSym(e.target.value)} placeholder="ASSET..." className="bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <span className="font-terminal text-[9px] text-muted-foreground">vs</span>
        <input value={inputBench} onChange={(e) => setInputBench(e.target.value)} placeholder="BENCHMARK..." className="bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <button type="submit" className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground">RUN KALMAN FILTER</button>
      </form>

      {asset.isLoading || market.isLoading ? (
        <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : !result ? (
        <div className="font-terminal text-[9px] text-muted-foreground">NOT ENOUGH OVERLAPPING DATA.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">CURRENT DYNAMIC BETA (KALMAN)</div>
              <div className="font-terminal text-[16px] font-bold tabular-nums text-[hsl(38,95%,55%)]">{fmt(result.currentBeta, 3)}</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">STATIC OLS BETA (WHOLE PERIOD)</div>
              <div className="font-terminal text-[16px] font-bold tabular-nums text-foreground">{fmt(result.staticBeta, 3)}</div>
            </div>
          </div>
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">BETA EVOLUTION OVER TIME</div>
            <div className="h-40 border border-border bg-[#0a0a0a] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={result.series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs><linearGradient id="betaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(38,95%,55%)" stopOpacity={0.25} /><stop offset="100%" stopColor="hsl(38,95%,55%)" stopOpacity={0} /></linearGradient></defs>
                  <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                  <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={40} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} />
                  <Area type="monotone" dataKey="beta" stroke="hsl(38,95%,55%)" strokeWidth={1.5} fill="url(#betaFill)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1.5 font-terminal text-[7.5px] text-muted-foreground/70">A Kalman filter lets beta adapt period-to-period instead of averaging over the whole window like a static OLS regression — useful when a stock's market sensitivity genuinely changes over time.</div>
          </div>
        </>
      )}
    </div>
  );
}

function RollingTab() {
  const [inputSym, setInputSym] = useTerminalArtifactState("RollingTab.inputSym", "AAPL");
  const [inputBench, setInputBench] = useTerminalArtifactState("RollingTab.inputBench", "^GSPC");
  const [symbol, setSymbol] = useTerminalArtifactState("RollingTab.symbol", "AAPL");
  const [bench, setBench] = useTerminalArtifactState("RollingTab.bench", "^GSPC");
  const [window, setWindowSize] = useTerminalArtifactState("RollingTab.window", 30);
  const [asset, market] = useSymbolOHLCV([symbol, bench]);

  const result = useMemo(() => {
    if (!asset.data || !market.data) return null;
    const { dates, closesA, closesB } = alignByDate(asset.data.bars, market.data.bars);
    if (dates.length < window + 5) return null;
    const retA = computeDailyReturns(closesA);
    const retB = computeDailyReturns(closesB);
    const vol = rollingVolatility(retA, window);
    const beta = rollingBeta(retA, retB, window);
    const corr = rollingCorrelation(retA, retB, window);
    const series = dates.slice(1).map((d, i) => ({ date: d.slice(5), vol: vol[i], beta: beta[i], corr: corr[i] }));
    return series;
  }, [asset.data, market.data, window]);

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); setSymbol(inputSym.toUpperCase()); setBench(inputBench.toUpperCase()); }} className="flex items-center gap-2">
        <input value={inputSym} onChange={(e) => setInputSym(e.target.value)} placeholder="ASSET..." className="bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <span className="font-terminal text-[9px] text-muted-foreground">vs</span>
        <input value={inputBench} onChange={(e) => setInputBench(e.target.value)} placeholder="BENCHMARK..." className="bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <button type="submit" className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground">UPDATE</button>
        <div className="flex border border-border ml-auto">
          {[20, 30, 60, 90].map((w) => (
            <button key={w} type="button" onClick={() => setWindowSize(w)} className={`px-2 py-1.5 font-terminal text-[8px] border-r border-border last:border-r-0 ${window === w ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground"}`}>{w}D</button>
          ))}
        </div>
      </form>

      {asset.isLoading || market.isLoading ? (
        <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : !result ? (
        <div className="font-terminal text-[9px] text-muted-foreground">NOT ENOUGH DATA FOR A {window}-DAY WINDOW.</div>
      ) : (
        <>
          {([
            { key: "vol" as const, label: `ROLLING VOLATILITY (${window}D, ANNUALIZED)`, color: "hsl(0,80%,60%)", fmt: (v: number) => `${v.toFixed(1)}%` },
            { key: "beta" as const, label: `ROLLING BETA (${window}D)`, color: "hsl(38,95%,55%)", fmt: (v: number) => v.toFixed(2) },
            { key: "corr" as const, label: `ROLLING CORRELATION (${window}D)`, color: "hsl(186,80%,55%)", fmt: (v: number) => v.toFixed(2) },
          ]).map((cfg) => (
            <div key={cfg.key}>
              <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">{cfg.label}</div>
              <div className="h-28 border border-border bg-[#0a0a0a] p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={result} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs><linearGradient id={`rollFill-${cfg.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={cfg.color} stopOpacity={0.25} /><stop offset="100%" stopColor={cfg.color} stopOpacity={0} /></linearGradient></defs>
                    <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                    <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={36} domain={["auto", "auto"]} tickFormatter={cfg.fmt} />
                    <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [cfg.fmt(v), cfg.key]} />
                    <Area type="monotone" dataKey={cfg.key} stroke={cfg.color} strokeWidth={1.5} fill={`url(#rollFill-${cfg.key})`} dot={false} connectNulls />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function CopulaTab() {
  const [inputA, setInputA] = useTerminalArtifactState("CopulaTab.inputA", "AAPL");
  const [inputB, setInputB] = useTerminalArtifactState("CopulaTab.inputB", "MSFT");
  const [symA, setSymA] = useTerminalArtifactState("CopulaTab.symA", "AAPL");
  const [symB, setSymB] = useTerminalArtifactState("CopulaTab.symB", "MSFT");
  const [a, b] = useSymbolOHLCV([symA, symB]);

  const result = useMemo((): CopulaFit | null => {
    if (!a.data || !b.data) return null;
    const { dates, closesA, closesB } = alignByDate(a.data.bars, b.data.bars);
    if (dates.length < 35) return null;
    const retA = computeDailyReturns(closesA);
    const retB = computeDailyReturns(closesB);
    try { return fitTCopula(retA, retB); } catch { return null; }
  }, [a.data, b.data]);

  const pearsonRho = useMemo(() => {
    if (!a.data || !b.data) return null;
    const { dates, closesA, closesB } = alignByDate(a.data.bars, b.data.bars);
    if (dates.length < 35) return null;
    const retA = computeDailyReturns(closesA);
    const retB = computeDailyReturns(closesB);
    const n = Math.min(retA.length, retB.length);
    const meanA = retA.slice(0, n).reduce((s, v) => s + v, 0) / n;
    const meanB = retB.slice(0, n).reduce((s, v) => s + v, 0) / n;
    let cov = 0, varA = 0, varB = 0;
    for (let i = 0; i < n; i++) { cov += (retA[i] - meanA) * (retB[i] - meanB); varA += (retA[i] - meanA) ** 2; varB += (retB[i] - meanB) ** 2; }
    return cov / Math.sqrt(varA * varB || 1e-12);
  }, [a.data, b.data]);

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); setSymA(inputA.toUpperCase()); setSymB(inputB.toUpperCase()); }} className="flex items-center gap-2">
        <input value={inputA} onChange={(e) => setInputA(e.target.value)} placeholder="TICKER A..." className="bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <span className="font-terminal text-[9px] text-muted-foreground">vs</span>
        <input value={inputB} onChange={(e) => setInputB(e.target.value)} placeholder="TICKER B..." className="bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <button type="submit" className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground">FIT T-COPULA</button>
      </form>

      {a.isLoading || b.isLoading ? (
        <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : !result ? (
        <div className="font-terminal text-[9px] text-muted-foreground">NOT ENOUGH OVERLAPPING DATA FOR THIS PAIR.</div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">COPULA ρ</div>
              <div className="font-terminal text-[14px] font-bold tabular-nums text-foreground">{fmt(result.rho, 3)}</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">PEARSON ρ (RETURNS)</div>
              <div className="font-terminal text-[14px] font-bold tabular-nums text-foreground">{fmt(pearsonRho, 3)}</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">FITTED DEGREES OF FREEDOM</div>
              <div className="font-terminal text-[14px] font-bold tabular-nums text-foreground">{result.degreesOfFreedom}</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">TAIL DEPENDENCE λ</div>
              <div className={`font-terminal text-[14px] font-bold tabular-nums ${result.tailDependence > 0.2 ? "text-[hsl(0,80%,60%)]" : result.tailDependence > 0.05 ? "text-[hsl(38,95%,55%)]" : "text-[hsl(142,71%,55%)]"}`}>{fmt(result.tailDependence, 3)}</div>
            </div>
          </div>
          <div className="border border-border bg-[#0a0a0a] p-3 font-terminal text-[9px] text-foreground leading-relaxed">
            λ = {(result.tailDependence * 100).toFixed(1)}% means: given one asset has an extreme crash, there's roughly a {(result.tailDependence * 100).toFixed(0)}% chance the other crashes with it in the same extreme tail -- a number Pearson correlation ({fmt(pearsonRho, 2)}) alone cannot tell you. A Gaussian copula would report exactly 0% here regardless of ρ, which is the well-known blind spot in modeling joint crash risk with correlation alone.
          </div>
          <div className="font-terminal text-[7.5px] text-muted-foreground/70">
            Fit via rank (Spearman) correlation → Gaussian copula ρ, then a Student-t copula degrees-of-freedom grid-search by maximum likelihood ({result.logLikelihood.toFixed(1)} log-lik at df={result.degreesOfFreedom}). Lower df = fatter joint tails = higher λ.
          </div>
        </>
      )}
    </div>
  );
}

function ForecastTab() {
  const [inputSym, setInputSym] = useTerminalArtifactState("ForecastTab.inputSym", "AAPL");
  const [symbol, setSymbol] = useTerminalArtifactState("ForecastTab.symbol", "AAPL");
  const [model, setModel] = useTerminalArtifactState<"holtwinters" | "arima">("ForecastTab.model", "holtwinters");
  const [horizon, setHorizon] = useTerminalArtifactState("ForecastTab.horizon", 30);
  const [asset] = useSymbolOHLCV([symbol], "2Y");

  const result = useMemo(() => {
    const bars = asset.data?.bars;
    if (!bars || bars.length < 60) return null;
    const closes = bars.map((b) => b.close);
    const dates = bars.map((b) => b.date);

    if (model === "holtwinters") {
      try {
        const fit = fitHoltWinters(closes, 0);
        return { kind: "hw" as const, fit, forecast: forecastHoltWinters(fit, horizon), closes, dates };
      } catch { return null; }
    } else {
      try {
        const fit = autoARIMA(closes, 3, 2, 3);
        return { kind: "arima" as const, fit, forecast: forecastARIMA(fit, horizon), closes, dates };
      } catch { return null; }
    }
  }, [asset.data, model, horizon]);

  const chartData = useMemo(() => {
    if (!result) return [];
    const histTail = 90;
    const hist = result.closes.slice(-histTail).map((c, i) => ({
      label: result.dates[result.dates.length - histTail + i]?.slice(5) ?? "",
      actual: c,
      forecast: null as number | null,
    }));
    if (hist.length > 0) hist[hist.length - 1].forecast = hist[hist.length - 1].actual;
    const fut = result.forecast.map((v, i) => ({ label: `+${i + 1}D`, actual: null as number | null, forecast: v }));
    return [...hist, ...fut];
  }, [result]);

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); setSymbol(inputSym.toUpperCase()); }} className="flex items-center gap-2 flex-wrap">
        <input value={inputSym} onChange={(e) => setInputSym(e.target.value)} placeholder="TICKER..." className="bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        <button type="submit" className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground">RUN FORECAST</button>
        <div className="flex border border-border ml-auto">
          {([["holtwinters", "HOLT-WINTERS"], ["arima", "ARIMA (AUTO)"]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setModel(key)} className={`px-2 py-1.5 font-terminal text-[8px] border-r border-border last:border-r-0 ${model === key ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground"}`}>{label}</button>
          ))}
        </div>
        <div className="flex border border-border">
          {[10, 30, 60].map((h) => (
            <button key={h} type="button" onClick={() => setHorizon(h)} className={`px-2 py-1.5 font-terminal text-[8px] border-r border-border last:border-r-0 ${horizon === h ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground"}`}>{h}D</button>
          ))}
        </div>
      </form>

      {asset.isLoading ? (
        <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : !result ? (
        <div className="font-terminal text-[9px] text-muted-foreground">NOT ENOUGH HISTORY TO FIT A FORECAST MODEL FOR {symbol}.</div>
      ) : (
        <>
          <div className="h-56 border border-border bg-[#0a0a0a] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="fcHist" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(38,95%,55%)" stopOpacity={0.2} /><stop offset="100%" stopColor="hsl(38,95%,55%)" stopOpacity={0} /></linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={30} />
                <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={44} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number, name: string) => [v?.toFixed(2), name === "actual" ? "Actual" : "Forecast"]} />
                <Area type="monotone" dataKey="actual" stroke="hsl(38,95%,55%)" strokeWidth={1.5} fill="url(#fcHist)" dot={false} connectNulls={false} name="actual" />
                <Area type="monotone" dataKey="forecast" stroke="hsl(186,80%,55%)" strokeWidth={1.5} strokeDasharray="4 2" fill="none" dot={false} connectNulls name="forecast" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {result.kind === "hw" ? (
            <div className="grid grid-cols-3 gap-1.5">
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">α (LEVEL SMOOTHING)</div>
                <div className="font-terminal text-[14px] font-bold tabular-nums text-foreground">{fmt(result.fit.alpha, 3)}</div>
              </div>
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">β (TREND SMOOTHING)</div>
                <div className="font-terminal text-[14px] font-bold tabular-nums text-foreground">{fmt(result.fit.beta, 3)}</div>
              </div>
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">{horizon}D TARGET</div>
                <div className="font-terminal text-[14px] font-bold tabular-nums text-[hsl(186,80%,60%)]">{fmt(result.forecast[result.forecast.length - 1], 2)}</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">ORDER (p,d,q)</div>
                <div className="font-terminal text-[14px] font-bold tabular-nums text-foreground">({result.fit.p},{result.fit.d},{result.fit.q})</div>
              </div>
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">AICc</div>
                <div className="font-terminal text-[14px] font-bold tabular-nums text-foreground">{fmt(result.fit.aicc, 1)}</div>
              </div>
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">φ (AR COEFS)</div>
                <div className="font-terminal text-[11px] font-bold tabular-nums text-foreground">{result.fit.phi.length ? result.fit.phi.map((v) => v.toFixed(2)).join(", ") : "—"}</div>
              </div>
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">{horizon}D TARGET</div>
                <div className="font-terminal text-[14px] font-bold tabular-nums text-[hsl(186,80%,60%)]">{fmt(result.forecast[result.forecast.length - 1], 2)}</div>
              </div>
            </div>
          )}

          <div className="font-terminal text-[7.5px] text-muted-foreground/70 leading-relaxed">
            {result.kind === "hw"
              ? "Holt's linear method (double exponential smoothing): level and trend are re-estimated each period, with α/β controlling how fast each adapts to new data. It has no mean-reversion term, so forecasts extrapolate the most recent trend indefinitely -- treat longer horizons with more skepticism."
              : "ARIMA order is chosen automatically: the differencing order d is set by an ADF stationarity test (comparing AIC directly across different d isn't statistically valid), then (p,q) is chosen by corrected AIC (AICc) at that fixed d. Forecasts revert toward the model's implied mean/trend as the horizon lengthens, unlike Holt-Winters' straight-line extrapolation."}
            {" "}Neither model uses any information the market doesn't already have -- treat this as a statistical baseline, not a prediction of future price.
          </div>
        </>
      )}
    </div>
  );
}

// First quant engine backed by the Python sidecar (server/pythonService.ts)
// rather than a hand-reimplemented TS formula -- real QuantLib bond math
// (day-count conventions, duration, convexity), not an approximation.
function BondPricingTab() {
  const [faceValue, setFaceValue] = useTerminalArtifactState("BondPricingTab.faceValue", "1000");
  const [couponRatePct, setCouponRatePct] = useTerminalArtifactState("BondPricingTab.couponRatePct", "5");
  const [frequency, setFrequency] = useTerminalArtifactState<"1" | "2" | "4" | "12">("BondPricingTab.frequency", "2");
  const [yearsToMaturity, setYearsToMaturity] = useTerminalArtifactState("BondPricingTab.yearsToMaturity", "10");
  const [marketYieldPct, setMarketYieldPct] = useTerminalArtifactState("BondPricingTab.marketYieldPct", "4.5");
  const [dayCount, setDayCount] = useTerminalArtifactState<"30/360" | "ACT/ACT" | "ACT/360" | "ACT/365">("BondPricingTab.dayCount", "30/360");
  const [result, setResult, postOriginal] = useOriginalQuantResult<BondPriceResult>("qwb.bond");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function priceBond(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await postOriginal("/api/quant/fixed-income/bond-price", {
        faceValue: Number(faceValue), couponRatePct: Number(couponRatePct), frequency: Number(frequency),
        yearsToMaturity: Number(yearsToMaturity), marketYieldPct: Number(marketYieldPct), dayCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bond pricing engine unavailable right now.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";

  return (
    <div className="space-y-4">
      <form onSubmit={priceBond} className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">FACE VALUE</span>
          <input value={faceValue} onChange={(e) => setFaceValue(e.target.value)} inputMode="decimal" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">COUPON RATE %</span>
          <input value={couponRatePct} onChange={(e) => setCouponRatePct(e.target.value)} inputMode="decimal" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MARKET YIELD %</span>
          <input value={marketYieldPct} onChange={(e) => setMarketYieldPct(e.target.value)} inputMode="decimal" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">YEARS TO MATURITY</span>
          <input value={yearsToMaturity} onChange={(e) => setYearsToMaturity(e.target.value)} inputMode="decimal" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">COUPON FREQUENCY</span>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} className={inputCls}>
            <option value="1">ANNUAL</option>
            <option value="2">SEMIANNUAL</option>
            <option value="4">QUARTERLY</option>
            <option value="12">MONTHLY</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">DAY COUNT</span>
          <select value={dayCount} onChange={(e) => setDayCount(e.target.value as typeof dayCount)} className={inputCls}>
            <option value="30/360">30/360</option>
            <option value="ACT/ACT">ACT/ACT</option>
            <option value="ACT/360">ACT/360</option>
            <option value="ACT/365">ACT/365</option>
          </select>
        </label>
        <button type="submit" disabled={loading} className="col-span-2 sm:col-span-3 px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50">
          {loading ? "PRICING..." : "PRICE BOND"}
        </button>
      </form>

      {error && <div className="font-terminal text-[9px] text-red-400">{error}</div>}

      {result && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {[
              ["CLEAN PRICE", `${fmt(result.cleanPricePct, 3)}% / ${result.cleanPriceAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`],
              ["DIRTY PRICE", `${fmt(result.dirtyPricePct, 3)}% / ${result.dirtyPriceAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`],
              ["ACCRUED INTEREST", result.accruedInterestAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })],
              ["MATURITY", result.maturityDate],
              ["MACAULAY DURATION", `${fmt(result.macaulayDuration, 3)} yrs`],
              ["MODIFIED DURATION", `${fmt(result.modifiedDuration, 3)} yrs`],
              ["CONVEXITY", fmt(result.convexityValue, 3)],
              ["DV01", result.dv01Amount.toLocaleString(undefined, { maximumFractionDigits: 4 })],
            ].map(([label, value]) => (
              <div key={label} className="border border-border p-2.5">
                <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{label}</div>
                <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          <div className="font-terminal text-[7.5px] text-muted-foreground/70">
            Recorded QuantLib bond calculation (settlement {result.settlementDateUsed ?? "not recorded"}, {result.dayCountUsed} day-count convention) — clean/dirty price shown both as % of par and in the submitted face-value units. Modified duration and convexity describe the recorded run, not edited terms or a prediction of future yields. Explicit Price Bond creates a new run.
          </div>
          <ReceiptSummary receipt={result.receipt}/>
        </>
      )}
    </div>
  );
}

type PortfolioMethod = "min-variance" | "max-sharpe" | "risk-parity" | "max-diversification" | "efficient-frontier" | "mean-cvar";
const PORTFOLIO_METHODS: { key: PortfolioMethod; label: string; path: string }[] = [
  { key: "max-sharpe", label: "MAX SHARPE", path: "/api/quant/portfolio/max-sharpe" },
  { key: "min-variance", label: "MIN VARIANCE", path: "/api/quant/portfolio/min-variance" },
  { key: "risk-parity", label: "RISK PARITY (ERC)", path: "/api/quant/portfolio/risk-parity" },
  { key: "max-diversification", label: "MAX DIVERSIFICATION", path: "/api/quant/portfolio/max-diversification" },
  { key: "efficient-frontier", label: "EFFICIENT FRONTIER", path: "/api/quant/portfolio/efficient-frontier" },
  { key: "mean-cvar", label: "MEAN-CVAR", path: "/api/quant/portfolio/mean-cvar" },
];

interface WeightsResult {
  weights: Record<string, number>;
  expectedReturnPct: number;
  volatilityPct?: number;
  cvarPct?: number;
  sharpeRatio?: number | null;
}

interface FrontierResult {
  points: { expectedReturnPct: number; volatilityPct: number; weights: Record<string, number> }[];
}

// Second engine backed by the Python sidecar (after Fixed Income) -- real
// scipy.optimize constrained solvers (SLSQP for the mean-variance family,
// linprog for Mean-CVaR), the kind of numerically robust constrained
// optimization that's genuinely hard to hand-reimplement correctly in TS.
// Ported from LIMURIA_ENGINES' engines/06_optimization_engine.py, minus its
// two non-real functions (black_litterman_optimization, already covered by
// quantModels.ts's own blackLitterman(); mean_cvar_optimization, which was
// a literal mock there -- rebuilt properly here via the real Rockafellar-
// Uryasev LP formulation, see python-service/portfolio_optimization.py).
function PortfolioOptimizerTab() {
  const [tickerInput, setTickerInput] = useTerminalArtifactState("PortfolioOptimizerTab.tickerInput", "AAPL,MSFT,GOOGL,AMZN,META");
  const [symbols, setSymbols] = useTerminalArtifactState("PortfolioOptimizerTab.symbols", tickerInput.split(",").map((s) => s.trim().toUpperCase()));
  const [method, setMethod] = useTerminalArtifactState<PortfolioMethod>("PortfolioOptimizerTab.method", "max-sharpe");
  const [riskFreeRatePct, setRiskFreeRatePct] = useTerminalArtifactState("PortfolioOptimizerTab.riskFreeRatePct", "4");
  const [confidence, setConfidence] = useTerminalArtifactState("PortfolioOptimizerTab.confidence", "95");
  const [result, setResult, postOriginal] = useOriginalQuantResult<WeightsResult | FrontierResult>(`qwb.portfolio.${method}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ohlcv = useSymbolOHLCV(symbols);
  const isLoading = ohlcv.some((r) => r.isLoading);

  const inputs = useMemo(() => {
    if (isLoading || ohlcv.some((r) => !r.data)) return null;
    const returnSeries = ohlcv.map((r) => computeDailyReturns((r.data!.bars ?? []).map((b) => b.close)));
    const minLen = Math.min(...returnSeries.map((s) => s.length));
    if (minLen < 30) return null;
    const trimmed = returnSeries.map((s) => s.slice(-minLen));
    const expectedReturns = trimmed.map((s) => (s.reduce((a, b) => a + b, 0) / s.length) * 252);
    const covDaily = computeCovarianceMatrix(trimmed);
    const covMatrix = covDaily.map((row) => row.map((v) => v * 252));
    const assetVolsPct = covMatrix.map((row, i) => Math.sqrt(Math.max(0, row[i])));
    // Scenario matrix for Mean-CVaR: rows = time, columns = assets (transpose of `trimmed`).
    const returnsMatrixPct = trimmed[0].map((_, t) => trimmed.map((series) => series[t]));
    return { assets: symbols, expectedReturns, covMatrix, assetVolsPct, returnsMatrixPct };
  }, [ohlcv, isLoading, symbols]);

  // Component/marginal VaR contribution per asset -- reuses the already-loaded
  // covariance matrix and the optimizer's own output weights, no extra
  // network call. Native TS (client/src/lib/quantModels.ts's
  // riskDecomposition()), not a sidecar hop -- it's a closed-form matrix
  // computation, not a simulation.
  const decomposition = useMemo(() => {
    if (!result || method === "efficient-frontier") return null;
    const recorded = originalRunParameters(result);
    const calculation = recorded ? { assets: recorded.assets as string[], covMatrix: recorded.covMatrix as number[][] } : inputs;
    if (!calculation?.covMatrix) return null;
    const weightsResult = result as WeightsResult;
    const weights = calculation.assets.map(asset => weightsResult.weights[asset] ?? 0);
    return riskDecomposition(calculation.assets, weights, calculation.covMatrix);
  }, [result, method, inputs]);

  async function runOptimize() {
    if (!inputs) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const methodDef = PORTFOLIO_METHODS.find((m) => m.key === method)!;
    let body: unknown;
    switch (method) {
      case "min-variance":
        body = { assets: inputs.assets, expectedReturns: inputs.expectedReturns, covMatrix: inputs.covMatrix, allowShort: false };
        break;
      case "max-sharpe":
        body = { assets: inputs.assets, expectedReturns: inputs.expectedReturns, covMatrix: inputs.covMatrix, allowShort: false, riskFreeRatePct: Number(riskFreeRatePct) };
        break;
      case "risk-parity":
        body = { assets: inputs.assets, covMatrix: inputs.covMatrix };
        break;
      case "max-diversification":
        body = { assets: inputs.assets, covMatrix: inputs.covMatrix, assetVolsPct: inputs.assetVolsPct };
        break;
      case "efficient-frontier":
        body = { assets: inputs.assets, expectedReturns: inputs.expectedReturns, covMatrix: inputs.covMatrix, nPoints: 15, allowShort: false };
        break;
      case "mean-cvar":
        body = { assets: inputs.assets, returnsMatrixPct: inputs.returnsMatrixPct, confidence: Number(confidence), allowShort: false };
        break;
    }
    try {
      await postOriginal(methodDef.path, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Portfolio optimizer unavailable right now.");
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";
  const isFrontier = method === "efficient-frontier";
  const isCvar = method === "mean-cvar";

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); setSymbols(tickerInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)); setResult(null); }} className="flex items-center gap-2">
        <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)} placeholder="COMMA-SEPARATED TICKERS..." className={`flex-1 ${inputCls}`} />
        <button type="submit" className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground">LOAD</button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <select value={method} onChange={(e) => { setMethod(e.target.value as PortfolioMethod); setResult(null); }} className={inputCls}>
          {PORTFOLIO_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        {method === "max-sharpe" && (
          <label className="flex items-center gap-1.5">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">RISK-FREE %</span>
            <input value={riskFreeRatePct} onChange={(e) => setRiskFreeRatePct(e.target.value)} inputMode="decimal" className={`w-16 ${inputCls}`} />
          </label>
        )}
        {isCvar && (
          <label className="flex items-center gap-1.5">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">CONFIDENCE %</span>
            <input value={confidence} onChange={(e) => setConfidence(e.target.value)} inputMode="decimal" className={`w-16 ${inputCls}`} />
          </label>
        )}
        <button onClick={runOptimize} disabled={!inputs || loading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50">
          {loading ? "OPTIMIZING..." : "RUN OPTIMIZER"}
        </button>
      </div>

      {isLoading ? (
        <div className="font-terminal text-[9px] text-muted-foreground">LOADING PRICE HISTORY...</div>
      ) : !inputs ? (
        <div className="font-terminal text-[9px] text-muted-foreground">NOT ENOUGH OVERLAPPING DATA FOR THIS BASKET.</div>
      ) : null}

      {error && <div className="font-terminal text-[9px] text-red-400">{error}</div>}
      <RecordedOriginalRun result={result}/>

      {result && !isFrontier && (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <div className="border border-border p-2.5">
              <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">EXPECTED RETURN</div>
              <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{fmt((result as WeightsResult).expectedReturnPct, 2)}%</div>
            </div>
            {isCvar ? (
              <div className="border border-border p-2.5">
                <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">CVAR ({confidence}%)</div>
                <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{fmt((result as WeightsResult).cvarPct, 2)}%</div>
              </div>
            ) : (
              <div className="border border-border p-2.5">
                <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">VOLATILITY (ANN.)</div>
                <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{fmt((result as WeightsResult).volatilityPct, 2)}%</div>
              </div>
            )}
            <div className="border border-border p-2.5">
              <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">SHARPE</div>
              <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{(result as WeightsResult).sharpeRatio != null ? fmt((result as WeightsResult).sharpeRatio, 2) : "—"}</div>
            </div>
          </div>
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">OPTIMAL WEIGHTS</div>
            <div className="space-y-1.5">
              {Object.entries((result as WeightsResult).weights).map(([asset, w]) => (
                <div key={asset} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 font-terminal text-[9px] font-bold text-muted-foreground">{asset}</span>
                  <span className="flex-1 h-4 bg-[#111] relative overflow-hidden">
                    <span className="absolute inset-y-0 left-0 bg-[hsl(38,80%,45%)]" style={{ width: `${Math.max(0, Math.min(100, w * 100))}%` }} />
                  </span>
                  <span className="w-14 shrink-0 text-right font-terminal text-[9px] tabular-nums text-foreground">{fmt(w * 100, 1)}%</span>
                </div>
              ))}
            </div>
          </div>
          {decomposition && (
            <div>
              <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">RISK DECOMPOSITION (COMPONENT VOL)</div>
              <div className="border border-border">
                <table className="w-full border-collapse">
                  <thead><tr className="border-b border-border bg-[#070707]">
                    <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">ASSET</th>
                    <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">WEIGHT</th>
                    <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">MARGINAL VAR</th>
                    <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">COMPONENT VOL</th>
                    <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">% OF TOTAL RISK</th>
                  </tr></thead>
                  <tbody>
                    {decomposition.map((row) => (
                      <tr key={row.asset} className="border-b border-border/30 last:border-b-0">
                        <td className="px-3 py-2 font-terminal text-[9px] font-bold text-foreground">{row.asset}</td>
                        <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(row.weight * 100, 1)}%</td>
                        <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(row.marginalVaR, 3)}</td>
                        <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(row.componentVaR, 3)}</td>
                        <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(row.componentPct, 1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-1.5 font-terminal text-[7.5px] text-muted-foreground/70">Component vol sums exactly to total portfolio volatility above -- a position can carry more risk than its weight suggests if it's poorly diversifying (high correlation to the rest of the book).</div>
            </div>
          )}
        </>
      )}

      {result && isFrontier && (result as FrontierResult).points.length > 0 && (
        <div>
          <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">RISK / RETURN TRADEOFF</div>
          <div className="h-56 border border-border p-2">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="#222" strokeDasharray="2 2" />
                <XAxis type="number" dataKey="volatilityPct" name="Volatility" unit="%" tick={{ fontSize: 8, fill: "#888" }} />
                <YAxis type="number" dataKey="expectedReturnPct" name="Return" unit="%" tick={{ fontSize: 8, fill: "#888" }} />
                <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #333", fontSize: 9 }} formatter={(v: number) => `${fmt(v, 2)}%`} />
                <Scatter data={(result as FrontierResult).points} fill="hsl(38,80%,50%)" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function parseNumList(input: string): number[] {
  // Blank segments are filtered BEFORE Number(...), not after: Number("")
  // is 0 (a valid finite number in JS), not NaN, so an empty or
  // whitespace-only string previously parsed to [0] instead of [] --
  // found live when clearing X2 for a 2-ticker OLS load left a stray
  // single-element [0] column and the sidecar correctly rejected it
  // ("Array must contain at least 3 elements").
  return input.split(",").map((s) => s.trim()).filter((s) => s.length > 0).map(Number).filter((n) => Number.isFinite(n));
}

function requiredManualNumbers(input: string): number[] {
  const fields = input.split(",").map(value => value.trim());
  if (fields.some(value => !value || !Number.isFinite(Number(value)))) throw new Error("Each submitted manual observation must be a finite number; blank or invalid rows are not dropped.");
  return fields.map(Number);
}

// Real-scale data entry, not a toy 5-row demo: a consultant with a client-
// provided debt schedule/loan tape pastes or uploads the actual CSV
// (name,pd_pct,lgd_pct,ead columns, header optional) instead of hand-typing
// a handful of comma-separated numbers. Parses into the same four
// comma-joined strings the manual-entry inputs already use, so a CSV load
// and a hand-typed edit are interchangeable -- upload pre-fills, the
// existing fields stay editable afterward.
interface ParsedObligorCsv {
  names: string[];
  pdPct: number[];
  lgdPct: number[];
  ead: number[];
}

function parseObligorCsv(text: string): ParsedObligorCsv {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const names: string[] = [];
  const pdPct: number[] = [];
  const lgdPct: number[] = [];
  const ead: number[] = [];
  for (const line of lines) {
    const cols = line.split(",").map((c) => c.trim());
    if (cols.length < 4) continue;
    const [name, pd, lgd, e] = cols;
    const pdNum = Number(pd), lgdNum = Number(lgd), eadNum = Number(e);
    if (!Number.isFinite(pdNum) || !Number.isFinite(lgdNum) || !Number.isFinite(eadNum)) continue; // skips a header row too
    names.push(name);
    pdPct.push(pdNum);
    lgdPct.push(lgdNum);
    ead.push(eadNum);
  }
  return { names, pdPct, lgdPct, ead };
}

interface CreditVarResult {
  expectedLoss: number;
  creditVarAtConfidence: number;
  unexpectedLoss: number;
  worstObligorContributionPct: number;
}

// Original Python credit VaR and original TypeScript CVA share canonical run custody.
function CreditRiskTab() {
  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";

  // ── Credit VaR (Monte Carlo, Python sidecar) ──
  const [obligorsInput, setObligorsInput] = useTerminalArtifactState("CreditRiskTab.obligorsInput", "BorrowerA,BorrowerB,BorrowerC,BorrowerD,BorrowerE");
  const [pdInput, setPdInput] = useTerminalArtifactState("CreditRiskTab.pdInput", "2.0,1.5,3.0,1.0,5.0");
  const [lgdInput, setLgdInput] = useTerminalArtifactState("CreditRiskTab.lgdInput", "45,45,45,45,45");
  const [eadInput, setEadInput] = useTerminalArtifactState("CreditRiskTab.eadInput", "10000000,2000000,1500000,3000000,1000000");
  const [assetCorr, setAssetCorr] = useTerminalArtifactState("CreditRiskTab.assetCorr", "20");
  const [cvConfidence, setCvConfidence] = useTerminalArtifactState("CreditRiskTab.cvConfidence", "99");
  const [cvResult, setCvResult, postOriginal] = useOriginalQuantResult<CreditVarResult>("qwb.credit.credit-var");
  const [cvLoading, setCvLoading] = useState(false);
  const [cvError, setCvError] = useState<string | null>(null);
  const [cvUploadCount, setCvUploadCount] = useState<number | null>(null);

  function handleObligorCsvUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseObligorCsv(String(reader.result ?? ""));
      if (parsed.names.length === 0) {
        setCvError("Couldn't find any valid rows -- expected columns: name,pd_pct,lgd_pct,ead");
        return;
      }
      setObligorsInput(parsed.names.join(","));
      setPdInput(parsed.pdPct.join(","));
      setLgdInput(parsed.lgdPct.join(","));
      setEadInput(parsed.ead.join(","));
      setCvUploadCount(parsed.names.length);
      setCvError(null);
      setCvResult(null);
    };
    reader.readAsText(file);
    e.target.value = ""; // allow re-uploading the same file path
  }

  async function runCreditVar() {
    const obligors = obligorsInput.split(",").map((s) => s.trim()).filter(Boolean);
    const pdPct = parseNumList(pdInput);
    const lgdPct = parseNumList(lgdInput);
    const ead = parseNumList(eadInput);
    if (obligors.length === 0 || obligors.length !== pdPct.length || obligors.length !== lgdPct.length || obligors.length !== ead.length) {
      setCvError("Obligors, PD%, LGD%, and EAD lists must all have the same length.");
      return;
    }
    setCvLoading(true);
    setCvError(null);
    setCvResult(null);
    try {
      await postOriginal("/api/quant/credit/credit-var", {
        obligors, pdPct, lgdPct, ead, assetCorrelation: Number(assetCorr) / 100,
        confidence: Number(cvConfidence), nSims: 50000, seed: 42,
      });
    } catch (err) {
      setCvError(err instanceof Error ? err.message : "Credit risk engine unavailable right now.");
    } finally {
      setCvLoading(false);
    }
  }

  // ── Counterparty CVA (closed-form, native TS) ──
  const [exposureInput, setExposureInput] = useTerminalArtifactState("CreditRiskTab.exposureInput", "5000000,4500000,4000000,3200000,2500000");
  const [pdCurveInput, setPdCurveInput] = useTerminalArtifactState("CreditRiskTab.pdCurveInput", "0.5,0.6,0.7,0.8,0.9");
  const [lgdPctInput, setLgdPctInput] = useTerminalArtifactState("CreditRiskTab.lgdPctInput", "60");
  const [discountRateInput, setDiscountRateInput] = useTerminalArtifactState("CreditRiskTab.discountRateInput", "5");

  const [cvaResult, , postCva] = useOriginalQuantResult<{ cva: number; receipt?: AdvancedReceipt }>("qwb.credit.cva");
  const [cvaRunning, setCvaRunning] = useState(false);
  const [cvaError, setCvaError] = useState<string | null>(null);
  async function runCva() {
    setCvaRunning(true); setCvaError(null);
    try {
      const exposureProfile = requiredManualNumbers(exposureInput);
      const rate = Number(discountRateInput) / 100;
      if (!discountRateInput.trim() || !lgdPctInput.trim()) throw new Error("Enter the stated discount rate and LGD; blank values are not zero.");
      await postCva("/api/quant/risk/manual-original", { method: "cva", exposureProfile, pdCurvePct: requiredManualNumbers(pdCurveInput), lgdPct: Number(lgdPctInput), discountFactors: exposureProfile.map((_, t) => 1 / Math.pow(1 + rate, t + 1)) });
    } catch (error) { setCvaError(error instanceof Error ? error.message : "Original CVA unavailable."); }
    finally { setCvaRunning(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="font-terminal text-[9px] text-muted-foreground tracking-widest">CREDIT VAR — MONTE CARLO (SINGLE-FACTOR GAUSSIAN COPULA)</div>
          <label className="flex items-center gap-1.5 px-2 py-1 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[7.5px] text-muted-foreground cursor-pointer">
            <Upload className="w-3 h-3" />
            UPLOAD LOAN TAPE (CSV)
            <input type="file" accept=".csv,text/csv" onChange={handleObligorCsvUpload} className="hidden" />
          </label>
        </div>
        {cvUploadCount != null && (
          <div className="mb-2 font-terminal text-[8px] text-[hsl(38,95%,55%)]">Loaded {cvUploadCount.toLocaleString()} obligors from file.</div>
        )}
        <div className="mb-2 font-terminal text-[7px] text-muted-foreground/70">CSV columns: name, pd_pct, lgd_pct, ead (header row optional) — up to 2,000 rows. Or edit the fields below directly for a quick what-if.</div>
        <div className="grid grid-cols-1 gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">OBLIGORS (COMMA-SEPARATED)</span>
            <input value={obligorsInput} onChange={(e) => { setObligorsInput(e.target.value); setCvUploadCount(null); }} className={inputCls} />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">PD % (PER OBLIGOR)</span>
              <input value={pdInput} onChange={(e) => setPdInput(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">LGD % (PER OBLIGOR)</span>
              <input value={lgdInput} onChange={(e) => setLgdInput(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">EAD $ (PER OBLIGOR)</span>
              <input value={eadInput} onChange={(e) => setEadInput(e.target.value)} className={inputCls} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">AVG ASSET CORRELATION %</span>
              <input value={assetCorr} onChange={(e) => setAssetCorr(e.target.value)} inputMode="decimal" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">CONFIDENCE %</span>
              <input value={cvConfidence} onChange={(e) => setCvConfidence(e.target.value)} inputMode="decimal" className={inputCls} />
            </label>
          </div>
          <button onClick={runCreditVar} disabled={cvLoading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50 self-start">
            {cvLoading ? "SIMULATING (50,000 PATHS)..." : "RUN CREDIT VAR"}
          </button>
        </div>
        {cvError && <div className="mt-2 font-terminal text-[9px] text-red-400">{cvError}</div>}
        <RecordedOriginalRun result={cvResult}/>
        {cvResult && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-3">
            {[
              ["EXPECTED LOSS", cvResult.expectedLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })],
              [`CREDIT VAR @ ${cvConfidence}%`, cvResult.creditVarAtConfidence.toLocaleString(undefined, { maximumFractionDigits: 0 })],
              ["UNEXPECTED LOSS", cvResult.unexpectedLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })],
              ["LARGEST OBLIGOR SHARE", `${fmt(cvResult.worstObligorContributionPct, 1)}%`],
            ].map(([label, value]) => (
              <div key={label} className="border border-border p-2.5">
                <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{label}</div>
                <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-border/40">
        <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">COUNTERPARTY CVA</div>
        <div className="grid grid-cols-1 gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">EXPECTED EXPOSURE PROFILE $ (PER PERIOD)</span>
            <input value={exposureInput} onChange={(e) => setExposureInput(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">PD CURVE % (PER PERIOD)</span>
            <input value={pdCurveInput} onChange={(e) => setPdCurveInput(e.target.value)} className={inputCls} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">LGD %</span>
              <input value={lgdPctInput} onChange={(e) => setLgdPctInput(e.target.value)} inputMode="decimal" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">DISCOUNT RATE %</span>
              <input value={discountRateInput} onChange={(e) => setDiscountRateInput(e.target.value)} inputMode="decimal" className={inputCls} />
            </label>
          </div>
        </div>
        <button disabled={cvaRunning} onClick={runCva} className="border border-border px-3 py-2 mt-2 text-xs">{cvaRunning ? "Running original CVA…" : "Run original CVA"}</button>
        {cvaError && <div role="alert" className="text-destructive text-xs">{cvaError}</div>}
        {cvaResult && <RecordedOriginalRun result={cvaResult}/>}
        {cvaResult && (
          <div className="border border-border p-2.5 mt-3 w-fit">
            <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">CVA (VALUATION REDUCTION)</div>
            <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{cvaResult.cva.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
        )}
        <div className="mt-1.5 font-terminal text-[7.5px] text-muted-foreground/70">Standard expected-exposure CVA approximation: LGD x sum(exposure_t x PD_t x discount factor_t). Not a full wrong-way-risk model, which would need a joint exposure/default simulation.</div>
      </div>
    </div>
  );
}

interface OperationalRiskResult {
  expectedAnnualLoss: number;
  opRiskVarAtConfidence: number;
  unexpectedLoss: number;
}

// Original Python operational LDA and original TypeScript liquidation-cost formula.
function OpRiskLiquidityTab() {
  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";

  // ── Operational Risk LDA (Monte Carlo, Python sidecar) ──
  const [annualFreq, setAnnualFreq] = useTerminalArtifactState("OpRiskLiquidityTab.annualFreq", "12");
  const [severityMu, setSeverityMu] = useTerminalArtifactState("OpRiskLiquidityTab.severityMu", "9.0");
  const [severitySigma, setSeveritySigma] = useTerminalArtifactState("OpRiskLiquidityTab.severitySigma", "1.5");
  const [opConfidence, setOpConfidence] = useTerminalArtifactState("OpRiskLiquidityTab.opConfidence", "99");
  const [opResult, setOpResult, postOriginal] = useOriginalQuantResult<OperationalRiskResult>("qwb.credit.operational-risk-lda");
  const [opLoading, setOpLoading] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);

  async function runOpRisk() {
    setOpLoading(true);
    setOpError(null);
    setOpResult(null);
    try {
      await postOriginal("/api/quant/credit/operational-risk-lda", {
        annualFrequency: Number(annualFreq), severityMu: Number(severityMu), severitySigma: Number(severitySigma),
        confidence: Number(opConfidence), nSims: 20000, seed: 42,
      });
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "Operational risk engine unavailable right now.");
    } finally {
      setOpLoading(false);
    }
  }

  // ── Liquidity cost estimate (closed-form, native TS) ──
  const [spreadInput, setSpreadInput] = useTerminalArtifactState("OpRiskLiquidityTab.spreadInput", "0.05,0.10,0.25,0.40");
  const [positionInput, setPositionInput] = useTerminalArtifactState("OpRiskLiquidityTab.positionInput", "2000000,1500000,800000,300000");
  const [liquidityResult, , postLiquidity] = useOriginalQuantResult<{ estimatedCost: number; receipt?: AdvancedReceipt }>("qwb.credit.liquidity-cost");
  const [liquidityRunning, setLiquidityRunning] = useState(false);
  const [liquidityError, setLiquidityError] = useState<string | null>(null);
  const liquidityCost = liquidityResult?.estimatedCost ?? null;
  async function runLiquidity() {
    setLiquidityRunning(true); setLiquidityError(null);
    try { await postLiquidity("/api/quant/risk/manual-original", { method: "liquidity-cost", bidAskSpreadPct: requiredManualNumbers(spreadInput), positionSizes: requiredManualNumbers(positionInput) }); }
    catch (error) { setLiquidityError(error instanceof Error ? error.message : "Original liquidity estimate unavailable."); }
    finally { setLiquidityRunning(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">OPERATIONAL RISK — LOSS DISTRIBUTION APPROACH (POISSON x LOGNORMAL)</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">ANNUAL FREQUENCY (λ)</span>
            <input value={annualFreq} onChange={(e) => setAnnualFreq(e.target.value)} inputMode="decimal" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">SEVERITY μ (LOG-SPACE)</span>
            <input value={severityMu} onChange={(e) => setSeverityMu(e.target.value)} inputMode="decimal" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">SEVERITY σ (LOG-SPACE)</span>
            <input value={severitySigma} onChange={(e) => setSeveritySigma(e.target.value)} inputMode="decimal" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">CONFIDENCE %</span>
            <input value={opConfidence} onChange={(e) => setOpConfidence(e.target.value)} inputMode="decimal" className={inputCls} />
          </label>
        </div>
        <button onClick={runOpRisk} disabled={opLoading} className="mt-2 px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50">
          {opLoading ? "SIMULATING (20,000 YEARS)..." : "RUN LDA SIMULATION"}
        </button>
        {opError && <div className="mt-2 font-terminal text-[9px] text-red-400">{opError}</div>}
        <RecordedOriginalRun result={opResult}/>
        {opResult && (
          <div className="grid grid-cols-3 gap-1.5 mt-3">
            {[
              ["EXPECTED ANNUAL LOSS", opResult.expectedAnnualLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })],
              [`OP RISK VAR @ ${opConfidence}%`, opResult.opRiskVarAtConfidence.toLocaleString(undefined, { maximumFractionDigits: 0 })],
              ["UNEXPECTED LOSS", opResult.unexpectedLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })],
            ].map(([label, value]) => (
              <div key={label} className="border border-border p-2.5">
                <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{label}</div>
                <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-border/40">
        <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">LIQUIDITY COST ESTIMATE</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">BID-ASK SPREADS % (PER POSITION)</span>
            <input value={spreadInput} onChange={(e) => setSpreadInput(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">POSITION SIZES $ (PER POSITION)</span>
            <input value={positionInput} onChange={(e) => setPositionInput(e.target.value)} className={inputCls} />
          </label>
        </div>
        <button disabled={liquidityRunning} onClick={runLiquidity} className="border border-border px-3 py-2 mt-2 text-xs">{liquidityRunning ? "Running original estimate…" : "Run original liquidity estimate"}</button>
        {liquidityError && <div role="alert" className="text-destructive text-xs">{liquidityError}</div>}
        {liquidityResult && <RecordedOriginalRun result={liquidityResult}/>}
        {liquidityCost !== null && (
          <div className="border border-border p-2.5 mt-3 w-fit">
            <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">ESTIMATED LIQUIDATION COST</div>
            <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{liquidityCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
        )}
        <div className="mt-1.5 font-terminal text-[7.5px] text-muted-foreground/70">Half the bid-ask spread applied to each position, summed -- a basic liquidation cost estimate, not a full liquidity-adjusted VaR (which would also widen the VaR horizon by time-to-liquidate).</div>
      </div>
    </div>
  );
}

type StatsMethod = "normality" | "hypothesis" | "correlation" | "partial-correlation" | "ols" | "gls" | "logistic" | "probit" | "robust" | "bootstrap" | "permutation";
const STATS_METHODS: { key: StatsMethod; label: string }[] = [
  { key: "normality", label: "NORMALITY TESTS" },
  { key: "hypothesis", label: "HYPOTHESIS TESTS (2-SAMPLE)" },
  { key: "correlation", label: "CORRELATION ANALYSIS" },
  { key: "partial-correlation", label: "PARTIAL CORRELATION" },
  { key: "ols", label: "OLS REGRESSION (FULL DIAGNOSTICS)" },
  { key: "gls", label: "GLS / WEIGHTED LEAST SQUARES" },
  { key: "logistic", label: "LOGISTIC REGRESSION" },
  { key: "probit", label: "PROBIT REGRESSION" },
  { key: "robust", label: "ROBUST REGRESSION (M-ESTIMATOR)" },
  { key: "bootstrap", label: "BOOTSTRAP CI (MEAN)" },
  { key: "permutation", label: "PERMUTATION TEST (MEAN DIFF)" },
];

// Fourth Python-sidecar-backed tab: real scipy.stats/statsmodels for
// normality/hypothesis/correlation tests and full OLS/GLS/Logit/Probit
// regression diagnostics (python-service/statistics_econometrics.py) --
// Shapiro-Wilk's distribution, exact Mann-Whitney/Wilcoxon critical values,
// and proper regression standard errors are all genuinely hard to
// reproduce correctly by hand. Bootstrap CI and the permutation test are
// pure resampling with no library dependency, so they stay native TS
// (client/src/lib/statistics.ts). LIMURIA_ENGINES port plan Phase 2a --
// Phase 2b (panel data, IV, VAR/VECM, cointegration) is a separate,
// later tab.
function StatisticsSuiteTab() {
  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";
  const [method, setMethod] = useTerminalArtifactState<StatsMethod>("StatisticsSuiteTab.method", "normality");

  const [dataInput, setDataInput] = useTerminalArtifactState("StatisticsSuiteTab.dataInput", "2.1,1.9,2.4,2.0,1.8,2.2,2.5,1.7,2.3,2.0,1.9,2.1,2.6,1.8,2.2,2.0,1.9,2.4,2.1,1.8");
  const [group1Input, setGroup1Input] = useTerminalArtifactState("StatisticsSuiteTab.group1Input", "2.1,1.9,2.4,2.0,1.8,2.2,2.5,1.7,2.3,2.0");
  const [group2Input, setGroup2Input] = useTerminalArtifactState("StatisticsSuiteTab.group2Input", "3.0,2.8,3.2,2.9,3.1,2.7,3.3,2.9,3.0,3.1");
  const [xInput, setXInput] = useTerminalArtifactState("StatisticsSuiteTab.xInput", "1.2,2.1,0.8,3.4,2.6,1.9,2.2,3.1,0.5,1.8");
  const [yCorrInput, setYCorrInput] = useTerminalArtifactState("StatisticsSuiteTab.yCorrInput", "1.5,2.4,1.0,3.1,2.9,2.0,2.5,3.4,0.9,2.0");
  const [zInput, setZInput] = useTerminalArtifactState("StatisticsSuiteTab.zInput", "1.0,2.0,0.7,3.0,2.5,1.8,2.1,3.0,0.6,1.7");
  const [yRegInput, setYRegInput] = useTerminalArtifactState("StatisticsSuiteTab.yRegInput", "5.1,7.3,3.2,9.5,8.0,6.1,7.4,9.0,2.9,5.8");
  const [x1Input, setX1Input] = useTerminalArtifactState("StatisticsSuiteTab.x1Input", "1.2,2.1,0.8,3.4,2.6,1.9,2.2,3.1,0.5,1.8");
  const [x2Input, setX2Input] = useTerminalArtifactState("StatisticsSuiteTab.x2Input", "0.5,0.3,0.9,0.2,0.4,0.6,0.3,0.2,0.8,0.5");
  const [weightsInput, setWeightsInput] = useTerminalArtifactState("StatisticsSuiteTab.weightsInput", "1,1,1,1,1,1,1,1,1,1");
  const [yBinInput, setYBinInput] = useTerminalArtifactState("StatisticsSuiteTab.yBinInput", "0,0,0,1,0,0,1,1,1,0");
  const [bootConfidence, setBootConfidence] = useTerminalArtifactState("StatisticsSuiteTab.bootConfidence", "95");
  const [resamplingSeed, setResamplingSeed] = useTerminalArtifactState("StatisticsSuiteTab.resamplingSeed", "42");
  const [covType, setCovType] = useTerminalArtifactState<"nonrobust" | "HC1" | "HC3" | "HAC" | "cluster">("StatisticsSuiteTab.covType", "nonrobust");
  const [clusterVarInput, setClusterVarInput] = useTerminalArtifactState("StatisticsSuiteTab.clusterVarInput", "");
  const [maxLagsInput, setMaxLagsInput] = useTerminalArtifactState("StatisticsSuiteTab.maxLagsInput", "");
  const [normType, setNormType] = useTerminalArtifactState<"huber" | "bisquare" | "tukey">("StatisticsSuiteTab.normType", "huber");

  const terminal = useTerminalArtifactContext();
  const native = useTerminalQuantRun();
  const [localResult, setResult] = useState<unknown>(null);
  const storedResult = native.stored?.[`qwb.stats.${method}`];
  const result = terminal?.target ? storedResult ?? null : localResult;
  function readDiagnostic<T>(name: string, local: T): T {
    if (!terminal?.target) return local;
    const stored = storedResult as { diagnostics?: Record<string, unknown> } | undefined;
    const output = stored?.diagnostics?.[name];
    return (output && typeof output === "object" && !("error" in output) ? output : null) as T;
  }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const TICKERS_NEEDED: Partial<Record<StatsMethod, number>> = {
    normality: 1, bootstrap: 1,
    hypothesis: 2, permutation: 2, correlation: 2,
    "partial-correlation": 3,
    ols: 2, gls: 2, robust: 2,
  };
  const tickersNeeded = TICKERS_NEEDED[method] ?? 0;
  const [tickerInput, setTickerInput] = useTerminalArtifactState("StatisticsSuiteTab.tickerInput", "AAPL,MSFT,SPY");
  const [tickerSymbols, setTickerSymbols] = useTerminalArtifactState<string[]>("StatisticsSuiteTab.tickerSymbols", []);
  const tickerResults = useSymbolOHLCV(tickerSymbols);
  const tickerLoading = tickerSymbols.length > 0 && tickerResults.some((r) => r.isLoading);

  function loadRealReturns() {
    const symbols = tickerInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, tickersNeeded);
    setTickerSymbols(symbols);
  }

  // Runs once real OHLCV data for every requested ticker has arrived --
  // aligns by date, converts to daily % returns, and fills the same state
  // the manual-entry fields use (so a loaded series is just as editable
  // afterward). Deliberately depends on the *derived boolean* below, not on
  // `tickerResults` itself: useQueries returns a new array reference on
  // every render regardless of whether the underlying data changed, so
  // depending on it directly re-ran this effect (and its setResult(null))
  // on every render after loading -- including the render triggered by
  // runStats()'s own setResult(...), silently wiping out every result the
  // instant it was set. Found and fixed during live verification.
  const tickerDataReady = tickersNeeded > 0 && tickerSymbols.length >= tickersNeeded && tickerResults.slice(0, tickersNeeded).every((r) => !!r.data);
  useEffect(() => {
    if (!tickerDataReady) return;
    const barsList = tickerResults.slice(0, tickersNeeded).map((r) => r.data!.bars ?? []);
    const aligned = alignSeriesByDate(barsList);
    if (aligned.some((s) => s.length < 15)) return; // not enough overlapping trading days to be worth using
    const returnSeries = aligned.map((closes) => computeDailyReturns(closes));
    const minLen = Math.min(...returnSeries.map((s) => s.length));
    const trimmed = returnSeries.map((s) => s.slice(-minLen));
    const fmtSeries = (s: number[]) => s.map((v) => v.toFixed(4)).join(",");
    if (method === "normality" || method === "bootstrap") setDataInput(fmtSeries(trimmed[0]));
    else if (method === "hypothesis" || method === "permutation") { setGroup1Input(fmtSeries(trimmed[0])); setGroup2Input(fmtSeries(trimmed[1])); }
    else if (method === "correlation") { setXInput(fmtSeries(trimmed[0])); setYCorrInput(fmtSeries(trimmed[1])); }
    else if (method === "partial-correlation") { setXInput(fmtSeries(trimmed[0])); setYCorrInput(fmtSeries(trimmed[1])); setZInput(fmtSeries(trimmed[2])); }
    else if (method === "ols" || method === "gls") {
      // Only y and x1 come from real data here (tickersNeeded=2) -- clear
      // x2 rather than leaving whatever was in it (its own manual-entry
      // default, or a previous load) at a different, mismatched length.
      // Found live: a stale 10-point x2 next to a real ~250-point y/x1
      // produced a genuine numpy "array dimensions ... must match exactly"
      // error from the sidecar, not a UI-only glitch.
      setYRegInput(fmtSeries(trimmed[0]));
      setX1Input(fmtSeries(trimmed[1]));
      setX2Input("");
      // Same mismatch risk for GLS's weights vector -- reset to equal
      // weights at the real, now-larger length (equal weights reduces GLS
      // to OLS exactly, already verified elsewhere in this file).
      if (method === "gls") setWeightsInput(trimmed[0].map(() => "1").join(","));
    }
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerDataReady, tickerSymbols, tickersNeeded, method]);

  function buildRegressionX(): number[][] {
    const cols = [parseNumList(x1Input)];
    const x2 = parseNumList(x2Input);
    if (x2.length) cols.push(x2);
    return cols;
  }

  const [localHetero, setHeteroResult] = useState<{ breuschPaganStatistic: number; breuschPaganPValue: number; conclusion: string } | null>(null);
  const heteroResult = readDiagnostic("heteroskedasticity", localHetero);
  const [localInfluence, setInfluenceResult] = useState<{ cooksDistance: number[]; leverage: number[]; dffits: number[]; influenceThreshold: number; flaggedObservations: number[] } | null>(null);
  const influenceResult = readDiagnostic("influence", localInfluence);
  const [localVif, setVifResult] = useState<{ predictorIndex: number[]; vif: number[] } | null>(null);
  const vifResult = readDiagnostic("vif", localVif);
  const [localReset, setResetResult] = useState<{ statistic: number; pValue: number; conclusion: string } | null>(null);
  const resetResult = readDiagnostic("reset", localReset);
  const [localAutocorr, setAutocorrResult] = useState<{ breuschGodfreyLmStatistic: number; breuschGodfreyLmPValue: number; ljungBoxPValues: number[]; durbinWatson: number; conclusion: string } | null>(null);
  const autocorrResult = readDiagnostic("autocorrelation", localAutocorr);

  async function runStats() {
    setLoading(true);
    setError(null);
    setResult(null);
    setHeteroResult(null);
    setInfluenceResult(null);
    setVifResult(null);
    setResetResult(null);
    setAutocorrResult(null);
    try {
      if (method === "bootstrap" || method === "permutation") {
        const parameters = method === "bootstrap"
          ? { method, data: parseNumList(dataInput), iterations: 2000, confidence: Number(bootConfidence), seed: Number(resamplingSeed) }
          : { method, group1: parseNumList(group1Input), group2: parseNumList(group2Input), iterations: 5000, seed: Number(resamplingSeed) };
        const output = await native.run<Record<string, unknown>>("statistics/resampling", parameters, `qwb.stats.${method}`, "/api/quant/statistics/resampling");
        if (!terminal?.target) setResult(output);
        return;
      }
      const covOptions: Record<string, unknown> = covType === "nonrobust" ? {} : {
        covType,
        ...(covType === "cluster" ? { clusterVar: clusterVarInput.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
        ...(covType === "HAC" && maxLagsInput ? { maxLags: Number(maxLagsInput) } : {}),
      };
      let path = "";
      let body: unknown;
      switch (method) {
        case "normality":
          path = "/api/quant/stats/normality"; body = { data: parseNumList(dataInput) }; break;
        case "hypothesis":
          path = "/api/quant/stats/hypothesis-tests"; body = { group1: parseNumList(group1Input), group2: parseNumList(group2Input) }; break;
        case "correlation":
          path = "/api/quant/stats/correlation"; body = { x: parseNumList(xInput), y: parseNumList(yCorrInput) }; break;
        case "partial-correlation":
          path = "/api/quant/stats/partial-correlation"; body = { x: parseNumList(xInput), y: parseNumList(yCorrInput), z: parseNumList(zInput) }; break;
        case "ols":
          path = "/api/quant/stats/ols-diagnostics"; body = { y: parseNumList(yRegInput), x: buildRegressionX(), ...covOptions }; break;
        case "gls":
          path = "/api/quant/stats/gls"; body = { y: parseNumList(yRegInput), x: buildRegressionX(), weights: parseNumList(weightsInput), ...covOptions }; break;
        case "logistic":
          path = "/api/quant/stats/logistic"; body = { y: parseNumList(yBinInput), x: buildRegressionX() }; break;
        case "probit":
          path = "/api/quant/stats/probit"; body = { y: parseNumList(yBinInput), x: buildRegressionX() }; break;
        case "robust":
          path = "/api/quant/stats/robust-regression"; body = { y: parseNumList(yRegInput), x: buildRegressionX(), normType }; break;
      }
      if (terminal?.target) {
        await native.run(path, body as Record<string, unknown>, `qwb.stats.${method}`, path);
        return;
      }
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || "Statistics engine unavailable right now.");
      }
      const data = await res.json();
      setResult(data);

      // Breusch-Pagan pairs naturally with a fitted OLS/GLS model -- it
      // needs that model's own residuals, which the OLS/GLS response now
      // returns for exactly this reason. Fire-and-forget: a failure here
      // shouldn't blank out the regression result that already rendered.
      if (method === "ols" || method === "gls") {
        fetch("/api/quant/econometrics/heteroskedasticity", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ residuals: data.residuals, x: buildRegressionX() }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((h) => { if (h) setHeteroResult(h); })
          .catch(() => {});
      }
      if (method === "ols" || method === "gls") {
        const xCols = buildRegressionX();
        const yCol = parseNumList(yRegInput);
        const postDiagnostic = (url: string, payload: unknown, setter: (value: unknown) => void) =>
          fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
            .then((r) => (r.ok ? r.json() : null))
            .then((value: unknown) => { if (value) setter(value); })
            .catch(() => {});
        postDiagnostic("/api/quant/stats/influence-diagnostics", { y: yCol, x: xCols }, (value) => setInfluenceResult(value as typeof influenceResult));
        postDiagnostic("/api/quant/stats/reset-test", { y: yCol, x: xCols }, (value) => setResetResult(value as typeof resetResult));
        postDiagnostic("/api/quant/stats/autocorrelation-tests", { y: yCol, x: xCols, lags: 4 }, (value) => setAutocorrResult(value as typeof autocorrResult));
        if (xCols.length >= 2) postDiagnostic("/api/quant/stats/vif", { x: xCols }, (value) => setVifResult(value as typeof vifResult));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Statistics engine unavailable right now.");
    } finally {
      setLoading(false);
    }
  }
  const isRegression = method === "ols" || method === "gls" || method === "logistic" || method === "probit" || method === "robust";

  const isBinary = method === "logistic" || method === "probit";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={method} onChange={(e) => { setMethod(e.target.value as StatsMethod); setResult(null); setError(null); }} className={inputCls}>
          {STATS_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <button onClick={runStats} disabled={loading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50">
          {loading ? "RUNNING..." : "RUN"}
        </button>
        {["bootstrap", "permutation"].includes(method) && <label className="text-xs">Recorded seed <input aria-label="Resampling seed" type="number" min="0" max="2147483647" value={resamplingSeed} onChange={event => setResamplingSeed(event.target.value)} className={inputCls}/></label>}
      </div>

      {tickersNeeded > 0 && (
        <div className="border border-border/60 p-2.5 space-y-1.5">
          <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">
            LOAD REAL DATA — {tickersNeeded} TICKER{tickersNeeded > 1 ? "S" : ""} NEEDED (1Y DAILY RETURNS), OR EDIT THE FIELDS BELOW MANUALLY
          </div>
          <div className="flex items-center gap-2">
            <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)} placeholder="AAPL,MSFT,SPY" className={`flex-1 ${inputCls}`} />
            <button onClick={loadRealReturns} disabled={tickerLoading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50 whitespace-nowrap">
              {tickerLoading ? "LOADING..." : "LOAD RETURNS"}
            </button>
          </div>
        </div>
      )}

      {method === "normality" && (
        <label className="flex flex-col gap-1">
          <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">DATA (COMMA-SEPARATED)</span>
          <input value={dataInput} onChange={(e) => setDataInput(e.target.value)} className={inputCls} />
        </label>
      )}
      {method === "bootstrap" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">DATA (COMMA-SEPARATED)</span>
            <input value={dataInput} onChange={(e) => setDataInput(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">CONFIDENCE %</span>
            <input value={bootConfidence} onChange={(e) => setBootConfidence(e.target.value)} inputMode="decimal" className={inputCls} />
          </label>
        </div>
      )}
      {(method === "hypothesis" || method === "permutation") && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">GROUP 1 (COMMA-SEPARATED)</span>
            <input value={group1Input} onChange={(e) => setGroup1Input(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">GROUP 2 (COMMA-SEPARATED)</span>
            <input value={group2Input} onChange={(e) => setGroup2Input(e.target.value)} className={inputCls} />
          </label>
        </div>
      )}
      {(method === "correlation" || method === "partial-correlation") && (
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">X (COMMA-SEPARATED)</span>
            <input value={xInput} onChange={(e) => setXInput(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">Y (COMMA-SEPARATED)</span>
            <input value={yCorrInput} onChange={(e) => setYCorrInput(e.target.value)} className={inputCls} />
          </label>
          {method === "partial-correlation" && (
            <label className="flex flex-col gap-1">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">Z — CONTROL VAR (COMMA-SEPARATED)</span>
              <input value={zInput} onChange={(e) => setZInput(e.target.value)} className={inputCls} />
            </label>
          )}
        </div>
      )}
      {isRegression && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">{isBinary ? "Y — BINARY 0/1" : "Y (DEPENDENT)"}</span>
            <input value={isBinary ? yBinInput : yRegInput} onChange={(e) => (isBinary ? setYBinInput : setYRegInput)(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">X1 (PREDICTOR)</span>
            <input value={x1Input} onChange={(e) => setX1Input(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">X2 (OPTIONAL)</span>
            <input value={x2Input} onChange={(e) => setX2Input(e.target.value)} className={inputCls} />
          </label>
          {method === "gls" && (
            <label className="flex flex-col gap-1">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">WEIGHTS (GLS SIGMA DIAGONAL)</span>
              <input value={weightsInput} onChange={(e) => setWeightsInput(e.target.value)} className={inputCls} />
            </label>
          )}
        </div>
      )}
      {(method === "ols" || method === "gls") && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">COV TYPE</span>
            <select value={covType} onChange={(e) => setCovType(e.target.value as typeof covType)} className={inputCls}>
              <option value="nonrobust">NONROBUST (CLASSICAL)</option>
              <option value="HC1">HC1 (HETEROSKEDASTICITY-ROBUST)</option>
              <option value="HC3">HC3 (HETEROSKEDASTICITY-ROBUST)</option>
              <option value="HAC">HAC (NEWEY-WEST)</option>
              <option value="cluster">CLUSTER-ROBUST</option>
            </select>
          </label>
          {covType === "HAC" && (
            <label className="flex items-center gap-1.5">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MAX LAGS</span>
              <input value={maxLagsInput} onChange={(e) => setMaxLagsInput(e.target.value)} inputMode="numeric" className={`w-20 ${inputCls}`} />
            </label>
          )}
          {covType === "cluster" && (
            <label className="flex items-center gap-1.5">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">CLUSTER LABELS (SAME LENGTH AS Y)</span>
              <input value={clusterVarInput} onChange={(e) => setClusterVarInput(e.target.value)} className={`w-64 ${inputCls}`} />
            </label>
          )}
        </div>
      )}
      {method === "robust" && (
        <label className="flex items-center gap-1.5">
          <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">M-ESTIMATOR NORM</span>
          <select value={normType} onChange={(e) => setNormType(e.target.value as typeof normType)} className={inputCls}>
            <option value="huber">HUBER T</option>
            <option value="tukey">TUKEY BIWEIGHT</option>
            <option value="bisquare">BIWEIGHT (LEGACY ALIAS)</option>
          </select>
        </label>
      )}

      {error && <div className="font-terminal text-[9px] text-red-400">{error}</div>}
      <RecordedOriginalRun result={result}/>

      {result != null && (
        <StatsResultView method={method} result={result} />
      )}

      {heteroResult && (method === "ols" || method === "gls") && (
        <div className="pt-3 border-t border-border/40">
          <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">BREUSCH-PAGAN HETEROSKEDASTICITY TEST (ON THIS FIT'S OWN RESIDUALS)</div>
          <div className="grid grid-cols-2 gap-1.5">
            {statCard("BP STATISTIC", fmt(heteroResult.breuschPaganStatistic, 3))}
            {statCard("P-VALUE", fmt(heteroResult.breuschPaganPValue, 5))}
          </div>
          <div className="mt-1.5 font-terminal text-[9px] text-foreground">{heteroResult.conclusion}</div>
        </div>
      )}
      {influenceResult && (method === "ols" || method === "gls") && (
        <div className="pt-3 border-t border-border/40">
          <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">INFLUENCE DIAGNOSTICS (COOK'S D / LEVERAGE / DFFITS)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {statCard("MAX COOK'S D", fmt(Math.max(...influenceResult.cooksDistance), 4))}
            {statCard("MAX LEVERAGE", fmt(Math.max(...influenceResult.leverage), 4))}
            {statCard("MAX |DFFITS|", fmt(Math.max(...influenceResult.dffits.map((v) => Math.abs(v))), 4))}
            {statCard("FLAGGED OBSERVATIONS", influenceResult.flaggedObservations.length ? influenceResult.flaggedObservations.join(", ") : "NONE")}
          </div>
        </div>
      )}
      {vifResult && (method === "ols" || method === "gls") && (
        <div className="pt-3 border-t border-border/40">
          <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">VARIANCE INFLATION FACTORS</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {vifResult.vif.map((v, i) => statCard(`X${vifResult.predictorIndex[i]} VIF`, fmt(v, 3)))}
          </div>
        </div>
      )}
      {resetResult && (method === "ols" || method === "gls") && (
        <div className="pt-3 border-t border-border/40">
          <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">RAMSEY RESET TEST</div>
          <div className="grid grid-cols-2 gap-1.5">
            {statCard("F-STATISTIC", fmt(resetResult.statistic, 3))}
            {statCard("P-VALUE", fmt(resetResult.pValue, 4))}
          </div>
          <div className="mt-1.5 font-terminal text-[9px] text-foreground">{resetResult.conclusion}</div>
        </div>
      )}
      {autocorrResult && (method === "ols" || method === "gls") && (
        <div className="pt-3 border-t border-border/40">
          <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">BREUSCH-GODFREY / LJUNG-BOX AUTOCORRELATION</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {statCard("DURBIN-WATSON", fmt(autocorrResult.durbinWatson, 3))}
            {statCard("BREUSCH-GODFREY LM", `stat=${fmt(autocorrResult.breuschGodfreyLmStatistic, 3)}, p=${fmt(autocorrResult.breuschGodfreyLmPValue, 4)}`)}
            {statCard("LJUNG-BOX (LAST LAG)", `p=${fmt(autocorrResult.ljungBoxPValues[autocorrResult.ljungBoxPValues.length - 1], 4)}`)}
          </div>
          <div className="mt-1.5 font-terminal text-[9px] text-foreground">{autocorrResult.conclusion}</div>
        </div>
      )}
    </div>
  );
}

function statCard(label: string, value: string) {
  return (
    <div key={label} className="border border-border p-2.5">
      <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{label}</div>
      <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

function StatsResultView({ method, result }: { method: StatsMethod; result: unknown }) {
  const r = result as Record<string, any>;
  if (method === "normality") {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {r.shapiroWilkPValue != null && statCard("SHAPIRO-WILK p", fmt(r.shapiroWilkPValue, 4))}
        {statCard("KOLMOGOROV-SMIRNOV p", fmt(r.ksPValue, 4))}
        {statCard("JARQUE-BERA p", fmt(r.jarqueBeraPValue, 4))}
        {r.dagostinoPValue != null && statCard("D'AGOSTINO p", fmt(r.dagostinoPValue, 4))}
      </div>
    );
  }
  if (method === "hypothesis") {
    const rows: [string, any][] = [["INDEPENDENT T-TEST", r.independentTTest], ["PAIRED T-TEST", r.pairedTTest], ["MANN-WHITNEY U", r.mannWhitneyU], ["WILCOXON", r.wilcoxon], ["KRUSKAL-WALLIS", r.kruskalWallis], ["ANOVA (F)", r.anova]];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {rows.filter(([, v]) => v != null).map(([label, v]) => statCard(label, `stat=${fmt(v.statistic, 3)}, p=${fmt(v.pValue, 4)}`))}
      </div>
    );
  }
  if (method === "correlation") {
    return (
      <div className="grid grid-cols-3 gap-1.5">
        {statCard("PEARSON", `r=${fmt(r.pearson.statistic, 3)}, p=${fmt(r.pearson.pValue, 4)}`)}
        {statCard("SPEARMAN", `ρ=${fmt(r.spearman.statistic, 3)}, p=${fmt(r.spearman.pValue, 4)}`)}
        {statCard("KENDALL", `τ=${fmt(r.kendall.statistic, 3)}, p=${fmt(r.kendall.pValue, 4)}`)}
      </div>
    );
  }
  if (method === "partial-correlation") {
    return (
      <div className="grid grid-cols-3 gap-1.5">
        {statCard("PARTIAL CORRELATION (X,Y | Z)", fmt(r.partialCorrelation, 4))}
        {statCard("P-VALUE", fmt(r.pValue, 4))}
        {statCard("DEGREES OF FREEDOM", String(r.degreesOfFreedom))}
      </div>
    );
  }
  if (method === "robust") {
    return (
      <>
        <div className="grid grid-cols-2 gap-1.5">
          {statCard("ROBUST SCALE", fmt(r.scale, 5))}
          {statCard("MIN. IRLS WEIGHT", fmt(Math.min(...r.weights), 4))}
        </div>
        <RegressionCoefTable coefficients={r.coefficients} standardErrors={r.standardErrors} tStats={r.tStats} pValues={r.pValues} />
      </>
    );
  }
  if (method === "ols" || method === "gls") {
    return (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {statCard("R²", fmt(r.rSquared, 4))}
          {statCard("ADJ. R²", fmt(r.adjRSquared, 4))}
          {statCard("F-STAT", `${fmt(r.fStatistic, 2)} (p=${fmt(r.fPValue, 4)})`)}
          {statCard("DURBIN-WATSON", fmt(r.durbinWatson, 3))}
          {statCard("AIC", fmt(r.aic, 2))}
          {statCard("BIC", fmt(r.bic, 2))}
        </div>
        <RegressionCoefTable coefficients={r.coefficients} standardErrors={r.standardErrors} tStats={r.tStats} pValues={r.pValues} />
      </>
    );
  }
  if (method === "logistic" || method === "probit") {
    return (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {statCard("PSEUDO R²", fmt(r.pseudoRSquared, 4))}
          {statCard("LOG-LIKELIHOOD", fmt(r.logLikelihood, 3))}
        </div>
        <RegressionCoefTable coefficients={r.coefficients} standardErrors={r.standardErrors} tStats={r.zStats} pValues={r.pValues} oddsRatios={r.oddsRatios} />
      </>
    );
  }
  if (method === "bootstrap") {
    return (
      <div className="grid grid-cols-3 gap-1.5">
        {statCard("SAMPLE MEAN", fmt(r.estimate, 4))}
        {statCard("CI LOW", fmt(r.ciLow, 4))}
        {statCard("CI HIGH", fmt(r.ciHigh, 4))}
      </div>
    );
  }
  if (method === "permutation") {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {statCard("OBSERVED MEAN DIFFERENCE", fmt(r.observedDifference, 4))}
        {statCard("P-VALUE", fmt(r.pValue, 4))}
      </div>
    );
  }
  return null;
}

function RegressionCoefTable({ coefficients, standardErrors, tStats, pValues, oddsRatios }: { coefficients: number[]; standardErrors: number[]; tStats: number[]; pValues: number[]; oddsRatios?: number[] | null }) {
  const labels = coefficients.map((_, i) => (i === 0 ? "INTERCEPT" : `X${i}`));
  return (
    <div className="border border-border">
      <table className="w-full border-collapse">
        <thead><tr className="border-b border-border bg-[#070707]">
          <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">TERM</th>
          <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">COEF</th>
          <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">STD ERR</th>
          <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">T/Z-STAT</th>
          <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">P-VALUE</th>
          {oddsRatios && <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">ODDS RATIO</th>}
        </tr></thead>
        <tbody>
          {labels.map((label, i) => (
            <tr key={label} className="border-b border-border/30 last:border-b-0">
              <td className="px-3 py-2 font-terminal text-[9px] font-bold text-foreground">{label}</td>
              <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(coefficients[i], 4)}</td>
              <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(standardErrors[i], 4)}</td>
              <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(tStats[i], 3)}</td>
              <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(pValues[i], 4)}</td>
              {oddsRatios && <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(oddsRatios[i], 4)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TsEconMethod = "var" | "vecm" | "granger" | "johansen" | "unitroot";
const TS_ECON_METHODS: { key: TsEconMethod; label: string; seriesCount: string }[] = [
  { key: "var", label: "VAR (VECTOR AUTOREGRESSION)", seriesCount: "2-6" },
  { key: "vecm", label: "VECM (VECTOR ERROR CORRECTION)", seriesCount: "2-6" },
  { key: "granger", label: "GRANGER CAUSALITY", seriesCount: "2 (exact)" },
  { key: "johansen", label: "JOHANSEN COINTEGRATION", seriesCount: "2-6" },
  { key: "unitroot", label: "UNIT ROOT TESTS (ADF / KPSS)", seriesCount: "1 (exact)" },
];
// VECM/Johansen test whether price LEVELS share a common stochastic trend --
// that's the entire question, so they need levels, not returns. VAR/Granger
// want stationary input (returns) for standard inference. Unit root is
// commonly run on levels first (to decide whether differencing is needed)
// but works on either.
const TS_ECON_DEFAULT_SERIES_TYPE: Record<TsEconMethod, "returns" | "levels"> = {
  var: "returns", granger: "returns", unitroot: "levels", vecm: "levels", johansen: "levels",
};

// Fifth Python-sidecar-backed tab: real statsmodels VAR/VECM/Granger/
// Johansen/unit-root tests (python-service/econometrics.py). These are
// inherently multivariate-time-series methods, so real data loading here
// isn't a nice-to-have alongside manual entry the way it was for
// StatisticsSuiteTab -- it's the natural, primary way to use this tool.
// LIMURIA_ENGINES port plan Phase 2b.
function TimeSeriesEconometricsTab() {
  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";
  const [method, setMethod] = useTerminalArtifactState<TsEconMethod>("TimeSeriesEconometricsTab.method", "var");
  const [tickerInput, setTickerInput] = useTerminalArtifactState("TimeSeriesEconometricsTab.tickerInput", "SPY,QQQ,TLT");
  const [seriesType, setSeriesType] = useTerminalArtifactState<"returns" | "levels">("TimeSeriesEconometricsTab.seriesType", TS_ECON_DEFAULT_SERIES_TYPE.var);
  const [tickerSymbols, setTickerSymbols] = useTerminalArtifactState<string[]>("TimeSeriesEconometricsTab.tickerSymbols", []);
  const [loadedNames, setLoadedNames] = useState<string[]>([]);
  const [loadedSeries, setLoadedSeries] = useState<string[]>([]); // one comma-joined string per series, editable after load

  const [lags, setLags] = useTerminalArtifactState("TimeSeriesEconometricsTab.lags", "2");
  const [irfHorizon, setIrfHorizon] = useTerminalArtifactState("TimeSeriesEconometricsTab.irfHorizon", "10");
  const [cointRank, setCointRank] = useTerminalArtifactState("TimeSeriesEconometricsTab.cointRank", "1");
  const [maxLags, setMaxLags] = useTerminalArtifactState("TimeSeriesEconometricsTab.maxLags", "4");
  const [detOrder, setDetOrder] = useTerminalArtifactState("TimeSeriesEconometricsTab.detOrder", "0");

  const [result, setResult, postOriginal] = useOriginalQuantResult<unknown>(`qwb.tsecon.${method}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxSeries = method === "unitroot" ? 1 : method === "granger" ? 2 : 6;
  const minSeries = method === "unitroot" ? 1 : 2;

  const tickerResults = useSymbolOHLCV(tickerSymbols);
  const tickerLoading = tickerSymbols.length > 0 && tickerResults.some((r) => r.isLoading);
  const tickerDataReady = tickerSymbols.length >= minSeries && tickerResults.every((r) => !!r.data);

  function loadRealSeries() {
    const symbols = tickerInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, maxSeries);
    setTickerSymbols(symbols);
  }

  // Same tickerDataReady-boolean-not-raw-array-dependency fix established
  // in StatisticsSuiteTab -- see that component's comment for why depending
  // on useQueries' result array directly silently wipes results on re-render.
  useEffect(() => {
    if (!tickerDataReady) return;
    const barsList = tickerResults.map((r) => r.data!.bars ?? []);
    const aligned = alignSeriesByDate(barsList);
    if (aligned.some((s) => s.length < 20)) return;
    const series = seriesType === "returns" ? aligned.map((closes) => computeDailyReturns(closes)) : aligned;
    const minLen = Math.min(...series.map((s) => s.length));
    const trimmed = series.map((s) => s.slice(-minLen));
    setLoadedNames(tickerSymbols);
    setLoadedSeries(trimmed.map((s) => s.map((v) => v.toFixed(4)).join(",")));
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerDataReady, tickerSymbols, seriesType]);

  const seriesArrays = loadedSeries.map((s) => parseNumList(s));

  async function runTsEcon() {
    if (loadedSeries.length < minSeries) {
      setError(`Load at least ${minSeries} real series first.`);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let path = "";
      let body: unknown;
      switch (method) {
        case "var":
          path = "/api/quant/econometrics/var";
          body = { seriesNames: loadedNames, data: seriesArrays, lags: Number(lags), irfHorizon: Number(irfHorizon) };
          break;
        case "vecm":
          path = "/api/quant/econometrics/vecm";
          body = { seriesNames: loadedNames, data: seriesArrays, cointRank: Number(cointRank), lags: Number(lags) };
          break;
        case "granger":
          path = "/api/quant/econometrics/granger";
          body = { y: seriesArrays[0], x: seriesArrays[1], maxLags: Number(maxLags) };
          break;
        case "johansen":
          path = "/api/quant/econometrics/johansen";
          body = { seriesNames: loadedNames, data: seriesArrays, detOrder: Number(detOrder), kArDiff: Number(lags) };
          break;
        case "unitroot":
          path = "/api/quant/econometrics/unit-root";
          body = { series: seriesArrays[0] };
          break;
      }
      await postOriginal(path, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Econometrics engine unavailable right now.");
    } finally {
      setLoading(false);
    }
  }

  const methodDef = TS_ECON_METHODS.find((m) => m.key === method)!;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={method} onChange={(e) => { const m = e.target.value as TsEconMethod; setMethod(m); setSeriesType(TS_ECON_DEFAULT_SERIES_TYPE[m]); setResult(null); setError(null); }} className={inputCls}>
          {TS_ECON_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <button onClick={runTsEcon} disabled={loading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50">
          {loading ? "RUNNING..." : "RUN"}
        </button>
      </div>

      <div className="border border-border/60 p-2.5 space-y-1.5">
        <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">
          LOAD REAL DATA — {methodDef.seriesCount} TICKERS (1Y DAILY)
        </div>
        <div className="flex items-center gap-2">
          <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)} placeholder="SPY,QQQ,TLT" className={`flex-1 ${inputCls}`} />
          <select value={seriesType} onChange={(e) => setSeriesType(e.target.value as "returns" | "levels")} className={inputCls}>
            <option value="returns">DAILY RETURNS %</option>
            <option value="levels">PRICE LEVELS</option>
          </select>
          <button onClick={loadRealSeries} disabled={tickerLoading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50 whitespace-nowrap">
            {tickerLoading ? "LOADING..." : "LOAD SERIES"}
          </button>
        </div>
        {(method === "vecm" || method === "johansen") && (
          <div className="font-terminal text-[7px] text-muted-foreground/70">Cointegration is a property of price levels, not returns — PRICE LEVELS is the right choice here, not the default-elsewhere returns series.</div>
        )}
        {loadedNames.length > 0 && (
          <div className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">Loaded: {loadedNames.join(", ")} ({seriesArrays[0]?.length ?? 0} points each)</div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {(method === "var" || method === "vecm" || method === "johansen") && (
          <label className="flex items-center gap-1.5">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">LAGS</span>
            <input value={lags} onChange={(e) => setLags(e.target.value)} inputMode="numeric" className={`w-14 ${inputCls}`} />
          </label>
        )}
        {method === "var" && (
          <label className="flex items-center gap-1.5">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">IRF HORIZON</span>
            <input value={irfHorizon} onChange={(e) => setIrfHorizon(e.target.value)} inputMode="numeric" className={`w-14 ${inputCls}`} />
          </label>
        )}
        {method === "vecm" && (
          <label className="flex items-center gap-1.5">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">COINT. RANK</span>
            <input value={cointRank} onChange={(e) => setCointRank(e.target.value)} inputMode="numeric" className={`w-14 ${inputCls}`} />
          </label>
        )}
        {method === "granger" && (
          <label className="flex items-center gap-1.5">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MAX LAGS</span>
            <input value={maxLags} onChange={(e) => setMaxLags(e.target.value)} inputMode="numeric" className={`w-14 ${inputCls}`} />
          </label>
        )}
        {method === "johansen" && (
          <label className="flex items-center gap-1.5">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">DET. ORDER</span>
            <input value={detOrder} onChange={(e) => setDetOrder(e.target.value)} inputMode="numeric" className={`w-14 ${inputCls}`} />
          </label>
        )}
      </div>

      {error && <div className="font-terminal text-[9px] text-red-400">{error}</div>}
      <RecordedOriginalRun result={result}/>
      {result != null && <TsEconResultView method={method} result={result} seriesNames={originalRunParameters(result)?.seriesNames as string[] ?? loadedNames} />}
    </div>
  );
}

function TsEconResultView({ method, result, seriesNames }: { method: TsEconMethod; result: unknown; seriesNames: string[] }) {
  const r = result as Record<string, any>;
  if (method === "var") {
    return (
      <>
        <div className="grid grid-cols-2 gap-1.5">
          {statCard("AIC", fmt(r.aic, 4))}
          {statCard("BIC", fmt(r.bic, 4))}
        </div>
        <div>
          <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">EQUATION COEFFICIENTS</div>
          <div className="border border-border">
            <table className="w-full border-collapse">
              <thead><tr className="border-b border-border bg-[#070707]">
                <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">EQUATION</th>
                <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">COEFFICIENTS (CONST, LAGS...)</th>
              </tr></thead>
              <tbody>
                {Object.entries(r.coefficients as Record<string, number[]>).map(([name, coefs]) => (
                  <tr key={name} className="border-b border-border/30 last:border-b-0">
                    <td className="px-3 py-2 font-terminal text-[9px] font-bold text-foreground">{name}</td>
                    <td className="px-3 py-2 font-terminal text-[9px] tabular-nums">{coefs.map((c) => fmt(c, 3)).join("  ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-1.5 font-terminal text-[7.5px] text-muted-foreground/70">Full impulse-response and variance-decomposition matrices were computed ({r.irf.length} horizons) but aren't rendered here — the equation-level coefficients above are the primary read.</div>
        </div>
      </>
    );
  }
  if (method === "vecm") {
    return (
      <div className="grid grid-cols-1 gap-3">
        {statCard("LOG-LIKELIHOOD", fmt(r.logLikelihood, 3))}
        <div>
          <div className="font-terminal text-[7px] tracking-widest text-muted-foreground mb-1">ALPHA (SPEED OF ADJUSTMENT)</div>
          <div className="font-terminal text-[9px] tabular-nums">{(r.alpha as number[][]).map((row) => row.map((v) => fmt(v, 4)).join(", ")).join(" | ")}</div>
        </div>
        <div>
          <div className="font-terminal text-[7px] tracking-widest text-muted-foreground mb-1">BETA (COINTEGRATING VECTOR)</div>
          <div className="font-terminal text-[9px] tabular-nums">{(r.beta as number[][]).map((row) => row.map((v) => fmt(v, 4)).join(", ")).join(" | ")}</div>
        </div>
      </div>
    );
  }
  if (method === "granger") {
    return (
      <>
        <div className="border border-border">
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-border bg-[#070707]">
              <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">LAG</th>
              <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">F-STAT</th>
              <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">P-VALUE</th>
            </tr></thead>
            <tbody>
              {(r.results as any[]).map((row) => (
                <tr key={row.lag} className="border-b border-border/30 last:border-b-0">
                  <td className="px-3 py-2 font-terminal text-[9px] font-bold text-foreground">{row.lag}</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(row.fStatistic, 3)}</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(row.pValue, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="font-terminal text-[9px] text-foreground">{r.conclusion}</div>
      </>
    );
  }
  if (method === "johansen") {
    return (
      <>
        <div className="border border-border">
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-border bg-[#070707]">
              <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">RANK ≤</th>
              <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">TRACE STAT</th>
              <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">95% CRIT</th>
              <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">MAX-EIG STAT</th>
              <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">95% CRIT</th>
            </tr></thead>
            <tbody>
              {(r.traceStatistics as number[]).map((stat, i) => (
                <tr key={i} className="border-b border-border/30 last:border-b-0">
                  <td className="px-3 py-2 font-terminal text-[9px] font-bold text-foreground">{i}</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(stat, 3)}</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(r.traceCriticalValues95[i], 3)}</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(r.maxEigStatistics[i], 3)}</td>
                  <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(r.maxEigCriticalValues95[i], 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="font-terminal text-[9px] text-foreground">Likely cointegrating rank: {r.likelyCointegratingRank} (of {seriesNames.length} series) — count of rows where the trace statistic exceeds its 95% critical value.</div>
      </>
    );
  }
  if (method === "unitroot") {
    return (
      <>
        <div className="grid grid-cols-2 gap-1.5">
          {statCard("ADF P-VALUE", fmt(r.adfPValue, 4))}
          {statCard("KPSS P-VALUE", fmt(r.kpssPValue, 4))}
        </div>
        <div className="font-terminal text-[9px] text-foreground">{r.conclusion}</div>
      </>
    );
  }
  return null;
}

type PanelCausalMethod = "panelols" | "mixed" | "iv2sls" | "did" | "rd" | "quantile" | "sur";
const PANEL_CAUSAL_METHODS: { key: PanelCausalMethod; label: string }[] = [
  { key: "panelols", label: "PANEL OLS (POOLED / FE / RE / HAUSMAN)" },
  { key: "mixed", label: "HIERARCHICAL / MIXED-EFFECTS PANEL (RANDOM INTERCEPT ± SLOPE)" },
  { key: "iv2sls", label: "2SLS INSTRUMENTAL VARIABLES" },
  { key: "did", label: "DIFFERENCE-IN-DIFFERENCES" },
  { key: "rd", label: "REGRESSION DISCONTINUITY" },
  { key: "quantile", label: "QUANTILE REGRESSION" },
  { key: "sur", label: "SEEMINGLY UNRELATED REGRESSION" },
];

// Sixth Python-sidecar-backed tab (python-service/econometrics.py). Real
// data fits differently per method here, not uniformly: Panel OLS, RD,
// Quantile Regression, and SUR all have a natural real-ticker-data
// construction (a real panel of stocks vs. the market, a real price-level
// discontinuity question, real factor regressions) and load it directly.
// IV and DiD genuinely need an externally-defined identification scenario
// (a real instrument, a real treatment assignment) that can't be
// meaningfully auto-derived from price series -- rather than fabricate
// one, those two stay manual-entry, pre-filled with a real, verified
// (not toy-sized) example: n=80, generated from a known DGP and confirmed
// to recover it correctly in the econometrics known-answer tests.
function PanelCausalTab() {
  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";
  const [method, setMethod] = useTerminalArtifactState<PanelCausalMethod>("PanelCausalTab.method", "panelols");
  const [result, setResult, postOriginal] = useOriginalQuantResult<unknown>(`qwb.panelcausal.${method}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelCovType, setPanelCovType] = useTerminalArtifactState<"unadjusted" | "robust" | "clustered" | "kernel">("PanelCausalTab.panelCovType", "unadjusted");
  const [panelKernelMaxLagsInput, setPanelKernelMaxLagsInput] = useTerminalArtifactState("PanelCausalTab.panelKernelMaxLagsInput", "");
  const [randomSlopeEnabled, setRandomSlopeEnabled] = useTerminalArtifactState("PanelCausalTab.randomSlopeEnabled", false);

  // ── Panel OLS: real panel = N tickers x trading days, y=stock return, x1=market return ──
  const [panelTickersInput, setPanelTickersInput] = useTerminalArtifactState("PanelCausalTab.panelTickersInput", "AAPL,MSFT,GOOGL,AMZN");
  const [marketTickerInput, setMarketTickerInput] = useTerminalArtifactState("PanelCausalTab.marketTickerInput", "SPY");
  const [panelSymbols, setPanelSymbols] = useTerminalArtifactState<string[]>("PanelCausalTab.panelSymbols", []);
  const [panelData, setPanelData] = useState<{ y: number[]; x: number[]; entity: string[]; time: string[] } | null>(null);
  const panelAllSymbols = panelSymbols;
  const panelResults = useSymbolOHLCV(panelAllSymbols);
  const panelLoading = panelAllSymbols.length > 0 && panelResults.some((r) => r.isLoading);
  const panelDataReady = panelAllSymbols.length >= 2 && panelResults.every((r) => !!r.data);

  function loadPanel() {
    const tickers = panelTickersInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 8);
    const market = marketTickerInput.trim().toUpperCase();
    if (!market || tickers.length < 2) { setError("Enter at least 2 panel tickers and 1 market ticker."); return; }
    setPanelSymbols([...tickers, market]);
  }

  useEffect(() => {
    if (!panelDataReady) return;
    const tickers = panelTickersInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 8);
    const marketIdx = panelResults.length - 1;
    const marketBars = panelResults[marketIdx].data!.bars ?? [];
    const marketReturnsByDate = new Map<string, number>();
    const marketReturns = computeDailyReturns(marketBars.map((b) => b.close));
    const marketDates = marketBars.slice(1).map((b) => b.date); // computeDailyReturns drops the first bar
    marketDates.forEach((d, i) => marketReturnsByDate.set(d, marketReturns[i]));

    const y: number[] = [], x: number[] = [], entity: string[] = [], time: string[] = [];
    tickers.forEach((ticker, i) => {
      const bars = panelResults[i].data!.bars ?? [];
      const returns = computeDailyReturns(bars.map((b) => b.close));
      const dates = bars.slice(1).map((b) => b.date);
      dates.forEach((d, j) => {
        const marketRet = marketReturnsByDate.get(d);
        if (marketRet !== undefined) { y.push(returns[j]); x.push(marketRet); entity.push(ticker); time.push(d); }
      });
    });
    setPanelData({ y, x, entity, time });
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelDataReady]);

  // ── 2SLS IV: manual entry, real n=80 example (see file header comment) ──
  const [ivY, setIvY] = useTerminalArtifactState("PanelCausalTab.ivY", "4.743,1.401,4.206,0.885,1.188,1.517,1.937,0.458,4.421,2.427,0.940,2.372,2.660,2.296,0.426,0.001,5.411,2.873,1.312,-0.213,4.179,3.248,1.046,4.822,3.193,-1.978,1.633,-0.963,4.942,1.888,0.678,4.272,1.238,2.564,-3.458,2.809,-1.360,4.125,3.650,3.684,1.683,0.444,1.783,-0.012,-0.677,0.258,3.506,5.925,2.425,1.762,4.069,1.831,2.661,1.955,0.826,-0.091,0.323,1.557,0.695,4.345,0.992,0.345,0.403,3.669,0.027,0.004,0.178,-0.239,0.589,-1.704,4.037,-1.090,3.247,5.212,5.290,3.697,3.161,3.406,2.149,0.384");
  const [ivEndog, setIvEndog] = useTerminalArtifactState("PanelCausalTab.ivEndog", "1.073,0.642,1.282,-1.243,-0.392,0.085,-0.589,0.276,1.299,0.490,-0.345,0.535,0.248,0.260,-1.155,-0.982,2.621,1.050,-0.771,-0.961,0.060,0.585,0.231,0.673,0.420,-2.253,0.213,-0.882,1.875,-0.047,-0.539,0.509,0.395,0.370,-3.252,0.781,-1.660,0.852,1.011,1.274,-0.650,-0.277,0.130,-1.019,-1.266,-0.063,0.771,2.044,0.711,-0.174,0.085,-0.306,-0.059,0.169,-0.704,-1.938,-1.087,-0.749,-1.716,1.311,-0.701,0.123,-0.594,0.009,-1.745,-0.934,-0.593,-1.659,-0.430,-1.578,0.847,-1.864,0.397,1.469,1.974,1.830,-0.473,0.874,0.587,-0.140");
  const [ivInstr, setIvInstr] = useTerminalArtifactState("PanelCausalTab.ivInstr", "0.655,0.894,0.416,-0.924,-0.196,-0.591,-0.300,1.297,1.530,0.669,0.549,0.677,-0.012,-0.076,-0.674,-0.056,2.260,0.869,-0.342,-0.472,-0.864,0.374,0.392,-1.443,0.486,-0.569,1.427,0.157,1.718,-0.458,-0.288,0.300,1.056,0.566,-1.234,0.183,0.022,-0.429,-0.648,1.748,-0.390,-0.846,0.637,0.131,-0.076,0.781,0.489,0.362,0.964,0.284,-0.617,-0.362,-0.521,0.210,-1.078,-1.832,0.088,-1.337,-1.952,0.373,-0.711,0.496,-0.531,-1.122,-1.244,-0.515,-0.273,-0.823,-0.281,-1.536,0.014,-1.794,-0.194,0.697,1.092,1.714,-1.556,0.759,1.206,0.981");
  const [ivInstr2, setIvInstr2] = useTerminalArtifactState("PanelCausalTab.ivInstr2", "");

  // ── DiD: manual entry, real n=80 example ──
  const [didY, setDidY] = useTerminalArtifactState("PanelCausalTab.didY", "22.157,19.171,12.471,13.562,10.920,19.568,20.516,13.455,12.594,20.371,11.345,11.016,20.595,9.317,9.286,10.092,10.687,10.177,10.879,21.846,11.938,12.316,12.524,12.830,12.137,11.869,11.477,19.749,11.291,11.036,12.072,10.272,13.859,18.736,13.115,10.435,20.874,10.072,11.361,9.353,20.818,12.037,9.951,13.792,14.202,9.963,21.933,18.006,10.951,12.867,11.738,13.579,12.517,9.911,12.682,20.151,18.468,13.219,10.186,11.833,10.871,10.017,19.576,19.867,21.659,20.379,12.535,20.154,12.766,11.006,9.736,21.542,10.856,19.955,19.523,9.846,8.449,13.943,13.341,13.138");
  const [didTreated, setDidTreated] = useTerminalArtifactState("PanelCausalTab.didTreated", "1,1,0,1,1,1,1,0,1,1,0,0,1,0,0,1,0,1,0,1,0,0,0,1,0,1,1,1,0,1,1,0,0,1,1,0,1,0,0,0,1,1,0,1,1,0,1,1,0,1,1,0,1,0,1,1,1,0,0,0,1,0,1,1,1,1,0,1,1,1,0,1,0,1,1,0,0,0,0,0");
  const [didPost, setDidPost] = useTerminalArtifactState("PanelCausalTab.didPost", "1,1,1,0,0,1,1,1,0,1,0,0,1,0,0,0,0,0,0,1,1,1,1,0,1,0,0,1,0,0,0,0,1,1,0,0,1,0,1,0,1,0,0,0,0,0,1,1,1,0,0,1,0,0,0,1,1,1,0,0,0,0,1,1,1,1,1,1,0,0,0,1,0,1,1,0,0,1,1,1");

  // ── RD: real ticker -- y=next-day return, x=price level, cutoff=round number ──
  const [rdTickerInput, setRdTickerInput] = useTerminalArtifactState("PanelCausalTab.rdTickerInput", "AAPL");
  const [rdCutoff, setRdCutoff] = useTerminalArtifactState("PanelCausalTab.rdCutoff", "200");
  const [rdSymbols, setRdSymbols] = useTerminalArtifactState<string[]>("PanelCausalTab.rdSymbols", []);
  const [rdData, setRdData] = useState<{ y: number[]; x: number[] } | null>(null);
  const rdResults = useSymbolOHLCV(rdSymbols);
  const rdLoading = rdSymbols.length > 0 && rdResults.some((r) => r.isLoading);
  const rdDataReady = rdSymbols.length === 1 && !!rdResults[0]?.data;

  function loadRd() {
    const ticker = rdTickerInput.trim().toUpperCase();
    if (!ticker) return;
    setRdSymbols([ticker]);
  }
  useEffect(() => {
    if (!rdDataReady) return;
    const bars = rdResults[0].data!.bars ?? [];
    if (bars.length < 30) return;
    const x = bars.slice(0, -1).map((b) => b.close); // today's price level
    const y = computeDailyReturns(bars.map((b) => b.close)); // next-day return
    setRdData({ y, x });
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rdDataReady]);

  // ── Quantile regression: 2 real tickers, y regressed on x ──
  const [qrTickerInput, setQrTickerInput] = useTerminalArtifactState("PanelCausalTab.qrTickerInput", "AAPL,SPY");
  const [qrQuantile, setQrQuantile] = useTerminalArtifactState("PanelCausalTab.qrQuantile", "0.5");
  const [qrSymbols, setQrSymbols] = useTerminalArtifactState<string[]>("PanelCausalTab.qrSymbols", []);
  const [qrData, setQrData] = useState<{ y: number[]; x: number[] } | null>(null);
  const qrResults = useSymbolOHLCV(qrSymbols);
  const qrLoading = qrSymbols.length > 0 && qrResults.some((r) => r.isLoading);
  const qrDataReady = qrSymbols.length === 2 && qrResults.every((r) => !!r.data);

  function loadQr() {
    const symbols = qrTickerInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 2);
    if (symbols.length < 2) { setError("Enter exactly 2 tickers (Y,X)."); return; }
    setQrSymbols(symbols);
  }
  useEffect(() => {
    if (!qrDataReady) return;
    const aligned = alignSeriesByDate(qrResults.map((r) => r.data!.bars ?? []));
    if (aligned.some((s) => s.length < 15)) return;
    const returns = aligned.map((closes) => computeDailyReturns(closes));
    const minLen = Math.min(...returns.map((s) => s.length));
    setQrData({ y: returns[0].slice(-minLen), x: returns[1].slice(-minLen) });
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrDataReady]);

  // ── SUR: up to 4 real tickers, each regressed on a shared market ticker ──
  const [surTickersInput, setSurTickersInput] = useTerminalArtifactState("PanelCausalTab.surTickersInput", "AAPL,MSFT,GOOGL");
  const [surMarketInput, setSurMarketInput] = useTerminalArtifactState("PanelCausalTab.surMarketInput", "SPY");
  const [surSymbols, setSurSymbols] = useTerminalArtifactState<string[]>("PanelCausalTab.surSymbols", []);
  const [surEquations, setSurEquations] = useState<{ name: string; y: number[]; x: number[] }[] | null>(null);
  const surResults = useSymbolOHLCV(surSymbols);
  const surLoading = surSymbols.length > 0 && surResults.some((r) => r.isLoading);
  const surDataReady = surSymbols.length >= 3 && surResults.every((r) => !!r.data);

  function loadSur() {
    const tickers = surTickersInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 4);
    const market = surMarketInput.trim().toUpperCase();
    if (!market || tickers.length < 2) { setError("Enter at least 2 tickers and 1 market ticker."); return; }
    setSurSymbols([...tickers, market]);
  }
  useEffect(() => {
    if (!surDataReady) return;
    const tickers = surTickersInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 4);
    const aligned = alignSeriesByDate(surResults.map((r) => r.data!.bars ?? []));
    if (aligned.some((s) => s.length < 15)) return;
    const returns = aligned.map((closes) => computeDailyReturns(closes));
    const minLen = Math.min(...returns.map((s) => s.length));
    const trimmed = returns.map((s) => s.slice(-minLen));
    const marketReturns = trimmed[trimmed.length - 1];
    setSurEquations(tickers.map((name, i) => ({ name, y: trimmed[i], x: marketReturns })));
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surDataReady]);

  async function runPanelCausal() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let path = "";
      let body: unknown;
      switch (method) {
        case "panelols":
          if (!panelData) { setError("Load a real panel first."); setLoading(false); return; }
          path = "/api/quant/econometrics/panel-ols";
          body = {
            y: panelData.y, x: [panelData.x], entityIds: panelData.entity, timeIds: panelData.time,
            covType: panelCovType,
            ...(panelCovType === "kernel" && panelKernelMaxLagsInput ? { kernelMaxLags: Number(panelKernelMaxLagsInput) } : {}),
          };
          break;
        case "mixed":
          if (!panelData) { setError("Load a real panel first."); setLoading(false); return; }
          path = "/api/quant/econometrics/mixed-effects-panel";
          body = { y: panelData.y, x: [panelData.x], groups: panelData.entity, ...(randomSlopeEnabled ? { randomSlopeIndex: 0 } : {}) };
          break;
        case "iv2sls":
          path = "/api/quant/econometrics/iv-2sls";
          body = {
            y: parseNumList(ivY),
            endogenous: [parseNumList(ivEndog)],
            instruments: ivInstr2.trim() ? [parseNumList(ivInstr), parseNumList(ivInstr2)] : [parseNumList(ivInstr)],
          };
          break;
        case "did":
          path = "/api/quant/econometrics/did";
          body = { y: parseNumList(didY), treated: parseNumList(didTreated), post: parseNumList(didPost) };
          break;
        case "rd":
          if (!rdData) { setError("Load a real ticker series first."); setLoading(false); return; }
          path = "/api/quant/econometrics/rd";
          body = { y: rdData.y, x: rdData.x, cutoff: Number(rdCutoff) };
          break;
        case "quantile":
          if (!qrData) { setError("Load real ticker data first."); setLoading(false); return; }
          path = "/api/quant/econometrics/quantile-regression";
          body = { y: qrData.y, x: [qrData.x], quantile: Number(qrQuantile) };
          break;
        case "sur":
          if (!surEquations) { setError("Load real ticker data first."); setLoading(false); return; }
          path = "/api/quant/econometrics/sur";
          body = { equations: surEquations.map((eq) => ({ name: eq.name, y: eq.y, x: [eq.x] })) };
          break;
      }
      await postOriginal(path, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Econometrics engine unavailable right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={method} onChange={(e) => { setMethod(e.target.value as PanelCausalMethod); setResult(null); setError(null); }} className={inputCls}>
          {PANEL_CAUSAL_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <button onClick={runPanelCausal} disabled={loading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50">
          {loading ? "RUNNING..." : "RUN"}
        </button>
      </div>

      {(method === "panelols" || method === "mixed") && (
        <div className="border border-border/60 p-2.5 space-y-1.5">
          <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">REAL PANEL — 2-8 TICKERS x 1Y DAILY, EACH REGRESSED ON THE MARKET TICKER'S SAME-DAY RETURN</div>
          <div className="flex items-center gap-2">
            <input value={panelTickersInput} onChange={(e) => setPanelTickersInput(e.target.value)} placeholder="AAPL,MSFT,GOOGL,AMZN" className={`flex-1 ${inputCls}`} />
            <input value={marketTickerInput} onChange={(e) => setMarketTickerInput(e.target.value)} placeholder="SPY" className={`w-20 ${inputCls}`} />
            <button onClick={loadPanel} disabled={panelLoading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50 whitespace-nowrap">
              {panelLoading ? "LOADING..." : "LOAD PANEL"}
            </button>
          </div>
          {panelData && <div className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">Loaded {panelData.y.length.toLocaleString()} panel observations.</div>}
          {method === "panelols" && (
            <div className="flex flex-wrap items-center gap-3 pt-1.5">
              <label className="flex items-center gap-1.5">
                <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">COV TYPE</span>
                <select value={panelCovType} onChange={(e) => setPanelCovType(e.target.value as typeof panelCovType)} className={inputCls}>
                  <option value="unadjusted">UNADJUSTED (CLASSICAL)</option>
                  <option value="robust">ROBUST (HETEROSKEDASTICITY)</option>
                  <option value="clustered">CLUSTERED (BY ENTITY)</option>
                  <option value="kernel">KERNEL (HAC)</option>
                </select>
              </label>
              {panelCovType === "kernel" && <input value={panelKernelMaxLagsInput} onChange={(e) => setPanelKernelMaxLagsInput(e.target.value)} placeholder="BANDWIDTH" inputMode="numeric" className={`w-24 ${inputCls}`} />}
            </div>
          )}
          {method === "mixed" && (
            <label className="flex items-center gap-1.5 pt-1.5">
              <input type="checkbox" checked={randomSlopeEnabled} onChange={(e) => setRandomSlopeEnabled(e.target.checked)} />
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">INCLUDE RANDOM SLOPE ON MARKET RETURN</span>
            </label>
          )}
        </div>
      )}

      {method === "iv2sls" && (
        <div className="space-y-2">
          <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MANUAL SCENARIO ENTRY — a real instrument/endogeneity structure can't be auto-derived from price data, so this is pre-filled with a verified n=80 example (real confound, 2SLS correctly recovers the true effect where naive OLS would be biased)</div>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">Y (OUTCOME)</span><input value={ivY} onChange={(e) => setIvY(e.target.value)} className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">ENDOGENOUS REGRESSOR</span><input value={ivEndog} onChange={(e) => setIvEndog(e.target.value)} className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">INSTRUMENT 1</span><input value={ivInstr} onChange={(e) => setIvInstr(e.target.value)} className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">INSTRUMENT 2 (OPTIONAL — ENABLES SARGAN OVERIDENTIFICATION TEST)</span><input value={ivInstr2} onChange={(e) => setIvInstr2(e.target.value)} className={inputCls} /></label>
        </div>
      )}

      {method === "did" && (
        <div className="space-y-2">
          <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MANUAL SCENARIO ENTRY — pre-filled with a verified n=80 example (true DiD effect=5.0)</div>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">Y (OUTCOME)</span><input value={didY} onChange={(e) => setDidY(e.target.value)} className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">TREATED (0/1)</span><input value={didTreated} onChange={(e) => setDidTreated(e.target.value)} className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">POST (0/1)</span><input value={didPost} onChange={(e) => setDidPost(e.target.value)} className={inputCls} /></label>
        </div>
      )}

      {method === "rd" && (
        <div className="border border-border/60 p-2.5 space-y-1.5">
          <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">REAL DATA — does next-day return jump when price crosses a threshold? Y=next-day return, X=today's closing price</div>
          <div className="flex items-center gap-2">
            <input value={rdTickerInput} onChange={(e) => setRdTickerInput(e.target.value)} placeholder="AAPL" className={`w-24 ${inputCls}`} />
            <label className="flex items-center gap-1.5">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">CUTOFF PRICE</span>
              <input value={rdCutoff} onChange={(e) => setRdCutoff(e.target.value)} inputMode="decimal" className={`w-20 ${inputCls}`} />
            </label>
            <button onClick={loadRd} disabled={rdLoading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50 whitespace-nowrap">
              {rdLoading ? "LOADING..." : "LOAD SERIES"}
            </button>
          </div>
          {rdData && <div className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">Loaded {rdData.y.length.toLocaleString()} days.</div>}
        </div>
      )}

      {method === "quantile" && (
        <div className="border border-border/60 p-2.5 space-y-1.5">
          <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">REAL DATA — 2 TICKERS (Y,X), 1Y DAILY RETURNS</div>
          <div className="flex items-center gap-2">
            <input value={qrTickerInput} onChange={(e) => setQrTickerInput(e.target.value)} placeholder="AAPL,SPY" className={`flex-1 ${inputCls}`} />
            <label className="flex items-center gap-1.5">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">QUANTILE</span>
              <input value={qrQuantile} onChange={(e) => setQrQuantile(e.target.value)} inputMode="decimal" className={`w-16 ${inputCls}`} />
            </label>
            <button onClick={loadQr} disabled={qrLoading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50 whitespace-nowrap">
              {qrLoading ? "LOADING..." : "LOAD RETURNS"}
            </button>
          </div>
          {qrData && <div className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">Loaded {qrData.y.length.toLocaleString()} days.</div>}
        </div>
      )}

      {method === "sur" && (
        <div className="border border-border/60 p-2.5 space-y-1.5">
          <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">REAL DATA — 2-4 TICKERS, EACH ITS OWN EQUATION VS. THE MARKET TICKER (CAPTURES CROSS-STOCK RESIDUAL CORRELATION)</div>
          <div className="flex items-center gap-2">
            <input value={surTickersInput} onChange={(e) => setSurTickersInput(e.target.value)} placeholder="AAPL,MSFT,GOOGL" className={`flex-1 ${inputCls}`} />
            <input value={surMarketInput} onChange={(e) => setSurMarketInput(e.target.value)} placeholder="SPY" className={`w-20 ${inputCls}`} />
            <button onClick={loadSur} disabled={surLoading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50 whitespace-nowrap">
              {surLoading ? "LOADING..." : "LOAD EQUATIONS"}
            </button>
          </div>
          {surEquations && <div className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">Loaded {surEquations.length} equations, {surEquations[0]?.y.length ?? 0} days each.</div>}
        </div>
      )}

      {error && <div className="font-terminal text-[9px] text-red-400">{error}</div>}
      <RecordedOriginalRun result={result}/>
      {result != null && <PanelCausalResultView method={method} result={result} />}
    </div>
  );
}

function PanelCausalResultView({ method, result }: { method: PanelCausalMethod; result: unknown }) {
  const r = result as Record<string, any>;
  if (method === "panelols") {
    const models: [string, any][] = [["POOLED OLS", r.pooledOls], ["FIXED EFFECTS", r.fixedEffects], ["RANDOM EFFECTS", r.randomEffects]];
    return (
      <>
        {models.map(([label, m]) => (
          <div key={label}>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">{label} (R²={fmt(m.rSquared, 4)})</div>
            <RegressionCoefTable coefficients={m.coefficients} standardErrors={m.standardErrors} tStats={m.tStats} pValues={m.pValues} />
          </div>
        ))}
        <div className="grid grid-cols-2 gap-1.5">
          {statCard("HAUSMAN STATISTIC", `${fmt(r.hausmanStatistic, 3)} (df=${r.hausmanDof})`)}
          {statCard("HAUSMAN P-VALUE", fmt(r.hausmanPValue, 4))}
        </div>
        <div className="font-terminal text-[9px] text-foreground">{r.hausmanConclusion}</div>
      </>
    );
  }
  if (method === "mixed") {
    return (
      <>
        <RegressionCoefTable
          coefficients={r.fixedEffectsCoefficients}
          standardErrors={r.fixedEffectsStandardErrors}
          tStats={r.fixedEffectsCoefficients.map((c: number, i: number) => c / r.fixedEffectsStandardErrors[i])}
          pValues={r.fixedEffectsPValues}
        />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          {statCard("RANDOM INTERCEPT VARIANCE", fmt(r.randomInterceptVariance, 5))}
          {r.randomSlopeVariance != null && statCard("RANDOM SLOPE VARIANCE", fmt(r.randomSlopeVariance, 5))}
          {statCard("RESIDUAL VARIANCE", fmt(r.residualVariance, 5))}
          {statCard("LOG-LIKELIHOOD", fmt(r.logLikelihood, 3))}
          {statCard("CONVERGED", String(r.converged))}
        </div>
      </>
    );
  }
  if (method === "iv2sls") {
    return (
      <>
        <RegressionCoefTable coefficients={r.coefficients} standardErrors={r.standardErrors} tStats={r.tStats} pValues={r.pValues} />
        <div className="grid grid-cols-1 gap-1.5">{statCard("FIRST-STAGE F-STAT (WANT > 10)", fmt(r.firstStageFStat, 2))}</div>
        {r.overidentified ? (
          <div className="grid grid-cols-2 gap-1.5">
            {statCard("SARGAN OVERID. STATISTIC", `${fmt(r.sarganStatistic, 3)} (df=${r.sarganDegreesOfFreedom})`)}
            {statCard("SARGAN P-VALUE", fmt(r.sarganPValue, 4))}
          </div>
        ) : (
          <div className="font-terminal text-[7.5px] text-muted-foreground/70">Exactly identified — no overidentification/Sargan test is available.</div>
        )}
      </>
    );
  }
  if (method === "did") {
    return (
      <>
        <div className="grid grid-cols-2 gap-1.5">
          {statCard("DID ESTIMATE", fmt(r.didEstimate, 4))}
          {statCard("P-VALUE", fmt(r.pValue, 4))}
        </div>
        <div className="border border-border">
          <table className="w-full border-collapse">
            <thead><tr className="border-b border-border bg-[#070707]">
              <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">GROUP</th>
              <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">PRE</th>
              <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">POST</th>
            </tr></thead>
            <tbody>
              <tr className="border-b border-border/30"><td className="px-3 py-2 font-terminal text-[9px] font-bold text-foreground">TREATED</td><td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(r.treatedPreMean, 3)}</td><td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(r.treatedPostMean, 3)}</td></tr>
              <tr><td className="px-3 py-2 font-terminal text-[9px] font-bold text-foreground">CONTROL</td><td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(r.controlPreMean, 3)}</td><td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right">{fmt(r.controlPostMean, 3)}</td></tr>
            </tbody>
          </table>
        </div>
      </>
    );
  }
  if (method === "rd") {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {statCard("RD ESTIMATE (JUMP AT CUTOFF)", fmt(r.rdEstimate, 4))}
        {statCard("P-VALUE", fmt(r.pValue, 4))}
      </div>
    );
  }
  if (method === "quantile") {
    return (
      <>
        <div className="grid grid-cols-1 gap-1.5">{statCard("PSEUDO R²", fmt(r.pseudoRSquared, 4))}</div>
        <RegressionCoefTable coefficients={r.coefficients} standardErrors={r.standardErrors} tStats={r.tStats} pValues={r.pValues} />
      </>
    );
  }
  if (method === "sur") {
    return (
      <>
        {(r.equations as any[]).map((eq) => (
          <div key={eq.name}>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">{eq.name}</div>
            <RegressionCoefTable coefficients={eq.coefficients} standardErrors={eq.standardErrors} tStats={eq.coefficients.map((c: number, i: number) => c / eq.standardErrors[i])} pValues={eq.pValues} />
          </div>
        ))}
        <div>
          <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">RESIDUAL CORRELATION (SUR's advantage over separate OLS)</div>
          <div className="font-terminal text-[9px] tabular-nums">
            {(r.residualCorrelation as number[][]).map((row, i) => <div key={i}>{row.map((v) => fmt(v, 3)).join("  ")}</div>)}
          </div>
        </div>
      </>
    );
  }
  return null;
}

// ── Real options chain loading (Phase 3) ──
// server/lseData.ts's getOptionsChain() -- verified live against a real
// AAPL chain: 3,340 contracts, 32 expiries, 1,703 calls with sane IV. SABR/
// Heston calibration against a handful of hand-typed points would be
// pointless when a real, large, genuinely noisy market smile/surface is one
// fetch away. Internal-only data source (the /api/lse/* routes require an
// internal session) -- the calibration math itself stays open to both
// builds (matches every sibling quant route), so a client session can still
// use manual entry; only the real-chain LOAD button needs internal access.
interface LseOptionContract {
  ticker: string; underlying: string; contract_type: "call" | "put"; strike: number; expiry: string;
  last_price: number; volume_today: number; underlying_price: number; dte: number; iv: number | null;
}

function useOptionsChain() {
  const [chain, setChain] = useState<LseOptionContract[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spot, setSpot] = useState<number | null>(null);

  async function loadChain(underlying: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/lse/options-chain/${encodeURIComponent(underlying.toUpperCase())}`);
      if (!res.ok) {
        throw new Error(res.status === 403 || res.status === 401
          ? "Real options chain data needs an internal session -- enter strikes/vols manually below instead."
          : `Failed to load chain (HTTP ${res.status}).`);
      }
      const data: LseOptionContract[] = await res.json();
      if (data.length === 0) { setError(`No options chain data found for ${underlying.toUpperCase()}.`); setChain(null); return; }
      setChain(data);
      setSpot(data[0].underlying_price);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load options chain.");
      setChain(null);
    } finally {
      setLoading(false);
    }
  }

  return { chain, spot, loading, error, loadChain };
}

type OptionsVolMethod = "sabr" | "heston-calibrate" | "heston-price";
const OPTIONS_VOL_METHODS: { key: OptionsVolMethod; label: string }[] = [
  { key: "sabr", label: "SABR SMILE CALIBRATION" },
  { key: "heston-calibrate", label: "HESTON SURFACE CALIBRATION" },
  { key: "heston-price", label: "HESTON PRICE VS. BLACK-SCHOLES" },
];

function OptionsVolatilityTab() {
  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";
  const [method, setMethod] = useTerminalArtifactState<OptionsVolMethod>("OptionsVolatilityTab.method", "sabr");
  const [result, setResult, postOriginal] = useOriginalQuantResult<unknown>(`qwb.optionsvol.${method}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { chain, spot, loading: chainLoading, error: chainError, loadChain } = useOptionsChain();
  const [tickerInput, setTickerInput] = useTerminalArtifactState("OptionsVolatilityTab.tickerInput", "AAPL");
  const [moneynessLow, setMoneynessLow] = useTerminalArtifactState("OptionsVolatilityTab.moneynessLow", "80");
  const [moneynessHigh, setMoneynessHigh] = useTerminalArtifactState("OptionsVolatilityTab.moneynessHigh", "120");
  const [riskFreeRatePct, setRiskFreeRatePct] = useTerminalArtifactState("OptionsVolatilityTab.riskFreeRatePct", "4.5");
  const [dividendYieldPct, setDividendYieldPct] = useTerminalArtifactState("OptionsVolatilityTab.dividendYieldPct", "0.5");

  const availableExpiries = useMemo(() => {
    if (!chain) return [];
    return Array.from(new Set(chain.map((c) => c.expiry))).sort();
  }, [chain]);

  // ── SABR ──
  const [sabrExpiry, setSabrExpiry] = useTerminalArtifactState("OptionsVolatilityTab.sabrExpiry", "");
  const [sabrBeta, setSabrBeta] = useTerminalArtifactState("OptionsVolatilityTab.sabrBeta", "0.5");
  const [manualStrikes, setManualStrikes] = useTerminalArtifactState("OptionsVolatilityTab.manualStrikes", "90,95,100,105,110");
  const [manualVols, setManualVols] = useTerminalArtifactState("OptionsVolatilityTab.manualVols", "28,24,22,23,26");
  const [manualForward, setManualForward] = useTerminalArtifactState("OptionsVolatilityTab.manualForward", "100");
  const [manualExpiryYears, setManualExpiryYears] = useTerminalArtifactState("OptionsVolatilityTab.manualExpiryYears", "0.25");

  const sabrChainQuotes = useMemo(() => {
    if (!chain || !sabrExpiry || !spot) return null;
    const lo = (Number(moneynessLow) / 100) * spot, hi = (Number(moneynessHigh) / 100) * spot;
    const rows = chain.filter((c) => c.expiry === sabrExpiry && c.contract_type === "call" && c.iv != null && c.iv > 0.01 && c.iv < 5 && c.strike >= lo && c.strike <= hi);
    rows.sort((a, b) => a.strike - b.strike);
    return rows;
  }, [chain, sabrExpiry, spot, moneynessLow, moneynessHigh]);

  // ── Heston calibrate ──
  const [hestonNumExpiries, setHestonNumExpiries] = useTerminalArtifactState("OptionsVolatilityTab.hestonNumExpiries", "5");
  const [hV0, setHV0] = useTerminalArtifactState("OptionsVolatilityTab.hV0", "0.04");
  const [hKappa, setHKappa] = useTerminalArtifactState("OptionsVolatilityTab.hKappa", "2.0");
  const [hTheta, setHTheta] = useTerminalArtifactState("OptionsVolatilityTab.hTheta", "0.04");
  const [hSigma, setHSigma] = useTerminalArtifactState("OptionsVolatilityTab.hSigma", "0.5");
  const [hRho, setHRho] = useTerminalArtifactState("OptionsVolatilityTab.hRho", "-0.5");

  const hestonChainQuotes = useMemo(() => {
    if (!chain || !spot) return null;
    const lo = (Number(moneynessLow) / 100) * spot, hi = (Number(moneynessHigh) / 100) * spot;
    const rows = chain.filter((c) => c.contract_type === "call" && c.iv != null && c.iv > 0.01 && c.iv < 5 && c.strike >= lo && c.strike <= hi && c.dte > 3);
    const expiries = Array.from(new Set(rows.map((r) => r.expiry))).sort();
    const n = Math.max(2, Math.min(expiries.length, Number(hestonNumExpiries)));
    const step = Math.max(1, Math.floor(expiries.length / n));
    const chosen = new Set(expiries.filter((_, i) => i % step === 0).slice(0, n));
    return rows.filter((r) => chosen.has(r.expiry));
  }, [chain, spot, moneynessLow, moneynessHigh, hestonNumExpiries]);

  // ── Heston price vs BSM ──
  const [priceSpot, setPriceSpot] = useTerminalArtifactState("OptionsVolatilityTab.priceSpot", "100");
  const [priceStrike, setPriceStrike] = useTerminalArtifactState("OptionsVolatilityTab.priceStrike", "100");
  const [priceExpiryYears, setPriceExpiryYears] = useTerminalArtifactState("OptionsVolatilityTab.priceExpiryYears", "0.25");
  const [priceIsCall, setPriceIsCall] = useTerminalArtifactState("OptionsVolatilityTab.priceIsCall", true);

  async function runOptionsVol() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let path = "";
      let body: unknown;
      if (method === "sabr") {
        const strikes = sabrChainQuotes ? sabrChainQuotes.map((c) => c.strike) : parseNumList(manualStrikes);
        const vols = sabrChainQuotes ? sabrChainQuotes.map((c) => (c.iv as number) * 100) : parseNumList(manualVols);
        const forward = sabrChainQuotes ? (spot as number) : Number(manualForward);
        const expiryYears = sabrChainQuotes ? (sabrChainQuotes[0].dte / 365) : Number(manualExpiryYears);
        if (strikes.length < 3) { setError("Need at least 3 strikes -- load a real chain or widen the moneyness band."); setLoading(false); return; }
        path = "/api/quant/options/sabr-calibrate";
        body = { forward, expiryYears, beta: Number(sabrBeta), strikes, marketVolsPct: vols };
      } else if (method === "heston-calibrate") {
        if (!hestonChainQuotes || hestonChainQuotes.length < 5) { setError("Load a real chain first -- Heston needs at least 5 real quotes across strikes/expiries."); setLoading(false); return; }
        path = "/api/quant/options/heston-calibrate";
        body = {
          spot, riskFreeRatePct: Number(riskFreeRatePct), dividendYieldPct: Number(dividendYieldPct),
          quotes: hestonChainQuotes.map((c) => ({ strike: c.strike, expiryYears: c.dte / 365, marketVolPct: (c.iv as number) * 100 })),
          v0: Number(hV0), kappa: Number(hKappa), theta: Number(hTheta), sigma: Number(hSigma), rho: Number(hRho),
        };
      } else {
        path = "/api/quant/options/heston-price";
        body = {
          spot: Number(priceSpot), strike: Number(priceStrike), expiryYears: Number(priceExpiryYears),
          riskFreeRatePct: Number(riskFreeRatePct), dividendYieldPct: Number(dividendYieldPct), isCall: priceIsCall,
          v0: Number(hV0), kappa: Number(hKappa), theta: Number(hTheta), sigma: Number(hSigma), rho: Number(hRho),
        };
      }
      await postOriginal(path, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Options volatility engine unavailable right now.");
    } finally {
      setLoading(false);
    }
  }

  // Comparison against plain Black-Scholes-Merton, using the Heston result's
  // own back-solved implied vol so the two are priced on equal footing.
  const bsmComparison = useMemo(() => {
    if (method !== "heston-price" || !result) return null;
    const r = result as { impliedVolPct: number | null };
    if (r.impliedVolPct == null) return null;
    const recorded = originalRunParameters(result);
    const terms = recorded ?? { spot: Number(priceSpot), strike: Number(priceStrike), expiryYears: Number(priceExpiryYears), riskFreeRatePct: Number(riskFreeRatePct), dividendYieldPct: Number(dividendYieldPct), isCall: priceIsCall };
    const greeks = blackScholesMerton(Number(terms.spot), Number(terms.strike), Number(terms.expiryYears), Number(terms.riskFreeRatePct) / 100, Number(terms.dividendYieldPct) / 100, r.impliedVolPct / 100, terms.isCall === true);
    return greeks.price;
  }, [method, result, priceSpot, priceStrike, priceExpiryYears, riskFreeRatePct, dividendYieldPct, priceIsCall]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={method} onChange={(e) => { setMethod(e.target.value as OptionsVolMethod); setResult(null); setError(null); }} className={inputCls}>
          {OPTIONS_VOL_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <button onClick={runOptionsVol} disabled={loading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50">
          {loading ? "RUNNING..." : "RUN"}
        </button>
      </div>

      {(method === "sabr" || method === "heston-calibrate") && (
        <div className="border border-border/60 p-2.5 space-y-1.5">
          <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">LOAD REAL OPTIONS CHAIN — INTERNAL SESSIONS ONLY; OTHERWISE USE MANUAL ENTRY BELOW</div>
          <div className="flex items-center gap-2 flex-wrap">
            <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)} placeholder="AAPL" className={`w-24 ${inputCls}`} />
            <label className="flex items-center gap-1.5">
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MONEYNESS %</span>
              <input value={moneynessLow} onChange={(e) => setMoneynessLow(e.target.value)} inputMode="decimal" className={`w-14 ${inputCls}`} />
              <span className="font-terminal text-[8px] text-muted-foreground">–</span>
              <input value={moneynessHigh} onChange={(e) => setMoneynessHigh(e.target.value)} inputMode="decimal" className={`w-14 ${inputCls}`} />
            </label>
            <button onClick={() => loadChain(tickerInput)} disabled={chainLoading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50 whitespace-nowrap">
              {chainLoading ? "LOADING..." : "LOAD REAL CHAIN"}
            </button>
          </div>
          {chainError && <div className="font-terminal text-[8px] text-red-400">{chainError}</div>}
          {chain && spot && (
            <div className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">Loaded {chain.length.toLocaleString()} contracts, {availableExpiries.length} expiries, spot ${spot.toFixed(2)}.</div>
          )}
          {method === "sabr" && chain && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5">
                <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">EXPIRY</span>
                <select value={sabrExpiry} onChange={(e) => setSabrExpiry(e.target.value)} className={inputCls}>
                  <option value="">SELECT...</option>
                  {availableExpiries.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </label>
              {sabrChainQuotes && <span className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">{sabrChainQuotes.length} real quotes in band</span>}
            </div>
          )}
          {method === "heston-calibrate" && chain && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5">
                <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider"># EXPIRIES TO SAMPLE</span>
                <input value={hestonNumExpiries} onChange={(e) => setHestonNumExpiries(e.target.value)} inputMode="numeric" className={`w-14 ${inputCls}`} />
              </label>
              {hestonChainQuotes && <span className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">{hestonChainQuotes.length} real quotes selected</span>}
            </div>
          )}
        </div>
      )}

      {method === "sabr" && !sabrChainQuotes && (
        <div className="space-y-2">
          <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MANUAL ENTRY (used when no real chain/expiry is selected above)</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">FORWARD/SPOT</span><input value={manualForward} onChange={(e) => setManualForward(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">EXPIRY (YEARS)</span><input value={manualExpiryYears} onChange={(e) => setManualExpiryYears(e.target.value)} inputMode="decimal" className={inputCls} /></label>
          </div>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">STRIKES</span><input value={manualStrikes} onChange={(e) => setManualStrikes(e.target.value)} className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MARKET VOLS % (SAME ORDER AS STRIKES)</span><input value={manualVols} onChange={(e) => setManualVols(e.target.value)} className={inputCls} /></label>
        </div>
      )}
      {method === "sabr" && (
        <label className="flex items-center gap-1.5">
          <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">BETA (CONVENTIONALLY FIXED, NOT CALIBRATED)</span>
          <input value={sabrBeta} onChange={(e) => setSabrBeta(e.target.value)} inputMode="decimal" className={`w-16 ${inputCls}`} />
        </label>
      )}

      {method === "heston-calibrate" && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">RISK-FREE %</span><input value={riskFreeRatePct} onChange={(e) => setRiskFreeRatePct(e.target.value)} inputMode="decimal" className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">DIV YIELD %</span><input value={dividendYieldPct} onChange={(e) => setDividendYieldPct(e.target.value)} inputMode="decimal" className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">v0 GUESS</span><input value={hV0} onChange={(e) => setHV0(e.target.value)} inputMode="decimal" className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">κ GUESS</span><input value={hKappa} onChange={(e) => setHKappa(e.target.value)} inputMode="decimal" className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">θ GUESS</span><input value={hTheta} onChange={(e) => setHTheta(e.target.value)} inputMode="decimal" className={inputCls} /></label>
        </div>
      )}

      {method === "heston-price" && (
        <div className="space-y-2">
          <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">HESTON PARAMETERS (PASTE FROM A CALIBRATION ABOVE, OR ENTER YOUR OWN)</div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">v0</span><input value={hV0} onChange={(e) => setHV0(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">κ</span><input value={hKappa} onChange={(e) => setHKappa(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">θ</span><input value={hTheta} onChange={(e) => setHTheta(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">σ</span><input value={hSigma} onChange={(e) => setHSigma(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">ρ</span><input value={hRho} onChange={(e) => setHRho(e.target.value)} inputMode="decimal" className={inputCls} /></label>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">SPOT</span><input value={priceSpot} onChange={(e) => setPriceSpot(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">STRIKE</span><input value={priceStrike} onChange={(e) => setPriceStrike(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">EXPIRY (YRS)</span><input value={priceExpiryYears} onChange={(e) => setPriceExpiryYears(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">RISK-FREE %</span><input value={riskFreeRatePct} onChange={(e) => setRiskFreeRatePct(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">DIV YIELD %</span><input value={dividendYieldPct} onChange={(e) => setDividendYieldPct(e.target.value)} inputMode="decimal" className={inputCls} /></label>
          </div>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={priceIsCall} onChange={(e) => setPriceIsCall(e.target.checked)} />
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">CALL (UNCHECK FOR PUT)</span>
          </label>
        </div>
      )}

      {error && <div className="font-terminal text-[9px] text-red-400">{error}</div>}
      <RecordedOriginalRun result={result}/>

      {result != null && method === "sabr" && (() => {
        const r = result as { alpha: number; rho: number; nu: number; beta: number; calibrationRmseVolPts: number; fitQuality: string; fittedVolsPct: number[]; strikesUsed: number };
        const recorded = originalRunParameters(result);
        const strikes = recorded ? recorded.strikes as number[] : sabrChainQuotes ? sabrChainQuotes.map(quote => quote.strike) : parseNumList(manualStrikes);
        const marketVols = recorded ? recorded.marketVolsPct as number[] : sabrChainQuotes ? sabrChainQuotes.map(quote => (quote.iv as number) * 100) : parseNumList(manualVols);
        const chartData = strikes.map((k, i) => ({ strike: k, market: marketVols[i], fitted: r.fittedVolsPct[i] }));
        return (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {statCard("ALPHA", fmt(r.alpha, 4))}
              {statCard("RHO", fmt(r.rho, 4))}
              {statCard("NU", fmt(r.nu, 4))}
              {statCard("RMSE (VOL PTS)", fmt(r.calibrationRmseVolPts, 3))}
            </div>
            <div className="font-terminal text-[9px] text-foreground">{r.fitQuality}</div>
            <div className="h-56 border border-border p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid stroke="#222" strokeDasharray="2 2" />
                  <XAxis dataKey="strike" tick={{ fontSize: 8, fill: "#888" }} />
                  <YAxis tick={{ fontSize: 8, fill: "#888" }} unit="%" />
                  <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #333", fontSize: 9 }} />
                  <Legend wrapperStyle={{ fontSize: 8 }} />
                  <Line type="monotone" dataKey="market" name="Market IV" stroke="#888" strokeWidth={1.5} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="fitted" name="SABR Fitted" stroke="hsl(38,95%,55%)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        );
      })()}

      {result != null && method === "heston-calibrate" && (() => {
        const r = result as { v0: number; kappa: number; theta: number; sigma: number; rho: number; calibrationRmseVolPts: number; fitQuality: string; fellerConditionSatisfied: boolean; quotesUsed: number };
        return (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {statCard("v0 (INITIAL VOL)", `${fmt(Math.sqrt(r.v0) * 100, 1)}%`)}
              {statCard("κ (MEAN REV. SPEED)", fmt(r.kappa, 3))}
              {statCard("θ (LONG-RUN VOL)", `${fmt(Math.sqrt(r.theta) * 100, 1)}%`)}
              {statCard("σ (VOL-OF-VOL)", fmt(r.sigma, 4))}
              {statCard("ρ (SPOT-VOL CORR.)", fmt(r.rho, 4))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {statCard("RMSE (VOL PTS)", fmt(r.calibrationRmseVolPts, 3))}
              {statCard("FELLER CONDITION", r.fellerConditionSatisfied ? "SATISFIED" : "VIOLATED")}
            </div>
            <div className="font-terminal text-[9px] text-foreground">{r.fitQuality}</div>
            {!r.fellerConditionSatisfied && (
              <div className="font-terminal text-[7.5px] text-muted-foreground/70">Feller violated (2κθ ≤ σ²) means the calibrated variance process can theoretically hit zero -- common on noisy real quotes; the calibration is still the best available fit, just a signal the surface may not be well-identified by these particular quotes.</div>
            )}
          </>
        );
      })()}

      {result != null && method === "heston-price" && (() => {
        const r = result as { price: number; impliedVolPct: number | null };
        return (
          <div className="grid grid-cols-3 gap-1.5">
            {statCard("HESTON PRICE", fmt(r.price, 4))}
            {statCard("HESTON-IMPLIED VOL", r.impliedVolPct != null ? `${fmt(r.impliedVolPct, 2)}%` : "—")}
            {bsmComparison != null && statCard("BLACK-SCHOLES @ SAME VOL", fmt(bsmComparison, 4))}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Forecasting upgrade (LIMURIA_ENGINES port plan Phase 4, see python-service/forecasting.py) ───
// The existing ForecastTab above already has real hand-rolled ARIMA/Holt-
// Winters -- this tab is a genuine upgrade, not filling an empty gap:
// SARIMAX adds seasonal terms + exogenous regressors (the TS ARIMA has
// neither), STL replaces classical decomposition with a loess-based method
// robust to outliers, changepoint detection offers two GENUINELY real
// methods (the LIMURIA_ENGINES source's "cusum" was a mislabeled z-score
// outlier flag, not real CUSUM), and GARCH via `arch` is offered as an
// explicit side-by-side benchmark against the existing TS fitGARCH11, not a
// replacement. Real data: FRED economic indicators (genuinely seasonal --
// retail sales, payrolls, housing starts) for SARIMAX/STL/changepoint, or a
// real ticker's price/return history for GARCH's volatility comparison.
type ForecastUpgradeMethod = "sarimax" | "stl" | "changepoint" | "garch";
const FORECAST_UPGRADE_METHODS: { key: ForecastUpgradeMethod; label: string }[] = [
  { key: "sarimax", label: "SARIMAX (SEASONAL + EXOGENOUS)" },
  { key: "stl", label: "STL TREND/SEASONAL DECOMPOSITION" },
  { key: "changepoint", label: "CHANGEPOINT DETECTION" },
  { key: "garch", label: "GARCH (ARCH PKG) VS. TS GARCH" },
];
type UpgradeDataSource = "fred" | "ticker";

function ForecastingUpgradeTab() {
  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";
  const [method, setMethod] = useTerminalArtifactState<ForecastUpgradeMethod>("ForecastingUpgradeTab.method", "sarimax");
  const [source, setSource] = useTerminalArtifactState<UpgradeDataSource>("ForecastingUpgradeTab.source", "fred");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: catalog } = useIndicators();
  const [fredSeriesId, setFredSeriesId] = useTerminalArtifactState("ForecastingUpgradeTab.fredSeriesId", "RSAFS");
  const { data: fredDetail, isLoading: fredLoading } = useIndicatorDetail(fredSeriesId);

  const [tickerInput, setTickerInput] = useTerminalArtifactState("ForecastingUpgradeTab.tickerInput", "AAPL");
  const [tickerSymbol, setTickerSymbol] = useTerminalArtifactState("ForecastingUpgradeTab.tickerSymbol", "AAPL");
  const [result, setResult, postOriginal] = useOriginalQuantResult<unknown>(`qwb.forecast.${source}.${source === "fred" ? fredSeriesId : tickerSymbol}.${method}`);
  const [tickerResult] = useSymbolOHLCV(source === "ticker" ? [tickerSymbol] : [], "2Y");

  const levelSeries = useMemo((): { dates: string[]; values: number[] } | null => {
    if (source === "fred") {
      if (!fredDetail) return null;
      return { dates: fredDetail.history.map((h) => h.date), values: fredDetail.history.map((h) => h.value) };
    }
    const bars = tickerResult?.data?.bars;
    if (!bars || bars.length === 0) return null;
    return { dates: bars.map((b) => b.date), values: bars.map((b) => b.close) };
  }, [source, fredDetail, tickerResult]);

  const returnsPct = useMemo(() => (levelSeries ? computeDailyReturns(levelSeries.values) : null), [levelSeries]);
  const seriesReady = !!levelSeries && levelSeries.values.length >= 20;

  // SARIMAX params
  const [ordP, setOrdP] = useTerminalArtifactState("ForecastingUpgradeTab.ordP", "1");
  const [ordD, setOrdD] = useTerminalArtifactState("ForecastingUpgradeTab.ordD", "1");
  const [ordQ, setOrdQ] = useTerminalArtifactState("ForecastingUpgradeTab.ordQ", "1");
  const [useSeasonal, setUseSeasonal] = useTerminalArtifactState("ForecastingUpgradeTab.useSeasonal", true);
  const [seasP, setSeasP] = useTerminalArtifactState("ForecastingUpgradeTab.seasP", "1");
  const [seasD, setSeasD] = useTerminalArtifactState("ForecastingUpgradeTab.seasD", "1");
  const [seasQ, setSeasQ] = useTerminalArtifactState("ForecastingUpgradeTab.seasQ", "0");
  const [seasS, setSeasS] = useTerminalArtifactState("ForecastingUpgradeTab.seasS", "12");
  const [horizon, setHorizon] = useTerminalArtifactState("ForecastingUpgradeTab.horizon", "12");

  // STL params
  const [stlPeriod, setStlPeriod] = useTerminalArtifactState("ForecastingUpgradeTab.stlPeriod", "12");
  const [stlRobust, setStlRobust] = useTerminalArtifactState("ForecastingUpgradeTab.stlRobust", true);

  // Changepoint params
  const [cpMethod, setCpMethod] = useTerminalArtifactState<"cusum" | "pelt">("ForecastingUpgradeTab.cpMethod", "pelt");
  const [cpConfidence, setCpConfidence] = useTerminalArtifactState("ForecastingUpgradeTab.cpConfidence", "0.95");

  // GARCH params
  const [garchP, setGarchP] = useTerminalArtifactState("ForecastingUpgradeTab.garchP", "1");
  const [garchQ, setGarchQ] = useTerminalArtifactState("ForecastingUpgradeTab.garchQ", "1");
  const [garchVol, setGarchVol] = useTerminalArtifactState<"GARCH" | "EGARCH">("ForecastingUpgradeTab.garchVol", "GARCH");
  const [garchDist, setGarchDist] = useTerminalArtifactState<"normal" | "t" | "skewt">("ForecastingUpgradeTab.garchDist", "normal");
  const tsGarchFit = useMemo(() => {
    const originalReturns = originalRunParameters(result)?.returnsPct as number[] | undefined;
    const values = originalReturns ?? returnsPct;
    if (method !== "garch" || !values || values.length < 50) return null;
    try { return fitGARCH11(values); } catch { return null; }
  }, [method, result, returnsPct]);

  async function run() {
    if (!levelSeries) { setError("Load real data first."); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      let path = "", body: unknown;
      if (method === "sarimax") {
        path = "/api/quant/forecasting/sarimax";
        body = {
          series: levelSeries.values, order: [Number(ordP), Number(ordD), Number(ordQ)],
          seasonalOrder: useSeasonal ? [Number(seasP), Number(seasD), Number(seasQ), Number(seasS)] : undefined,
          horizon: Number(horizon),
        };
      } else if (method === "stl") {
        if (levelSeries.values.length < 2 * Number(stlPeriod)) { setError(`Need at least ${2 * Number(stlPeriod)} observations for period=${stlPeriod}; loaded ${levelSeries.values.length}.`); setLoading(false); return; }
        path = "/api/quant/forecasting/stl";
        body = { series: levelSeries.values, period: Number(stlPeriod), robust: stlRobust };
      } else if (method === "changepoint") {
        path = "/api/quant/forecasting/changepoint";
        body = { series: levelSeries.values, method: cpMethod, confidenceThreshold: Number(cpConfidence) };
      } else {
        if (!returnsPct || returnsPct.length < 50) { setError(`GARCH needs at least 50 return observations; loaded ${returnsPct?.length ?? 0}. Try a longer ticker history.`); setLoading(false); return; }
        path = "/api/quant/forecasting/garch";
        body = { returnsPct, p: Number(garchP), q: Number(garchQ), vol: garchVol, dist: garchDist };
      }
      await postOriginal(path, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Forecasting engine unavailable right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={method} onChange={(e) => { setMethod(e.target.value as ForecastUpgradeMethod); setResult(null); setError(null); }} className={inputCls}>
          {FORECAST_UPGRADE_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <button onClick={run} disabled={loading || !seriesReady} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50">
          {loading ? "RUNNING..." : "RUN"}
        </button>
      </div>

      <div className="border border-border/60 p-2.5 space-y-1.5">
        <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">REAL DATA SOURCE</div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={source} onChange={(e) => setSource(e.target.value as UpgradeDataSource)} className={inputCls}>
            <option value="fred">FRED ECONOMIC INDICATOR (SEASONAL)</option>
            <option value="ticker">TICKER PRICE / RETURNS (2Y)</option>
          </select>
          {source === "fred" && (
            <select value={fredSeriesId} onChange={(e) => setFredSeriesId(e.target.value)} className={inputCls}>
              {(catalog ?? []).map((q) => <option key={q.seriesId} value={q.seriesId}>{q.seriesId} — {q.name}</option>)}
              {!catalog?.length && <option value={fredSeriesId}>{fredSeriesId}</option>}
            </select>
          )}
          {source === "ticker" && (
            <>
              <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)} placeholder="AAPL" className={`w-24 ${inputCls}`} />
              <button onClick={() => setTickerSymbol(tickerInput.trim().toUpperCase())} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground whitespace-nowrap">
                LOAD
              </button>
            </>
          )}
          {fredLoading && source === "fred" && <span className="font-terminal text-[7px] text-muted-foreground">loading...</span>}
        </div>
        {seriesReady && levelSeries && (
          <div className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">
            Loaded {levelSeries.values.length} real observations ({levelSeries.dates[0]} to {levelSeries.dates[levelSeries.dates.length - 1]}){returnsPct ? `, ${returnsPct.length} return obs.` : ""}
          </div>
        )}
        {!seriesReady && <div className="font-terminal text-[7px] text-muted-foreground/70">Need at least 20 observations.</div>}
      </div>

      {method === "sarimax" && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">p</span><input value={ordP} onChange={(e) => setOrdP(e.target.value)} inputMode="numeric" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">d</span><input value={ordD} onChange={(e) => setOrdD(e.target.value)} inputMode="numeric" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">q</span><input value={ordQ} onChange={(e) => setOrdQ(e.target.value)} inputMode="numeric" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">HORIZON</span><input value={horizon} onChange={(e) => setHorizon(e.target.value)} inputMode="numeric" className={inputCls} /></label>
          </div>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={useSeasonal} onChange={(e) => setUseSeasonal(e.target.checked)} />
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">SEASONAL TERMS (P,D,Q,s) — THE TS ARIMA HAS NO EQUIVALENT</span>
          </label>
          {useSeasonal && (
            <div className="grid grid-cols-4 gap-2">
              <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">P</span><input value={seasP} onChange={(e) => setSeasP(e.target.value)} inputMode="numeric" className={inputCls} /></label>
              <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">D</span><input value={seasD} onChange={(e) => setSeasD(e.target.value)} inputMode="numeric" className={inputCls} /></label>
              <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">Q</span><input value={seasQ} onChange={(e) => setSeasQ(e.target.value)} inputMode="numeric" className={inputCls} /></label>
              <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">s (PERIOD)</span><input value={seasS} onChange={(e) => setSeasS(e.target.value)} inputMode="numeric" className={inputCls} /></label>
            </div>
          )}
        </div>
      )}

      {method === "stl" && (
        <div className="flex items-center gap-3">
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">PERIOD</span><input value={stlPeriod} onChange={(e) => setStlPeriod(e.target.value)} inputMode="numeric" className={`w-20 ${inputCls}`} /></label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={stlRobust} onChange={(e) => setStlRobust(e.target.checked)} />
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">ROBUST (DOWN-WEIGHT OUTLIERS)</span>
          </label>
        </div>
      )}

      {method === "changepoint" && (
        <div className="flex items-center gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">METHOD</span>
            <select value={cpMethod} onChange={(e) => setCpMethod(e.target.value as "cusum" | "pelt")} className={inputCls}>
              <option value="pelt">PELT (MULTIPLE STRUCTURAL BREAKS)</option>
              <option value="cusum">BOOTSTRAP CUSUM (RECURSIVE, SIGNIFICANCE-TESTED)</option>
            </select>
          </label>
          {cpMethod === "cusum" && (
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">CONFIDENCE</span><input value={cpConfidence} onChange={(e) => setCpConfidence(e.target.value)} inputMode="decimal" className={`w-20 ${inputCls}`} /></label>
          )}
        </div>
      )}

      {method === "garch" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">p</span><input value={garchP} onChange={(e) => setGarchP(e.target.value)} inputMode="numeric" className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">q</span><input value={garchQ} onChange={(e) => setGarchQ(e.target.value)} inputMode="numeric" className={inputCls} /></label>
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">VARIANT</span>
            <select value={garchVol} onChange={(e) => setGarchVol(e.target.value as "GARCH" | "EGARCH")} className={inputCls}>
              <option value="GARCH">GARCH</option>
              <option value="EGARCH">EGARCH (LEVERAGE EFFECT)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">DIST.</span>
            <select value={garchDist} onChange={(e) => setGarchDist(e.target.value as "normal" | "t" | "skewt")} className={inputCls}>
              <option value="normal">NORMAL</option>
              <option value="t">STUDENT-T</option>
              <option value="skewt">SKEWED-T</option>
            </select>
          </label>
        </div>
      )}

      {error && <div className="font-terminal text-[9px] text-red-400">{error}</div>}
      <RecordedOriginalRun result={result}/>

      {result != null && method === "sarimax" && (() => {
        const r = result as { forecast: number[]; lowerCI: number[]; upperCI: number[]; fittedValues: number[]; aic: number; bic: number; logLikelihood: number };
        const originalSeries = originalRunParameters(result)?.series as number[] | undefined;
        const histTail = (originalSeries ?? levelSeries?.values ?? []).slice(-40).map((v, i) => ({ idx: i, actual: v, forecast: null as number | null }));
        const fcRows = r.forecast.map((v, i) => ({ idx: histTail.length + i, actual: null as number | null, forecast: v, lower: r.lowerCI[i], upper: r.upperCI[i] }));
        const chartData = [...histTail, ...fcRows];
        return (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {statCard("AIC", fmt(r.aic, 2))}
              {statCard("BIC", fmt(r.bic, 2))}
              {statCard("LOG-LIKELIHOOD", fmt(r.logLikelihood, 2))}
            </div>
            <div className="h-56 border border-border p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid stroke="#222" strokeDasharray="2 2" />
                  <XAxis dataKey="idx" tick={{ fontSize: 8, fill: "#888" }} />
                  <YAxis tick={{ fontSize: 8, fill: "#888" }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #333", fontSize: 9 }} />
                  <Legend wrapperStyle={{ fontSize: 8 }} />
                  <Line type="monotone" dataKey="actual" name="Actual" stroke="#888" strokeWidth={1.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="forecast" name="SARIMAX Forecast" stroke="hsl(38,95%,55%)" strokeWidth={1.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="upper" name="95% CI upper" stroke="hsl(38,95%,55%)" strokeOpacity={0.3} strokeWidth={1} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="lower" name="CI lower" stroke="hsl(38,95%,55%)" strokeOpacity={0.3} strokeWidth={1} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        );
      })()}

      {result != null && method === "stl" && (() => {
        const r = result as { trend: number[]; seasonal: number[]; resid: number[]; trendStrength: number; seasonalStrength: number };
        const chartData = r.trend.map((v, i) => ({ idx: i, trend: v, seasonal: r.seasonal[i], resid: r.resid[i] }));
        return (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              {statCard("TREND STRENGTH", fmt(r.trendStrength, 3))}
              {statCard("SEASONAL STRENGTH", fmt(r.seasonalStrength, 3))}
            </div>
            <div className="h-32 border border-border p-2">
              <div className="font-terminal text-[7px] text-muted-foreground mb-1">TREND</div>
              <ResponsiveContainer width="100%" height="90%">
                <LineChart data={chartData} margin={{ top: 2, right: 12, bottom: 2, left: 0 }}>
                  <XAxis dataKey="idx" tick={{ fontSize: 7, fill: "#888" }} />
                  <YAxis tick={{ fontSize: 7, fill: "#888" }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #333", fontSize: 9 }} />
                  <Line type="monotone" dataKey="trend" stroke="hsl(38,95%,55%)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="h-32 border border-border p-2">
              <div className="font-terminal text-[7px] text-muted-foreground mb-1">SEASONAL</div>
              <ResponsiveContainer width="100%" height="90%">
                <LineChart data={chartData} margin={{ top: 2, right: 12, bottom: 2, left: 0 }}>
                  <XAxis dataKey="idx" tick={{ fontSize: 7, fill: "#888" }} />
                  <YAxis tick={{ fontSize: 7, fill: "#888" }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #333", fontSize: 9 }} />
                  <Line type="monotone" dataKey="seasonal" stroke="hsl(186,80%,55%)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="h-32 border border-border p-2">
              <div className="font-terminal text-[7px] text-muted-foreground mb-1">RESIDUAL</div>
              <ResponsiveContainer width="100%" height="90%">
                <LineChart data={chartData} margin={{ top: 2, right: 12, bottom: 2, left: 0 }}>
                  <XAxis dataKey="idx" tick={{ fontSize: 7, fill: "#888" }} />
                  <YAxis tick={{ fontSize: 7, fill: "#888" }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #333", fontSize: 9 }} />
                  <Line type="monotone" dataKey="resid" stroke="#888" strokeWidth={1} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        );
      })()}

      {result != null && method === "changepoint" && (() => {
        const r = result as { method: string; changepoints: { index: number; confidence: number | null; meanBefore: number; meanAfter: number }[] };
        const dates = originalRunParameters(result) ? [] : levelSeries?.dates ?? [];
        return (
          <>
            <div className="font-terminal text-[8px] text-muted-foreground">{r.changepoints.length} changepoint(s) detected via {r.method.toUpperCase()}.</div>
            {originalRunParameters(result) && <p className="text-xs text-muted-foreground">Recorded input indices; source date labels were not retained. Refreshed observations are not substituted.</p>}
            <div className="border border-border overflow-x-auto scrollbar-thin">
              <table className="w-full font-terminal text-[8px]">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-1.5">DATE</th><th className="text-right p-1.5">INDEX</th>
                  {r.method === "cusum" && <th className="text-right p-1.5">CONFIDENCE</th>}
                  <th className="text-right p-1.5">MEAN BEFORE</th><th className="text-right p-1.5">MEAN AFTER</th>
                </tr></thead>
                <tbody>
                  {r.changepoints.map((c) => (
                    <tr key={c.index} className="border-b border-border/30">
                      <td className="p-1.5">{dates[c.index] ?? "—"}</td>
                      <td className="text-right p-1.5 tabular-nums">{c.index}</td>
                      {r.method === "cusum" && <td className="text-right p-1.5 tabular-nums">{c.confidence != null ? fmt(c.confidence, 3) : "—"}</td>}
                      <td className="text-right p-1.5 tabular-nums">{fmt(c.meanBefore, 3)}</td>
                      <td className="text-right p-1.5 tabular-nums">{fmt(c.meanAfter, 3)}</td>
                    </tr>
                  ))}
                  {r.changepoints.length === 0 && <tr><td colSpan={5} className="p-2 text-center text-muted-foreground">No structural breaks found at this significance level.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        );
      })()}

      {result != null && method === "garch" && (() => {
        const r = result as { vol: string; mu: number; omega: number; alpha: number[]; beta: number[]; gamma: number[] | null; nu: number | null; persistence: number; logLikelihood: number; aic: number; bic: number; conditionalVolatilityPct: number[] };
        return (
          <>
            <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">PYTHON `arch` PACKAGE — {r.vol}</div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {statCard("ω", fmt(r.omega, 5))}
              {statCard("α", r.alpha.map((a) => fmt(a, 4)).join(", "))}
              {statCard("β", r.beta.map((b) => fmt(b, 4)).join(", "))}
              {statCard("PERSISTENCE (α+β)", fmt(r.persistence, 4))}
              {statCard("LOG-LIKELIHOOD", fmt(r.logLikelihood, 2))}
            </div>
            {r.gamma && <div className="font-terminal text-[8px] text-foreground">Leverage term γ = {r.gamma.map((g) => fmt(g, 4)).join(", ")} (negative ⇒ negative shocks raise vol more than positive shocks of equal size, the standard equity leverage effect).</div>}
            {tsGarchFit && (
              <div className="border border-border/60 p-2.5 space-y-1">
                <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">VS. EXISTING HAND-ROLLED TS GARCH(1,1) — MULTI-START NELDER-MEAD MLE</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {statCard("TS ω", fmt(tsGarchFit.omega, 5))}
                  {statCard("TS α", fmt(tsGarchFit.alpha, 4))}
                  {statCard("TS β", fmt(tsGarchFit.beta, 4))}
                  {statCard("TS PERSISTENCE", fmt(tsGarchFit.persistence, 4))}
                </div>
                <div className="font-terminal text-[7px] text-muted-foreground/70">Persistence within {fmt(Math.abs(r.persistence - tsGarchFit.persistence), 4)} of each other {Math.abs(r.persistence - tsGarchFit.persistence) < 0.05 ? "— directionally consistent, as expected for two correctly-fit GARCH(1,1)s on the same series." : "— a meaningful gap; worth checking p/q match and dist. assumptions on both sides."}</div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

// ─── Machine Learning cluster (LIMURIA_ENGINES port plan Phase 7, see python-service/ml_cluster.py) ───
// Real use case per method, using real live OHLCV data already fetched
// elsewhere in this app rather than hand-typed toy feature matrices:
// classification/regression predict next-day direction/return from
// technical features built walk-forward (each day's features use only
// strictly-prior returns, no lookahead); clustering groups real tickers by
// their real historical return-profile summary stats; anomaly detection
// flags outlier trading days in a real ticker's real return series.
type MlMethod = "classification" | "regression" | "clustering" | "anomaly";
const ML_METHODS: { key: MlMethod; label: string }[] = [
  { key: "classification", label: "CLASSIFICATION (NEXT-DAY DIRECTION)" },
  { key: "regression", label: "REGRESSION (NEXT-DAY RETURN)" },
  { key: "clustering", label: "CLUSTERING (RETURN-PROFILE GROUPS)" },
  { key: "anomaly", label: "ANOMALY DETECTION (RETURN OUTLIERS)" },
];

const TECH_FEATURE_NAMES = ["lag1Return", "lag2Return", "lag3Return", "vol5", "mean5", "momentum10"];

// Walk-forward technical features: predicting returns[t] using only
// returns[t-10..t-1] (strictly before t) -- no lookahead into the day being
// predicted. computeDailyReturns(closes)[i] is the return realized going
// from bars[i] to bars[i+1], so it "becomes known" as of bars[i+1].date.
function buildTechnicalFeatures(bars: { date: string; close: number }[]) {
  const returns = computeDailyReturns(bars.map((b) => b.close));
  const features: number[][] = [], targetClass: number[] = [], targetReturn: number[] = [], dates: string[] = [];
  for (let t = 10; t < returns.length; t++) {
    const window5 = returns.slice(t - 5, t);
    const mean5 = window5.reduce((s, v) => s + v, 0) / 5;
    const vol5 = Math.sqrt(window5.reduce((s, v) => s + (v - mean5) ** 2, 0) / 5);
    const momentum10 = returns.slice(t - 10, t).reduce((s, v) => s + v, 0);
    features.push([returns[t - 1], returns[t - 2], returns[t - 3], vol5, mean5, momentum10]);
    targetReturn.push(returns[t]);
    targetClass.push(returns[t] > 0 ? 1 : 0);
    dates.push(bars[t + 1]?.date ?? "");
  }
  return { features, targetClass, targetReturn, dates };
}

function buildAnomalyFeatures(bars: { date: string; close: number }[]) {
  const returns = computeDailyReturns(bars.map((b) => b.close));
  const dates = bars.slice(1).map((b) => b.date);
  const features = returns.map((_, t) => {
    const window = returns.slice(Math.max(0, t - 4), t + 1);
    const mean = window.reduce((s, v) => s + v, 0) / window.length;
    const vol = Math.sqrt(window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length);
    return [returns[t], vol];
  });
  return { features, dates, returns };
}

function buildTickerSummaryFeatures(perTicker: { symbol: string; returns: number[] }[]) {
  const features = perTicker.map(({ returns }) => {
    const n = returns.length;
    const mean = returns.reduce((s, v) => s + v, 0) / n;
    const vol = Math.sqrt(returns.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
    const skew = vol > 0 ? returns.reduce((s, v) => s + ((v - mean) / vol) ** 3, 0) / n : 0;
    let eq = 100;
    const curve = [100];
    for (const r of returns) { eq *= 1 + r / 100; curve.push(eq); }
    return [mean, vol, skew, maxDrawdownPct(curve)];
  });
  return { symbols: perTicker.map((t) => t.symbol), features };
}

function MachineLearningTab() {
  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";
  const [method, setMethod] = useTerminalArtifactState<MlMethod>("MachineLearningTab.method", "classification");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Single-ticker methods (classification / regression / anomaly) ──
  const [tickerInput, setTickerInput] = useTerminalArtifactState("MachineLearningTab.tickerInput", "AAPL");
  const [tickerSymbol, setTickerSymbol] = useTerminalArtifactState("MachineLearningTab.tickerSymbol", "AAPL");
  const [singleTicker] = useSymbolOHLCV(method !== "clustering" ? [tickerSymbol] : [], "2Y");
  const bars = singleTicker?.data?.bars;

  // ── Multi-ticker clustering ──
  const [clusterTickersInput, setClusterTickersInput] = useTerminalArtifactState("MachineLearningTab.clusterTickersInput", "AAPL,MSFT,GOOGL,AMZN,META,NVDA,TSLA,JPM,XOM,KO");
  const [clusterSymbols, setClusterSymbols] = useTerminalArtifactState("MachineLearningTab.clusterSymbols", clusterTickersInput.split(",").map((s) => s.trim().toUpperCase()));
  const [result, setResult, postOriginal] = useOriginalQuantResult<unknown>(`qwb.ml.${method}`);
  const clusterResults = useSymbolOHLCV(method === "clustering" ? clusterSymbols : []);
  const clusterDataReady = method === "clustering" && clusterSymbols.length >= 6 && clusterResults.length === clusterSymbols.length && clusterResults.every(query => (query.data?.bars?.length ?? 0) >= 40);
  const [nClusters, setNClusters] = useTerminalArtifactState("MachineLearningTab.nClusters", "3");

  const [modelType, setModelType] = useTerminalArtifactState<"random_forest" | "gradient_boosting" | "logistic" | "linear">("MachineLearningTab.modelType", "random_forest");
  const [testSizeFraction, setTestSizeFraction] = useTerminalArtifactState("MachineLearningTab.testSizeFraction", "0.25");
  const [contamination, setContamination] = useTerminalArtifactState("MachineLearningTab.contamination", "0.05");

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      let path = "", body: unknown;
      if (method === "classification" || method === "regression") {
        if (!bars || bars.length < 40) { setError("Load enough real ticker history first (need at least ~40 bars)."); setLoading(false); return; }
        const built = buildTechnicalFeatures(bars);
        if (built.features.length < 20) { setError("Not enough usable observations after feature construction."); setLoading(false); return; }
        if (method === "classification") {
          path = "/api/quant/ml/classification";
          body = { features: built.features, labels: built.targetClass, modelType: modelType === "linear" ? "logistic" : modelType, testSizeFraction: Number(testSizeFraction), featureNames: TECH_FEATURE_NAMES };
        } else {
          path = "/api/quant/ml/regression";
          body = { features: built.features, target: built.targetReturn, modelType: modelType === "logistic" ? "linear" : modelType, testSizeFraction: Number(testSizeFraction), featureNames: TECH_FEATURE_NAMES };
        }
      } else if (method === "clustering") {
        if (!clusterDataReady) { setError("Load at least 6 real tickers first."); setLoading(false); return; }
        const perTicker = clusterResults.map((r, i) => ({ symbol: clusterSymbols[i], returns: computeDailyReturns((r.data!.bars ?? []).map((b) => b.close)) }));
        const { features } = buildTickerSummaryFeatures(perTicker);
        path = "/api/quant/ml/clustering";
        body = { features, nClusters: Number(nClusters) };
      } else {
        if (!bars || bars.length < 40) { setError("Load enough real ticker history first (need at least ~40 bars)."); setLoading(false); return; }
        const { features } = buildAnomalyFeatures(bars);
        path = "/api/quant/ml/anomaly-detection";
        body = { features, contamination: Number(contamination) };
      }
      await postOriginal(path, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ML engine unavailable right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={method} onChange={(e) => { setMethod(e.target.value as MlMethod); setResult(null); setError(null); }} className={inputCls}>
          {ML_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <button onClick={run} disabled={loading} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50">
          {loading ? "RUNNING..." : "RUN"}
        </button>
      </div>

      {method !== "clustering" && (
        <div className="border border-border/60 p-2.5 space-y-1.5">
          <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">REAL TICKER — TECHNICAL FEATURES BUILT WALK-FORWARD FROM REAL 2Y DAILY OHLCV</div>
          <div className="flex items-center gap-2">
            <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)} placeholder="AAPL" className={`w-24 ${inputCls}`} />
            <button onClick={() => setTickerSymbol(tickerInput.trim().toUpperCase())} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground whitespace-nowrap">LOAD</button>
            {bars && <span className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">{bars.length} real bars loaded ({bars[0]?.date} to {bars[bars.length - 1]?.date})</span>}
          </div>
        </div>
      )}

      {method === "clustering" && (
        <div className="border border-border/60 p-2.5 space-y-1.5">
          <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">REAL TICKERS — CLUSTERED BY REAL RETURN-PROFILE SUMMARY STATS (MEAN, VOL, SKEW, MAX DRAWDOWN)</div>
          <div className="flex items-center gap-2 flex-wrap">
            <input value={clusterTickersInput} onChange={(e) => setClusterTickersInput(e.target.value)} className={`flex-1 min-w-[300px] ${inputCls}`} />
            <button onClick={() => setClusterSymbols(clusterTickersInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground whitespace-nowrap">LOAD</button>
            <label className="flex items-center gap-1.5"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider"># CLUSTERS</span><input value={nClusters} onChange={(e) => setNClusters(e.target.value)} inputMode="numeric" className={`w-14 ${inputCls}`} /></label>
          </div>
          {clusterDataReady && <span className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">{clusterSymbols.length} real tickers loaded</span>}
        </div>
      )}

      {(method === "classification" || method === "regression") && (
        <div className="flex items-center gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MODEL</span>
            <select value={modelType} onChange={(e) => setModelType(e.target.value as typeof modelType)} className={inputCls}>
              <option value="random_forest">RANDOM FOREST</option>
              <option value="gradient_boosting">GRADIENT BOOSTING</option>
              {method === "classification" ? <option value="logistic">LOGISTIC (BASELINE)</option> : <option value="linear">LINEAR (BASELINE)</option>}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">TEST SIZE FRACTION</span><input value={testSizeFraction} onChange={(e) => setTestSizeFraction(e.target.value)} inputMode="decimal" className={`w-20 ${inputCls}`} /></label>
        </div>
      )}
      {method === "anomaly" && (
        <label className="flex flex-col gap-1 w-40"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">CONTAMINATION (EXPECTED ANOMALY FRACTION)</span><input value={contamination} onChange={(e) => setContamination(e.target.value)} inputMode="decimal" className={inputCls} /></label>
      )}

      {error && <div className="font-terminal text-[9px] text-red-400">{error}</div>}
      <RecordedOriginalRun result={result}/>

      {result != null && method === "classification" && (() => {
        const r = result as { testAccuracy: number; trainAccuracy: number; precisionMacro: number; recallMacro: number; f1Macro: number; confusionMatrix: number[][]; featureImportances: Record<string, number> | null; nTrain: number; nTest: number };
        return (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {statCard("TEST ACCURACY (HELD-OUT)", `${fmt(r.testAccuracy * 100, 1)}%`)}
              {statCard("TRAIN ACCURACY", `${fmt(r.trainAccuracy * 100, 1)}%`)}
              {statCard("F1 (MACRO)", fmt(r.f1Macro, 3))}
              {statCard("N TRAIN / TEST", `${r.nTrain} / ${r.nTest}`)}
            </div>
            {r.trainAccuracy - r.testAccuracy > 0.15 && (
              <div className="font-terminal text-[7.5px] text-muted-foreground/70">Train accuracy is well above held-out test accuracy — a real sign of overfitting, not a bug. The test accuracy above is the number that matters.</div>
            )}
            <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">CONFUSION MATRIX (HELD-OUT TEST SET)</div>
            <div className="border border-border overflow-x-auto scrollbar-thin">
              <table className="w-full font-terminal text-[8px]"><tbody>
                {r.confusionMatrix.map((row, i) => <tr key={i} className="border-b border-border/30">{row.map((v, j) => <td key={j} className="text-right p-1.5 tabular-nums">{v}</td>)}</tr>)}
              </tbody></table>
            </div>
            {r.featureImportances && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {Object.entries(r.featureImportances).map(([k, v]) => statCard(k.toUpperCase(), fmt(v, 3)))}
              </div>
            )}
          </>
        );
      })()}

      {result != null && method === "regression" && (() => {
        const r = result as { testR2: number; trainR2: number; testRmse: number; testMae: number; featureImportances: Record<string, number> | null; nTrain: number; nTest: number };
        return (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {statCard("TEST R² (HELD-OUT)", fmt(r.testR2, 4))}
              {statCard("TRAIN R²", fmt(r.trainR2, 4))}
              {statCard("TEST RMSE", fmt(r.testRmse, 4))}
              {statCard("TEST MAE", fmt(r.testMae, 4))}
            </div>
            {r.testR2 < 0.05 && (
              <div className="font-terminal text-[7.5px] text-muted-foreground/70">Near-zero or negative held-out R² is the honest, expected result for next-day-return prediction on a liquid single stock — daily returns are close to a random walk. That's a real finding about market efficiency, not a broken pipeline.</div>
            )}
            {r.featureImportances && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {Object.entries(r.featureImportances).map(([k, v]) => statCard(k.toUpperCase(), fmt(v, 3)))}
              </div>
            )}
          </>
        );
      })()}

      {result != null && method === "clustering" && (() => {
        const r = result as { clusterLabels: number[]; silhouetteScore: number; clusterCenters: number[][]; clusterSizes: number[] };
        const recorded = originalRunParameters(result);
        const features = recorded ? recorded.features as number[][] : buildTickerSummaryFeatures(clusterResults.map((res, i) => ({ symbol: clusterSymbols[i], returns: computeDailyReturns((res.data?.bars ?? []).map(bar => bar.close)) }))).features;
        const labels = recorded ? features.map((_, index) => `Input row ${index + 1}`) : clusterSymbols;
        return (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              {statCard("SILHOUETTE SCORE", fmt(r.silhouetteScore, 3))}
              {statCard("CLUSTERS", r.clusterSizes.map((s) => s).join(" / "))}
            </div>
            <div className="border border-border overflow-x-auto scrollbar-thin">
              <table className="w-full font-terminal text-[8px]">
                <thead><tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-1.5">{recorded ? "INPUT ROW · TICKER LABEL NOT RETAINED" : "TICKER"}</th><th className="text-right p-1.5">CLUSTER</th>
                  <th className="text-right p-1.5">MEAN RET %</th><th className="text-right p-1.5">VOL %</th>
                  <th className="text-right p-1.5">SKEW</th><th className="text-right p-1.5">MAX DD %</th>
                </tr></thead>
                <tbody>
                  {labels.map((sym, i) => (
                    <tr key={sym} className="border-b border-border/30">
                      <td className="p-1.5">{sym}</td>
                      <td className="text-right p-1.5 tabular-nums">{r.clusterLabels[i]}</td>
                      <td className="text-right p-1.5 tabular-nums">{fmt(features[i][0], 4)}</td>
                      <td className="text-right p-1.5 tabular-nums">{fmt(features[i][1], 4)}</td>
                      <td className="text-right p-1.5 tabular-nums">{fmt(features[i][2], 3)}</td>
                      <td className="text-right p-1.5 tabular-nums">{fmt(features[i][3], 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      })()}

      {result != null && method === "anomaly" && (() => {
        const r = result as { isAnomaly: boolean[]; anomalyScore: number[]; anomalyCount: number };
        const recorded = originalRunParameters(result);
        const originalFeatures = recorded?.features as number[][] | undefined;
        const observations = originalFeatures ? { dates: originalFeatures.map((_, index) => `Input ${index + 1}`), returns: originalFeatures.map(row => row[0]) } : bars ? buildAnomalyFeatures(bars) : { dates: [], returns: [] };
        const chartData = observations.dates.map((date, index) => ({ date, return: observations.returns[index], anomalyReturn: r.isAnomaly[index] ? observations.returns[index] : null }));
        return (
          <>
            {statCard("ANOMALOUS DAYS FLAGGED", `${r.anomalyCount} / ${observations.dates.length}`)}
            <div className="h-56 border border-border p-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid stroke="#222" strokeDasharray="2 2" />
                  <XAxis dataKey="date" tick={{ fontSize: 7, fill: "#888" }} minTickGap={40} />
                  <YAxis tick={{ fontSize: 8, fill: "#888" }} unit="%" />
                  <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #333", fontSize: 9 }} />
                  <Line type="monotone" dataKey="return" name="Daily return %" stroke="#888" strokeWidth={1} dot={false} />
                  <Scatter dataKey="anomalyReturn" name="Flagged anomaly" fill="hsl(38,95%,55%)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        );
      })()}
    </div>
  );
}

function AdvancedForecastingTab() {
  return <div className="space-y-3">
    <div className="font-terminal text-[9px] text-amber-300">ADVANCED FORECASTING — EXPLICIT MANUAL IMPORT</div>
    <div className="font-mono text-[7px] text-muted-foreground">These models require an analyst-reviewed time-series import. They never claim live FRED data; FRED-dependent work must first be captured in the Macro Data Fabric with a configured FRED_API_KEY.</div>
    <AdvancedManualWorkflow spec={{ family: "forecasting", model: "model-tournament", label: "MODEL TOURNAMENT", instructions: "Paste series, horizon, validationWindow (at least 8), and models (naive/drift/ar1). The series must contain validationWindow + 10 finite observations." }} />
    <AdvancedManualWorkflow spec={{ family: "forecasting", model: "probabilistic-ar1", label: "PROBABILISTIC AR(1)", instructions: "Paste series, horizon, nSimulations, confidenceLevels, and an explicit integer seed. The returned receipt and result preserve that seed." }} />
    <AdvancedManualWorkflow spec={{ family: "forecasting", model: "nowcast", label: "LINEAR NOWCAST", instructions: "Paste targetHistory, indicatorHistory (time × indicators), and currentIndicators from an aligned manual import." }} />
    <AdvancedManualWorkflow spec={{ family: "forecasting", model: "regime-conditioned", label: "REGIME-CONDITIONED FORECAST", instructions: "Paste regimeProbabilities and regimeForecasts. Portfolio regime blending is separately owned by the Portfolio workflow." }} />
    <section className="border border-border p-3 font-mono text-[7px] leading-relaxed text-muted-foreground">
      <div className="font-terminal text-[8px] text-amber-300">QUANT LAB ONLY — DATASET-GATED METHODS</div>
      <div>RECONCILE-HIERARCHY stays here because it needs a genuine named hierarchy and base forecasts, not a terminal default. WEAK-INSTRUMENTS, SYNTHETIC-CONTROL, PROPENSITY-MATCH, LOCAL-PROJECTIONS, and BAYESIAN-VAR stay here because valid runs require identification, treatment, donor, or prior datasets respectively. They are intentionally not exposed as turnkey terminal signals.</div>
    </section>
  </div>;
}

export default function QuantWorkbenchPanel({ selectedModel, onModelChange }: { selectedModel?: Tab; onModelChange?: (model: Tab) => void } = {}) {
  const [storedTab, setStoredTab] = useTerminalArtifactState<Tab>("QuantWorkbenchLegacyPanel.tab", "pca");
  const tab = selectedModel ?? storedTab;
  const setTab = (next: Tab) => { setStoredTab(next); onModelChange?.(next); };

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <FlaskConical className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">QUANT WORKBENCH</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">QWB</span>
      </div>
      <div className="flex border-b border-border bg-[#060606] shrink-0 overflow-x-auto scrollbar-thin">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-2 font-terminal text-[8px] tracking-wider whitespace-nowrap border-r border-border/50 ${tab === t.key ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)] border-b-2 border-b-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>{t.label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        {tab === "pca" && <PcaTab />}
        {tab === "hidden" && <HiddenRelationshipsTab />}
        {tab === "pairs" && <PairsTab />}
        {tab === "beta" && <BetaTab />}
        {tab === "rolling" && <RollingTab />}
        {tab === "copula" && <CopulaTab />}
        {tab === "forecast" && <ForecastTab />}
        {tab === "forecastupgrade" && <ForecastingUpgradeTab />}
        {tab === "advancedforecast" && <AdvancedForecastingTab />}
        {tab === "bond" && <BondPricingTab />}
        {tab === "portfolio" && <PortfolioOptimizerTab />}
        {tab === "creditrisk" && <CreditRiskTab />}
        {tab === "oprisk" && <OpRiskLiquidityTab />}
        {tab === "stats" && <StatisticsSuiteTab />}
        {tab === "panelcausal" && <PanelCausalTab />}
        {tab === "tsecon" && <TimeSeriesEconometricsTab />}
        {tab === "optionsvol" && <OptionsVolatilityTab />}
        {tab === "mlcluster" && <MachineLearningTab />}
      </div>
    </div>
  );
}
