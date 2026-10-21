import { useTerminalArtifactSymbol } from "@/lib/terminalArtifactState";
import { useState, useMemo, useEffect } from "react";
import { Building2 } from "lucide-react";
import { useLseStatus, useLseCompany, useLseFinancials, useLseDividends, useLseSplits } from "@/lib/useLse";
import { getCurrencySymbol } from "@/lib/finance";
import { buildFinancialAnalysis, mergeFinancialStatementReports, type FinancialMetric } from "@shared/financialAnalysis";
import MetricExplorerPanel from "./MetricExplorerPanel";
import { FusionMetric, FusionMetricGrid, FusionSection, FusionSparkline } from "@/components/terminal/FusionPrimitives";
import { toneForChange } from "@/lib/fusionExperience";
import ProvenanceBadge from "@/components/data/ProvenanceBadge";
import { useAudience } from "@/lib/audience";
import { openEnvironmentCenter } from "@/lib/appShellEvents";
import { type MetricExplorerInput } from "@/lib/MetricExplorer";

interface Props { symbol?: string }

function fmtBig(v: number | null | undefined, curr: string) {
  if (v === null || v === undefined) return "—";
  if (Math.abs(v) >= 1e12) return `${curr}${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `${curr}${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${curr}${(v / 1e6).toFixed(1)}M`;
  return `${curr}${v.toLocaleString()}`;
}

function fmtPct(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

interface ParsedFinancials {
  revenue?: number; netIncome?: number; eps?: number; epsDiluted?: number; ebitda?: number;
  grossProfit?: number; operatingIncome?: number; [key: string]: unknown;
}

function formatAnalysisMetric(metric: FinancialMetric | undefined, curr: string) {
  if (!metric || metric.value === null) return "—";
  if (metric.unit === "percent") return `${(metric.value * 100).toFixed(1)}%`;
  if (metric.unit === "ratio") return `${metric.value.toFixed(2)}x`;
  if (metric.unit === "days") return `${metric.value.toFixed(0)}d`;
  if (metric.unit === "turnover") return `${metric.value.toFixed(2)}x`;
  return fmtBig(metric.value, curr);
}

export default function CompanyFundamentalsPanel({ symbol: initialSymbol }: Props) {
  const isClient = useAudience() === "client";
  const { data: status } = useLseStatus();
  const [symbol, setSymbol] = useTerminalArtifactSymbol(initialSymbol ?? "AAPL");
  const [symbolDraft, setSymbolDraft] = useState(symbol);
  useEffect(() => setSymbolDraft(symbol), [symbol]);
  const commitSymbol = () => { const next = symbolDraft.trim().toUpperCase(); if (/^[A-Z^][A-Z0-9.^=_-]{0,24}$/.test(next) && next !== symbol) setSymbol(next); };
  const configured = status?.configured ?? false;
  const curr = getCurrencySymbol(symbol);

  const { data: company, isLoading: companyLoading } = useLseCompany(symbol);
  const { data: financials } = useLseFinancials(symbol, "income", "FY");
  const { data: balanceReports } = useLseFinancials(symbol, "balance", "FY");
  const { data: cashflowReports } = useLseFinancials(symbol, "cashflow", "FY");
  const { data: dividends } = useLseDividends(symbol);
  const { data: splits } = useLseSplits(symbol);

  const profile = company?.profile;
  const fundamentals = company?.fundamentals;

  // Up to 10 years (EDGAR's real max depth) rather than a hardcoded 5 --
  // this is a compact glance panel so it doesn't expose a depth selector
  // like FinancialStatementsPanel does, but it shouldn't silently discard
  // real data the backend already returns either.
  const parsedReports = useMemo(() => {
    return (financials ?? []).slice(0, 10).map((r) => {
      let parsed: ParsedFinancials = {};
      try { parsed = JSON.parse(r.data); } catch { /* leave empty on parse failure */ }
      return { ...r, parsed };
    });
  }, [financials]);

  const analysisPeriods = useMemo(
    () => buildFinancialAnalysis(mergeFinancialStatementReports({ income: financials, balance: balanceReports, cashflow: cashflowReports }, 10)),
    [financials, balanceReports, cashflowReports],
  );

  const latestMetrics = analysisPeriods[0]?.metrics ?? [];
  const metricByKey = (key: string) => latestMetrics.find((metric) => metric.key === key);
  const joinConflicts = [...(financials ?? []), ...(balanceReports ?? []), ...(cashflowReports ?? [])].filter((report) => report.joinConflict);
  const revenueSeries = [...parsedReports].reverse().map((report) => report.parsed.revenue);
  const incomeSeries = [...parsedReports].reverse().map((report) => report.parsed.netIncome);
  const epsSeries = [...parsedReports].reverse().map((report) => report.parsed.epsDiluted ?? report.parsed.eps);
  const latestRevenueGrowth = metricByKey("revenueGrowth")?.value ?? null;
  const latestRoe = metricByKey("roe")?.value ?? null;
  const metricExplorerInput = useMemo<MetricExplorerInput>(() => ({
    profile,
    fundamentals,
    incomeReports: financials,
    balanceReports,
    cashflowReports,
    dividends,
  }), [profile, fundamentals, financials, balanceReports, cashflowReports, dividends]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <Building2 className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">COMPANY FUNDAMENTALS &amp; FILINGS</span>
        {!isClient && <ProvenanceBadge compact details={{ kind: "source", source: "London Strategic Edge data connector", method: configured ? "Provider-backed company profile, statements, dividends and splits" : "Source readiness only — financial values withheld until provider is configured", limitations: configured ? undefined : ["No placeholder fundamentals are generated", "Provider credentials are not embedded in the client"] }} />}
        <input
          aria-label="Company fundamentals stock symbol"
          value={symbolDraft}
          onChange={(e) => setSymbolDraft(e.target.value.toUpperCase())}
          onBlur={commitSymbol}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitSymbol(); } }}
          placeholder="TICKER..."
          className="ml-4 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground w-28 focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
        />
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">FNDM</span>
      </div>

      {joinConflicts.length > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-500/25 bg-amber-500/[0.035] px-4 py-2 font-terminal text-[8px] text-muted-foreground">
          {isClient ? (
            <>
              <span className="text-amber-300">DATA DIFFERENCE</span>
              <span>Your private import takes priority for {joinConflicts.length} statement row{joinConflicts.length === 1 ? "" : "s"}.</span>
              <button type="button" onClick={openEnvironmentCenter} className="ml-auto text-amber-300 hover:text-foreground">REVIEW DATA</button>
            </>
          ) : (
            <>PRIVATE/PUBLIC STATEMENT CONFLICT: {joinConflicts.length} JOINED ROW{joinConflicts.length === 1 ? "" : "S"} USE PRIVATE IMPORTS OVER PUBLIC DATA. FIRST CONFLICT: {joinConflicts[0].report_type.toUpperCase()} {joinConflicts[0].fiscal_year} VS {joinConflicts[0].joinConflict?.publicProvider}.</>
          )}
        </div>
      )}

      {!configured ? (
        isClient ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="w-full max-w-lg border border-border bg-[#080808] p-5">
              <div className="font-terminal text-[10px] font-bold tracking-widest text-foreground">FINANCIAL DATA NOT CONNECTED</div>
              <div className="mt-2 font-terminal text-[8.5px] leading-relaxed text-muted-foreground">
                Connect a financial source in Data to load company fundamentals. LiOS will leave unavailable values blank rather than substitute them.
              </div>
              <button type="button" onClick={openEnvironmentCenter} className="mt-4 border border-amber-500/35 px-3 py-1.5 font-terminal text-[8px] tracking-widest text-amber-300 hover:bg-amber-500/[0.06]">
                OPEN DATA
              </button>
            </div>
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="mx-auto max-w-4xl border border-border bg-[#080808]">
            <div className="border-b border-border px-5 py-4">
              <div className="font-terminal text-[10px] font-bold tracking-widest text-amber-300">DATA SOURCE NOT CONNECTED</div>
              <div className="mt-1 font-terminal text-[8.5px] text-muted-foreground">Company fundamentals remain intentionally blank until a source can attest the values.</div>
            </div>
            <div className="grid md:grid-cols-2 gap-px bg-border">
              <div className="bg-[#080808] p-5 space-y-3">
                <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">SOURCE READINESS</div>
                {[["PROVIDER","London Strategic Edge"],["STATUS","DISCONNECTED"],["CREDENTIAL","LSE_API_KEY"],["SYMBOL",symbol]].map(([label,value]) => <div key={label} className="flex justify-between border-b border-border/40 pb-2 font-terminal text-[9px]"><span className="text-muted-foreground">{label}</span><span className={label === "STATUS" ? "text-amber-300" : "text-foreground"}>{value}</span></div>)}
                <a href="https://londonstrategicedge.com/data" target="_blank" rel="noreferrer" className="inline-flex border border-amber-500/35 px-3 py-1.5 font-terminal text-[8px] tracking-widest text-amber-300 hover:bg-amber-500/[0.06]">OPEN PROVIDER SETUP ↗</a>
              </div>
              <div className="bg-[#080808] p-5">
                <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-3">COVERAGE WHEN CONNECTED</div>
                <div className="grid grid-cols-2 gap-2">{["COMPANY PROFILE","INCOME STATEMENT","BALANCE SHEET","CASH FLOW","DIVIDENDS","SPLITS","QUALITY METRICS","METRIC LINEAGE"].map((item) => <div key={item} className="border border-border px-2 py-2 font-terminal text-[7.5px] text-foreground">{item}</div>)}</div>
                <div className="mt-4 border border-cyan-500/20 bg-cyan-500/[0.025] p-3 font-terminal text-[8px] leading-relaxed text-muted-foreground"><span className="text-cyan-300">TRUST CONTRACT:</span> no demo revenue, P/E, filing, dividend or derived ratio is substituted for an unavailable provider response.</div>
              </div>
            </div>
          </div>
        </div>
        )
      ) : companyLoading ? (
        <div className="p-4 font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : !profile ? (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-5">
          <div className="font-terminal text-[9px] text-muted-foreground">NO COMPANY DATA FOUND FOR {symbol}.</div>
          <MetricExplorerPanel input={metricExplorerInput} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-5">
          <div className="flex items-start gap-4">
            {profile.image_url_dark && (
              <img src={profile.image_url_dark} alt="" className="w-12 h-12 border border-border object-contain bg-white/5" />
            )}
            <div className="flex-1">
              <div className="font-terminal text-[13px] text-foreground font-bold">{profile.company_name}</div>
              <div className="font-terminal text-[9px] text-muted-foreground">
                {profile.symbol} · {profile.exchange} · {profile.sector} / {profile.industry}
              </div>
              {profile.description && (
                <div className="font-terminal text-[9px] text-muted-foreground/80 mt-2 leading-relaxed max-w-3xl">
                  {profile.description.slice(0, 320)}{profile.description.length > 320 ? "…" : ""}
                </div>
              )}
            </div>
          </div>

          <div data-fusion-responsive-grid="four" className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 border border-border bg-[#0a0a0a] p-3">
            {[
              { label: "CEO", value: profile.ceo },
              { label: "EMPLOYEES", value: profile.full_time_employees ? profile.full_time_employees.toLocaleString() : null },
              { label: "IPO DATE", value: profile.ipo_date },
              { label: "COUNTRY", value: profile.country },
              {
                label: "HEADQUARTERS",
                value: [profile.city, profile.state, profile.country].filter(Boolean).join(", ") || null,
              },
              {
                label: "WEBSITE",
                value: profile.website,
                href: profile.website ? (profile.website.startsWith("http") ? profile.website : `https://${profile.website}`) : null,
              },
            ].map((f) => (
              <div key={f.label} className="flex items-baseline justify-between gap-2 py-0.5">
                <span className="font-terminal text-[7.5px] text-muted-foreground tracking-wider">{f.label}</span>
                {f.href ? (
                  <a href={f.href} target="_blank" rel="noreferrer" className="font-terminal text-[9px] text-[hsl(186,80%,55%)] hover:underline truncate max-w-[140px]">
                    {f.value}
                  </a>
                ) : (
                  <span className="font-terminal text-[9px] text-foreground truncate max-w-[140px]" title={f.value ?? undefined}>{f.value ?? "—"}</span>
                )}
              </div>
            ))}
          </div>

          <FusionMetricGrid>
            <FusionMetric label="PRICE" value={profile.price ? `${curr}${profile.price.toFixed(2)}` : "—"} secondary={profile.exchange} tone="accent" />
            <FusionMetric label="MARKET CAP" value={fmtBig(profile.market_cap, curr)} secondary={profile.sector ?? "—"} />
            <FusionMetric label="P/E" value={fundamentals?.pe_ratio?.toFixed(2) ?? "—"} secondary="Current multiple" />
            <FusionMetric label="BETA" value={profile.beta?.toFixed(2) ?? "—"} secondary="Market sensitivity" />
            <FusionMetric label="REVENUE GROWTH" value={latestRevenueGrowth == null ? "—" : `${(latestRevenueGrowth * 100).toFixed(1)}%`} secondary={analysisPeriods[0]?.fiscalYear ?? "Latest FY"} tone={toneForChange(latestRevenueGrowth)} series={revenueSeries} />
            <FusionMetric label="ROE" value={latestRoe == null ? "—" : `${(latestRoe * 100).toFixed(1)}%`} secondary="Financial quality" tone={toneForChange(latestRoe)} />
            <FusionMetric label="52W RANGE" value={fundamentals?.week_52_high ? `${curr}${fundamentals.week_52_low?.toFixed(0) ?? "—"}–${fundamentals.week_52_high.toFixed(0)}` : "—"} secondary="Observed price range" />
            <FusionMetric label="DIV YIELD" value={fmtPct(fundamentals?.dividend_yield)} secondary="Trailing distribution" />
          </FusionMetricGrid>

          <div data-fusion-responsive-grid="three" className="grid gap-3 lg:grid-cols-3">
            <FusionSection title="Revenue Trend" eyebrow="ANNUAL HISTORY">
              <div className="p-3">
                <FusionSparkline values={revenueSeries} height={62} className="h-[62px] w-full text-cyan-300" label="Revenue history" />
                <div className="mt-2 flex justify-between font-terminal text-[6px] text-muted-foreground"><span>{parsedReports.at(-1)?.fiscal_year ?? "—"}</span><span>{parsedReports[0]?.fiscal_year ?? "—"}</span></div>
              </div>
            </FusionSection>
            <FusionSection title="Net Income Trend" eyebrow="PROFITABILITY">
              <div className="p-3">
                <FusionSparkline values={incomeSeries} height={62} className="h-[62px] w-full text-amber-300" label="Net income history" />
                <div className="mt-2 font-terminal text-[7px] text-muted-foreground">Latest {fmtBig(parsedReports[0]?.parsed.netIncome, curr)}</div>
              </div>
            </FusionSection>
            <FusionSection title="EPS Trend" eyebrow="PER SHARE">
              <div className="p-3">
                <FusionSparkline values={epsSeries} height={62} className="h-[62px] w-full text-up" label="EPS history" />
                <div className="mt-2 font-terminal text-[7px] text-muted-foreground">Latest {parsedReports[0]?.parsed.epsDiluted == null ? "—" : `${curr}${parsedReports[0].parsed.epsDiluted.toFixed(2)}`}</div>
              </div>
            </FusionSection>
          </div>

          {latestMetrics.length > 0 && (
            <div className="space-y-2">
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">FINANCIAL QUALITY SNAPSHOT — {analysisPeriods[0]?.fiscalYear}</div>
              <div data-fusion-responsive-grid="four" className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {[
                  "revenueGrowth",
                  "grossMargin",
                  "ebitdaMargin",
                  "roic",
                  "roe",
                  "netDebtToEbitda",
                  "fcfConversion",
                  "cashConversionCycle",
                ].map((key) => {
                  const metric = metricByKey(key);
                  return (
                    <div key={key} className="border border-border bg-[#0a0a0a] p-2" title={metric?.trace.formula}>
                      <div className="font-terminal text-[7.5px] text-muted-foreground tracking-wider mb-1">{metric?.label ?? key}</div>
                      <div className="font-terminal text-[12px] text-foreground font-bold">{formatAnalysisMetric(metric, curr)}</div>
                      <div className="font-terminal text-[7px] text-muted-foreground/60 mt-1 truncate">
                        {metric?.trace.inputs.length ? metric.trace.inputs.map((item) => item.label).join(" + ") : "insufficient statement data"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <MetricExplorerPanel input={metricExplorerInput} />

          <div>
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">ANNUAL INCOME STATEMENT (FY)</div>
            {parsedReports.length === 0 ? (
              <div className="font-terminal text-[9px] text-muted-foreground border border-border px-3 py-2">NO FINANCIAL REPORTS AVAILABLE.</div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    {["FISCAL YEAR", "REVENUE", "GROSS PROFIT", "OPERATING INCOME", "NET INCOME", "EPS (DILUTED)"].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsedReports.map((r) => (
                    <tr key={r.fiscal_year} className="border-b border-border/30">
                      <td className="px-2 py-2 font-terminal text-[9px] font-bold text-foreground">{r.fiscal_year}</td>
                      <td className="px-2 py-2 font-terminal text-[9px] tabular-nums">{fmtBig(r.parsed.revenue, curr)}</td>
                      <td className="px-2 py-2 font-terminal text-[9px] tabular-nums">{fmtBig(r.parsed.grossProfit, curr)}</td>
                      <td className="px-2 py-2 font-terminal text-[9px] tabular-nums">{fmtBig(r.parsed.operatingIncome, curr)}</td>
                      <td className="px-2 py-2 font-terminal text-[9px] tabular-nums text-[hsl(142,71%,55%)]">{fmtBig(r.parsed.netIncome, curr)}</td>
                      <td className="px-2 py-2 font-terminal text-[9px] tabular-nums">{r.parsed.epsDiluted !== undefined ? `${curr}${r.parsed.epsDiluted.toFixed(2)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">RECENT DIVIDENDS</div>
              {!dividends?.length ? (
                <div className="font-terminal text-[9px] text-muted-foreground border border-border px-3 py-2">NO DIVIDEND HISTORY.</div>
              ) : (
                <div className="border border-border">
                  {dividends.slice(0, 6).map((d, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 last:border-b-0">
                      <span className="font-terminal text-[9px] text-muted-foreground">{d.effective_date}</span>
                      <span className="font-terminal text-[9px] text-foreground font-bold">{curr}{d.dividend_amount.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">STOCK SPLITS</div>
              {!splits?.length ? (
                <div className="font-terminal text-[9px] text-muted-foreground border border-border px-3 py-2">NO SPLIT HISTORY.</div>
              ) : (
                <div className="border border-border">
                  {splits.slice(0, 6).map((s, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 last:border-b-0">
                      <span className="font-terminal text-[9px] text-muted-foreground">{s.effective_date}</span>
                      <span className="font-terminal text-[9px] text-foreground font-bold">{s.split_to}:{s.split_from}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}