import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, Search, Plus, X, Sigma, AlertTriangle, CheckCircle2, FileInput, Layers3 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useLseCompany, useLseDividends, useLseFinancials } from "@/lib/useLse";
import { buildCompanyFinancialObservations } from "@/lib/financeObservations";
import {
  FINANCIAL_METRICS,
  formatFinancialMetricValue,
  resolveFinancialMetric,
  searchFinancialMetrics,
  type FinancialMetricDefinition,
  type FinancialMetricObservation,
  type FinancialMetricUnit,
} from "@shared/financialMetricRegistry";
import { buildFinancialMetricResolutionPlan } from "@shared/financialMissingDataResolver";
import { inferFinanceSectorPack, metricsForSectorPack } from "@shared/financeSectorPacks";
import { buildFinancialTrustReport, assessFinancialObservationTrust, financialTrustLabel } from "@shared/financialTrust";
import { buildFinancialAnalyticalContext, contextMetric } from "@shared/financialAnalyticalContext";
import { propagateFinancialScenario } from "@shared/financialScenarioPropagation";
import { getActiveScenario, subscribeScenarioUniverse, type TerminalScenario } from "@/lib/terminalScenarioUniverse";
import {
  listCustomFinancialMetrics,
  listManualFinanceObservations,
  upsertCustomFinancialMetric,
  upsertManualFinanceObservation,
  evaluateCustomFinancialMetric,
  type CustomFinancialMetric,
} from "@/lib/manualFinanceData";

interface Props { symbol?: string }

const UNIT_OPTIONS: FinancialMetricUnit[] = ["currency", "price", "currency-per-share", "percent", "ratio", "multiple", "days", "turnover", "count", "bps", "yield", "volatility"];

function statusClass(status?: string) {
  if (status === "manual") return "text-[hsl(38,95%,55%)] border-[hsl(38,95%,50%)]/35";
  if (status === "filed" || status === "live") return "text-[hsl(142,71%,55%)] border-[hsl(142,71%,45%)]/30";
  if (status === "derived") return "text-[hsl(186,80%,60%)] border-[hsl(186,80%,45%)]/30";
  if (status === "estimate") return "text-[hsl(265,80%,70%)] border-[hsl(265,80%,55%)]/30";
  return "text-muted-foreground border-border";
}

function categoryLabel(metric: FinancialMetricDefinition) { return metric.category.replace(/-/g, " ").toUpperCase(); }

