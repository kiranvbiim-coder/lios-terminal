import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo } from "react";
import { Scale } from "lucide-react";
import { useCftcCot } from "@/lib/useOfficialSources";

const FUTURES_CODES = [
  { code: "GC", label: "GOLD" },
  { code: "SI", label: "SILVER" },
  { code: "CL", label: "CRUDE OIL" },
  { code: "NG", label: "NATURAL GAS" },
  { code: "ES", label: "S&P 500" },
  { code: "ZW", label: "WHEAT" },
  { code: "ZC", label: "CORN" },
  { code: "ZS", label: "SOYBEANS" },
  { code: "HG", label: "COPPER" },
  { code: "6E", label: "EURO FX" },
];

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

export default function CotPositioningPanel() {
  const [symbol, setSymbol] = useTerminalArtifactState("CotPositioningPanel.symbol", "GC");
  const { data: rows, isLoading } = useCftcCot(symbol);

  const columns = useMemo(() => {
    if (!rows?.length) return [];
    const keys = new Set<string>();
    for (const r of rows.slice(0, 5)) Object.keys(r).forEach((k) => k !== "symbol" && keys.add(k));
    const ordered = Array.from(keys);
    ordered.sort((a, b) => (a === "date" ? -1 : b === "date" ? 1 : 0));
    return ordered;
  }, [rows]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <Scale className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">COT POSITIONING — COMMITMENT OF TRADERS</span>
        <span className="font-terminal text-[7px] text-[hsl(142,71%,50%)] tracking-widest border border-[hsl(142,71%,30%)]/40 px-1.5 py-0.5">CFTC OFFICIAL</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">COT</span>
      </div>

      <div className="flex border-b border-border bg-[#060606] shrink-0 overflow-x-auto scrollbar-thin">
        {FUTURES_CODES.map((f) => (
          <button
            key={f.code}
            onClick={() => setSymbol(f.code)}
            className={`px-3 py-2 font-terminal text-[8px] tracking-wider whitespace-nowrap border-r border-border/50 ${
              symbol === f.code ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)] border-b-2 border-b-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.code} · {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin">
        {isLoading ? (
          <div className="p-4 font-terminal text-[9px] text-muted-foreground">LOADING...</div>
        ) : !rows?.length ? (
          <div className="p-4 font-terminal text-[9px] text-muted-foreground">NO COT DATA AVAILABLE FOR {symbol}.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[#070707] z-10">
              <tr className="border-b border-border">
                {columns.map((c) => (
                  <th key={c} className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider whitespace-nowrap">{c.replace(/_/g, " ").toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.symbol}-${r.date}-${i}`} className="border-b border-border/30 hover:bg-white/[1.5%]">
                  {columns.map((c) => (
                    <td key={c} className="px-3 py-2.5 font-terminal text-[9px] tabular-nums text-foreground whitespace-nowrap">{fmtCell((r as unknown as Record<string, unknown>)[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="px-4 py-1.5 border-t border-border bg-[#060606] shrink-0">
        <span className="font-terminal text-[7.5px] text-muted-foreground/70">CFTC Commitment of Traders report — official weekly positioning by trader category, direct from publicreporting.cftc.gov. Free, public, no key required.</span>
      </div>
    </div>
  );
}
