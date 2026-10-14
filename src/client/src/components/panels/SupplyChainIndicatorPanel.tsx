import { useState } from "react";
import { Truck } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupplyChainIndicators, useSupplyChainIndicatorDetail } from "@/lib/useEconomics";

function fmtValue(value: number | null, unit: string) {
  if (value === null) return "—";
  const formatted = Math.abs(value) >= 1000 ? value.toLocaleString("en-US", { maximumFractionDigits: 1 }) : value.toFixed(2);
  return unit === "%" ? `${formatted}%` : formatted;
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function pctClass(n: number | null) {
  if (n === null) return "text-muted-foreground";
  return n >= 0 ? "text-[hsl(142,71%,45%)]" : "text-[hsl(0,80%,55%)]";
}

export default function SupplyChainIndicatorPanel() {
  const { data: indicators, isLoading: listLoading } = useSupplyChainIndicators();
  const [selected, setSelected] = useState<string | null>(null);
  const activeSeriesId = selected ?? indicators?.[0]?.seriesId ?? "";
  const { data: detail, isLoading: detailLoading } = useSupplyChainIndicatorDetail(activeSeriesId);

  return (
    <div className="h-full flex">
      <div className="w-56 shrink-0 border-r border-border overflow-y-auto scrollbar-thin">
        <div className="px-3 py-2 border-b border-border">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">FREIGHT &amp; LOGISTICS CATALOG</span>
        </div>
        {listLoading ? (
          <div className="p-3 space-y-2">
            {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-8 bg-border" />)}
          </div>
        ) : (
          (indicators ?? []).map((ind) => (
            <button
              key={ind.seriesId}
              onClick={() => setSelected(ind.seriesId)}
              className={`w-full text-left px-3 py-2 border-b border-border/50 transition-colors ${
                ind.seriesId === activeSeriesId ? "bg-[hsl(38,95%,50%)]/10 border-l-2 border-l-[hsl(38,95%,55%)]" : "hover:bg-white/5"
              }`}
            >
              <div className="font-terminal text-[9px] text-foreground truncate">{ind.name.toUpperCase()}</div>
              <div className="font-terminal text-[8px] text-muted-foreground">{ind.seriesId}</div>
            </button>
          ))
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
        {detailLoading || !detail ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64 bg-border" />
            <Skeleton className="h-40 w-full bg-border" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <Truck className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[10px] tracking-widest text-foreground">{detail.quote.name.toUpperCase()}</span>
              {!detail.quote.isLive && (
                <span className="font-terminal text-[8px] text-[hsl(0,80%,60%)] border border-[hsl(0,80%,60%)]/40 px-1.5 py-0.5">NOT LIVE</span>
              )}
            </div>
            <div className="font-terminal text-[9px] text-muted-foreground mb-4">{detail.quote.seriesId}</div>

            <div className="flex items-baseline gap-4 mb-5">
              <span className="font-terminal text-3xl text-foreground">{fmtValue(detail.quote.value, detail.quote.unit)}</span>
              {detail.quote.changePercent !== null && (
                <span className={`font-terminal text-sm ${pctClass(detail.quote.changePercent)}`}>
                  {detail.quote.changePercent >= 0 ? "+" : ""}{detail.quote.changePercent.toFixed(2)}%
                  {detail.quote.change !== null && ` (${detail.quote.change >= 0 ? "+" : ""}${detail.quote.change.toFixed(2)})`}
                </span>
              )}
            </div>

            {detail.quote.asOf && (
              <div className="font-terminal text-[9px] text-muted-foreground mb-4">AS OF {fmtDate(detail.quote.asOf).toUpperCase()}</div>
            )}

            <div className="h-64 border border-border bg-[#0a0a0a] p-3 mb-4">
              {detail.history.length < 2 ? (
                <div className="h-full flex items-center justify-center font-terminal text-[9px] text-muted-foreground">
                  NO HISTORICAL DATA AVAILABLE
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={detail.history} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="supplyChainIndicatorFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(38,95%,55%)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="hsl(38,95%,55%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 9 }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                    <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 9 }} axisLine={false} tickLine={false} width={50} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{ background: "#0a0a0a", border: "1px solid hsl(0,0%,15%)", fontSize: 11 }}
                      formatter={(v: number) => [fmtValue(v, detail.quote.unit), detail.quote.name]}
                    />
                    <Area type="monotone" dataKey="value" stroke="hsl(38,95%,55%)" strokeWidth={1.5} fill="url(#supplyChainIndicatorFill)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="font-terminal text-[9px] text-muted-foreground">
              UNIT: {detail.quote.unit || "—"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
