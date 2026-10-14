import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpenCheck,
  Calculator,
  CheckCircle2,
  CircleDot,
  Gauge,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sigma,
  X,
} from "lucide-react";

import { getCurrencyInfo, inferCurrencyFromSymbol } from "@/lib/finance";
import { useFundamentals, useOHLCV, useQuote } from "@/lib/useFinance";
import { useYieldCurve } from "@/lib/useEconomics";
import { buildOptionsFormulaNotebook } from "@/lib/optionsFormulaNotebook";
import {
  americanGreeks,
  blackScholesMerton,
  breakeven,
  buildOptionCalculationAudit,
  intrinsicValue,
  interpolateYieldCurveRate,
  moneyness,
  optionMoveMetrics,
  probabilityITM,
  probabilityOfTouch,
  realizedVolatilityPct,
  type DiscreteDividend,
  type OptionCalculationAudit,
  type OptionGreeks,
  type VolatilitySource,
} from "@/lib/optionsModels";

export type OptionsModelView = "analytics" | "formulas";

type ExerciseStyle = "european" | "american";
type OptionSide = "call" | "put";
type DividendMode = "continuous" | "cash" | "both";

interface Props {
  symbol: string;
  view: OptionsModelView;
}

const TREE_STEPS = 250;
const SPOT_SHOCKS = [-0.1, -0.05, 0, 0.05, 0.1];
const VOL_SHIFTS = [-0.05, 0, 0.05];

