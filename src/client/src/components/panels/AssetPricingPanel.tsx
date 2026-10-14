import { useState, useMemo } from "react";
import { LineChart as LCIcon } from "lucide-react";
import { useOHLCV } from "@/lib/useFinance";
import { useFamaFrenchStatus, useFamaFrench3, useCarhart4, useFamaFrench5 } from "@/lib/useFamaFrench";
import { olsRegression, capmExpectedReturn, jensensAlpha, treynorRatio, type RegressionResult } from "@/lib/quantModels";
import { RangeSelector } from "@/components/panels/RangeSelector";

const RANGES = ["3M", "6M", "1Y", "2Y"] as const;
type ModelKey = "capm" | "ff3" | "carhart4" | "ff5";

const MODEL_META: Record<ModelKey, { label: string; factors: string[]; desc: string }> = {
  capm: { label: "CAPM", factors: ["Mkt-RF"], desc: "Single-factor: return explained by market risk alone." },
  ff3: { label: "FAMA-FRENCH 3-FACTOR", factors: ["Mkt-RF", "SMB", "HML"], desc: "Adds size (SMB) and value (HML) factors." },
  carhart4: { label: "CARHART 4-FACTOR", factors: ["Mkt-RF", "SMB", "HML", "Mom"], desc: "Adds momentum (Mom) on top of FF3." },
  ff5: { label: "FAMA-FRENCH 5-FACTOR", factors: ["Mkt-RF", "SMB", "HML", "RMW", "CMA"], desc: "Adds profitability (RMW) and investment (CMA)." },
};

function fmt(v: number, digits = 3): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

