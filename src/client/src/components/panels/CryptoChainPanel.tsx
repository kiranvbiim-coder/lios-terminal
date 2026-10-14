import { useMemo, useState } from "react";
import { Bitcoin, Plus, X, Database, ShieldCheck } from "lucide-react";
import { useQuotes } from "@/lib/useFinance";
import type { ViewMode } from "@/lib/terminalTypes";
import ProvenanceBadge from "@/components/data/ProvenanceBadge";

interface Props { onSymbol: (s: string) => void; onNav: (v: ViewMode) => void; }
interface CryptoEntry { sym: string; label: string; ticker: string; icon: string; }

const DEFAULT_CRYPTOS: CryptoEntry[] = [
  { sym: "BTC-USD", label: "Bitcoin", ticker: "BTC", icon: "₿" },
  { sym: "ETH-USD", label: "Ethereum", ticker: "ETH", icon: "Ξ" },
  { sym: "SOL-USD", label: "Solana", ticker: "SOL", icon: "◎" },
  { sym: "BNB-USD", label: "BNB", ticker: "BNB", icon: "◆" },
  { sym: "XRP-USD", label: "XRP", ticker: "XRP", icon: "✕" },
  { sym: "ADA-USD", label: "Cardano", ticker: "ADA", icon: "A" },
  { sym: "AVAX-USD", label: "Avalanche", ticker: "AVAX", icon: "▲" },
  { sym: "DOGE-USD", label: "Dogecoin", ticker: "DOGE", icon: "Ð" },
];
const MIN_CRYPTOS = 2;
const MAX_CRYPTOS = 20;

const REQUIRED_ONCHAIN_FIELDS = [
  { metric: "MVRV", requirement: "realized capitalization", state: "UNBOUND" },
  { metric: "NVT", requirement: "network value + transfer volume", state: "UNBOUND" },
  { metric: "FUNDING", requirement: "venue + contract + interval", state: "UNBOUND" },
  { metric: "FEAR & GREED", requirement: "named index provider", state: "UNBOUND" },
  { metric: "BTC DOMINANCE", requirement: "global crypto market-cap universe", state: "UNBOUND" },
] as const;

function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatPrice(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value >= 1000 ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}

