import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useEffect } from "react";
import { useQuotes, useIndexSparklines } from "@/lib/useFinance";
import { formatPrice, pctClass, INDICES } from "@/lib/finance";
import DataStatusBadge from "@/components/data/DataStatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ViewMode } from "@/lib/terminalTypes";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { Clock, Search, ChevronLeft, ChevronRight, SlidersHorizontal, Layers } from "lucide-react";

interface Props {
  activeSymbol?: string;
  onSymbol: (sym: string) => void;
  onNav: (v: ViewMode) => void;
}

function Sparkline({ data, isUp }: { data: number[]; isUp: boolean }) {
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={36}>
      <LineChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <Line type="monotone" dataKey="v" stroke={isUp ? "hsl(var(--up))" : "hsl(var(--down))"} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}


// 15 Prominent Exchanges Clocks configuration
const EXCHANGES_CLOCK_CONFIG = [
  { name: "NYSE/NASDAQ", tz: "America/New_York", open: "09:30", close: "16:00", label: "US" },
  { name: "NSE (INDIA)", tz: "Asia/Kolkata", open: "09:15", close: "15:30", label: "NSE" },
  { name: "BSE (INDIA)", tz: "Asia/Kolkata", open: "09:15", close: "15:30", label: "BSE" },
  { name: "TSE (JAPAN)", tz: "Asia/Tokyo", open: "09:00", close: "15:00", lunchStart: "11:30", lunchEnd: "12:30", label: "TSE" },
  { name: "HKEX (HK)", tz: "Asia/Hong_Kong", open: "09:30", close: "16:00", lunchStart: "12:00", lunchEnd: "13:00", label: "HKEX" },
  { name: "LSE (LONDON)", tz: "Europe/London", open: "08:00", close: "16:30", label: "LSE" },
  { name: "XETRA (GER)", tz: "Europe/Berlin", open: "09:00", close: "17:30", label: "XETRA" },
  { name: "TSX (CANADA)", tz: "America/Toronto", open: "09:30", close: "16:00", label: "TSX" },
  { name: "ASX (SYDNEY)", tz: "Australia/Sydney", open: "10:00", close: "16:00", label: "ASX" },
  { name: "SGX (SING)", tz: "Asia/Singapore", open: "09:00", close: "17:00", lunchStart: "12:00", lunchEnd: "13:00", label: "SGX" },
  { name: "EURONEXT", tz: "Europe/Paris", open: "09:00", close: "17:30", label: "EURONEXT" },
  { name: "TWSE", tz: "Asia/Taipei", open: "09:00", close: "13:30", label: "TWSE" },
  { name: "KRX", tz: "Asia/Seoul", open: "09:00", close: "15:30", label: "KRX" },
  { name: "SSE (CHINA)", tz: "Asia/Shanghai", open: "09:30", close: "15:00", lunchStart: "11:30", lunchEnd: "13:00", label: "SSE" },
  { name: "SZSE (CHINA)", tz: "Asia/Shanghai", open: "09:30", close: "15:00", lunchStart: "11:30", lunchEnd: "13:00", label: "SZSE" },
  { name: "B3 (BRAZIL)", tz: "America/Sao_Paulo", open: "10:00", close: "17:55", label: "B3" },
  { name: "BURSA (MAL)", tz: "Asia/Kuala_Lumpur", open: "09:00", close: "17:00", lunchStart: "12:30", lunchEnd: "14:30", label: "BURSA" }
];

const EXCHANGE_TABS = [
  { id: "US", label: "US" },
  { id: "NSE", label: "NSE" },
  { id: "BSE", label: "BSE" },
  { id: "TSE", label: "TSE" },
  { id: "HKEX", label: "HKEX" },
  { id: "LSE", label: "LSE" },
  { id: "XETRA", label: "XETRA" },
  { id: "TSX", label: "TSX" },
  { id: "ASX", label: "ASX" },
  { id: "SGX", label: "SGX" },
  { id: "EURONEXT", label: "EURONEXT" },
  { id: "TWSE", label: "TWSE" },
  { id: "KRX", label: "KRX" },
  { id: "SSE", label: "SSE" },
  { id: "SZSE", label: "SZSE" },
  { id: "B3", label: "B3" },
  { id: "BURSA", label: "BURSA" },
  { id: "INDEX", label: "INDICES" },
  { id: "COMMODITY", label: "COMMODITIES" },
  { id: "FOREX", label: "FOREX" },
  { id: "CRYPTO", label: "CRYPTOS" }
];

