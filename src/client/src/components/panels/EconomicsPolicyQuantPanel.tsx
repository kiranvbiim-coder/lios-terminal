import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo, type ChangeEvent } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Scatter, CartesianGrid, LineChart, Line, Legend, ComposedChart, BarChart, Bar } from "recharts";
import { Landmark } from "lucide-react";
import { useIndicatorDetail } from "@/lib/useEconomics";
import { AdvancedManualWorkflow } from "./advancedMacroForecastResearch";

// Economics & Policy domain's own real quant engine (LIMURIA_ENGINES port
// plan Phase 5) -- lives here, under the actual `economics_policy` domain's
// own sidebar section, not buried in the cross-domain Quant Workbench.
// (Originally built as a QuantWorkbenchPanel.tsx tab, same placement the
// Supply Chain engine was first built with in Phase 8 -- moved here for
// the identical reason once that was caught and fixed.)
//
// Taylor Rule and Phillips Curve default to real live FRED data (CPIAUCSL,
// UNRATE) already fetched elsewhere in this app -- no synthetic points
// needed for those. Gini/tax micro-simulation/carbon tax need household-
// level microdata, which this app has no live source for (unlike ticker
// OHLCV or options chains) -- real-scale synthetic population generation
// (thousands of households, not a toy 10-row example) is the default, with
// CSV upload as the primary path for real client-provided microdata, same
// precedent as CreditRiskTab's obligor CSV upload. Leontief I-O has no live
// sectoral data source either -- manual/CSV matrix entry, prefilled with a
// real textbook 3-sector worked example (Miller & Blair) rather than a
// trivial 2x2 toy.

function fmt(v: number | null | undefined, digits = 3): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

function parseNumList(input: string): number[] {
  return input.split(",").map((s) => s.trim()).filter((s) => s.length > 0).map(Number).filter((n) => Number.isFinite(n));
}

