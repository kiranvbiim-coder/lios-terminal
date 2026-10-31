import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useEffect, useMemo } from "react";
import { Sparkles, Download } from "lucide-react";
import DataStatusBadge from "@/components/data/DataStatusBadge";
import type { DataStatus } from "@/lib/finance";

/**
 * Cross-Domain Intelligence Fusion (Phase 4) -- makes Finance and Economics
 * reason about each other for one client, per the roadmap's own framing:
 * "your semiconductor exposure is 23%, here's how the last three rate-cut
 * cycles moved that sector." Zero AI: this is two real, independently
 * fetchable datasets joined together --
 *   - the client's own real sector exposure, from /api/client/dashboard/
 *     portfolio (the org's actual holdings, entered by the internal team --
 *     not the scratch/practice tool in PortfolioPanel.tsx)
 *   - live Fed rate-cutting-cycle history joined against the matching
 *     sector ETF's real price history, from /api/finance/rate-cycle-impact
 * (see server/crossDomainService.ts for both).
 *
 * Client-only: "your exposure" has no meaning for an internal analyst, who
 * has no personal portfolio in this data model -- portfolios belong to a
 * client organizationId, not a user.
 */

// Same 11 sectors server/crossDomainService.ts's SECTOR_ETF_PROXY maps --
// duplicated here as a fixed, known display list (not fetched) since a
// round-trip just to learn 11 constant sector names isn't worth it. Keep
// in sync if that list ever changes.
const SECTOR_ETF_LABEL: Record<string, string> = {
  "Technology": "XLK", "Healthcare": "XLV", "Financial Services": "XLF",
  "Consumer Cyclical": "XLY", "Consumer Defensive": "XLP", "Industrials": "XLI",
  "Energy": "XLE", "Basic Materials": "XLB", "Real Estate": "XLRE",
  "Utilities": "XLU", "Communication Services": "XLC",
};
const SECTORS = Object.keys(SECTOR_ETF_LABEL);

interface PortfolioPosition { symbol: string; shares: number; price: number | null; marketValue: number | null; sector: string }
interface PortfolioResponse { id: number; name: string; positions: PortfolioPosition[] }

interface RateCycleImpact {
  startDate: string; endDate: string; startRate: number; endRate: number;
  changePp: number; sectorReturnPct: number | null;
}
interface RateCycleImpactResult {
  sector: string; etfSymbol: string; currentFedFundsRate: number | null; cycles: RateCycleImpact[];
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function CrossDomainFusionPanel() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([]);
  const [exposure, setExposure] = useState<Record<string, number> | null>(null);
  const [selectedSector, setSelectedSector] = useTerminalArtifactState<string | null>("CrossDomainFusionPanel.selectedSector", null);
  const [impact, setImpact] = useState<RateCycleImpactResult | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

