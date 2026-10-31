import { useEffect, useMemo, useState } from "react";
import { useTerminalQuantRun } from "./useTerminalQuantRun";
import { useTerminalArtifactContext, useTerminalArtifactState } from "./terminalArtifactState";
import { ReadableValueTable } from "@/components/terminal/ReadableValueTable";

export type AdvancedRatesModel = {
  path: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
};

type Receipt = {
  dataClassification?: string;
  modelId?: string;
  modelVersion?: string;
  validationLevel?: string;
  runId?: string;
  inputSnapshotHash?: string;
  outputSnapshotHash?: string;
  sourceBindings?: Array<{ provider?: string; sourceReference?: string; snapshot?: { id?: string } }>;
  warnings?: string[];
};

type AdvancedResponse = Record<string, unknown> & { receipt?: Receipt };

export const ADVANCED_RATES_DERIVATIVES: Record<string, AdvancedRatesModel> = {
  "fixed-income/bootstrap-par-curve": { path: "fixed-income/bootstrap-par-curve", label: "Bootstrap par curve", description: "Coupon-period-aligned manual par yields.", parameters: { maturitiesYears: [0.5, 1, 1.5, 2], parYieldsPct: [4.8, 4.7, 4.65, 4.6], frequency: 2 } },
  "fixed-income/spread-analytics": { path: "fixed-income/spread-analytics", label: "Spread analytics", description: "Manual bond cash flows, zero curve, and observed price.", parameters: { cashFlows: [{ timeYears: 1, amount: 5 }, { timeYears: 2, amount: 105 }], curve: [{ maturityYears: 1, zeroRatePct: 4.5 }, { maturityYears: 2, zeroRatePct: 4.6 }], marketPrice: 100 } },
  "fixed-income/key-rate-risk": { path: "fixed-income/key-rate-risk", label: "Key-rate risk", description: "Manual cash flows and zero-curve key-rate shocks.", parameters: { cashFlows: [{ timeYears: 1, amount: 5 }, { timeYears: 2, amount: 105 }], curve: [{ maturityYears: 1, zeroRatePct: 4.5 }, { maturityYears: 2, zeroRatePct: 4.6 }, { maturityYears: 5, zeroRatePct: 4.8 }], keyMaturitiesYears: [1, 2, 5], bumpBps: 1 } },
  "fixed-income/immunize-duration": { path: "fixed-income/immunize-duration", label: "Duration immunization", description: "Manual asset prices and durations; target must be feasible.", parameters: { assets: [{ name: "Short", price: 98, durationYears: 2 }, { name: "Long", price: 104, durationYears: 8 }], targetDurationYears: 5 } },
  "fixed-income/callable-oas": { path: "fixed-income/callable-oas", label: "Callable OAS", description: "Manual callable-bond terms and flat curve assumption.", parameters: { faceValue: 100, couponRatePct: 5, maturityYears: 5, frequency: 2, flatRiskFreeRatePct: 4, shortRateVolatilityPct: 1, marketPrice: 101, callSchedule: [{ year: 3, callPricePct: 100 }] } },
  "fixed-income/floating-rate-note": { path: "fixed-income/floating-rate-note", label: "Floating-rate note", description: "Manual reference rate and margins.", parameters: { faceValue: 100, referenceRatePct: 4.5, quotedMarginBps: 75, discountMarginBps: 80, maturityYears: 3, frequency: 4 } },
  "fixed-income/inflation-linked-bond": { path: "fixed-income/inflation-linked-bond", label: "Inflation-linked bond", description: "Manual real terms and index levels.", parameters: { faceValue: 100, realCouponRatePct: 1, realYieldPct: 1.5, maturityYears: 5, frequency: 2, baseIndex: 100, currentIndex: 112, expectedInflationPct: 2.5 } },
  "fixed-income/credit-spread-curve": { path: "fixed-income/credit-spread-curve", label: "Credit spread curve", description: "Manual maturity/spread curve and recovery assumption.", parameters: { maturitiesYears: [1, 3, 5], spreadsBps: [80, 120, 160], recoveryRatePct: 40, queryMaturitiesYears: [1, 2, 3, 5] } },
  "derivatives/black-scholes-greeks": { path: "derivatives/black-scholes-greeks", label: "Black–Scholes Greeks", description: "Manual option quote/term inputs; no quote feed is bound.", parameters: { spot: 100, strike: 100, maturityYears: 0.25, ratePct: 4.5, dividendYieldPct: 0, volatilityPct: 25, optionType: "call" } },
  "derivatives/implied-volatility": { path: "derivatives/implied-volatility", label: "Implied volatility", description: "Manual market option price within no-arbitrage bounds.", parameters: { spot: 100, strike: 100, maturityYears: 0.25, ratePct: 4.5, dividendYieldPct: 0, optionType: "call", marketPrice: 5.5 } },
  "derivatives/surface-arbitrage": { path: "derivatives/surface-arbitrage", label: "Surface arbitrage", description: "Manual call-price surface; at least three quotes required.", parameters: { spot: 100, ratePct: 4.5, dividendYieldPct: 0, quotes: [{ maturityYears: 0.5, strike: 90, callPrice: 14 }, { maturityYears: 0.5, strike: 100, callPrice: 8 }, { maturityYears: 0.5, strike: 110, callPrice: 4 }] } },
  "derivatives/exotic-monte-carlo": { path: "derivatives/exotic-monte-carlo", label: "Exotic Monte Carlo", description: "Manual exotic terms. The visible seed makes runs reproducible.", parameters: { spot: 100, strike: 100, maturityYears: 1, ratePct: 4.5, dividendYieldPct: 0, volatilityPct: 25, optionType: "call", payoffType: "asian_arithmetic", nPaths: 2000, nSteps: 64, seed: 42 } },
  "derivatives/interest-rate-swap": { path: "derivatives/interest-rate-swap", label: "Interest-rate swap", description: "Manual notional, fixed/forward and discount rates.", parameters: { notional: 1000000, fixedRatePct: 4.5, maturityYears: 5, paymentsPerYear: 2, discountRatePct: 4.25, forwardRatePct: 4.6 } },
  "derivatives/black-swaption": { path: "derivatives/black-swaption", label: "Black swaption", description: "Manual forward swap rate, strike, volatility and annuity.", parameters: { notional: 1000000, forwardSwapRatePct: 4.6, strikePct: 4.5, volatilityPct: 20, optionExpiryYears: 1, swapAnnuity: 4.3, payer: true } },
  "derivatives/local-volatility": { path: "derivatives/local-volatility", label: "Dupire local volatility", description: "Manual 3×3 implied-volatility surface.", parameters: { spot: 100, ratePct: 4.5, dividendYieldPct: 0, maturitiesYears: [0.25, 0.5, 1], strikes: [90, 100, 110], impliedVolatilityPct: [[28, 25, 24], [29, 26, 25], [30, 27, 26]] } },
  "derivatives/portfolio-greeks": { path: "derivatives/portfolio-greeks", label: "Portfolio Greeks", description: "Manual positions; each name must be unique.", parameters: { positions: [{ name: "Call-1", quantity: 1, contractMultiplier: 100, spot: 100, strike: 100, maturityYears: 0.25, ratePct: 4.5, dividendYieldPct: 0, volatilityPct: 25, optionType: "call" }] } },
  "derivatives/futures-basis": { path: "derivatives/futures-basis", label: "Futures basis", description: "Manual spot/futures observations and carry assumptions.", parameters: { spotPrice: 100, futuresPrice: 101, daysToMaturity: 90, financingRatePct: 4.5, incomeYieldPct: 1, storageCostPct: 0 } },
  "derivatives/strategy-payoff": { path: "derivatives/strategy-payoff", label: "Strategy payoff", description: "Manual editable legs; quantity signs set long/short.", parameters: { legs: [{ optionType: "call", strike: 100, quantity: 1, premium: 5, contractMultiplier: 100 }], underlyingMin: 50, underlyingMax: 150, gridPoints: 401 } },
};

