import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Network, Plus, X } from "lucide-react";
import { useQuotes } from "@/lib/useFinance";
import type { OHLCVSeries } from "@/lib/finance";
import type { ViewMode } from "@/lib/terminalTypes";
import ProvenanceBadge from "@/components/data/ProvenanceBadge";
import { buildCorrelationMatrix, dailyReturnsFromBars } from "@/lib/correlationMatrix";

interface Props { onSymbol: (s: string) => void; onNav: (v: ViewMode) => void; }
interface AssetEntry { sym: string; label: string; cat: string; }

const DEFAULT_ASSETS: AssetEntry[] = [
  { sym: "^GSPC", label: "S&P 500", cat: "Equity" },
  { sym: "^IXIC", label: "NASDAQ", cat: "Equity" },
  { sym: "^NSEI", label: "Nifty 50", cat: "Equity" },
  { sym: "TLT", label: "LT Bonds", cat: "Fixed Income" },
  { sym: "GC=F", label: "Gold", cat: "Commodity" },
  { sym: "CL=F", label: "Crude Oil", cat: "Commodity" },
  { sym: "BTC-USD", label: "Bitcoin", cat: "Crypto" },
  { sym: "ETH-USD", label: "Ethereum", cat: "Crypto" },
  { sym: "DX-Y.NYB", label: "USD Index", cat: "FX" },
  { sym: "^VIX", label: "VIX", cat: "Volatility" },
  { sym: "SI=F", label: "Silver", cat: "Commodity" },
  { sym: "^TNX", label: "10Y Yield", cat: "Fixed Income" },
];
const MIN_ASSETS = 4;
const MAX_ASSETS = 16;
const CORRELATION_WINDOW = 90;
const MIN_PAIR_OBSERVATIONS = 20;

const CAT_COLOR: Record<string, string> = {
  Equity: "hsl(38,95%,55%)",
  "Fixed Income": "hsl(200,80%,55%)",
  Commodity: "hsl(270,60%,60%)",
  Crypto: "hsl(142,71%,45%)",
  FX: "hsl(20,90%,55%)",
  Volatility: "hsl(0,80%,55%)",
};

function inferCategory(sym: string): string {
  const value = sym.toUpperCase();
  if (value.endsWith("-USD")) return "Crypto";
  if (value.endsWith("=F")) return "Commodity";
  if (value.endsWith("=X") || value.includes("DX-Y")) return "FX";
  if (value === "^VIX") return "Volatility";
  if (["TLT", "IEF", "BND", "AGG", "^TNX"].includes(value)) return "Fixed Income";
  return "Equity";
}

function correlationColor(value: number | null) {
  if (value === null) return "rgba(255,255,255,0.015)";
  if (value >= 0) return `rgba(34,197,94,${Math.min(0.72, Math.abs(value) * 0.72)})`;
  return `rgba(220,50,50,${Math.min(0.72, Math.abs(value) * 0.72)})`;
}

function correlationLabel(value: number | null) {
  if (value === null) return "INSUFFICIENT DATA";
  const abs = Math.abs(value);
  const strength = abs >= 0.7 ? "STRONG" : abs >= 0.4 ? "MODERATE" : abs >= 0.2 ? "LOW" : "VERY LOW";
  return `${strength} ${value >= 0 ? "POSITIVE" : "NEGATIVE"}`;
}

