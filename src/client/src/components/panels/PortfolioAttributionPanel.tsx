import { useState, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { PieChart as PieIcon } from "lucide-react";
import { useQuotes } from "@/lib/useFinance";
import { useFamaFrench3 } from "@/lib/useFamaFrench";
import type { OHLCVSeries } from "@/lib/finance";
import { brinsonAttribution, olsRegression, type BrinsonRow } from "@/lib/quantModels";

type Tab = "brinson" | "style";

interface WeightedHolding { symbol: string; weight: number }

function parseHoldings(input: string): WeightedHolding[] {
  return input.split(",").map((s) => s.trim()).filter(Boolean).map((tok) => {
    const [symbol, w] = tok.split(":");
    return { symbol: symbol.trim().toUpperCase(), weight: Number(w) || 0 };
  }).filter((h) => h.symbol && h.weight > 0);
}

function normalizeWeights(holdings: WeightedHolding[]): WeightedHolding[] {
  const total = holdings.reduce((s, h) => s + h.weight, 0) || 1;
  return holdings.map((h) => ({ ...h, weight: h.weight / total }));
}

function fmt(v: number, digits = 2): string {
  return Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%` : "—";
}

function BrinsonTab() {
  const [inputA, setInputA] = useState("AAPL:30,JPM:25,XOM:20,JNJ:25");
  const [inputB, setInputB] = useState("AAPL:20,JPM:20,XOM:30,JNJ:30");
  const [holdingsA, setHoldingsA] = useState(normalizeWeights(parseHoldings(inputA)));
  const [holdingsB, setHoldingsB] = useState(normalizeWeights(parseHoldings(inputB)));
  const [range, setRange] = useState("6M");

  const allSymbols = useMemo(() => Array.from(new Set([...holdingsA, ...holdingsB].map((h) => h.symbol))), [holdingsA, holdingsB]);
  const { data: quotes } = useQuotes(allSymbols);
  const ohlcvResults = useQueries({
    queries: allSymbols.map((symbol) => ({
      queryKey: ["/api/finance/ohlcv", symbol, range, "1d"],
      queryFn: async () => {
        const params = new URLSearchParams({ symbol, range, interval: "1d" });
        const res = await fetch(`/api/finance/ohlcv?${params.toString()}`);
        if (!res.ok) throw new Error(`Failed to fetch ${symbol}`);
        return res.json() as Promise<OHLCVSeries>;
      },
      staleTime: 60000,
    })),
  });
  const isLoading = ohlcvResults.some((r) => r.isLoading) || !quotes;

  const rows: BrinsonRow[] | null = useMemo(() => {
    if (isLoading) return null;
    const sectorOf = new Map((quotes ?? []).map((q) => [q.symbol, q.sector || "Other"]));
    const periodReturnOf = new Map<string, number>();
    allSymbols.forEach((symbol, i) => {
      const bars = ohlcvResults[i].data?.bars ?? [];
      if (bars.length > 1) periodReturnOf.set(symbol, ((bars[bars.length - 1].close - bars[0].close) / bars[0].close) * 100);
    });

    const bySector = new Map<string, { wp: number; wb: number; wpRetSum: number; wbRetSum: number }>();
    for (const h of holdingsA) {
      const sector = sectorOf.get(h.symbol) ?? "Other";
      const ret = periodReturnOf.get(h.symbol) ?? 0;
      const e = bySector.get(sector) ?? { wp: 0, wb: 0, wpRetSum: 0, wbRetSum: 0 };
      e.wp += h.weight; e.wpRetSum += h.weight * ret;
      bySector.set(sector, e);
    }
    for (const h of holdingsB) {
      const sector = sectorOf.get(h.symbol) ?? "Other";
      const ret = periodReturnOf.get(h.symbol) ?? 0;
      const e = bySector.get(sector) ?? { wp: 0, wb: 0, wpRetSum: 0, wbRetSum: 0 };
      e.wb += h.weight; e.wbRetSum += h.weight * ret;
      bySector.set(sector, e);
    }

    const inputs = Array.from(bySector.entries()).map(([segment, e]) => ({
      segment,
      wp: e.wp, wb: e.wb,
      rp: e.wp > 0 ? e.wpRetSum / e.wp : 0,
      rb: e.wb > 0 ? e.wbRetSum / e.wb : 0,
    }));
    return brinsonAttribution(inputs);
  }, [isLoading, quotes, ohlcvResults, allSymbols, holdingsA, holdingsB]);

  const totals = useMemo(() => {
    if (!rows) return null;
    return rows.reduce((acc, r) => ({
      allocation: acc.allocation + r.allocationEffect,
      selection: acc.selection + r.selectionEffect,
      interaction: acc.interaction + r.interactionEffect,
      total: acc.total + r.totalEffect,
    }), { allocation: 0, selection: 0, interaction: 0, total: 0 });
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="font-terminal text-[7.5px] text-muted-foreground mb-1">PORTFOLIO A (ACTUAL) — SYMBOL:WEIGHT, COMMA-SEPARATED</div>
          <form onSubmit={(e) => { e.preventDefault(); setHoldingsA(normalizeWeights(parseHoldings(inputA))); }}>
            <input value={inputA} onChange={(e) => setInputA(e.target.value)} className="w-full bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
          </form>
        </div>
        <div>
          <div className="font-terminal text-[7.5px] text-muted-foreground mb-1">PORTFOLIO B (BENCHMARK) — SYMBOL:WEIGHT</div>
          <form onSubmit={(e) => { e.preventDefault(); setHoldingsB(normalizeWeights(parseHoldings(inputB))); }}>
            <input value={inputB} onChange={(e) => setInputB(e.target.value)} className="w-full bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
          </form>
        </div>
      </div>
      <div className="flex border border-border w-fit">
        {["1M", "3M", "6M", "1Y"].map((r) => (
          <button key={r} onClick={() => setRange(r)} className={`px-2 py-1 font-terminal text-[8px] tracking-wider border-r border-border last:border-r-0 ${range === r ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>{r}</button>
        ))}
      </div>

      {isLoading ? (
        <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : !rows?.length ? (
        <div className="font-terminal text-[9px] text-muted-foreground">ENTER HOLDINGS FOR BOTH PORTFOLIOS TO RUN ATTRIBUTION.</div>
      ) : (
        <>
          {totals && (
            <div className="grid grid-cols-4 gap-1.5">
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">ALLOCATION EFFECT</div>
                <div className={`font-terminal text-[14px] font-bold tabular-nums ${totals.allocation >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmt(totals.allocation)}</div>
              </div>
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">SELECTION EFFECT</div>
                <div className={`font-terminal text-[14px] font-bold tabular-nums ${totals.selection >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmt(totals.selection)}</div>
              </div>
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">INTERACTION EFFECT</div>
                <div className={`font-terminal text-[14px] font-bold tabular-nums ${totals.interaction >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmt(totals.interaction)}</div>
              </div>
              <div className="border border-[hsl(38,95%,55%)] bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">TOTAL ACTIVE RETURN</div>
                <div className={`font-terminal text-[14px] font-bold tabular-nums ${totals.total >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmt(totals.total)}</div>
              </div>
            </div>
          )}
          <div className="border border-border">
            <table className="w-full border-collapse">
              <thead><tr className="border-b border-border bg-[#070707]">
                <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">SECTOR</th>
                <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">WEIGHT A/B</th>
                <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">RETURN A/B</th>
                <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">ALLOCATION</th>
                <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">SELECTION</th>
                <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">TOTAL</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.segment} className="border-b border-border/30 last:border-b-0">
                    <td className="px-3 py-2 font-terminal text-[9px] font-bold text-foreground">{r.segment}</td>
                    <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right text-muted-foreground">{(r.portfolioWeight * 100).toFixed(0)}% / {(r.benchmarkWeight * 100).toFixed(0)}%</td>
                    <td className="px-3 py-2 font-terminal text-[9px] tabular-nums text-right text-muted-foreground">{r.portfolioReturn.toFixed(1)}% / {r.benchmarkReturn.toFixed(1)}%</td>
                    <td className={`px-3 py-2 font-terminal text-[9px] tabular-nums text-right ${r.allocationEffect >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmt(r.allocationEffect)}</td>
                    <td className={`px-3 py-2 font-terminal text-[9px] tabular-nums text-right ${r.selectionEffect >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmt(r.selectionEffect)}</td>
                    <td className={`px-3 py-2 font-terminal text-[9px] tabular-nums text-right font-bold ${r.totalEffect >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmt(r.totalEffect)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="font-terminal text-[7.5px] text-muted-foreground/70">Sectors and returns are real (live quote sector classification + actual OHLCV period returns). "Benchmark" here is whatever you define as Portfolio B — enter real index-fund/ETF proxies for a true benchmark comparison.</div>
        </>
      )}
    </div>
  );
}

function StyleTab() {
  const [inputSym, setInputSym] = useState("AAPL");
  const [symbol, setSymbol] = useState("AAPL");
  const [range] = useState({ start: "2025-07-01", end: "2026-05-29" });
  const ohlcv = useQueries({
    queries: [{
      queryKey: ["/api/finance/ohlcv", symbol, "2Y", "1d"],
      queryFn: async () => {
        const params = new URLSearchParams({ symbol, range: "2Y", interval: "1d" });
        const res = await fetch(`/api/finance/ohlcv?${params.toString()}`);
        if (!res.ok) throw new Error("Failed");
        return res.json() as Promise<OHLCVSeries>;
      },
    }],
  })[0];
  const bars = ohlcv.data?.bars ?? [];
  const startDate = bars[0]?.date ?? range.start;
  const endDate = bars[bars.length - 1]?.date ?? range.end;
  const { data: ff3 = [], isLoading: ffLoading } = useFamaFrench3(startDate, endDate);

  const exposure = useMemo(() => {
    if (!bars.length || !ff3.length) return null;
    const factorMap = new Map(ff3.map((r) => [r.date, r]));
    const matched: { ret: number; mktRf: number; smb: number; hml: number }[] = [];
    for (let i = 1; i < bars.length; i++) {
      const f = factorMap.get(bars[i].date);
      if (!f) continue;
      const ret = ((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * 100;
      matched.push({ ret: ret - f.RF, mktRf: f.MktRF, smb: f.SMB, hml: f.HML });
    }
    if (matched.length < 20) return null;
    const reg = olsRegression(matched.map((m) => m.ret), [matched.map((m) => m.mktRf), matched.map((m) => m.smb), matched.map((m) => m.hml)]);
    // Normalize |betas| to sum to 100% as an approximate style-tilt readout
    // (a true Sharpe-style analysis solves a constrained QP; this is the
    // unconstrained OLS loadings re-scaled for readability, not the exact
    // constrained result -- labeled as such below).
    const absBetas = reg.betas.map((b) => Math.abs(b));
    const totalAbs = absBetas.reduce((s, v) => s + v, 0) || 1;
    return { betas: reg.betas, tilts: absBetas.map((v) => (v / totalAbs) * 100), rSquared: reg.rSquared, n: matched.length };
  }, [bars, ff3]);

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); setSymbol(inputSym.toUpperCase()); }}>
        <input value={inputSym} onChange={(e) => setInputSym(e.target.value)} placeholder="TICKER..." className="bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
      </form>

      {ohlcv.isLoading || ffLoading ? (
        <div className="font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : !exposure ? (
        <div className="font-terminal text-[9px] text-muted-foreground">NOT ENOUGH OVERLAPPING DATA FOR {symbol}.</div>
      ) : (
        <>
          <div className="font-terminal text-[8px] text-muted-foreground/80 border border-border bg-[#0a0a0a] p-2.5">
            Approximate factor-style tilt (Market / Size / Value), derived by re-scaling the Fama-French 3-factor regression loadings — <span className="text-foreground">not</span> a fully constrained (non-negative, sum-to-1) Sharpe-style analysis. R² = {exposure.rSquared.toFixed(3)} on {exposure.n} days.
          </div>
          <div className="space-y-1.5">
            {[
              { label: "MARKET (Mkt-RF)", tilt: exposure.tilts[0], beta: exposure.betas[0] },
              { label: "SIZE (SMB)", tilt: exposure.tilts[1], beta: exposure.betas[1] },
              { label: "VALUE (HML)", tilt: exposure.tilts[2], beta: exposure.betas[2] },
            ].map((f) => (
              <div key={f.label} className="flex items-center gap-2">
                <span className="w-32 shrink-0 font-terminal text-[8px] text-muted-foreground">{f.label}</span>
                <span className="flex-1 h-4 bg-[#111] relative overflow-hidden">
                  <span className="absolute inset-y-0 left-0 bg-[hsl(38,80%,45%)]" style={{ width: `${Math.max(1, f.tilt)}%` }} />
                </span>
                <span className="w-14 shrink-0 text-right font-terminal text-[9px] tabular-nums text-foreground">{f.tilt.toFixed(1)}%</span>
                <span className="w-16 shrink-0 text-right font-terminal text-[8px] tabular-nums text-muted-foreground">β={f.beta.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function PortfolioAttributionPanel() {
  const [tab, setTab] = useState<Tab>("brinson");
  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <PieIcon className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">PORTFOLIO ATTRIBUTION</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">ATTR</span>
      </div>
      <div className="flex border-b border-border bg-[#060606] shrink-0">
        <button onClick={() => setTab("brinson")} className={`px-3 py-2 font-terminal text-[8px] tracking-wider border-r border-border/50 ${tab === "brinson" ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)] border-b-2 border-b-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>BRINSON ATTRIBUTION</button>
        <button onClick={() => setTab("style")} className={`px-3 py-2 font-terminal text-[8px] tracking-wider border-r border-border/50 ${tab === "style" ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)] border-b-2 border-b-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>FACTOR STYLE EXPOSURE</button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        {tab === "brinson" ? <BrinsonTab /> : <StyleTab />}
      </div>
    </div>
  );
}