export function manualAdvancedRequest(parameters: Record<string, unknown>) {
  return { ...parameters, inputProvenance: { dataClassification: "manual", manualInputs: parameters } };
}

export function parseAdvancedManualParameters(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Parameters must be a JSON object.");
  if ("inputProvenance" in parsed) throw new Error("Do not add inputProvenance; this manual form seals the exact parameters automatically.");
  return parsed as Record<string, unknown>;
}
export function validateAdvancedManualParameters(path: string, parameters: Record<string, unknown>): void {
  const model = ADVANCED_RATES_DERIVATIVES[path];
  if (!model) throw new Error("Unknown advanced analytics model.");
  for (const field of Object.keys(model.parameters)) {
    if (!(field in parameters)) throw new Error(`Missing required manual field: ${field}.`);
  }
  const validateValue = (value: unknown, label: string): void => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
    if (Array.isArray(value)) {
      if (!value.length) throw new Error(`${label} must not be empty.`);
      value.forEach((item, index) => validateValue(item, `${label}[${index}]`));
    } else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => validateValue(item, `${label}.${key}`));
  };
  validateValue(parameters, "parameters");
}


export function ReceiptSummary({ receipt }: { receipt?: Receipt }) {
  if (!receipt) return null;
  return <div className="mt-2 border border-border/70 bg-black/30 p-2 font-terminal text-[8px] text-muted-foreground space-y-1">
    <div className="text-foreground">RECEIPT · {(receipt.dataClassification ?? "unknown").toUpperCase()} · {receipt.modelId ?? "model"} v{receipt.modelVersion ?? "unknown"}</div>
    <div>VALIDATION {receipt.validationLevel ?? "unknown"} · RUN {receipt.runId ?? "unknown"}</div>
    <div>INPUT {receipt.inputSnapshotHash ?? "unknown"} · OUTPUT {receipt.outputSnapshotHash ?? "unknown"}</div>
    <div>SOURCES {receipt.sourceBindings?.length ? receipt.sourceBindings.map((source) => `${source.provider ?? "provider"}:${source.sourceReference ?? source.snapshot?.id ?? "binding"}`).join(", ") : "manual parameters (no source binding)"}</div>
    {receipt.warnings?.map((warning) => <div className="text-amber-400" key={warning}>WARNING · {warning}</div>)}
  </div>;
}

