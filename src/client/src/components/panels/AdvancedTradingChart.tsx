import { useTerminalArtifactContext, useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useEffect, useMemo, useRef, useState } from "react";
import { AreaSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type SeriesType, type UTCTimestamp } from "lightweight-charts";
import { Eraser, Lock, Minus, MousePointer2, PenLine, Play, RectangleHorizontal, RotateCcw, Unlock } from "lucide-react";
import type { OHLCVBar } from "@/lib/finance";
import type { BreakoutSignal, PivotLevel } from "@/lib/technicalIndicators";

export type AdvancedChartType = "LINE" | "CANDLE" | "AREA";
export type AdvancedOscillator = "none" | "RSI" | "MACD" | "ADX";
export type AdvancedOverlay = "SMA20" | "SMA50" | "EMA12" | "EMA26" | "BB" | "DONCHIAN" | "SR";
export interface AdvancedChartPoint extends OHLCVBar { [key: string]: unknown }
export interface AdvancedChartEvent { date: string; title: string; }
export interface ChartDrawingPoint { time: number; price: number }
export interface ChartDrawing { id: string; type: "horizontal" | "trendline" | "rectangle"; points: ChartDrawingPoint[]; color: string; locked: boolean; visible: boolean }
interface Props { data: AdvancedChartPoint[]; symbol: string; chartType: AdvancedChartType; overlays: Set<AdvancedOverlay>; oscillator: AdvancedOscillator; compareSymbols: string[]; srLevels?: PivotLevel[]; breakoutSignals?: BreakoutSignal[]; events?: AdvancedChartEvent[]; referenceLevels?: Array<{ price: number; title: string; color: string }>; onDrawingsChange?: (drawings: ChartDrawing[]) => void; }

const DRAW_COLORS = ["#f2b84b", "#31c7d9", "#a78bfa", "#fb7185"];
const DRAWING_KEY = "lios:chart-drawings:";
const asTime = (value: string): UTCTimestamp => Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp;
const numberValue = (point: AdvancedChartPoint, key: string): number | null => typeof point[key] === "number" && Number.isFinite(point[key]) ? point[key] as number : null;