export default function OptionsModelWorkbench({ symbol, view }: Props) {
  const { data: quote, isLoading } = useQuote(symbol);
  const { data: fundamentals } = useFundamentals(symbol);
  const { data: history } = useOHLCV(symbol, "6M", "1d");
  const { data: yieldCurveData } = useYieldCurve();

  const spot = quote?.price;
  const currencyCode = quote?.currency || inferCurrencyFromSymbol(symbol);
  const currencySymbol = getCurrencyInfo(currencyCode).symbol;

  const [strike, setStrike] = useState<number | null>(null);
  const [strikeTouched, setStrikeTouched] = useState(false);
  const [expiryDays, setExpiryDays] = useState(30);
  const [volatilityPct, setVolatilityPct] = useState<number | null>(null);
  const [riskFreeRatePct, setRiskFreeRatePct] = useState<number | null>(null);
  const [dividendYieldPct, setDividendYieldPct] = useState(0);
  const [exerciseStyle, setExerciseStyle] = useState<ExerciseStyle>("european");
  const [side, setSide] = useState<OptionSide>("call");
  const [dividendMode, setDividendMode] = useState<DividendMode>("continuous");
  const [discreteDividends, setDiscreteDividends] = useState<DiscreteDividend[]>([]);
  const [cashDividendAmount, setCashDividendAmount] = useState(0);
  const [cashDividendDays, setCashDividendDays] = useState(15);
  const [volTouched, setVolTouched] = useState(false);
  const [rateTouched, setRateTouched] = useState(false);
  const [qTouched, setQTouched] = useState(false);

  const realizedVolPct = useMemo(() => {
    const closes = history?.bars?.map((bar) => bar.close) ?? [];
    return realizedVolatilityPct(closes.slice(-126));
  }, [history]);

  const interpolatedRate = useMemo(() => {
    if (currencyCode !== "USD") return null;
    return interpolateYieldCurveRate(yieldCurveData?.curve ?? [], expiryDays);
  }, [currencyCode, expiryDays, yieldCurveData]);

  useEffect(() => {
    setStrike(null);
    setStrikeTouched(false);
    setExpiryDays(30);
    setExerciseStyle("european");
    setSide("call");
    setDividendMode("continuous");
    setDiscreteDividends([]);
    setVolTouched(false);
    setRateTouched(false);
    setQTouched(false);
  }, [symbol]);

  useEffect(() => {
    if (strikeTouched) return;
    if (spot != null && Number.isFinite(spot) && spot > 0) setStrike(Number(spot.toFixed(2)));
  }, [spot, strikeTouched]);

  useEffect(() => {
    if (volTouched) return;
    setVolatilityPct(realizedVolPct != null && Number.isFinite(realizedVolPct) ? Number(realizedVolPct.toFixed(2)) : null);
  }, [realizedVolPct, volTouched]);

  useEffect(() => {
    if (rateTouched) return;
    if (currencyCode === "USD" && interpolatedRate?.ratePercent != null) {
      setRiskFreeRatePct(Number(interpolatedRate.ratePercent.toFixed(3)));
      return;
    }
    setRiskFreeRatePct(null);
  }, [currencyCode, interpolatedRate, rateTouched]);

  useEffect(() => {
    if (qTouched) return;
    const fundamentalYield = fundamentals?.dividendYield;
    setDividendYieldPct(fundamentalYield != null && Number.isFinite(fundamentalYield) ? Math.max(0, Number(fundamentalYield.toFixed(3))) : 0);
  }, [fundamentals, qTouched, symbol]);

  const T = expiryDays / 365;
  const activeCashDividends = useMemo(
    () => dividendMode === "continuous" ? [] : discreteDividends.filter((dividend) => dividend.timeYears <= T),
    [dividendMode, discreteDividends, T]
  );
  const activeDividendYield = dividendMode === "cash" ? 0 : dividendYieldPct / 100;

  const volatilitySource: VolatilitySource = volTouched
    ? "custom"
    : realizedVolPct != null
      ? "realized_proxy"
      : "fallback";

  const rateSource = useMemo(() => {
    if (rateTouched) return `Manual ${currencyCode} rate`;
    if (currencyCode === "USD" && interpolatedRate?.ratePercent != null) {
      const labels = interpolatedRate.lowerLabel === interpolatedRate.upperLabel
        ? interpolatedRate.lowerLabel
        : `${interpolatedRate.lowerLabel}-${interpolatedRate.upperLabel}`;
      return `USD Treasury curve · ${labels ?? "maturity"} · ${interpolatedRate.method}`;
    }
    return `Manual ${currencyCode} rate required`;
  }, [currencyCode, interpolatedRate, rateTouched]);

  const ready = Boolean(
    spot != null && Number.isFinite(spot) && spot > 0 &&
    strike != null && Number.isFinite(strike) && strike > 0 &&
    volatilityPct != null && Number.isFinite(volatilityPct) && volatilityPct > 0 &&
    riskFreeRatePct != null && Number.isFinite(riskFreeRatePct)
  );

  const r = (riskFreeRatePct ?? 0) / 100;
  const sigma = (volatilityPct ?? 0) / 100;

  const priceOption = (S: number, K: number, vol: number, isCall: boolean): OptionGreeks => {
    if (exerciseStyle === "american") {
      return americanGreeks(S, K, T, r, activeDividendYield, vol, isCall, TREE_STEPS, activeCashDividends);
    }
    return blackScholesMerton(S, K, T, r, activeDividendYield, vol, isCall, activeCashDividends);
  };

  const audit = useMemo<OptionCalculationAudit | null>(() => {
    if (!ready || spot == null || strike == null || volatilityPct == null || riskFreeRatePct == null) return null;
    return buildOptionCalculationAudit({
      spot,
      strike,
      timeYears: T,
      rate: riskFreeRatePct / 100,
      dividendYield: activeDividendYield,
      volatility: volatilityPct / 100,
      isCall: side === "call",
      exerciseStyle,
      discreteDividends: activeCashDividends,
      treeSteps: TREE_STEPS,
      volatilitySource,
      rateSource,
      rateAsOf: interpolatedRate?.asOf ?? null,
    });
  }, [ready, spot, strike, volatilityPct, riskFreeRatePct, T, activeDividendYield, side, exerciseStyle, activeCashDividends, volatilitySource, rateSource, interpolatedRate]);

  const contractAnalytics = useMemo(() => {
    if (!audit || spot == null || strike == null) return null;
    const call = priceOption(spot, strike, sigma, true);
    const put = priceOption(spot, strike, sigma, false);
    const selected = side === "call" ? call : put;
    return {
      call,
      put,
      selected,
      intrinsic: intrinsicValue(spot, strike, side === "call"),
      moneyness: moneyness(spot, strike, side === "call"),
      breakeven: breakeven(strike, selected.price, side === "call"),
      probabilityItm: probabilityITM(spot, strike, T, r, activeDividendYield, sigma, side === "call", activeCashDividends),
      probabilityTouch: probabilityOfTouch(spot, strike, T, r, activeDividendYield, sigma, activeCashDividends),
      move: optionMoveMetrics(spot, sigma, T, call.price, put.price),
    };
  }, [audit, spot, strike, sigma, side, T, r, activeDividendYield, activeCashDividends, exerciseStyle]);

  const scenarioMatrix = useMemo(() => {
    if (!audit || spot == null || strike == null) return [];
    return SPOT_SHOCKS.map((spotShock) => ({
      spotShock,
      cells: VOL_SHIFTS.map((volShift) => {
        const shockedSpot = spot * (1 + spotShock);
        const shockedVol = Math.max(0.0001, sigma + volShift);
        const value = priceOption(shockedSpot, strike, shockedVol, side === "call").price;
        return { volShift, value };
      }),
    }));
  }, [audit, spot, strike, sigma, side, exerciseStyle, T, r, activeDividendYield, activeCashDividends]);

  const notebook = useMemo(() => audit ? buildOptionsFormulaNotebook(audit) : null, [audit]);

  const addCashDividend = () => {
    if (!(cashDividendAmount > 0) || !(cashDividendDays > 0)) return;
    setDiscreteDividends((previous) => [
      ...previous,
      { amount: cashDividendAmount, timeYears: cashDividendDays / 365, source: "manual cash-dividend assumption" },
    ].sort((a, b) => a.timeYears - b.timeYears));
    setCashDividendAmount(0);
  };

  if (isLoading) {
    return <StatePanel icon={<Activity className="w-5 h-5 animate-pulse" />} title="Loading option model inputs" body={`Resolving ${symbol} spot, history, fundamentals and curve inputs.`} />;
  }

  if (spot == null || !Number.isFinite(spot) || spot <= 0) {
    return <StatePanel icon={<AlertTriangle className="w-5 h-5 text-amber-400" />} title="Spot price unavailable" body={`LIOS will not fabricate a spot price for ${symbol}. Connect/refresh a market-data source before running option analytics.`} />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505] text-foreground">
      <header className="shrink-0 border-b border-border bg-[#070707] px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {view === "formulas" ? <BookOpenCheck className="w-4 h-4 text-amber-400" /> : <Gauge className="w-4 h-4 text-cyan-400" />}
            <span className="font-terminal text-[10px] tracking-[0.16em] font-bold">{view === "formulas" ? "FORMULA NOTEBOOK" : "CONTRACT ANALYTICS"}</span>
            <span className="font-terminal text-[9px] text-muted-foreground">{symbol}</span>
            <span className="font-terminal text-[9px] text-cyan-300">SPOT {currencySymbol}{spot.toFixed(2)}</span>
            <span className="font-terminal text-[8px] text-muted-foreground">{exerciseStyle === "american" ? `CRR ${TREE_STEPS}` : "BSM"} · ACT/365 · CONT. COMPOUNDING</span>
          </div>
          {audit && (
            <div className={`flex items-center gap-1 font-terminal text-[8px] ${audit.checks.withinNoArbitrageBounds ? "text-emerald-400" : "text-red-400"}`}>
              <ShieldCheck className="w-3.5 h-3.5" /> {audit.checks.withinNoArbitrageBounds ? "BOUNDS PASS" : "BOUNDS FAIL"}
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
        <div className="grid grid-cols-1 2xl:grid-cols-[340px_minmax(0,1fr)] gap-4 p-4">
          <aside className="space-y-3">
            <Panel title="SELECTED CONTRACT" icon={<CircleDot className="w-3.5 h-3.5 text-amber-400" />}>
              <div className="grid grid-cols-2 gap-2">
                <InputField label="STRIKE K" value={strike} onChange={(value) => { setStrike(value > 0 ? value : null); setStrikeTouched(true); }} suffix={currencySymbol} />
                <InputField label="EXPIRY" value={expiryDays} onChange={(value) => setExpiryDays(Math.max(1, Math.round(value)))} suffix="days" />
              </div>
              <Segmented values={["call", "put"] as OptionSide[]} active={side} onChange={setSide} />
              <Segmented values={["european", "american"] as ExerciseStyle[]} active={exerciseStyle} onChange={setExerciseStyle} />
            </Panel>

            <Panel title="MODEL INPUTS" icon={<Calculator className="w-3.5 h-3.5 text-cyan-400" />}>
              <NullableInputField
                label="VOLATILITY σ"
                value={volatilityPct}
                onChange={(value) => { setVolatilityPct(value); setVolTouched(true); }}
                suffix="%"
                placeholder="required"
              />
              <SourceLine label="VOL SOURCE" value={volTouched ? "custom override" : realizedVolPct != null ? `realized 6M proxy · ${realizedVolPct.toFixed(2)}%` : "unavailable · enter custom IV/vol"} warning={volatilityPct == null} />

              <NullableInputField
                label={`RISK-FREE r · ${currencyCode}`}
                value={riskFreeRatePct}
                onChange={(value) => { setRiskFreeRatePct(value); setRateTouched(true); }}
                suffix="%"
                placeholder="required"
              />
              <SourceLine label="RATE SOURCE" value={rateSource} warning={riskFreeRatePct == null} />
              {currencyCode === "USD" && interpolatedRate?.ratePercent != null && rateTouched && (
                <button onClick={() => { setRateTouched(false); setRiskFreeRatePct(Number(interpolatedRate.ratePercent!.toFixed(3))); }} className="w-full border border-amber-500/30 px-2 py-1 font-terminal text-[8px] text-amber-300 hover:bg-amber-500/10">
                  USE MATURITY-MATCHED CURVE · {interpolatedRate.ratePercent.toFixed(3)}%
                </button>
              )}

              <div className="border-t border-border/60 pt-2 space-y-2">
                <div className="font-terminal text-[8px] text-muted-foreground tracking-wider">DIVIDEND MODEL</div>
                <Segmented values={["continuous", "cash", "both"] as DividendMode[]} active={dividendMode} onChange={setDividendMode} />
              </div>

              {dividendMode !== "cash" && (
                <InputField label="CONTINUOUS q" value={dividendYieldPct} onChange={(value) => { setDividendYieldPct(Math.max(0, value)); setQTouched(true); }} suffix="%" />
              )}
              {dividendMode !== "cash" && <SourceLine label="DIV SOURCE" value={qTouched ? "custom override" : fundamentals?.dividendYield != null ? `fundamentals · ${fundamentals.dividendYield.toFixed(3)}%` : "0% explicit assumption · verify if dividend data is unavailable"} />}

              {dividendMode !== "continuous" && (
                <div className="border border-border/60 bg-[#060606] p-2 space-y-2">
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
                    <InputField compact label="CASH / SHARE" value={cashDividendAmount} onChange={setCashDividendAmount} suffix={currencySymbol} />
                    <InputField compact label="EX-DATE" value={cashDividendDays} onChange={(value) => setCashDividendDays(Math.max(1, value))} suffix="days" />
                    <button onClick={addCashDividend} title="Add cash dividend" className="self-end h-[26px] border border-border/60 px-2 text-amber-400 hover:bg-amber-500/10"><Plus className="w-3 h-3" /></button>
                  </div>
                  {discreteDividends.length === 0 ? (
                    <div className="font-terminal text-[7px] text-muted-foreground">No discrete cash-dividend assumptions.</div>
                  ) : discreteDividends.map((dividend, index) => (
                    <div key={`${dividend.timeYears}-${index}`} className="flex items-center justify-between gap-2 font-terminal text-[8px]">
                      <span>{currencySymbol}{dividend.amount.toFixed(2)} · ex {(dividend.timeYears * 365).toFixed(0)}d</span>
                      <button onClick={() => setDiscreteDividends((previous) => previous.filter((_, i) => i !== index))} className="text-muted-foreground hover:text-red-400"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => { setVolTouched(false); setRateTouched(false); setQTouched(false); }} className="w-full flex items-center justify-center gap-1 border border-border/60 py-1 font-terminal text-[8px] text-muted-foreground hover:text-foreground">
                <RefreshCw className="w-3 h-3" /> RESET CONNECTED INPUTS
              </button>
            </Panel>

            {!ready && (
              <div className="border border-amber-500/30 bg-amber-500/[0.04] p-3 font-terminal text-[8px] text-amber-200">
                <div className="flex items-center gap-1 font-bold"><AlertTriangle className="w-3.5 h-3.5" /> MODEL INPUT REQUIRED</div>
                <div className="mt-1 text-muted-foreground">Enter a volatility and risk-free rate when connected sources cannot resolve them. LIOS will not substitute an opaque market value here.</div>
              </div>
            )}
          </aside>

          <main className="min-w-0">
            {!audit || !contractAnalytics ? (
              <StatePanel compact icon={<Sigma className="w-5 h-5 text-muted-foreground" />} title="Complete the model inputs" body="The analytics and formula notebook activate only after spot, strike, volatility and risk-free rate are explicit." />
            ) : view === "analytics" ? (
              <AnalyticsView
                audit={audit}
                analytics={contractAnalytics}
                scenarioMatrix={scenarioMatrix}
                currencySymbol={currencySymbol}
                spot={spot}
                strike={strike!}
                volatilityPct={volatilityPct!}
                exerciseStyle={exerciseStyle}
                side={side}
              />
            ) : notebook ? (
              <FormulaView notebook={notebook} audit={audit} currencySymbol={currencySymbol} />
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}

function AnalyticsView({
  audit,
  analytics,
  scenarioMatrix,
  currencySymbol,
  spot,
  strike,
  volatilityPct,
  exerciseStyle,
  side,
}: {
  audit: OptionCalculationAudit;
  analytics: {
    call: OptionGreeks;
    put: OptionGreeks;
    selected: OptionGreeks;
    intrinsic: number;
    moneyness: string;
    breakeven: number;
    probabilityItm: number;
    probabilityTouch: number;
    move: ReturnType<typeof optionMoveMetrics>;
  };
  scenarioMatrix: Array<{ spotShock: number; cells: Array<{ volShift: number; value: number }> }>;
  currencySymbol: string;
  spot: number;
  strike: number;
  volatilityPct: number;
  exerciseStyle: ExerciseStyle;
  side: OptionSide;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <MetricCard label="THEORETICAL" value={`${currencySymbol}${audit.output.price.toFixed(4)}`} accent />
        <MetricCard label="DELTA Δ" value={audit.output.delta.toFixed(5)} />
        <MetricCard label="GAMMA Γ" value={audit.output.gamma.toFixed(7)} />
        <MetricCard label="THETA / DAY" value={audit.output.theta.toFixed(5)} />
        <MetricCard label="VEGA / VOL PT" value={audit.output.vega.toFixed(5)} />
        <MetricCard label="RHO / 100BP" value={audit.output.rho.toFixed(5)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="CONTRACT DIAGNOSTICS" icon={<Gauge className="w-3.5 h-3.5 text-cyan-400" />}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 font-terminal text-[9px]">
            <Readout label="SIDE" value={side.toUpperCase()} />
            <Readout label="STYLE" value={exerciseStyle.toUpperCase()} />
            <Readout label="MONEYNESS" value={analytics.moneyness} />
            <Readout label="INTRINSIC" value={`${currencySymbol}${analytics.intrinsic.toFixed(4)}`} />
            <Readout label="EXTRINSIC" value={`${currencySymbol}${Math.max(0, analytics.selected.price - analytics.intrinsic).toFixed(4)}`} />
            <Readout label="BREAKEVEN" value={`${currencySymbol}${analytics.breakeven.toFixed(4)}`} />
            <Readout label="PROB ITM · RN" value={`${(analytics.probabilityItm * 100).toFixed(2)}%`} />
            <Readout label="PROB TOUCH · RN" value={`${(analytics.probabilityTouch * 100).toFixed(2)}%`} />
            <Readout label="ATM STRADDLE MOVE" value={`±${currencySymbol}${analytics.move.straddleMove.toFixed(3)} · ${(analytics.move.straddleMovePct * 100).toFixed(2)}%`} />
            <Readout label="1σ MOVE" value={`±${currencySymbol}${analytics.move.oneSigmaMove.toFixed(3)} · ${(analytics.move.oneSigmaMovePct * 100).toFixed(2)}%`} />
          </div>
          <div className="mt-3 border-t border-border/60 pt-2 font-terminal text-[7px] text-muted-foreground">
            Risk-neutral ITM/touch metrics are model probabilities, not physical forecasts. ATM straddle-implied move and S·σ·√T are intentionally separate concepts.
          </div>
        </Panel>

        <Panel title="MODEL VALIDATION" icon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}>
          <div className="space-y-2 font-terminal text-[9px]">
            <ValidationRow label="NO-ARBITRAGE BOUNDS" value={`${currencySymbol}${audit.checks.lowerBound.toFixed(4)} ≤ V ≤ ${currencySymbol}${audit.checks.upperBound.toFixed(4)}`} passed={audit.checks.withinNoArbitrageBounds} />
            <ValidationRow label="PRICE WITHIN BOUNDS" value={audit.checks.withinNoArbitrageBounds ? "PASS" : "FAIL"} passed={audit.checks.withinNoArbitrageBounds} />
            <ValidationRow label="PUT-CALL PARITY" value={audit.checks.putCallParityResidual == null ? "N/A · American exercise" : audit.checks.putCallParityResidual.toExponential(3)} passed={audit.checks.putCallParityResidual == null ? undefined : Math.abs(audit.checks.putCallParityResidual) < 1e-6} />
            <Readout label="RATE LINEAGE" value={`${audit.inputs.rateSource}${audit.inputs.rateAsOf ? ` · ${audit.inputs.rateAsOf}` : ""}`} />
            <Readout label="VOL SOURCE" value={audit.inputs.volatilitySource} />
            <Readout label="DIVIDEND METHOD" value={audit.adjustments.dividendMethod} />
          </div>
          <div className="mt-3 border-t border-border/60 pt-2 font-terminal text-[7px] text-muted-foreground">
            Use the FORMULAS tab for d₁/d₂, substituted pricing equations, Greek definitions, CRR recursion, dividend adjustments and exact unit conventions.
          </div>
        </Panel>
      </div>

      <Panel title="LOCAL SPOT × VOLATILITY SCENARIO MATRIX" icon={<Activity className="w-3.5 h-3.5 text-amber-400" />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse font-terminal text-[9px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="border border-border/60 px-2 py-1 text-left">SPOT SHOCK</th>
                {VOL_SHIFTS.map((shift) => <th key={shift} className="border border-border/60 px-2 py-1">VOL {shift === 0 ? "BASE" : `${shift > 0 ? "+" : ""}${(shift * 100).toFixed(0)}pt`}</th>)}
              </tr>
            </thead>
            <tbody>
              {scenarioMatrix.map((row) => (
                <tr key={row.spotShock}>
                  <td className="border border-border/60 px-2 py-1 text-muted-foreground">{row.spotShock === 0 ? "BASE" : `${row.spotShock > 0 ? "+" : ""}${(row.spotShock * 100).toFixed(0)}%`} · {currencySymbol}{(spot * (1 + row.spotShock)).toFixed(2)}</td>
                  {row.cells.map((cell) => (
                    <td key={cell.volShift} className={`border border-border/60 px-2 py-1 text-center tabular-nums ${row.spotShock === 0 && cell.volShift === 0 ? "bg-amber-500/10 text-amber-300 font-bold" : "text-foreground"}`}>
                      {currencySymbol}{cell.value.toFixed(4)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-terminal text-[7px] text-muted-foreground">
          <span>Base spot {currencySymbol}{spot.toFixed(2)}</span>
          <span>K {currencySymbol}{strike.toFixed(2)}</span>
          <span>Base vol {volatilityPct.toFixed(2)}%</span>
          <span>All cells reprice through the same {exerciseStyle === "american" ? "CRR" : "BSM"} production engine.</span>
        </div>
      </Panel>
    </div>
  );
}

function FormulaView({ notebook, audit, currencySymbol }: { notebook: ReturnType<typeof buildOptionsFormulaNotebook>; audit: OptionCalculationAudit; currencySymbol: string }) {
  return (
    <div className="space-y-4">
      <div className="border border-amber-500/30 bg-gradient-to-r from-amber-500/[0.06] to-transparent p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-terminal text-[8px] text-amber-400 tracking-[0.18em]">SELECTED CALCULATION</div>
            <div className="mt-1 font-terminal text-sm font-bold">{notebook.model}</div>
            <div className="font-terminal text-[9px] text-muted-foreground">{notebook.instrument} · {notebook.methodology}</div>
          </div>
          <div className="text-right">
            <div className="font-terminal text-[7px] text-muted-foreground">MODEL VALUE</div>
            <div className="font-mono text-xl font-bold text-amber-300">{currencySymbol}{audit.output.price.toFixed(6)}</div>
          </div>
        </div>
      </div>

      {notebook.warnings.length > 0 && (
        <div className="border border-amber-500/25 bg-amber-500/[0.03] p-3 space-y-1">
          {notebook.warnings.map((warning) => (
            <div key={warning} className="flex gap-2 font-terminal text-[8px] text-muted-foreground"><AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />{warning}</div>
          ))}
        </div>
      )}

      {notebook.sections.map((section, sectionIndex) => (
        <div key={section.id} className="border border-border bg-[#070707]">
          <div className="flex items-center gap-2 border-b border-border/70 bg-[#090909] px-3 py-2">
            <span className="flex h-5 w-5 items-center justify-center border border-amber-500/30 font-mono text-[8px] text-amber-300">{sectionIndex + 1}</span>
            <div>
              <div className="font-terminal text-[9px] font-bold tracking-wider">{section.title.toUpperCase()}</div>
              {section.description && <div className="font-terminal text-[7px] text-muted-foreground">{section.description}</div>}
            </div>
          </div>
          <div className="divide-y divide-border/50">
            {section.lines.map((line) => (
              <div key={line.id} className="grid grid-cols-1 xl:grid-cols-[170px_minmax(0,1.05fr)_minmax(0,1.25fr)_170px] gap-2 px-3 py-3 hover:bg-white/[0.01]">
                <div>
                  <div className="font-terminal text-[8px] text-muted-foreground">{line.label.toUpperCase()}</div>
                  {line.note && <div className="mt-1 font-terminal text-[7px] text-muted-foreground/80">{line.note}</div>}
                </div>
                <div className="min-w-0">
                  <div className="font-terminal text-[7px] text-muted-foreground mb-1">SYMBOLIC</div>
                  <div className="font-mono text-[10px] text-cyan-200 break-words">{line.symbolic}</div>
                </div>
                <div className="min-w-0">
                  <div className="font-terminal text-[7px] text-muted-foreground mb-1">SUBSTITUTED INPUTS</div>
                  <div className="font-mono text-[9px] text-foreground break-words">{line.substitution ?? "—"}</div>
                </div>
                <div className="xl:text-right">
                  <div className="font-terminal text-[7px] text-muted-foreground mb-1">RESULT</div>
                  <div className="font-mono text-[11px] font-bold text-amber-300 break-words">{line.result ?? "—"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel title="VALIDATION & CONVENTIONS" icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}>
          <div className="space-y-2">
            {notebook.checks.map((check) => (
              <ValidationRow key={check.label} label={check.label.toUpperCase()} value={check.value} passed={check.passed} />
            ))}
          </div>
        </Panel>
        <Panel title="INPUT AUDIT" icon={<BookOpenCheck className="w-3.5 h-3.5 text-amber-400" />}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 font-terminal text-[9px]">
            <Readout label="SPOT S" value={`${currencySymbol}${audit.inputs.spot.toFixed(6)}`} />
            <Readout label="STRIKE K" value={`${currencySymbol}${audit.inputs.strike.toFixed(6)}`} />
            <Readout label="TIME T" value={`${audit.inputs.calendarDays.toFixed(2)}d · ${audit.inputs.timeYears.toFixed(8)}y`} />
            <Readout label="VOL σ" value={`${(audit.inputs.volatility * 100).toFixed(4)}%`} />
            <Readout label="RATE r" value={`${(audit.inputs.rate * 100).toFixed(4)}%`} />
            <Readout label="DIV YIELD q" value={`${(audit.inputs.dividendYield * 100).toFixed(4)}%`} />
            <Readout label="CASH DIV PV" value={`${currencySymbol}${audit.adjustments.discreteDividendPv.toFixed(6)}`} />
            <Readout label="ADJUSTED SPOT" value={`${currencySymbol}${audit.adjustments.adjustedSpot.toFixed(6)}`} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-border bg-[#080808]">
      <div className="flex items-center gap-1.5 border-b border-border/70 bg-[#090909] px-3 py-2 font-terminal text-[8px] font-bold tracking-[0.12em] text-muted-foreground">{icon}{title}</div>
      <div className="p-3 space-y-2">{children}</div>
    </section>
  );
}

function InputField({ label, value, onChange, suffix, compact = false }: { label: string; value: number | null; onChange: (value: number) => void; suffix?: string; compact?: boolean }) {
  return (
    <label className="block min-w-0">
      <span className="font-terminal text-[7px] text-muted-foreground">{label}</span>
      <div className={`mt-0.5 flex items-center border border-border/60 bg-[#050505] ${compact ? "h-[26px]" : "h-8"}`}>
        <input type="number" value={value ?? ""} onChange={(event) => onChange(Number(event.target.value))} className="min-w-0 flex-1 bg-transparent px-2 font-mono text-[10px] outline-none" />
        {suffix && <span className="px-2 font-terminal text-[7px] text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}

function NullableInputField({ label, value, onChange, suffix, placeholder }: { label: string; value: number | null; onChange: (value: number | null) => void; suffix?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="font-terminal text-[7px] text-muted-foreground">{label}</span>
      <div className="mt-0.5 flex h-8 items-center border border-border/60 bg-[#050505]">
        <input
          type="number"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent px-2 font-mono text-[10px] outline-none placeholder:text-muted-foreground/50"
        />
        {suffix && <span className="px-2 font-terminal text-[7px] text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}

function Segmented<T extends string>({ values, active, onChange }: { values: T[]; active: T; onChange: (value: T) => void }) {
  return (
    <div className="grid border border-border/60" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
      {values.map((value) => (
        <button key={value} onClick={() => onChange(value)} className={`border-r last:border-r-0 border-border/60 px-1.5 py-1 font-terminal text-[7px] tracking-wider uppercase ${active === value ? "bg-amber-500/12 text-amber-300" : "text-muted-foreground hover:text-foreground"}`}>
          {value}
        </button>
      ))}
    </div>
  );
}

function MetricCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`border p-3 ${accent ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-border bg-[#080808]"}`}>
      <div className="font-terminal text-[7px] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-sm font-bold tabular-nums ${accent ? "text-amber-300" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><span className="text-muted-foreground">{label}: </span><span className="text-foreground break-words">{value}</span></div>;
}

function SourceLine({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className={`font-terminal text-[7px] break-words ${warning ? "text-amber-300" : "text-muted-foreground"}`}><span>{label}</span> · {value}</div>;
}

function ValidationRow({ label, value, passed }: { label: string; value: string; passed?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 font-terminal text-[8px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right break-words ${passed === true ? "text-emerald-400" : passed === false ? "text-red-400" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function StatePanel({ icon, title, body, compact = false }: { icon: React.ReactNode; title: string; body: string; compact?: boolean }) {
  return (
    <div className={`${compact ? "min-h-[360px]" : "h-full"} flex items-center justify-center bg-[#050505] p-6`}>
      <div className="max-w-lg border border-border bg-[#080808] p-5 text-center">
        <div className="mx-auto mb-2 flex w-fit items-center justify-center text-muted-foreground">{icon}</div>
        <div className="font-terminal text-[10px] font-bold tracking-wider">{title.toUpperCase()}</div>
        <div className="mt-2 font-terminal text-[8px] leading-relaxed text-muted-foreground">{body}</div>
      </div>
    </div>
  );
}
