import { useState, useMemo } from "react";
import { Palmtree } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useTourismIndicators, useTourismIndicatorDetail } from "@/lib/useEconomics";
import { useWbCatalog, useWbIndicator, useWbCountries } from "@/lib/useOfficialSources";
import { computeDescriptiveStats } from "@/lib/statistics";
import { olsRegression } from "@/lib/quantModels";

function fmtValue(value: number | null, unit: string) {
  if (value === null) return "—";
  const formatted = Math.abs(value) >= 1000 ? value.toLocaleString("en-US", { maximumFractionDigits: 1 }) : value.toFixed(2);
  return unit === "%" ? `${formatted}%` : formatted;
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function pctClass(n: number | null) {
  if (n === null) return "text-muted-foreground";
  return n >= 0 ? "text-[hsl(142,71%,45%)]" : "text-[hsl(0,80%,55%)]";
}

// Compact axis-tick label ("45M", "1.6B") -- full toLocaleString() output
// for World Bank's 9+ digit arrivals/receipts figures overflows a narrow
// Y-axis tick label and gets visually clipped.
function fmtCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

type Source = "fred" | "worldbank";

export default function TourismIndicatorPanel() {
  const [source, setSource] = useState<Source>("worldbank");

  // ── US (FRED) ──────────────────────────────────────────────────────────
  const { data: indicators, isLoading: listLoading } = useTourismIndicators();
  const [selected, setSelected] = useState<string | null>(null);
  const activeSeriesId = selected ?? indicators?.[0]?.seriesId ?? "";
  const { data: detail, isLoading: detailLoading } = useTourismIndicatorDetail(activeSeriesId);

  // ── International (World Bank) ────────────────────────────────────────
  const { data: wbCatalog, isLoading: wbCatalogLoading } = useWbCatalog("tourism_hospitality");
  const { data: countries } = useWbCountries();
  const [wbCode, setWbCode] = useState<string | null>(null);
  const [wbCountry, setWbCountry] = useState("US");
  const activeWbCode = wbCode ?? wbCatalog?.[0]?.code ?? "";
  const { data: wbDetail, isLoading: wbDetailLoading } = useWbIndicator(activeWbCode, wbCountry);

  // Real stats on whichever series is active, using the same
  // computeDescriptiveStats/olsRegression the Finance domain uses for CAPM
  // inputs -- applied here to tourism arrivals/receipts instead of returns.
  const wbStats = useMemo(() => {
    if (!wbDetail?.history.length) return null;
    return computeDescriptiveStats(wbDetail.history.map((h) => h.value));
  }, [wbDetail]);

  // Year-over-year growth rate series -- the natural "seasonality-adjusted
  // trend" view for an annual series (World Bank tourism data is annual,
  // so a real seasonal decomposition needs monthly granularity it doesn't
  // have; YoY growth is the honest equivalent at this frequency).
  const wbYoyGrowth = useMemo(() => {
    if (!wbDetail?.history || wbDetail.history.length < 2) return [];
    const h = wbDetail.history;
    return h.slice(1).map((row, i) => ({
      year: row.year,
      growthPct: h[i].value !== 0 ? ((row.value - h[i].value) / Math.abs(h[i].value)) * 100 : 0,
    }));
  }, [wbDetail]);

  // Regression: this indicator vs. GDP (current US$) for the same country --
  // real OLS, e.g. "how much does tourism revenue move with GDP".
  const gdpCode = "NY.GDP.MKTP.CD";
  const { data: gdpDetail } = useWbIndicator(gdpCode, wbCountry);
  const gdpRegression = useMemo(() => {
    if (!wbDetail?.history.length || !gdpDetail?.history.length || activeWbCode === gdpCode) return null;
    const gdpByYear = new Map(gdpDetail.history.map((r) => [r.year, r.value]));
    const y: number[] = [];
    const x: number[] = [];
    for (const row of wbDetail.history) {
      if (gdpByYear.has(row.year)) { y.push(row.value); x.push(gdpByYear.get(row.year)!); }
    }
    if (y.length < 4) return null;
    return { ...olsRegression(y, [x]), n: y.length };
  }, [wbDetail, gdpDetail, activeWbCode]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex border-b border-border bg-[#060606] shrink-0">
        {([
          { value: "worldbank" as Source, label: "INTERNATIONAL (WORLD BANK)" },
          { value: "fred" as Source, label: "US (FRED)" },
        ]).map((s) => (
          <button
            key={s.value}
            onClick={() => setSource(s.value)}
            className={`px-3 py-2 font-terminal text-[8px] tracking-wider border-r border-border/50 ${
              source === s.value ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)] border-b-2 border-b-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {source === "fred" ? (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-56 shrink-0 border-r border-border overflow-y-auto scrollbar-thin">
            <div className="px-3 py-2 border-b border-border">
              <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">TRAVEL &amp; HOSPITALITY CATALOG</span>
            </div>
            {listLoading ? (
              <div className="p-3 space-y-2">
                {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-8 bg-border" />)}
              </div>
            ) : (
              (indicators ?? []).map((ind) => (
                <button
                  key={ind.seriesId}
                  onClick={() => setSelected(ind.seriesId)}
                  className={`w-full text-left px-3 py-2 border-b border-border/50 transition-colors ${
                    ind.seriesId === activeSeriesId ? "bg-[hsl(38,95%,50%)]/10 border-l-2 border-l-[hsl(38,95%,55%)]" : "hover:bg-white/5"
                  }`}
                >
                  <div className="font-terminal text-[9px] text-foreground truncate">{ind.name.toUpperCase()}</div>
                  <div className="font-terminal text-[8px] text-muted-foreground">{ind.seriesId}</div>
                </button>
              ))
            )}
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
            {detailLoading || !detail ? (
              <div className="space-y-4">
                <Skeleton className="h-8 w-64 bg-border" />
                <Skeleton className="h-40 w-full bg-border" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <Palmtree className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
                  <span className="font-terminal text-[10px] tracking-widest text-foreground">{detail.quote.name.toUpperCase()}</span>
                  {!detail.quote.isLive && (
                    <span className="font-terminal text-[8px] text-[hsl(0,80%,60%)] border border-[hsl(0,80%,60%)]/40 px-1.5 py-0.5">NOT LIVE</span>
                  )}
                </div>
                <div className="font-terminal text-[9px] text-muted-foreground mb-4">{detail.quote.seriesId}</div>

                <div className="flex items-baseline gap-4 mb-5">
                  <span className="font-terminal text-3xl text-foreground">{fmtValue(detail.quote.value, detail.quote.unit)}</span>
                  {detail.quote.changePercent !== null && (
                    <span className={`font-terminal text-sm ${pctClass(detail.quote.changePercent)}`}>
                      {detail.quote.changePercent >= 0 ? "+" : ""}{detail.quote.changePercent.toFixed(2)}%
                      {detail.quote.change !== null && ` (${detail.quote.change >= 0 ? "+" : ""}${detail.quote.change.toFixed(2)})`}
                    </span>
                  )}
                </div>

                {detail.quote.asOf && (
                  <div className="font-terminal text-[9px] text-muted-foreground mb-4">AS OF {fmtDate(detail.quote.asOf).toUpperCase()}</div>
                )}

                <div className="h-64 border border-border bg-[#0a0a0a] p-3 mb-4">
                  {detail.history.length < 2 ? (
                    <div className="h-full flex items-center justify-center font-terminal text-[9px] text-muted-foreground">
                      NO HISTORICAL DATA AVAILABLE
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={detail.history} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="tourismIndicatorFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(38,95%,55%)" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="hsl(38,95%,55%)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" tick={{ fill: "hsl(0,0%,50%)", fontSize: 9 }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={40} />
                        <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 9 }} axisLine={false} tickLine={false} width={50} domain={["auto", "auto"]} />
                        <Tooltip
                          contentStyle={{ background: "#0a0a0a", border: "1px solid hsl(0,0%,15%)", fontSize: 11 }}
                          formatter={(v: number) => [fmtValue(v, detail.quote.unit), detail.quote.name]}
                        />
                        <Area type="monotone" dataKey="value" stroke="hsl(38,95%,55%)" strokeWidth={1.5} fill="url(#tourismIndicatorFill)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div className="font-terminal text-[9px] text-muted-foreground">
                  UNIT: {detail.quote.unit || "—"}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-56 shrink-0 border-r border-border overflow-y-auto scrollbar-thin">
            <div className="px-3 py-2 border-b border-border">
              <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">INDICATOR</span>
            </div>
            {wbCatalogLoading ? (
              <div className="p-3 space-y-2">
                {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-8 bg-border" />)}
              </div>
            ) : (
              (wbCatalog ?? []).map((ind) => (
                <button
                  key={ind.code}
                  onClick={() => setWbCode(ind.code)}
                  className={`w-full text-left px-3 py-2 border-b border-border/50 transition-colors ${
                    ind.code === activeWbCode ? "bg-[hsl(38,95%,50%)]/10 border-l-2 border-l-[hsl(38,95%,55%)]" : "hover:bg-white/5"
                  }`}
                >
                  <div className="font-terminal text-[9px] text-foreground truncate">{ind.name.toUpperCase()}</div>
                  <div className="font-terminal text-[8px] text-muted-foreground">{ind.code}</div>
                </button>
              ))
            )}
            <div className="px-3 py-2 border-t border-b border-border mt-2">
              <span className="font-terminal text-[9px] tracking-widest text-muted-foreground">COUNTRY</span>
            </div>
            <select
              value={wbCountry}
              onChange={(e) => setWbCountry(e.target.value)}
              className="w-full bg-[#0a0a0a] border-b border-border px-3 py-2 font-terminal text-[9px] text-foreground focus:outline-none"
            >
              {(countries ?? []).map((c) => <option key={c.iso2} value={c.iso2}>{c.name.toUpperCase()}</option>)}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
            {wbDetailLoading || !wbDetail ? (
              <div className="space-y-4">
                <Skeleton className="h-8 w-64 bg-border" />
                <Skeleton className="h-40 w-full bg-border" />
              </div>
            ) : !wbDetail.isLive ? (
              <div className="font-terminal text-[9px] text-muted-foreground">NO DATA AVAILABLE FOR THIS COUNTRY/INDICATOR PAIR.</div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <Palmtree className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
                  <span className="font-terminal text-[10px] tracking-widest text-foreground">{wbDetail.name.toUpperCase()} — {wbDetail.country.toUpperCase()}</span>
                </div>
                <div className="font-terminal text-[9px] text-muted-foreground mb-4">{wbDetail.code} · WORLD BANK OPEN DATA</div>

                <div className="flex items-baseline gap-4 mb-5">
                  <span className="font-terminal text-3xl text-foreground">{fmtValue(wbDetail.latestValue, wbDetail.unit)}</span>
                  <span className="font-terminal text-[9px] text-muted-foreground">AS OF {wbDetail.latestYear} — REPORTING LAG, NOT LIVE-TICK</span>
                </div>

                <div className="h-56 border border-border bg-[#0a0a0a] p-3 mb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={wbDetail.history} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="tourismWbFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(38,95%,55%)" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="hsl(38,95%,55%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="year" tick={{ fill: "hsl(0,0%,50%)", fontSize: 9 }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={30} />
                      <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 9 }} axisLine={false} tickLine={false} width={55} domain={["auto", "auto"]} tickFormatter={fmtCompact} />
                      <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid hsl(0,0%,15%)", fontSize: 11 }} formatter={(v: number) => [fmtValue(v, wbDetail.unit), wbDetail.name]} />
                      <Area type="monotone" dataKey="value" stroke="hsl(38,95%,55%)" strokeWidth={1.5} fill="url(#tourismWbFill)" dot={{ r: 2, fill: "hsl(38,95%,55%)" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Real stats -- computeDescriptiveStats(), same function the Finance
                    domain runs on daily returns, applied here to annual tourism data. */}
                <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">STATISTICS ({wbDetail.history.length} YEARS)</div>
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {wbStats && [
                    { label: "MEAN", val: fmtValue(wbStats.mean, wbDetail.unit) },
                    { label: "STD DEV", val: fmtValue(wbStats.stdDev, wbDetail.unit) },
                    { label: "MIN", val: fmtValue(wbStats.min, wbDetail.unit) },
                    { label: "MAX", val: fmtValue(wbStats.max, wbDetail.unit) },
                  ].map((k) => (
                    <div key={k.label} className="border border-border bg-[#0a0a0a] p-2 text-center">
                      <div className="font-terminal text-[6.5px] text-muted-foreground tracking-widest mb-1">{k.label}</div>
                      <div className="font-terminal text-[11px] font-bold tabular-nums text-foreground">{k.val}</div>
                    </div>
                  ))}
                </div>

                {wbYoyGrowth.length > 1 && (
                  <>
                    <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">YEAR-OVER-YEAR GROWTH</div>
                    <div className="h-24 border border-border bg-[#0a0a0a] p-3 mb-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={wbYoyGrowth} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <XAxis dataKey="year" tick={{ fill: "hsl(0,0%,50%)", fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }} axisLine={{ stroke: "hsl(0,0%,15%)" }} tickLine={false} minTickGap={30} />
                          <YAxis tick={{ fill: "hsl(0,0%,50%)", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}%`} />
                          <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(v: number) => [`${v.toFixed(1)}%`, "YoY Growth"]} />
                          <Area type="monotone" dataKey="growthPct" stroke="hsl(199,89%,55%)" strokeWidth={1.5} fill="hsl(199,89%,55%)" fillOpacity={0.15} dot={{ r: 2 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}

                {gdpRegression && (
                  <>
                    <div className="font-terminal text-[9px] text-muted-foreground tracking-widest mb-2">
                      OLS REGRESSION vs. GDP — {wbDetail.name.toUpperCase()} = α + β · GDP
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "BETA (β)", val: gdpRegression.betas[0].toExponential(2) },
                        { label: "R-SQUARED", val: gdpRegression.rSquared.toFixed(3) },
                        { label: "N (YEARS)", val: String(gdpRegression.n) },
                      ].map((k) => (
                        <div key={k.label} className="border border-border bg-[#0a0a0a] p-2.5 text-center">
                          <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">{k.label}</div>
                          <div className="font-terminal text-[12px] font-bold tabular-nums text-[hsl(38,95%,55%)]">{k.val}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