const SECTORS_LIST = [
  "All", "Technology", "Healthcare", "Financial Services", "Consumer Cyclical", 
  "Consumer Defensive", "Industrials", "Energy", "Basic Materials", "Real Estate", "Utilities"
];

const ASSET_CLASSES = [
  { id: "all", label: "ALL ASSETS" },
  { id: "equity", label: "EQUITIES" },
  { id: "mutual_fund", label: "MUTUAL FUNDS" },
  { id: "index", label: "INDICES" },
  { id: "commodity", label: "COMMODITIES" },
  { id: "forex", label: "FOREX" },
  { id: "crypto", label: "CRYPTOS" }
];

export default function MarketOverview({ activeSymbol, onSymbol, onNav }: Props) {
  const indexSymbols = INDICES.map(i => i.symbol);
  const { data: indices, isLoading: idxLoad } = useQuotes(indexSymbols);
  const { data: sparklines } = useIndexSparklines();
  
  const [activeTab, setActiveTab] = useTerminalArtifactState<string>("MarketOverview.activeTab", "US");
  const [directorySearch, setDirectorySearch] = useTerminalArtifactState<string>("MarketOverview.directorySearch", "");
  const [selectedSector, setSelectedSector] = useTerminalArtifactState<string>("MarketOverview.selectedSector", "All");
  const [selectedAsset, setSelectedAsset] = useTerminalArtifactState<string>("MarketOverview.selectedAsset", "all");
  const [currentPage, setCurrentPage] = useTerminalArtifactState<number>("MarketOverview.currentPage", 1);
  const [dirData, setDirData] = useState<{ items: any[]; total: number; totalPages: number } | null>(null);
  const [dirLoading, setDirLoading] = useState<boolean>(false);
  const [clocks, setClocks] = useState<any[]>([]);
  const [overlapMessage, setOverlapMessage] = useState<string>("");


  // Real-time market status and overlap calculator loop
  useEffect(() => {
    const updateClocks = () => {
      const computed = EXCHANGES_CLOCK_CONFIG.map(cfg => {
        const now = new Date();
        try {
          const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: cfg.tz,
            hour: "numeric",
            minute: "numeric",
            second: "numeric",
            hour12: false,
            weekday: "short"
          });
          // formatToParts avoids relying on a specific separator/order in the
          // formatted string, which varies across ICU/Node versions (some
          // produce "Fri, 13:07:50", others "Fri 13:07:50" with no comma at
          // all — the previous string-split parsing threw on the latter,
          // permanently showing "Error" for every exchange clock).
          const parts = formatter.formatToParts(now);
          const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
          const weekday = get("weekday");
          // hour12:false can report midnight as "24" in some ICU versions
          // (a well-known Intl spec ambiguity) instead of "00" — normalize it.
          const h = Number(get("hour")) % 24;
          const m = Number(get("minute"));
          if (!weekday || Number.isNaN(h) || Number.isNaN(m)) {
            throw new Error(`Unable to read local time for ${cfg.tz}`);
          }

          const isWeekend = weekday === "Sat" || weekday === "Sun";
          const currentMin = h * 60 + m;
          
          const parseTime = (tStr: string) => {
            const [hVal, mVal] = tStr.split(":").map(Number);
            return hVal * 60 + mVal;
          };
          
          const openMin = parseTime(cfg.open);
          const closeMin = parseTime(cfg.close);
          
          let status: "OPEN" | "CLOSED" | "LUNCH" = "CLOSED";
          let countdownText = "Market Closed";
          let progress = 0;
          
          if (!isWeekend) {
            if (cfg.lunchStart && cfg.lunchEnd) {
              const lunchStartMin = parseTime(cfg.lunchStart);
              const lunchEndMin = parseTime(cfg.lunchEnd);
              
              if (currentMin >= openMin && currentMin < lunchStartMin) {
                status = "OPEN";
                const rem = lunchStartMin - currentMin;
                countdownText = `Lunch in ${Math.floor(rem/60)}h ${rem%60}m`;
                progress = ((currentMin - openMin) / (closeMin - openMin)) * 100;
              } else if (currentMin >= lunchStartMin && currentMin < lunchEndMin) {
                status = "LUNCH";
                const rem = lunchEndMin - currentMin;
                countdownText = `Resumes in ${rem}m`;
                progress = ((lunchStartMin - openMin) / (closeMin - openMin)) * 100;
              } else if (currentMin >= lunchEndMin && currentMin < closeMin) {
                status = "OPEN";
                const rem = closeMin - currentMin;
                countdownText = `Closes in ${Math.floor(rem/60)}h ${rem%60}m`;
                progress = ((currentMin - openMin) / (closeMin - openMin)) * 100;
              } else if (currentMin < openMin) {
                const rem = openMin - currentMin;
                countdownText = `Opens in ${Math.floor(rem/60)}h ${rem%60}m`;
              }
            } else {
              if (currentMin >= openMin && currentMin < closeMin) {
                status = "OPEN";
                const rem = closeMin - currentMin;
                countdownText = `Closes in ${Math.floor(rem/60)}h ${rem%60}m`;
                progress = ((currentMin - openMin) / (closeMin - openMin)) * 100;
              } else if (currentMin < openMin) {
                const rem = openMin - currentMin;
                countdownText = `Opens in ${Math.floor(rem/60)}h ${rem%60}m`;
              }
            }
          } else {
            countdownText = "Weekend Closed";
          }
          
          return {
            ...cfg,
            localTime: `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`,
            status,
            countdownText,
            weekday,
            progress: Math.min(100, Math.max(0, progress))
          };
        } catch (e) {
          return { ...cfg, localTime: "--:--", status: "CLOSED", countdownText: "Error", weekday: "Mon", progress: 0 };
        }
      });
      
      setClocks(computed);

      // Overlap detection
      const isUSOpen = computed.find(c => c.label === "US")?.status === "OPEN";
      const isLSEOpen = computed.find(c => c.label === "LSE")?.status === "OPEN";
      const isEuroOpen = computed.find(c => c.label === "EURONEXT")?.status === "OPEN";
      const isAsiaOpen = computed.find(c => c.label === "TSE" || c.label === "HKEX" || c.label === "SGX")?.status === "OPEN";
      const isIndiaOpen = computed.find(c => c.label === "NSE")?.status === "OPEN";

      if (isUSOpen && (isLSEOpen || isEuroOpen)) {
        setOverlapMessage("⚡ DUAL-CORE LIQUIDITY OVERLAP: US & EUROPE SESSIONS ACTIVE");
      } else if (isAsiaOpen && isIndiaOpen) {
        setOverlapMessage("⚡ REGIONAL LIQUIDITY OVERLAP: ASIAN & INDIAN SESSIONS ACTIVE");
      } else {
        setOverlapMessage("");
      }
    };

    updateClocks();
    const interval = setInterval(updateClocks, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch paginated directory lists with filters
  useEffect(() => {
    const fetchDirectory = async () => {
      setDirLoading(true);
      try {
        const query = encodeURIComponent(directorySearch);
        const sector = encodeURIComponent(selectedSector);
        const asset = encodeURIComponent(selectedAsset);
        const res = await fetch(`/api/finance/directory?exchange=${activeTab}&page=${currentPage}&q=${query}&sector=${sector}&assetClass=${asset}`);
        const data = await res.json();
        setDirData(data);
      } catch (err) {
        console.error("Failed to load directory database:", err);
      } finally {
        setDirLoading(false);
      }
    };
    
    fetchDirectory();
  }, [activeTab, currentPage, directorySearch, selectedSector, selectedAsset]);

  return (
    <div className="h-full flex flex-col gap-px bg-border overflow-hidden">
      {/* 1. Global Session Clocks Ribbon */}
      <div className="bg-[#050505] shrink-0 border-b border-border/50 py-1.5 px-3 overflow-x-auto scrollbar-none flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-muted-foreground border-r border-border/50 pr-3 shrink-0">
          <Clock className="w-3.5 h-3.5 text-[hsl(38,95%,55%)] animate-pulse" />
          <span className="font-terminal text-[8px] tracking-widest font-bold">SESSION MONITOR</span>
        </div>
        
        {overlapMessage && (
          <div className="flex items-center gap-1.5 bg-[hsl(38,95%,50%)/10%] border border-[hsl(38,95%,50%)/30%] px-2.5 py-0.5 rounded shrink-0 animate-pulse">
            <span className="font-terminal text-[8px] text-[hsl(38,95%,55%)] font-bold">{overlapMessage}</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          {clocks.map((clk) => {
            const statusColor = clk.status === "OPEN" ? "bg-up" : clk.status === "LUNCH" ? "bg-[hsl(38,95%,50%)]" : "bg-muted-foreground/35";
            const statusText = clk.status === "OPEN" ? "OPEN" : clk.status === "LUNCH" ? "LUNCH" : "CLOSED";
            return (
              <div key={clk.name} className="flex flex-col border border-border/30 bg-black/45 px-2.5 py-1 rounded shrink-0 min-w-[105px]">
                <div className="flex items-center justify-between">
                  <span className="font-terminal text-[9px] font-bold text-foreground">{clk.label}</span>
                  <span className="font-terminal text-[8px] text-muted-foreground">{clk.localTime}</span>
                </div>
                <div className="font-terminal text-[7px] text-muted-foreground mt-0.5 truncate leading-tight">
                  <span className={`inline-block w-1 h-1 rounded-full mr-1 ${statusColor}`} />
                  {statusText} · {clk.countdownText}
                </div>
                {/* Session Elapsed progress visual line */}
                <div className="w-full h-[2px] bg-border/20 mt-1 rounded-full overflow-hidden">
                  <div className="h-full bg-up rounded-full transition-all duration-500" style={{ width: `${clk.progress}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Global Indices Sparklines */}
      <div className="bg-[#060606] flex flex-col shrink-0" style={{ height: "30%" }}>
        <div className="panel-header shrink-0">
          <span className="panel-label">GLOBAL MARKET TRACKERS</span>
          <span className="font-terminal text-[9px] text-muted-foreground ml-auto">{new Date().toLocaleTimeString()}</span>
        </div>
        <div className="grid grid-flow-col auto-cols-[140px] overflow-x-auto scrollbar-none gap-px bg-border flex-1">
          {INDICES.map((idx) => {
            const q = indices?.find(item => item.symbol === idx.symbol);
            const sparkData = sparklines?.[idx.symbol];
            const isUp = (q?.changePercent ?? 0) >= 0;
            return (
              <button
                key={idx.symbol}
                onClick={() => onSymbol(idx.symbol)}
                className="bg-[#080808] hover:bg-white/5 flex flex-col justify-between p-3 transition-colors group text-left"
                data-testid={`index-${idx.symbol}`}
              >
                <div className="flex items-start justify-between w-full">
                  <div className="font-terminal text-[9px] tracking-widest text-muted-foreground">{idx.label}</div>
                  <div className={`font-terminal text-[8px] px-1 py-0.5 rounded ${!q ? "text-muted-foreground/40" : isUp ? "text-up" : "text-down"}`}>
                    {!q ? "–" : isUp ? "▲" : "▼"}
                  </div>
                </div>

                {q ? (
                  <>
                    <div className="font-terminal text-xs font-bold text-foreground tabular-nums">
                      {formatPrice(q.price)}
                    </div>
                    {sparkData ? (
                      <div className="w-full opacity-60 group-hover:opacity-100 transition-opacity my-0.5">
                        <Sparkline data={sparkData} isUp={isUp} />
                      </div>
                    ) : (
                      <div className="h-6 w-full" />
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className={`font-terminal text-[9px] tabular-nums font-semibold ${pctClass(q.changePercent)}`}>
                        {q.changePercent >= 0 ? "+" : ""}{q.changePercent.toFixed(2)}%
                      </span>
                    </div>
                  </>
                ) : idxLoad ? (
                  <>
                    <Skeleton className="h-4 w-20 mt-1 bg-border" />
                    <div className="h-6 w-full" />
                    <Skeleton className="h-3 w-12 bg-border" />
                  </>
                ) : (
                  <>
                    <div className="font-terminal text-xs font-bold text-muted-foreground tabular-nums" data-testid={`index-${idx.symbol}-unavailable`}>—</div>
                    <div className="h-6 w-full" />
                    <span className="font-terminal text-[8px] uppercase tracking-wider text-muted-foreground/70">No data source</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Directory Explorer & Synced Movers */}
      <div className="flex gap-px flex-1 overflow-hidden">
        {/* Left Side: Directory Explorer */}
        <div className="flex-1 bg-[#060606] flex flex-col overflow-hidden">
          {/* Header area with filters */}
          <div className="flex flex-col border-b border-border/50 shrink-0 bg-black/10">
            <div className="panel-header py-1.5 px-3 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <span className="panel-label">GLOBAL SECURITIES DIRECTORY</span>
                <span className="font-terminal text-[8px] text-muted-foreground">({dirData?.total ?? 0} total)</span>
              </div>
              
              {/* Search Bar */}
              <div className="relative flex items-center w-48 h-5 bg-black/40 border border-border/40 rounded focus-within:border-[hsl(38,95%,50%)/50%] transition-colors">
                <Search className="w-3 h-3 text-muted-foreground ml-1.5 shrink-0" />
                <input
                  type="text"
                  value={directorySearch}
                  onChange={(e) => {
                    setDirectorySearch(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Filter symbols/sectors..."
                  className="w-full h-full bg-transparent font-terminal text-[9px] text-foreground focus:outline-none px-1.5 py-1"
                />
              </div>
            </div>

            {/* Filtration Ribbon */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1 bg-[#090909] border-t border-border/30">
              <div className="flex items-center gap-3">
                {/* Asset Classes toggle */}
                <div className="flex items-center gap-1 border-r border-border/40 pr-3">
                  <Layers className="w-3 h-3 text-muted-foreground" />
                  {ASSET_CLASSES.map(ac => (
                    <button
                      key={ac.id}
                      onClick={() => {
                        setSelectedAsset(ac.id);
                        setCurrentPage(1);
                        if (ac.id === "crypto") {
                          setActiveTab("CRYPTO");
                        } else if (ac.id === "forex") {
                          setActiveTab("FOREX");
                        } else if (ac.id === "commodity") {
                          setActiveTab("COMMODITY");
                        } else if (ac.id === "index") {
                          setActiveTab("INDEX");
                        } else if (ac.id === "equity" || ac.id === "mutual_fund" || ac.id === "all") {
                          if (["INDEX", "COMMODITY", "FOREX", "CRYPTO"].includes(activeTab)) {
                            setActiveTab("US");
                          }
                        }
                      }}
                      className={`px-1.5 py-0.5 font-terminal text-[8px] border transition-colors rounded ${
                        selectedAsset === ac.id ? "bg-[hsl(38,95%,50%)/10%] border-[hsl(38,95%,50%)/40%] text-[hsl(38,95%,55%)] font-bold" : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {ac.label}
                    </button>
                  ))}
                </div>

                {/* Sector filter */}
                <div className="flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3 h-3 text-muted-foreground" />
                  <span className="font-terminal text-[8px] text-muted-foreground font-bold">SECTOR</span>
                  <select
                    value={selectedSector}
                    onChange={(e) => {
                      setSelectedSector(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="bg-[#0b0b0b] border border-border/40 font-terminal text-[8.5px] text-foreground focus:outline-none px-1 py-0.5 rounded cursor-pointer"
                  >
                    {SECTORS_LIST.map(sector => (
                      <option key={sector} value={sector}>{sector.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Directory Tabs */}
          <div className="flex bg-black/20 border-b border-border/30 shrink-0 overflow-x-auto scrollbar-none">
            {EXCHANGE_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setCurrentPage(1);
                  if (tab.id === "INDEX") {
                    setSelectedAsset("index");
                    setSelectedSector("All");
                  } else if (tab.id === "COMMODITY") {
                    setSelectedAsset("commodity");
                    setSelectedSector("All");
                  } else if (tab.id === "FOREX") {
                    setSelectedAsset("forex");
                    setSelectedSector("All");
                  } else if (tab.id === "CRYPTO") {
                    setSelectedAsset("crypto");
                    setSelectedSector("All");
                  } else {
                    setSelectedAsset("equity");
                  }
                }}
                className={`px-3 py-1.5 font-terminal text-[9px] tracking-wider border-r border-border/30 transition-colors shrink-0 ${
                  activeTab === tab.id ? "bg-white/5 text-[hsl(38,95%,55%)] border-b border-b-[hsl(38,95%,55%)] font-bold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Directory Table */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {dirLoading ? (
              Array(10).fill(0).map((_, i) => (
                <div key={i} className="flex gap-2 p-2 border-b border-border/30">
                  <Skeleton className="h-4 w-12 bg-border" />
                  <Skeleton className="h-4 flex-1 bg-border" />
                  <Skeleton className="h-4 w-16 bg-border" />
                </div>
              ))
            ) : dirData?.items.length ? (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border/30 bg-black/10 text-muted-foreground text-[8px] font-terminal text-left">
                    <th className="py-1 px-3">SYMBOL</th>
                    <th className="py-1 px-3">COMPANY NAME</th>
                    <th className="py-1 px-3">EXCHANGE</th>
                    <th className="py-1 px-3">SECTOR</th>
                    <th className="py-1 px-3 text-center">REGION</th>
                  </tr>
                </thead>
                <tbody>
                  {dirData.items.map((stock) => (
                    <tr
                      key={stock.symbol}
                      onClick={() => onSymbol(stock.symbol)}
                      className={`border-b border-border/30 hover:bg-white/5 cursor-pointer font-terminal text-[10px] text-foreground transition-colors group ${
                        stock.symbol === activeSymbol ? "bg-amber-500/10 border-l-2 border-l-[hsl(38,95%,55%)] font-semibold" : ""
                      }`}
                    >
                      <td className="py-1.5 px-3 font-bold text-[hsl(38,95%,55%)] group-hover:underline">
                        {stock.symbol}
                      </td>
                      <td className="py-1.5 px-3 text-foreground truncate max-w-[200px]">
                        {stock.name}
                      </td>
                      <td className="py-1.5 px-3 text-muted-foreground">
                        {stock.exchange}
                      </td>
                      <td className="py-1.5 px-3 text-muted-foreground/80 truncate max-w-[150px]">
                        {stock.sector || "—"}
                      </td>
                      <td className="py-1.5 px-3 text-center font-semibold text-muted-foreground">
                        {stock.region || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-8 text-center text-muted-foreground font-terminal text-[10px]">
                No matching directory entries found.
              </div>
            )}
          </div>

          {/* Directory Pagination Footer */}
          {dirData && dirData.totalPages > 1 && (
            <div className="shrink-0 border-t border-border/40 bg-black/20 p-1.5 flex items-center justify-between font-terminal text-[9px] text-muted-foreground">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="flex items-center gap-1 border border-border/40 px-2 py-0.5 rounded hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> PREV
              </button>
              <span>
                Page <strong className="text-foreground">{currentPage}</strong> of <strong className="text-foreground">{dirData.totalPages}</strong>
              </span>
              <button
                disabled={currentPage === dirData.totalPages}
                onClick={() => setCurrentPage(p => Math.min(dirData.totalPages, p + 1))}
                className="flex items-center gap-1 border border-border/40 px-2 py-0.5 rounded hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
              >
                NEXT <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
