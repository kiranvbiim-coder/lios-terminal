import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import DataStatusBadge from "@/components/data/DataStatusBadge";
import type { DataStatus } from "@/lib/finance";

/**
 * Shiller CAPE (cyclically-adjusted P/E) ratio, backed by
 * /api/finance/cape using a user-supplied, locally licensed monthly series.
 * No dataset is bundled or downloaded. The server validates observations
 * and computes historical context from the supplied series only.
 */
interface CapeSnapshot {
  current: { year: number; month: number; cape: number };
  percentile: number;
  mean: number;
  median: number;
  min: { cape: number; year: number; month: number };
  max: { cape: number; year: number; month: number };
  count: number;
  series: Array<{ year: number; month: number; cape: number }>;
  asOf: string;
}

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtMonth(year: number, month: number) {
  return `${MONTH_NAMES[month]} ${year}`;
}

function percentileColor(p: number) {
  if (p >= 90) return "text-[hsl(0,80%,60%)]";
  if (p >= 70) return "text-[hsl(38,95%,55%)]";
  if (p <= 20) return "text-[hsl(142,71%,55%)]";
  return "text-foreground";
}

export default function ShillerCapePanel() {
  const [data, setData] = useState<CapeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/finance/cape")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(typeof body?.error === "string" ? body.error : "Shiller CAPE source unavailable. Supply a licensed local JSON series via LIOS_SHILLER_CAPE_FILE.");
        }
        return body as CapeSnapshot;
      })
      .then(setData)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Couldn't load the configured Shiller CAPE source."));
  }, []);

  if (error) return <div role="alert" className="p-6 font-terminal text-sm text-muted-foreground">{error}</div>;
  if (!data) return <div className="p-6 font-terminal text-sm text-muted-foreground animate-pulse">Loading Shiller CAPE...</div>;

  const status: DataStatus = {
    provider: "User-supplied Shiller CAPE",
    freshness: "snapshot",
    asOf: data.asOf,
    delayLabel: "Locally supplied monthly series; data rights remain the user's responsibility",
    isFallback: false,
  };

  const chartData = data.series.map((m) => ({ label: `${m.year}-${String(m.month).padStart(2, "0")}`, cape: m.cape }));

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="panel-label">SHILLER CAPE RATIO</div>
          <div className="font-terminal text-[9px] text-muted-foreground mt-1">Cyclically-adjusted P/E · S&amp;P 500 · real price ÷ 10-yr average real earnings</div>
        </div>
        <DataStatusBadge status={status} showAsOf />
      </div>

      <div className="bg-[#080808] border border-border p-5 flex items-end gap-8 flex-wrap">
        <div>
          <div className="font-terminal text-[9px] tracking-widest text-muted-foreground">CURRENT — {fmtMonth(data.current.year, data.current.month).toUpperCase()}</div>
          <div className="font-terminal text-5xl font-bold text-foreground mt-1">{data.current.cape.toFixed(2)}</div>
        </div>
        <div>
          <div className="font-terminal text-[9px] tracking-widest text-muted-foreground">PERCENTILE</div>
          <div className={`font-terminal text-3xl font-bold ${percentileColor(data.percentile)}`}>{data.percentile.toFixed(1)}<span className="text-lg">th</span></div>
          <div className="font-terminal text-[8px] text-muted-foreground mt-0.5">of {data.count.toLocaleString()} months since {(data.series[0]?.year ?? "")}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
        <div className="border border-border/50 p-2.5 bg-[#080808]">
          <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">MEAN</div>
          <div className="font-terminal text-base font-bold text-foreground mt-0.5">{data.mean.toFixed(2)}</div>
        </div>
        <div className="border border-border/50 p-2.5 bg-[#080808]">
          <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">MEDIAN</div>
          <div className="font-terminal text-base font-bold text-foreground mt-0.5">{data.median.toFixed(2)}</div>
        </div>
        <div className="border border-border/50 p-2.5 bg-[#080808]">
          <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">SUPPLIED HISTORY LOW</div>
          <div className="font-terminal text-base font-bold text-[hsl(142,71%,55%)] mt-0.5">{data.min.cape.toFixed(2)}</div>
          <div className="font-terminal text-[7px] text-muted-foreground">{fmtMonth(data.min.year, data.min.month)}</div>
        </div>
        <div className="border border-border/50 p-2.5 bg-[#080808]">
          <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">SUPPLIED HISTORY HIGH</div>
          <div className="font-terminal text-base font-bold text-[hsl(0,80%,60%)] mt-0.5">{data.max.cape.toFixed(2)}</div>
          <div className="font-terminal text-[7px] text-muted-foreground">{fmtMonth(data.max.year, data.max.month)}</div>
        </div>
      </div>

      <div className="bg-[#080808] border border-border p-4">
        <div className="panel-label mb-3">SUPPLIED HISTORY — {data.series[0]?.year} TO {fmtMonth(data.current.year, data.current.month).toUpperCase()}</div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id="fill-cape" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(38,95%,55%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(38,95%,55%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false} axisLine={false} interval={239} />
            <YAxis tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false} axisLine={false} domain={[0, "auto"]} width={30} />
            <ReferenceLine y={data.mean} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
            <Tooltip
              contentStyle={{ background: "#111", border: "1px solid hsl(var(--border))", borderRadius: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}
              formatter={(v: any) => [v.toFixed(2), "CAPE"]}
              labelStyle={{ color: "hsl(38,95%,55%)" }}
            />
            <Area type="monotone" dataKey="cape" stroke="hsl(38,95%,55%)" strokeWidth={1.2} fill="url(#fill-cape)" dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-[#080808] border border-border p-4 font-terminal text-[9px] text-muted-foreground space-y-1">
        <div className="text-foreground font-bold mb-1 tracking-widest">WHAT THIS MEASURES</div>
        <p>CAPE (cyclically-adjusted price-to-earnings, or "P/E10") divides the observation month's real (inflation-adjusted) S&amp;P 500 price by the average of the preceding 10 years of real earnings — smoothing out a single year's cyclical swing so the ratio reflects valuation against a full business cycle of earnings power, not just the latest quarter. Developed by Robert Shiller (Yale) and John Campbell.</p>
        <p>A high reading means the market is priced well above its own trailing decade of earnings — not a timing signal on its own (CAPE has stayed elevated for years before any correction). The percentile and summary statistics here describe only the locally supplied history, not necessarily the complete Shiller series.</p>
      </div>
    </div>
  );
}