export default function CrossAssetPanel({ onSymbol }: Props) {
  const [assets, setAssets] = useTerminalArtifactState<AssetEntry[]>("CrossAssetPanel.assets", DEFAULT_ASSETS);
  const [assetInput, setAssetInput] = useTerminalArtifactState("CrossAssetPanel.assetInput", "");
  const [pairA, setPairA] = useTerminalArtifactState("CrossAssetPanel.pairA", 0);
  const [pairB, setPairB] = useTerminalArtifactState("CrossAssetPanel.pairB", 1);

  const symbols = useMemo(() => assets.map((asset) => asset.sym), [assets]);
  const { data: quotes = [], dataUpdatedAt: quoteUpdatedAt } = useQuotes(symbols);
  const quoteMap = useMemo(() => new Map(quotes.map((quote) => [quote.symbol, quote])), [quotes]);

  const historyQueries = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ["/api/finance/ohlcv", symbol, "6M", "1d", "cross-asset"],
      queryFn: async () => {
        const params = new URLSearchParams({ symbol, range: "6M", interval: "1d" });
        const response = await fetch(`/api/finance/ohlcv?${params.toString()}`);
        if (!response.ok) throw new Error(`Failed to fetch OHLCV for ${symbol}`);
        return response.json() as Promise<OHLCVSeries>;
      },
      staleTime: 60_000,
      retry: 1,
    })),
  });

  const returnSeries = useMemo(() => historyQueries.map((query) => dailyReturnsFromBars(query.data?.bars ?? [], CORRELATION_WINDOW)), [historyQueries]);
  const correlations = useMemo(() => buildCorrelationMatrix(returnSeries, MIN_PAIR_OBSERVATIONS), [returnSeries]);
  const historyLoading = historyQueries.some((query) => query.isLoading);
  const historyUpdatedAt = Math.max(0, ...historyQueries.map((query) => query.dataUpdatedAt || 0));
  const availableSeries = returnSeries.filter((series) => series.length >= MIN_PAIR_OBSERVATIONS).length;
  const selected = correlations.matrix[pairA]?.[pairB] ?? null;

  const addAsset = () => {
    const symbol = assetInput.trim().toUpperCase();
    if (!symbol || assets.some((asset) => asset.sym === symbol) || assets.length >= MAX_ASSETS) return;
    setAssets((previous) => [...previous, { sym: symbol, label: symbol, cat: inferCategory(symbol) }]);
    setAssetInput("");
  };

  const removeAsset = (symbol: string) => {
    if (assets.length <= MIN_ASSETS) return;
    const index = assets.findIndex((asset) => asset.sym === symbol);
    setAssets((previous) => previous.filter((asset) => asset.sym !== symbol));
    if (index === pairA || index === pairB || pairA >= assets.length - 1 || pairB >= assets.length - 1) {
      setPairA(0);
      setPairB(1);
    }
  };

  const sp = quoteMap.get("^GSPC")?.changePercent;
  const bonds = quoteMap.get("TLT")?.changePercent;
  const gold = quoteMap.get("GC=F")?.changePercent;
  const vix = quoteMap.get("^VIX")?.price;
  const btc = quoteMap.get("BTC-USD")?.changePercent;
  const regimeInputsReady = [sp, bonds, gold, vix, btc].every((value) => typeof value === "number" && Number.isFinite(value));
  const riskOn = regimeInputsReady && sp! > 0 && btc! > 0 && vix! < 25;
  const riskOff = regimeInputsReady && sp! < -0.5 && gold! > 0 && bonds! > 0;
  const regime = !regimeInputsReady ? "INPUTS INCOMPLETE" : riskOn ? "RISK-ON MODE DETECTED" : riskOff ? "RISK-OFF MODE DETECTED" : "MIXED/NEUTRAL SIGNALS";

  const formatMove = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
  const formatValue = (value: number | undefined, digits = 1) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap" data-workstation-toolbar>
        <Network className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">CROSS-ASSET SIGNAL MAP & CORRELATION MATRIX</span>
        <ProvenanceBadge compact details={{
          kind: "computed",
          source: "/api/finance/ohlcv",
          method: `Pearson correlation of aligned daily close-to-close returns; latest ${CORRELATION_WINDOW} observations per asset`,
          inputs: symbols,
          timestamp: historyUpdatedAt ? new Date(historyUpdatedAt).toISOString() : undefined,
          logic: `Each pair is aligned by trading date. Correlation is withheld below ${MIN_PAIR_OBSERVATIONS} overlapping return observations. No category constants or structural correlations are substituted.`,
          limitations: ["Different exchange holidays reduce pair overlap", "Correlation is historical and non-stationary", "Daily close correlations do not capture intraday dependence"],
        }} />
        <div className="flex items-center gap-1 ml-auto">
          <input value={assetInput} onChange={(event) => setAssetInput(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && addAsset()} disabled={assets.length >= MAX_ASSETS} placeholder={assets.length >= MAX_ASSETS ? `MAX ${MAX_ASSETS}` : "ADD TICKER…"} className="w-28 px-2 py-0.5 bg-[#0c0c0c] border border-border font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%] disabled:opacity-40" />
          <button onClick={addAsset} disabled={assets.length >= MAX_ASSETS} className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"><Plus className="w-2.5 h-2.5" /> ADD</button>
        </div>
        <span className="font-terminal text-[8px] text-muted-foreground tracking-widest">XMAP</span>
      </div>

      <div className={`shrink-0 px-4 py-2 border-b border-border font-terminal text-[9px] flex items-center gap-3 ${riskOn ? "bg-[hsl(142,71%,5%)]" : riskOff ? "bg-[hsl(0,80%,5%)]" : "bg-[#060606]"}`}>
        <div className={`w-2 h-2 rounded-full ${riskOn ? "bg-[hsl(142,71%,45%)]" : riskOff ? "bg-[hsl(0,80%,55%)]" : "bg-[hsl(38,95%,55%)]"}`} />
        <span className={riskOn ? "text-[hsl(142,71%,55%)]" : riskOff ? "text-[hsl(0,80%,55%)]" : "text-[hsl(38,95%,55%)]"}>{regime}</span>
        <span className="text-muted-foreground">· S&P {formatMove(sp)} · Gold {formatMove(gold)} · Bonds {formatMove(bonds)} · VIX {formatValue(vix)}</span>
        <span className="ml-auto text-muted-foreground/80">QUOTE {quoteUpdatedAt ? new Date(quoteUpdatedAt).toLocaleTimeString() : "—"}</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto scrollbar-thin p-3">
          <div className="flex items-center gap-3 mb-2 font-terminal text-[8px] tracking-widest text-muted-foreground">
            <span>CORRELATION MATRIX · DAILY RETURNS · UP TO {CORRELATION_WINDOW} OBS</span>
            <span className={availableSeries === assets.length ? "text-emerald-400" : "text-amber-400"}>{availableSeries}/{assets.length} SERIES READY</span>
            <span>PAIR N {correlations.minPairObservations}–{correlations.maxPairObservations}</span>
            {historyLoading && <span className="text-amber-400">REFRESHING…</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="border-collapse text-[7px] font-terminal">
              <thead><tr><th className="w-20 px-1 py-1" />{assets.map((asset) => <th key={asset.sym} className="px-0.5 py-1 text-center w-14 font-normal" style={{ color: CAT_COLOR[asset.cat] }}>{asset.label.split(" ")[0]}</th>)}</tr></thead>
              <tbody>
                {assets.map((rowAsset, rowIndex) => (
                  <tr key={rowAsset.sym}>
                    <td className="px-1 py-0.5 text-right font-bold" style={{ color: CAT_COLOR[rowAsset.cat] }}>{rowAsset.label.split(" ")[0]}</td>
                    {assets.map((columnAsset, columnIndex) => {
                      const cell = correlations.matrix[rowIndex]?.[columnIndex];
                      const value = cell?.value ?? null;
                      const active = rowIndex === pairA && columnIndex === pairB;
                      return (
                        <td key={columnAsset.sym} onClick={() => { setPairA(rowIndex); setPairB(columnIndex); }} className={`w-14 h-7 text-center cursor-pointer border transition-all ${active ? "border-[hsl(38,95%,55%)]" : "border-[#111] hover:border-[hsl(38,95%,50%)/50%]"}`} style={{ backgroundColor: rowIndex === columnIndex && value !== null ? "hsl(38,95%,10%)" : correlationColor(value) }} title={value === null ? `${rowAsset.label} vs ${columnAsset.label}: insufficient overlap (${cell?.observations ?? 0} observations)` : `${rowAsset.label} vs ${columnAsset.label}: ${value.toFixed(3)} · N=${cell?.observations ?? 0}`}>
                          <span className={`text-[8px] tabular-nums ${value !== null && Math.abs(value) > 0.6 ? "font-bold" : ""} ${value === null ? "text-muted-foreground/45" : rowIndex === columnIndex ? "text-[hsl(38,95%,55%)]" : value > 0 ? "text-[hsl(142,71%,78%)]" : "text-[hsl(0,80%,78%)]"}`}>{value === null ? "—" : value.toFixed(2)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 grid grid-cols-[1fr_260px] gap-3">
            <div className="border border-border bg-[#080808] p-3">
              <div className="flex items-center gap-2 font-terminal text-[8px] tracking-widest text-muted-foreground"><span>SELECTED PAIR</span><span style={{ color: CAT_COLOR[assets[pairA]?.cat] }}>{assets[pairA]?.label}</span><span>×</span><span style={{ color: CAT_COLOR[assets[pairB]?.cat] }}>{assets[pairB]?.label}</span></div>
              <div className="mt-2 flex items-end gap-4">
                <div className={`font-terminal text-[24px] font-bold ${selected?.value === null || selected?.value === undefined ? "text-muted-foreground" : selected.value >= 0 ? "text-emerald-400" : "text-red-400"}`}>{selected?.value === null || selected?.value === undefined ? "—" : selected.value.toFixed(3)}</div>
                <div className="pb-1 font-terminal text-[9px] text-muted-foreground">{correlationLabel(selected?.value ?? null)}</div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 font-terminal text-[8px] text-muted-foreground"><span>N <b className="text-foreground">{selected?.observations ?? 0}</b></span><span>FROM <b className="text-foreground">{selected?.startDate ?? "—"}</b></span><span>TO <b className="text-foreground">{selected?.endDate ?? "—"}</b></span></div>
            </div>
            <div className="border border-border bg-[#080808] p-3 font-terminal text-[8px] text-muted-foreground leading-relaxed">
              <div className="tracking-widest mb-1">METHOD CONTRACT</div>
              Pearson correlation on date-aligned close-to-close returns. Values are withheld rather than backfilled when overlap or variance is insufficient.
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mt-3">{Object.entries(CAT_COLOR).map(([cat, color]) => <div key={cat} className="flex items-center gap-1.5 font-terminal text-[7.5px] text-muted-foreground"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />{cat}</div>)}</div>
        </div>

        <div className="w-64 shrink-0 border-l border-border bg-[#060606] p-4 space-y-3 overflow-y-auto scrollbar-thin">
          <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">LIVE ASSET SIGNALS</div>
          {assets.map((asset) => {
            const quote = quoteMap.get(asset.sym);
            const change = quote?.changePercent;
            const hasChange = typeof change === "number" && Number.isFinite(change);
            return (
              <div key={asset.sym} className="py-2 border-b border-border/30 cursor-pointer hover:bg-white/[1%]" onClick={() => onSymbol(asset.sym)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-1.5">{assets.length > MIN_ASSETS && <button onClick={(event) => { event.stopPropagation(); removeAsset(asset.sym); }} className="text-muted-foreground hover:text-red-400"><X className="w-2.5 h-2.5" /></button>}<span className="font-terminal text-[9px] text-foreground truncate">{asset.label}</span></div>
                  <span className={`font-terminal text-[10px] font-bold tabular-nums ${!hasChange ? "text-muted-foreground" : change! >= 0 ? "text-emerald-400" : "text-red-400"}`}>{hasChange ? `${change! >= 0 ? "+" : ""}${change!.toFixed(2)}%` : "—"}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5"><span className="font-terminal text-[7.5px]" style={{ color: CAT_COLOR[asset.cat] }}>{asset.cat}</span><span className="font-terminal text-[7.5px] text-muted-foreground tabular-nums">{quote && Number.isFinite(quote.price) ? quote.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "NO QUOTE"}</span></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
