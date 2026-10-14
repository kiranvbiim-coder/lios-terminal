import { useQuote, usePeers, useOHLCV, useNews, useFundamentals } from "@/lib/useFinance";
import { formatPrice, formatPct, formatBig, pctClass, getCurrencySymbol } from "@/lib/finance";
import DataStatusBadge from "@/components/data/DataStatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart as ChartIcon, BarChart2 } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  symbol: string;
  onNav: (v: ViewMode) => void;
}

type SparkPoint = { date: string; close: number };

function Stat({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-1.5">
      <span className="font-terminal text-[8px] tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-terminal text-[10px] tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}

function QuoteSparkline({ data, isUp }: { data: SparkPoint[]; isUp: boolean }) {
  if (data.length < 2) return null;
  const closes = data.map((point) => point.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = Math.max(max - min, Math.abs(max) * 0.0001, 0.01);
  const points = data.map((point, index) => {
    const x = (index / Math.max(1, data.length - 1)) * 126 + 1;
    const y = 37 - ((point.close - min) / span) * 34;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  return (
    <svg
      className={`h-10 w-32 shrink-0 ${isUp ? "text-up" : "text-down"}`}
      viewBox="0 0 128 40"
      preserveAspectRatio="none"
      data-quote-sparkline
      aria-hidden="true"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Signal({ label, value, tone = "text-foreground" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border-b border-border/50 py-2 last:border-b-0">
      <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-terminal text-[11px] font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function MarketDepthUnavailable() {
  return (
    <div className="border border-border/60 bg-[#060606] px-3 py-2" data-market-depth-status="unavailable">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-terminal text-[7px] font-bold tracking-widest text-muted-foreground">MARKET DEPTH</span>
        <span className="border border-amber-500/25 bg-amber-500/[0.04] px-1.5 py-0.5 font-terminal text-[7px] tracking-widest text-amber-300">FEED NOT CONNECTED</span>
        <span className="font-terminal text-[7px] leading-4 text-muted-foreground">
          Source-backed Level 2/order-book data is unavailable. LiOS does not synthesize bids, asks, spread, or depth from last price.
        </span>
      </div>
    </div>
  );
}

export default function QuotePanel({ symbol, onNav }: Props) {
  const { data: q, isLoading } = useQuote(symbol);
  const { data: peers } = usePeers(symbol);
  const { data: ohlcvSeries } = useOHLCV(symbol, "1M");
  const { data: news } = useNews(symbol);
  const { data: fundamentals } = useFundamentals(symbol);

  const marketCap = q?.marketCap ?? fundamentals?.marketCap ?? null;
  const pe = q?.pe ?? fundamentals?.trailingPE ?? null;
  const eps = q?.eps ?? fundamentals?.trailingEps ?? null;

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-10 w-64 bg-border" />
        <Skeleton className="h-16 w-full bg-border" />
        <div className="grid grid-cols-2 gap-px lg:grid-cols-4">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-56 bg-border" />)}
        </div>
      </div>
    );
  }

  if (!q) {
    return <div className="p-6 font-terminal text-sm text-muted-foreground">No data for {symbol}</div>;
  }

  const range52Pct = q.high52 === q.low52 ? 50 : ((q.price - q.low52) / (q.high52 - q.low52)) * 100;
  const dayRangePct = q.dayHigh === q.dayLow ? 50 : ((q.price - q.dayLow) / (q.dayHigh - q.dayLow)) * 100;
  const chartData: SparkPoint[] = (ohlcvSeries?.bars ?? []).map((bar) => ({
    date: bar.date.slice(5),
    close: bar.close,
  }));
  const isChartUp = chartData.length > 1 && chartData[chartData.length - 1].close >= chartData[0].close;
  const firstClose = chartData[0]?.close ?? null;
  const lastClose = chartData[chartData.length - 1]?.close ?? null;
  const return30d = firstClose && lastClose ? ((lastClose / firstClose) - 1) * 100 : null;
  const volumeVsAvg = q.avgVolume > 0 ? q.volume / q.avgVolume : null;
  const currency = getCurrencySymbol(q.symbol);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin" data-quote-overview>
      <div className="border-b border-border bg-[#060606] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-terminal text-xl font-bold text-[hsl(38,95%,55%)]">{q.symbol}</span>
              {q.exchange && <span className="border border-border px-1.5 py-0.5 font-terminal text-[8px] text-muted-foreground">{q.exchange}</span>}
              {q.sector && <span className="border border-cyan-500/30 px-1.5 py-0.5 font-terminal text-[8px] text-cyan-300">{q.sector}</span>}
              {(q.status?.isFallback || q.status?.freshness !== "current") && <DataStatusBadge status={q.status} compact />}
            </div>
            <div className="mt-0.5 truncate font-terminal text-[10px] text-muted-foreground">{q.name}</div>
          </div>

          <div className="flex shrink-0 gap-1.5">
            <button onClick={() => onNav("chart")} className="flex items-center gap-1.5 border border-border px-2.5 py-1.5 font-terminal text-[9px] text-muted-foreground transition-colors hover:border-amber-500/60 hover:text-amber-300">
              <ChartIcon className="h-3 w-3" /> CHART
            </button>
            <button onClick={() => onNav("news")} className="flex items-center gap-1.5 border border-border px-2.5 py-1.5 font-terminal text-[9px] text-muted-foreground transition-colors hover:border-amber-500/60 hover:text-amber-300">
              <BarChart2 className="h-3 w-3" /> NEWS
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            {q.price === 0 && q.status?.isFallback ? (
              <span className="font-terminal text-xl font-bold tabular-nums text-red-300">NO LIVE DATA</span>
            ) : (
              <>
                <span className="font-terminal text-3xl font-bold tabular-nums text-foreground">{currency}{formatPrice(q.price)}</span>
                <span className={`font-terminal text-base font-semibold tabular-nums ${pctClass(q.change)}`}>
                  {q.change >= 0 ? "+" : ""}{q.change.toFixed(2)}
                </span>
                <span className={`font-terminal text-base font-semibold tabular-nums ${pctClass(q.changePercent)}`}>
                  {q.changePercent >= 0 ? "+" : ""}{q.changePercent.toFixed(2)}%
                </span>
              </>
            )}
          </div>

          <div className="flex items-end gap-2">
            {return30d !== null && (
              <div className="pb-1 text-right">
                <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">30D</div>
                <div className={`font-terminal text-[10px] font-bold tabular-nums ${pctClass(return30d)}`}>
                  {return30d >= 0 ? "+" : ""}{return30d.toFixed(2)}%
                </div>
              </div>
            )}
            <QuoteSparkline data={chartData} isUp={isChartUp} />
          </div>
        </div>

        <div className="mt-2 max-w-3xl">
          <div className="mb-1 flex justify-between font-terminal text-[7px] text-muted-foreground">
            <span>DAY LO {formatPrice(q.dayLow)}</span>
            <span>DAY HI {formatPrice(q.dayHigh)}</span>
          </div>
          <div className="relative h-1 bg-border">
            <div className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 bg-amber-300" style={{ left: `${Math.max(1, Math.min(99, dayRangePct))}%` }} />
          </div>
        </div>
      </div>

      <div className="grid gap-px bg-border lg:grid-cols-4" data-quote-analytical-grid>
        <section className="bg-[#060606] p-3">
          <div className="panel-label mb-2">KEY STATISTICS</div>
          <Stat label="MARKET CAP" value={formatBig(marketCap, q.symbol)} />
          <Stat label="P/E" value={pe !== null ? pe.toFixed(1) : "N/A"} />
          <Stat label="EPS (TTM)" value={eps !== null ? `${currency}${eps.toFixed(2)}` : "N/A"} />
          <Stat label="FORWARD P/E" value={fundamentals?.forwardPE != null ? fundamentals.forwardPE.toFixed(1) : "N/A"} />
          <Stat label="P/B" value={fundamentals?.priceToBook != null ? fundamentals.priceToBook.toFixed(2) : "N/A"} />
          <Stat label="DIV YIELD" value={fundamentals?.dividendYield != null ? `${fundamentals.dividendYield.toFixed(2)}%` : "N/A"} />
          <Stat label="BETA" value={fundamentals?.beta != null ? fundamentals.beta.toFixed(2) : "N/A"} />
          <Stat label="VOLUME" value={q.volume.toLocaleString()} />
          <Stat label="AVG VOLUME" value={q.avgVolume.toLocaleString()} />
          <Stat label="OPEN" value={`${currency}${formatPrice(q.open)}`} />
          <Stat label="PREV CLOSE" value={`${currency}${formatPrice(q.previousClose)}`} />
        </section>

        <section className="bg-[#060606] p-3">
          <div className="panel-label mb-2">MARKET POSITION</div>
          <Signal
            label="30D RETURN"
            value={return30d === null ? "N/A" : `${return30d >= 0 ? "+" : ""}${return30d.toFixed(2)}%`}
            tone={return30d === null ? "text-muted-foreground" : pctClass(return30d)}
          />
          <Signal label="DAY RANGE POSITION" value={`${Math.max(0, Math.min(100, dayRangePct)).toFixed(0)}%`} />
          <Signal label="52W RANGE POSITION" value={`${Math.max(0, Math.min(100, range52Pct)).toFixed(0)}%`} />
          <Signal label="FROM 52W HIGH" value={q.high52 === 0 ? "N/A" : `${((q.price / q.high52) - 1) * 100 >= 0 ? "+" : ""}${(((q.price / q.high52) - 1) * 100).toFixed(1)}%`} tone="text-down" />
          <Signal label="FROM 52W LOW" value={q.low52 === 0 ? "N/A" : `+${(((q.price / q.low52) - 1) * 100).toFixed(1)}%`} tone="text-up" />
          <Signal label="VOLUME / AVG" value={volumeVsAvg === null ? "N/A" : `${volumeVsAvg.toFixed(2)}×`} tone={volumeVsAvg !== null && volumeVsAvg >= 1.5 ? "text-amber-300" : "text-foreground"} />
          <div className="mt-3">
            <div className="mb-1 flex justify-between font-terminal text-[7px] text-muted-foreground">
              <span>{currency}{formatPrice(q.low52)}</span>
              <span>52W</span>
              <span>{currency}{formatPrice(q.high52)}</span>
            </div>
            <div className="relative h-1 bg-border">
              <div className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 bg-amber-300" style={{ left: `${Math.max(1, Math.min(99, range52Pct))}%` }} />
            </div>
          </div>
        </section>

        <section className="bg-[#060606] p-3">
          <div className="panel-label mb-2">PEER COMPARISON</div>
          <div className="grid grid-cols-3 border-b border-border py-1 font-terminal text-[7px] text-muted-foreground">
            <span>TICKER</span><span className="text-right">PRICE</span><span className="text-right">CHG%</span>
          </div>
          <div className="grid grid-cols-3 border-b border-border/50 bg-amber-500/[0.06] py-1.5">
            <span className="font-terminal text-[9px] font-bold text-amber-300">{q.symbol}</span>
            <span className="text-right font-terminal text-[9px] tabular-nums">{formatPrice(q.price)}</span>
            <span className={`text-right font-terminal text-[9px] tabular-nums ${pctClass(q.changePercent)}`}>{formatPct(q.changePercent)}</span>
          </div>
          {(peers || []).slice(0, 8).map((peer: any) => (
            <div key={peer.symbol} className="grid grid-cols-3 border-b border-border/50 py-1.5 hover:bg-white/[0.03]">
              <span className="font-terminal text-[9px] text-cyan-300">{peer.symbol}</span>
              <span className="text-right font-terminal text-[9px] tabular-nums">{formatPrice(peer.price)}</span>
              <span className={`text-right font-terminal text-[9px] tabular-nums ${pctClass(peer.changePercent)}`}>{formatPct(peer.changePercent)}</span>
            </div>
          ))}
        </section>

        <section className="bg-[#060606] p-3">
          <div className="panel-label mb-2">RECENT EVIDENCE</div>
          {(news || []).length === 0 ? (
            <div className="py-3 font-terminal text-[8px] text-muted-foreground">No source-attributed news.</div>
          ) : (
            (news || []).slice(0, 6).map((item: any, index) => (
              <a key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noreferrer" className="block border-b border-border/50 py-2 hover:bg-white/[0.03]">
                <div className="line-clamp-2 font-terminal text-[9px] leading-snug text-foreground">{item.title}</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="truncate font-terminal text-[7px] text-amber-400">{item.source}</span>
                  <span className={`font-terminal text-[7px] ${item.sentiment === "positive" ? "text-up" : item.sentiment === "negative" ? "text-down" : "text-muted-foreground"}`}>
                    {item.sentiment === "positive" ? "▲ POS" : item.sentiment === "negative" ? "▼ NEG" : "● NEUTRAL"}
                  </span>
                </div>
              </a>
            ))
          )}
        </section>
      </div>

      <div className="border-t border-border bg-[#050505] px-3 py-2">
        <MarketDepthUnavailable />
      </div>
    </div>
  );
}