function statCard(label: string, value: string) {
  return (
    <div key={label} className="border border-border p-2.5">
      <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{label}</div>
      <div className="font-terminal text-sm font-bold text-foreground mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

type EconPolicyMethod = "leontief" | "taylor" | "phillips" | "gini" | "taxmicrosim" | "carbon" | "transmission" | "fiscalmultiplier";
const ECON_POLICY_METHODS: { key: EconPolicyMethod; label: string }[] = [
  { key: "leontief", label: "LEONTIEF INPUT-OUTPUT INVERSE" },
  { key: "taylor", label: "TAYLOR RULE" },
  { key: "phillips", label: "PHILLIPS CURVE" },
  { key: "gini", label: "GINI COEFFICIENT / LORENZ CURVE" },
  { key: "taxmicrosim", label: "INCOME TAX MICRO-SIMULATION" },
  { key: "carbon", label: "CARBON TAX & DIVIDEND" },
  { key: "transmission", label: "MACRO → COMPANY TRANSMISSION" },
  { key: "fiscalmultiplier", label: "FISCAL MULTIPLIER SCENARIO" },
];

// Box-Muller lognormal sampler -- real-scale representative population
// (thousands of households), not a toy handful. Clearly synthetic/
// illustrative since this app has no live household microdata source;
// CSV upload is offered alongside as the path for real client data.
function sampleLognormal(n: number, meanLog: number, sigmaLog: number, seed = 42): number[] {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(rand(), 1e-12), u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out.push(Math.exp(meanLog + sigmaLog * z));
  }
  return out;
}

function parseIncomeCsv(text: string): number[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((line) => Number(line.split(",")[0].trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

function parseIncomeEnergyCsv(text: string): { incomes: number[]; energy: number[] } {
  const incomes: number[] = [], energy: number[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const cols = line.split(",").map((c) => c.trim());
    if (cols.length < 2) continue;
    const inc = Number(cols[0]), en = Number(cols[1]);
    if (!Number.isFinite(inc) || !Number.isFinite(en)) continue;
    incomes.push(inc); energy.push(en);
  }
  return { incomes, energy };
}

export default function EconomicsPolicyQuantPanel() {
  const inputCls = "bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40";
  const [method, setMethod] = useTerminalArtifactState<EconPolicyMethod>("EconomicsPolicyQuantPanel.method", "taylor");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Leontief I-O ──
  const [ioRows, setIoRows] = useTerminalArtifactState<string[]>("EconomicsPolicyQuantPanel.ioRows", ["0.15,0.25,0.05", "0.30,0.10,0.20", "0.10,0.20,0.10"]);
  const [finalDemandInput, setFinalDemandInput] = useTerminalArtifactState("EconomicsPolicyQuantPanel.finalDemandInput", "100,200,150");

  // ── Taylor Rule ──
  const [useLiveInflation, setUseLiveInflation] = useTerminalArtifactState("EconomicsPolicyQuantPanel.useLiveInflation", true);
  const { data: cpiDetail } = useIndicatorDetail("CPIAUCSL");
  const liveInflationPct = useMemo(() => {
    const h = cpiDetail?.history;
    if (!h || h.length < 13) return null;
    const latest = h[h.length - 1], yearAgo = h[h.length - 13];
    return ((latest.value - yearAgo.value) / yearAgo.value) * 100;
  }, [cpiDetail]);
  const [manualInflation, setManualInflation] = useTerminalArtifactState("EconomicsPolicyQuantPanel.manualInflation", "3.0");
  const [inflationTarget, setInflationTarget] = useTerminalArtifactState("EconomicsPolicyQuantPanel.inflationTarget", "2.0");
  const [outputGap, setOutputGap] = useState("0.0");
  const [neutralRate, setNeutralRate] = useTerminalArtifactState("EconomicsPolicyQuantPanel.neutralRate", "2.0");
  const [inflationWeight, setInflationWeight] = useTerminalArtifactState("EconomicsPolicyQuantPanel.inflationWeight", "0.5");
  const [outputGapWeight, setOutputGapWeight] = useState("0.5");

  // ── Phillips Curve ──
  const [usePhillipsLiveData, setUsePhillipsLiveData] = useTerminalArtifactState("EconomicsPolicyQuantPanel.usePhillipsLiveData", true);
  const { data: unrateDetail } = useIndicatorDetail("UNRATE");
  const phillipsLiveSeries = useMemo(() => {
    if (!cpiDetail?.history || !unrateDetail?.history) return null;
    const cpi = cpiDetail.history;
    // YoY inflation needs a trailing 12-month lookback, so this series is
    // shorter than the raw CPI history by 12 points.
    const infl = new Map<string, number>();
    for (let i = 12; i < cpi.length; i++) {
      infl.set(cpi[i].date, ((cpi[i].value - cpi[i - 12].value) / cpi[i - 12].value) * 100);
    }
    const unemployment: number[] = [], inflation: number[] = [];
    for (const u of unrateDetail.history) {
      const inf = infl.get(u.date);
      if (inf !== undefined) { unemployment.push(u.value); inflation.push(inf); }
    }
    return unemployment.length >= 8 ? { unemployment, inflation } : null;
  }, [cpiDetail, unrateDetail]);
  const [manualUnemployment, setManualUnemployment] = useTerminalArtifactState("EconomicsPolicyQuantPanel.manualUnemployment", "3.5,4.0,4.5,5.0,5.5,6.0,6.5,7.0,7.5,8.0");
  const [manualInflationSeries, setManualInflationSeries] = useTerminalArtifactState("EconomicsPolicyQuantPanel.manualInflationSeries", "6.8,6.2,5.5,5.0,4.4,3.8,3.2,2.8,2.1,1.5");

  // ── Shared household population (Gini / tax micro-sim / carbon tax) ──
  const [popSize, setPopSize] = useTerminalArtifactState("EconomicsPolicyQuantPanel.popSize", "5000");
  const [popMeanLog, setPopMeanLog] = useTerminalArtifactState("EconomicsPolicyQuantPanel.popMeanLog", "11.0");
  const [popSigmaLog, setPopSigmaLog] = useTerminalArtifactState("EconomicsPolicyQuantPanel.popSigmaLog", "0.7");
  const [uploadedIncomes, setUploadedIncomes] = useState<number[] | null>(null);
  const [uploadedEnergy, setUploadedEnergy] = useState<number[] | null>(null);
  const generatedIncomes = useMemo(() => sampleLognormal(Number(popSize) || 0, Number(popMeanLog), Number(popSigmaLog)), [popSize, popMeanLog, popSigmaLog]);
  const incomes = uploadedIncomes ?? generatedIncomes;

  function handleIncomeCsvUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (method === "carbon") {
        const parsed = parseIncomeEnergyCsv(String(reader.result ?? ""));
        if (parsed.incomes.length < 20) { setError("Need at least 20 valid rows -- expected columns: income,monthly_energy_spend"); return; }
        setUploadedIncomes(parsed.incomes); setUploadedEnergy(parsed.energy); setError(null); setResult(null);
      } else {
        const parsed = parseIncomeCsv(String(reader.result ?? ""));
        if (parsed.length < 10) { setError("Need at least 10 valid rows -- expected a single income column."); return; }
        setUploadedIncomes(parsed); setError(null); setResult(null);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // ── Income tax micro-sim brackets ──
  const [oldBrackets, setOldBrackets] = useTerminalArtifactState("EconomicsPolicyQuantPanel.oldBrackets", [{ threshold: "0", rate: "10" }, { threshold: "50000", rate: "20" }, { threshold: "100000", rate: "30" }]);
  const [newBrackets, setNewBrackets] = useTerminalArtifactState("EconomicsPolicyQuantPanel.newBrackets", [{ threshold: "0", rate: "5" }, { threshold: "70000", rate: "20" }, { threshold: "150000", rate: "35" }]);

  // ── Carbon tax ──
  const [carbonTaxPerTon, setCarbonTaxPerTon] = useTerminalArtifactState("EconomicsPolicyQuantPanel.carbonTaxPerTon", "50");
  const [emissionFactor, setEmissionFactor] = useTerminalArtifactState("EconomicsPolicyQuantPanel.emissionFactor", "0.002");
  const energySpend = useMemo(() => {
    if (uploadedEnergy) return uploadedEnergy;
    // Synthetic energy spend correlated with income (richer households
    // consume more energy in absolute $ terms) -- matches the real
    // empirical regularity behind carbon-tax-regressivity analysis;
    // verified during Phase 5 ground-truth checks that energy spend
    // independent of income produces meaningless noise instead of a real
    // distributional signal.
    return incomes.map((inc, i) => Math.max(500, 2000 + 0.04 * inc + (sampleLognormal(1, 0, 0.3, 1000 + i)[0] - 1) * 500));
  }, [incomes, uploadedEnergy]);

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      let path = "", body: unknown;
      if (method === "leontief") {
        const matrix = ioRows.map((r) => parseNumList(r));
        const n = matrix.length;
        if (matrix.some((row) => row.length !== n)) { setError(`Matrix must be square: ${n} rows but not all rows have ${n} columns.`); setLoading(false); return; }
        const finalDemand = parseNumList(finalDemandInput);
        if (finalDemand.length !== n) { setError(`Final demand needs ${n} values, got ${finalDemand.length}.`); setLoading(false); return; }
        path = "/api/quant/economics/leontief-io";
        body = { ioMatrix: matrix, finalDemand };
      } else if (method === "taylor") {
        const inflationPct = useLiveInflation && liveInflationPct != null ? liveInflationPct : Number(manualInflation);
        path = "/api/quant/economics/taylor-rule";
        body = {
          inflationPct, inflationTargetPct: Number(inflationTarget), outputGapPct: Number(outputGap),
          neutralRealRatePct: Number(neutralRate), inflationWeight: Number(inflationWeight), outputGapWeight: Number(outputGapWeight),
        };
      } else if (method === "phillips") {
        const series = usePhillipsLiveData && phillipsLiveSeries ? phillipsLiveSeries : { unemployment: parseNumList(manualUnemployment), inflation: parseNumList(manualInflationSeries) };
        if (series.unemployment.length < 8) { setError("Need at least 8 paired observations."); setLoading(false); return; }
        path = "/api/quant/economics/phillips-curve";
        body = { unemploymentPct: series.unemployment, inflationPct: series.inflation };
      } else if (method === "gini") {
        path = "/api/quant/economics/gini";
        body = { income: incomes };
      } else if (method === "taxmicrosim") {
        path = "/api/quant/economics/income-tax-microsim";
        body = {
          incomeDistribution: incomes,
          oldBrackets: oldBrackets.map((b) => ({ threshold: Number(b.threshold), rate: Number(b.rate) / 100 })),
          newBrackets: newBrackets.map((b) => ({ threshold: Number(b.threshold), rate: Number(b.rate) / 100 })),
        };
      } else {
        path = "/api/quant/economics/carbon-tax-dividend";
        body = { householdEnergySpendMonthly: energySpend, householdIncomes: incomes, carbonTaxPerTon: Number(carbonTaxPerTon), emissionFactorTonsPerDollar: Number(emissionFactor) };
      }
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || "Economics & Policy engine unavailable right now.");
      }
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Economics & Policy engine unavailable right now.");
    } finally {
      setLoading(false);
    }
  }

  const needsPopulation = method === "gini" || method === "taxmicrosim" || method === "carbon";

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4">
      <div className="flex items-center gap-2 mb-4">
        <Landmark className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
        <span className="font-terminal text-[11px] tracking-widest text-foreground">ECONOMICS & POLICY ENGINE — LEONTIEF / TAYLOR / PHILLIPS / INEQUALITY / TAX</span>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <select value={method} onChange={(e) => { setMethod(e.target.value as EconPolicyMethod); setResult(null); setError(null); }} className={inputCls}>
            {ECON_POLICY_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <button onClick={run} disabled={loading || method === "transmission" || method === "fiscalmultiplier"} className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground disabled:opacity-50">
            {loading ? "RUNNING..." : "RUN"}
          </button>
        </div>

        {method === "leontief" && (
          <div className="space-y-2">
            <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">TECHNICAL COEFFICIENTS MATRIX (A) — ONE COMMA-SEPARATED ROW EACH, DEFAULT IS A REAL 3-SECTOR TEXTBOOK EXAMPLE</div>
            {ioRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="font-terminal text-[7.5px] text-muted-foreground w-4">{i + 1}</span>
                <input value={row} onChange={(e) => setIoRows((rows) => rows.map((r, j) => j === i ? e.target.value : r))} className={`flex-1 ${inputCls}`} />
                <button onClick={() => setIoRows((rows) => rows.filter((_, j) => j !== i))} className="px-2 py-1 border border-border text-muted-foreground hover:text-red-400 font-terminal text-[8px]">✕</button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <button onClick={() => setIoRows((rows) => [...rows, rows.map(() => "0").join(",")])} className="px-2 py-1 border border-border text-muted-foreground hover:text-[hsl(38,95%,55%)] font-terminal text-[8px]">+ ADD SECTOR</button>
            </div>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">FINAL DEMAND (ONE PER SECTOR)</span><input value={finalDemandInput} onChange={(e) => setFinalDemandInput(e.target.value)} className={inputCls} /></label>
          </div>
        )}

        {method === "taylor" && (
          <div className="space-y-2">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={useLiveInflation} onChange={(e) => setUseLiveInflation(e.target.checked)} />
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">USE LIVE INFLATION (FRED CPIAUCSL, YoY%){liveInflationPct != null ? ` — CURRENT: ${fmt(liveInflationPct, 2)}%` : " — loading..."}</span>
            </label>
            {!useLiveInflation && (
              <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">INFLATION %</span><input value={manualInflation} onChange={(e) => setManualInflation(e.target.value)} inputMode="decimal" className={`w-24 ${inputCls}`} /></label>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">INFLATION TARGET %</span><input value={inflationTarget} onChange={(e) => setInflationTarget(e.target.value)} inputMode="decimal" className={inputCls} /></label>
              <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">OUTPUT GAP %</span><input value={outputGap} onChange={(e) => setOutputGap(e.target.value)} inputMode="decimal" className={inputCls} /></label>
              <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">NEUTRAL REAL RATE (r*) %</span><input value={neutralRate} onChange={(e) => setNeutralRate(e.target.value)} inputMode="decimal" className={inputCls} /></label>
              <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">INFLATION WEIGHT</span><input value={inflationWeight} onChange={(e) => setInflationWeight(e.target.value)} inputMode="decimal" className={inputCls} /></label>
              <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">OUTPUT GAP WEIGHT</span><input value={outputGapWeight} onChange={(e) => setOutputGapWeight(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            </div>
          </div>
        )}

        {method === "phillips" && (
          <div className="space-y-2">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={usePhillipsLiveData} onChange={(e) => setUsePhillipsLiveData(e.target.checked)} />
              <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">
                USE LIVE FRED DATA (UNRATE vs. CPIAUCSL YoY%){phillipsLiveSeries ? ` — ${phillipsLiveSeries.unemployment.length} real monthly obs.` : " — loading..."}
              </span>
            </label>
            {(!usePhillipsLiveData || !phillipsLiveSeries) && (
              <div className="space-y-2">
                <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">UNEMPLOYMENT % (COMMA-SEPARATED)</span><input value={manualUnemployment} onChange={(e) => setManualUnemployment(e.target.value)} className={inputCls} /></label>
                <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">INFLATION % (SAME ORDER)</span><input value={manualInflationSeries} onChange={(e) => setManualInflationSeries(e.target.value)} className={inputCls} /></label>
              </div>
            )}
          </div>
        )}

        {needsPopulation && (
          <div className="border border-border/60 p-2.5 space-y-1.5">
            <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">HOUSEHOLD POPULATION — NO LIVE MICRODATA SOURCE EXISTS, SO THIS IS A LABELED SYNTHETIC REPRESENTATIVE POPULATION BY DEFAULT; UPLOAD REAL CLIENT DATA TO OVERRIDE</div>
            {!uploadedIncomes && (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-1.5"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">SIZE</span><input value={popSize} onChange={(e) => setPopSize(e.target.value)} inputMode="numeric" className={`w-20 ${inputCls}`} /></label>
                <label className="flex items-center gap-1.5"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">MEAN(LOG INCOME)</span><input value={popMeanLog} onChange={(e) => setPopMeanLog(e.target.value)} inputMode="decimal" className={`w-20 ${inputCls}`} /></label>
                <label className="flex items-center gap-1.5"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">σ(LOG INCOME)</span><input value={popSigmaLog} onChange={(e) => setPopSigmaLog(e.target.value)} inputMode="decimal" className={`w-20 ${inputCls}`} /></label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="px-3 py-1.5 border border-border hover:border-[hsl(38,95%,50%)]/60 hover:text-[hsl(38,95%,55%)] font-terminal text-[8px] text-muted-foreground cursor-pointer whitespace-nowrap">
                UPLOAD REAL CSV ({method === "carbon" ? "income,energy_spend" : "income"})
                <input type="file" accept=".csv,text/csv" onChange={handleIncomeCsvUpload} className="hidden" />
              </label>
              {uploadedIncomes && (
                <button onClick={() => { setUploadedIncomes(null); setUploadedEnergy(null); }} className="px-3 py-1.5 border border-border text-muted-foreground hover:text-red-400 font-terminal text-[8px]">CLEAR UPLOAD</button>
              )}
              <span className="font-terminal text-[7px] text-[hsl(38,95%,55%)]">{incomes.length.toLocaleString()} households {uploadedIncomes ? "(real, uploaded)" : "(synthetic)"}</span>
            </div>
          </div>
        )}

        {method === "taxmicrosim" && (
          <div className="grid grid-cols-2 gap-3">
            {[{ label: "BASELINE BRACKETS", brackets: oldBrackets, set: setOldBrackets }, { label: "REFORM BRACKETS", brackets: newBrackets, set: setNewBrackets }].map(({ label, brackets, set }) => (
              <div key={label} className="space-y-1.5">
                <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">{label}</div>
                {brackets.map((b, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input value={b.threshold} onChange={(e) => set((bs) => bs.map((x, j) => j === i ? { ...x, threshold: e.target.value } : x))} placeholder="threshold" inputMode="numeric" className={`flex-1 ${inputCls}`} />
                    <input value={b.rate} onChange={(e) => set((bs) => bs.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))} placeholder="rate %" inputMode="decimal" className={`w-16 ${inputCls}`} />
                    <button onClick={() => set((bs) => bs.filter((_, j) => j !== i))} className="px-1.5 py-1 border border-border text-muted-foreground hover:text-red-400 font-terminal text-[8px]">✕</button>
                  </div>
                ))}
                <button onClick={() => set((bs) => [...bs, { threshold: "0", rate: "0" }])} className="px-2 py-1 border border-border text-muted-foreground hover:text-[hsl(38,95%,55%)] font-terminal text-[8px]">+ ADD BRACKET</button>
              </div>
            ))}
          </div>
        )}

        {method === "carbon" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">CARBON TAX $/TON</span><input value={carbonTaxPerTon} onChange={(e) => setCarbonTaxPerTon(e.target.value)} inputMode="decimal" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">EMISSION FACTOR (TONS/$)</span><input value={emissionFactor} onChange={(e) => setEmissionFactor(e.target.value)} inputMode="decimal" className={inputCls} /></label>
          </div>
        )}

        {method === "transmission" && <AdvancedManualWorkflow spec={{ family: "macro", model: "company-transmission", label: "MACRO → COMPANY TRANSMISSION", instructions: "Paste macroFactorNames, aligned macroChanges and companyMetricChange (at least 30 observations), and scenarioMacroChanges. Manual import only: no company-specific live feed is implied." }} />}
        {method === "fiscalmultiplier" && <AdvancedManualWorkflow spec={{ family: "macro", model: "fiscal-multiplier", label: "FISCAL MULTIPLIER SCENARIO", instructions: "Paste baselineGdp (>0), fiscalImpulse, multiplier, and optional importLeakagePct, crowdingOutPct, taxFeedbackPct (each 0-100). Manual scenario import only." }} />}
        {error && <div className="font-terminal text-[9px] text-red-400">{error}</div>}

        {result != null && method === "leontief" && (() => {
          const r = result as { leontiefInverse: number[][]; totalOutput: number[]; hawkinsSimonSatisfied: boolean };
          return (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {statCard("HAWKINS-SIMON CONDITION", r.hawkinsSimonSatisfied ? "SATISFIED (VIABLE)" : "VIOLATED (INFEASIBLE)")}
                {statCard("SECTORS", String(r.totalOutput.length))}
              </div>
              <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">TOTAL OUTPUT BY SECTOR</div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {r.totalOutput.map((v, i) => statCard(`SECTOR ${i + 1}`, fmt(v, 2)))}
              </div>
              <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">LEONTIEF INVERSE (I-A)⁻¹</div>
              <div className="border border-border overflow-x-auto scrollbar-thin">
                <table className="w-full font-terminal text-[8px]">
                  <tbody>
                    {r.leontiefInverse.map((row, i) => (
                      <tr key={i} className="border-b border-border/30">
                        {row.map((v, j) => <td key={j} className="text-right p-1.5 tabular-nums">{fmt(v, 4)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}

        {result != null && method === "taylor" && (() => {
          const r = result as { targetRatePct: number; neutralNominalRatePct: number; inflationGapContributionPct: number; outputGapContributionPct: number };
          return (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {statCard("TARGET POLICY RATE", `${fmt(r.targetRatePct, 2)}%`)}
              {statCard("NEUTRAL NOMINAL RATE", `${fmt(r.neutralNominalRatePct, 2)}%`)}
              {statCard("INFLATION GAP TERM", `${fmt(r.inflationGapContributionPct, 2)}pp`)}
              {statCard("OUTPUT GAP TERM", `${fmt(r.outputGapContributionPct, 2)}pp`)}
            </div>
          );
        })()}

        {result != null && method === "phillips" && (() => {
          const r = result as { intercept: number; slope: number; rSquared: number; slopeStdError: number; slopeTStat: number; slopePValue: number; nObs: number };
          const series = usePhillipsLiveData && phillipsLiveSeries ? phillipsLiveSeries : { unemployment: parseNumList(manualUnemployment), inflation: parseNumList(manualInflationSeries) };
          const scatterData = series.unemployment.map((u, i) => ({ unemployment: u, inflation: series.inflation[i] }));
          const xs = [Math.min(...series.unemployment), Math.max(...series.unemployment)];
          const lineData = xs.map((x) => ({ unemployment: x, fitted: r.intercept + r.slope * x }));
          return (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                {statCard("SLOPE", fmt(r.slope, 4))}
                {statCard("INTERCEPT", fmt(r.intercept, 3))}
                {statCard("R²", fmt(r.rSquared, 3))}
                {statCard("SLOPE t-STAT", fmt(r.slopeTStat, 2))}
                {statCard("N OBS", String(r.nObs))}
              </div>
              <div className="h-56 border border-border p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="#222" strokeDasharray="2 2" />
                    <XAxis dataKey="unemployment" type="number" name="Unemployment %" tick={{ fontSize: 8, fill: "#888" }} />
                    <YAxis dataKey="inflation" type="number" name="Inflation %" tick={{ fontSize: 8, fill: "#888" }} />
                    <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #333", fontSize: 9 }} cursor={{ strokeDasharray: "3 3" }} />
                    <Scatter data={scatterData} fill="#888" />
                    <Line data={lineData} dataKey="fitted" stroke="hsl(38,95%,55%)" strokeWidth={1.5} dot={false} activeDot={false} legendType="none" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          );
        })()}

        {result != null && method === "gini" && (() => {
          const r = result as { gini: number; lorenzPopulationPct: number[]; lorenzIncomePct: number[] };
          const chartData = r.lorenzPopulationPct.map((p, i) => ({ pop: p, lorenz: r.lorenzIncomePct[i], equality: p }));
          return (
            <>
              {statCard("GINI COEFFICIENT", fmt(r.gini, 4))}
              <div className="h-56 border border-border p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="#222" strokeDasharray="2 2" />
                    <XAxis dataKey="pop" tick={{ fontSize: 8, fill: "#888" }} unit="%" />
                    <YAxis tick={{ fontSize: 8, fill: "#888" }} unit="%" />
                    <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #333", fontSize: 9 }} />
                    <Legend wrapperStyle={{ fontSize: 8 }} />
                    <Line type="monotone" dataKey="equality" name="Perfect equality" stroke="#555" strokeDasharray="4 2" strokeWidth={1} dot={false} />
                    <Line type="monotone" dataKey="lorenz" name="Lorenz curve" stroke="hsl(38,95%,55%)" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          );
        })()}

        {result != null && method === "taxmicrosim" && (() => {
          const r = result as { totalPopulation: number; baselineTaxRevenue: number; reformTaxRevenue: number; revenueChangePct: number; giniBeforeReform: number; giniAfterReform: number; inequalityReduced: boolean; avgEffectiveRateBaselinePct: number; avgEffectiveRateReformPct: number };
          return (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {statCard("BASELINE REVENUE", fmt(r.baselineTaxRevenue, 0))}
                {statCard("REFORM REVENUE", fmt(r.reformTaxRevenue, 0))}
                {statCard("REVENUE CHANGE", `${r.revenueChangePct >= 0 ? "+" : ""}${fmt(r.revenueChangePct, 2)}%`)}
                {statCard("POPULATION", r.totalPopulation.toLocaleString())}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {statCard("GINI BEFORE", fmt(r.giniBeforeReform, 4))}
                {statCard("GINI AFTER", fmt(r.giniAfterReform, 4))}
                {statCard("AVG EFF. RATE (BASELINE)", `${fmt(r.avgEffectiveRateBaselinePct, 2)}%`)}
                {statCard("AVG EFF. RATE (REFORM)", `${fmt(r.avgEffectiveRateReformPct, 2)}%`)}
              </div>
              <div className="font-terminal text-[9px] text-foreground">{r.inequalityReduced ? "Reform reduces net-income inequality (Gini falls)." : "Reform does not reduce net-income inequality (Gini unchanged or rises)."}</div>
            </>
          );
        })()}

        {result != null && method === "carbon" && (() => {
          const r = result as { totalCo2EmissionsTons: number; totalCarbonRevenue: number; equalDividendPerHousehold: number; grossBurdenByQuartilePct: number[]; netBurdenByQuartilePct: number[]; isRegressiveGross: boolean; isProgressiveWithDividend: boolean };
          const chartData = ["Q1 (lowest)", "Q2", "Q3", "Q4 (highest)"].map((label, i) => ({ label, gross: r.grossBurdenByQuartilePct[i], net: r.netBurdenByQuartilePct[i] }));
          return (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {statCard("TOTAL CO₂ (TONS)", fmt(r.totalCo2EmissionsTons, 0))}
                {statCard("TOTAL REVENUE", fmt(r.totalCarbonRevenue, 0))}
                {statCard("DIVIDEND / HOUSEHOLD", fmt(r.equalDividendPerHousehold, 2))}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {statCard("GROSS TAX", r.isRegressiveGross ? "REGRESSIVE" : "NOT REGRESSIVE")}
                {statCard("NET OF DIVIDEND", r.isProgressiveWithDividend ? "PROGRESSIVE" : "NOT PROGRESSIVE")}
              </div>
              <div className="h-56 border border-border p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="#222" strokeDasharray="2 2" />
                    <XAxis dataKey="label" tick={{ fontSize: 8, fill: "#888" }} />
                    <YAxis tick={{ fontSize: 8, fill: "#888" }} unit="%" />
                    <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #333", fontSize: 9 }} />
                    <Legend wrapperStyle={{ fontSize: 8 }} />
                    <Bar dataKey="gross" name="Gross burden (% income)" fill="#888" />
                    <Bar dataKey="net" name="Net of dividend (% income)" fill="hsl(38,95%,55%)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
