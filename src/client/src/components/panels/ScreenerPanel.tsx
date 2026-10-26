import { isObservedQuote } from "@/lib/quoteObservation";
import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useScreener, useDirectoryScreener, useDirectoryRegions, useDirectoryFacets, useDirectoryStatus, useDirectoryInstallStatus, useBondScreener, useMacroScreener } from "@/lib/useFinance";
import { formatPrice, formatBig, pctClass, SCREENER_SECTORS, getCurrencySymbol } from "@/lib/finance";
import { Skeleton } from "@/components/ui/skeleton";
import DataStatusBadge from "@/components/data/DataStatusBadge";
import { SlidersHorizontal, Trophy, TrendingUp, Gem, Flame, Shield, X, Globe2, Landmark, LineChart, Radar, ShieldAlert } from "lucide-react";
import { buildDynamicAnalyticsCatalog, type DynamicFilterOperator } from "@shared/waveCContracts";

interface Props { onSymbol: (sym: string) => void }

type SortField = "symbol" | "price" | "changePercent" | "marketCap" | "pe" | "volume" | "eps" | "high52";
type SortDir = "asc" | "desc";

interface StrategyTemplate {
  id: string;
  label: string;
  icon: typeof Trophy;
  color: string;
  filters: Record<string, string>;
  description: string;
}

const STRATEGIES: StrategyTemplate[] = [
  {
    id: "buffett",
    label: "BUFFETT",
    icon: Trophy,
    color: "hsl(38,95%,55%)",
    description: "Quality moat: ROE>15, D/E<0.5, Margin>20%",
    filters: { minRoe: "15", maxDebt: "0.5", minMargin: "20" },
  },
  {
    id: "momentum",
    label: "MOMENTUM",
    icon: TrendingUp,
    color: "hsl(142,71%,50%)",
    description: "Breakout: Near 52W high, volume spike",
    filters: { minChangePercent: "1", minPe: "5" },
  },
  {
    id: "deepvalue",
    label: "DEEP VALUE",
    icon: Gem,
    color: "hsl(186,80%,55%)",
    description: "Cheap: P/E<12, large cap discount",
    filters: { maxPe: "12" },
  },
  {
    id: "garp",
    label: "GARP",
    icon: Flame,
    color: "hsl(20,90%,55%)",
    description: "Growth at Price: PEG<1.5, Rev Growth>20%",
    filters: { minPe: "10", maxPe: "30" },
  },
  {
    id: "defensive",
    label: "DEFENSIVE",
    icon: Shield,
    color: "hsl(265,70%,65%)",
    description: "Safe haven: Dividend yield>4%, Beta<0.7",
    filters: { maxPe: "25", maxBeta: "0.7" },
  },
];

type ScreenMode = "equity" | "directory" | "bond" | "macro" | "radar";

const MODES: Array<{ id: ScreenMode; label: string; icon: typeof Trophy }> = [
  { id: "equity", label: "EQUITY", icon: Trophy },
  { id: "directory", label: "COUNTRY / ASSET CLASS", icon: Globe2 },
  { id: "bond", label: "BOND", icon: Landmark },
  { id: "macro", label: "MACRO", icon: LineChart },
  { id: "radar", label: "OPPORTUNITY/RISK RADAR", icon: Radar },
];

const DYNAMIC_SCREENER_FIELDS = buildDynamicAnalyticsCatalog().filter((field) => ["market_data.price", "market_data.marketCap", "market_data.volume", "market_data.peRatio", "financial_statements.eps", "metric.pe", "metric.epsBasic", "metric.epsDiluted"].includes(field.id));