  // Client's real sector exposure, computed from their real holdings.
  useEffect(() => {
    fetch("/api/client/dashboard/portfolio")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: PortfolioResponse[]) => {
        setPortfolios(data);
        const bySector: Record<string, number> = {};
        let total = 0;
        for (const p of data) {
          for (const pos of p.positions) {
            const value = pos.marketValue ?? 0;
            const sector = pos.sector || "Other";
            bySector[sector] = (bySector[sector] ?? 0) + value;
            total += value;
          }
        }
        const pct: Record<string, number> = {};
        if (total > 0) {
          for (const [sector, value] of Object.entries(bySector)) pct[sector] = (value / total) * 100;
        }
        setExposure(pct);
        const topSector = Object.entries(pct)
          .filter(([sector]) => SECTOR_ETF_LABEL[sector])
          .sort((a, b) => b[1] - a[1])[0]?.[0];
        setSelectedSector(current => current ?? topSector ?? "Technology");
      })
      .catch(() => { setExposure({}); setSelectedSector(current => current ?? "Technology"); });
  }, []);

  useEffect(() => {
    if (!selectedSector) return;
    setLoadingImpact(true);
    fetch(`/api/finance/rate-cycle-impact?sector=${encodeURIComponent(selectedSector)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setImpact)
      .catch(() => setImpact(null))
      .finally(() => setLoadingImpact(false));
  }, [selectedSector]);

  const exposurePct = selectedSector && exposure ? exposure[selectedSector] ?? 0 : 0;

  const status: DataStatus = {
    provider: "LiOS Intelligence",
    freshness: "current",
    asOf: new Date().toISOString(),
    delayLabel: "Live Federal Reserve policy rate + sector ETF price history",
    isFallback: false,
  };

  const avgReturn = useMemo(() => {
    if (!impact) return null;
    const valid = impact.cycles.map((c) => c.sectorReturnPct).filter((v): v is number => v !== null);
    if (!valid.length) return null;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }, [impact]);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="panel-label">CROSS-DOMAIN: RATE CYCLES × SECTOR EXPOSURE</div>
          <div className="font-terminal text-[9px] text-muted-foreground mt-1">Finance × Economics, joined for your actual holdings — no AI, purely two real datasets</div>
        </div>
        <DataStatusBadge status={status} />
      </div>

      <div className="bg-[#080808] border border-border p-5">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="font-terminal text-[9px] tracking-widest text-muted-foreground">
              {exposure && Object.keys(exposure).length > 0 ? "YOUR EXPOSURE" : "EXPLORE A SECTOR"}
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-terminal text-4xl font-bold text-foreground">{exposurePct.toFixed(1)}%</span>
              <span className="font-terminal text-sm text-muted-foreground">of your portfolio in {selectedSector}</span>
            </div>
          </div>
          <select
            value={selectedSector ?? ""}
            onChange={(e) => setSelectedSector(e.target.value)}
            className="px-3 py-2 bg-muted border border-border font-terminal text-xs text-foreground focus:outline-none"
          >
            {SECTORS.map((s) => (
              <option key={s} value={s}>{s} ({SECTOR_ETF_LABEL[s]}){exposure?.[s] ? ` — ${exposure[s].toFixed(1)}%` : ""}</option>
            ))}
          </select>
        </div>
        {exposure && Object.keys(exposure).length === 0 && (
          <p className="font-terminal text-[9px] text-muted-foreground mt-3">No holdings on file yet — showing sector history for the one selected above. Your relationship team can add real positions to personalize this.</p>
        )}
      </div>

      <div className="bg-[#080808] border border-border p-4">
        <div className="panel-label mb-1">HOW THE LAST {impact?.cycles.length ?? "…"} FED RATE-CUTTING CYCLES MOVED {impact?.etfSymbol ?? "…"}</div>
        {impact && (
          <p className="font-terminal text-[9px] text-muted-foreground mb-3">
            Current Fed Funds Rate: {impact.currentFedFundsRate !== null ? `${impact.currentFedFundsRate.toFixed(2)}%` : "N/A"}
            {avgReturn !== null && <> · Average {selectedSector} return across these cycles: <span className={avgReturn >= 0 ? "text-up" : "text-down"}>{avgReturn >= 0 ? "+" : ""}{avgReturn.toFixed(1)}%</span></>}
          </p>
        )}

        {loadingImpact ? (
          <div className="p-8 text-center font-terminal text-sm text-muted-foreground animate-pulse">Loading cycle history...</div>
        ) : !impact || impact.cycles.length === 0 ? (
          <div className="p-8 text-center font-terminal text-sm text-muted-foreground border border-dashed border-border">No cutting cycles found — the Fed rate feed may be unavailable right now.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left px-2 py-2 font-medium">Cycle</th>
                  <th className="text-right px-2 py-2 font-medium">Fed Funds Rate</th>
                  <th className="text-right px-2 py-2 font-medium">Change</th>
                  <th className="text-right px-2 py-2 font-medium">{impact.etfSymbol} Return</th>
                </tr>
              </thead>
              <tbody>
                {impact.cycles.map((c) => (
                  <tr key={c.startDate} className="border-b border-border/50 last:border-0">
                    <td className="px-2 py-2.5 text-foreground whitespace-nowrap">{fmtDate(c.startDate)} — {fmtDate(c.endDate)}</td>
                    <td className="px-2 py-2.5 text-right font-mono-num text-muted-foreground whitespace-nowrap">{c.startRate.toFixed(2)}% → {c.endRate.toFixed(2)}%</td>
                    <td className="px-2 py-2.5 text-right font-mono-num text-down whitespace-nowrap">{c.changePp.toFixed(2)}pp</td>
                    <td className={`px-2 py-2.5 text-right font-mono-num font-bold whitespace-nowrap ${c.sectorReturnPct === null ? "text-muted-foreground" : c.sectorReturnPct >= 0 ? "text-up" : "text-down"}`}>
                      {c.sectorReturnPct === null ? "N/A" : `${c.sectorReturnPct >= 0 ? "+" : ""}${c.sectorReturnPct.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {portfolios.some((p) => p.positions.length > 0) && (
        <div className="bg-[#080808] border border-border p-4">
          <div className="panel-label mb-3">YOUR HOLDINGS</div>
          {portfolios.filter((p) => p.positions.length > 0).map((p) => (
            <div key={p.id} className="mb-4 last:mb-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground">{p.name}</span>
                <button
                  onClick={() => window.open(`/api/client/dashboard/portfolio/${p.id}/export`, "_blank", "noopener,noreferrer")}
                  className="flex items-center gap-1.5 px-2 py-1 border border-[hsl(38,95%,50%)/40%] text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)/10%] hover:bg-[hsl(38,95%,50%)/20%] text-[9px] font-terminal uppercase tracking-wider transition-colors"
                >
                  <Download className="w-3 h-3" /> Export CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="font-terminal text-[8px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="text-left px-2 py-1.5 font-medium">Symbol</th>
                      <th className="text-left px-2 py-1.5 font-medium">Sector</th>
                      <th className="text-right px-2 py-1.5 font-medium">Shares</th>
                      <th className="text-right px-2 py-1.5 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.positions.map((pos) => (
                      <tr key={pos.symbol} className="border-b border-border/40 last:border-0">
                        <td className="px-2 py-1.5 text-foreground font-terminal font-bold">{pos.symbol}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{pos.sector}</td>
                        <td className="px-2 py-1.5 text-right font-mono-num text-muted-foreground">{pos.shares.toLocaleString("en-US")}</td>
                        <td className="px-2 py-1.5 text-right font-mono-num text-foreground">{pos.marketValue !== null ? `$${pos.marketValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-[#080808] border border-border p-4 font-terminal text-[9px] text-muted-foreground space-y-1 flex gap-2">
        <Sparkles className="w-3.5 h-3.5 text-[hsl(38,95%,55%)] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p><span className="text-foreground font-bold">WHAT THIS SHOWS.</span> Fed easing cycles are detected directly from the live FEDFUNDS series (peak-to-trough decline of at least 0.5 percentage points) — not a hand-picked or fabricated list of dates. Sector return is the real price change of the sector's actual SPDR Select Sector ETF ({impact?.etfSymbol ?? "the sector ETF"}) across each cycle's exact date window, not an estimate.</p>
          <p>Past cycles are not a forecast — each historical cutting cycle had a different cause (recession, financial crisis, pre-emptive easing), and sector performance during any one of them reflects that specific episode, not a repeatable pattern. This is real historical context for a conversation with your advisory team, not a prediction.</p>
        </div>
      </div>
    </div>
  );
}
