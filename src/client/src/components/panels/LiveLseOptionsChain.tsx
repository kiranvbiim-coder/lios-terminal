import { useMemo, useState } from "react";
import { Save, XCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { LseOptionContract } from "@/lib/useLse";
import { apiRequest } from "@/lib/queryClient";
import { getCurrencySymbol, formatPrice } from "@/lib/finance";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSnapshotMessage, optionRows } from "@/lib/lseDatasetBrowser";

interface Props { symbol: string }
type ContractType = "all" | "call" | "put";

function fmt(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || Number.isNaN(n) ? "—" : n.toFixed(digits);
}

function optionsPath(symbol: string, params: { page: number; limit: number; expiry: string; dte: string; type: ContractType; fullRange: boolean }): string {
  const query = new URLSearchParams({ mode: "page", page: String(params.page), limit: String(params.limit) });
  if (params.expiry) query.set("expiry", params.expiry);
  if (params.dte !== "all" && !params.fullRange) query.set("maxDte", params.dte);
  if (params.type !== "all") query.set("type", params.type);
  return `/api/lse/options-chain/${encodeURIComponent(symbol.toUpperCase())}?${query}`;
}

/** Real LSE chain browser. The theoretical options grid remains a separate panel. */
export default function LiveLseOptionsChain({ symbol }: Props) {
  const { data: status } = useQuery<{ configured: boolean }>({ queryKey: ["/api/lse/status"], queryFn: async () => (await fetch("/api/lse/status")).json(), staleTime: 60_000 });
  const [expiry, setExpiry] = useState("");
  const [dte, setDte] = useState("45");
  const [type, setType] = useState<ContractType>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [fullRange, setFullRange] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const currencySymbol = getCurrencySymbol(symbol);

  const chainQuery = useQuery<unknown>({
    queryKey: ["/api/lse/options-chain", symbol, expiry, dte, type, page, limit, fullRange],
    enabled: !!symbol && !!status?.configured,
    queryFn: async () => {
      const response = await fetch(optionsPath(symbol, { page, limit, expiry, dte, type, fullRange }));
      if (!response.ok) throw new Error("Failed to load the live LSE options chain");
      return response.json();
    },
    staleTime: 60_000,
  });
  const chainPage = optionRows(chainQuery.data, limit);
  const sorted = useMemo(() => chainPage.rows.filter((contract) => (!expiry || contract.expiry === expiry) && (type === "all" || contract.contract_type === type) && (fullRange || dte === "all" || contract.dte <= Number(dte))).sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike || a.contract_type.localeCompare(b.contract_type)), [chainPage.rows, dte, expiry, fullRange, type]);
  const resetFilters = () => setPage(1);
  const saveSnapshot = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const response = await apiRequest("POST", `/api/alternative-data/options/${encodeURIComponent(symbol.toUpperCase())}/capture`);
      setSaveMessage(formatSnapshotMessage(await response.json(), sorted.length));
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Snapshot capture failed.");
    } finally {
      setSaving(false);
    }
  };

  if (status && !status.configured) return <div className="h-full flex items-center justify-center bg-[#050505]"><div className="font-terminal text-[10px] text-muted-foreground text-center max-w-sm"><XCircle className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />London Strategic Edge is not configured. Add an LSE API key through the Data Connection Center to see this symbol's real options chain.</div></div>;
  if (chainQuery.isLoading || !status) return <div className="h-full p-4 space-y-3 bg-[#050505] animate-pulse"><Skeleton className="h-6 w-1/3 bg-border" /><Skeleton className="h-64 w-full bg-border" /></div>;
  if (chainQuery.isError || !chainPage.rows.length) return <div className="h-full flex items-center justify-center bg-[#050505]"><div className="font-terminal text-[10px] text-muted-foreground text-center max-w-sm">{chainQuery.isError ? (chainQuery.error instanceof Error ? chainQuery.error.message : "Failed to load the live chain.") : `No live options chain is available for ${symbol}.`}</div></div>;

  const underlying = sorted[0] ?? chainPage.rows[0];
  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <span className="font-terminal text-[10px] tracking-widest text-muted-foreground uppercase">LSE LIVE CHAIN</span><span className="font-terminal text-[10px] text-foreground font-bold">{symbol}</span>{underlying && <span className="font-terminal text-[9px] text-[hsl(186,80%,55%)]">Underlying: {currencySymbol}{formatPrice(underlying.underlying_price)}</span>}<span className="font-terminal text-[9px] text-muted-foreground ml-auto" data-testid="options-returned-count">{sorted.length} visible / {chainPage.total !== undefined ? `${chainPage.total} returned` : `${chainPage.rows.length} returned`} · page {page}</span>
        <button data-testid="options-save-snapshot" aria-label="Save options snapshot" onClick={() => void saveSnapshot()} disabled={saving} className="flex items-center gap-1.5 px-2 py-1 border border-border text-muted-foreground font-terminal text-[8px] uppercase tracking-widest disabled:opacity-40 hover:border-border/80"><Save className="w-3 h-3" />{saving ? "Saving..." : "Save Snapshot"}</button>
      </div>
      {saveMessage && <div className="px-4 py-1 font-terminal text-[8px] text-muted-foreground border-b border-border" role="status">{saveMessage}</div>}
      <div className="px-4 py-2 border-b border-border bg-[#080808] flex flex-wrap items-end gap-2">
        <label className="font-terminal text-[8px] text-muted-foreground">EXPIRY<select data-testid="options-expiry-filter" aria-label="Filter options expiry" value={expiry} onChange={(event) => { setExpiry(event.target.value); resetFilters(); }} className="block mt-1 bg-[#0a0a0a] border border-border px-2 py-1 text-foreground"><option value="">ALL EXPIRIES</option>{chainPage.availableExpiries.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="font-terminal text-[8px] text-muted-foreground">MAX DTE<select data-testid="options-dte-filter" aria-label="Filter options maximum days to expiry" value={dte} onChange={(event) => { setDte(event.target.value); setFullRange(false); resetFilters(); }} className="block mt-1 bg-[#0a0a0a] border border-border px-2 py-1 text-foreground"><option value="all">ALL</option><option value="7">7</option><option value="30">30</option><option value="45">45</option><option value="90">90</option><option value="180">180</option><option value="365">365</option></select></label>
        <label className="font-terminal text-[8px] text-muted-foreground">TYPE<select data-testid="options-type-filter" aria-label="Filter options contract type" value={type} onChange={(event) => { setType(event.target.value as ContractType); resetFilters(); }} className="block mt-1 bg-[#0a0a0a] border border-border px-2 py-1 text-foreground"><option value="all">CALL + PUT</option><option value="call">CALL</option><option value="put">PUT</option></select></label>
        <label className="font-terminal text-[8px] text-muted-foreground">PAGE SIZE<select data-testid="options-page-size" aria-label="Options page size" value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setPage(1); }} className="block mt-1 bg-[#0a0a0a] border border-border px-2 py-1 text-foreground"><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
        <button data-testid="options-full-range" aria-label="Load full options expiry range" onClick={() => { setFullRange(true); setDte("all"); setPage(1); }} className={`px-2 py-1 border font-terminal text-[8px] ${fullRange ? "border-amber-400 text-foreground" : "border-border text-muted-foreground"}`}>FULL RANGE</button>
        <span className="font-terminal text-[8px] text-muted-foreground ml-auto">EXPIRIES: {chainPage.availableExpiries.length ? chainPage.availableExpiries.join(", ") : "not supplied"}</span>
      </div>
      <div className="px-4 py-1.5 border-b border-border bg-[#080808] font-terminal text-[8px] text-muted-foreground">QUOTE STATUS: LSE connector data. Advanced Greeks/IV/surface runs remain <span className="text-amber-400">MANUAL</span> until this chain is imported from a saved immutable snapshot with as-of/provider metadata; no live source binding is fabricated here.</div>
      <div className="flex-1 overflow-auto"><table className="w-full font-terminal text-[9px]"><thead className="sticky top-0 bg-[#070707]"><tr className="text-muted-foreground uppercase text-[8px] border-b border-border"><th className="text-left py-1.5 px-2">Expiry</th><th className="text-left py-1.5 px-2">DTE</th><th className="text-left py-1.5 px-2">Type</th><th className="text-right py-1.5 px-2">Strike</th><th className="text-right py-1.5 px-2">Last</th><th className="text-right py-1.5 px-2">Volume</th><th className="text-right py-1.5 px-2">IV</th><th className="text-right py-1.5 px-2">Delta</th><th className="text-right py-1.5 px-2">Gamma</th><th className="text-right py-1.5 px-2">Theta</th><th className="text-right py-1.5 px-2">Vega</th></tr></thead><tbody>{sorted.map((contract: LseOptionContract) => <tr key={contract.ticker} className="border-b border-border/50 hover:bg-white/[0.02]"><td className="py-1 px-2 text-muted-foreground">{contract.expiry}</td><td className="py-1 px-2 text-muted-foreground">{contract.dte}</td><td className="py-1 px-2"><span className={contract.contract_type === "call" ? "text-emerald-400" : "text-[hsl(0,80%,60%)]"}>{contract.contract_type.toUpperCase()}</span></td><td className="py-1 px-2 text-right text-foreground">{currencySymbol}{formatPrice(contract.strike)}</td><td className="py-1 px-2 text-right text-foreground">{currencySymbol}{fmt(contract.last_price)}</td><td className="py-1 px-2 text-right text-muted-foreground">{contract.volume_today.toLocaleString()}</td><td className="py-1 px-2 text-right text-cyan-400">{contract.iv !== null ? `${(contract.iv * 100).toFixed(1)}%` : "—"}</td><td className="py-1 px-2 text-right text-muted-foreground">{fmt(contract.delta, 3)}</td><td className="py-1 px-2 text-right text-muted-foreground">{fmt(contract.gamma, 4)}</td><td className="py-1 px-2 text-right text-muted-foreground">{fmt(contract.theta, 3)}</td><td className="py-1 px-2 text-right text-muted-foreground">{fmt(contract.vega, 3)}</td></tr>)}</tbody></table></div>
      <div className="p-2 border-t border-border flex items-center justify-between"><button data-testid="options-prev-page" aria-label="Previous options page" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="px-2 py-1 border border-border font-terminal text-[8px] disabled:opacity-30">PREV</button><span className="font-terminal text-[8px] text-muted-foreground">PAGE {page} · {chainPage.hasMore ? "MORE AVAILABLE" : "END OF RETURNED DATA"}</span><button data-testid="options-load-more" aria-label="Load more options contracts" disabled={!chainPage.hasMore} onClick={() => setPage((value) => value + 1)} className="px-2 py-1 border border-border font-terminal text-[8px] disabled:opacity-30">LOAD MORE</button></div>
    </div>
  );
}
