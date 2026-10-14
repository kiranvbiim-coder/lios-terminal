import { useState } from "react";
import { Zap } from "lucide-react";
import { useLseStatus, useLseOptionsFlow } from "@/lib/useLse";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props { onSymbol: (s: string) => void; onNav: (v: ViewMode) => void }

const PREMIUM_FILTERS = [
  { value: 0, label: "ALL PREMIUM" },
  { value: 50_000, label: "$50K+" },
  { value: 250_000, label: "$250K+" },
  { value: 1_000_000, label: "$1M+" },
];

function fmtMoney(v: number) {
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${(v / 1_000).toFixed(0)}K`;
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function OptionsFlowScannerPanel({ onSymbol }: Props) {
  const { data: status } = useLseStatus();
  const [underlying, setUnderlying] = useState("");
  const [type, setType] = useState<"call" | "put" | "">("");
  const [minPremium, setMinPremium] = useState(50_000);
  const { data: prints, isLoading } = useLseOptionsFlow(underlying || undefined, type || undefined, minPremium);
  const configured = status?.configured ?? false;

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <Zap className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">OPTIONS FLOW SCANNER</span>
        <input
          value={underlying}
          onChange={(e) => setUnderlying(e.target.value.toUpperCase())}
          placeholder="UNDERLYING (E.G. NVDA)..."
          className="ml-4 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground w-40 focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
        />
        <div className="flex border border-border">
          {(["", "call", "put"] as const).map((t) => (
            <button
              key={t || "all"}
              onClick={() => setType(t)}
              className={`px-2 py-1 font-terminal text-[8px] tracking-wider ${type === t ? "bg-[hsl(38,95%,50%)]/15 text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t === "" ? "ALL" : t.toUpperCase()}
            </button>
          ))}
        </div>
        <select
          value={minPremium}
          onChange={(e) => setMinPremium(Number(e.target.value))}
          className="bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none"
        >
          {PREMIUM_FILTERS.map((p) => <option key={p.value} value={p.value} className="bg-[#0d0d0d]">{p.label}</option>)}
        </select>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">OPTF</span>
      </div>

      {!configured ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md text-center font-terminal text-[10px] text-muted-foreground border border-border px-4 py-3">
            NO LSE_API_KEY CONFIGURED — GET A FREE KEY AT LONDONSTRATEGICEDGE.COM/DATA. VALUES BELOW WILL POPULATE ONCE ONE IS SET. HONEST STATE, NOT A BUG.
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {isLoading ? (
            <div className="p-4 font-terminal text-[9px] text-muted-foreground">LOADING...</div>
          ) : !prints?.length ? (
            <div className="p-4 font-terminal text-[9px] text-muted-foreground">NO PRINTS MATCH THIS FILTER.</div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-[#070707] z-10">
                <tr className="border-b border-border">
                  {["TIME", "TICKER", "UNDERLYING", "TYPE", "PRICE", "SIZE", "PREMIUM", "IV", "DELTA"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {prints.map((p, i) => (
                  <tr key={`${p.ticker}-${p.ts}-${i}`} className="border-b border-border/30 hover:bg-white/[1.5%] cursor-pointer" onClick={() => onSymbol(p.underlying)}>
                    <td className="px-3 py-2.5 font-terminal text-[8px] tabular-nums text-muted-foreground">{fmtTime(p.ts)}</td>
                    <td className="px-3 py-2.5 font-terminal text-[8px] text-foreground">{p.ticker}</td>
                    <td className="px-3 py-2.5 font-terminal text-[10px] font-bold text-foreground">{p.underlying}</td>
                    <td className={`px-3 py-2.5 font-terminal text-[9px] font-bold ${p.contract_type === "call" ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{p.contract_type?.toUpperCase()}</td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">${p.last_price?.toFixed(2)}</td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">{p.volume?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums font-bold text-[hsl(38,95%,55%)]">{fmtMoney(p.premium)}</td>
                    <td className="px-3 py-2.5 font-terminal text-[8px] tabular-nums text-muted-foreground">{p.iv !== null && p.iv !== undefined ? `${(p.iv * 100).toFixed(0)}%` : "—"}</td>
                    <td className="px-3 py-2.5 font-terminal text-[8px] tabular-nums text-muted-foreground">{p.delta !== null && p.delta !== undefined ? p.delta.toFixed(2) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
