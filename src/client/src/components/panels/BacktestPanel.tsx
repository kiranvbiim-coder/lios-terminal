import { useMemo, useState } from "react";
import { PlayCircle, ShieldCheck, TrendingUp } from "lucide-react";
import type {
  P6BacktestLifecycle,
  P6BacktestResult,
  P6StrategyDefinition,
  P6StrategyKind,
} from "@shared/p6FinanceContracts";
import type { ViewMode } from "@/lib/terminalTypes";
import { P6StrategyStudioPanel } from "./P6StrategyStudioPanel";
import { P6BacktestCockpitPanel } from "./P6BacktestCockpitPanel";

interface Props {
  symbol: string;
  onNav: (view: ViewMode) => void;
}

type Range = "1Y" | "5Y" | "25Y" | "MAX";
type View = "strategy" | "results";

interface RunResponse {
  symbol: string;
  range: Range;
  barsUsed: number;
  result: P6BacktestResult;
}

const STRATEGY_LABELS: Record<P6StrategyKind, string> = {
  buy_and_hold: "Buy & Hold",
  rsi_mean_reversion: "RSI Mean Reversion",
  moving_average_crossover: "Moving Average Crossover",
  breakout: "Breakout",
  dual_momentum: "Dual Momentum",
};

function ruleSource(kind: P6StrategyKind, parameters: Record<string, number>): string {
  if (kind === "rsi_mean_reversion") {
    return "BUY when RSI(" + (parameters.rsiPeriod ?? 14) + ") < " + (parameters.oversold ?? 30)
      + "\nSELL when RSI(" + (parameters.rsiPeriod ?? 14) + ") > " + (parameters.overbought ?? 70);
  }
  if (kind === "moving_average_crossover") {
    return "BUY when MA(" + (parameters.fastPeriod ?? 20) + ") crosses above MA(" + (parameters.slowPeriod ?? 50) + ")"
      + "\nSELL when MA(" + (parameters.fastPeriod ?? 20) + ") crosses below MA(" + (parameters.slowPeriod ?? 50) + ")";
  }
  if (kind === "breakout") return "BUY above prior " + (parameters.lookback ?? 252) + "-bar high\nSELL below prior " + (parameters.lookback ?? 252) + "-bar low";
  if (kind === "dual_momentum") return "BUY when " + (parameters.lookback ?? 252) + "-bar momentum > 0\nSELL when momentum <= 0";
  return "BUY at first eligible next-bar execution and hold";
}

function strategyPreset(kind: P6StrategyKind): P6StrategyDefinition {
  const parameters: Record<string, number> =
    kind === "rsi_mean_reversion" ? { rsiPeriod: 14, oversold: 30, overbought: 70 }
      : kind === "moving_average_crossover" ? { fastPeriod: 20, slowPeriod: 50 }
        : kind === "breakout" ? { lookback: 252 }
          : kind === "dual_momentum" ? { lookback: 252 }
            : {};
  return {
    schemaVersion: "1",
    id: "strategy:" + kind,
    name: STRATEGY_LABELS[kind],
    kind,
    parameters,
    sourceLanguage: "rules",
    source: ruleSource(kind, parameters),
  };
}