export default function AssetPricingPanel({ symbol: initialSymbol }: { symbol?: string }) {
  const [input, setInput] = useState(initialSymbol || "AAPL");
  const [symbol, setSymbol] = useState(initialSymbol || "AAPL");
  const [range, setRange] = useState("1Y");
  const [model, setModel] = useState<ModelKey>("capm");

  const { data: ffStatus } = useFamaFrenchStatus();
  const { data: series, isLoading: ohlcvLoading } = useOHLCV(symbol, range, "1d");
  const bars = series?.bars ?? [];
  const startDate = bars[0]?.date ?? "2024-01-01";
  const endDate = bars[bars.length - 1]?.date ?? new Date().toISOString().slice(0, 10);

  const { data: ff3 = [], isLoading: ff3Loading } = useFamaFrench3(startDate, endDate);
  const { data: carhart4 = [], isLoading: carhart4Loading } = useCarhart4(startDate, endDate);
  const { data: ff5 = [], isLoading: ff5Loading } = useFamaFrench5(startDate, endDate);

  const factorLoading = ff3Loading || carhart4Loading || ff5Loading;

  // Daily stock returns (%), dated by the day the return realized -- same
  // convention as the factor files (day-t return, not day-t+1).
  const stockReturns = useMemo(() => {
    const rows: { date: string; ret: number }[] = [];
    for (let i = 1; i < bars.length; i++) {
      if (bars[i - 1].close > 0) rows.push({ date: bars[i].date, ret: ((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * 100 });
    }
    return rows;
  }, [bars]);

  const regressions = useMemo(() => {
    function build<T extends { date: string; RF: number; MktRF: number }>(factorRows: T[], factorKeys: (keyof T)[]): { reg: RegressionResult; n: number; avgRf: number; avgMktRf: number } | null {
      const factorMap = new Map(factorRows.map((r) => [r.date, r]));
      const matched: { excessReturn: number; factors: number[]; rf: number; mktRf: number }[] = [];
      for (const { date, ret } of stockReturns) {
        const f = factorMap.get(date);
        if (!f) continue;
        const rf = f.RF;
        matched.push({ excessReturn: ret - rf, factors: factorKeys.map((k) => f[k] as number), rf, mktRf: f.MktRF });
      }
      if (matched.length < 10) return null;
      const y = matched.map((m) => m.excessReturn);
      const factorColumns = factorKeys.map((_, i) => matched.map((m) => m.factors[i]));
      const reg = olsRegression(y, factorColumns);
      const avgRf = matched.reduce((s, m) => s + m.rf, 0) / matched.length;
      const avgMktRf = matched.reduce((s, m) => s + m.mktRf, 0) / matched.length;
      return { reg, n: matched.length, avgRf, avgMktRf };
    };

    return {
      capm: build(ff3, ["MktRF"]),
      ff3: build(ff3, ["MktRF", "SMB", "HML"]),
      carhart4: build(carhart4, ["MktRF", "SMB", "HML", "Mom"]),
      ff5: build(ff5, ["MktRF", "SMB", "HML", "RMW", "CMA"]),
    };
  }, [stockReturns, ff3, carhart4, ff5]);

  const active = regressions[model];
  const meta = MODEL_META[model];

  // CAPM-derived ratios always use the single-factor beta, regardless of
  // which model tab is focused -- Treynor/Jensen's Alpha are CAPM concepts.
  const capmBeta = regressions.capm?.reg.betas[0] ?? null;
  const avgDailyReturn = stockReturns.length ? stockReturns.reduce((s, r) => s + r.ret, 0) / stockReturns.length : 0;
  const jensenAlphaAnnual = capmBeta !== null && regressions.capm
    ? jensensAlpha(avgDailyReturn * 252, regressions.capm.avgRf * 252, capmBeta, regressions.capm.avgMktRf * 252 + regressions.capm.avgRf * 252)
    : null;
  const treynor = capmBeta !== null && regressions.capm ? treynorRatio(avgDailyReturn * 252, regressions.capm.avgRf * 252, capmBeta) : null;

  const noFactorData = ffStatus && !ffStatus.available;

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <LCIcon className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">ASSET PRICING & FACTOR MODELS</span>
        <span className="font-terminal text-[7px] text-[hsl(142,71%,50%)] tracking-widest border border-[hsl(142,71%,30%)]/40 px-1.5 py-0.5">KEN FRENCH · OFFICIAL</span>
        <form onSubmit={(e) => { e.preventDefault(); setSymbol(input.toUpperCase()); }} className="ml-3">
          <input value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="TICKER..." className="bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground w-24 focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
        </form>
        <RangeSelector ranges={RANGES} value={range} onChange={setRange} />
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">CAPM</span>
      </div>

      {noFactorData ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md text-center font-terminal text-[10px] text-muted-foreground border border-border px-4 py-3">
            KEN FRENCH FACTOR LIBRARY UNREACHABLE. HONEST STATE, NOT A BUG. TRY AGAIN SHORTLY.
          </div>
        </div>
      ) : ohlcvLoading || factorLoading ? (
        <div className="flex-1 flex items-center justify-center font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
          {/* CAPM-derived headline ratios */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">CAPM BETA</div>
              <div className="font-terminal text-[15px] font-bold tabular-nums text-foreground">{capmBeta !== null ? fmt(capmBeta, 2) : "—"}</div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">CAPM EXPECTED RETURN (ANN.)</div>
              <div className="font-terminal text-[15px] font-bold tabular-nums text-foreground">
                {capmBeta !== null && regressions.capm ? `${fmt(capmExpectedReturn(regressions.capm.avgRf * 252, capmBeta, regressions.capm.avgMktRf * 252 + regressions.capm.avgRf * 252), 1)}%` : "—"}
              </div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">JENSEN'S ALPHA (ANN.)</div>
              <div className={`font-terminal text-[15px] font-bold tabular-nums ${jensenAlphaAnnual !== null && jensenAlphaAnnual >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>
                {jensenAlphaAnnual !== null ? `${jensenAlphaAnnual >= 0 ? "+" : ""}${fmt(jensenAlphaAnnual, 1)}%` : "—"}
              </div>
            </div>
            <div className="border border-border bg-[#0a0a0a] p-2.5">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">TREYNOR RATIO</div>
              <div className="font-terminal text-[15px] font-bold tabular-nums text-foreground">{treynor !== null ? fmt(treynor, 2) : "—"}</div>
            </div>
          </div>

          {/* Model tabs */}
          <div>
            <div className="flex border border-border mb-3">
              {(Object.keys(MODEL_META) as ModelKey[]).map((k) => (
                <button key={k} onClick={() => setModel(k)} className={`flex-1 px-2 py-1.5 font-terminal text-[8px] tracking-wider border-r border-border last:border-r-0 ${model === k ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"}`}>
                  {MODEL_META[k].label}
                </button>
              ))}
            </div>
            <div className="font-terminal text-[8px] text-muted-foreground mb-3">{meta.desc}</div>

            {!active ? (
              <div className="border border-border bg-[#0a0a0a] p-4 font-terminal text-[9px] text-muted-foreground text-center">
                NOT ENOUGH OVERLAPPING TRADING DAYS BETWEEN {symbol}'S RETURNS AND THE FACTOR DATA FOR THIS RANGE.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  <div className="border border-border bg-[#0a0a0a] p-2.5">
                    <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">ALPHA (DAILY, %)</div>
                    <div className={`font-terminal text-[13px] font-bold tabular-nums ${active.reg.alpha >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>{active.reg.alpha >= 0 ? "+" : ""}{fmt(active.reg.alpha, 4)}%</div>
                  </div>
                  <div className="border border-border bg-[#0a0a0a] p-2.5">
                    <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">R-SQUARED</div>
                    <div className="font-terminal text-[13px] font-bold tabular-nums text-foreground">{fmt(active.reg.rSquared, 3)}</div>
                  </div>
                  <div className="border border-border bg-[#0a0a0a] p-2.5">
                    <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">OBSERVATIONS</div>
                    <div className="font-terminal text-[13px] font-bold tabular-nums text-foreground">{active.n}</div>
                  </div>
                </div>

                <div className="border border-border">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-[#070707]">
                        <th className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">FACTOR</th>
                        <th className="px-3 py-2 text-right font-terminal text-[7.5px] text-muted-foreground tracking-wider">LOADING (β)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meta.factors.map((f, i) => (
                        <tr key={f} className="border-b border-border/30 last:border-b-0">
                          <td className="px-3 py-2 font-terminal text-[9px] text-foreground">{f}</td>
                          <td className="px-3 py-2 font-terminal text-[10px] tabular-nums text-right font-bold">{fmt(active.reg.betas[i], 3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Model comparison -- does adding factors actually help? */}
          <div>
            <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">MODEL FIT COMPARISON (R²)</div>
            <div className="grid grid-cols-4 gap-1.5">
              {(Object.keys(MODEL_META) as ModelKey[]).map((k) => (
                <div key={k} className={`border p-2 text-center ${model === k ? "border-[hsl(38,95%,55%)]" : "border-border"} bg-[#0a0a0a]`}>
                  <div className="font-terminal text-[7px] text-muted-foreground mb-1">{MODEL_META[k].label.split(" ")[0]}</div>
                  <div className="font-terminal text-[12px] font-bold tabular-nums text-foreground">{regressions[k] ? fmt(regressions[k]!.reg.rSquared, 3) : "—"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="px-4 py-1.5 border-t border-border bg-[#060606] shrink-0">
        <span className="font-terminal text-[7.5px] text-muted-foreground/70">Real Fama-French/Carhart factors from Kenneth French's Data Library (official, free, no key). Factor data typically lags a few weeks; regressions use only dates present in both the stock and factor series.</span>
      </div>
    </div>
  );
}