export function AdvancedRatesDerivativesRunner({ modelPaths, title = "ADVANCED ANALYTICS" }: { modelPaths: string[]; title?: string }) {
  const models = useMemo(() => modelPaths.map((path) => ADVANCED_RATES_DERIVATIVES[path]).filter((model): model is AdvancedRatesModel => Boolean(model)), [modelPaths]);
  const terminal = useTerminalArtifactContext();
  const [path, setPath] = useTerminalArtifactState(`advancedRates.${title}.path`, models[0]?.path ?? "");
  const selected = models.find((model) => model.path === path) ?? models[0];
  const [text, setText] = useTerminalArtifactState(`advancedRates.${title}.${path}.parameters`, () => selected ? JSON.stringify(selected.parameters, null, 2) : "{}");
  const quant = useTerminalQuantRun();
  const slot = `advancedRates.${title}.${path}`;
  const [localResult, setResult] = useState<AdvancedResponse | null>(null);
  const result = terminal?.target ? quant.stored?.[slot] as AdvancedResponse | undefined : localResult;
  const [error, setError] = useState<string | null>(null);
  const running = quant.running;

  useEffect(() => { if (selected) { if (!terminal) setText(JSON.stringify(selected.parameters, null, 2)); setResult(null); setError(null); } }, [selected?.path]);
  if (!selected) return null;
  const run = async () => {
    setError(null); setResult(null);
    let parameters: Record<string, unknown>;
    try { parameters = parseAdvancedManualParameters(text); validateAdvancedManualParameters(selected.path, parameters); } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid manual parameters."); return; }
    try {
      setResult(await quant.run<AdvancedResponse>(selected.path, manualAdvancedRequest(parameters), slot));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Analysis request failed."); }
  };
  return <section className="border-t border-border pt-4 space-y-2">
    <div className="flex items-center justify-between gap-2"><span className="font-terminal text-[9px] tracking-widest text-muted-foreground">{title}</span><span className="font-terminal text-[7px] text-amber-400">MANUAL INPUTS · NO LIVE SOURCE BINDING</span></div>
    {models.length > 1 && <select aria-label="Advanced analytics model" value={selected.path} disabled={running} onChange={(event) => setPath(event.target.value)} className="w-full bg-[#090909] border border-border px-2 py-1 font-terminal text-[9px] text-foreground">{models.map((model) => <option key={model.path} value={model.path}>{model.label}</option>)}</select>}
    <div className="font-terminal text-[8px] text-muted-foreground">{selected.description} Pre-filled values are illustrative manual terms, never live market data. Replace them with terms/curves/quotes you can support; no FRED/LSE quote is claimed as live without an immutable source snapshot.</div>
    <label className="block font-terminal text-[8px] text-muted-foreground">MANUAL PARAMETERS (EXACT SUBMITTED JSON · REQUIRED FIELDS VALIDATED)<textarea aria-label={`${selected.label} manual parameters`} value={text} disabled={running} onChange={(event) => setText(event.target.value)} spellCheck={false} className="mt-1 h-36 w-full resize-y bg-black border border-border p-2 font-mono text-[9px] text-foreground outline-none focus:border-amber-500/60" /></label>
    <div className="flex items-center justify-between gap-2"><span className="font-terminal text-[8px] text-muted-foreground">SOURCE CLASSIFICATION: MANUAL · CONNECTOR/KEY REQUIRED FOR LIVE QUOTES; IMPORT AN IMMUTABLE SNAPSHOT TO BIND ONE.</span><button type="button" disabled={running} onClick={run} className="shrink-0 border border-amber-500/50 px-2 py-1 font-terminal text-[8px] text-amber-400 disabled:opacity-50">{running ? "RUNNING…" : "RUN ANALYTIC"}</button></div>
    {error && <div role="alert" className="font-terminal text-[8px] text-red-400">{error}</div>}
    {result && <p className="text-xs text-muted-foreground">Recorded native result and receipt · editing inputs does not recalculate this run. Run Analytic explicitly to retain a new result on this same terminal Artifact.</p>}
    {result && <><ReadableValueTable values={Object.fromEntries(Object.entries(result).filter(([key]) => key !== "receipt"))} className="max-h-64 overflow-auto rounded border border-border bg-black/30 p-2" /><ReceiptSummary receipt={result.receipt} /></>}
  </section>;
}
