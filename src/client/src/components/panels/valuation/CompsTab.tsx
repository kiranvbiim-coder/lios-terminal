import { useCallback, useEffect, useMemo, useState } from "react";
import { useOverridable } from "@/lib/useOverridable";
import { EditableValue, OverrideStatusBadge } from "@/components/panels/EditableValue";
import { ExportButton } from "@/components/panels/ExportButton";
import { exportWorkbook } from "@/lib/exportXlsx";
import { Plus, X, Sparkles } from "lucide-react";
import { usePeers } from "@/lib/useFinance";
import { computeNetDebt } from "@/lib/valuationModels";
import { buildValuationBridge, type ValuationMethodResult } from "@/lib/valuationEngines";
import type { AnalysisTabProps } from "./types";
export interface CompsInputStatus {
  ready: boolean;
  missing: string[];
}

export function compsInputStatus(inputs: {
  price: number | null;
  marketCap: number | null;
  revenue: number | null;
  sharesOut: number | null;
  netDebt: number | null;
}): CompsInputStatus {
  const missing: string[] = [];
  if (inputs.price == null || !Number.isFinite(inputs.price) || inputs.price <= 0) missing.push("market price");
  if (inputs.marketCap == null || !Number.isFinite(inputs.marketCap) || inputs.marketCap <= 0) missing.push("market capitalization");
  if (inputs.revenue == null || !Number.isFinite(inputs.revenue) || inputs.revenue <= 0) missing.push("revenue");
  if (inputs.sharesOut == null || !Number.isFinite(inputs.sharesOut) || inputs.sharesOut <= 0) missing.push("shares outstanding");
  if (inputs.netDebt == null || !Number.isFinite(inputs.netDebt)) missing.push("net debt");
  return { ready: missing.length === 0, missing };
}


interface MultipleColumn { id: string; label: string; targetLabel: string; builtin: boolean }
interface PeerRow { ticker: string; multiples: Record<string, number> }

// Different industries value different multiples -- P/Book for banks,
// P/FFO for REITs, EV/Revenue for a pre-profit SaaS company -- so the peer
// table isn't limited to P/E, EV/EBITDA and P/S. Those three ship as
// defaults; "+ ADD MULTIPLE" appends any other column, each paired with its
// own target per-share (or per-unit) metric to derive an implied price.
const BUILTIN_COLUMNS: MultipleColumn[] = [
  { id: "pe", label: "P/E", targetLabel: "EPS", builtin: true },
  { id: "evEbitda", label: "EV/EBITDA", targetLabel: "EBITDA / SHARE", builtin: true },
  { id: "ps", label: "P/S", targetLabel: "REVENUE / SHARE", builtin: true },
];

// Starts empty rather than seeded with fictitious tickers/multiples -- a
// "PEER 1: 22x" placeholder would read as a real number pulled from
// somewhere. "+ ADD PEER" builds the table from whatever the analyst
// actually knows; "SUGGEST PEERS" (below) pre-fills it with real
// sector/industry-matched tickers and their real P/E and P/S instead.
const DEFAULT_PEERS: PeerRow[] = [];

