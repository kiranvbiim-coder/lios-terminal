import { useMemo, useState, type CSSProperties } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { ViewMode } from "@/lib/terminalTypes";
import type { Quote } from "@/lib/finance";
import type { MarketBreadthResult } from "@/lib/useFinance";
import { useIndexSparklines } from "@/lib/useFinance";
import { formatPrice, getCurrencySymbol, INDICES, pctClass } from "@/lib/finance";
import { cn } from "@/lib/utils";
import { FusionSparkline } from "./FusionPrimitives";
import { recordedBreadthRows, recordedLatestBreadth, shortRecordedMarketDate } from "@/lib/sprintCMarketCanvas";

interface Props {
  breadth?: MarketBreadthResult;
  gainers: Quote[];
  losers: Quote[];
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
}

type Range = "1W" | "1M" | "3M";
const EMPTY_BREADTH_SERIES: MarketBreadthResult["series"] = [];
const SESSION_LABEL: Record<Range, string> = { "1W": "7S", "1M": "30S", "3M": "90S" };

function moveColor(value: number) {
  const intensity = Math.min(1, Math.max(0.18, Math.abs(value) / 5));
  return value >= 0
    ? `hsl(145 70% ${16 + intensity * 15}% / ${0.5 + intensity * 0.3})`
    : `hsl(2 78% ${17 + intensity * 15}% / ${0.5 + intensity * 0.3})`;
}

