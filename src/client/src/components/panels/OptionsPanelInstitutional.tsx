import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Check,
  ChevronDown,
  Copy,
  Download,
  Info,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sliders,
  TrendingUp,
  X,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import LiveLseOptionsChain from "@/components/panels/LiveLseOptionsChain";
import { AdvancedRatesDerivativesRunner } from "@/lib/advancedRatesDerivatives";
import { exportWorkbook } from "@/lib/exportXlsx";
import { getCurrencyInfo, inferCurrencyFromSymbol, formatPrice } from "@/lib/finance";
import { useFundamentals, useOHLCV, useQuote } from "@/lib/useFinance";
import { useYieldCurve } from "@/lib/useEconomics";
import {
  americanGreeks,
  blackScholesMerton,
  breakeven,
  buildOptionCalculationAudit,
  interpolateYieldCurveRate,
  intrinsicValue,
  moneyness,
  optionMoveMetrics,
  probabilityITM,
  probabilityOfTouch,
  realizedVolatilityPct,
  validateEuropeanOptionGrid,
  type DiscreteDividend,
  type OptionCalculationAudit,
  type OptionGreeks,
  type VolatilitySource,
} from "@/lib/optionsModels";

interface Props {
  symbol: string;
}

type MetricView = "greeks" | "value";
type ExerciseStyle = "european" | "american";
type DividendMode = "continuous" | "cash" | "both";
type AuditTarget = { strike: number; isCall: boolean };

type ChainRow = {
  strike: number;
  call: OptionGreeks;
  put: OptionGreeks;
  callIntrinsic: number;
  putIntrinsic: number;
  callMoneyness: "ITM" | "ATM" | "OTM";
  putMoneyness: "ITM" | "ATM" | "OTM";
  callProbItm: number;
  putProbItm: number;
  probTouch: number;
  callBreakeven: number;
  putBreakeven: number;
};

const TREE_STEPS = 250;

