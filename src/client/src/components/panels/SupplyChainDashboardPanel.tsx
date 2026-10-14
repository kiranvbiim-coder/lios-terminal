import { Truck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupplyChainIndicators } from "@/lib/useEconomics";
import type { ViewMode } from "@/lib/terminalTypes";

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

interface Props {
  onNav: (v: ViewMode) => void;
}

export default function SupplyChainDashboardPanel({ onNav }: Props) {
  const { data: indicators, isLoading } = useSupplyChainIndicators();
  const anyLive = indicators?.some((i) => i.isLive) ?? false;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4">
      <div className="flex items-center gap-2 mb-4">
        <Truck className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
        <span className="font-terminal text-[11px] tracking-widest text-foreground">FREIGHT &amp; LOGISTICS DASHBOARD — OPERATIONS &amp; SUPPLY CHAIN</span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {Array(7).fill(0).map((_, i) => <Skeleton key={i} className="h-24 bg-border" />)}
        </div>
      ) : (
        <>
          {!anyLive && (
            <div className="mb-4 font-terminal text-[9px] text-muted-foreground border border-border px-3 py-2">
              NO LIVE FEED CONFIGURED (FRED_API_KEY) — VALUES BELOW WILL POPULATE ONCE ONE IS SET. HONEST STATE, NOT A BUG.
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {(indicators ?? []).map((ind) => (
              <button
                key={ind.seriesId}
                onClick={() => onNav("supplychainindicators")}
                className="text-left border border-border bg-[#0a0a0a] hover:border-[hsl(38,95%,50%)]/40 transition-colors p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-terminal text-[9px] text-muted-foreground truncate pr-2">{ind.name.toUpperCase()}</span>
                  {!ind.isLive && (
                    <span className="font-terminal text-[8px] text-[hsl(0,80%,60%)] border border-[hsl(0,80%,60%)]/40 px-1 shrink-0">NO DATA</span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-terminal text-lg text-foreground">{fmtValue(ind.value, ind.unit)}</span>
                  {ind.changePercent !== null && (
                    <span className={`font-terminal text-[10px] ${pctClass(ind.changePercent)}`}>
                      {ind.changePercent >= 0 ? "+" : ""}{ind.changePercent.toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="font-terminal text-[8px] text-muted-foreground">
                  {ind.asOf ? `AS OF ${fmtDate(ind.asOf).toUpperCase()}` : ind.unit}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
