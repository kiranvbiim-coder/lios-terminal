import { useTerminalArtifactState, useTerminalArtifactContext } from "@/lib/terminalArtifactState";
import { useEffect, useMemo, useRef, useState, memo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Plus, X, Bell } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import DataStatusBadge from "@/components/data/DataStatusBadge";
import { formatPrice, pctClass } from "@/lib/finance";
import { getAllowedIntervals, normalizeComparisonSeries, supportsIntradayCharts, type ChartInterval } from "@/lib/chartSeries";
import { useOHLCV, useQuote, useNews } from "@/lib/useFinance";
import {
  computeSMA, computeEMA, computeRSI, computeMACD, computeBollingerBands, computeADX,
  computeDonchianChannel, detectBreakouts, detectSupportResistance,
} from "@/lib/technicalIndicators";
import AdvancedTradingChart, { type AdvancedChartEvent, type AdvancedChartPoint, type ChartDrawing } from "@/components/panels/AdvancedTradingChart";
import { getActiveScenario, subscribeScenarioUniverse, type TerminalScenario } from "@/lib/terminalScenarioUniverse";
import { loadChartWorkspacePreset, saveChartWorkspacePreset } from "@/lib/chartWorkspaceState";
import { CHART_INDICATOR_DEFAULTS, CHART_INDICATOR_REGISTRY, clampIndicatorParameter } from "@/lib/chartIndicatorRegistry";
import { createChartReceipt } from "@/lib/chartReceipt";
import { chartAlertTriggered, loadChartAlerts, saveChartAlerts, type ChartAlert, type ChartAlertOperator } from "@/lib/chartAlerts";
import { buildDynamicAnalyticsCatalog, buildQuantSeries } from "@shared/waveCContracts";
interface Props {
  symbol: string;
  onSymbol: (sym: string) => void;
}

const RANGES = ["1D", "5D", "1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y"] as const;
// Overlays draw directly on the price chart and can be combined freely.
const OVERLAYS = ["SMA20", "SMA50", "EMA12", "EMA26", "BB", "DONCHIAN", "SR"] as const;
const OVERLAY_LABELS: Record<(typeof OVERLAYS)[number], string> = {
  SMA20: "SMA 20", SMA50: "SMA 50", EMA12: "EMA 12", EMA26: "EMA 26",
  BB: "BOLLINGER", DONCHIAN: "DONCHIAN 20", SR: "SUPPORT/RESIST",
};
// Oscillators render as one sub-chart below the price panel -- only one
// makes sense to look at at a time, same reasoning as the old RSI toggle.
const OSCILLATORS = ["none", "RSI", "MACD", "ADX"] as const;
const CHART_TYPES = ["LINE", "CANDLE", "AREA"] as const;
const COMPARISON_COLORS = ["hsl(38,95%,55%)", "hsl(186,80%,55%)", "hsl(265,70%,65%)", "hsl(142,71%,55%)"];
const DYNAMIC_CHART_FIELDS = buildDynamicAnalyticsCatalog().filter((field) => field.numeric);

function loadDynamicSeries(symbol: string): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`lios.chart.fields.${symbol.trim().toUpperCase()}`) ?? "[]");
    const allowed = new Set(DYNAMIC_CHART_FIELDS.map((field) => field.id));
    return Array.isArray(parsed) ? [...new Set(parsed.filter((value): value is string => typeof value === "string" && allowed.has(value)))].slice(-24) : [];
  } catch { return []; }
}


function formatXAxisLabel(value: string, interval: ChartInterval) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (interval === "5m" || interval === "15m" || interval === "1h") {
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
}

function getAllowedRanges(interval: ChartInterval): ReadonlyArray<(typeof RANGES)[number]> {
  if (interval === "5m" || interval === "15m") return ["1D"];
  if (interval === "1h") return ["1D", "5D", "1M", "3M"];
  return [...RANGES];
}