function median(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export default function CompsTab({
  symbol, curr, price, eps, marketCap, balCurrent, incCurrent, externalMethods, onMethodsChange,
}: AnalysisTabProps & {
  /** Point-value results from the DCF worksheet, DDM, EVA, and Residual
   * Income tabs (whatever is available for the current symbol), for the
   * optional "blend with comps" football field below. */
  externalMethods?: ValuationMethodResult[];
  /** Reports this tab's own per-multiple implied values upward so the
   * Model Agreement tab can include a comps-based method in its own
   * buildValuationBridge() call. */
  onMethodsChange?: (methods: ValuationMethodResult[]) => void;
}) {
  const [customColumns, setCustomColumns] = useState<MultipleColumn[]>([]);
  const columns = useMemo(() => [...BUILTIN_COLUMNS, ...customColumns], [customColumns]);
  const [peers, setPeers] = useState<PeerRow[]>(DEFAULT_PEERS);
  const targetOv = useOverridable<string>();

  // Real sector/industry-matched peers with their real P/E and P/S (market
  // cap / revenue, both from the same live quote) -- EV/EBITDA has no real
  // per-peer source at this data tier, so peer EV/EBITDA is still 0 for
  // manual entry. The TARGET company's own EBITDA/share below is real,
  // though: EBITDA = EBIT + D&A from filed financials, EV = market cap +
  // net debt from the filed balance sheet, same net-debt formula as the
  // WACC/DCF tab.
  const { data: realPeerQuotes, isLoading: peersLoading } = usePeers(symbol);
  const suggestPeers = () => {
    if (!realPeerQuotes?.length) return;
    setPeers(realPeerQuotes.map((q) => ({
      ticker: q.symbol,
      multiples: {
        pe: q.pe ?? 0,
        ps: q.marketCap && q.revenue ? q.marketCap / q.revenue : 0,
        evEbitda: 0,
        ...Object.fromEntries(customColumns.map((c) => [c.id, 0])),
      },
    })));
  };

  // Real target EBITDA/share, when filed income + balance sheet + a market
  // cap are all available: EBITDA = EBIT + D&A, shares out = market cap /
  // price, EBITDA/share = EBITDA / shares out. Left at 0 (manual entry) if
  // any of the three real inputs is missing.
  const realEbitdaPerShare = useMemo(() => {
    if (!incCurrent || !marketCap || price <= 0) return null;
    const ebitda = incCurrent.ebit + incCurrent.depreciationAndAmortization;
    const sharesOut = marketCap / price;
    return sharesOut > 0 ? ebitda / sharesOut : null;
  }, [incCurrent, marketCap, price]);

  // Real target Revenue/share for the P/S column, same shares-out
  // derivation as EBITDA/share above. Without this, "ps" fell through
  // targetDefault()'s `return 0` and every P/S implied-value row was
  // silently computed off a $0 target (targetVal <= 0 also short-circuits
  // the whole column in the football-field calc at line ~163 below).
  const realRevenuePerShare = useMemo(() => {
    if (!incCurrent || !marketCap || price <= 0 || !Number.isFinite(incCurrent.revenue)) return null;
    const sharesOut = marketCap / price;
    return sharesOut > 0 ? incCurrent.revenue / sharesOut : null;
  }, [incCurrent, marketCap, price]);

  const targetDefault = useCallback((colId: string) => {
    if (colId === "pe") return eps ?? 0;
    if (colId === "evEbitda") return realEbitdaPerShare ?? 0;
    if (colId === "ps") return realRevenuePerShare ?? 0;
    return 0;
  }, [eps, realEbitdaPerShare, realRevenuePerShare]);
  const targetValues: Record<string, number> = Object.fromEntries(
    columns.map(col => [col.id, targetOv.getValue(col.id, targetDefault(col.id))]),
  );

  const [addingColumn, setAddingColumn] = useState(false);
  const [newColLabel, setNewColLabel] = useState("");
  const [newColTargetLabel, setNewColTargetLabel] = useState("");
  const addColumn = () => {
    if (!newColLabel.trim()) return;
    const id = `custom_${Date.now()}`;
    setCustomColumns(prev => [...prev, { id, label: newColLabel.trim().toUpperCase(), targetLabel: (newColTargetLabel.trim() || "TARGET METRIC").toUpperCase(), builtin: false }]);
    setPeers(prev => prev.map(p => ({ ...p, multiples: { ...p.multiples, [id]: 0 } })));
    setNewColLabel("");
    setNewColTargetLabel("");
    setAddingColumn(false);
  };
  const removeColumn = (id: string) => {
    setCustomColumns(prev => prev.filter(c => c.id !== id));
    setPeers(prev => prev.map(p => { const next = { ...p.multiples }; delete next[id]; return { ...p, multiples: next }; }));
    targetOv.resetOverride(id);
  };

  const updatePeerMultiple = useCallback((i: number, colId: string, val: number) => {
    setPeers(prev => prev.map((p, idx) => (idx === i ? { ...p, multiples: { ...p.multiples, [colId]: val } } : p)));
  }, []);
  const updatePeerTicker = useCallback((i: number, val: string) => {
    setPeers(prev => prev.map((p, idx) => (idx === i ? { ...p, ticker: val } : p)));
  }, []);
  const addPeer = () => setPeers(prev => [...prev, { ticker: `PEER ${prev.length + 1}`, multiples: Object.fromEntries(columns.map(c => [c.id, 0])) }]);
  const removePeer = (i: number) => setPeers(prev => prev.filter((_, idx) => idx !== i));

  // Real net debt/share (same computeNetDebt formula as the WACC/DCF tab) --
  // EV/EBITDA multiple x EBITDA/share implies an EV/share, which has to be
  // bridged back to an equity value/share (EV/share − net debt/share)
  // before it's comparable to a P/E or P/S-implied price. P/E and P/S
  // multiples are already equity multiples, so they need no bridge.
  const netDebtPerShare = useMemo(() => {
    if (!balCurrent || !marketCap || price <= 0) return null;
    const netDebt = computeNetDebt(balCurrent.shortTermDebt, balCurrent.longTermDebt, balCurrent.cashAndCashEquivalents);
    const sharesOut = marketCap / price;
    return sharesOut > 0 ? netDebt / sharesOut : null;
  }, [balCurrent, marketCap, price]);

  type MultipleRange = { lo: number; hi: number; mid: number };
  const methods = useMemo(() => {
    return columns
      .map(col => {
        const nums = peers.map(p => p.multiples[col.id] ?? 0).filter(n => n > 0);
        const targetVal = targetValues[col.id] ?? 0;
        if (!nums.length || targetVal <= 0) return null;
        const bridge = col.id === "evEbitda" && netDebtPerShare !== null ? netDebtPerShare : 0;
        const data: MultipleRange = { lo: Math.min(...nums) * targetVal - bridge, hi: Math.max(...nums) * targetVal - bridge, mid: median(nums) * targetVal - bridge };
        return { label: bridge !== 0 ? `${col.label} MULTIPLE (EV → EQUITY BRIDGED)` : `${col.label} MULTIPLE`, data };
      })
      .filter((m): m is { label: string; data: MultipleRange } => m !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, peers, targetOv.getValue, netDebtPerShare]);

  const sharesOut = marketCap && price > 0 ? marketCap / price : 0;

  // This tab's own comps-implied methods, recast as ValuationMethodResult
  // so they can flow through the exact same buildValuationBridge() engine
  // the Model Agreement tab uses -- reported upward for that tab, and used
  // below (combined with externalMethods) for this tab's own optional
  // "blend with DCF/DDM/EVA/RI" football field.
  const compsAsResults: ValuationMethodResult[] = useMemo(() => methods.map(m => ({
    method: `comps_${m.label}`,
    label: m.label,
    enterpriseValue: null,
    equityValue: sharesOut > 0 ? m.data.mid * sharesOut : null,
    valuePerShare: m.data.mid,
    confidence: "medium",
    notes: `Peer multiple median x target metric${m.label.includes("BRIDGED") ? ", bridged EV → equity via real net debt/share" : ""}.`,
  })), [methods, sharesOut]);

  useEffect(() => {
    onMethodsChange?.(compsAsResults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compsAsResults, onMethodsChange]);

  const [blendMethods, setBlendMethods] = useState(false);
  const hasExternalMethods = !!externalMethods?.length;
  const combinedBridge = useMemo(() => {
    if (!blendMethods || !hasExternalMethods) return null;
    return buildValuationBridge([...compsAsResults, ...(externalMethods ?? [])], sharesOut);
  }, [blendMethods, hasExternalMethods, compsAsResults, externalMethods, sharesOut]);

  // Each blended-in external method renders as its own point-value bar
  // (lo = hi = mid = its per-share value) alongside the comps multiple
  // ranges, so DCF/DDM/EVA/RI show up on the same football field.
  const externalBars = useMemo(() => {
    if (!blendMethods || !externalMethods?.length) return [];
    return externalMethods
      .filter(m => m.valuePerShare != null && isFinite(m.valuePerShare) && m.valuePerShare > 0)
      .map(m => ({ label: `${m.label} (${m.confidence.toUpperCase()} CONFIDENCE)`, data: { lo: m.valuePerShare!, hi: m.valuePerShare!, mid: m.valuePerShare! } }));
  }, [blendMethods, externalMethods]);

  const displayMethods = useMemo(() => [...methods, ...externalBars], [methods, externalBars]);

  const allVals = displayMethods.flatMap(m => [m.data.lo, m.data.hi]);
  const globalMin = allVals.length ? Math.min(...allVals, price) : price;
  const globalMax = allVals.length ? Math.max(...allVals, price) : price;
  const span = globalMax - globalMin || 1;
  const pricePct = ((price - globalMin) / span) * 100;

  const inputStatus = compsInputStatus({
    price,
    marketCap,
    revenue: incCurrent?.revenue ?? null,
    sharesOut: marketCap && price > 0 ? marketCap / price : null,
    netDebt: balCurrent && marketCap && price > 0
      ? computeNetDebt(balCurrent.shortTermDebt, balCurrent.longTermDebt, balCurrent.cashAndCashEquivalents)
      : null,
  });

  const handleExport = () => {
    exportWorkbook(`${symbol}_comps.xlsx`, [
      {
        name: "Football Field",
        rows: [
          ["Method", "Low", "Mid", "High"],
          ...displayMethods.map(m => [m.label, m.data.lo, m.data.mid, m.data.hi]),
          [],
          ["Current Price", price],
          ...(combinedBridge ? [[], ["Blended (Weighted) Value / Share", combinedBridge.weightedValuePerShare], ["Blended Range Low", combinedBridge.rangeLow], ["Blended Range High", combinedBridge.rangeHigh]] : []),
        ],
      },
      {
        name: "Target Metrics",
        rows: [
          ["Metric", "Value"],
          ...columns.map(col => [col.targetLabel, targetValues[col.id] ?? 0]),
        ],
      },
      {
        name: "Peer Multiples",
        rows: [
          ["Ticker", ...columns.map(c => c.label)],
          ...peers.map(p => [p.ticker, ...columns.map(c => p.multiples[c.id] ?? 0)]),
        ],
      },
    ]);
  };
  if (!inputStatus.ready) {
    return (
      <div className="flex-1 p-4">
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <div className="font-semibold text-amber-200">COMPS UNAVAILABLE — deterministic dependencies are incomplete.</div>
          <div className="mt-1 text-slate-300">Missing: {inputStatus.missing.join(", ")}. Enter valid market and financial inputs, or use an explicit manual override.</div>
        </div>
      </div>
    );
  }


  return (
    <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-4">
      <div className="flex justify-end">
        <ExportButton onExport={handleExport} />
      </div>
      <div className="bg-[#080808] border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">FOOTBALL FIELD — IMPLIED VALUATION RANGE ({symbol})</span>
          {hasExternalMethods && (
            <label className="flex items-center gap-1.5 font-terminal text-[7px] tracking-widest text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={blendMethods} onChange={(e) => setBlendMethods(e.target.checked)} className="accent-[hsl(38,95%,50%)]" />
              BLEND WITH DCF / DDM / EVA / RESIDUAL INCOME (VIA VALUATION BRIDGE)
            </label>
          )}
        </div>
        {displayMethods.length === 0 ? (
          <div className="font-terminal text-[9px] text-muted-foreground">Add peer multiples and target per-share metrics below to see implied ranges.</div>
        ) : (
          <div className="space-y-3">
            {displayMethods.map(m => {
              const leftPct = ((m.data.lo - globalMin) / span) * 100;
              const widthPct = Math.max(((m.data.hi - m.data.lo) / span) * 100, 0.5);
              const midPct = ((m.data.mid - globalMin) / span) * 100;
              return (
                <div key={m.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-terminal text-[8px] text-muted-foreground">{m.label}</span>
                    <span className="font-terminal text-[8px] text-foreground tabular-nums">
                      {curr}{m.data.lo.toFixed(2)} — {curr}{m.data.hi.toFixed(2)} (mid {curr}{m.data.mid.toFixed(2)})
                    </span>
                  </div>
                  <div className="relative h-4 bg-[#050505] border border-border/50">
                    <div className="absolute h-full bg-[hsl(38,95%,50%)/35%] border-x border-[hsl(38,95%,50%)/70%]" style={{ left: `${leftPct}%`, width: `${widthPct}%` }} />
                    <div className="absolute h-full w-0.5 bg-[hsl(38,95%,55%)]" style={{ left: `${midPct}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="relative h-3 mt-1">
              <div className="absolute h-full w-0.5 bg-[hsl(0,80%,60%)]" style={{ left: `${pricePct}%` }} />
            </div>
            <div className="font-terminal text-[7px] text-muted-foreground text-right">▏ = current price {curr}{price.toFixed(2)}</div>
            {combinedBridge && (
              <div className="mt-2 p-2 bg-[hsl(38,95%,50%)/10%] border border-[hsl(38,95%,50%)/40%] flex items-center justify-between">
                <span className="font-terminal text-[8px] tracking-widest text-muted-foreground">BLENDED (CONFIDENCE-WEIGHTED) VALUE / SHARE</span>
                <span className="font-terminal text-[11px] font-bold text-[hsl(38,95%,55%)] tabular-nums">
                  {curr}{combinedBridge.weightedValuePerShare.toFixed(2)} <span className="text-[8px] text-muted-foreground font-normal">({curr}{combinedBridge.rangeLow.toFixed(2)} – {curr}{combinedBridge.rangeHigh.toFixed(2)})</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-[#080808] border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">TARGET PER-SHARE METRICS ({symbol}) — CLICK TO EDIT</span>
          <OverrideStatusBadge count={columns.filter(c => targetOv.isOverridden(c.id)).length} onResetAll={targetOv.resetAll} />
        </div>
        <p className="font-terminal text-[7px] text-muted-foreground mb-2">
          {realEbitdaPerShare !== null
            ? "EBITDA/Share seeded from real filed financials (EBIT + D&A ÷ shares out); EPS from live EPS."
            : "EBITDA/Share has no real source for this symbol yet — type it manually."}
        </p>
        <div className="grid grid-cols-3 gap-x-4">
          {columns.map(col => (
            <EditableValue
              key={col.id} variant="field" label={col.targetLabel} decimals={2} prefix={curr}
              value={targetValues[col.id] ?? 0}
              isOverridden={targetOv.isOverridden(col.id)}
              onReset={() => targetOv.resetOverride(col.id)}
              onChange={v => targetOv.setOverride(col.id, v)}
            />
          ))}
        </div>
      </div>

      <div className="bg-[#080808] border border-border p-4 overflow-x-auto scrollbar-thin">
        <div className="flex items-center justify-between mb-2">
          <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">PEER MULTIPLES — CLICK ANY CELL TO EDIT</span>
          <div className="flex items-center gap-2">
            {addingColumn ? (
              <div className="flex items-center gap-1">
                <input value={newColLabel} onChange={e => setNewColLabel(e.target.value)} placeholder="MULTIPLE (e.g. P/BOOK)" className="bg-transparent border border-border px-1.5 py-0.5 font-terminal text-[8px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)/50%] w-28" />
                <input value={newColTargetLabel} onChange={e => setNewColTargetLabel(e.target.value)} placeholder="TARGET (e.g. Book Value/Share)" className="bg-transparent border border-border px-1.5 py-0.5 font-terminal text-[8px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)/50%] w-36" />
                <button onClick={addColumn} className="font-terminal text-[8px] px-1.5 py-0.5 bg-[hsl(38,95%,50%)] text-black font-bold">ADD</button>
                <button onClick={() => { setAddingColumn(false); setNewColLabel(""); setNewColTargetLabel(""); }} className="font-terminal text-[8px] px-1.5 py-0.5 border border-border text-muted-foreground">CANCEL</button>
              </div>
            ) : (
              <button onClick={() => setAddingColumn(true)} className="flex items-center gap-1 font-terminal text-[8px] px-2 py-0.5 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">
                <Plus className="w-3 h-3" /> ADD MULTIPLE
              </button>
            )}
            <button onClick={addPeer} className="font-terminal text-[8px] px-2 py-0.5 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">
              + ADD PEER
            </button>
            <button
              onClick={suggestPeers}
              disabled={!realPeerQuotes?.length}
              title="Pre-fill with real sector/industry-matched peers and their real P/E and P/S"
              className="flex items-center gap-1 font-terminal text-[8px] px-2 py-0.5 border border-[hsl(38,95%,50%)/40%] text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)/10%] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-3 h-3" /> {peersLoading ? "LOADING…" : "SUGGEST PEERS"}
            </button>
          </div>
        </div>
        <table className="w-full font-terminal text-[9px]">
          <thead>
            <tr className="text-muted-foreground border-b border-border/40">
              <th className="text-left py-1">TICKER</th>
              {columns.map(col => (
                <th key={col.id} className="text-right py-1">
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {!col.builtin && (
                      <button onClick={() => removeColumn(col.id)} className="text-muted-foreground hover:text-[hsl(0,80%,60%)]">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </span>
                </th>
              ))}
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {peers.map((p, i) => (
              <tr key={i} className="border-b border-border/20 hover:bg-white/[2%]">
                <td className="py-1">
                  <input
                    value={p.ticker}
                    onChange={e => updatePeerTicker(i, e.target.value.toUpperCase())}
                    className="bg-transparent text-foreground font-terminal text-[9px] focus:outline-none w-20"
                  />
                </td>
                {columns.map(col => (
                  <td key={col.id} className="text-right w-20">
                    <EditableValue value={p.multiples[col.id] ?? 0} decimals={1} suffix="x" onChange={v => updatePeerMultiple(i, col.id, v)} />
                  </td>
                ))}
                <td className="text-right">
                  <button onClick={() => removePeer(i)} className="font-terminal text-[9px] text-muted-foreground hover:text-[hsl(0,80%,60%)]">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