function MoveTile({ quote, onOpen }: { quote: Quote; onOpen: Props["onOpen"] }) {
  const move = Number.isFinite(quote.changePercent) ? quote.changePercent : 0;
  return (
    <button
      type="button"
      onClick={() => onOpen("quote", "current", quote.symbol)}
      className="fusion-market-tile group"
      style={{ background: moveColor(move) }}
      title={`${quote.name} · ${move >= 0 ? "+" : ""}${move.toFixed(2)}%`}
      aria-label={`Open recorded quote for ${quote.name} (${quote.symbol}), ${move >= 0 ? "up" : "down"} ${Math.abs(move).toFixed(2)} percent`}
    >
      <span className="truncate font-terminal text-[8px] font-bold text-white/95">{quote.symbol.replace(/\.(NS|BO|T|HK)$/, "")}</span>
      <span className="mt-1 font-terminal text-[10px] font-bold tabular-nums text-white">{move >= 0 ? "+" : ""}{move.toFixed(2)}%</span>
      <span className="mt-1 truncate font-terminal text-[6px] text-white/65">{getCurrencySymbol(quote.symbol)}{formatPrice(quote.price)}</span>
    </button>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-white/10 bg-[#0a0d0d]/95 px-2.5 py-2 shadow-xl">
      <div className="font-terminal text-[7px] tracking-wider text-white/55">{label}</div>
      {payload.map((item) => (
        <div key={item.name} className="mt-1 flex items-center justify-between gap-3 font-terminal text-[8px]">
          <span className="text-white/60">{item.name}</span>
          <span className={item.name === "NET FLOW" ? "text-amber-200" : "text-white"}>{typeof item.value === "number" ? `${item.value > 0 ? "+" : ""}${item.value.toFixed(1)}%` : "—"}</span>
        </div>
      ))}
    </div>
  );
}

export default function FusionMarketCanvas({ breadth, gainers, losers, onOpen }: Props) {
  const [range, setRange] = useState<Range>("1M");
  const { data: indexSparklines = {} } = useIndexSparklines();
  const series = breadth?.series ?? EMPTY_BREADTH_SERIES;
  const points = range === "1W" ? 7 : range === "3M" ? 90 : 30;

  const flowData = useMemo(() => recordedBreadthRows(series, points), [points, series]);

  const latest = breadth?.latest ?? null;
  const validLatest = recordedLatestBreadth(latest);
  const advancePct = validLatest?.advances ?? 0;
  const declinePct = validLatest?.declines ?? 0;
  const unchangedPct = validLatest?.unchanged ?? 0;

  const moverData = useMemo(() => [...gainers.slice(0, 4), ...losers.slice(0, 4)]
    .filter((quote) => Number.isFinite(quote.changePercent))
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .map((quote) => ({ symbol: quote.symbol.replace(/\.(NS|BO|T|HK)$/, ""), move: Number(quote.changePercent.toFixed(2)) })), [gainers, losers]);

  const tiles = useMemo(() => [...gainers.slice(0, 6), ...losers.slice(0, 6)]
    .filter((quote) => Number.isFinite(quote.changePercent))
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)), [gainers, losers]);

  const indexTape = useMemo(() => INDICES.slice(0, 8).map((index) => {
    const values = (indexSparklines[index.symbol] ?? []).filter((value) => Number.isFinite(value));
    const first = values[0];
    const last = values.at(-1);
    const move = first !== undefined && last !== undefined && first !== 0
      ? ((last - first) / Math.abs(first)) * 100 : null;
    return { ...index, values, move };
  }), [indexSparklines]);

  return (
    <section className="fusion-market-canvas" data-sprint-c-visual="market" aria-label="Visual market canvas">
      <header className="fusion-canvas-header">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="fusion-canvas-orb" aria-hidden="true"><span /></div>
          <div className="min-w-0">
            <div className="fusion-section-eyebrow text-cyan-200/75">MARKET MAP · RECORDED OBSERVATIONS</div>
            <div className="fusion-canvas-title">Market canvas</div>
            <div className="fusion-canvas-subtitle">Source-bound breadth, momentum and movers. Ranges count recorded trading sessions, not calendar weeks or months.</div>
          </div>
        </div>
        <div className="fusion-sprint-c-actions flex shrink-0 items-center gap-1.5" aria-label="Market canvas view options">
          {(["1W", "1M", "3M"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setRange(item)} aria-label={`Show up to ${item === "1W" ? 7 : item === "1M" ? 30 : 90} recorded trading sessions`} aria-pressed={range === item} className={cn("fusion-range-button", range === item && "fusion-range-button-active")}>{SESSION_LABEL[item]}</button>
          ))}
          <button type="button" onClick={() => onOpen("heatmap", "current")} className="fusion-canvas-action">FULL MAP ↗</button>
        </div>
      </header>

      <div className="fusion-index-strip" aria-label="Global index tape">
        {indexTape.map((index) => (
          <button key={index.symbol} type="button" onClick={() => onOpen("quote", "current", index.symbol)} className="fusion-index-card">
            <span className="truncate font-terminal text-[7px] tracking-wider text-white/58">{index.label}</span>
            <span className={cn("font-terminal text-[10px] font-bold tabular-nums", index.move == null ? "text-white/45" : pctClass(index.move))}>{index.move == null ? "—" : `${index.move >= 0 ? "+" : ""}${index.move.toFixed(2)}%`}</span>
            <FusionSparkline values={index.values} height={22} label={`${index.label} trend`} className={cn("h-[22px] w-full", index.move != null && pctClass(index.move))} />
          </button>
        ))}
      </div>

      <div className="fusion-canvas-grid">
        <div className="fusion-canvas-panel fusion-flow-panel">
          <div className="fusion-canvas-panel-head"><span>ADVANCE / DECLINE FLOW</span><span className="text-cyan-200/75">{flowData.at(-1)?.date ?? "AWAITING DATA"}</span></div>
          <p className="fusion-sprint-c-source-note" role="status">{flowData.length
            ? `${flowData.length} recorded sessions shown · latest ${points} sessions selected · percentages of reported breadth universe`
            : "No usable recorded breadth sessions for this range. A missing source is not a zero market reading."}</p>
          {flowData.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={flowData} margin={{ top: 10, right: 10, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="fusionAdvanceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(145 70% 47%)" stopOpacity={0.3} /><stop offset="100%" stopColor="hsl(145 70% 47%)" stopOpacity={0.015} /></linearGradient>
                  <linearGradient id="fusionDeclineFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(2 78% 56%)" stopOpacity={0.015} /><stop offset="100%" stopColor="hsl(2 78% 56%)" stopOpacity={0.3} /></linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(0 0% 100% / .07)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortRecordedMarketDate} tick={{ fill: "hsl(0 0% 100% / .62)", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis domain={[-100, 100]} tick={{ fill: "hsl(0 0% 100% / .55)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} />
                <ReferenceLine y={0} stroke="hsl(0 0% 100% / .18)" />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "hsl(186 80% 65% / .25)" }} />
                <Area type="monotone" dataKey="advances" name="ADVANCERS" stroke="hsl(145 70% 47%)" fill="url(#fusionAdvanceFill)" strokeWidth={1.5} isAnimationActive={false} />
                <Area type="monotone" dataKey="declines" name="DECLINERS" stroke="hsl(2 78% 56%)" fill="url(#fusionDeclineFill)" strokeWidth={1.5} isAnimationActive={false} />
                <Area type="monotone" dataKey="net" name="NET FLOW" stroke="hsl(38 100% 50%)" fill="none" strokeWidth={2} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="fusion-visual-empty">Waiting for breadth history to draw the market.</div>}
          <div className="fusion-chart-legend"><span><i className="bg-emerald-300" />ADVANCERS</span><span><i className="bg-rose-300" />DECLINERS (negative axis for comparison)</span><span><i className="bg-amber-300" />NET FLOW</span></div>
          <details className="fusion-sprint-c-data">
            <summary>Read recorded breadth values ({flowData.length} sessions)</summary>
            {flowData.length ? <div className="fusion-sprint-c-table-scroll">
              <table aria-label={`Recorded advance decline percentages from up to the latest ${points} sessions`}>
                <caption>Existing provider records only. Decliners appear negative on the chart; the table shows their positive share. No forecast or interpolation.</caption>
                <thead><tr><th scope="col">Session</th><th scope="col">Advancing</th><th scope="col">Declining</th><th scope="col">Net</th></tr></thead>
                <tbody>{flowData.map((row, index) => <tr key={`${row.date}:${index}`}>
                  <th scope="row"><time dateTime={row.date}>{row.date}</time></th>
                  <td>{row.advances.toFixed(1)}%</td>
                  <td>{Math.abs(row.declines).toFixed(1)}%</td>
                  <td>{row.net > 0 ? "+" : ""}{row.net.toFixed(1)}%</td>
                </tr>)}</tbody>
              </table>
            </div> : <p role="status" className="p-3 text-sm text-muted-foreground">No valid recorded breadth rows are available to inspect.</p>}
          </details>
        </div>

        <div className="fusion-canvas-panel fusion-breadth-panel">
          <div className="fusion-canvas-panel-head"><span>MARKET BREADTH</span><span>{breadth?.universeSize ? `${breadth.universeSize.toLocaleString()} NAMES` : "—"}</span></div>
          <div className="fusion-breadth-ring" aria-label={validLatest ? `Recorded market breadth: ${advancePct.toFixed(1)}% advancing, ${declinePct.toFixed(1)}% declining, ${unchangedPct.toFixed(1)}% unchanged` : "Breadth proportions not recorded"} style={{ "--advance": `${advancePct}%`, "--decline": `${declinePct}%` } as CSSProperties}>
            <div><strong>{validLatest ? `${Math.round(advancePct)}%` : "—"}</strong><span>ADVANCING</span></div>
          </div>
          <div className="fusion-stack-bar" aria-label={validLatest ? "Recorded market breadth split" : "Market breadth split unavailable"}><span className="bg-emerald-300" style={{ width: `${advancePct}%` }} /><span className="bg-rose-300" style={{ width: `${declinePct}%` }} /><span className="bg-white/20" style={{ width: `${unchangedPct}%` }} /></div>
          <div className="grid grid-cols-3 gap-2 pt-3 text-center"><div><strong className="text-emerald-300">{validLatest ? latest?.advances : "—"}</strong><span>ADV</span></div><div><strong className="text-rose-300">{validLatest ? latest?.declines : "—"}</strong><span>DEC</span></div><div><strong className="text-white/65">{validLatest ? latest?.unchanged : "—"}</strong><span>FLAT</span></div></div>
          <div className="fusion-breadth-stat"><span>NEW HIGHS / LOWS</span><strong>{latest && Number.isSafeInteger(latest.newHighs) && latest.newHighs >= 0 && Number.isSafeInteger(latest.newLows) && latest.newLows >= 0 ? `${latest.newHighs} / ${latest.newLows}` : "—"}</strong></div>
          <div className="fusion-breadth-stat"><span>McCLELLAN</span><strong className={latest?.mcClellanOscillator != null && Number.isFinite(latest.mcClellanOscillator) && latest.mcClellanOscillator >= 0 ? "text-emerald-300" : "text-rose-300"}>{latest?.mcClellanOscillator == null || !Number.isFinite(latest.mcClellanOscillator) ? "—" : latest.mcClellanOscillator.toFixed(2)}</strong></div>
        </div>

        <div className="fusion-canvas-panel fusion-momentum-panel">
          <div className="fusion-canvas-panel-head"><span>MOMENTUM LEADERS</span><button type="button" onClick={() => onOpen("market", "current")} className="text-cyan-200/75 hover:text-cyan-100">OPEN TAPE ↗</button></div>
          {moverData.length ? (
              <ResponsiveContainer width="100%" height={220}>
              <BarChart data={moverData} layout="vertical" margin={{ top: 6, right: 8, left: 6, bottom: 0 }}>
                <CartesianGrid stroke="hsl(0 0% 100% / .06)" horizontal={false} />
                <XAxis type="number" domain={[-Math.max(5, ...moverData.map((item) => Math.abs(item.move))), Math.max(5, ...moverData.map((item) => Math.abs(item.move)))]} tick={{ fill: "hsl(0 0% 100% / .34)", fontSize: 8 }} tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="symbol" width={42} tick={{ fill: "hsl(0 0% 100% / .58)", fontSize: 8 }} tickLine={false} axisLine={false} />
                <ReferenceLine x={0} stroke="hsl(0 0% 100% / .2)" />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(0 0% 100% / .04)" }} />
                <Bar dataKey="move" name="MOVE" radius={[2, 2, 2, 2]} isAnimationActive={false}>
                  {moverData.map((item) => <Cell key={item.symbol} fill={item.move >= 0 ? "hsl(145 70% 47%)" : "hsl(2 78% 56%)"} fillOpacity={0.82} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="fusion-visual-empty">No recorded mover observations available.</div>}
        </div>

        <div className="fusion-canvas-panel fusion-map-panel">
          <div className="fusion-canvas-panel-head"><span>RECORDED MOVER MAP</span><span className="text-amber-200/75">CLICK TO DRILL IN</span></div>
          {tiles.length ? <div className="fusion-market-map">{tiles.map((quote) => <MoveTile key={quote.symbol} quote={quote} onOpen={onOpen} />)}</div> : <div className="fusion-visual-empty">No recorded mover observations available.</div>}
          <div className="mt-auto border-t border-white/[0.07] pt-2 font-terminal text-[6.5px] leading-relaxed text-white/40">Tile color shows observed move intensity. Data stays tied to the visible provider universe and keeps its source state in the detail view.</div>
        </div>
      </div>
    </section>
  );
}