function ChartPanel({ symbol, onSymbol }: Props) {
  const terminal = useTerminalArtifactContext();
  const symbolIsCryptoCandidate = symbol.toUpperCase().endsWith("-USD");
  const [range, setRange] = useTerminalArtifactState<typeof RANGES[number]>("chart.range", symbolIsCryptoCandidate ? "1D" : "1Y");
  const [interval, setInterval] = useTerminalArtifactState<ChartInterval>("chart.interval", symbolIsCryptoCandidate ? "5m" : "1d");
  const [overlays, setOverlays] = useTerminalArtifactState<Set<(typeof OVERLAYS)[number]>>("chart.overlays", new Set<(typeof OVERLAYS)[number]>(["SMA20"]));
  const [oscillator, setOscillator] = useTerminalArtifactState<(typeof OSCILLATORS)[number]>("chart.oscillator", "none");
  const [chartType, setChartType] = useTerminalArtifactState<typeof CHART_TYPES[number]>("chart.chartType", "LINE");
  const [symInput, setSymInput] = useTerminalArtifactState("chart.symInput", symbol);
  const [compareInput, setCompareInput] = useTerminalArtifactState("chart.compareInput", "");
  const [compareSymbols, setCompareSymbols] = useTerminalArtifactState<string[]>("chart.compareSymbols", []);
  const [indicatorParams, setIndicatorParams] = useTerminalArtifactState<Record<string, number>>("chart.indicatorParams", { ...CHART_INDICATOR_DEFAULTS });
  const [indicatorSettingsOpen, setIndicatorSettingsOpen] = useState(false);
  const [chartLayout, setChartLayout] = useTerminalArtifactState<1 | 2 | 4>("chart.chartLayout", 1);
  const [activeScenario, setActiveScenario] = useState<TerminalScenario | null>(() => terminal ? null : getActiveScenario());
  const [chartDrawings, setChartDrawings] = useState<ChartDrawing[]>([]);
  const [chartAlerts, setChartAlerts] = useTerminalArtifactState<ChartAlert[]>("chart.alerts", () => terminal ? [] : loadChartAlerts());
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [alertPrice, setAlertPrice] = useTerminalArtifactState("chart.alertPrice", "");
  const [alertOperator, setAlertOperator] = useTerminalArtifactState<ChartAlertOperator>("chart.alertOperator", "above");
  const [dynamicSeriesId, setDynamicSeriesId] = useTerminalArtifactState("chart.dynamicSeriesId", DYNAMIC_CHART_FIELDS[0]?.id ?? "");
  const [dynamicSeriesIds, setDynamicSeriesIds] = useTerminalArtifactState<string[]>("chart.dynamicSeriesIds", () => terminal ? [] : loadDynamicSeries(symbol));
  useEffect(() => { if (!terminal) return subscribeScenarioUniverse((_scenarios, active) => setActiveScenario(active)); }, []);
  const presetLoadedRef = useRef(false);

  const localIndexSymbol = useMemo(() => {
    const sym = symbol.toUpperCase();
    if (sym.endsWith(".T")) return { symbol: "^N225", label: "NIKKEI 225" };
    if (sym.endsWith(".HK")) return { symbol: "^HSI", label: "HANG SENG" };
    if (sym.endsWith(".NS") || sym.endsWith(".BO") || /^\d{6}\.BO$/.test(sym)) return { symbol: "^NSEI", label: "NIFTY 50" };
    if (sym.endsWith(".L")) return { symbol: "^FTSE", label: "FTSE 100" };
    if (sym.endsWith(".DE")) return { symbol: "^GDAXI", label: "DAX" };
    return null;
  }, [symbol]);

  const { data: quote } = useQuote(symbol);
  const { data: news = [] } = useNews(symbol);
  const isCrypto = quote?.exchange === "CRYPTO" || symbolIsCryptoCandidate;
  useEffect(() => { if (!terminal) saveChartAlerts(chartAlerts); }, [chartAlerts]);
  useEffect(() => {
    if (terminal?.readOnly) return;
    const currentPrice = quote?.price;
    if (typeof currentPrice !== "number" || !Number.isFinite(currentPrice)) return;
    const pending = chartAlerts.filter(alert => alert.symbol === symbol.toUpperCase() && !alert.lastTriggeredAt && chartAlertTriggered(alert, currentPrice));
    if (!pending.length) return;
    const triggeredAt = new Date().toISOString();
    setChartAlerts(current => current.map(alert => pending.some(item => item.id === alert.id) ? { ...alert, lastTriggeredAt: triggeredAt } : alert));
    pending.forEach(alert => {
      const message = `${alert.symbol} ${alert.operator} ${alert.price}`;
      window.dispatchEvent(new CustomEvent("lios:chart-alert", { detail: { ...alert, currentPrice, triggeredAt } }));
      if ("Notification" in window && Notification.permission === "granted") new Notification(`LiOS price alert · ${alert.symbol}`, { body: message });
    });
  }, [chartAlerts, quote?.price, symbol]);
  const supportsIntraday = supportsIntradayCharts(quote?.status?.freshness ?? null, isCrypto);
  const allowedIntervals = getAllowedIntervals(supportsIntraday);
  const effectiveInterval = supportsIntraday ? interval : "1d";
  const effectiveRange = !supportsIntraday && range === "1D" ? "1M" : range;

  useEffect(() => {
    setSymInput(symbol);
    setCompareSymbols((current) => current.filter((entry) => entry !== symbol));
    if (!terminal) setDynamicSeriesIds(loadDynamicSeries(symbol));
  }, [symbol]);
  useEffect(() => {
    if (terminal) return;
    presetLoadedRef.current = false;
    const preset = loadChartWorkspacePreset(symbol);
    if (preset) {
      setRange(preset.range);
      setInterval(preset.interval);
      setOverlays(new Set(OVERLAYS.filter(item => preset.overlays.includes(item))));
      setOscillator(preset.oscillator);
      setChartType(preset.chartType);
      setCompareSymbols(preset.compareSymbols.slice(0, 3));
      setDynamicSeriesIds(preset.dataFabricSeriesIds.slice(0, 24));
      setIndicatorParams({ ...CHART_INDICATOR_DEFAULTS, ...preset.indicatorParams });
      setChartLayout(preset.chartLayout);
    }
    presetLoadedRef.current = true;
  }, [symbol]);

  useEffect(() => {
    if (terminal || !presetLoadedRef.current) return;
    saveChartWorkspacePreset(symbol, { range, interval, overlays: Array.from(overlays), oscillator, chartType, compareSymbols, dataFabricSeriesIds: dynamicSeriesIds, indicatorParams, chartLayout });
  }, [chartLayout, chartType, compareSymbols, dynamicSeriesIds, indicatorParams, interval, overlays, oscillator, range, symbol]);

  useEffect(() => {
    if (!allowedIntervals.includes(interval)) {
      setInterval(allowedIntervals[0]);
    }
  }, [allowedIntervals, interval]);

  useEffect(() => {
    const allowedRanges = getAllowedRanges(effectiveInterval);
    if (!allowedRanges.includes(effectiveRange)) {
      setRange(allowedRanges[allowedRanges.length - 1]);
    }
  }, [effectiveInterval, effectiveRange]);

  const { data: series, isLoading } = useOHLCV(symbol, effectiveRange, effectiveInterval);
  const raw = series?.bars ?? [];

  const comparisonQueries = useQueries({
    queries: compareSymbols.map((entry) => ({
      queryKey: ["/api/finance/ohlcv", entry, effectiveRange, effectiveInterval],
      queryFn: async () => {
        const params = new URLSearchParams({ symbol: entry, range: effectiveRange, interval: effectiveInterval });
        const res = await fetch(`/api/finance/ohlcv?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch comparison OHLCV");
        const payload = await res.json() as { bars: AdvancedChartPoint[] };
        return payload.bars;
      },
      staleTime: 60_000,
      enabled: Boolean(entry),
    })),
  });

  const chartData = useMemo(() => {
    if (!raw.length) return [];
    const sma20Period = indicatorParams["SMA20.period"] ?? 20;
    const sma50Period = indicatorParams["SMA50.period"] ?? 50;
    const ema12Period = indicatorParams["EMA12.period"] ?? 12;
    const ema26Period = indicatorParams["EMA26.period"] ?? 26;
    const rsiPeriod = indicatorParams["RSI.period"] ?? 14;
    const macdFast = indicatorParams["MACD.fast"] ?? 12;
    const macdSlow = indicatorParams["MACD.slow"] ?? 26;
    const macdSignal = indicatorParams["MACD.signal"] ?? 9;
    const bbPeriod = indicatorParams["BB.period"] ?? 20;
    const bbDeviations = indicatorParams["BB.deviations"] ?? 2;
    const donchianPeriod = indicatorParams["DONCHIAN.period"] ?? 20;
    const sma20 = computeSMA(raw, sma20Period);
    const sma50 = computeSMA(raw, sma50Period);
    const ema12 = computeEMA(raw, ema12Period);
    const ema26 = computeEMA(raw, ema26Period);
    const rsi = computeRSI(raw, rsiPeriod);
    const macdResult = computeMACD(raw, macdFast, macdSlow, macdSignal);
    const bb = computeBollingerBands(raw, bbPeriod, bbDeviations);
    const adxResult = computeADX(raw, indicatorParams["ADX.period"] ?? 14);
    const donchian = computeDonchianChannel(raw, donchianPeriod);
    return raw.map((point, index) => ({
      ...point,
      sma20: sma20[index],
      sma50: sma50[index],
      ema12: ema12[index],
      ema26: ema26[index],
      rsi: rsi[index],
      macd: macdResult.macd[index],
      macdSignal: macdResult.signal[index],
      macdHist: macdResult.histogram[index],
      bbUpper: bb.upper[index],
      bbMiddle: bb.middle[index],
      bbLower: bb.lower[index],
      adx: adxResult.adx[index],
      plusDI: adxResult.plusDI[index],
      minusDI: adxResult.minusDI[index],
      donchianUpper: donchian.upper[index],
      donchianLower: donchian.lower[index],
      xLabel: formatXAxisLabel(point.date, interval),
    }));
  }, [indicatorParams, interval, raw]);

  // Breakout markers and support/resistance levels are computed once per
  // series (not per bar) -- a handful of discrete events/levels, not a
  // per-point overlay series like the indicators above.
  const breakoutSignals = useMemo(() => (raw.length ? detectBreakouts(raw as any, 20) : []), [raw]);
  const srLevels = useMemo(() => (raw.length ? detectSupportResistance(raw, 5, 0.015, 4) : []), [raw]);

  const toggleOverlay = (key: (typeof OVERLAYS)[number]) => {
    setOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const comparisonOverlayData = useMemo(() => {
    if (!chartData.length) return [];
    const comparisonSeries = comparisonQueries
      .map((query, index) => ({ symbol: compareSymbols[index], points: query.data ?? [] }))
      .filter((entry) => entry.symbol && entry.points.length > 0);

    if (!comparisonSeries.length) return chartData;

    const normalized = normalizeComparisonSeries([
      { symbol, points: chartData.map((point) => ({ date: point.date, close: point.close })) },
      ...comparisonSeries,
    ]);
    const normalizedMap = new Map(normalized.map((row) => [String(row.date), row]));

    return chartData.map((point) => ({
      ...point,
      ...(normalizedMap.get(point.date) ?? {}),
      [`cmp_${symbol}`]: normalizedMap.get(point.date)?.[symbol],
      ...Object.fromEntries(compareSymbols.map((entry) => [`cmp_${entry}`, normalizedMap.get(point.date)?.[entry]])),
    }));
  }, [chartData, compareSymbols, comparisonQueries, symbol]);

  const handleSymbolSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (symInput.trim()) onSymbol(symInput.trim().toUpperCase());
  };

  const handleAddComparison = (event: React.FormEvent) => {
    event.preventDefault();
    const next = compareInput.trim().toUpperCase();
    if (!next || next === symbol || compareSymbols.includes(next) || compareSymbols.length >= 3) return;
    setCompareSymbols((current) => [...current, next]);
    setCompareInput("");
  };

  const addDynamicSeries = () => {
    const series = buildQuantSeries(dynamicSeriesId);
    if (!series || dynamicSeriesIds.includes(series.fieldId)) return;
    const next = [...dynamicSeriesIds, series.fieldId];
    setDynamicSeriesIds(next);
    if (!terminal) window.localStorage.setItem(`lios.chart.fields.${symbol.toUpperCase()}`, JSON.stringify(next));
  };

  const removeDynamicSeries = (fieldId: string) => {
    const next = dynamicSeriesIds.filter((id) => id !== fieldId);
    setDynamicSeriesIds(next);
    if (!terminal) window.localStorage.setItem(`lios.chart.fields.${symbol.toUpperCase()}`, JSON.stringify(next));
  };

  const allowedRanges = getAllowedRanges(effectiveInterval);
  const showIntradayNotice = !supportsIntraday;
  const seriesStatus = series?.status ?? quote?.status ?? null;
  const advancedData = comparisonOverlayData as AdvancedChartPoint[];
  const chartEvents: AdvancedChartEvent[] = news.slice(0, 20).filter(item => Boolean(item.publishedAt)).map(item => ({ date: item.publishedAt, title: `${item.source}: ${item.title}` }));
  const referenceLevels = useMemo(() => {
    if (!activeScenario || (activeScenario.symbol && activeScenario.symbol !== symbol.toUpperCase())) return [];
    return activeScenario.assumptions.flatMap(assumption => {
      const key = `${assumption.key} ${assumption.label}`.toLowerCase().replace(/[\s_-]+/g, " ");
      const isPriceLevel = /(target price|price target|fair value|invalidation|stop loss|support price|resistance price)/.test(key);
      if (!isPriceLevel || typeof assumption.value !== "number" || !Number.isFinite(assumption.value) || assumption.value <= 0) return [];
      const downside = /(invalidation|stop loss|support)/.test(key);
      return [{ price: assumption.value, title: `${activeScenario.name} · ${assumption.label}`, color: downside ? "#fb7185" : "#a78bfa" }];
    });
  }, [activeScenario, symbol]);
  const exportReceipt = () => {
    const receipt = createChartReceipt({ symbol, range: effectiveRange, interval: effectiveInterval, chartType, overlays: Array.from(overlays), oscillator, compareSymbols, indicatorParams, barCount: raw.length, drawings: chartDrawings, dataFabricSeriesIds: dynamicSeriesIds });
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${symbol.toUpperCase()}_chart_receipt.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const handleCreateAlert = (event: React.FormEvent) => {
    event.preventDefault();
    const price = Number(alertPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    const alert: ChartAlert = { id: crypto.randomUUID(), symbol: symbol.toUpperCase(), operator: alertOperator, price, enabled: true, createdAt: new Date().toISOString() };
    setChartAlerts(current => [...current.filter(item => !(item.symbol === alert.symbol && item.operator === alert.operator && item.price === alert.price)), alert]);
    setAlertPrice("");
  };
  const chartSymbols = [symbol, ...compareSymbols].slice(0, chartLayout);
  const chartDatasets = chartSymbols.map((entry, index) => index === 0 ? advancedData : (comparisonQueries[index - 1]?.data ?? []) as AdvancedChartPoint[]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <form onSubmit={handleSymbolSubmit} className="flex items-center gap-2">
          <input
            value={symInput}
            onChange={(event) => setSymInput(event.target.value.toUpperCase())}
            className="bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-xs text-[hsl(38,95%,55%)] focus:outline-none focus:border-[hsl(38,95%,50%)/60%] w-20"
            data-testid="chart-symbol-input"
          />
          <button type="submit" className="font-terminal text-[9px] text-muted-foreground border border-border px-2 py-1 hover:border-[hsl(38,95%,50%)/50%] hover:text-[hsl(38,95%,55%)]">GO</button>
        </form>

        {quote && (
          <div className="flex items-center gap-3">
            <span className="font-terminal text-sm font-bold tabular-nums">{formatPrice(quote.price)}</span>
            <span className={`font-terminal text-xs tabular-nums ${pctClass(quote.changePercent)}`}>
              {quote.changePercent >= 0 ? "▲" : "▼"} {Math.abs(quote.changePercent).toFixed(2)}%
            </span>
          </div>
        )}

        {seriesStatus && <DataStatusBadge status={seriesStatus} compact showAsOf />}

        <div className="flex items-center gap-px ml-2">
          {RANGES.map((entry) => {
            const enabled = allowedRanges.includes(entry);
            return (
              <button
                key={entry}
                onClick={() => enabled && setRange(entry)}
                disabled={!enabled}
                className={`px-2 py-1 font-terminal text-[9px] transition-colors ${
                  effectiveRange === entry ? "bg-[hsl(38,95%,50%)/20%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
                } ${!enabled ? "opacity-25 cursor-not-allowed" : ""}`}
              >
                {entry}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-px ml-2">
          {allowedIntervals.map((entry) => (
            <button
              key={entry}
              onClick={() => setInterval(entry)}
              className={`px-2 py-1 font-terminal text-[9px] transition-colors uppercase ${
                interval === entry ? "bg-[hsl(186,80%,50%)/20%] text-[hsl(186,80%,55%)]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {entry}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-px ml-2">
          {OVERLAYS.map((entry) => (
            <button
              key={entry}
              onClick={() => toggleOverlay(entry)}
              className={`px-2 py-1 font-terminal text-[9px] transition-colors ${
                overlays.has(entry) ? "bg-[hsl(265,70%,55%)/20%] text-[hsl(265,70%,70%)]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {OVERLAY_LABELS[entry]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-px ml-2">
          {OSCILLATORS.map((entry) => (
            <button
              key={entry}
              onClick={() => setOscillator(entry)}
              className={`px-2 py-1 font-terminal text-[9px] transition-colors ${
                oscillator === entry ? "bg-[hsl(186,80%,50%)/20%] text-[hsl(186,80%,55%)]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {entry === "none" ? "NONE" : entry}
            </button>
          ))}
        </div>
        <button onClick={() => setIndicatorSettingsOpen(value => !value)} className={`ml-2 px-2 py-1 font-terminal text-[9px] ${indicatorSettingsOpen ? "bg-[hsl(38,95%,50%)/15%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>PARAMS</button>

        {/* Chart type toggle */}
        <div className="flex items-center gap-px ml-2 border border-border/50">
          {CHART_TYPES.map((ct) => (
            <button
              key={ct}
              onClick={() => setChartType(ct)}
              className={`px-2 py-1 font-terminal text-[9px] transition-colors ${
                chartType === ct ? "bg-[hsl(38,95%,50%)/15%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {ct}
            </button>
          ))}
        </div>
        <button onClick={exportReceipt} className="ml-2 px-2 py-1 font-terminal text-[9px] text-cyan-300 hover:bg-cyan-500/10">RECEIPT</button>
        <button onClick={() => setAlertPanelOpen(value => !value)} title="Price alerts" className={`ml-1 flex items-center gap-1 px-2 py-1 font-terminal text-[9px] ${alertPanelOpen ? "text-amber-300 bg-amber-500/10" : "text-muted-foreground hover:text-foreground"}`}><Bell className="h-3 w-3" /> ALERT{chartAlerts.filter(alert => alert.symbol === symbol.toUpperCase() && alert.enabled).length ? ` ${chartAlerts.filter(alert => alert.symbol === symbol.toUpperCase() && alert.enabled).length}` : ""}</button>
        <div className="ml-2 flex items-center gap-px border border-border/50">
          {[1, 2, 4].map(layout => <button key={layout} onClick={() => setChartLayout(layout as 1 | 2 | 4)} disabled={layout > 1 && compareSymbols.length < layout - 1} className={`px-2 py-1 font-terminal text-[9px] ${chartLayout === layout ? "bg-cyan-500/15 text-cyan-300" : "text-muted-foreground"} disabled:opacity-25`}>{layout === 1 ? "SINGLE" : `${layout}×`}</button>)}
        </div>

        <form onSubmit={handleAddComparison} className="flex items-center gap-2 ml-auto">
          <input
            value={compareInput}
            onChange={(event) => setCompareInput(event.target.value.toUpperCase())}
            placeholder="COMPARE"
            className="bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] text-[hsl(186,80%,55%)] focus:outline-none focus:border-[hsl(186,80%,55%)/50%] w-24 uppercase"
            data-testid="chart-compare-input"
          />
          <button type="submit" className="flex items-center gap-1 px-2 py-1 font-terminal text-[9px] border border-border text-muted-foreground hover:text-foreground">
            <Plus className="w-3 h-3" /> COMPARE
          </button>
        </form>
      </div>
      {alertPanelOpen && (
        <div className="border-b border-border bg-[#080808] px-4 py-2 flex flex-wrap items-center gap-2">
          <span className="font-terminal text-[8px] tracking-widest text-amber-300">PRICE ALERTS</span>
          <form onSubmit={handleCreateAlert} className="flex items-center gap-1">
            <select value={alertOperator} onChange={event => setAlertOperator(event.target.value as ChartAlertOperator)} className="bg-[#050505] border border-border px-1 py-1 font-terminal text-[8px] text-foreground"><option value="above">≥ ABOVE</option><option value="below">≤ BELOW</option></select>
            <input type="number" min="0" step="any" value={alertPrice} onChange={event => setAlertPrice(event.target.value)} placeholder={quote ? String(quote.price) : "PRICE"} className="w-20 bg-[#050505] border border-border px-1 py-1 font-terminal text-[9px] text-foreground" />
            <button type="submit" className="border border-amber-500/40 px-2 py-1 font-terminal text-[8px] text-amber-300 hover:bg-amber-500/10">SET</button>
          </form>
          {chartAlerts.filter(alert => alert.symbol === symbol.toUpperCase()).map(alert => <span key={alert.id} className={`flex items-center gap-1 border border-border px-1.5 py-1 font-terminal text-[8px] ${alert.lastTriggeredAt ? "text-muted-foreground line-through" : "text-foreground"}`}>{alert.operator === "above" ? "≥" : "≤"} {alert.price}<button type="button" onClick={() => setChartAlerts(current => current.filter(item => item.id !== alert.id))} aria-label={`Remove alert ${alert.price}`}><X className="h-2.5 w-2.5" /></button></span>)}
        </div>
      )}
      {indicatorSettingsOpen && (
        <div className="border-b border-border bg-[#080808] px-4 py-2 flex flex-wrap items-center gap-3">
          <span className="font-terminal text-[8px] tracking-widest text-cyan-300">INDICATOR PARAMETERS</span>
          {CHART_INDICATOR_REGISTRY.map(definition => definition.parameters.map(parameter => {
            const key = `${definition.id}.${parameter.id}`;
            return <label key={key} className="flex items-center gap-1 font-terminal text-[7px] text-muted-foreground">{definition.id} {parameter.label}<input type="number" min={parameter.min} max={parameter.max} step={parameter.step} value={indicatorParams[key] ?? parameter.defaultValue} onChange={event => setIndicatorParams(current => ({ ...current, [key]: clampIndicatorParameter(definition, parameter.id, Number(event.target.value)) }))} className="w-12 bg-[#050505] border border-border px-1 py-0.5 text-[8px] text-foreground" /></label>;
          }))}
        </div>
      )}

      <div className="px-4 py-1.5 border-b border-border bg-[#060606] flex items-center gap-2 flex-wrap shrink-0">
        <span className="font-terminal text-[8px] tracking-widest text-muted-foreground mr-2">OVERLAYS</span>
        {[symbol, ...compareSymbols].map((entry, index) => (
          <span key={entry} className="flex items-center gap-1.5 px-2 py-0.5 border border-border font-terminal text-[9px] rounded-sm" style={{ color: COMPARISON_COLORS[index] ?? "hsl(38,95%,55%)" }}>
            {entry}
            {entry !== symbol && (
              <button onClick={() => setCompareSymbols((current) => current.filter((value) => value !== entry))}>
                <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </span>
        ))}

        <div className="flex items-center gap-1.5 ml-4 border-l border-border/50 pl-4">
          <span className="font-terminal text-[8px] text-muted-foreground mr-1.5">QUICK COMPARISON:</span>
          {[{ symbol: "^GSPC", label: "S&P 500" }, { symbol: "^IXIC", label: "NASDAQ" }, localIndexSymbol].filter(Boolean).map((idx: any) => {
            const isComparing = compareSymbols.includes(idx.symbol);
            return (
              <button
                key={idx.symbol}
                onClick={() => {
                  if (isComparing) {
                    setCompareSymbols(current => current.filter(val => val !== idx.symbol));
                  } else {
                    if (compareSymbols.length >= 3) return;
                    setCompareSymbols(current => [...current, idx.symbol]);
                  }
                }}
                className={`px-2 py-0.5 border rounded-sm font-terminal text-[8px] transition-all duration-200 ${
                  isComparing ? "bg-[hsl(186,80%,50%)/10%] border-[hsl(186,80%,55%)] text-[hsl(186,80%,55%)] font-bold" : "border-border hover:border-foreground/45 text-muted-foreground hover:text-foreground"
                }`}
              >
                {isComparing ? "●" : "○"} {idx.label}
              </button>
            );
          })}
        </div>

        {showIntradayNotice && seriesStatus && (
          <span className="font-terminal text-[8px] tracking-widest text-muted-foreground ml-auto">
            {seriesStatus.delayLabel.toUpperCase()}
          </span>
        )}
      </div>
      <div className="px-4 py-1.5 border-b border-cyan-400/15 bg-cyan-400/[0.02] flex items-center gap-2 flex-wrap shrink-0">
        <span className="font-terminal text-[8px] tracking-widest text-cyan-200">DATA FABRIC SERIES</span>
        <select aria-label="Chart Data Fabric series" value={dynamicSeriesId} onChange={(event) => setDynamicSeriesId(event.target.value)} className="h-6 max-w-[260px] border border-border bg-black px-1.5 font-terminal text-[7px] outline-none">{DYNAMIC_CHART_FIELDS.map((field) => <option key={field.id} value={field.id}>{field.label.toUpperCase()} · {field.id}</option>)}</select>
        <button type="button" onClick={addDynamicSeries} className="h-6 border border-cyan-400/35 px-2 font-terminal text-[7px] text-cyan-200 hover:bg-cyan-400/10"><Plus className="mr-1 inline h-3 w-3" />ADD SERIES</button>
        {dynamicSeriesIds.map((fieldId) => <span key={fieldId} className="flex items-center gap-1 border border-cyan-400/25 px-1.5 py-0.5 font-mono text-[6.5px] text-cyan-200">{DYNAMIC_CHART_FIELDS.find((field) => field.id === fieldId)?.label ?? fieldId}<button type="button" onClick={() => removeDynamicSeries(fieldId)} aria-label={`Remove chart series ${fieldId}`}><X className="h-2.5 w-2.5" /></button></span>)}
        <span className="font-terminal text-[6.5px] text-muted-foreground">Price bars are live; other fields render when an attributed historical series is available.</span>
      </div>
      {isLoading ? (
        <div className="flex-1 p-6"><Skeleton className="w-full h-full bg-border" /></div>
      ) : (
        <div className={`h-full min-h-0 overflow-hidden p-2 ${chartLayout > 1 ? "grid grid-cols-2 grid-rows-2 gap-2" : ""}`}>
          {chartSymbols.map((entry, index) => {
            const dataset = index === 0 ? advancedData : (comparisonQueries[index - 1]?.data ?? []) as AdvancedChartPoint[];
            return <AdvancedTradingChart key={entry} data={dataset} symbol={entry} chartType={chartType} overlays={index === 0 ? overlays : new Set<(typeof OVERLAYS)[number]>()} oscillator={index === 0 ? oscillator : "none"} compareSymbols={index === 0 ? compareSymbols : []} srLevels={index === 0 ? srLevels : []} breakoutSignals={index === 0 ? breakoutSignals : []} events={index === 0 ? chartEvents : []} referenceLevels={index === 0 ? referenceLevels : []} onDrawingsChange={index === 0 ? setChartDrawings : undefined} />;
          })}
        </div>
      )}
    </div>
  );
}
export default memo(ChartPanel);