export default function OptionsPanelInstitutional({ symbol }: Props) {
  const { data: quote, isLoading } = useQuote(symbol);
  const { data: fundamentals } = useFundamentals(symbol);
  const { data: history } = useOHLCV(symbol, "6M", "1d");
  const { data: yieldCurveData } = useYieldCurve();

  const [expiryDays, setExpiryDays] = useState(30);
  const [volatilityPct, setVolatilityPct] = useState(25);
  const [riskFreeRatePct, setRiskFreeRatePct] = useState(5);
  const [dividendYieldPct, setDividendYieldPct] = useState(0);
  const [exerciseStyle, setExerciseStyle] = useState<ExerciseStyle>("european");
  const [metricView, setMetricView] = useState<MetricView>("greeks");
  const [dataMode, setDataMode] = useState<"theoretical" | "live">("theoretical");
  const [dividendMode, setDividendMode] = useState<DividendMode>("continuous");
  const [discreteDividends, setDiscreteDividends] = useState<DiscreteDividend[]>([]);
  const [cashDividendAmount, setCashDividendAmount] = useState(0);
  const [cashDividendDays, setCashDividendDays] = useState(15);
  const [ivTouched, setIvTouched] = useState(false);
  const [qTouched, setQTouched] = useState(false);
  const [rateTouched, setRateTouched] = useState(false);
  const [payoffStrike, setPayoffStrike] = useState<number | null>(null);
  const [payoffIsCall, setPayoffIsCall] = useState(true);
  const [payoffIsLong, setPayoffIsLong] = useState(true);
  const [strikes, setStrikes] = useState<number[]>([]);
  const [strikesTouched, setStrikesTouched] = useState(false);
  const [auditTarget, setAuditTarget] = useState<AuditTarget | null>(null);
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const spot = quote?.price ?? 100;
  const currencyCode = quote?.currency || inferCurrencyFromSymbol(symbol);
  const currencySymbol = getCurrencyInfo(currencyCode).symbol;
  const T = expiryDays / 365;

  const autoStrikes = useMemo(() => {
    if (!spot) return [];
    let step = 5;
    if (spot < 15) step = 0.5;
    else if (spot < 50) step = 1;
    else if (spot < 200) step = 5;
    else if (spot < 500) step = 10;
    else if (spot < 2000) step = 25;
    else if (spot < 10000) step = 100;
    else step = 500;

    const centerStrike = Math.round(spot / step) * step;
    return Array.from({ length: 11 }, (_, i) => centerStrike + (i - 5) * step).filter((strike) => strike > 0);
  }, [spot]);

  useEffect(() => {
    if (!strikesTouched && autoStrikes.length > 0) setStrikes(autoStrikes);
  }, [autoStrikes, strikesTouched]);

  useEffect(() => {
    setStrikesTouched(false);
    setIvTouched(false);
    setQTouched(false);
    setRateTouched(false);
    setDiscreteDividends([]);
    setDividendMode("continuous");
    setAuditTarget(null);
  }, [symbol]);

  const atmStrike = useMemo(() => {
    if (strikes.length === 0) return null;
    return strikes.reduce((closest, strike) => Math.abs(strike - spot) < Math.abs(closest - spot) ? strike : closest, strikes[0]);
  }, [strikes, spot]);

  useEffect(() => {
    if (atmStrike == null) return;
    setPayoffStrike(atmStrike);
    setAuditTarget((current) => current ?? { strike: atmStrike, isCall: true });
  }, [atmStrike]);

  const realizedVolPct = useMemo(() => {
    const closes = history?.bars?.map((bar) => bar.close) ?? [];
    return realizedVolatilityPct(closes.slice(-126));
  }, [history]);

  const volatilitySource: VolatilitySource = ivTouched
    ? "custom"
    : realizedVolPct != null
      ? "realized_proxy"
      : "fallback";

  useEffect(() => {
    if (ivTouched) return;
    if (realizedVolPct != null && Number.isFinite(realizedVolPct)) {
      setVolatilityPct(Math.max(5, Math.min(150, Number(realizedVolPct.toFixed(2)))));
    } else {
      // Grounded fallback. We intentionally do not infer volatility from P/E.
      setVolatilityPct(25);
    }
  }, [realizedVolPct, ivTouched, symbol]);

  useEffect(() => {
    if (qTouched) return;
    const liveYield = fundamentals?.dividendYield;
    setDividendYieldPct(liveYield != null && Number.isFinite(liveYield) ? Math.max(0, Number(liveYield.toFixed(2))) : 0);
  }, [fundamentals, qTouched, symbol]);

  const interpolatedRate = useMemo(() => {
    if (currencyCode !== "USD") return null;
    return interpolateYieldCurveRate(yieldCurveData?.curve ?? [], expiryDays);
  }, [currencyCode, expiryDays, yieldCurveData]);

  useEffect(() => {
    if (rateTouched || currencyCode !== "USD") return;
    if (interpolatedRate?.ratePercent != null) {
      setRiskFreeRatePct(Number(interpolatedRate.ratePercent.toFixed(3)));
    }
  }, [currencyCode, interpolatedRate, rateTouched]);

  const activeCashDividends = useMemo(
    () => dividendMode === "continuous" ? [] : discreteDividends.filter((d) => d.timeYears <= T),
    [discreteDividends, dividendMode, T]
  );
  const activeDividendYield = dividendMode === "cash" ? 0 : dividendYieldPct / 100;
  const r = riskFreeRatePct / 100;
  const v = volatilityPct / 100;

  const chain = useMemo<ChainRow[]>(() => {
    if (!spot || strikes.length === 0) return [];
    const price = (K: number, isCall: boolean): OptionGreeks => exerciseStyle === "american"
      ? americanGreeks(spot, K, T, r, activeDividendYield, v, isCall, TREE_STEPS, activeCashDividends)
      : blackScholesMerton(spot, K, T, r, activeDividendYield, v, isCall, activeCashDividends);

    return strikes.map((strike) => {
      const call = price(strike, true);
      const put = price(strike, false);
      return {
        strike,
        call,
        put,
        callIntrinsic: intrinsicValue(spot, strike, true),
        putIntrinsic: intrinsicValue(spot, strike, false),
        callMoneyness: moneyness(spot, strike, true),
        putMoneyness: moneyness(spot, strike, false),
        callProbItm: probabilityITM(spot, strike, T, r, activeDividendYield, v, true, activeCashDividends),
        putProbItm: probabilityITM(spot, strike, T, r, activeDividendYield, v, false, activeCashDividends),
        probTouch: probabilityOfTouch(spot, strike, T, r, activeDividendYield, v, activeCashDividends),
        callBreakeven: breakeven(strike, call.price, true),
        putBreakeven: breakeven(strike, put.price, false),
      };
    });
  }, [spot, strikes, exerciseStyle, T, r, activeDividendYield, v, activeCashDividends]);

  const moveMetrics = useMemo(() => {
    if (atmStrike == null) return null;
    const row = chain.find((item) => item.strike === atmStrike);
    return row ? optionMoveMetrics(spot, v, T, row.call.price, row.put.price) : null;
  }, [atmStrike, chain, spot, v, T]);

  const gridValidation = useMemo(() => {
    if (exerciseStyle !== "european" || chain.length < 3) return null;
    return validateEuropeanOptionGrid(
      chain.map(({ strike, call, put }) => ({ strike, call, put })),
      spot,
      T,
      r,
      activeDividendYield,
      activeCashDividends,
      1e-4
    );
  }, [exerciseStyle, chain, spot, T, r, activeDividendYield, activeCashDividends]);

  const rateSource = useMemo(() => {
    if (rateTouched) return `Manual ${currencyCode} rate`;
    if (currencyCode === "USD" && interpolatedRate?.ratePercent != null) {
      const labels = interpolatedRate.lowerLabel === interpolatedRate.upperLabel
        ? interpolatedRate.lowerLabel
        : `${interpolatedRate.lowerLabel}-${interpolatedRate.upperLabel}`;
      return `USD Treasury curve · ${labels ?? "maturity"} · ${interpolatedRate.method}`;
    }
    return `Manual ${currencyCode} rate · no native curve connected`;
  }, [currencyCode, interpolatedRate, rateTouched]);

  const audit = useMemo<OptionCalculationAudit | null>(() => {
    if (!auditTarget) return null;
    return buildOptionCalculationAudit({
      spot,
      strike: auditTarget.strike,
      timeYears: T,
      rate: r,
      dividendYield: activeDividendYield,
      volatility: v,
      isCall: auditTarget.isCall,
      exerciseStyle,
      discreteDividends: activeCashDividends,
      treeSteps: TREE_STEPS,
      volatilitySource,
      rateSource,
      rateAsOf: interpolatedRate?.asOf ?? null,
    });
  }, [auditTarget, spot, T, r, activeDividendYield, v, exerciseStyle, activeCashDividends, volatilitySource, rateSource, interpolatedRate]);

  const payoffData = useMemo(() => {
    if (payoffStrike == null || !spot) return [];
    const row = chain.find((item) => item.strike === payoffStrike);
    if (!row) return [];
    const premium = payoffIsCall ? row.call.price : row.put.price;
    const lo = spot * 0.5;
    const hi = spot * 1.5;
    return Array.from({ length: 81 }, (_, index) => {
      const underlying = lo + ((hi - lo) * index) / 80;
      const intrinsicAtExpiry = payoffIsCall ? Math.max(0, underlying - payoffStrike) : Math.max(0, payoffStrike - underlying);
      const raw = intrinsicAtExpiry - premium;
      return { price: Number(underlying.toFixed(2)), pnl: Number((payoffIsLong ? raw : -raw).toFixed(4)) };
    });
  }, [chain, payoffStrike, payoffIsCall, payoffIsLong, spot]);

  const payoffBreakeven = useMemo(() => {
    if (payoffStrike == null) return null;
    const row = chain.find((item) => item.strike === payoffStrike);
    if (!row) return null;
    return payoffIsCall ? row.callBreakeven : row.putBreakeven;
  }, [chain, payoffStrike, payoffIsCall]);

  const editStrike = (index: number, value: number) => {
    setStrikesTouched(true);
    setStrikes((previous) => previous.map((strike, i) => i === index ? value : strike));
  };

  const commitStrikeOrder = () => setStrikes((previous) => [...previous].sort((a, b) => a - b));
  const addStrike = () => {
    setStrikesTouched(true);
    setStrikes((previous) => {
      if (previous.length === 0) return [Math.round(spot)];
      const step = previous.length > 1 ? previous.at(-1)! - previous.at(-2)! : Math.max(1, Math.round(spot * 0.02));
      return [...previous, previous.at(-1)! + (step || 1)];
    });
  };
  const removeStrike = (index: number) => {
    if (strikes.length <= 1) return;
    setStrikesTouched(true);
    setStrikes((previous) => previous.filter((_, i) => i !== index));
  };

  const addCashDividend = () => {
    if (!(cashDividendAmount > 0) || !(cashDividendDays > 0)) return;
    setDiscreteDividends((previous) => [
      ...previous,
      { amount: cashDividendAmount, timeYears: cashDividendDays / 365, source: "manual cash-dividend assumption" },
    ].sort((a, b) => a.timeYears - b.timeYears));
    setCashDividendAmount(0);
  };

  const buildCsvOrTsv = (delimiter: string) => {
    const headers = [
      "Strike", "Call Theoretical", "Call Delta", "Call Gamma", "Call Theta/day", "Call Vega/1volpt", "Call Rho/100bp",
      "Put Theoretical", "Put Delta", "Put Gamma", "Put Theta/day", "Put Vega/1volpt", "Put Rho/100bp",
    ];
    const lines = [headers.join(delimiter)];
    for (const row of chain) {
      lines.push([
        row.strike,
        row.call.price.toFixed(6), row.call.delta.toFixed(6), row.call.gamma.toFixed(8), row.call.theta.toFixed(6), row.call.vega.toFixed(6), row.call.rho.toFixed(6),
        row.put.price.toFixed(6), row.put.delta.toFixed(6), row.put.gamma.toFixed(8), row.put.theta.toFixed(6), row.put.vega.toFixed(6), row.put.rho.toFixed(6),
      ].join(delimiter));
    }
    return lines.join("\n");
  };

  const handleCopyTable = async () => {
    try {
      await navigator.clipboard.writeText(buildCsvOrTsv("\t"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Browser clipboard permission may be disabled in desktop/web contexts.
    }
  };

  const exportPayload = () => ({
    symbol,
    currency: currencyCode,
    spot,
    expiryDays,
    exerciseStyle,
    volatility: { valuePct: volatilityPct, source: volatilitySource },
    riskFreeRate: { valuePct: riskFreeRatePct, source: rateSource, asOf: interpolatedRate?.asOf ?? null },
    dividends: { mode: dividendMode, continuousYieldPct: dividendYieldPct, cashSchedule: activeCashDividends },
    moveMetrics,
    validation: gridValidation,
    chain,
  });

  const handleExportXlsx = () => {
    const header = [
      "Strike", "Call Theor.", "Call Intrinsic", "Call Delta", "Call Gamma", "Call Theta/day", "Call Vega/1volpt", "Call Rho/100bp",
      "Put Theor.", "Put Intrinsic", "Put Delta", "Put Gamma", "Put Theta/day", "Put Vega/1volpt", "Put Rho/100bp",
    ];
    const rows = chain.map((row) => [
      row.strike, row.call.price, row.callIntrinsic, row.call.delta, row.call.gamma, row.call.theta, row.call.vega, row.call.rho,
      row.put.price, row.putIntrinsic, row.put.delta, row.put.gamma, row.put.theta, row.put.vega, row.put.rho,
    ]);
    exportWorkbook(`${symbol}_options_audited.xlsx`, [{ name: "Audited Options", rows: [header, ...rows] }]);
  };

  const handleExportCsv = () => {
    const blob = new Blob([buildCsvOrTsv(",")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${symbol}_options_audited.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${symbol}_options_audited.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!exportOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [exportOpen]);

  const modeToggle = (
    <div className="flex border border-border/60 text-[8px] font-terminal tracking-widest overflow-hidden">
      <button onClick={() => setDataMode("theoretical")} className={`px-2 py-1 ${dataMode === "theoretical" ? "bg-emerald-500/15 text-emerald-400" : "text-muted-foreground hover:text-foreground"}`}>THEORETICAL PRICER</button>
      <button onClick={() => setDataMode("live")} className={`px-2 py-1 border-l border-border/60 ${dataMode === "live" ? "bg-emerald-500/15 text-emerald-400" : "text-muted-foreground hover:text-foreground"}`}>LSE LIVE CHAIN</button>
    </div>
  );

  if (dataMode === "live") {
    return (
      <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-[#070707] shrink-0">
          <span className="font-terminal text-[8px] text-muted-foreground uppercase tracking-widest">Data Source</span>
          {modeToggle}
        </div>
        <div className="flex-1 overflow-hidden"><LiveLseOptionsChain symbol={symbol} /></div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full p-4 space-y-4 bg-[#050505] flex flex-col justify-center animate-pulse">
        <Skeleton className="h-8 w-1/3 bg-border" />
        <Skeleton className="h-64 w-full bg-border" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Activity className="w-4 h-4 text-[hsl(38,95%,55%)]" />
          <span className="font-terminal text-[10px] tracking-widest text-muted-foreground uppercase">
            {exerciseStyle === "american" ? `AMERICAN · CRR ${TREE_STEPS}-STEP` : "EUROPEAN · BLACK-SCHOLES-MERTON"} OPTIONS GRID
          </span>
          <span className="font-terminal text-[10px] text-foreground font-bold">{symbol}</span>
          <span className="font-terminal text-[9px] text-cyan-400">Spot: {currencySymbol}{formatPrice(spot)}</span>
          {moveMetrics && (
            <>
              <span className="font-terminal text-[9px] text-muted-foreground">
                Straddle-Implied Move ({expiryDays}d): <strong className="text-foreground">±{currencySymbol}{moveMetrics.straddleMove.toFixed(2)}</strong> ({(moveMetrics.straddleMovePct * 100).toFixed(2)}%)
              </span>
              <span className="font-terminal text-[9px] text-muted-foreground">
                1σ: <strong className="text-cyan-300">±{currencySymbol}{moveMetrics.oneSigmaMove.toFixed(2)}</strong> ({(moveMetrics.oneSigmaMovePct * 100).toFixed(2)}%)
              </span>
            </>
          )}
          {gridValidation && (
            <span title={gridValidation.issues.join(" ") || "Put-call parity, bounds, monotonicity and convexity passed."} className={`flex items-center gap-1 font-terminal text-[8px] ${gridValidation.passed ? "text-emerald-400" : "text-red-400"}`}>
              <ShieldCheck className="w-3 h-3" /> {gridValidation.passed ? "MODEL CHECKS PASS" : "MODEL CHECK WARNING"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {modeToggle}
          <TogglePair left="EUROPEAN" right="AMERICAN" leftActive={exerciseStyle === "european"} onLeft={() => setExerciseStyle("european")} onRight={() => setExerciseStyle("american")} tone="amber" />
          <TogglePair left="GREEKS" right="VALUE & PROB." leftActive={metricView === "greeks"} onLeft={() => setMetricView("greeks")} onRight={() => setMetricView("value")} tone="cyan" />
          <TerminalButton onClick={addStrike}><Plus className="w-3 h-3" /> STRIKE</TerminalButton>
          <TerminalButton onClick={handleCopyTable}>{copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />} {copied ? "COPIED" : "COPY"}</TerminalButton>
          <div ref={exportRef} className="relative">
            <TerminalButton onClick={() => setExportOpen((open) => !open)}><Download className="w-3 h-3" /> EXPORT <ChevronDown className="w-2.5 h-2.5" /></TerminalButton>
            {exportOpen && (
              <div className="absolute right-0 mt-1 z-30 border border-border bg-[#0a0a0a] shadow-lg min-w-[110px]">
                <ExportButton label="XLSX" action={() => { handleExportXlsx(); setExportOpen(false); }} />
                <ExportButton label="CSV" action={() => { handleExportCsv(); setExportOpen(false); }} />
                <ExportButton label="JSON + AUDIT" action={() => { handleExportJson(); setExportOpen(false); }} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
        <div className="flex-1 overflow-auto scrollbar-thin">
          <div className="p-4">
            <div className="min-w-[980px] border border-border">
              <div className="grid grid-cols-[repeat(13,minmax(0,1fr))] border-b border-border text-center font-terminal text-[8px] font-bold tracking-widest bg-[#070707] text-muted-foreground divide-x divide-border">
                <div className="col-span-6 py-1 text-emerald-500 bg-emerald-950/10">CALL OPTIONS</div>
                <div className="py-1 bg-[#090909]">STRIKE</div>
                <div className="col-span-6 py-1 text-red-500 bg-red-950/10">PUT OPTIONS</div>
              </div>
              <div className="grid grid-cols-[repeat(13,minmax(0,1fr))] border-b border-border text-center font-terminal text-[7px] text-muted-foreground bg-[#0a0a0a] py-1 divide-x divide-border">
                {metricView === "greeks" ? (
                  <>
                    <div>THEOR.</div><div>DELTA Δ</div><div>GAMMA Γ</div><div>THETA / DAY</div><div>VEGA / 1 VOL PT</div><div>RHO / 100BP</div>
                    <div className="text-foreground font-bold font-mono">K</div>
                    <div>THEOR.</div><div>DELTA Δ</div><div>GAMMA Γ</div><div>THETA / DAY</div><div>VEGA / 1 VOL PT</div><div>RHO / 100BP</div>
                  </>
                ) : (
                  <>
                    <div>THEOR.</div><div>INTRINSIC</div><div>EXTRINSIC</div><div>PROB ITM · RN</div><div>PROB TOUCH · RN</div><div>B/E</div>
                    <div className="text-foreground font-bold font-mono">K</div>
                    <div>THEOR.</div><div>INTRINSIC</div><div>EXTRINSIC</div><div>PROB ITM · RN</div><div>PROB TOUCH · RN</div><div>B/E</div>
                  </>
                )}
              </div>

              {chain.map((row, rowIndex) => {
                const callItm = spot > row.strike;
                const putItm = spot < row.strike;
                const isAtm = row.strike === atmStrike;
                return (
                  <div key={`${row.strike}-${rowIndex}`} className={`group grid grid-cols-[repeat(13,minmax(0,1fr))] border-b text-center font-terminal text-[10px] font-semibold font-mono divide-x divide-border/60 hover:bg-white/[1%] ${isAtm ? "border-y-2 border-amber-500/70 bg-amber-500/[4%]" : "border-border"}`}>
                    {metricView === "greeks" ? (
                      <>
                        <PriceCell value={row.call.price} currencySymbol={currencySymbol} active={callItm} tone="call" onClick={() => setAuditTarget({ strike: row.strike, isCall: true })} />
                        <MetricCell value={row.call.delta.toFixed(3)} active={callItm} />
                        <MetricCell value={row.call.gamma.toFixed(4)} active={callItm} />
                        <MetricCell value={row.call.theta.toFixed(3)} active={callItm} />
                        <MetricCell value={row.call.vega.toFixed(3)} active={callItm} />
                        <MetricCell value={row.call.rho.toFixed(3)} active={callItm} />
                      </>
                    ) : (
                      <>
                        <PriceCell value={row.call.price} currencySymbol={currencySymbol} active={callItm} tone="call" onClick={() => setAuditTarget({ strike: row.strike, isCall: true })} />
                        <MetricCell value={`${currencySymbol}${row.callIntrinsic.toFixed(2)}`} active={callItm} />
                        <MetricCell value={`${currencySymbol}${Math.max(0, row.call.price - row.callIntrinsic).toFixed(2)}`} active={callItm} />
                        <MetricCell value={`${(row.callProbItm * 100).toFixed(1)}%`} active={callItm} />
                        <MetricCell value={`${(row.probTouch * 100).toFixed(1)}%`} active={callItm} />
                        <MetricCell value={`${currencySymbol}${row.callBreakeven.toFixed(2)}`} active={callItm} />
                      </>
                    )}

                    <div className="relative p-1 font-bold text-foreground bg-[#0a0a0a] flex items-center justify-center font-mono">
                      <input
                        type="number"
                        value={row.strike}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next) && next > 0) editStrike(rowIndex, next);
                        }}
                        onBlur={commitStrikeOrder}
                        onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
                        className={`w-full bg-transparent text-center font-mono font-bold outline-none focus:bg-white/5 ${isAtm ? "text-amber-400" : "text-foreground"}`}
                      />
                      <button onClick={() => removeStrike(rowIndex)} className="absolute right-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
                    </div>

                    {metricView === "greeks" ? (
                      <>
                        <PriceCell value={row.put.price} currencySymbol={currencySymbol} active={putItm} tone="put" onClick={() => setAuditTarget({ strike: row.strike, isCall: false })} />
                        <MetricCell value={row.put.delta.toFixed(3)} active={putItm} />
                        <MetricCell value={row.put.gamma.toFixed(4)} active={putItm} />
                        <MetricCell value={row.put.theta.toFixed(3)} active={putItm} />
                        <MetricCell value={row.put.vega.toFixed(3)} active={putItm} />
                        <MetricCell value={row.put.rho.toFixed(3)} active={putItm} />
                      </>
                    ) : (
                      <>
                        <PriceCell value={row.put.price} currencySymbol={currencySymbol} active={putItm} tone="put" onClick={() => setAuditTarget({ strike: row.strike, isCall: false })} />
                        <MetricCell value={`${currencySymbol}${row.putIntrinsic.toFixed(2)}`} active={putItm} />
                        <MetricCell value={`${currencySymbol}${Math.max(0, row.put.price - row.putIntrinsic).toFixed(2)}`} active={putItm} />
                        <MetricCell value={`${(row.putProbItm * 100).toFixed(1)}%`} active={putItm} />
                        <MetricCell value={`${(row.probTouch * 100).toFixed(1)}%`} active={putItm} />
                        <MetricCell value={`${currencySymbol}${row.putBreakeven.toFixed(2)}`} active={putItm} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 border border-border bg-[#070707]">
              <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-b border-border/60">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">PAYOFF AT EXPIRATION</span>
                </div>
                <div className="flex items-center gap-2 font-terminal text-[8px]">
                  <select value={payoffStrike ?? ""} onChange={(event) => setPayoffStrike(Number(event.target.value))} className="bg-[#0a0a0a] border border-border/60 text-foreground px-1.5 py-1 tracking-widest">
                    {strikes.map((strike) => <option key={strike} value={strike}>K={strike}{strike === atmStrike ? " (ATM)" : ""}</option>)}
                  </select>
                  <TogglePair left="LONG" right="SHORT" leftActive={payoffIsLong} onLeft={() => setPayoffIsLong(true)} onRight={() => setPayoffIsLong(false)} tone="green" />
                  <TogglePair left="CALL" right="PUT" leftActive={payoffIsCall} onLeft={() => setPayoffIsCall(true)} onRight={() => setPayoffIsCall(false)} tone="cyan" />
                  {payoffBreakeven != null && <span className="text-muted-foreground">B/E: <strong className="text-foreground">{currencySymbol}{payoffBreakeven.toFixed(2)}</strong></span>}
                </div>
              </div>
              <div className="h-56 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={payoffData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis dataKey="price" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(value) => value.toFixed(0)} />
                    <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(value) => value.toFixed(0)} />
                    <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid hsl(var(--border))", fontSize: 10 }} formatter={(value: number) => [`${currencySymbol}${value.toFixed(2)}`, "P&L"]} labelFormatter={(value) => `${currencySymbol}${value}`} />
                    <ReferenceLine y={0} stroke="hsl(var(--border))" />
                    <ReferenceLine x={spot} stroke="hsl(186,80%,55%)" strokeDasharray="4 2" label={{ value: "SPOT", fontSize: 8, fill: "hsl(186,80%,55%)" }} />
                    {payoffStrike != null && <ReferenceLine x={payoffStrike} stroke="hsl(38,95%,55%)" strokeDasharray="4 2" label={{ value: "K", fontSize: 8, fill: "hsl(38,95%,55%)" }} />}
                    <Line type="monotone" dataKey="pnl" stroke={payoffIsLong ? "hsl(160,80%,45%)" : "hsl(0,80%,55%)"} strokeWidth={1.75} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <AdvancedRatesDerivativesRunner
              title="ADVANCED OPTION ANALYTICS · MANUAL QUOTES / EDITABLE LEGS"
              modelPaths={[
                "derivatives/black-scholes-greeks",
                "derivatives/implied-volatility",
                "derivatives/surface-arbitrage",
                "derivatives/local-volatility",
                "derivatives/portfolio-greeks",
                "derivatives/futures-basis",
                "derivatives/strategy-payoff",
              ]}
            />
          </div>
        </div>

        <aside className="w-full xl:w-[330px] border-t xl:border-t-0 xl:border-l border-border bg-[#060606] shrink-0 overflow-y-auto scrollbar-thin">
          <div className="p-4 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-muted-foreground"><Sliders className="w-3.5 h-3.5 text-amber-400" /><span className="font-terminal text-[9px] tracking-widest font-bold">VALUATION INPUTS</span></div>
              <button onClick={() => { setIvTouched(false); setQTouched(false); setRateTouched(false); }} title="Return volatility, dividend yield and rate to connected/default sources" className="text-muted-foreground hover:text-amber-400"><RefreshCw className="w-3 h-3" /></button>
            </div>

            <ParameterControl label="TIME TO EXPIRY (T)" value={expiryDays} min={1} max={3650} step={1} suffix="days" sliderMin={5} sliderMax={365} onChange={(next) => setExpiryDays(Math.max(1, next))} footerLeft="5d" footerCenter={`ACT/365 · ${T.toFixed(4)}y`} footerRight="1y" />

            <ParameterControl
              label="VOLATILITY INPUT (σ)"
              value={volatilityPct}
              min={0.1}
              max={500}
              step={0.1}
              suffix="%"
              sliderMin={5}
              sliderMax={150}
              onChange={(next) => { setVolatilityPct(Math.max(0.1, next)); setIvTouched(true); }}
              footerLeft="5%"
              footerCenter={volatilitySource === "realized_proxy" ? `SOURCE · realized 6M ${realizedVolPct?.toFixed(2)}%` : volatilitySource === "custom" ? "SOURCE · custom override" : "SOURCE · 25% fallback"}
              footerRight="150%"
            />

            <div className="space-y-2">
              <div className="font-terminal text-[9px] text-muted-foreground">DIVIDEND MODEL</div>
              <div className="grid grid-cols-3 border border-border/60 font-terminal text-[7px] tracking-wider">
                {(["continuous", "cash", "both"] as DividendMode[]).map((mode) => (
                  <button key={mode} onClick={() => setDividendMode(mode)} className={`py-1 border-r last:border-r-0 border-border/60 uppercase ${dividendMode === mode ? "bg-amber-500/15 text-amber-400" : "text-muted-foreground hover:text-foreground"}`}>{mode === "cash" ? "CASH DIVS" : mode}</button>
                ))}
              </div>
            </div>

            {dividendMode !== "cash" && (
              <ParameterControl label="CONTINUOUS DIVIDEND YIELD (q)" value={dividendYieldPct} min={0} max={50} step={0.01} suffix="%" sliderMin={0} sliderMax={10} onChange={(next) => { setDividendYieldPct(Math.max(0, next)); setQTouched(true); }} footerLeft="0%" footerCenter={qTouched ? "SOURCE · custom" : `SOURCE · fundamentals ${fundamentals?.dividendYield?.toFixed(2) ?? "0.00"}%`} footerRight="10%" />
            )}

            {dividendMode !== "continuous" && (
              <div className="space-y-2 border border-border/70 p-2 bg-[#080808]">
                <div className="font-terminal text-[8px] text-muted-foreground tracking-wider">DISCRETE CASH DIVIDENDS · PER SHARE</div>
                <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
                  <input type="number" min={0} step={0.01} value={cashDividendAmount} onChange={(event) => setCashDividendAmount(Number(event.target.value))} placeholder="Amount" className="min-w-0 bg-[#050505] border border-border/60 font-mono text-[9px] px-1 py-1 outline-none" />
                  <input type="number" min={1} step={1} value={cashDividendDays} onChange={(event) => setCashDividendDays(Number(event.target.value))} placeholder="Days" className="min-w-0 bg-[#050505] border border-border/60 font-mono text-[9px] px-1 py-1 outline-none" />
                  <button onClick={addCashDividend} className="border border-border/60 px-2 text-amber-400 hover:bg-amber-500/10"><Plus className="w-3 h-3" /></button>
                </div>
                {discreteDividends.length === 0 ? (
                  <div className="font-terminal text-[7px] text-muted-foreground">No cash-dividend schedule. Add amount + days-to-ex-date.</div>
                ) : discreteDividends.map((dividend, index) => (
                  <div key={`${dividend.timeYears}-${index}`} className="flex justify-between items-center font-terminal text-[8px] text-muted-foreground">
                    <span>{currencySymbol}{dividend.amount.toFixed(2)} · ex in {(dividend.timeYears * 365).toFixed(0)}d {dividend.timeYears > T ? "· after expiry" : ""}</span>
                    <button onClick={() => setDiscreteDividends((previous) => previous.filter((_, i) => i !== index))} className="hover:text-red-400"><X className="w-3 h-3" /></button>
                  </div>
                ))}
                <div className="font-terminal text-[7px] text-muted-foreground">Pricing method: PV spot adjustment (European); escrowed/prepaid-forward CRR tree (American).</div>
              </div>
            )}

            <ParameterControl
              label={`RISK-FREE RATE (r) · ${currencyCode}`}
              value={riskFreeRatePct}
              min={-10}
              max={50}
              step={0.01}
              suffix="%"
              sliderMin={0}
              sliderMax={15}
              onChange={(next) => { setRiskFreeRatePct(next); setRateTouched(true); }}
              footerLeft="curve-aware"
              footerCenter={rateSource}
              footerRight={interpolatedRate?.asOf ? `as of ${interpolatedRate.asOf}` : "manual"}
            />
            {currencyCode === "USD" && interpolatedRate?.ratePercent != null && rateTouched && (
              <button onClick={() => { setRateTouched(false); setRiskFreeRatePct(Number(interpolatedRate.ratePercent!.toFixed(3))); }} className="w-full border border-amber-500/30 text-amber-400 font-terminal text-[8px] py-1 hover:bg-amber-500/10">USE MATURITY-MATCHED USD CURVE · {interpolatedRate.ratePercent.toFixed(3)}%</button>
            )}

            <div className="border border-border/80 bg-[#080808] p-3 text-[8px] font-terminal text-muted-foreground leading-normal space-y-1.5">
              <div className="flex items-center gap-1 text-[9px] text-foreground font-bold border-b border-border/60 pb-1"><Info className="w-3.5 h-3.5 text-amber-500" />VALUATION SUMMARY</div>
              <p>{exerciseStyle === "american" ? `American pricing uses a ${TREE_STEPS}-step Cox-Ross-Rubinstein tree with node-by-node early exercise. Greeks are central finite differences on the same engine.` : "European pricing uses dividend-adjusted Black-Scholes-Merton. Continuous-yield-only Greeks are analytical; cash-dividend Greeks use finite differences."}</p>
              <p><strong className="text-foreground">Move semantics:</strong> straddle-implied move = ATM call + put premium. 1σ move = S·σ·√T. They are intentionally shown separately.</p>
              <p><strong className="text-foreground">Probabilities:</strong> ITM and touch are risk-neutral model probabilities, not physical forecasts.</p>
            </div>

            {audit && <AuditCard audit={audit} currencySymbol={currencySymbol} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function TerminalButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-amber-500/50 hover:bg-amber-500/10 transition-colors">{children}</button>;
}

function ExportButton({ label, action }: { label: string; action: () => void }) {
  return <button onClick={action} className="block w-full text-left px-3 py-1.5 font-terminal text-[8px] tracking-widest text-muted-foreground hover:text-foreground hover:bg-white/5">{label}</button>;
}

function TogglePair({ left, right, leftActive, onLeft, onRight, tone }: { left: string; right: string; leftActive: boolean; onLeft: () => void; onRight: () => void; tone: "amber" | "cyan" | "green" }) {
  const activeClass = tone === "amber" ? "bg-amber-500/15 text-amber-400" : tone === "cyan" ? "bg-cyan-500/15 text-cyan-400" : "bg-emerald-500/15 text-emerald-400";
  return (
    <div className="flex border border-border/60 text-[8px] font-terminal tracking-widest overflow-hidden">
      <button onClick={onLeft} className={`px-2 py-1 ${leftActive ? activeClass : "text-muted-foreground hover:text-foreground"}`}>{left}</button>
      <button onClick={onRight} className={`px-2 py-1 border-l border-border/60 ${!leftActive ? activeClass : "text-muted-foreground hover:text-foreground"}`}>{right}</button>
    </div>
  );
}

function MetricCell({ value, active }: { value: string; active: boolean }) {
  return <div className={`p-1.5 tabular-nums ${active ? "bg-white/[2%] text-foreground" : "text-muted-foreground"}`}>{value}</div>;
}

function PriceCell({ value, currencySymbol, active, tone, onClick }: { value: number; currencySymbol: string; active: boolean; tone: "call" | "put"; onClick: () => void }) {
  const activeClass = tone === "call" ? "bg-emerald-950/10 text-up" : "bg-red-950/10 text-down";
  return (
    <button onClick={onClick} title="Open calculation audit" className={`p-1.5 tabular-nums font-bold text-center hover:ring-1 hover:ring-inset hover:ring-amber-500/40 ${active ? activeClass : "text-foreground"}`}>
      {currencySymbol}{value.toFixed(2)}
    </button>
  );
}

function ParameterControl({ label, value, min, max, step, suffix, sliderMin, sliderMax, onChange, footerLeft, footerCenter, footerRight }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  sliderMin: number;
  sliderMax: number;
  onChange: (value: number) => void;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 font-terminal text-[9px]">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} className="w-16 bg-[#0a0a0a] border border-border/60 text-foreground font-mono font-bold text-right px-1 py-0.5 outline-none focus:border-amber-500/50" />
          <span className="text-foreground">{suffix}</span>
        </div>
      </div>
      <input type="range" min={sliderMin} max={sliderMax} step={step} value={Math.max(sliderMin, Math.min(sliderMax, value))} onChange={(event) => onChange(Number(event.target.value))} className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500" />
      <div className="grid grid-cols-[auto_1fr_auto] gap-2 text-[7px] font-terminal text-muted-foreground">
        <span>{footerLeft}</span><span className="text-center truncate" title={footerCenter}>{footerCenter}</span><span>{footerRight}</span>
      </div>
    </div>
  );
}

function AuditCard({ audit, currencySymbol }: { audit: OptionCalculationAudit; currencySymbol: string }) {
  const fmt = (value: number | null, digits = 6) => value == null ? "—" : Number.isFinite(value) ? value.toFixed(digits) : "—";
  return (
    <div className="border border-amber-500/25 bg-[#080808] p-3 font-terminal text-[8px] text-muted-foreground space-y-2">
      <div className="flex items-center justify-between border-b border-border/60 pb-1">
        <div className="flex items-center gap-1 text-foreground font-bold"><ShieldCheck className="w-3.5 h-3.5 text-amber-400" />CALCULATION AUDIT</div>
        <span className={audit.checks.withinNoArbitrageBounds ? "text-emerald-400" : "text-red-400"}>{audit.checks.withinNoArbitrageBounds ? "BOUNDS PASS" : "BOUNDS FAIL"}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <AuditLine label="Model" value={audit.model} />
        <AuditLine label="Instrument" value={`${audit.optionSide.toUpperCase()} · K ${audit.inputs.strike}`} />
        <AuditLine label="Spot" value={`${currencySymbol}${audit.inputs.spot.toFixed(4)}`} />
        <AuditLine label="ACT/365" value={`${audit.inputs.calendarDays.toFixed(2)}d · ${audit.inputs.timeYears.toFixed(6)}y`} />
        <AuditLine label="Vol" value={`${(audit.inputs.volatility * 100).toFixed(3)}% · ${audit.inputs.volatilitySource}`} />
        <AuditLine label="Rate" value={`${(audit.inputs.rate * 100).toFixed(3)}%`} />
        <AuditLine label="Div yield" value={`${(audit.inputs.dividendYield * 100).toFixed(3)}%`} />
        <AuditLine label="Cash div PV" value={`${currencySymbol}${audit.adjustments.discreteDividendPv.toFixed(4)}`} />
        <AuditLine label="Adj. spot" value={`${currencySymbol}${audit.adjustments.adjustedSpot.toFixed(4)}`} />
        <AuditLine label="Dividend method" value={audit.adjustments.dividendMethod} />
        <AuditLine label="d1" value={fmt(audit.intermediates.d1)} />
        <AuditLine label="d2" value={fmt(audit.intermediates.d2)} />
        <AuditLine label="N(d1)" value={fmt(audit.intermediates.nd1)} />
        <AuditLine label="N(d2)" value={fmt(audit.intermediates.nd2)} />
        {audit.intermediates.treeSteps != null && <AuditLine label="Tree steps" value={String(audit.intermediates.treeSteps)} />}
        <AuditLine label="Price" value={`${currencySymbol}${audit.output.price.toFixed(6)}`} strong />
      </div>
      <div className="border-t border-border/60 pt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <AuditLine label="Delta" value={audit.output.delta.toFixed(6)} />
        <AuditLine label="Gamma" value={audit.output.gamma.toFixed(8)} />
        <AuditLine label="Theta / day" value={audit.output.theta.toFixed(6)} />
        <AuditLine label="Vega / 1 vol pt" value={audit.output.vega.toFixed(6)} />
        <AuditLine label="Rho / 100bp" value={audit.output.rho.toFixed(6)} />
        <AuditLine label="Parity residual" value={audit.checks.putCallParityResidual == null ? "N/A · American" : audit.checks.putCallParityResidual.toExponential(2)} />
      </div>
      <div className="border-t border-border/60 pt-2 space-y-1">
        <div><span className="text-foreground">RATE LINEAGE</span> · {audit.inputs.rateSource}{audit.inputs.rateAsOf ? ` · ${audit.inputs.rateAsOf}` : ""}</div>
        <div><span className="text-foreground">CONVENTIONS</span> · {audit.conventions.dayCount} · continuous compounding · theta/day · vega/1 vol pt · rho/100bp</div>
        <div><span className="text-foreground">FORMULA</span> · {audit.exerciseStyle === "european" ? "C=S·e^-qT·N(d1)-K·e^-rT·N(d2); P=K·e^-rT·N(-d2)-S·e^-qT·N(-d1)" : "CRR backward induction: V=max(intrinsic, e^-rΔt[pVup+(1-p)Vdown])"}</div>
      </div>
    </div>
  );
}

function AuditLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="min-w-0"><span className="text-muted-foreground">{label}: </span><span className={`${strong ? "text-amber-300 font-bold" : "text-foreground"} break-words`}>{value}</span></div>;
}
