import { useTerminalArtifactContext, useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useEffect, useMemo, useState, useRef } from "react";
import { Activity, Info, RefreshCw, Scale, ShieldCheck, Sliders, Target } from "lucide-react";

import { getCurrencyInfo, inferCurrencyFromSymbol } from "@/lib/finance";
import { isObservedQuote } from "@/lib/quoteObservation";
import { useFundamentals, useOHLCV, useQuote } from "@/lib/useFinance";
import { useYieldCurve } from "@/lib/useEconomics";
import {
  americanGreeks,
  blackScholesMerton,
  interpolateYieldCurveRate,
  realizedVolatilityPct,
  type DiscreteDividend,
  type OptionGreeks,
} from "@/lib/optionsModels";
import {
  analyzeBoxSpread,
  analyzePutCallParity,
  applyUnderlyingDeltaHedge,
  approximateGreekScenarioPnl,
  scaleOptionGreeks,
  solveDeltaGammaVegaHedge,
  solveSingleOptionHedge,
  type HedgePlan,
  type PositionGreekRisk,
} from "@/lib/optionsHedging";

interface Props {
  symbol: string;
}

type ExerciseStyle = "european" | "american";
type OptionSide = "call" | "put";
type HedgeMode = "delta" | "gamma" | "vega" | "gamma_vega";

const TREE_STEPS = 250;
const DEFAULT_MULTIPLIER = 100;

function buildStrikeLadder(spot: number) {
  let step = 5;
  if (spot < 15) step = 0.5;
  else if (spot < 50) step = 1;
  else if (spot < 200) step = 5;
  else if (spot < 500) step = 10;
  else if (spot < 2000) step = 25;
  else if (spot < 10000) step = 100;
  else step = 500;
  const center = Math.round(spot / step) * step;
  return Array.from({ length: 15 }, (_, index) => center + (index - 7) * step).filter((strike) => strike > 0);
}