function loadDrawings(symbol: string): ChartDrawing[] {
  try { const parsed = JSON.parse(localStorage.getItem(`${DRAWING_KEY}${symbol}`) ?? "[]") as ChartDrawing[]; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export default function AdvancedTradingChart({ data, symbol, chartType, overlays, oscillator, compareSymbols, srLevels = [], breakoutSignals = [], events = [], referenceLevels = [], onDrawingsChange }: Props) {
  const terminal = useTerminalArtifactContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const drawStartRef = useRef<ChartDrawingPoint | null>(null);
  const [drawMode, setDrawMode] = useState<"cursor" | "horizontal" | "trendline" | "rectangle">("cursor");
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
  const [drawings, setDrawings] = useTerminalArtifactState<ChartDrawing[]>(`chart.drawings.${symbol}`, () => terminal ? [] : loadDrawings(symbol));
  const [renderVersion, setRenderVersion] = useState(0);
  const [replayMode, setReplayMode] = useState(false);
  const [replayIndex, setReplayIndex] = useState(data.length);
  const [crosshair, setCrosshair] = useState<{ time: string; open: number; high: number; low: number; close: number; volume: number } | null>(null);
  const visibleData = replayMode ? data.slice(0, Math.max(2, Math.min(replayIndex, data.length))) : data;
  const visibleDataRef = useRef(visibleData);
  visibleDataRef.current = visibleData;
  useEffect(() => { onDrawingsChange?.(drawings); }, [drawings, onDrawingsChange]);

  useEffect(() => { if (!terminal) setDrawings(loadDrawings(symbol)); setReplayIndex(data.length); setReplayMode(false); }, [data.length, symbol]);
  useEffect(() => { if (!terminal) localStorage.setItem(`${DRAWING_KEY}${symbol}`, JSON.stringify(drawings)); }, [drawings, symbol]);

  const seriesPoints = useMemo(() => visibleData.map(point => ({ time: asTime(point.date), open: point.open, high: point.high, low: point.low, close: point.close })), [visibleData]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#050505" }, textColor: "#777" },
      grid: { vertLines: { color: "#151515" }, horzLines: { color: "#151515" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#777", width: 1, style: 3, labelBackgroundColor: "#333" }, horzLine: { color: "#777", width: 1, style: 3, labelBackgroundColor: "#333" } },
      rightPriceScale: { borderColor: "#252525", autoScale: true },
      leftPriceScale: { visible: false },
      timeScale: { borderColor: "#252525", timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8 },
      localization: { priceFormatter: (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 }) },
    });
    chartRef.current = chart;
    const onCrosshair = (param: { time?: unknown; seriesData: Map<unknown, unknown> }) => {
      const raw = param.time;
      if (!raw) { setCrosshair(null); return; }
      const point = visibleDataRef.current.find(item => asTime(item.date) === raw);
      if (point) setCrosshair({ time: point.date, open: point.open, high: point.high, low: point.low, close: point.close, volume: point.volume });
    };
    chart.subscribeCrosshairMove(onCrosshair);
    const resize = new ResizeObserver(() => chart.applyOptions({ width: containerRef.current?.clientWidth ?? 800, height: containerRef.current?.clientHeight ?? 500 }));
    resize.observe(containerRef.current);
    return () => { resize.disconnect(); chart.unsubscribeCrosshairMove(onCrosshair); chart.remove(); chartRef.current = null; priceRef.current = null; };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !seriesPoints.length) return;
    const series = chart.addSeries(chartType === "CANDLE" ? CandlestickSeries : chartType === "AREA" ? AreaSeries : LineSeries, chartType === "CANDLE" ? { upColor: "#22c55e", downColor: "#ef4444", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#ef4444" } : { color: "#f2b84b", lineWidth: 2, lineType: 0 });
    priceRef.current = series;
    if (chartType === "CANDLE") series.setData(seriesPoints);
    else series.setData(seriesPoints.map(point => ({ time: point.time, value: point.close })));
    const priceLines = [
      ...(overlays.has("SR") ? srLevels.map(level => series.createPriceLine({ price: level.price, color: level.type === "support" ? "#22c55e" : "#ef4444", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `${level.type === "support" ? "S" : "R"} ${level.strength}` })) : []),
      ...referenceLevels.map(level => series.createPriceLine({ price: level.price, color: level.color, lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: level.title })),
    ];
    const eventMarkers = events.flatMap(event => {
      const nearest = visibleData.reduce<AdvancedChartPoint | null>((closest, point) => {
        if (!closest) return point;
        return Math.abs(new Date(point.date).getTime() - new Date(event.date).getTime()) < Math.abs(new Date(closest.date).getTime() - new Date(event.date).getTime()) ? point : closest;
      }, null);
      return nearest ? [{ time: asTime(nearest.date), position: "aboveBar" as const, color: "#31c7d9", shape: "circle" as const, text: "NEWS", title: event.title }] : [];
    });
    const breakoutMarkers = overlays.has("DONCHIAN") ? breakoutSignals.map(signal => ({ time: asTime(signal.date), position: signal.direction === "up" ? "belowBar" as const : "aboveBar" as const, color: signal.direction === "up" ? "#22c55e" : "#ef4444", shape: signal.direction === "up" ? "arrowUp" as const : "arrowDown" as const, text: "BO" })) : [];
    const markerPlugin = breakoutMarkers.length || eventMarkers.length ? createSeriesMarkers(series, [...breakoutMarkers, ...eventMarkers]) : null;
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", color: "#2aa889", priceLineVisible: false }, 1);
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.72, bottom: 0 } });
    volume.setData(visibleData.map(point => ({ time: asTime(point.date), value: point.volume, color: point.close >= point.open ? "#22c55e99" : "#ef444499" })));
    const lines: ISeriesApi<SeriesType>[] = [series, volume];
    const addLine = (key: string, color: string, pane = 0, scale = "right") => {
      const line = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceScaleId: scale }, pane);
      line.setData(visibleData.flatMap(point => { const value = numberValue(point, key); return value === null ? [] : [{ time: asTime(point.date), value }]; }));
      lines.push(line);
    };
    if (overlays.has("SMA20")) addLine("sma20", "#f2b84b");
    if (overlays.has("SMA50")) addLine("sma50", "#a78bfa");
    if (overlays.has("EMA12")) addLine("ema12", "#fde047");
    if (overlays.has("EMA26")) addLine("ema26", "#f472b6");
    if (overlays.has("BB")) { addLine("bbUpper", "#94a3b8"); addLine("bbLower", "#94a3b8"); }
    if (overlays.has("DONCHIAN")) { addLine("donchianUpper", "#ef4444"); addLine("donchianLower", "#22c55e"); }
    compareSymbols.forEach((entry, index) => addLine(`cmp_${entry}`, DRAW_COLORS[(index + 1) % DRAW_COLORS.length], 0, "comparison"));
    if (oscillator === "RSI") addLine("rsi", "#31c7d9", 2, "rsi");
    if (oscillator === "ADX") { addLine("adx", "#31c7d9", 2, "adx"); addLine("plusDI", "#22c55e", 2, "adx"); addLine("minusDI", "#ef4444", 2, "adx"); }
    if (oscillator === "MACD") { addLine("macd", "#f2b84b", 2, "macd"); addLine("macdSignal", "#a78bfa", 2, "macd"); }
    chart.timeScale().fitContent();
    return () => {
      // If the chart-creation effect's own cleanup already ran first (true
      // unmount, not just a dependency change), `chart.remove()` disposed
      // this chart and every series inside it -- touching it again throws
      // ("Value is undefined") because lightweight-charts asserts non-null
      // internal state on every call. `chartRef.current` is nulled by that
      // cleanup, so its absence here means there is nothing left to detach.
      if (!chartRef.current) return;
      for (const item of priceLines) series.removePriceLine(item);
      markerPlugin?.detach();
      for (const item of lines) chart.removeSeries(item);
    };
  }, [breakoutSignals, chartType, compareSymbols, events, oscillator, overlays, referenceLevels, seriesPoints, srLevels, visibleData]);

  const drawingCoordinates = drawings.flatMap(drawing => {
    if (!drawing.visible || !priceRef.current || !chartRef.current) return [];
    const points = drawing.points.map(point => {
      const x = chartRef.current!.timeScale().timeToCoordinate(point.time as UTCTimestamp);
      const y = priceRef.current!.priceToCoordinate(point.price);
      return typeof x === "number" && typeof y === "number" ? { x: Number(x), y: Number(y) } : null;
    }).filter((point): point is { x: number; y: number } => point !== null);
    return [{ drawing, points }];
  });

  useEffect(() => {
    const chart = chartRef.current;
    const price = priceRef.current;
    if (!chart || !price || drawMode === "cursor") return;
    const onClick = (param: { point?: { x: number; y: number }; time?: unknown }) => {
      if (!param.point || !param.time) return;
      const value = price.coordinateToPrice(param.point.y);
      if (value === null || value === undefined) return;
      const point = { time: Number(param.time), price: value };
      if (drawMode === "horizontal") {
        setDrawings(current => [...current, { id: crypto.randomUUID(), type: "horizontal", points: [point, point], color: drawColor, locked: false, visible: true }]);
      } else if (!drawStartRef.current) {
        drawStartRef.current = point;
      } else {
        setDrawings(current => [...current, { id: crypto.randomUUID(), type: drawMode, points: [drawStartRef.current!, point], color: drawColor, locked: false, visible: true }]);
        drawStartRef.current = null;
      }
      setDrawMode("cursor"); setRenderVersion(version => version + 1);
    };
    chart.subscribeClick(onClick);
    return () => { if (chartRef.current) chart.unsubscribeClick(onClick); };
  }, [drawColor, drawMode]);

  function undoDrawing() { setDrawings(current => current.slice(0, -1)); setRenderVersion(version => version + 1); }
  function clearDrawings() { setDrawings(current => current.filter(item => item.locked)); setRenderVersion(version => version + 1); }
  function toggleLock(id: string) { setDrawings(current => current.map(item => item.id === id ? { ...item, locked: !item.locked } : item)); }

  return <div className="relative h-full min-h-[360px] overflow-hidden border border-border bg-[#050505]">
    <div className="absolute left-2 top-2 z-10 flex items-center gap-1 border border-border bg-[#080808]/95 p-1 shadow-lg">
      <button title="Cursor" onClick={() => setDrawMode("cursor")} className={`p-1.5 ${drawMode === "cursor" ? "text-amber-300" : "text-muted-foreground"}`}><MousePointer2 className="h-3.5 w-3.5" /></button>
      <button title="Horizontal line" onClick={() => setDrawMode("horizontal")} className={`p-1.5 ${drawMode === "horizontal" ? "text-amber-300" : "text-muted-foreground"}`}><Minus className="h-3.5 w-3.5" /></button>
      <button title="Trend line" onClick={() => setDrawMode("trendline")} className={`p-1.5 ${drawMode === "trendline" ? "text-amber-300" : "text-muted-foreground"}`}><PenLine className="h-3.5 w-3.5" /></button>
      <button title="Rectangle" onClick={() => setDrawMode("rectangle")} className={`p-1.5 ${drawMode === "rectangle" ? "text-amber-300" : "text-muted-foreground"}`}><RectangleHorizontal className="h-3.5 w-3.5" /></button>
      <button title="Undo drawing" onClick={undoDrawing} disabled={!drawings.length} className="p-1.5 text-muted-foreground disabled:opacity-30"><RotateCcw className="h-3.5 w-3.5" /></button>
      <button title="Clear unlocked drawings" onClick={clearDrawings} className="p-1.5 text-muted-foreground"><Eraser className="h-3.5 w-3.5" /></button>
      <button title={replayMode ? "Exit replay" : "Replay historical bars"} onClick={() => { setReplayMode(value => !value); setReplayIndex(data.length); }} className={`p-1.5 ${replayMode ? "text-cyan-300" : "text-muted-foreground"}`}><Play className="h-3.5 w-3.5" /></button>
    </div>
    <div className="absolute right-2 top-2 z-10 flex items-center gap-2 bg-[#080808]/90 px-2 py-1 font-terminal text-[7px] text-muted-foreground">{crosshair ? `${crosshair.time} · O ${crosshair.open.toFixed(2)} H ${crosshair.high.toFixed(2)} L ${crosshair.low.toFixed(2)} C ${crosshair.close.toFixed(2)} · V ${(crosshair.volume / 1e6).toFixed(2)}M` : `${symbol} · ${chartType} · ${visibleData.length} BARS`}</div>
    {replayMode && <div className="absolute bottom-2 left-2 right-2 z-10 flex items-center gap-2 border border-cyan-500/30 bg-[#080808]/95 px-2 py-1.5"><span className="font-terminal text-[7px] text-cyan-300">REPLAY</span><input type="range" min={2} max={data.length} value={Math.min(replayIndex, data.length)} onChange={event => setReplayIndex(Number(event.target.value))} className="w-full accent-cyan-400" /><span className="font-terminal text-[7px] text-muted-foreground">{visibleData.at(-1)?.date ?? "—"}</span></div>}
    <div ref={containerRef} className="h-full w-full" />
    <svg className="pointer-events-none absolute inset-0 h-full w-full">{drawingCoordinates.map(({ drawing, points }) => points.length >= 1 && drawing.type === "horizontal" ? <line key={drawing.id} x1={0} x2="100%" y1={points[0].y} y2={points[0].y} stroke={drawing.color} strokeWidth={1} strokeDasharray="5 3" /> : points.length === 2 && drawing.type === "trendline" ? <line key={drawing.id} x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} stroke={drawing.color} strokeWidth={1.5} /> : points.length === 2 && drawing.type === "rectangle" ? <rect key={drawing.id} x={Math.min(points[0].x, points[1].x)} y={Math.min(points[0].y, points[1].y)} width={Math.abs(points[1].x - points[0].x)} height={Math.abs(points[1].y - points[0].y)} fill="none" stroke={drawing.color} strokeWidth={1} strokeDasharray="4 2" /> : null)}</svg>
    {drawings.length > 0 && <div className="absolute bottom-2 right-2 z-10 flex max-w-56 flex-wrap justify-end gap-1">{drawings.map(drawing => <button key={drawing.id} onClick={() => toggleLock(drawing.id)} title={drawing.locked ? "Unlock drawing" : "Lock drawing"} className="border border-border bg-[#080808]/90 p-1 text-muted-foreground">{drawing.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}</button>)}</div>}
  </div>;
}
