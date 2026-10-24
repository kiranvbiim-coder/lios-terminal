import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Shuffle, TrendingUp, Sliders } from "lucide-react";
import { useOHLCV, useQuote } from "@/lib/useFinance";
import { getCurrencySymbol, formatPrice } from "@/lib/finance";
import { Skeleton } from "@/components/ui/skeleton";
import { AdvancedRatesDerivativesRunner } from "@/lib/advancedRatesDerivatives";
import ProvenanceBadge from "@/components/data/ProvenanceBadge";
import { runGbmSimulation, stableSimulationSeed } from "@/lib/gbmSimulation";

interface Props { symbol: string; onSymbol: (sym: string) => void; }
type ParameterMode = "historical" | "custom" | "scenario";
type ScenarioPreset = "upside" | "neutral" | "stress";
const SIMULATION_COUNT = 2000;
const VISIBLE_PATHS = 12;

function scenarioParameters(preset: ScenarioPreset, historicalVol: number) {
  if (preset === "upside") return { drift: 0.15, vol: Math.max(0.05, historicalVol * 0.9), label: "UPSIDE ASSUMPTION" };
  if (preset === "stress") return { drift: -0.25, vol: Math.max(0.05, historicalVol * 1.5), label: "STRESS ASSUMPTION" };
  return { drift: 0, vol: Math.max(0.05, historicalVol), label: "NEUTRAL ASSUMPTION" };
}