export default function UniversalFinanceDataPanel({ symbol: initialSymbol }: Props) {
  const [symbol, setSymbol] = useState((initialSymbol || "AAPL").toUpperCase());
  const [query, setQuery] = useState("EV/EBITDA");
  const [selectedId, setSelectedId] = useState("evEbitda");
  const [manualVersion, setManualVersion] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [manualPeriod, setManualPeriod] = useState("CURRENT");
  const [manualAsOf, setManualAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualSource, setManualSource] = useState("");
  const [manualSourceUrl, setManualSourceUrl] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualSync, setManualSync] = useState<"idle" | "synced" | "local">("idle");
  const [customOpen, setCustomOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customFormula, setCustomFormula] = useState("");
  const [customUnit, setCustomUnit] = useState<FinancialMetricUnit>("multiple");
  const [activeScenario, setActiveScenario] = useState<TerminalScenario | null>(() => getActiveScenario());

  const company = useLseCompany(symbol);
  const income = useLseFinancials(symbol, "income", "FY");
  const balance = useLseFinancials(symbol, "balance", "FY");
  const cashflow = useLseFinancials(symbol, "cashflow", "FY");
  const dividends = useLseDividends(symbol);
  useEffect(() => subscribeScenarioUniverse((_scenarios, current) => setActiveScenario(current)), []);

  const providerObservations = useMemo(() => buildCompanyFinancialObservations({
    profile: company.data?.profile,
    fundamentals: company.data?.fundamentals,
    incomeReports: income.data,
    balanceReports: balance.data,
    cashflowReports: cashflow.data,
    dividends: dividends.data,
  }), [company.data, income.data, balance.data, cashflow.data, dividends.data]);
  const remoteManual = useQuery<FinancialMetricObservation[]>({
    queryKey: ["/api/finance/metric-overrides", symbol],
    queryFn: async () => (await apiRequest("GET", `/api/finance/metric-overrides?symbol=${encodeURIComponent(symbol)}`)).json() as Promise<FinancialMetricObservation[]>,
    staleTime: 30_000,
    retry: false,
  });
  const localManual = useMemo(() => listManualFinanceObservations(symbol), [symbol, manualVersion]);
  const manualObservations = useMemo(() => remoteManual.data ?? (remoteManual.isError ? localManual : []), [localManual, remoteManual.data, remoteManual.isError]);
  const observations: FinancialMetricObservation[] = useMemo(() => [...manualObservations, ...providerObservations], [manualObservations, providerObservations]);
  const selected = useMemo(() => FINANCIAL_METRICS.find(metric => metric.id === selectedId) ?? FINANCIAL_METRICS.find(metric => metric.id === "evEbitda")!, [selectedId]);
  const analyticalContext = useMemo(() => buildFinancialAnalyticalContext({
    symbol,
    observations,
    metricIds: [selected.id, "enterpriseValue", "evEbitda"],
    sector: [company.data?.profile?.sector, company.data?.profile?.industry].filter(Boolean).join(" "),
  }), [company.data, observations, selected.id, symbol]);
  const resolved = useMemo(() => contextMetric(analyticalContext, selected.id), [analyticalContext, selected.id]);
  const plan = useMemo(() => buildFinancialMetricResolutionPlan(selected.id, observations), [selected, observations]);
  const searchResults = useMemo(() => searchFinancialMetrics(query, 120), [query]);
  const sectorPack = useMemo(() => inferFinanceSectorPack(company.data?.profile?.sector, company.data?.profile?.industry), [company.data]);
  const sectorMetrics = useMemo(() => sectorPack ? metricsForSectorPack(sectorPack) : [], [sectorPack]);
  const remoteCustom = useQuery<CustomFinancialMetric[]>({
    queryKey: ["/api/finance/custom-metrics"],
    queryFn: async () => (await apiRequest("GET", "/api/finance/custom-metrics")).json() as Promise<CustomFinancialMetric[]>,
    staleTime: 30_000,
    retry: false,
  });
  const localCustom = useMemo(() => listCustomFinancialMetrics(), [manualVersion]);
  const customMetrics = useMemo(() => remoteCustom.data ?? (remoteCustom.isError ? localCustom : []), [localCustom, remoteCustom.data, remoteCustom.isError]);
  const currency = company.data?.profile?.currency === "INR" ? "₹" : company.data?.profile?.currency === "GBP" ? "£" : company.data?.profile?.currency === "EUR" ? "€" : "$";

  const availableCount = useMemo(() => FINANCIAL_METRICS.reduce((count, metric) => count + (resolveFinancialMetric(metric.id, observations)?.value !== null ? 1 : 0), 0), [observations]);
  const trustReport = analyticalContext.trust;
  const selectedTrust = useMemo(() => resolved ? assessFinancialObservationTrust(resolved, selected) : null, [resolved, selected]);
  const trustLabel = financialTrustLabel(trustReport);
  const scenarioInput = useMemo(() => activeScenario ? {
    id: activeScenario.id,
    name: activeScenario.name,
    assumptions: activeScenario.assumptions.map(assumption => ({
      key: assumption.key,
      label: assumption.label,
      value: typeof assumption.value === "number" ? assumption.value : null,
      unit: assumption.unit,
      source: assumption.source,
    })),
  } : null, [activeScenario]);
  const scenarioImpacts = useMemo(() => scenarioInput ? propagateFinancialScenario({ baseObservations: observations, scenario: scenarioInput, metricIds: [selected.id, "enterpriseValue", "evEbitda"] }) : [], [observations, scenarioInput, selected.id]);
  const selectedScenarioImpact = scenarioImpacts.find(impact => impact.metricId === selected.id);

  const saveManual = async () => {
    const value = Number(manualValue);
    if (!Number.isFinite(value)) return;
    const payload = { symbol, metricId: selected.id, value, period: manualPeriod, asOf: manualAsOf, source: manualSource || "User manual input", sourceUrl: manualSourceUrl || undefined, note: manualNote || undefined, currency: company.data?.profile?.currency ?? undefined, status: "manual" as const };
    upsertManualFinanceObservation(payload);
    try {
      await apiRequest("POST", "/api/finance/metric-overrides", payload);
      await remoteManual.refetch();
      setManualSync("synced");
    } catch {
      setManualSync("local");
    }
    setManualVersion(version => version + 1);
    setManualOpen(false);
    setManualValue(""); setManualSource(""); setManualSourceUrl(""); setManualNote(""); setManualAsOf(new Date().toISOString().slice(0, 10));
  };

  const saveCustom = async () => {
    if (!customLabel.trim() || !customFormula.trim()) return;
    const payload = { label: customLabel, unit: customUnit, formula: customFormula };
    upsertCustomFinancialMetric(payload);
    try {
      await apiRequest("POST", "/api/finance/custom-metrics", payload);
      await remoteCustom.refetch();
      setManualSync("synced");
    } catch {
      setManualSync("local");
    }
    setManualVersion(version => version + 1);
    setCustomOpen(false); setCustomLabel(""); setCustomFormula("");
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <Database className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">UNIVERSAL FINANCIAL DATA OS</span>
        <span className="font-terminal text-[7px] tracking-[0.18em] text-[hsl(38,95%,55%)] border border-[hsl(38,95%,50%)]/25 px-1.5 py-0.5">V6</span>
        <input value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())} className="ml-3 w-24 bg-[#050505] border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/50" />
        <span className="ml-auto font-terminal text-[7px] text-muted-foreground">{availableCount}/{FINANCIAL_METRICS.length} METRICS RESOLVABLE · {manualObservations.length} MANUAL</span>
      </div>

      <div className="grid grid-cols-[290px_minmax(0,1fr)] flex-1 min-h-0">
        <aside className="border-r border-border bg-[#070707] flex flex-col min-h-0">
          <div className="p-3 border-b border-border">
            <div className="flex items-center gap-2 border border-border bg-[#050505] px-2 py-1.5">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search P/E, EV/EBITDA, ROIC, NIM..." className="w-full bg-transparent font-terminal text-[9px] text-foreground placeholder:text-muted-foreground/50 outline-none" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {searchResults.map(metric => {
              const item = resolveFinancialMetric(metric.id, observations);
              return (
                <button key={metric.id} onClick={() => setSelectedId(metric.id)} className={`w-full text-left px-3 py-2 border-b border-border/35 hover:bg-white/[0.025] ${selected.id === metric.id ? "bg-[hsl(38,95%,50%)]/[0.06] border-l-2 border-l-[hsl(38,95%,50%)]" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-terminal text-[9px] text-foreground truncate">{metric.label}</span>
                    <span className={`ml-auto font-terminal text-[6.5px] border px-1 py-0.5 ${statusClass(item?.status)}`}>{(item?.status ?? "missing").toUpperCase()}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-terminal text-[6.5px] text-muted-foreground tracking-wider">{categoryLabel(metric)}</span>
                    <span className="font-terminal text-[8px] tabular-nums text-muted-foreground">{formatFinancialMetricValue(item?.value ?? null, metric.unit, currency)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0 overflow-y-auto scrollbar-thin p-4 space-y-4">
          <section className="grid grid-cols-[minmax(0,1fr)_220px] gap-4">
            <div className="border border-border bg-[#090909] p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-terminal text-[8px] tracking-[0.2em] text-muted-foreground">{categoryLabel(selected)} · {selected.id}</div>
                  <h2 className="font-terminal text-[20px] font-bold text-foreground mt-1">{selected.label}</h2>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={`font-terminal text-[8px] border px-2 py-1 ${statusClass(resolved?.status)}`}>{(resolved?.status ?? "missing").toUpperCase()}</span>
                    <span className="font-terminal text-[18px] font-bold text-[hsl(38,95%,58%)] tabular-nums">{formatFinancialMetricValue(resolved?.value ?? null, selected.unit, currency)}</span>
                    {resolved?.period && <span className="font-terminal text-[7px] text-muted-foreground">{resolved.period}</span>}
                  </div>
                  {selected.description && <p className="font-terminal text-[8px] leading-relaxed text-muted-foreground mt-3">{selected.description}</p>}
                </div>
                <button onClick={() => setManualOpen(true)} className="flex items-center gap-1.5 border border-[hsl(38,95%,50%)]/35 bg-[hsl(38,95%,50%)]/[0.06] px-2.5 py-1.5 font-terminal text-[8px] text-[hsl(38,95%,58%)] hover:bg-[hsl(38,95%,50%)]/[0.11]"><Plus className="w-3 h-3" /> ENTER MANUALLY</button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="border border-border bg-[#060606] p-3">
                  <div className="font-terminal text-[7px] tracking-widest text-muted-foreground mb-2">FORMULA / DEFINITION</div>
                  <div className="font-terminal text-[9px] text-foreground leading-relaxed">{selected.formula ?? "DIRECT / PROVIDER / MANUAL METRIC"}</div>
                  {!!selected.aliases?.length && <div className="font-terminal text-[7px] text-muted-foreground mt-2">ALIASES · {selected.aliases.join(" · ")}</div>}
                </div>
                <div className="border border-border bg-[#060606] p-3">
                  <div className="font-terminal text-[7px] tracking-widest text-muted-foreground mb-2">SOURCE / LINEAGE</div>
                  <div className="font-terminal text-[9px] text-foreground">{resolved?.source ?? "No source resolved"}</div>
                  <div className="font-terminal text-[7px] text-muted-foreground mt-1">{resolved?.asOf ? `AS OF ${resolved.asOf}` : "NO AS-OF DATE"}</div>
                  {resolved?.note && <div className="font-terminal text-[7px] text-[hsl(38,95%,58%)] mt-2">{resolved.note}</div>}
                  {selectedTrust && <div className={`font-terminal text-[7px] mt-2 ${selectedTrust.complete ? "text-up" : "text-[hsl(38,95%,58%)]"}`}>{selectedTrust.complete ? "PROVENANCE COMPLETE" : `PROVENANCE GAPS · ${selectedTrust.issues.map(issue => issue.kind.replace(/-/g, " ")).join(" · ")}`}</div>}
                </div>
              </div>
            </div>

            <div className="border border-border bg-[#090909] p-3">
              <div className="font-terminal text-[7px] tracking-widest text-muted-foreground mb-2">DATA COMPLETENESS</div>
              <div className="font-terminal text-[26px] font-bold text-foreground">{Math.round((availableCount / FINANCIAL_METRICS.length) * 100)}%</div>
              <div className="font-terminal text-[7px] text-muted-foreground mt-1">GLOBAL V6 REGISTRY</div>
              {sectorPack && (
                <div className="mt-4 border-t border-border pt-3">
                  <div className="flex items-center gap-1.5 font-terminal text-[7px] tracking-widest text-[hsl(186,80%,60%)]"><Layers3 className="w-3 h-3" /> AUTO SECTOR PACK</div>
                  <div className="font-terminal text-[10px] font-bold text-foreground mt-1">{sectorPack.label}</div>
                  <div className="font-terminal text-[7px] text-muted-foreground mt-1">{sectorMetrics.length} priority KPIs</div>
                </div>
              )}
              <div className="mt-4 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">DATA TRUST</div>
                  <span className={`font-terminal text-[7px] border px-1.5 py-0.5 ${trustLabel === "TRUSTED" ? "text-up border-emerald-500/30" : trustLabel === "BLOCKED" ? "text-down border-red-500/30" : "text-[hsl(38,95%,55%)] border-[hsl(38,95%,50%)]/30"}`}>{trustLabel}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div><div className="font-terminal text-[7px] text-muted-foreground">PROVENANCE</div><div className="font-terminal text-[10px] text-foreground">{trustReport.provenanceComplete}/{trustReport.observations}</div></div>
                  <div><div className="font-terminal text-[7px] text-muted-foreground">CONFLICTS</div><div className={`font-terminal text-[10px] ${trustReport.conflictCount ? "text-down" : "text-up"}`}>{trustReport.conflictCount}</div></div>
                </div>
                <div className="font-terminal text-[7px] text-muted-foreground mt-2">{trustReport.missingCount} metrics require resolution · score {trustReport.score}/100</div>
                <div className="font-terminal text-[7px] text-muted-foreground mt-2">P0 WORKFLOW COVERAGE · <span className="text-foreground">{trustReport.weightedCoveragePct}%</span></div>
                <div className="mt-2 space-y-1">
                  {trustReport.coverageBands.map(band => <div key={band.id} className="flex items-center gap-2 font-terminal text-[6.5px] text-muted-foreground"><span className="w-20 truncate">{band.label}</span><span className="h-1 flex-1 bg-border"><span className="block h-full bg-[hsl(186,80%,60%)]" style={{ width: `${band.coveragePct}%` }} /></span><span className="w-8 text-right text-foreground">{band.coveragePct}%</span></div>)}
                </div>
              </div>
              {activeScenario && selectedScenarioImpact && (
                <div className="mt-4 border-t border-border pt-3">
                  <div className="font-terminal text-[7px] tracking-widest text-[hsl(265,80%,70%)]">SCENARIO BRIDGE · {activeScenario.name}</div>
                  <div className="grid grid-cols-2 gap-2 mt-2 font-terminal text-[8px]">
                    <div><div className="text-[7px] text-muted-foreground">BASE</div><div className="text-foreground">{formatFinancialMetricValue(selectedScenarioImpact.base?.value ?? null, selected.unit, currency)}</div></div>
                    <div><div className="text-[7px] text-muted-foreground">SCENARIO</div><div className="text-[hsl(265,80%,75%)]">{formatFinancialMetricValue(selectedScenarioImpact.scenario?.value ?? null, selected.unit, currency)}</div></div>
                  </div>
                  <div className="font-terminal text-[7px] text-muted-foreground mt-2">{selectedScenarioImpact.percentDelta === null ? "No comparable base value" : `${selectedScenarioImpact.percentDelta >= 0 ? "+" : ""}${(selectedScenarioImpact.percentDelta * 100).toFixed(1)}% vs base · explicit scenario inputs only`}</div>
                </div>
              )}
            </div>
          </section>

          {manualOpen && (
            <section className="border border-[hsl(38,95%,50%)]/35 bg-[hsl(38,95%,50%)]/[0.035] p-4">
              <div className="flex items-center justify-between"><div className="font-terminal text-[9px] font-bold text-[hsl(38,95%,58%)]">MANUAL VALUE · {selected.label}</div><button onClick={() => setManualOpen(false)}><X className="w-4 h-4 text-muted-foreground" /></button></div>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mt-3">
                <input value={manualValue} onChange={e => setManualValue(e.target.value)} placeholder="VALUE" inputMode="decimal" className="bg-[#050505] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground outline-none focus:border-[hsl(38,95%,50%)]/50" />
                <input value={manualPeriod} onChange={e => setManualPeriod(e.target.value)} placeholder="PERIOD" className="bg-[#050505] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground outline-none" />
                <input type="date" value={manualAsOf} onChange={e => setManualAsOf(e.target.value)} aria-label="As-of date" className="bg-[#050505] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground outline-none" />
                <input value={manualSource} onChange={e => setManualSource(e.target.value)} placeholder="SOURCE / ANALYST" className="bg-[#050505] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground outline-none" />
                <input value={manualSourceUrl} onChange={e => setManualSourceUrl(e.target.value)} placeholder="SOURCE URL (OPTIONAL)" className="bg-[#050505] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground outline-none" />
              </div>
              <textarea value={manualNote} onChange={e => setManualNote(e.target.value)} placeholder="NOTE / ADJUSTMENT RATIONALE" className="mt-2 w-full min-h-16 bg-[#050505] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground outline-none resize-y" />
              {manualSync !== "idle" && <div className={`mt-2 font-terminal text-[7px] ${manualSync === "synced" ? "text-up" : "text-[hsl(38,95%,58%)]"}`}>{manualSync === "synced" ? "DURABLE OVERRIDE SYNCED TO TENANT STORE" : "SERVER SYNC UNAVAILABLE · LOCAL OVERRIDE RETAINED FOR THIS SESSION"}</div>}
              <div className="flex justify-end mt-2"><button onClick={saveManual} className="bg-[hsl(38,95%,52%)] text-black px-3 py-1.5 font-terminal text-[8px] font-bold">SAVE MANUAL OVERRIDE</button></div>
            </section>
          )}

          {resolved?.trace.length ? (
            <section className="border border-border bg-[#090909]">
              <div className="px-3 py-2 border-b border-border font-terminal text-[7px] tracking-widest text-muted-foreground">CALCULATION LINEAGE</div>
              <div className="divide-y divide-border/35">
                {resolved.trace.map(input => {
                  const definition = FINANCIAL_METRICS.find(metric => metric.id === input.metricId);
                  return <button key={input.metricId} onClick={() => definition && setSelectedId(definition.id)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/[0.02] text-left"><Sigma className="w-3 h-3 text-muted-foreground" /><span className="font-terminal text-[8px] text-foreground flex-1">{definition?.label ?? input.metricId}</span><span className={`font-terminal text-[6.5px] border px-1 py-0.5 ${statusClass(input.status)}`}>{input.status.toUpperCase()}</span><span className="font-terminal text-[8px] tabular-nums text-muted-foreground">{formatFinancialMetricValue(input.value, definition?.unit ?? "currency", currency)}</span></button>;
                })}
              </div>
            </section>
          ) : null}

          {resolved?.status === "missing" && plan && (
            <section className="border border-[hsl(20,90%,50%)]/35 bg-[hsl(20,90%,50%)]/[0.035] p-4">
              <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-[hsl(20,90%,60%)]" /><span className="font-terminal text-[9px] font-bold text-foreground">MISSING DATA RESOLVER</span></div>
              <div className="font-terminal text-[8px] text-muted-foreground mt-2">LiOS will never hide an unexplained blank. Resolve {selected.label} by supplying the metric directly or the missing dependencies below.</div>
              <div className="grid md:grid-cols-2 gap-2 mt-3">
                {plan.actions.map((action, index) => <button key={`${action.kind}-${action.metricId ?? index}`} onClick={() => { if (action.kind === "enter-direct") setManualOpen(true); else if (action.kind === "enter-input" && action.metricId) { setSelectedId(action.metricId); setManualOpen(true); } }} className="text-left border border-border bg-[#070707] p-2 hover:border-[hsl(38,95%,50%)]/35"><div className="font-terminal text-[8px] font-bold text-foreground">{action.label}</div><div className="font-terminal text-[7px] text-muted-foreground mt-1">{action.description}</div></button>)}
              </div>
            </section>
          )}

          {sectorPack && (
            <section className="border border-border bg-[#090909]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border"><div><div className="font-terminal text-[7px] tracking-widest text-[hsl(186,80%,60%)]">SECTOR INTELLIGENCE PACK</div><div className="font-terminal text-[10px] font-bold text-foreground mt-0.5">{sectorPack.label}</div></div><CheckCircle2 className="w-4 h-4 text-[hsl(186,80%,60%)]" /></div>
              <div className="grid md:grid-cols-3 lg:grid-cols-4">
                {sectorMetrics.map(metric => { const item = resolveFinancialMetric(metric.id, observations); return <button key={metric.id} onClick={() => setSelectedId(metric.id)} className="text-left p-3 border-r border-b border-border/35 hover:bg-white/[0.02]"><div className="font-terminal text-[7px] text-muted-foreground">{metric.label}</div><div className="font-terminal text-[11px] font-bold text-foreground mt-1">{formatFinancialMetricValue(item?.value ?? null, metric.unit, currency)}</div><div className={`font-terminal text-[6px] mt-1 ${statusClass(item?.status)}`}>{(item?.status ?? "missing").toUpperCase()}</div></button>; })}
              </div>
            </section>
          )}
          {trustReport.conflictCount > 0 && (
            <section className="border border-red-500/35 bg-red-500/[0.035] p-3">
              <div className="flex items-center gap-2 font-terminal text-[7px] tracking-widest text-down"><AlertTriangle className="w-3.5 h-3.5" /> PROVIDER CONFLICTS · DOWNSTREAM USE BLOCKED</div>
              <div className="mt-2 space-y-1">
                {trustReport.reconciliations.filter(item => item.conflict).slice(0, 6).map(item => (
                  <button key={`${item.metricId}-${item.period}-${item.scenarioId ?? "BASE"}`} onClick={() => setSelectedId(item.metricId)} className="w-full flex items-center justify-between gap-3 text-left font-terminal text-[8px] text-muted-foreground hover:text-foreground">
                    <span>{item.metricId} · {item.period}</span><span className="text-down">{item.reason}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="border border-border bg-[#090909] p-4">
            <div className="flex items-center justify-between"><div><div className="font-terminal text-[7px] tracking-widest text-muted-foreground">USER-DEFINED FINANCE</div><div className="font-terminal text-[9px] text-foreground mt-1">Create metrics with deterministic formulas — no code and no eval.</div></div><button onClick={() => setCustomOpen(value => !value)} className="flex items-center gap-1.5 border border-border px-2 py-1.5 font-terminal text-[8px] text-foreground"><Plus className="w-3 h-3" /> CUSTOM METRIC</button></div>
            {customOpen && <div className="grid grid-cols-[1fr_1.5fr_150px_auto] gap-2 mt-3"><input value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="LABEL" className="bg-[#050505] border border-border px-2 py-1.5 font-terminal text-[8px] text-foreground outline-none" /><input value={customFormula} onChange={e => setCustomFormula(e.target.value)} placeholder="FORMULA e.g. (grossDebt - cash) / ebitda" className="bg-[#050505] border border-border px-2 py-1.5 font-terminal text-[8px] text-foreground outline-none" /><select value={customUnit} onChange={e => setCustomUnit(e.target.value as FinancialMetricUnit)} className="bg-[#050505] border border-border px-2 py-1.5 font-terminal text-[8px] text-foreground">{UNIT_OPTIONS.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select><button onClick={saveCustom} className="bg-[hsl(38,95%,52%)] text-black px-3 font-terminal text-[8px] font-bold">CREATE</button></div>}
            {customMetrics.length > 0 && <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">{customMetrics.map(metric => { const evaluation = evaluateCustomFinancialMetric(metric, observations); return <div key={metric.id} className="border border-border bg-[#060606] p-3"><div className="font-terminal text-[8px] font-bold text-foreground">{metric.label}</div><div className="font-terminal text-[13px] font-bold text-[hsl(38,95%,58%)] mt-1">{formatFinancialMetricValue(evaluation.value, metric.unit, currency)}</div><div className="font-terminal text-[7px] text-muted-foreground mt-1 break-all">{metric.formula}</div>{evaluation.missing.length > 0 && <div className="font-terminal text-[6.5px] text-[hsl(20,90%,60%)] mt-1">MISSING · {evaluation.missing.join(", ")}</div>}</div>; })}</div>}
          </section>

          <section className="border border-border bg-[#090909] p-3">
            <div className="flex items-center gap-2 font-terminal text-[7px] tracking-widest text-muted-foreground"><FileInput className="w-3.5 h-3.5" /> DATA POLICY</div>
            <div className="font-terminal text-[8px] text-muted-foreground leading-relaxed mt-2">PROVIDER → FILED → DERIVED → MANUAL are never silently conflated. Manual values remain explicitly tagged, formula lineage is inspectable, provider conflicts stay visible, and missing values expose a resolution path instead of becoming fake zeros.</div>
          </section>
        </main>
      </div>
    </div>
  );
}