export default function ScreenerPanel({ onSymbol }: Props) {
  const [mode, setMode] = useTerminalArtifactState<ScreenMode>("screener.mode", "equity");
  const [sector, setSector] = useTerminalArtifactState("screener.sector", "All");
  const [sortField, setSortField] = useTerminalArtifactState<SortField>("screener.sortField", "changePercent");
  const [sortDir, setSortDir] = useTerminalArtifactState<SortDir>("screener.sortDir", "desc");
  const [minPe, setMinPe] = useTerminalArtifactState("screener.minPe", "");
  const [maxPe, setMaxPe] = useTerminalArtifactState("screener.maxPe", "");
  const [minBeta, setMinBeta] = useTerminalArtifactState("screener.minBeta", "");
  const [maxBeta, setMaxBeta] = useTerminalArtifactState("screener.maxBeta", "");
  const [minDivYield, setMinDivYield] = useTerminalArtifactState("screener.minDivYield", "");
  const [minRoe, setMinRoe] = useTerminalArtifactState("screener.minRoe", "");
  const [minRevGrowth, setMinRevGrowth] = useTerminalArtifactState("screener.minRevGrowth", "");
  const [activeStrategy, setActiveStrategy] = useTerminalArtifactState<string | null>("screener.activeStrategy", null);
  const [showAdvanced, setShowAdvanced] = useTerminalArtifactState("screener.showAdvanced", false);
  const [equityPage, setEquityPage] = useTerminalArtifactState("screener.equityPage", 1);
  const [dynamicFieldId, setDynamicFieldId] = useTerminalArtifactState("screener.dynamicFieldId", "market_data.marketCap");
  const [dynamicOperator, setDynamicOperator] = useTerminalArtifactState<DynamicFilterOperator>("screener.dynamicOperator", "gte");
  const [dynamicValue, setDynamicValue] = useTerminalArtifactState("screener.dynamicValue", "");

  const filters: Record<string, string> = { sector };
  if (minPe) filters.minPe = minPe;
  if (maxPe) filters.maxPe = maxPe;
  if (dynamicFieldId && dynamicValue) {
    filters.dynamicField = dynamicFieldId;
    filters.dynamicOperator = dynamicOperator;
    filters.dynamicValue = dynamicValue;
  }

  const { data: stocks = [], isLoading } = useScreener(filters);

  // Apply strategy filter on client side (additional filtering on top of API)
  const filteredStocks = stocks.filter((s: any) => {
    const value = (key: string): number | null => typeof s[key] === "number" && Number.isFinite(s[key]) ? s[key] : null;
    const within = (key: string, min: string, max?: string) => {
      const current = value(key);
      if (!min && !max) return true;
      if (current === null) return false;
      return (!min || current >= Number(min)) && (!max || current <= Number(max));
    };
    return within("beta", minBeta, maxBeta) && within("dividendYield", minDivYield) && within("roe", minRoe) && within("revenueGrowth", minRevGrowth);
  });

  const sorted = [...filteredStocks].sort((a: any, b: any) => {
    const av = a[sortField] ?? 0;
    const bv = b[sortField] ?? 0;
    if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === "asc" ? av - bv : bv - av;
  });
  const equityPageSize = 50;
  const equityPageCount = Math.max(1, Math.ceil(sorted.length / equityPageSize));
  const visibleSorted = sorted.slice((equityPage - 1) * equityPageSize, equityPage * equityPageSize);


  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const applyStrategy = (strategy: StrategyTemplate) => {
    if (activeStrategy === strategy.id) {
      // Toggle off
      setActiveStrategy(null);
      setMinPe(""); setMaxPe("");
      setMinBeta(""); setMaxBeta("");
      setMinDivYield(""); setMinRoe(""); setMinRevGrowth("");
      return;
    }
    setActiveStrategy(strategy.id);
    setMinPe(strategy.filters.minPe || "");
    setMaxPe(strategy.filters.maxPe || "");
    setMinBeta("");
    setMaxBeta(strategy.filters.maxBeta || "");
    setMinDivYield(strategy.filters.minDivYield || "");
    setMinRoe(strategy.filters.minRoe || "");
    setMinRevGrowth(strategy.filters.minRevGrowth || "");
  };

  const clearAll = () => {
    setActiveStrategy(null);
    setSector("All");
    setMinPe(""); setMaxPe("");
    setMinBeta(""); setMaxBeta("");
    setMinDivYield(""); setMinRoe(""); setMinRevGrowth("");
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th className="text-left py-2 px-2.5 cursor-pointer hover:text-[hsl(38,95%,55%)] select-none" onClick={() => toggleSort(field)}>
      <div className="flex items-center gap-1">
        <span className="font-terminal text-[8px] tracking-wider">{label}</span>
        {sortField === field && (
          <span className="text-[hsl(38,95%,55%)] text-[8px]">{sortDir === "desc" ? "▼" : "▲"}</span>
        )}
      </div>
    </th>
  );

  const activeStrategyObj = STRATEGIES.find(s => s.id === activeStrategy);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      {/* Screen mode tabs */}
      <div className="shrink-0 flex items-center gap-0.5 border-b border-border bg-[#080808] px-2 py-1">
        {MODES.map(m => {
          const Icon = m.icon;
          const isActive = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-terminal text-[8px] tracking-wider transition-all ${
                isActive ? "bg-[hsl(38,95%,50%)] text-black font-bold" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              <Icon className="w-2.5 h-2.5" /> {m.label}
            </button>
          );
        })}
      </div>

      {mode === "directory" && <DirectoryScreenerView onSymbol={onSymbol} />}
      {mode === "bond" && <BondScreenerView />}
      {mode === "macro" && <MacroScreenerView />}
      {mode === "radar" && <RadarScreenerView onSymbol={onSymbol} />}

      {mode === "equity" && <>
      {/* Strategy Templates */}
      <div className="shrink-0 border-b border-border bg-[#060606] px-3 py-2">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="w-3 h-3 text-[hsl(38,95%,55%)]" />
          <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">STRATEGY TEMPLATES</span>
          {activeStrategy && (
            <button onClick={clearAll} className="ml-auto flex items-center gap-1 font-terminal text-[8px] text-muted-foreground hover:text-[hsl(0,80%,60%)]">
              <X className="w-2.5 h-2.5" /> CLEAR
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-0.5">
          {STRATEGIES.map(strategy => {
            const Icon = strategy.icon;
            const isActive = activeStrategy === strategy.id;
            return (
              <button
                key={strategy.id}
                onClick={() => applyStrategy(strategy)}
                title={strategy.description}
                className={`flex items-center gap-1.5 px-3 py-1.5 border font-terminal text-[9px] whitespace-nowrap transition-all shrink-0 ${
                  isActive
                    ? "border-[hsl(38,95%,50%)/60%] bg-[hsl(38,95%,50%)/15%] text-[hsl(38,95%,55%)]"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-[#333]"
                }`}
              >
                <Icon className="w-2.5 h-2.5 shrink-0" style={{ color: isActive ? "hsl(38,95%,55%)" : strategy.color }} />
                {strategy.label}
              </button>
            );
          })}
        </div>
        {activeStrategyObj && (
          <div className="mt-1.5 font-terminal text-[8px] text-muted-foreground">
            <span className="text-[hsl(38,95%,55%)]">●</span> {activeStrategyObj.description}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="shrink-0 border-b border-border bg-[#070707]">
        {/* Basic + Advanced toggle */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <SlidersHorizontal className="w-3 h-3 text-muted-foreground" />
          <span className="panel-label">FILTERS</span>
          <div className="flex items-center gap-2 ml-2 flex-wrap">
            <label className="font-terminal text-[8px] text-muted-foreground">MIN P/E</label>
            <input value={minPe} onChange={e => { setMinPe(e.target.value); setActiveStrategy(null); }} className="w-12 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%]" placeholder="—" />
            <label className="font-terminal text-[8px] text-muted-foreground">MAX P/E</label>
            <input value={maxPe} onChange={e => { setMaxPe(e.target.value); setActiveStrategy(null); }} className="w-12 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%]" placeholder="—" />
            <button
              onClick={() => setShowAdvanced(a => !a)}
              className={`flex items-center gap-1 px-2 py-0.5 font-terminal text-[8px] border transition-colors ${showAdvanced ? "border-[hsl(38,95%,50%)/40%] text-[hsl(38,95%,55%)]" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              ADVANCED {showAdvanced ? "▲" : "▼"}
            </button>
          </div>
          <span className="ml-auto font-terminal text-[9px] text-muted-foreground">{sorted.length} RESULTS</span>
        </div>

        {/* Advanced Filters */}
        {showAdvanced && (
          <div className="flex items-center gap-3 px-3 py-2 border-b border-border flex-wrap">
            <label className="font-terminal text-[8px] text-muted-foreground">DATA FIELD</label>
            <select value={dynamicFieldId} onChange={e => { setDynamicFieldId(e.target.value); setEquityPage(1); }} className="bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[8px] focus:outline-none" aria-label="Dynamic screener field">
              {DYNAMIC_SCREENER_FIELDS.map((field) => <option key={field.id} value={field.id}>{field.label.toUpperCase()}</option>)}
            </select>
            <select value={dynamicOperator} onChange={e => { setDynamicOperator(e.target.value as DynamicFilterOperator); setEquityPage(1); }} className="bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[8px] focus:outline-none" aria-label="Dynamic screener operator">
              {(["gte", "gt", "lte", "lt", "eq", "neq"] as DynamicFilterOperator[]).map((operator) => <option key={operator} value={operator}>{operator.toUpperCase()}</option>)}
            </select>
            <input value={dynamicValue} onChange={e => { setDynamicValue(e.target.value); setEquityPage(1); }} className="w-16 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none" placeholder="VALUE" aria-label="Dynamic screener value" />
            {[
              { label: "MIN BETA", value: minBeta, set: setMinBeta },
              { label: "MAX BETA", value: maxBeta, set: setMaxBeta },
              { label: "MIN DIV%", value: minDivYield, set: setMinDivYield },
              { label: "MIN ROE%", value: minRoe, set: setMinRoe },
              { label: "MIN REV GR%", value: minRevGrowth, set: setMinRevGrowth },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-1.5">
                <label className="font-terminal text-[8px] text-muted-foreground whitespace-nowrap">{f.label}</label>
                <input
                  value={f.value}
                  onChange={e => { f.set(e.target.value); setActiveStrategy(null); }}
                  className="w-14 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%]"
                  placeholder="—"
                />
              </div>
            ))}
          </div>
        )}

        {/* Sector tabs */}
        <div className="flex items-center gap-px overflow-x-auto scrollbar-thin px-2 py-1">
          {["All", ...SCREENER_SECTORS].map(s => (
            <button key={s} onClick={() => setSector(s)}
              className={`px-2.5 py-1 font-terminal text-[8px] whitespace-nowrap border-r border-border transition-colors ${
                sector === s ? "bg-[hsl(38,95%,50%)/15%] text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
              }`}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {(installError || installStatus?.error) && (
        <div role="alert" className="px-3 py-1.5 text-[10px] text-red-400">{installError ?? installStatus?.error}</div>
      )}
      {installStatus?.state === "completed" && installStatus.importedCount !== null && (
        <div role="status" className="px-3 py-1 text-[9px] text-muted-foreground">
          {installStatus.importedCount.toLocaleString()} reference identities installed locally. Live quote/financial coverage is separate.
        </div>
      )}
      <div className="flex-1 overflow-auto scrollbar-thin">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array(12).fill(0).map((_, i) => <Skeleton key={i} className="h-8 bg-border" />)}
          </div>
        ) : (
          <>
          <table className="w-full">
            <thead className="sticky top-0 bg-[#070707] border-b border-border z-10">
              <tr className="text-muted-foreground">
                <SortHeader field="symbol" label="TICKER" />
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider text-muted-foreground">NAME</th>
                <SortHeader field="price" label="PRICE" />
                <SortHeader field="changePercent" label="CHG%" />
                <SortHeader field="marketCap" label="MKT CAP" />
                <SortHeader field="pe" label="P/E" />
                <SortHeader field="eps" label="EPS" />
                <SortHeader field="high52" label="52W HIGH" />
                <SortHeader field="volume" label="VOL" />
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider text-muted-foreground">SECTOR</th>
              </tr>
            </thead>
            <tbody>
              {visibleSorted.map((s: any) => {
                const observed = isObservedQuote(s);
                const isUp = s.changePercent >= 0;
                const curr = getCurrencySymbol(s.symbol);
                const near52High = observed && Number.isFinite(s.high52) && s.high52 > 0 && (s.price / s.high52) > 0.95;
                return (
                  <tr
                    key={s.symbol}
                    onClick={() => onSymbol(s.symbol)}
                    className="border-b border-border/50 hover:bg-white/5 cursor-pointer group"
                    data-testid={`screener-row-${s.symbol}`}
                  >
                    <td className="py-2 px-2.5 font-terminal text-[10px] font-bold text-[hsl(38,95%,55%)]">{s.symbol}</td>
                    <td className="py-2 px-2.5 font-terminal text-[9px] text-muted-foreground max-w-[160px] truncate">{s.name}</td>
                    <td className="py-2 px-2.5 font-terminal text-[10px] tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        {observed ? `${curr}${formatPrice(s.price)}` : "—"}
                        {s.status && <DataStatusBadge status={s.status} compact />}
                      </span>
                    </td>
                    <td className={`py-2 px-2.5 font-terminal text-[10px] tabular-nums font-semibold ${observed ? pctClass(s.changePercent) : "text-muted-foreground"}`}>
                      {observed && Number.isFinite(s.changePercent) ? `${isUp ? "▲" : "▼"} ${Math.abs(s.changePercent).toFixed(2)}%` : "—"}
                    </td>
                    <td className="py-2 px-2.5 font-terminal text-[10px] tabular-nums">{formatBig(s.marketCap, s.symbol)}</td>
                    <td className="py-2 px-2.5 font-terminal text-[10px] tabular-nums">{s.pe !== null ? s.pe.toFixed(1) : "—"}</td>
                    <td className="py-2 px-2.5 font-terminal text-[10px] tabular-nums text-muted-foreground">{s.eps !== null ? `${curr}${s.eps}` : "—"}</td>
                    <td className="py-2 px-2.5 font-terminal text-[10px] tabular-nums">
                      <span className={near52High ? "text-[hsl(38,95%,55%)]" : "text-muted-foreground"}>
                        {s.high52 ? `${curr}${formatPrice(s.high52)}` : "—"}
                      </span>
                      {near52High && <span className="ml-1 font-terminal text-[7px] text-[hsl(38,95%,55%)]">★</span>}
                    </td>
                    <td className="py-2 px-2.5 font-terminal text-[9px] tabular-nums text-muted-foreground">{observed && Number.isFinite(s.volume) ? `${(s.volume / 1e6).toFixed(1)}M` : "—"}</td>
                    <td className="py-2 px-2.5 font-terminal text-[8px] text-[hsl(186,80%,55%)]">{s.sector || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {equityPageCount > 1 && (
            <div className="flex items-center justify-between px-3 py-2 border-t border-border font-terminal text-[8px] text-muted-foreground">
              <span>{sorted.length} FILTERED · SHOWING {visibleSorted.length}</span>
              <span className="flex items-center gap-1">
                <button type="button" disabled={equityPage === 1} onClick={() => setEquityPage((value) => Math.max(1, value - 1))} className="border border-border px-2 py-1 disabled:opacity-30">PREV</button>
                <span>PAGE {equityPage}/{equityPageCount}</span>
                <button type="button" disabled={equityPage >= equityPageCount} onClick={() => setEquityPage((value) => Math.min(equityPageCount, value + 1))} className="border border-border px-2 py-1 disabled:opacity-30">NEXT</button>
              </span>
            </div>
          )}
          </>
        )}
      </div>
      </>}
    </div>
  );
}

// ── Country / Asset-Class Screener -- filters the observed P5 directory
// (canonical-facing user-owned FinanceDatabase import plus available local rows) by region,
// exchange, sector, and asset class. Server-paginated (20/page) since the
// underlying universe is far larger than the equity screener's curated ~160.
function DirectoryScreenerView({ onSymbol }: { onSymbol: (sym: string) => void }) {
  const [region, setRegion] = useTerminalArtifactState("DirectoryScreenerView.region", "");
  const [assetClass, setAssetClass] = useTerminalArtifactState("DirectoryScreenerView.assetClass", "");
  const [exchange, setExchange] = useTerminalArtifactState("DirectoryScreenerView.exchange", "");
  const [query, setQuery] = useTerminalArtifactState("DirectoryScreenerView.query", "");
  const [primaryListingOnly, setPrimaryListingOnly] = useTerminalArtifactState("DirectoryScreenerView.primaryListingOnly", true);
  const [includeHistorical, setIncludeHistorical] = useTerminalArtifactState("DirectoryScreenerView.includeHistorical", false);
  const [page, setPage] = useTerminalArtifactState("DirectoryScreenerView.page", 1);

  const { data: regions = [] } = useDirectoryRegions();
  const { data: facets } = useDirectoryFacets();
  const { data: catalogStatus } = useDirectoryStatus();
  const { data: installStatus } = useDirectoryInstallStatus();
  const queryClient = useQueryClient();
  const [installError, setInstallError] = useState<string | null>(null);
  const filters: Record<string, string> = {};
  if (region) filters.region = region;
  if (assetClass) filters.assetClass = assetClass;
  if (exchange) filters.exchange = exchange;
  if (query) filters.q = query;
  if (primaryListingOnly) filters.primaryListingOnly = "true";
  if (includeHistorical) filters.includeHistorical = "true";
  const { data, isLoading } = useDirectoryScreener(filters, page);

  const ASSET_CLASSES = facets?.assetClasses.map(x => x.value) ?? [];
  const installing = !!installStatus && ["fetching", "extracting", "verifying"].includes(installStatus.state);
  useEffect(() => {
    if (installStatus?.state !== "completed") return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/finance/directory/status"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/finance/directory/facets"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/finance/directory/regions"] }),
    ]);
  }, [installStatus?.completedAt, installStatus?.state, queryClient]);

  const installReferenceCatalog = async () => {
    const confirmed = window.confirm(
      "Download the public FinanceDatabase 300k+ reference catalog to this computer? " +
      "Reference symbols do not provide live quotes. You must have rights to use the data, " +
      "and the download comes directly from public GitHub with no LiOS cloud storage."
    );
    if (!confirmed) return;
    setInstallError(null);
    try {
      const response = await fetch("/api/finance/directory/install", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmSourceDownload: true }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(detail.error || "Reference import request failed");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/finance/directory/install/status"] });
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : "Unable to start catalog import");
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-border bg-[#070707] flex-wrap">
        <label className="font-terminal text-[8px] text-muted-foreground">COUNTRY</label>
        <select value={region} onChange={e => { setRegion(e.target.value); setPage(1); }} className="bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none">
          <option value="">ALL</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <label className="font-terminal text-[8px] text-muted-foreground">ASSET CLASS</label>
        <select value={assetClass} onChange={e => { setAssetClass(e.target.value); setPage(1); }} className="bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none">
          <option value="">ALL</option>
          {ASSET_CLASSES.map(a => <option key={a} value={a}>{a.replace(/_/g, " ").toUpperCase()} ({facets?.assetClasses.find(x => x.value === a)?.count.toLocaleString()})</option>)}
        </select>
        <label className="font-terminal text-[8px] text-muted-foreground">EXCHANGE</label>
        <input value={exchange} onChange={e => { setExchange(e.target.value); setPage(1); }} placeholder="e.g. NASDAQ" className="w-24 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none" />
        <input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="SEARCH SYMBOL/NAME" className="w-40 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none" />
        <label className="flex items-center gap-1.5 font-terminal text-[8px] text-muted-foreground" title="Rows with an explicit secondary-listing flag are excluded; legacy rows remain visible.">
          <input type="checkbox" checked={primaryListingOnly} onChange={e => { setPrimaryListingOnly(e.target.checked); setPage(1); }} className="accent-amber-400" /> PRIMARY LISTINGS
        </label>
        <label className="flex items-center gap-1.5 font-terminal text-[8px] text-muted-foreground">
          <input type="checkbox" checked={includeHistorical} onChange={e => { setIncludeHistorical(e.target.checked); setPage(1); }} className="accent-amber-400" /> HISTORICAL
        </label>
        <button
          type="button"
          onClick={() => void installReferenceCatalog()}
          disabled={installing}
          title="User-authorized, Git-free local installation. Does not provide real-time prices."
          className="border border-border rounded px-2 py-1 text-[9px] font-terminal text-muted-foreground hover:text-foreground disabled:opacity-50"
        >{installing ? `IMPORTING ${installStatus?.filesExtracted ?? 0} FILES` : catalogStatus?.financeDatabase.imported ? "UPDATE REFERENCE DATA" : "IMPORT 300K+ REFERENCES"}</button>
        <span title="Reference symbols are not verified live prices, fundamentals or distinct companies." className="ml-auto font-terminal text-[9px] text-muted-foreground">{(data?.total ?? 0).toLocaleString()} MATCHES · {(catalogStatus?.uniqueListingCount ?? 0).toLocaleString()} REFERENCE LISTINGS</span>
      </div>
      <div className="flex-1 overflow-auto scrollbar-thin">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array(12).fill(0).map((_, i) => <Skeleton key={i} className="h-8 bg-border" />)}</div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-[#070707] border-b border-border z-10">
              <tr className="text-muted-foreground">
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">SYMBOL</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">NAME</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">EXCHANGE</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">REGION</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">ASSET CLASS</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">SECTOR</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map(item => (
                <tr key={`${item.assetClass ?? "equity"}:${item.symbol}:${item.mic ?? item.exchange}:${item.currency ?? ""}`} onClick={() => onSymbol(item.symbol)} className="border-b border-border/50 hover:bg-white/5 cursor-pointer">
                  <td className="py-2 px-2.5 font-terminal text-[10px] font-bold text-[hsl(38,95%,55%)]">{item.symbol}</td>
                  <td className="py-2 px-2.5 font-terminal text-[9px] text-muted-foreground max-w-[220px] truncate" title={`${item.source ?? "unverified reference"} · ${item.isin ?? "No ISIN"}`}>{item.name}</td>
                  <td className="py-2 px-2.5 font-terminal text-[9px] text-muted-foreground">{item.exchange}</td>
                  <td className="py-2 px-2.5 font-terminal text-[9px] text-muted-foreground">{item.region || "—"}</td>
                  <td className="py-2 px-2.5 font-terminal text-[8px] text-[hsl(186,80%,55%)]">{(item.assetClass || "equity").toUpperCase()}</td>
                  <td className="py-2 px-2.5 font-terminal text-[8px] text-muted-foreground">{item.sector || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && data.totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-center gap-3 px-3 py-1.5 border-t border-border bg-[#070707]">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="font-terminal text-[8px] text-muted-foreground disabled:opacity-30 hover:text-foreground">◀ PREV</button>
          <span className="font-terminal text-[8px] text-muted-foreground">PAGE {data.page} / {data.totalPages}</span>
          <button disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)} className="font-terminal text-[8px] text-muted-foreground disabled:opacity-30 hover:text-foreground">NEXT ▶</button>
        </div>
      )}
    </div>
  );
}

// ── Bond Screener -- sovereign/reference bond yields (LSE's "bonds" catalog
// dataset), filterable by country and yield range. Not a full corporate-bond
// security screener (that universe isn't clean in the ticker directory yet --
// see the pending ticker-audit remediation) -- this screens actual real
// yield-curve reference data by threshold, which is what's reliably available.
function BondScreenerView() {
  const [country, setCountry] = useTerminalArtifactState("BondScreenerView.country", "");
  const [minYield, setMinYield] = useTerminalArtifactState("BondScreenerView.minYield", "");
  const [maxYield, setMaxYield] = useTerminalArtifactState("BondScreenerView.maxYield", "");
  const [query, setQuery] = useTerminalArtifactState("BondScreenerView.query", "");

  const filters: Record<string, string> = {};
  if (country) filters.country = country;
  if (minYield) filters.minYield = minYield;
  if (maxYield) filters.maxYield = maxYield;
  if (query) filters.q = query;
  const { data: rows = [], isLoading } = useBondScreener(filters);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-border bg-[#070707] flex-wrap">
        <label className="font-terminal text-[8px] text-muted-foreground">COUNTRY CODE</label>
        <input value={country} onChange={e => setCountry(e.target.value)} placeholder="e.g. US, IN" className="w-20 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none" />
        <label className="font-terminal text-[8px] text-muted-foreground">MIN YIELD%</label>
        <input value={minYield} onChange={e => setMinYield(e.target.value)} className="w-16 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none" placeholder="—" />
        <label className="font-terminal text-[8px] text-muted-foreground">MAX YIELD%</label>
        <input value={maxYield} onChange={e => setMaxYield(e.target.value)} className="w-16 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none" placeholder="—" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="SEARCH" className="w-32 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none" />
        <span className="ml-auto font-terminal text-[9px] text-muted-foreground">{rows.length} RESULTS</span>
      </div>
      <div className="flex-1 overflow-auto scrollbar-thin">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array(12).fill(0).map((_, i) => <Skeleton key={i} className="h-8 bg-border" />)}</div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-[#070707] border-b border-border z-10">
              <tr className="text-muted-foreground">
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">SYMBOL</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">NAME</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">COUNTRY</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">YIELD</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">CHG% (1Y)</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">CATEGORY</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.symbol} className="border-b border-border/50">
                  <td className="py-2 px-2.5 font-terminal text-[10px] font-bold text-[hsl(38,95%,55%)]">{r.symbol}</td>
                  <td className="py-2 px-2.5 font-terminal text-[9px] text-muted-foreground max-w-[220px] truncate">{r.name || "—"}</td>
                  <td className="py-2 px-2.5 font-terminal text-[9px] text-muted-foreground">{r.country_name || r.country || "—"}</td>
                  <td className="py-2 px-2.5 font-terminal text-[10px] tabular-nums">{r.last_value !== undefined ? `${r.last_value.toFixed(2)}%` : "—"}</td>
                  <td className={`py-2 px-2.5 font-terminal text-[10px] tabular-nums ${r.change_1y !== undefined ? pctClass(r.change_1y) : ""}`}>{r.change_1y !== undefined ? `${r.change_1y.toFixed(2)}%` : "—"}</td>
                  <td className="py-2 px-2.5 font-terminal text-[8px] text-[hsl(186,80%,55%)]">{r.category || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Macro Screener -- economic indicators (LSE's "economics" catalog
// dataset) across countries, filterable by country/category and a
// current-value threshold range.
function MacroScreenerView() {
  const [country, setCountry] = useTerminalArtifactState("MacroScreenerView.country", "");
  const [category, setCategory] = useTerminalArtifactState("MacroScreenerView.category", "");
  const [minValue, setMinValue] = useTerminalArtifactState("MacroScreenerView.minValue", "");
  const [maxValue, setMaxValue] = useTerminalArtifactState("MacroScreenerView.maxValue", "");
  const [query, setQuery] = useTerminalArtifactState("MacroScreenerView.query", "");

  const filters: Record<string, string> = {};
  if (country) filters.country = country;
  if (category) filters.category = category;
  if (minValue) filters.minValue = minValue;
  if (maxValue) filters.maxValue = maxValue;
  if (query) filters.q = query;
  const { data: rows = [], isLoading } = useMacroScreener(filters);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-border bg-[#070707] flex-wrap">
        <label className="font-terminal text-[8px] text-muted-foreground">COUNTRY CODE</label>
        <input value={country} onChange={e => setCountry(e.target.value)} placeholder="e.g. US, IN" className="w-20 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none" />
        <label className="font-terminal text-[8px] text-muted-foreground">CATEGORY</label>
        <input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Inflation" className="w-28 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none" />
        <label className="font-terminal text-[8px] text-muted-foreground">MIN VALUE</label>
        <input value={minValue} onChange={e => setMinValue(e.target.value)} className="w-16 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none" placeholder="—" />
        <label className="font-terminal text-[8px] text-muted-foreground">MAX VALUE</label>
        <input value={maxValue} onChange={e => setMaxValue(e.target.value)} className="w-16 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none" placeholder="—" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="SEARCH" className="w-32 bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none" />
        <span className="ml-auto font-terminal text-[9px] text-muted-foreground">{rows.length} RESULTS</span>
      </div>
      <div className="flex-1 overflow-auto scrollbar-thin">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array(12).fill(0).map((_, i) => <Skeleton key={i} className="h-8 bg-border" />)}</div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-[#070707] border-b border-border z-10">
              <tr className="text-muted-foreground">
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">SYMBOL</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">NAME</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">COUNTRY</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">VALUE</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">UNIT</th>
                <th className="text-left py-2 px-2.5 font-terminal text-[8px] tracking-wider">CATEGORY</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.symbol} className="border-b border-border/50">
                  <td className="py-2 px-2.5 font-terminal text-[10px] font-bold text-[hsl(38,95%,55%)]">{r.symbol}</td>
                  <td className="py-2 px-2.5 font-terminal text-[9px] text-muted-foreground max-w-[220px] truncate">{r.name || "—"}</td>
                  <td className="py-2 px-2.5 font-terminal text-[9px] text-muted-foreground">{r.country_name || r.country || "—"}</td>
                  <td className="py-2 px-2.5 font-terminal text-[10px] tabular-nums">{r.last_value !== undefined ? r.last_value.toLocaleString() : "—"}</td>
                  <td className="py-2 px-2.5 font-terminal text-[9px] text-muted-foreground">{r.unit || "—"}</td>
                  <td className="py-2 px-2.5 font-terminal text-[8px] text-[hsl(186,80%,55%)]">{r.category || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Opportunity / Risk Radar -- "turn existing signals into ranked
// opportunities/risks" (roadmap item, previously unimplemented anywhere in
// the app). Backed by GET /api/radar/{opportunities,risks}
// (server/radarRoutes.ts), which composite-scores each symbol's REAL
// signals (live quote momentum, yfinance fundamentals, per-symbol news
// sentiment, SEC EDGAR insider transactions) via @shared/radarScoring.ts.
// Defaults to the caller's own watchlist; an explicit symbol list overrides.
interface RadarFactor {
  key: string;
  label: string;
  rawValue: number | null;
  tilt: number | null;
  weight: number;
  contribution: number;
}
interface RadarResult {
  symbol: string;
  name: string | null;
  price: number | null;
  changePercent: number | null;
  score: number;
  factors: RadarFactor[];
}
interface RadarResponse {
  symbols: string[];
  results: RadarResult[];
}

type RadarKind = "opportunities" | "risks";

function useRadar(kind: RadarKind, symbols: string[]) {
  const url = `/api/radar/${kind}${symbols.length ? `?symbols=${symbols.join(",")}` : ""}`;
  return useQuery<RadarResponse>({
    queryKey: [url],
    refetchInterval: 60_000,
  });
}

function formatFactorValue(key: string, rawValue: number | null): string {
  if (rawValue === null) return "no data";
  switch (key) {
    case "valuation": return `${rawValue.toFixed(1)}x P/E`;
    case "momentum": return `${rawValue >= 0 ? "+" : ""}${rawValue.toFixed(2)}% today`;
    case "sentiment": return `${rawValue >= 0 ? "+" : ""}${(rawValue * 100).toFixed(0)}% net`;
    case "insider": {
      const millions = rawValue / 1_000_000;
      return `${millions >= 0 ? "+" : ""}$${millions.toFixed(2)}M`;
    }
    case "fundamentals": return `${rawValue >= 0 ? "+" : ""}${(rawValue * 100).toFixed(1)}%`;
    case "volatility": return `${rawValue.toFixed(2)}β`;
    default: return String(rawValue);
  }
}

function FactorBar({ factor }: { factor: RadarFactor }) {
  const positive = factor.contribution >= 0;
  const magnitudePct = factor.weight > 0 ? (Math.abs(factor.contribution) / factor.weight) * 100 : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between font-terminal text-[7.5px] text-muted-foreground">
        <span>{factor.label}</span>
        <span className={factor.rawValue === null ? "text-muted-foreground/40" : positive ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}>
          {formatFactorValue(factor.key, factor.rawValue)}
        </span>
      </div>
      <div className="h-1.5 bg-[#111] w-full flex">
        <div className="w-1/2 flex justify-end">
          {!positive && <div className="h-full bg-[hsl(0,80%,55%)]" style={{ width: `${magnitudePct}%` }} />}
        </div>
        <div className="w-1/2">
          {positive && <div className="h-full bg-[hsl(142,71%,45%)]" style={{ width: `${magnitudePct}%` }} />}
        </div>
      </div>
    </div>
  );
}

function scoreColor(score: number, kind: RadarKind): string {
  const hot = kind === "opportunities" ? score >= 65 : score >= 65;
  const cold = kind === "opportunities" ? score <= 35 : score <= 35;
  if (kind === "opportunities") {
    if (hot) return "hsl(142,71%,55%)";
    if (cold) return "hsl(0,80%,60%)";
    return "hsl(38,95%,55%)";
  }
  if (hot) return "hsl(0,80%,60%)";
  if (cold) return "hsl(142,71%,55%)";
  return "hsl(38,95%,55%)";
}

function RadarScreenerView({ onSymbol }: { onSymbol: (sym: string) => void }) {
  const [kind, setKind] = useTerminalArtifactState<RadarKind>("RadarScreenerView.kind", "opportunities");
  const [symbolsInput, setSymbolsInput] = useTerminalArtifactState("RadarScreenerView.symbolsInput", "");
  const [appliedSymbols, setAppliedSymbols] = useTerminalArtifactState<string[]>("RadarScreenerView.appliedSymbols", []);
  const [selected, setSelected] = useTerminalArtifactState<string | null>("RadarScreenerView.selected", null);

  const { data, isLoading, isError } = useRadar(kind, appliedSymbols);
  const results = data?.results ?? [];
  const selectedResult = results.find(r => r.symbol === selected) ?? results[0] ?? null;

  const applySymbols = () => {
    const parsed = Array.from(new Set(
      symbolsInput.split(",").map(s => s.trim().toUpperCase()).filter(Boolean),
    ));
    setAppliedSymbols(parsed);
    setSelected(null);
  };

  const clearSymbols = () => {
    setSymbolsInput("");
    setAppliedSymbols([]);
    setSelected(null);
  };

  const KindIcon = kind === "opportunities" ? Radar : ShieldAlert;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-screener-radar="true">
      {/* Radar kind sub-tabs */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-border bg-[#060606]">
        {([["opportunities", "OPPORTUNITY RADAR", Radar], ["risks", "RISK RADAR", ShieldAlert]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => { setKind(id); setSelected(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 border font-terminal text-[9px] tracking-wider transition-all ${
              kind === id
                ? "border-[hsl(38,95%,50%)/60%] bg-[hsl(38,95%,50%)/15%] text-[hsl(38,95%,55%)]"
                : "border-border text-muted-foreground hover:text-foreground hover:border-[#333]"
            }`}
          >
            <Icon className="w-2.5 h-2.5" /> {label}
          </button>
        ))}
        <span className="ml-3 font-terminal text-[7.5px] text-muted-foreground max-w-[420px]">
          {kind === "opportunities"
            ? "Ranks symbols by real signals favoring an opportunity: cheap valuation, positive momentum, positive news sentiment, net insider buying, improving fundamentals."
            : "Ranks symbols by real signals favoring risk: expensive valuation, negative momentum, negative news sentiment, net insider selling, deteriorating fundamentals, elevated beta."}
        </span>
      </div>

      {/* Symbol scope controls */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-[#070707]" data-screener-radar-controls="true">
        <label className="font-terminal text-[8px] text-muted-foreground whitespace-nowrap">SYMBOLS (BLANK = WATCHLIST)</label>
        <input
          value={symbolsInput}
          onChange={e => setSymbolsInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && applySymbols()}
          placeholder="AAPL, MSFT, NVDA…"
          className="w-56 min-w-[140px] bg-[#0d0d0d] border border-border px-1.5 py-0.5 font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%]"
        />
        <button onClick={applySymbols} className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground">APPLY</button>
        {appliedSymbols.length > 0 && (
          <button onClick={clearSymbols} className="flex items-center gap-1 font-terminal text-[8px] text-muted-foreground hover:text-[hsl(0,80%,60%)]">
            <X className="w-2.5 h-2.5" /> USE WATCHLIST
          </button>
        )}
        <span className="ml-auto font-terminal text-[9px] text-muted-foreground">{results.length} RANKED</span>
      </div>

      <div className="flex-1 flex overflow-hidden" data-screener-radar-body="true">
        {/* Ranked list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {isLoading ? (
            <div className="p-4 space-y-2">{Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-8 bg-border" />)}</div>
          ) : isError ? (
            <div className="p-4 font-terminal text-[9px] text-[hsl(0,80%,60%)]">Radar unavailable right now.</div>
          ) : !results.length ? (
            <div className="p-4 font-terminal text-[9px] text-muted-foreground">No symbols to rank — add a watchlist item or enter symbols above.</div>
          ) : (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-[#070707] border-b border-border z-10">
                <tr className="text-muted-foreground">
                  <th className="text-left py-2 px-2.5 font-terminal text-[7.5px] tracking-wider">#</th>
                  <th className="text-left py-2 px-2.5 font-terminal text-[7.5px] tracking-wider">SYMBOL</th>
                  <th className="text-left py-2 px-2.5 font-terminal text-[7.5px] tracking-wider">NAME</th>
                  <th className="text-left py-2 px-2.5 font-terminal text-[7.5px] tracking-wider">PRICE</th>
                  <th className="text-left py-2 px-2.5 font-terminal text-[7.5px] tracking-wider">CHG%</th>
                  <th className="text-left py-2 px-2.5 font-terminal text-[7.5px] tracking-wider">{kind === "opportunities" ? "OPPORTUNITY SCORE" : "RISK SCORE"}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const color = scoreColor(r.score, kind);
                  const isSelected = selectedResult?.symbol === r.symbol;
                  return (
                    <tr
                      key={r.symbol}
                      onClick={() => setSelected(r.symbol)}
                      className={`border-b border-border/30 cursor-pointer ${isSelected ? "bg-white/[3%]" : "hover:bg-white/[1.5%]"}`}
                    >
                      <td className="py-2 px-2.5 font-terminal text-[9px] text-muted-foreground">{i + 1}</td>
                      <td className="py-2 px-2.5 font-terminal text-[10px] font-bold text-[hsl(38,95%,55%)]" onClick={e => { e.stopPropagation(); onSymbol(r.symbol); }}>{r.symbol}</td>
                      <td className="py-2 px-2.5 font-terminal text-[9px] text-muted-foreground max-w-[180px] truncate">{r.name || "—"}</td>
                      <td className="py-2 px-2.5 font-terminal text-[9px] tabular-nums">{r.price !== null ? `${getCurrencySymbol(r.symbol)}${formatPrice(r.price)}` : "—"}</td>
                      <td className={`py-2 px-2.5 font-terminal text-[9px] tabular-nums font-bold ${r.changePercent !== null ? pctClass(r.changePercent) : ""}`}>
                        {r.changePercent !== null ? `${r.changePercent >= 0 ? "+" : ""}${r.changePercent.toFixed(2)}%` : "—"}
                      </td>
                      <td className="py-2 px-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-[#111]">
                            <div className="h-full" style={{ width: `${r.score}%`, backgroundColor: color }} />
                          </div>
                          <span className="font-terminal text-[10px] font-bold tabular-nums" style={{ color }}>{r.score}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Factor breakdown for selected symbol -- transparency: never a black-box score. */}
        <div className="w-72 shrink-0 border-l border-border bg-[#060606] p-3 space-y-3 overflow-y-auto scrollbar-thin" data-screener-radar-detail="true">
          <div className="flex items-center gap-1.5">
            <KindIcon className="w-3 h-3 text-[hsl(38,95%,55%)]" />
            <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">FACTOR BREAKDOWN</span>
          </div>
          {!selectedResult ? (
            <div className="font-terminal text-[8px] text-muted-foreground">Select a row to see what's driving its score.</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="font-terminal text-[10px] font-bold text-[hsl(38,95%,55%)]">{selectedResult.symbol}</span>
                <span className="font-terminal text-[12px] font-bold tabular-nums" style={{ color: scoreColor(selectedResult.score, kind) }}>{selectedResult.score}</span>
              </div>
              <div className="space-y-2.5">
                {selectedResult.factors.map(f => <FactorBar key={f.key} factor={f} />)}
              </div>
              <div className="border border-border p-2 font-terminal text-[7px] text-muted-foreground space-y-1">
                <div className="text-foreground font-bold tracking-widest">SCORE = 50 + Σ(weight × tilt)</div>
                <div>Each factor's real signal is normalized to a -1..+1 tilt, then weighted (bar length above) and summed against a neutral baseline of 50. Green = pushed the score up, red = pushed it down. A blank/"no data" factor contributes zero rather than a guess.</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
