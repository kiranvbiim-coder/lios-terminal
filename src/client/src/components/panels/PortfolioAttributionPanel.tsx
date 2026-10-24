import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { PieChart as PieIcon } from "lucide-react";
import { useQuotes } from "@/lib/useFinance";
import { useFamaFrench3 } from "@/lib/useFamaFrench";
import type { OHLCVSeries } from "@/lib/finance";
import { olsRegression } from "@/lib/quantModels";
import { computeObservedBrinsonAttribution, parseAttributionHoldings } from "@/lib/portfolioAttributionObservations";

type Tab = "brinson" | "style";

function fmtEffect(v: number, digits = 2): string {
  return Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(digits)} pp` : "—";
}

function BrinsonTab() {
  const [inputA, setInputA] = useTerminalArtifactState("BrinsonTab.inputA", "AAPL:30,JPM:25,XOM:20,JNJ:25");
  const [inputB, setInputB] = useTerminalArtifactState("BrinsonTab.inputB", "AAPL:20,JPM:20,XOM:30,JNJ:30");
  const [holdingsA, setHoldingsA] = useTerminalArtifactState("BrinsonTab.holdingsA", parseAttributionHoldings(inputA).holdings);
  const [holdingsB, setHoldingsB] = useTerminalArtifactState("BrinsonTab.holdingsB", parseAttributionHoldings(inputB).holdings);
  const [range, setRange] = useTerminalArtifactState("BrinsonTab.range", "6M");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [appliedA, setAppliedA] = useState(inputA);
  const [appliedB, setAppliedB] = useState(inputB);
  const inputsPending = inputA !== appliedA || inputB !== appliedB;
  const applyHoldings = () => {
    const actual = parseAttributionHoldings(inputA);
    const benchmark = parseAttributionHoldings(inputB);
    const problem = actual.error ?? benchmark.error;
    if (problem) { setValidationError(problem); return; }
    setHoldingsA(actual.holdings);
    setHoldingsB(benchmark.holdings);
    setAppliedA(inputA);
    setAppliedB(inputB);
    setValidationError(null);
  };

  const allSymbols = useMemo(() => Array.from(new Set([...holdingsA, ...holdingsB].map((h) => h.symbol))), [holdingsA, holdingsB]);
  const quoteQuery = useQuotes(allSymbols);
  const { data: quotes } = quoteQuery;
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
  const isLoading = quoteQuery.isLoading || ohlcvResults.some((result) => result.isLoading);
  const queryFailed = quoteQuery.isError || ohlcvResults.some((result) => result.isError);
  const calculation = useMemo(() => {
    if (isLoading || queryFailed || !quotes) return null;
    const histories = Object.fromEntries(allSymbols.map((symbol, index) => [symbol, ohlcvResults[index].data]));
    return computeObservedBrinsonAttribution(holdingsA, holdingsB, quotes, histories);
  }, [allSymbols, holdingsA, holdingsB, isLoading, queryFailed, ohlcvResults, quotes]);
  const rows = !inputsPending && !validationError && calculation?.state === "ready" ? calculation.rows : null;
  const totals = rows ? rows.reduce((acc, row) => ({
    allocation: acc.allocation + row.allocationEffect,
    selection: acc.selection + row.selectionEffect,
    interaction: acc.interaction + row.interactionEffect,
    total: acc.total + row.totalEffect,
  }), { allocation: 0, selection: 0, interaction: 0, total: 0 }) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="font-terminal text-[7.5px] text-muted-foreground mb-1">PORTFOLIO A (ACTUAL) — SYMBOL:WEIGHT, COMMA-SEPARATED</div>
          <form onSubmit={(e) => { e.preventDefault(); applyHoldings(); }}>
            <input aria-label="Actual portfolio symbols and relative weights" value={inputA} onChange={(e) => { setInputA(e.target.value); setValidationError(null); }} className="w-full bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
          </form>
        </div>
        <div>
          <div className="font-terminal text-[7.5px] text-muted-foreground mb-1">PORTFOLIO B (BENCHMARK) — SYMBOL:WEIGHT</div>
          <form onSubmit={(e) => { e.preventDefault(); applyHoldings(); }}>
            <input aria-label="Benchmark portfolio symbols and relative weights" value={inputB} onChange={(e) => { setInputB(e.target.value); setValidationError(null); }} className="w-full bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
          </form>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={applyHoldings} className="rounded border border-cyan-300/30 px-3 py-1.5 font-terminal text-[9px] text-cyan-200">Apply both portfolio weights</button>
        <span className="font-ui text-[11px] text-muted-foreground">Weights are relative positive units, normalized separately within each portfolio.</span>
      </div>
      <div className="flex border border-border w-fit">
        {["1M", "3M", "6M", "1Y"].map((r) => (
          <button key={r} onClick={() => setRange(r)} className={`px-2 py-1 font-terminal text-[8px] tracking-wider border-r border-border last:border-r-0 ${range === r ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>{r}</button>
        ))}
      </div>

      {validationError && <p role="alert" className="rounded border border-red-300/30 p-3 font-ui text-[12px] text-red-200">{validationError} No attribution has been updated.</p>}
      {inputsPending && <p role="status" className="font-ui text-[12px] text-amber-200">Portfolio weights changed. Apply both lists to recalculate; prior attribution is hidden to avoid a stale result.</p>}
      {queryFailed && <div role="alert" className="rounded border border-red-300/30 p-3 font-ui text-[12px] text-red-200">Quote or historical price source unavailable. No attribution has been calculated. Check source access or retry loading this panel.</div>}
      {!queryFailed && calculation?.state === "unavailable" && !inputsPending && !validationError &&
        <div role="status" className="rounded border border-amber-300/30 p-3 font-ui text-[12px] text-amber-200">{calculation.message} {calculation.symbols.length > 0 ? `Affected: ${calculation.symbols.join(", ")}.` : ""}</div>}
      {isLoading && !queryFailed ? (
        <div role="status" className="font-terminal text-[9px] text-muted-foreground">LOADING OBSERVED QUOTES AND DAILY CLOSES...</div>
      ) : !rows?.length ? (
        !validationError && !inputsPending && !queryFailed && calculation?.state !== "unavailable" && <div role="status" className="font-terminal text-[9px] text-muted-foreground">ENTER VALID HOLDINGS FOR BOTH PORTFOLIOS TO RUN ATTRIBUTION.</div>
      ) : (
        <>
          {totals && (
            <div className="grid grid-cols-4 gap-1.5">
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">ALLOCATION EFFECT</div>
                <div className={`font-terminal text-[14px] font-bold tabular-nums ${totals.allocation >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmtEffect(totals.allocation)}</div>
              </div>
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">SELECTION EFFECT</div>
                <div className={`font-terminal text-[14px] font-bold tabular-nums ${totals.selection >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmtEffect(totals.selection)}</div>
              </div>
              <div className="border border-border bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">INTERACTION EFFECT</div>
                <div className={`font-terminal text-[14px] font-bold tabular-nums ${totals.interaction >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmtEffect(totals.interaction)}</div>
              </div>
              <div className="border border-[hsl(38,95%,55%)] bg-[#0a0a0a] p-2.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">TOTAL ACTIVE RETURN</div>
                <div className={`font-terminal text-[14px] font-bold tabular-nums ${totals.total >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmtEffect(totals.total)}</div>
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
                    <td className={`px-3 py-2 font-terminal text-[9px] tabular-nums text-right ${r.allocationEffect >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmtEffect(r.allocationEffect)}</td>
                    <td className={`px-3 py-2 font-terminal text-[9px] tabular-nums text-right ${r.selectionEffect >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmtEffect(r.selectionEffect)}</td>
                    <td className={`px-3 py-2 font-terminal text-[9px] tabular-nums text-right font-bold ${r.totalEffect >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{fmtEffect(r.totalEffect)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div role="note" data-testid="attribution-observation-window" className="space-y-1 border border-border/60 p-2 font-ui text-[11px] text-muted-foreground">
            {calculation?.state === "ready" && <p>Observed common daily close window: {calculation.startDate} → {calculation.endDate} ({calculation.commonObservations} common observations). History classification: {calculation.priceSources.join(" · ") || "source timestamp unavailable"}. {calculation.fallbackSymbols.length > 0 && `Fallback-marked sources: ${calculation.fallbackSymbols.join(", ")}.`}</p>}
            <p>Price-only returns (%) omit dividends/distributions, costs, FX and rebalancing. Allocation, selection, interaction and active-return effects are in <strong>percentage points (pp)</strong>, not standalone return %. Quote sector classifications and daily price observations are fetched data, not an immutable signed source snapshot or a total-return benchmark. Portfolio B is analyst-defined. Missing observations or classifications block the calculation; no 0% substitutions.</p>
            <p>For sectors absent from one side, the present side's observed segment return is the comparison reference, so missing sectors do not become fabricated 0% returns.</p>
          </div>
        </>
      )}
    </div>
  );
}

function StyleTab() {
  const [inputSym, setInputSym] = useTerminalArtifactState("StyleTab.inputSym", "AAPL");
  const [symbol, setSymbol] = useTerminalArtifactState("StyleTab.symbol", "AAPL");
  const [range] = useTerminalArtifactState("StyleTab.range", { start: "2025-07-01", end: "2026-05-29" });
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
  const factors = useFamaFrench3(startDate, endDate);
  const { data: ff3 = [], isLoading: ffLoading } = factors;

  const exposure = useMemo(() => {
    if (!bars.length || !ff3.length) return null;
    const factorMap = new Map(ff3.map((r) => [r.date, r]));
    const matched: { ret: number; mktRf: number; smb: number; hml: number }[] = [];
    for (let i = 1; i < bars.length; i++) {
      const f = factorMap.get(bars[i].date);
      if (!f) continue;
      if (!Number.isFinite(bars[i].close) || !Number.isFinite(bars[i - 1].close) || bars[i].close <= 0 || bars[i - 1].close <= 0
        || ![f.RF, f.MktRF, f.SMB, f.HML].every(Number.isFinite)) continue;
      const ret = ((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * 100;
      if (!Number.isFinite(ret)) continue;
      matched.push({ ret: ret - f.RF, mktRf: f.MktRF, smb: f.SMB, hml: f.HML });
    }
    if (matched.length < 20) return null;
    const reg = olsRegression(matched.map((m) => m.ret), [matched.map((m) => m.mktRf), matched.map((m) => m.smb), matched.map((m) => m.hml)]);
    if (!Number.isFinite(reg.rSquared) || reg.betas.some((beta) => !Number.isFinite(beta))) return null;
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

      {ohlcv.isError || factors.isError ? (
        <div role="alert" className="border border-red-300/30 p-3 font-ui text-[12px] text-red-200">Security history or Fama-French factor source failed. No style exposure is calculated from missing observations.</div>
      ) : ohlcv.isLoading || ffLoading ? (
        <div role="status" className="font-terminal text-[9px] text-muted-foreground">LOADING PRICE AND FACTOR OBSERVATIONS...</div>
      ) : !exposure ? (
        <div className="font-terminal text-[9px] text-muted-foreground">NOT ENOUGH OVERLAPPING DATA FOR {symbol}.</div>
      ) : (
        <>
          <div className="font-terminal text-[8px] text-muted-foreground/80 border border-border bg-[#0a0a0a] p-2.5">
            Price-only returns (%) aligned by observation date with Fama-French factor observations (%). Missing/invalid prices and factors are omitted; the regression requires 20+ matched days. Factor source is fetched, not an immutable signed snapshot. Approximate factor-style tilt (Market / Size / Value), derived by re-scaling the Fama-French 3-factor regression loadings — <span className="text-foreground">not</span> a fully constrained (non-negative, sum-to-1) Sharpe-style analysis. R² = {exposure.rSquared.toFixed(3)} on {exposure.n} days.
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
  const [tab, setTab] = useTerminalArtifactState<Tab>("PortfolioAttributionPanel.tab", "brinson");
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