function fmt(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function signedLabel(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${fmt(value, digits)}`;
}

export default function OptionsRiskHedgePanel({ symbol }: Props) {
  const { data: quote, isLoading } = useQuote(symbol);
  const [mode, setMode] = useTerminalArtifactState<"live" | "manual">("OptionsRiskHedgePanel.inputMode", "live");
  const [manualSpot, setManualSpot] = useTerminalArtifactState("OptionsRiskHedgePanel.manualSpot", "");
  const [manualCurrency, setManualCurrency] = useTerminalArtifactState("OptionsRiskHedgePanel.manualCurrency", "USD");
  const manual = mode === "manual";
  const spot = manual ? Number(manualSpot) : quote?.price;
  const available = manual ? manualSpot.trim() !== "" && Number.isFinite(spot) && spot! > 0 : isObservedQuote(quote);
  return <div className="h-full overflow-auto">
    <div className="flex flex-wrap gap-3 border-b border-border p-3 text-xs">
      <label>Input basis <select aria-label="Hedge input basis" value={mode} onChange={event => setMode(event.target.value as "live" | "manual")}><option value="live">Observed live spot</option><option value="manual">Explicit manual scenario</option></select></label>
      {manual && <><label>Manual spot <input aria-label="Manual hedge spot" type="number" min="0.000001" value={manualSpot} onChange={event => setManualSpot(event.target.value)}/></label>
      <label>Currency <input aria-label="Manual hedge currency" value={manualCurrency} maxLength={3} onChange={event => setManualCurrency(event.target.value.toUpperCase())}/></label></>}
    </div>
    {!available || manual && !/^[A-Z]{3}$/.test(manualCurrency) ? <p role="status" className="p-4 text-sm">{manual ? "Enter an explicit positive manual spot and ISO currency. No market observation or native receipt is claimed." : isLoading ? "Loading observed spot…" : "SPOT PRICE UNAVAILABLE · Existing hedge calculations require an observed underlying price or explicitly entered manual scenario. No fallback spot or hedge result has been substituted. Retained authored terms are unchanged."}</p>
      : <ObservedOptionsRiskHedgePanel key={mode} symbol={symbol} spot={spot!} currencyCode={manual ? manualCurrency : quote?.currency || inferCurrencyFromSymbol(symbol)} manual={manual}/>}
  </div>;
}

function ObservedOptionsRiskHedgePanel({ symbol, spot, currencyCode, manual }: Props & { spot: number; currencyCode: string; manual: boolean }) {
  const terminal = useTerminalArtifactContext();
  const initializedSymbol = useRef(symbol);
  const { data: fundamentals } = useFundamentals(symbol);
  const { data: history } = useOHLCV(symbol, "6M", "1d");
  const { data: yieldCurveData } = useYieldCurve();

  const currencySymbol = getCurrencyInfo(currencyCode).symbol;
  const strikes = useMemo(() => buildStrikeLadder(spot), [spot]);

  const [expiryDays, setExpiryDays] = useTerminalArtifactState("OptionsRiskHedgePanel.expiryDays", 30);
  const [volatilityPct, setVolatilityPct] = useTerminalArtifactState("OptionsRiskHedgePanel.volatilityPct", 25);
  const [riskFreeRatePct, setRiskFreeRatePct] = useTerminalArtifactState("OptionsRiskHedgePanel.riskFreeRatePct", 5);
  const [dividendYieldPct, setDividendYieldPct] = useTerminalArtifactState("OptionsRiskHedgePanel.dividendYieldPct", 0);
  const [exerciseStyle, setExerciseStyle] = useTerminalArtifactState<ExerciseStyle>("OptionsRiskHedgePanel.exerciseStyle", "european");
  const [optionSide, setOptionSide] = useTerminalArtifactState<OptionSide>("OptionsRiskHedgePanel.optionSide", "call");
  const [strike, setStrike] = useTerminalArtifactState("OptionsRiskHedgePanel.strike", 100);
  const [signedDirection, setSignedDirection] = useTerminalArtifactState<1 | -1>("OptionsRiskHedgePanel.signedDirection", 1);
  const [contracts, setContracts] = useTerminalArtifactState("OptionsRiskHedgePanel.contracts", 10);
  const [contractMultiplier, setContractMultiplier] = useTerminalArtifactState("OptionsRiskHedgePanel.contractMultiplier", DEFAULT_MULTIPLIER);

  const [hedgeMode, setHedgeMode] = useTerminalArtifactState<HedgeMode>("OptionsRiskHedgePanel.hedgeMode", "delta");
  const [hedgeASide, setHedgeASide] = useTerminalArtifactState<OptionSide>("OptionsRiskHedgePanel.hedgeASide", "call");
  const [hedgeAStrike, setHedgeAStrike] = useTerminalArtifactState("OptionsRiskHedgePanel.hedgeAStrike", 100);
  const [hedgeAExpiryDays, setHedgeAExpiryDays] = useTerminalArtifactState("OptionsRiskHedgePanel.hedgeAExpiryDays", 45);
  const [hedgeBSide, setHedgeBSide] = useTerminalArtifactState<OptionSide>("OptionsRiskHedgePanel.hedgeBSide", "put");
  const [hedgeBStrike, setHedgeBStrike] = useTerminalArtifactState("OptionsRiskHedgePanel.hedgeBStrike", 100);
  const [hedgeBExpiryDays, setHedgeBExpiryDays] = useTerminalArtifactState("OptionsRiskHedgePanel.hedgeBExpiryDays", 90);

  const [spotShockPct, setSpotShockPct] = useTerminalArtifactState("OptionsRiskHedgePanel.spotShockPct", 2);
  const [volShockPoints, setVolShockPoints] = useTerminalArtifactState("OptionsRiskHedgePanel.volShockPoints", 2);
  const [daysElapsed, setDaysElapsed] = useTerminalArtifactState("OptionsRiskHedgePanel.daysElapsed", 1);
  const [rateShockBps, setRateShockBps] = useTerminalArtifactState("OptionsRiskHedgePanel.rateShockBps", 25);
  const [cashDividendAmount, setCashDividendAmount] = useTerminalArtifactState("OptionsRiskHedgePanel.cashDividendAmount", 0);
  const [cashDividendDays, setCashDividendDays] = useTerminalArtifactState("OptionsRiskHedgePanel.cashDividendDays", 15);
  const [marketCallText, setMarketCallText] = useTerminalArtifactState("OptionsRiskHedgePanel.marketCallText", "");
  const [marketPutText, setMarketPutText] = useTerminalArtifactState("OptionsRiskHedgePanel.marketPutText", "");
  const [volTouched, setVolTouched] = useTerminalArtifactState("OptionsRiskHedgePanel.volTouched", false);
  const [rateTouched, setRateTouched] = useTerminalArtifactState("OptionsRiskHedgePanel.rateTouched", false);
  const [qTouched, setQTouched] = useTerminalArtifactState("OptionsRiskHedgePanel.qTouched", false);

  const T = expiryDays / 365;
  const r = riskFreeRatePct / 100;
  const q = dividendYieldPct / 100;
  const v = volatilityPct / 100;

  useEffect(() => {
    if (terminal && initializedSymbol.current === symbol) return;
    initializedSymbol.current = symbol;
    if (strikes.length === 0) return;
    const mid = Math.floor(strikes.length / 2);
    setStrike(strikes[mid]);
    setHedgeAStrike(strikes[Math.max(0, mid - 2)]);
    setHedgeBStrike(strikes[Math.min(strikes.length - 1, mid + 2)]);
    setMarketCallText("");
    setMarketPutText("");
  }, [symbol, strikes]);

  const realizedVolPct = useMemo(() => {
    const closes = history?.bars?.map((bar) => bar.close) ?? [];
    return realizedVolatilityPct(closes.slice(-126));
  }, [history]);

  useEffect(() => {
    if (manual || volTouched) return;
    if (realizedVolPct != null && Number.isFinite(realizedVolPct)) {
      setVolatilityPct(Math.max(5, Math.min(150, Number(realizedVolPct.toFixed(2)))));
    } else {
      setVolatilityPct(25);
    }
  }, [realizedVolPct, volTouched, symbol, manual]);

  useEffect(() => {
    if (manual || qTouched) return;
    const liveYield = fundamentals?.dividendYield;
    setDividendYieldPct(liveYield != null && Number.isFinite(liveYield) ? Math.max(0, Number(liveYield.toFixed(2))) : 0);
  }, [fundamentals, qTouched, symbol, manual]);

  const interpolatedRate = useMemo(() => {
    if (currencyCode !== "USD") return null;
    return interpolateYieldCurveRate(yieldCurveData?.curve ?? [], expiryDays);
  }, [currencyCode, expiryDays, yieldCurveData]);

  useEffect(() => {
    if (manual || rateTouched) return;
    if (currencyCode === "USD" && interpolatedRate?.ratePercent != null) {
      setRiskFreeRatePct(Number(interpolatedRate.ratePercent.toFixed(3)));
    } else if (currencyCode !== "USD") {
      setRiskFreeRatePct(0);
    }
  }, [currencyCode, interpolatedRate, rateTouched, symbol, manual]);

  const configuredDividends = useMemo<DiscreteDividend[]>(() => {
    if (!(cashDividendAmount > 0) || !(cashDividendDays > 0)) return [];
    return [{ amount: cashDividendAmount, timeYears: cashDividendDays / 365, source: "hedge-workbench manual cash dividend" }];
  }, [cashDividendAmount, cashDividendDays]);

  const dividendsForDays = (days: number) => configuredDividends.filter((dividend) => dividend.timeYears <= Math.max(1, days) / 365);

  const rateForDays = (days: number) => {
    if (manual || rateTouched || currencyCode !== "USD") return r;
    const point = interpolateYieldCurveRate(yieldCurveData?.curve ?? [], Math.max(1, days));
    return point?.ratePercent != null ? point.ratePercent / 100 : r;
  };

  const priceOptionAt = (K: number, side: OptionSide, days: number, style = exerciseStyle): OptionGreeks => {
    const isCall = side === "call";
    const localT = Math.max(1, days) / 365;
    const localR = rateForDays(days);
    const localDividends = dividendsForDays(days);
    return style === "american"
      ? americanGreeks(spot, K, localT, localR, q, v, isCall, TREE_STEPS, localDividends)
      : blackScholesMerton(spot, K, localT, localR, q, v, isCall, localDividends);
  };

  const priceOption = (K: number, side: OptionSide, style = exerciseStyle) => priceOptionAt(K, side, expiryDays, style);

  const primaryGreeks = useMemo(
    () => priceOption(strike, optionSide),
    [spot, strike, optionSide, exerciseStyle, expiryDays, r, q, v, configuredDividends, rateTouched, currencyCode, yieldCurveData]
  );
  const europeanPrimary = useMemo(
    () => priceOption(strike, optionSide, "european"),
    [spot, strike, optionSide, expiryDays, r, q, v, configuredDividends, rateTouched, currencyCode, yieldCurveData]
  );
  const hedgeAGreeks = useMemo(
    () => priceOptionAt(hedgeAStrike, hedgeASide, hedgeAExpiryDays),
    [spot, hedgeAStrike, hedgeASide, hedgeAExpiryDays, exerciseStyle, r, q, v, configuredDividends, rateTouched, currencyCode, yieldCurveData]
  );
  const hedgeBGreeks = useMemo(
    () => priceOptionAt(hedgeBStrike, hedgeBSide, hedgeBExpiryDays),
    [spot, hedgeBStrike, hedgeBSide, hedgeBExpiryDays, exerciseStyle, r, q, v, configuredDividends, rateTouched, currencyCode, yieldCurveData]
  );

  const signedContracts = signedDirection * Math.max(0, contracts);
  const primaryRisk = useMemo(
    () => scaleOptionGreeks(primaryGreeks, signedContracts, contractMultiplier, spot),
    [primaryGreeks, signedContracts, contractMultiplier, spot]
  );

  const hedgePlan = useMemo<HedgePlan>(() => {
    if (hedgeMode === "delta") return applyUnderlyingDeltaHedge(primaryRisk, spot);
    if (hedgeMode === "gamma") return solveSingleOptionHedge(primaryRisk, hedgeAGreeks, "gamma", spot, contractMultiplier);
    if (hedgeMode === "vega") return solveSingleOptionHedge(primaryRisk, hedgeAGreeks, "vega", spot, contractMultiplier);
    return solveDeltaGammaVegaHedge(primaryRisk, hedgeAGreeks, hedgeBGreeks, spot, contractMultiplier, contractMultiplier);
  }, [hedgeMode, primaryRisk, hedgeAGreeks, hedgeBGreeks, spot, contractMultiplier]);

  const beforeScenario = useMemo(
    () => approximateGreekScenarioPnl(primaryRisk, spot, spotShockPct, volShockPoints, daysElapsed, rateShockBps),
    [primaryRisk, spot, spotShockPct, volShockPoints, daysElapsed, rateShockBps]
  );
  const afterScenario = useMemo(
    () => approximateGreekScenarioPnl(hedgePlan.residualRisk, spot, spotShockPct, volShockPoints, daysElapsed, rateShockBps),
    [hedgePlan, spot, spotShockPct, volShockPoints, daysElapsed, rateShockBps]
  );

  const euroCall = useMemo(
    () => priceOption(strike, "call", "european"),
    [spot, strike, expiryDays, r, q, v, configuredDividends, rateTouched, currencyCode, yieldCurveData]
  );
  const euroPut = useMemo(
    () => priceOption(strike, "put", "european"),
    [spot, strike, expiryDays, r, q, v, configuredDividends, rateTouched, currencyCode, yieldCurveData]
  );
  const observedCall = marketCallText.trim() === "" ? euroCall.price : Number(marketCallText);
  const observedPut = marketPutText.trim() === "" ? euroPut.price : Number(marketPutText);
  const primaryDividends = dividendsForDays(expiryDays);

  const parity = useMemo(() => analyzePutCallParity({
    spot,
    strike,
    timeYears: T,
    rate: rateForDays(expiryDays),
    dividendYield: q,
    callPrice: Number.isFinite(observedCall) ? observedCall : euroCall.price,
    putPrice: Number.isFinite(observedPut) ? observedPut : euroPut.price,
    discreteDividends: primaryDividends,
  }), [spot, strike, T, r, q, observedCall, observedPut, euroCall.price, euroPut.price, configuredDividends, rateTouched, currencyCode, yieldCurveData]);

  const box = useMemo(() => {
    const lowStrike = strikes[2] ?? Math.max(0.01, strike * 0.9);
    const highStrike = strikes.at(-3) ?? strike * 1.1;
    const callLow = priceOption(lowStrike, "call", "european").price;
    const putLow = priceOption(lowStrike, "put", "european").price;
    const callHigh = priceOption(highStrike, "call", "european").price;
    const putHigh = priceOption(highStrike, "put", "european").price;
    return analyzeBoxSpread({
      lowStrike,
      highStrike,
      callLow,
      putLow,
      callHigh,
      putHigh,
      timeYears: T,
      rate: rateForDays(expiryDays),
    });
  }, [strikes, strike, spot, T, r, q, v, configuredDividends, rateTouched, currencyCode, yieldCurveData]);


  const earlyExercisePremium = exerciseStyle === "american" ? primaryGreeks.price - europeanPrimary.price : 0;
  const deltaDriftOnePctBefore = primaryRisk.gamma * spot * 0.01;
  const deltaDriftOnePctAfter = hedgePlan.residualRisk.gamma * spot * 0.01;
  const hedgeARatePct = rateForDays(hedgeAExpiryDays) * 100;
  const hedgeBRatePct = rateForDays(hedgeBExpiryDays) * 100;

  return (
    <div className="h-full overflow-auto bg-[#050505] text-foreground scrollbar-thin">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-[#070707] px-4 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Target className="w-4 h-4 text-amber-400" />
          <span className="font-terminal text-[10px] tracking-widest font-bold">RISK · HEDGING · PARITY</span>
          <span className="font-terminal text-[9px] text-cyan-400">{symbol} · {currencySymbol}{fmt(spot, 2)}</span>
          <StatusBadge good={!hedgePlan.warning} text={hedgePlan.warning ? "HEDGE WARNING" : "HEDGE SOLVED"} />
          <StatusBadge good={parity.status === "aligned"} text={parity.status === "aligned" ? "PARITY ALIGNED" : "PARITY DISLOCATION"} />
        </div>
        <button onClick={() => { setVolTouched(false); setRateTouched(false); setQTouched(false); }} className="flex items-center gap-1 border border-border/60 px-2 py-1 font-terminal text-[8px] text-muted-foreground hover:text-amber-400"><RefreshCw className="w-3 h-3" /> RESET SOURCES</button>
      </div>
      <p className="border-b border-amber-400/25 px-4 py-2 text-xs text-amber-200">{manual ? "Reproducible manual scenario · explicit spot/currency and saved authored terms drive the original local hedge calculation; live sources do not replace these inputs." : "Local model illustration using the displayed observed spot and editable assumptions; live inputs can change the result."} Default volatility, rates, yields and contract terms are assumptions, not observed option quotes or a native execution receipt.</p>

      <div className="grid grid-cols-1 2xl:grid-cols-[350px_minmax(0,1fr)] gap-4 p-4">
        <aside className="space-y-3">
          <Card title="POSITION & MODEL" icon={<Sliders className="w-3.5 h-3.5 text-amber-400" />}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="EXPIRY DAYS" value={expiryDays} onChange={(n) => setExpiryDays(Math.max(1, n))} min={1} step={1} />
              <Field label="VOLATILITY %" value={volatilityPct} onChange={(n) => { setVolatilityPct(Math.max(0.1, n)); setVolTouched(true); }} min={0.1} step={0.1} />
              <Field label={`RATE % · ${currencyCode}`} value={riskFreeRatePct} onChange={(n) => { setRiskFreeRatePct(n); setRateTouched(true); }} step={0.01} />
              <Field label="DIV YIELD %" value={dividendYieldPct} onChange={(n) => { setDividendYieldPct(Math.max(0, n)); setQTouched(true); }} min={0} step={0.01} />
            </div>
            <div className="font-terminal text-[7px] text-muted-foreground leading-relaxed">
              Vol source: {manual ? `manual scenario ${volatilityPct}%` : volTouched ? "custom" : realizedVolPct != null ? `6M realized ${realizedVolPct.toFixed(2)}%` : "illustrative assumption 25%"}. Rate source: {!manual && currencyCode === "USD" && interpolatedRate?.ratePercent != null && !rateTouched ? `USD curve ${interpolatedRate.ratePercent.toFixed(3)}% @ ${expiryDays}d` : "manual/local assumption"}.
            </div>
            <ToggleRow labels={["EUROPEAN", "AMERICAN"]} active={exerciseStyle === "european" ? 0 : 1} onSelect={(index) => setExerciseStyle(index === 0 ? "european" : "american")} />
            <div className="grid grid-cols-2 gap-2">
              <SelectField label="OPTION SIDE" value={optionSide} onChange={(value) => setOptionSide(value as OptionSide)} options={[{ value: "call", label: "CALL" }, { value: "put", label: "PUT" }]} />
              <SelectField label="STRIKE" value={String(strike)} onChange={(value) => setStrike(Number(value))} options={strikes.map((K) => ({ value: String(K), label: String(K) }))} />
              <Field label="CONTRACTS" value={contracts} onChange={(n) => setContracts(Math.max(0, n))} min={0} step={1} />
              <Field label="MULTIPLIER" value={contractMultiplier} onChange={(n) => setContractMultiplier(Math.max(1, n))} min={1} step={1} />
            </div>
            <ToggleRow labels={["LONG", "SHORT"]} active={signedDirection === 1 ? 0 : 1} onSelect={(index) => setSignedDirection(index === 0 ? 1 : -1)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="CASH DIV / SHARE" value={cashDividendAmount} onChange={(n) => setCashDividendAmount(Math.max(0, n))} min={0} step={0.01} />
              <Field label="EX-DATE IN DAYS" value={cashDividendDays} onChange={(n) => setCashDividendDays(Math.max(1, n))} min={1} step={1} />
            </div>
          </Card>

          <Card title="HEDGE ENGINE" icon={<Scale className="w-3.5 h-3.5 text-cyan-400" />}>
            <SelectField
              label="TARGET"
              value={hedgeMode}
              onChange={(value) => setHedgeMode(value as HedgeMode)}
              options={[
                { value: "delta", label: "DELTA NEUTRAL" },
                { value: "gamma", label: "DELTA + GAMMA" },
                { value: "vega", label: "DELTA + VEGA" },
                { value: "gamma_vega", label: "DELTA + GAMMA + VEGA" },
              ]}
            />
            {hedgeMode !== "delta" && (
              <div className="grid grid-cols-3 gap-2">
                <SelectField label="HEDGE A" value={hedgeASide} onChange={(value) => setHedgeASide(value as OptionSide)} options={[{ value: "call", label: "CALL" }, { value: "put", label: "PUT" }]} />
                <SelectField label="A STRIKE" value={String(hedgeAStrike)} onChange={(value) => setHedgeAStrike(Number(value))} options={strikes.map((K) => ({ value: String(K), label: String(K) }))} />
                <Field label="A EXPIRY D" value={hedgeAExpiryDays} onChange={(n) => setHedgeAExpiryDays(Math.max(1, n))} min={1} step={1} />
              </div>
            )}
            {hedgeMode === "gamma_vega" && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <SelectField label="HEDGE B" value={hedgeBSide} onChange={(value) => setHedgeBSide(value as OptionSide)} options={[{ value: "call", label: "CALL" }, { value: "put", label: "PUT" }]} />
                  <SelectField label="B STRIKE" value={String(hedgeBStrike)} onChange={(value) => setHedgeBStrike(Number(value))} options={strikes.map((K) => ({ value: String(K), label: String(K) }))} />
                  <Field label="B EXPIRY D" value={hedgeBExpiryDays} onChange={(n) => setHedgeBExpiryDays(Math.max(1, n))} min={1} step={1} />
                </div>
                <div className="border border-cyan-500/20 bg-cyan-500/5 p-2 font-terminal text-[7px] text-muted-foreground leading-relaxed">
                  Under one-vol BSM, same-expiry gamma and vega are proportional across strikes. A stable simultaneous Γ/ν hedge therefore needs different maturities (or a richer surface model). Defaults use {hedgeAExpiryDays}d and {hedgeBExpiryDays}d.
                </div>
              </>
            )}
            {hedgeMode !== "delta" && <div className="font-terminal text-[7px] text-muted-foreground">Hedge A rate: {fmt(hedgeARatePct, 3)}%{hedgeMode === "gamma_vega" ? ` · Hedge B rate: ${fmt(hedgeBRatePct, 3)}%` : ""}{currencyCode === "USD" && !rateTouched ? " · curve-matched" : " · manual/local"}</div>}
            {hedgePlan.warning && <div className="border border-red-500/30 bg-red-500/5 p-2 font-terminal text-[8px] text-red-300">{hedgePlan.warning}</div>}
          </Card>
        </aside>

        <main className="space-y-4 min-w-0">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="POSITION GREEKS · BEFORE HEDGE" icon={<Activity className="w-3.5 h-3.5 text-amber-400" />}>
              <RiskTable risk={primaryRisk} spot={spot} currencySymbol={currencySymbol} />
              <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-2 font-terminal text-[8px] text-muted-foreground">
                <Metric label="MODEL PRICE" value={`${currencySymbol}${fmt(primaryGreeks.price, 4)}`} />
                <Metric label="SIGNED CONTRACTS" value={signedLabel(signedContracts, 2)} />
                <Metric label="1% Δ DRIFT" value={`${signedLabel(deltaDriftOnePctBefore, 2)} sh`} />
              </div>
              {exerciseStyle === "american" && <div className="font-terminal text-[8px] text-muted-foreground">Early-exercise premium vs European benchmark: <strong className="text-foreground">{currencySymbol}{fmt(earlyExercisePremium, 6)}</strong>.</div>}
            </Card>

            <Card title="HEDGE INSTRUCTIONS · SOLVED QUANTITIES" icon={<Target className="w-3.5 h-3.5 text-emerald-400" />}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <Metric label={hedgeMode === "delta" ? "HEDGE A" : `HEDGE A · ${hedgeAExpiryDays}D`} value={hedgeMode === "delta" ? "N/A" : signedLabel(hedgePlan.hedgeContractsA, 4)} strong />
                <Metric label={hedgeMode === "gamma_vega" ? `HEDGE B · ${hedgeBExpiryDays}D` : "HEDGE B"} value={hedgeMode === "gamma_vega" ? signedLabel(hedgePlan.hedgeContractsB, 4) : "N/A"} strong />
                <Metric label="UNDERLYING SHARES" value={signedLabel(hedgePlan.underlyingShares, 2)} strong />
                <Metric label="STOCK NOTIONAL" value={`${currencySymbol}${signedLabel(hedgePlan.underlyingNotional, 2)}`} strong />
              </div>
              <div className="font-terminal text-[8px] text-muted-foreground leading-relaxed">
                Positive contract/share quantities mean buy/long; negative quantities mean sell/short. Fractional contract output is the exact continuous hedge ratio; execution requires rounding to tradable lots and then recomputing residual Greeks.
              </div>
              <RiskTable risk={hedgePlan.residualRisk} spot={spot} currencySymbol={currencySymbol} compact />
              <div className="font-terminal text-[8px] text-muted-foreground">Post-hedge estimated delta drift for a 1% spot move: <strong className="text-foreground">{signedLabel(deltaDriftOnePctAfter, 2)} shares</strong>.</div>
            </Card>
          </div>

          <Card title="LOCAL SHOCK P&L · BEFORE VS AFTER HEDGE" icon={<Activity className="w-3.5 h-3.5 text-cyan-400" />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <Field label="SPOT SHOCK %" value={spotShockPct} onChange={setSpotShockPct} step={0.25} />
              <Field label="VOL SHOCK · POINTS" value={volShockPoints} onChange={setVolShockPoints} step={0.25} />
              <Field label="DAYS ELAPSED" value={daysElapsed} onChange={(n) => setDaysElapsed(Math.max(0, n))} min={0} step={1} />
              <Field label="RATE SHOCK · BP" value={rateShockBps} onChange={setRateShockBps} step={5} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] font-terminal text-[9px] border-collapse">
                <thead className="text-muted-foreground bg-[#090909]"><tr><th className="text-left p-2 border border-border/60">STATE</th><th className="p-2 border border-border/60">DELTA</th><th className="p-2 border border-border/60">GAMMA</th><th className="p-2 border border-border/60">THETA</th><th className="p-2 border border-border/60">VEGA</th><th className="p-2 border border-border/60">RHO</th><th className="p-2 border border-border/60 text-foreground">TOTAL</th></tr></thead>
                <tbody>
                  <ScenarioRow label="BEFORE" pnl={beforeScenario} currencySymbol={currencySymbol} />
                  <ScenarioRow label="AFTER HEDGE" pnl={afterScenario} currencySymbol={currencySymbol} />
                </tbody>
              </table>
            </div>
            <div className="font-terminal text-[7px] text-muted-foreground">Local approximation: Δ·dS + ½Γ·dS² + Θ·days + Vega·vol-points + Rho·(bp/100). It is a risk decomposition, not a full repricing for large shocks.</div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="PUT-CALL PARITY · SYNTHETIC FORWARD" icon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1"><span className="font-terminal text-[7px] text-muted-foreground">CALL PREMIUM · BLANK = MODEL</span><input value={marketCallText} onChange={(event) => setMarketCallText(event.target.value)} placeholder={euroCall.price.toFixed(4)} className="w-full bg-[#050505] border border-border/60 px-2 py-1 font-mono text-[10px] outline-none focus:border-amber-500/50" /></label>
                <label className="space-y-1"><span className="font-terminal text-[7px] text-muted-foreground">PUT PREMIUM · BLANK = MODEL</span><input value={marketPutText} onChange={(event) => setMarketPutText(event.target.value)} placeholder={euroPut.price.toFixed(4)} className="w-full bg-[#050505] border border-border/60 px-2 py-1 font-mono text-[10px] outline-none focus:border-amber-500/50" /></label>
              </div>
              <button onClick={() => { setMarketCallText(euroCall.price.toFixed(6)); setMarketPutText(euroPut.price.toFixed(6)); }} className="border border-border/60 px-2 py-1 font-terminal text-[8px] text-muted-foreground hover:text-foreground">LOAD EUROPEAN MODEL QUOTES</button>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                <Metric label="OBSERVED C − P" value={`${currencySymbol}${signedLabel(parity.observedCallMinusPut, 4)}`} />
                <Metric label="FAIR C − P" value={`${currencySymbol}${signedLabel(parity.fairCallMinusPut, 4)}`} />
                <Metric label="PARITY RESIDUAL" value={`${currencySymbol}${signedLabel(parity.residual, 6)} · ${signedLabel(parity.residualBpsOfSpot, 2)}bp spot`} strong />
                <Metric label="FAIR FORWARD" value={`${currencySymbol}${fmt(parity.fairForward, 4)}`} />
                <Metric label="SYNTHETIC IMPLIED FWD" value={`${currencySymbol}${fmt(parity.syntheticImpliedForward, 4)}`} />
                <Metric label="IMPLIED FUNDING" value={parity.impliedRatePct == null ? "N/A" : `${fmt(parity.impliedRatePct, 4)}%`} />
              </div>
              <div className={`border p-2 font-terminal text-[8px] leading-relaxed ${parity.status === "aligned" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300" : "border-amber-500/30 bg-amber-500/5 text-amber-200"}`}>{parity.tradeDescription}</div>
              <div className="font-terminal text-[7px] text-muted-foreground"><strong className="text-foreground">Scope:</strong> strict put-call parity equality is European, same strike, same expiry. American options have early-exercise optionality, so the equality is not used as an arbitrage assertion in American mode.</div>
            </Card>

            <Card title="BOX-SPREAD / FUNDING IDENTITY" icon={<Scale className="w-3.5 h-3.5 text-cyan-400" />}>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                <Metric label="STRIKE WIDTH" value={`${fmt(box.lowStrike, 2)} → ${fmt(box.highStrike, 2)}`} />
                <Metric label="TERMINAL PAYOFF" value={`${currencySymbol}${fmt(box.terminalPayoff, 4)}`} />
                <Metric label="FAIR PV" value={`${currencySymbol}${fmt(box.fairPresentValue, 6)}`} />
                <Metric label="MODEL BOX PV" value={`${currencySymbol}${fmt(box.observedPresentValue, 6)}`} />
                <Metric label="BOX RESIDUAL" value={`${currencySymbol}${signedLabel(box.residual, 8)}`} strong />
                <Metric label="BOX IMPLIED RATE" value={box.impliedRatePct == null ? "N/A" : `${fmt(box.impliedRatePct, 4)}%`} />
              </div>
              <div className="font-terminal text-[8px] text-muted-foreground leading-relaxed">Long European box: (C₁−P₁)−(C₂−P₂) = (K₂−K₁)e<sup>−rT</sup>. The underlying/dividend term cancels, so this is a clean same-expiry discounting and internal-consistency check. Market implementation still requires bid/ask, exercise-style and settlement checks.</div>
              <div className="border border-border/60 bg-[#060606] p-2 font-terminal text-[8px] text-muted-foreground">
                <strong className="text-foreground">Also enforced in the pricing grid:</strong> no-arbitrage bounds, strike monotonicity, strike convexity and European put-call parity. This workbench adds Greek hedging, cross-maturity Γ/ν spanning, synthetic forwards and box funding consistency.
              </div>
            </Card>
          </div>

          <div className="border border-border/70 bg-[#080808] p-3 flex gap-2 font-terminal text-[8px] text-muted-foreground leading-relaxed">
            <Info className="w-4 h-4 shrink-0 text-amber-400" />
            <div><strong className="text-foreground">Hedging is local, not permanent.</strong> Delta changes with spot/time/vol; gamma and vega change as the market moves. Reprice and rebalance after meaningful spot moves, volatility changes, time decay, dividends, fills or contract rounding. The terminal reports exact continuous hedge ratios so execution residuals are visible rather than hidden.</div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="border border-border bg-[#070707] p-3 space-y-3"><div className="flex items-center gap-1.5 border-b border-border/60 pb-2 font-terminal text-[9px] font-bold tracking-widest text-foreground">{icon}{title}</div>{children}</section>;
}

function StatusBadge({ good, text }: { good: boolean; text: string }) {
  return <span className={`border px-1.5 py-0.5 font-terminal text-[7px] tracking-wider ${good ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/5" : "border-amber-500/30 text-amber-300 bg-amber-500/5"}`}>{text}</span>;
}

function Field({ label, value, onChange, min, step = 0.01 }: { label: string; value: number; onChange: (value: number) => void; min?: number; step?: number }) {
  return <label className="space-y-1"><span className="font-terminal text-[7px] text-muted-foreground">{label}</span><input type="number" value={value} min={min} step={step} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} className="w-full bg-[#050505] border border-border/60 px-2 py-1 font-mono text-[10px] outline-none focus:border-amber-500/50" /></label>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="space-y-1"><span className="font-terminal text-[7px] text-muted-foreground">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full bg-[#050505] border border-border/60 px-2 py-1 font-terminal text-[9px] outline-none focus:border-amber-500/50">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function ToggleRow({ labels, active, onSelect }: { labels: string[]; active: number; onSelect: (index: number) => void }) {
  return <div className="grid border border-border/60" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>{labels.map((label, index) => <button key={label} onClick={() => onSelect(index)} className={`py-1 font-terminal text-[8px] border-r last:border-r-0 border-border/60 ${index === active ? "bg-amber-500/15 text-amber-400" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div>;
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="border border-border/60 bg-[#060606] p-2 min-w-0"><div className="font-terminal text-[7px] text-muted-foreground truncate">{label}</div><div className={`font-mono text-[10px] truncate ${strong ? "text-amber-300 font-bold" : "text-foreground"}`} title={value}>{value}</div></div>;
}

function RiskTable({ risk, spot, currencySymbol, compact = false }: { risk: PositionGreekRisk; spot: number; currencySymbol: string; compact?: boolean }) {
  return <div className={`grid ${compact ? "grid-cols-3 lg:grid-cols-6" : "grid-cols-2 lg:grid-cols-3"} gap-2`}>
    <Metric label="DELTA · SHARES" value={signedLabel(risk.deltaShares, 2)} strong />
    <Metric label="DOLLAR DELTA" value={`${currencySymbol}${signedLabel(risk.dollarDelta, 2)}`} />
    <Metric label="GAMMA" value={signedLabel(risk.gamma, 6)} />
    <Metric label="THETA / DAY" value={`${currencySymbol}${signedLabel(risk.thetaPerDay, 2)}`} />
    <Metric label="VEGA / 1 VOL PT" value={`${currencySymbol}${signedLabel(risk.vegaPerVolPoint, 2)}`} />
    <Metric label="RHO / 100BP" value={`${currencySymbol}${signedLabel(risk.rhoPer100bp, 2)}`} />
    {!compact && <Metric label="Γ P&L · 1% MOVE" value={`${currencySymbol}${signedLabel(risk.gammaPnlOnePctMove, 2)}`} />}
    {!compact && <Metric label="1% Δ DRIFT" value={`${signedLabel(risk.gamma * spot * 0.01, 2)} shares`} />}
  </div>;
}

function ScenarioRow({ label, pnl, currencySymbol }: { label: string; pnl: { delta: number; gamma: number; theta: number; vega: number; rho: number; total: number }; currencySymbol: string }) {
  const cell = (value: number, strong = false) => <td className={`p-2 text-right border border-border/60 font-mono ${strong ? "font-bold text-foreground" : value >= 0 ? "text-emerald-300" : "text-red-300"}`}>{currencySymbol}{signedLabel(value, 2)}</td>;
  return <tr><td className="p-2 border border-border/60 text-muted-foreground">{label}</td>{cell(pnl.delta)}{cell(pnl.gamma)}{cell(pnl.theta)}{cell(pnl.vega)}{cell(pnl.rho)}{cell(pnl.total, true)}</tr>;
}