export default function CryptoChainPanel({ onSymbol }: Props) {
  const [cryptos, setCryptos] = useState<CryptoEntry[]>(DEFAULT_CRYPTOS);
  const [coinInput, setCoinInput] = useState("");
  const symbols = useMemo(() => cryptos.map((coin) => coin.sym), [cryptos]);
  const { data: quotes = [], isLoading, dataUpdatedAt } = useQuotes(symbols);
  const quoteMap = useMemo(() => new Map(quotes.map((quote) => [quote.symbol, quote])), [quotes]);

  const addCoin = () => {
    let symbol = coinInput.trim().toUpperCase();
    if (!symbol) return;
    if (!symbol.endsWith("-USD")) symbol = `${symbol}-USD`;
    if (cryptos.some((coin) => coin.sym === symbol) || cryptos.length >= MAX_CRYPTOS) return;
    const ticker = symbol.replace("-USD", "");
    setCryptos((previous) => [...previous, { sym: symbol, label: ticker, ticker, icon: "●" }]);
    setCoinInput("");
  };

  const removeCoin = (symbol: string) => {
    if (cryptos.length <= MIN_CRYPTOS) return;
    setCryptos((previous) => previous.filter((coin) => coin.sym !== symbol));
  };

  const btc = quoteMap.get("BTC-USD");
  const knownCaps = quotes.filter((quote) => typeof quote.marketCap === "number" && Number.isFinite(quote.marketCap) && quote.marketCap! > 0);
  const visibleMarketCap = knownCaps.reduce((sum, quote) => sum + (quote.marketCap ?? 0), 0);
  const visibleBtcShare = btc?.marketCap && visibleMarketCap > 0 ? (btc.marketCap / visibleMarketCap) * 100 : null;
  const sourcedQuotes = quotes.filter((quote) => Boolean(quote.quoteSource)).length;

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0" data-workstation-toolbar>
        <Bitcoin className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">CRYPTO MARKET & ON-CHAIN READINESS</span>
        <ProvenanceBadge compact details={{
          kind: "source",
          source: "Quote pipeline via /api/finance/quotes",
          method: "Market fields are displayed only when returned by the quote contract. On-chain metrics remain suppressed until a source-bound connector supplies them.",
          inputs: symbols,
          timestamp: dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined,
          limitations: ["Visible-universe BTC share is not global BTC dominance", "No MVRV/NVT/funding/Fear & Greed values are inferred from prices", "No BUY/HOLD/SELL signal is emitted without source-bound on-chain inputs"],
        }} />
        <div className="flex items-center gap-1 ml-auto">
          <input value={coinInput} onChange={(event) => setCoinInput(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && addCoin()} disabled={cryptos.length >= MAX_CRYPTOS} placeholder="ADD COIN e.g. LTC" className="w-28 px-2 py-0.5 bg-[#0c0c0c] border border-border font-terminal text-[9px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%] disabled:opacity-40" />
          <button onClick={addCoin} disabled={cryptos.length >= MAX_CRYPTOS} className="px-2 py-0.5 border border-border font-terminal text-[8px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"><Plus className="w-2.5 h-2.5" /> ADD</button>
        </div>
        <span className="font-terminal text-[8px] text-muted-foreground tracking-widest">CHAIN</span>
      </div>

      <div className="shrink-0 grid grid-cols-5 border-b border-border bg-[#060606]">
        {[
          { label: "BTC PRICE", value: formatPrice(btc?.price), cls: "text-foreground" },
          { label: "BTC 24H", value: typeof btc?.changePercent === "number" ? `${btc.changePercent >= 0 ? "+" : ""}${btc.changePercent.toFixed(2)}%` : "—", cls: typeof btc?.changePercent === "number" ? btc.changePercent >= 0 ? "text-emerald-400" : "text-red-400" : "text-muted-foreground" },
          { label: "VISIBLE UNIVERSE CAP", value: formatMoney(visibleMarketCap || null), cls: "text-foreground" },
          { label: "BTC SHARE OF VISIBLE SET", value: visibleBtcShare === null ? "—" : `${visibleBtcShare.toFixed(1)}%`, cls: "text-amber-300" },
          { label: "SOURCE COVERAGE", value: `${sourcedQuotes}/${cryptos.length}`, cls: sourcedQuotes === cryptos.length ? "text-emerald-400" : "text-amber-300" },
        ].map((item) => <div key={item.label} className="p-2 border-r border-border last:border-r-0 text-center"><div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-0.5">{item.label}</div><div className={`font-terminal text-[11px] font-bold tabular-nums ${item.cls}`}>{item.value}</div></div>)}
      </div>

      <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/[0.035] px-4 py-2.5">
        <div className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-amber-300" /><span className="font-terminal text-[8.5px] font-semibold tracking-widest text-amber-300">TRUST GATE · ON-CHAIN METRICS WITHHELD</span></div>
        <div className="mt-1 font-terminal text-[8px] leading-relaxed text-muted-foreground">The previous screen contained seeded MVRV, NVT, funding, Fear & Greed, dominance and synthetic histories. Those values are removed. This surface will publish on-chain analytics only after the backend supplies provider identity, metric definition, timestamp and normalization metadata.</div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="grid grid-cols-[1fr_360px] min-h-full">
          <div className="min-w-0">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-[#070707] z-10"><tr className="border-b border-border">{["COIN", "PRICE", "24H", "MARKET CAP", "VOLUME", "52W RANGE", "QUOTE SOURCE"].map((header) => <th key={header} className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">{header}</th>)}</tr></thead>
              <tbody>
                {cryptos.map((coin) => {
                  const quote = quoteMap.get(coin.sym);
                  const change = quote?.changePercent;
                  const rangeReady = typeof quote?.low52 === "number" && quote.low52 > 0 && typeof quote.high52 === "number" && quote.high52 > 0;
                  return (
                    <tr key={coin.sym} className="group border-b border-border/30 hover:bg-white/[1.5%] cursor-pointer" onClick={() => onSymbol(coin.sym)}>
                      <td className="px-3 py-2.5"><div className="flex items-center gap-2">{cryptos.length > MIN_CRYPTOS && <button onClick={(event) => { event.stopPropagation(); removeCoin(coin.sym); }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400"><X className="w-2.5 h-2.5" /></button>}<span className="text-base">{coin.icon}</span><div><div className="font-terminal text-[9px] font-bold text-foreground">{coin.ticker}</div><div className="font-terminal text-[7.5px] text-muted-foreground">{quote?.name || coin.label}</div></div></div></td>
                      <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">{formatPrice(quote?.price)}</td>
                      <td className={`px-3 py-2.5 font-terminal text-[9px] tabular-nums font-bold ${typeof change !== "number" ? "text-muted-foreground" : change >= 0 ? "text-emerald-400" : "text-red-400"}`}>{typeof change === "number" ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}</td>
                      <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">{formatMoney(quote?.marketCap)}</td>
                      <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">{typeof quote?.volume === "number" && Number.isFinite(quote.volume) ? quote.volume.toLocaleString("en-US") : "—"}</td>
                      <td className="px-3 py-2.5 font-terminal text-[8px] tabular-nums text-muted-foreground">{rangeReady ? `${formatPrice(quote!.low52)} – ${formatPrice(quote!.high52)}` : "—"}</td>
                      <td className="px-3 py-2.5"><div className="font-terminal text-[8px] text-cyan-300">{quote?.quoteSource || "UNAVAILABLE"}</div><div className="font-terminal text-[7px] text-muted-foreground">{quote ? quote.isLive ? "LIVE FLAG" : "DELAYED/CACHED" : "NO QUOTE"}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {isLoading && <div className="p-4 font-terminal text-[9px] text-muted-foreground">LOADING SOURCE-BOUND MARKET DATA…</div>}
          </div>

          <aside className="border-l border-border bg-[#060606] p-4 space-y-3">
            <div className="flex items-center gap-2"><Database className="w-3.5 h-3.5 text-cyan-300" /><span className="font-terminal text-[8px] tracking-widest text-muted-foreground">ON-CHAIN SOURCE CONTRACT</span></div>
            {REQUIRED_ONCHAIN_FIELDS.map((field) => <div key={field.metric} className="border border-border bg-[#080808] p-3"><div className="flex items-center justify-between"><span className="font-terminal text-[9px] font-semibold text-foreground">{field.metric}</span><span className="font-terminal text-[7px] border border-amber-500/30 px-1.5 py-0.5 text-amber-300">{field.state}</span></div><div className="mt-1 font-terminal text-[7.5px] leading-relaxed text-muted-foreground">REQUIRES: {field.requirement}</div></div>)}
            <div className="border border-cyan-500/20 bg-cyan-500/[0.025] p-3 font-terminal text-[8px] leading-relaxed text-muted-foreground"><span className="text-cyan-300">PUBLISHING RULE:</span> a metric becomes visible only when the API response can attest provider, metric definition, observed-at timestamp and unit/interval. Signal logic remains disabled until its required inputs pass the same contract.</div>
          </aside>
        </div>
      </div>
    </div>
  );
}