export default function MonteCarloPanel({ symbol }: Props) {
  const [numDays, setNumDays] = useTerminalArtifactState<30 | 90 | 180>("MonteCarloPanel.numDays", 90);
  const [mode, setMode] = useTerminalArtifactState<ParameterMode>("MonteCarloPanel.mode", "historical");
  const [scenarioPreset, setScenarioPreset] = useTerminalArtifactState<ScenarioPreset>("MonteCarloPanel.scenarioPreset", "neutral");
  const [customDrift, setCustomDrift] = useTerminalArtifactState("MonteCarloPanel.customDrift", 0.08);
  const [customVol, setCustomVol] = useTerminalArtifactState("MonteCarloPanel.customVol", 0.25);
  const [simulationRevision, setSimulationRevision] = useState(0);

  const { data, isLoading, dataUpdatedAt } = useOHLCV(symbol, "1Y", "1d");
  const { data: quoteData } = useQuote(symbol);

  const stats = useMemo(() => {
    const bars = data?.bars ?? [];
    if (bars.length < 20) return null;
    const closes = bars.map((bar) => bar.close).filter((value) => Number.isFinite(value) && value > 0);
    if (closes.length < 20) return null;
    const returns: number[] = [];
    for (let index = 1; index < closes.length; index += 1) returns.push(Math.log(closes[index] / closes[index - 1]));
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
    const annualVol = Math.sqrt(variance) * Math.sqrt(252);
    const annualDrift = mean * 252 + 0.5 * variance * 252;
    const lastClose = closes[closes.length - 1];
    const quotedPrice = quoteData?.price;
    const currentPrice = typeof quotedPrice === "number" && Number.isFinite(quotedPrice) && quotedPrice > 0 ? quotedPrice : lastClose;
    return { annualDrift, annualVol, currentPrice, observations: returns.length, firstDate: bars[0]?.date, lastDate: bars[bars.length - 1]?.date };
  }, [data, quoteData]);

  useEffect(() => {
    if (!stats) return;
    setCustomDrift(stats.annualDrift);
    setCustomVol(stats.annualVol);
    setMode("historical");
    setSimulationRevision(0);
  }, [symbol, stats?.annualDrift, stats?.annualVol]);

  const selectedParameters = useMemo(() => {
    if (!stats) return null;
    if (mode === "historical") return { drift: stats.annualDrift, vol: stats.annualVol, label: "HISTORICAL ESTIMATE" };
    if (mode === "custom") return { drift: customDrift, vol: customVol, label: "CUSTOM INPUT" };
    return scenarioParameters(scenarioPreset, stats.annualVol);
  }, [stats, mode, customDrift, customVol, scenarioPreset]);

  const seed = stableSimulationSeed(symbol, numDays, simulationRevision);
  const results = useMemo(() => {
    if (!stats || !selectedParameters) return null;
    return runGbmSimulation({
      initialPrice: stats.currentPrice,
      annualDrift: selectedParameters.drift,
      annualVolatility: selectedParameters.vol,
      tradingDays: numDays,
      simulations: SIMULATION_COUNT,
      seed,
      visiblePaths: VISIBLE_PATHS,
    });
  }, [stats, selectedParameters, numDays, seed]);

  const chartData = useMemo(() => results?.steps.map((step) => {
    const point: Record<string, number> = { day: step.day, p10: step.p10, p50: step.p50, p90: step.p90 };
    step.paths.forEach((price, index) => { point[`path_${index}`] = price; });
    return point;
  }) ?? [], [results]);

  const currencySymbol = getCurrencySymbol(symbol);
  if (isLoading) return <div className="h-full p-4 space-y-4 bg-[#050505] flex flex-col justify-center animate-pulse"><Skeleton className="h-8 w-1/3 bg-border" /><Skeleton className="h-48 w-full bg-border" /><Skeleton className="h-24 w-full bg-border" /></div>;
  if (!stats || !selectedParameters || !results) return <div className="h-full flex items-center justify-center bg-[#050505] font-terminal text-[9px] text-muted-foreground">INSUFFICIENT OBSERVED OHLCV HISTORY FOR GBM ESTIMATION · MINIMUM 20 VALID CLOSES</div>;

  const returnPct = (price: number) => ((price / stats.currentPrice) - 1) * 100;
  const parameterKind: "computed" | "human" = mode === "historical" ? "computed" : "human";

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-border bg-[#070707] shrink-0" data-workstation-toolbar>
        <div className="flex items-center gap-2"><Shuffle className="w-4 h-4 text-[hsl(38,95%,55%)]" /><span className="font-terminal text-[10px] tracking-widest text-muted-foreground">GBM PROJECTION</span><span className="font-terminal text-[10px] text-foreground font-bold">{symbol}</span></div>
        <ProvenanceBadge compact details={{
          kind: "model",
          source: mode === "historical" ? "/api/finance/ohlcv · 1Y daily closes" : "Analyst/scenario parameter inputs + observed current price",
          method: "Geometric Brownian Motion with seeded pseudo-random standard-normal shocks",
          modelVersion: "GBM-2.0",
          inputs: [`S0=${stats.currentPrice}`, `μ=${selectedParameters.drift}`, `σ=${selectedParameters.vol}`, `horizon=${numDays} trading days`, `N=${SIMULATION_COUNT}`, `seed=${seed}`],
          timestamp: dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined,
          logic: "S(t+dt)=S(t)×exp((μ−0.5σ²)dt+σ√dt·Z). Terminal percentiles are empirical simulation quantiles, not guaranteed confidence bounds.",
          limitations: ["GBM assumes lognormal prices and constant drift/volatility", "No jumps, stochastic volatility, autocorrelation or regime switching", "Historical parameter estimates are backward-looking", "Model probabilities are conditional on assumptions, not calibrated forecasts"],
        }} />
        <div className="flex items-center gap-1 bg-[#0d0d0d] border border-border p-0.5 ml-auto">{([30, 90, 180] as const).map((days) => <button key={days} onClick={() => setNumDays(days)} className={`px-3 py-1 font-terminal text-[9px] tracking-widest ${numDays === days ? "bg-amber-500/10 text-amber-300" : "text-muted-foreground hover:text-foreground"}`}>{days}d</button>)}</div>
        <button onClick={() => setSimulationRevision((value) => value + 1)} className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-terminal text-[9px] tracking-widest"><Shuffle className="w-3 h-3" /> NEW SEED</button>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 min-h-[250px] p-4 flex flex-col overflow-hidden">
          <div className="mb-2 flex items-center justify-between gap-3"><span className="font-terminal text-[9px] tracking-widest text-muted-foreground">SIMULATION PATHS & EMPIRICAL PERCENTILE ENVELOPE</span><span className="font-terminal text-[8px] text-muted-foreground">CURRENT {currencySymbol}{formatPrice(stats.currentPrice)} · N {SIMULATION_COUNT.toLocaleString()} · SEED {seed}</span></div>
          <div className="flex-1 min-h-0 relative">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#111" />
                <XAxis dataKey="day" stroke="#555" tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} />
                <YAxis stroke="#555" domain={["auto", "auto"]} tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} tickFormatter={(value) => `${currencySymbol}${value.toFixed(0)}`} />
                <Tooltip content={({ active, payload }: any) => { if (!active || !payload?.length) return null; const point = payload[0].payload; return <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5"><div className="text-muted-foreground">DAY {point.day}</div><div className="text-emerald-400">P90 {currencySymbol}{formatPrice(point.p90)}</div><div className="text-amber-300">P50 {currencySymbol}{formatPrice(point.p50)}</div><div className="text-red-400">P10 {currencySymbol}{formatPrice(point.p10)}</div></div>; }} />
                {Array.from({ length: VISIBLE_PATHS }, (_, index) => <Line key={index} type="monotone" dataKey={`path_${index}`} stroke="rgba(245,158,11,0.055)" dot={false} strokeWidth={1} />)}
                <Line type="monotone" dataKey="p90" stroke="hsl(142,71%,45%)" strokeDasharray="4 4" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="p50" stroke="hsl(38,95%,55%)" dot={false} strokeWidth={2.3} />
                <Line type="monotone" dataKey="p10" stroke="hsl(0,80%,55%)" strokeDasharray="4 4" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1.5 font-terminal text-[7.5px] text-muted-foreground">
            <div className="border border-border p-2"><span className="block tracking-widest">MODEL</span><b className="text-foreground">GBM</b></div>
            <div className="border border-border p-2"><span className="block tracking-widest">DISTRIBUTION</span><b className="text-foreground">LOGNORMAL PRICE</b></div>
            <div className="border border-border p-2"><span className="block tracking-widest">HIST OBS</span><b className="text-foreground">{stats.observations}</b></div>
            <div className="border border-border p-2"><span className="block tracking-widest">WINDOW</span><b className="text-foreground">{stats.firstDate} → {stats.lastDate}</b></div>
            <div className="border border-border p-2"><span className="block tracking-widest">PARAM MODE</span><b className={mode === "historical" ? "text-cyan-300" : "text-amber-300"}>{selectedParameters.label}</b></div>
          </div>
        </div>

        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-border bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
          <div className="p-4 border-b border-border space-y-4">
            <div className="flex items-center gap-1.5"><Sliders className="w-3.5 h-3.5 text-amber-300" /><span className="font-terminal text-[9px] tracking-widest font-bold text-muted-foreground">MODEL PARAMETERS</span><ProvenanceBadge compact details={{ kind: parameterKind, source: mode === "historical" ? "Observed 1Y OHLCV" : undefined, method: mode === "historical" ? "Annualized log-return drift and sample volatility" : mode === "custom" ? "Analyst-entered custom parameters" : "Named scenario assumption template", inputs: [`μ ${(selectedParameters.drift * 100).toFixed(2)}%`, `σ ${(selectedParameters.vol * 100).toFixed(2)}%`] }} /></div>
            <div className="grid grid-cols-3 border border-border">{(["historical", "custom", "scenario"] as const).map((item) => <button key={item} onClick={() => setMode(item)} className={`py-1.5 font-terminal text-[7.5px] tracking-widest border-r border-border last:border-r-0 ${mode === item ? "bg-amber-500/10 text-amber-300" : "text-muted-foreground hover:text-foreground"}`}>{item.toUpperCase()}</button>)}</div>

            {mode === "scenario" && <div className="grid grid-cols-3 gap-1">{(["upside", "neutral", "stress"] as const).map((preset) => <button key={preset} onClick={() => setScenarioPreset(preset)} className={`border px-1 py-1 font-terminal text-[7px] tracking-wider ${scenarioPreset === preset ? "border-amber-500/40 text-amber-300 bg-amber-500/[0.06]" : "border-border text-muted-foreground"}`}>{preset.toUpperCase()}</button>)}</div>}

            <div className="space-y-1.5"><div className="flex justify-between font-terminal text-[9px]"><span className="text-muted-foreground">DRIFT / μ</span><span className="font-bold">{(selectedParameters.drift * 100).toFixed(1)}%</span></div><input type="range" min="-0.5" max="1" step="0.01" value={selectedParameters.drift} disabled={mode !== "custom"} onChange={(event) => setCustomDrift(Number(event.target.value))} className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-35" /></div>
            <div className="space-y-1.5"><div className="flex justify-between font-terminal text-[9px]"><span className="text-muted-foreground">VOLATILITY / σ</span><span className="font-bold">{(selectedParameters.vol * 100).toFixed(1)}%</span></div><input type="range" min="0.01" max="1.5" step="0.01" value={selectedParameters.vol} disabled={mode !== "custom"} onChange={(event) => setCustomVol(Number(event.target.value))} className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-35" /></div>
            <div className="font-terminal text-[7.5px] leading-relaxed text-muted-foreground">HISTORICAL: μ/σ estimated from observed 1Y daily closes. CUSTOM: analyst inputs. SCENARIO: explicit assumption templates; not forecasts.</div>
          </div>

          <div className="p-4 flex-1 space-y-3">
            <div className="flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-amber-300" /><span className="font-terminal text-[9px] tracking-widest font-bold text-muted-foreground">MODEL OUTPUTS</span></div>
            {[
              { label: "SIMULATED FREQUENCY ABOVE START", value: `${results.probabilityPositivePct.toFixed(1)}%`, sub: `conditional on ${SIMULATION_COUNT.toLocaleString()} model paths`, cls: "text-sky-400" },
              { label: "90TH MODEL PERCENTILE", value: `${currencySymbol}${formatPrice(results.terminalP90)}`, sub: `${returnPct(results.terminalP90) >= 0 ? "+" : ""}${returnPct(results.terminalP90).toFixed(1)}%`, cls: "text-emerald-400" },
              { label: "MEDIAN MODEL TERMINAL PRICE", value: `${currencySymbol}${formatPrice(results.terminalP50)}`, sub: `${returnPct(results.terminalP50) >= 0 ? "+" : ""}${returnPct(results.terminalP50).toFixed(1)}%`, cls: "text-amber-300" },
              { label: "10TH MODEL PERCENTILE", value: `${currencySymbol}${formatPrice(results.terminalP10)}`, sub: `${returnPct(results.terminalP10).toFixed(1)}%`, cls: "text-red-400" },
            ].map((item) => <div key={item.label} className="bg-[#080808] border border-border/60 p-3"><div className="font-terminal text-[7.5px] text-muted-foreground tracking-widest mb-1">{item.label}</div><div className={`font-terminal text-base font-bold ${item.cls}`}>{item.value}</div><div className="font-terminal text-[7.5px] text-muted-foreground">{item.sub}</div></div>)}
            <div className="border border-amber-500/25 bg-amber-500/[0.035] p-2.5 font-terminal text-[7.5px] leading-relaxed text-muted-foreground"><span className="text-amber-300">INTERPRETATION:</span> percentiles describe this model's simulated terminal distribution under the selected assumptions. They are not guaranteed confidence intervals, price targets, or calibrated probabilities of real-world outcomes.</div>
            <AdvancedRatesDerivativesRunner title="EXOTIC OPTION MONTE CARLO · SEEDED MANUAL RUN" modelPaths={["derivatives/exotic-monte-carlo"]} />
          </div>
        </div>
      </div>
    </div>
  );
}