function numeric(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function BacktestPanel({ symbol, onNav }: Props) {
  const [range, setRange] = useState<Range>("5Y");
  const [strategy, setStrategy] = useState<P6StrategyDefinition>(() => strategyPreset("rsi_mean_reversion"));
  const [startingCapital, setStartingCapital] = useState(100_000);
  const [feesBps, setFeesBps] = useState(5);
  const [slippageBps, setSlippageBps] = useState(5);
  const [maxParticipationRate, setMaxParticipationRate] = useState(0.05);
  const [view, setView] = useState<View>("strategy");
  const [result, setResult] = useState<P6BacktestResult | null>(null);
  const [barsUsed, setBarsUsed] = useState<number | null>(null);
  const [lastRunKey, setLastRunKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runInput = useMemo(() => ({
    symbol: symbol.toUpperCase(),
    range,
    strategy,
    assumptions: {
      startingCapital,
      feesBps,
      slippageBps,
      riskFreeRateAnnual: 0,
      maxParticipationRate,
      seed: 20260922,
    },
  }), [feesBps, maxParticipationRate, range, slippageBps, startingCapital, strategy, symbol]);
  const currentKey = useMemo(() => JSON.stringify(runInput), [runInput]);

  const lifecycle = useMemo<P6BacktestLifecycle>(() => {
    if (running) return {
      state: "running",
      lastSuccessfulHash: result?.inputHash ?? null,
      currentInputHash: null,
      message: "Historical simulation is running.",
    };
    if (error) return {
      state: "failed",
      lastSuccessfulHash: result?.inputHash ?? null,
      currentInputHash: null,
      message: error,
    };
    if (!result) return {
      state: "edited_not_run",
      lastSuccessfulHash: null,
      currentInputHash: null,
      message: "Edit the strategy and run a historical simulation.",
    };
    if (lastRunKey !== currentKey) return {
      state: "stale",
      lastSuccessfulHash: result.inputHash,
      currentInputHash: null,
      message: "Inputs changed after the last completed run.",
    };
    return {
      state: "completed",
      lastSuccessfulHash: result.inputHash,
      currentInputHash: result.inputHash,
      message: "Result matches the current strategy and assumptions.",
    };
  }, [currentKey, error, lastRunKey, result, running]);

  const updateParameter = (key: string, value: number) => {
    setStrategy((current) => {
      const parameters = { ...current.parameters, [key]: value };
      return {
        ...current,
        parameters,
        source: current.sourceLanguage === "rules" ? ruleSource(current.kind, parameters) : current.source,
      };
    });
  };

  const updateStrategy = (next: P6StrategyDefinition) => {
    setStrategy({
      ...next,
      source: next.sourceLanguage === "rules" ? ruleSource(next.kind, next.parameters) : next.source,
    });
  };

  async function runBacktest() {
    if (strategy.sourceLanguage !== "rules") {
      setError("This strategy uses an optional runtime. Activate its governed adapter before execution.");
      return;
    }
    const runKey = currentKey;
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/finance/p6-backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runInput),
      });
      const payload = await response.json().catch(() => ({})) as Partial<RunResponse> & { error?: unknown };
      if (!response.ok || !payload.result) {
        const message = typeof payload.error === "string" ? payload.error : "Unable to run deterministic backtest.";
        throw new Error(message);
      }
      setResult(payload.result);
      setBarsUsed(typeof payload.barsUsed === "number" ? payload.barsUsed : null);
      setLastRunKey(runKey);
      setView("results");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Unable to run deterministic backtest.");
    } finally {
      setRunning(false);
    }
  }

  const selectedKind = strategy.kind;
  const optionalRuntime = strategy.sourceLanguage !== "rules";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#050505]" data-canonical-engine="lios.backtest.core-v1">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-[#070707] px-4 py-2.5">
        <TrendingUp className="h-4 w-4 text-amber-300" />
        <div>
          <div className="panel-label">P6 STRATEGY & BACKTEST</div>
          <div className="font-terminal text-[7px] text-muted-foreground">SERVER DETERMINISTIC · NEXT-BAR EXECUTION · HISTORICAL ONLY</div>
        </div>
        <span className="font-terminal text-[9px] font-bold text-amber-300">{symbol.toUpperCase()}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setView("strategy")} className={`rounded border px-2.5 py-1 font-terminal text-[8px] ${view === "strategy" ? "border-amber-300/50 text-amber-200" : "border-border text-muted-foreground"}`}>STRATEGY</button>
          <button type="button" onClick={() => setView("results")} disabled={!result} className={`rounded border px-2.5 py-1 font-terminal text-[8px] disabled:opacity-35 ${view === "results" ? "border-amber-300/50 text-amber-200" : "border-border text-muted-foreground"}`}>COCKPIT</button>
          <button type="button" onClick={() => onNav("advancedrisk")} className="rounded border border-border px-2.5 py-1 font-terminal text-[8px] text-muted-foreground hover:text-foreground">OPEN RISK</button>
        </div>
      </header>

      <div className="grid shrink-0 gap-px border-b border-border bg-border sm:grid-cols-2 lg:grid-cols-6">
        <label className="bg-[#080808] p-2 font-terminal text-[7px] text-muted-foreground">STRATEGY
          <select value={selectedKind} onChange={(event) => setStrategy(strategyPreset(event.target.value as P6StrategyKind))} className="mt-1 w-full border border-border bg-[#0b0b0b] p-1.5 text-[9px] text-foreground">
            {(Object.keys(STRATEGY_LABELS) as P6StrategyKind[]).map((kind) => <option key={kind} value={kind}>{STRATEGY_LABELS[kind]}</option>)}
          </select>
        </label>
        <label className="bg-[#080808] p-2 font-terminal text-[7px] text-muted-foreground">RANGE
          <select value={range} onChange={(event) => setRange(event.target.value as Range)} className="mt-1 w-full border border-border bg-[#0b0b0b] p-1.5 text-[9px] text-foreground">
            <option value="1Y">1 YEAR</option><option value="5Y">5 YEARS</option><option value="25Y">25 YEARS</option><option value="MAX">MAX</option>
          </select>
        </label>
        <label className="bg-[#080808] p-2 font-terminal text-[7px] text-muted-foreground">START CAPITAL
          <input type="number" min={1} value={startingCapital} onChange={(event) => setStartingCapital(Math.max(1, numeric(event.target.value, 100000)))} className="mt-1 w-full border border-border bg-[#0b0b0b] p-1.5 text-[9px] text-foreground" />
        </label>
        <label className="bg-[#080808] p-2 font-terminal text-[7px] text-muted-foreground">FEES (BPS)
          <input type="number" min={0} max={10000} value={feesBps} onChange={(event) => setFeesBps(Math.max(0, numeric(event.target.value, 0)))} className="mt-1 w-full border border-border bg-[#0b0b0b] p-1.5 text-[9px] text-foreground" />
        </label>
        <label className="bg-[#080808] p-2 font-terminal text-[7px] text-muted-foreground">SLIPPAGE (BPS)
          <input type="number" min={0} max={10000} value={slippageBps} onChange={(event) => setSlippageBps(Math.max(0, numeric(event.target.value, 0)))} className="mt-1 w-full border border-border bg-[#0b0b0b] p-1.5 text-[9px] text-foreground" />
        </label>
        <label className="bg-[#080808] p-2 font-terminal text-[7px] text-muted-foreground">MAX PARTICIPATION
          <input type="number" min={0.0001} max={1} step={0.01} value={maxParticipationRate} onChange={(event) => setMaxParticipationRate(Math.min(1, Math.max(0.0001, numeric(event.target.value, 0.05))))} className="mt-1 w-full border border-border bg-[#0b0b0b] p-1.5 text-[9px] text-foreground" />
        </label>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-[#070707] px-4 py-2">
        <span className="flex items-center gap-1.5 font-terminal text-[8px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-amber-300" /> Signals on bar t execute on bar t+1. Fees/slippage/liquidity are modeled.</span>
        {barsUsed !== null && <span className="font-terminal text-[8px] text-muted-foreground">{barsUsed.toLocaleString()} bars in last run</span>}
        <span className="font-terminal text-[8px] text-muted-foreground">PIT: {result?.pointInTimeVerified ? "VERIFIED" : "NOT VERIFIED"}</span>
        <button type="button" onClick={() => void runBacktest()} disabled={running || optionalRuntime} className="ml-auto flex items-center gap-1.5 rounded border border-amber-300/35 px-3 py-1.5 font-terminal text-[8px] font-semibold text-amber-200 disabled:cursor-not-allowed disabled:opacity-40">
          <PlayCircle className="h-3.5 w-3.5" /> {running ? "RUNNING…" : "RUN HISTORICAL SIMULATION"}
        </button>
      </div>

      {optionalRuntime && <div className="shrink-0 border-b border-amber-300/20 bg-amber-300/[0.04] px-4 py-2 font-terminal text-[8px] text-amber-100">Optional {strategy.sourceLanguage.toUpperCase()} runtime is not active. Editing is allowed; execution remains blocked until a governed adapter is installed.</div>}
      {error && <div className="shrink-0 border-b border-red-400/20 bg-red-400/[0.04] px-4 py-2 font-terminal text-[8px] text-red-300">{error}</div>}
      {lifecycle.state === "stale" && <div className="shrink-0 border-b border-amber-300/20 px-4 py-2 font-terminal text-[8px] text-amber-200">STALE RESULT · inputs changed since the last run. Rerun before using the output.</div>}

      <main className="min-h-0 flex-1 overflow-hidden">
        {view === "strategy" || !result ? (
          <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_280px]">
            <P6StrategyStudioPanel
              value={strategy}
              onChange={updateStrategy}
              monacoAvailable={false}
              onRunBacktest={optionalRuntime ? undefined : () => void runBacktest()}
            />
            <aside className="overflow-auto border-l border-border bg-[#070707] p-3">
              <div className="mb-3 font-terminal text-[8px] tracking-widest text-muted-foreground">BUILT-IN PARAMETERS</div>
              {selectedKind === "buy_and_hold" && <p className="text-xs text-muted-foreground">No strategy parameters. Entry is executed on the next eligible bar.</p>}
              {selectedKind === "rsi_mean_reversion" && <>
                <Parameter label="RSI period" value={strategy.parameters.rsiPeriod ?? 14} min={2} max={200} onChange={(value) => updateParameter("rsiPeriod", value)} />
                <Parameter label="Oversold" value={strategy.parameters.oversold ?? 30} min={1} max={49} onChange={(value) => updateParameter("oversold", value)} />
                <Parameter label="Overbought" value={strategy.parameters.overbought ?? 70} min={51} max={99} onChange={(value) => updateParameter("overbought", value)} />
              </>}
              {selectedKind === "moving_average_crossover" && <>
                <Parameter label="Fast period" value={strategy.parameters.fastPeriod ?? 20} min={2} max={500} onChange={(value) => updateParameter("fastPeriod", value)} />
                <Parameter label="Slow period" value={strategy.parameters.slowPeriod ?? 50} min={3} max={1000} onChange={(value) => updateParameter("slowPeriod", value)} />
              </>}
              {(selectedKind === "breakout" || selectedKind === "dual_momentum") && <Parameter label="Lookback" value={strategy.parameters.lookback ?? 252} min={2} max={5000} onChange={(value) => updateParameter("lookback", value)} />}
              <div className="mt-4 rounded border border-border p-3 text-[10px] leading-relaxed text-muted-foreground">
                This screen no longer calculates returns in the browser. It sends the governed configuration to the server-side <span className="font-mono text-foreground">lios.backtest.core-v1</span> engine.
              </div>
            </aside>
          </div>
        ) : (
          <P6BacktestCockpitPanel result={result} lifecycle={lifecycle} />
        )}
      </main>
    </div>
  );
}

function Parameter(props: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="mb-3 block text-xs text-muted-foreground">
      {props.label}
      <input
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(event) => props.onChange(Math.min(props.max, Math.max(props.min, numeric(event.target.value, props.value))))}
        className="mt-1 w-full rounded border border-border bg-[#0b0b0b] px-2 py-1.5 font-mono text-xs text-foreground"
      />
    </label>
  );
}
