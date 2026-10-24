import { useTerminalArtifactState, useTerminalArtifactSymbol } from "@/lib/terminalArtifactState";
import { useState, useMemo, useEffect, Fragment } from "react";
import { FileSpreadsheet, X, Upload } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLseStatus, useLseFinancials } from "@/lib/useLse";
import { getCurrencySymbol } from "@/lib/finance";
import { ExportButton } from "@/components/panels/ExportButton";
import { exportWorkbook } from "@/lib/exportXlsx";
import { EditableValue } from "@/components/panels/EditableValue";
import { CustomLineItemBuilder, type RefOption } from "@/components/panels/CustomLineItemBuilder";
import { useCustomLineItems, evaluateCustomItem, customRef, builtinRef, type CustomItem } from "@/lib/customLineItems";
import { ImportStatementModal } from "@/components/panels/ImportStatementModal";
import DataStatusBadge from "@/components/data/DataStatusBadge";
import { BALANCE_SECTIONS, INCOME_SECTIONS, CASHFLOW_SECTIONS } from "@shared/financialFields";
import { buildFinancialAnalysis, mergeFinancialStatementReports, type FinancialMetric } from "@shared/financialAnalysis";
import { buildCompanyFinancialObservations } from "@/lib/financeObservations";
import type { FinancialMetricObservation } from "@shared/financialMetricRegistry";
import { resolveFinancialStatementReports, statementReportData } from "@shared/financialStatementResolver";
interface Props { symbol?: string }

type Statement = "balance" | "income" | "cashflow";
type ViewMode = "values" | "commonsize" | "growth" | "analysis";

// Section/line-item definitions now live in shared/financialFields.ts (the
// Canonical Financial Data Model) so the UI, the PDF import extractor, and
// every statement provider stay in sync on field keys and display labels
// instead of each keeping its own copy.

function fB(n: number | undefined, curr: string): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const neg = n < 0;
  const abs = Math.abs(n);
  let formatted: string;
  if (abs >= 1e12) formatted = `${curr}${(abs / 1e12).toFixed(2)}T`;
  else if (abs >= 1e9) formatted = `${curr}${(abs / 1e9).toFixed(2)}B`;
  else if (abs >= 1e6) formatted = `${curr}${(abs / 1e6).toFixed(1)}M`;
  else if (abs >= 1000) formatted = `${curr}${(abs / 1000).toFixed(1)}K`;
  else formatted = `${curr}${abs.toFixed(2)}`;
  return neg ? `(${formatted})` : formatted;
}

const PER_SHARE_KEYS = new Set(["eps", "epsDiluted"]);

function formatMetric(metric: FinancialMetric, curr: string): string {
  if (metric.value === null) return "—";
  if (metric.unit === "percent") return `${(metric.value * 100).toFixed(1)}%`;
  if (metric.unit === "ratio") return `${metric.value.toFixed(2)}x`;
  if (metric.unit === "days") return `${metric.value.toFixed(0)}d`;
  if (metric.unit === "turnover") return `${metric.value.toFixed(2)}x`;
  return fB(metric.value, curr);
}

export default function FinancialStatementsPanel({ symbol: initialSymbol }: Props) {
  const { data: status } = useLseStatus();
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useTerminalArtifactSymbol(initialSymbol ?? "AAPL");
  const [symbolDraft, setSymbolDraft] = useTerminalArtifactState(`FinancialStatementsPanel.symbolDraft.${symbol}`, symbol);
  const commitSymbol = () => {
    const next = symbolDraft.trim().toUpperCase();
    if (/^[A-Z^][A-Z0-9.^=_-]{0,24}$/.test(next) && next !== symbol) setSymbol(next);
  };
  const [statement, setStatement] = useTerminalArtifactState<Statement>("FinancialStatementsPanel.statement", "balance");
  const [viewMode, setViewMode] = useTerminalArtifactState<ViewMode>("FinancialStatementsPanel.viewMode", "values");
  const [period, setPeriod] = useTerminalArtifactState<"FY" | "Q1" | "Q2" | "Q3" | "Q4">("FinancialStatementsPanel.period", "FY");
  const [depth, setDepth] = useTerminalArtifactState<number>("FinancialStatementsPanel.depth", 5);
  const [showImportModal, setShowImportModal] = useState(false);
  const configured = status?.configured ?? false;
  const curr = getCurrencySymbol(symbol);

  const { data: balanceReports, isLoading: balanceLoading } = useLseFinancials(symbol, "balance", period);
  const { data: incomeReports, isLoading: incomeLoading } = useLseFinancials(symbol, "income", period);
  const { data: cashflowReports, isLoading: cashflowLoading } = useLseFinancials(symbol, "cashflow", period);
  const { data: financeOverrides = [] } = useQuery<FinancialMetricObservation[]>({
    queryKey: ["/api/finance/metric-overrides", symbol],
    queryFn: async () => (await apiRequest("GET", `/api/finance/metric-overrides?symbol=${encodeURIComponent(symbol)}`)).json(),
    enabled: Boolean(symbol),
    retry: false,
    staleTime: 30_000,
  });

  const providerObservations = useMemo(
    () => buildCompanyFinancialObservations({ incomeReports, balanceReports, cashflowReports }),
    [incomeReports, balanceReports, cashflowReports],
  );
  const normalizedObservations = useMemo(
    () => [...providerObservations, ...financeOverrides],
    [providerObservations, financeOverrides],
  );
  const normalizedBalanceReports = useMemo(
    () => resolveFinancialStatementReports("balance", balanceReports, normalizedObservations, undefined, period),
    [balanceReports, normalizedObservations, period],
  );
  const normalizedIncomeReports = useMemo(
    () => resolveFinancialStatementReports("income", incomeReports, normalizedObservations, undefined, period),
    [incomeReports, normalizedObservations, period],
  );
  const normalizedCashflowReports = useMemo(
    () => resolveFinancialStatementReports("cashflow", cashflowReports, normalizedObservations, undefined, period),
    [cashflowReports, normalizedObservations, period],
  );

  const reports = statement === "balance" ? normalizedBalanceReports : statement === "income" ? normalizedIncomeReports : normalizedCashflowReports;
  const isLoading = statement === "balance" ? balanceLoading : statement === "income" ? incomeLoading : cashflowLoading;
  const activeLoading = viewMode === "analysis" ? incomeLoading || balanceLoading || cashflowLoading : isLoading;
  const sections = statement === "balance" ? BALANCE_SECTIONS : statement === "income" ? INCOME_SECTIONS : CASHFLOW_SECTIONS;
  const totalKey = statement === "balance" ? "totalAssets" : statement === "income" ? "revenue" : "netCashProvidedByOperatingActivities";

  // Reports come back most-recent-first; keep that order for display (left
  // column = latest period, matching how a Bloomberg-style FA screen reads).
  // Depth is user-selected (5/10/20/all) rather than a fixed 5 -- EDGAR
  // returns up to 10 years of FY data and LSE's depth is effectively
  // unbounded, so a hardcoded 5 was silently discarding real data the
  // backend already had.
  const years = useMemo(() => {
    const list = depth >= 999 ? (reports ?? []) : (reports ?? []).slice(0, depth);
    return list.map((r) => ({
      fiscalYear: r.fiscal_year,
      period: r.period,
      parsed: statementReportData(r),
    }));
  }, [reports, depth]);

  // Every visible row is resolved through the DATA-01 registry. This exposes
  // source precedence and missing/conflicting fields instead of silently
  // rendering whichever raw payload happened to arrive last.
  const dataSource = reports?.[0]?.normalized.fieldSources[Object.keys(reports[0]?.normalized.fieldSources ?? {})[0]]?.source
    ?? reports?.[0]?.data_source;
  const dataStatus = reports?.[0]?.status;
  const joinConflicts = (reports ?? []).filter((report) => report.joinConflict);
  const normalizedFieldCounts = useMemo(() => {
    const fields = reports.flatMap(report => Object.values(report.normalized.fieldSources));
    return {
      imported: fields.filter(field => field.status === "imported" || field.status === "manual").length,
      conflicts: fields.filter(field => field.status === "conflict").length,
      missing: reports.reduce((total, report) => total + report.normalized.missingFields.length, 0),
    };
  }, [reports]);

  const analysisPeriods = useMemo(
    () => buildFinancialAnalysis(mergeFinancialStatementReports(
      { income: normalizedIncomeReports, balance: normalizedBalanceReports, cashflow: normalizedCashflowReports },
      depth >= 999 ? undefined : depth,
    )),
    [normalizedIncomeReports, normalizedBalanceReports, normalizedCashflowReports, depth],
  );


  // User-extensible line items -- every fixed schema above misses something
  // for some company (a bank has no Inventory, a REIT reports FFO instead of
  // EBITDA). Kept separate per statement since a balance-sheet particular
  // doesn't make sense on the income statement and vice versa; kept for the
  // whole session regardless of which ticker is being viewed, since a
  // formula like "Adjusted EBITDA = EBITDA - Stock Comp" is often reusable
  // across companies, not tied to one.
  const balanceCustom = useCustomLineItems("FinancialStatementsPanel.balanceCustom");
  const incomeCustom = useCustomLineItems("FinancialStatementsPanel.incomeCustom");
  const cashflowCustom = useCustomLineItems("FinancialStatementsPanel.cashflowCustom");
  const customState = statement === "balance" ? balanceCustom : statement === "income" ? incomeCustom : cashflowCustom;
  const customItems = customState.items;

  const getBuiltinValue = (key: string, yearIdx: number): number | null => {
    const raw = years[yearIdx]?.parsed[key];
    return raw === undefined || raw === null ? null : raw;
  };

  const availableRefs: RefOption[] = useMemo(() => {
    const builtins = sections.flatMap(sec => sec.items.map(item => ({ ref: builtinRef(item.key), label: item.label })));
    const customs = customItems.map(it => ({ ref: customRef(it.id), label: it.label }));
    return [...builtins, ...customs];
  }, [sections, customItems]);

  function customCellValue(item: CustomItem, yearIdx: number): string {
    const raw = evaluateCustomItem(item, yearIdx, getBuiltinValue, customItems);
    if (raw === null || raw === undefined || Number.isNaN(raw)) return "—";
    if (viewMode === "values") return fB(raw, curr);
    if (viewMode === "commonsize") {
      const base = years[yearIdx]?.parsed[totalKey];
      if (!base) return "—";
      return `${((raw / base) * 100).toFixed(1)}%`;
    }
    const prior = evaluateCustomItem(item, yearIdx + 1, getBuiltinValue, customItems);
    if (prior === null || prior === undefined || prior === 0) return "—";
    const pct = ((raw - prior) / Math.abs(prior)) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  }

  function cellValue(key: string, yearIdx: number): string {
    const year = years[yearIdx];
    if (!year) return "—";
    const raw = year.parsed[key];
    if (raw === undefined || raw === null) return "—";

    if (viewMode === "values") {
      return PER_SHARE_KEYS.has(key) ? `${curr}${raw.toFixed(2)}` : fB(raw, curr);
    }
    if (viewMode === "commonsize") {
      const base = year.parsed[totalKey];
      if (!base) return "—";
      return `${((raw / base) * 100).toFixed(1)}%`;
    }
    // growth: vs the NEXT column (which is the prior, older year since we're most-recent-first)
    const prior = years[yearIdx + 1]?.parsed[key];
    if (prior === undefined || prior === null || prior === 0) return "—";
    const pct = ((raw - prior) / Math.abs(prior)) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  }

  const periodLabel = (y: { fiscalYear: string; period: string }) =>
    y.period === "FY" ? `FY${y.fiscalYear}` : `${y.period} FY${y.fiscalYear}`;

  const handleExport = () => {
    const header = ["Line Item", ...years.map(periodLabel)];
    const dataRows: (string | number)[][] = sections.flatMap(sec => [
      ...(sec.title ? [[sec.title]] : []),
      ...sec.items.map(item => [item.label, ...years.map(y => y.parsed[item.key] ?? "")]),
    ]);
    const customRows: (string | number)[][] = customItems.length
      ? [
          ["CUSTOM PARTICULARS"],
          ...customItems.map(it => [
            it.label,
            ...years.map((_, yi) => evaluateCustomItem(it, yi, getBuiltinValue, customItems) ?? ""),
          ]),
        ]
      : [];
    exportWorkbook(`${symbol}_${statement}_statement.xlsx`, [
      { name: statement === "balance" ? "Balance Sheet" : statement === "income" ? "Income Statement" : "Cash Flow Statement", rows: [header, ...dataRows, ...customRows] },
    ]);
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <FileSpreadsheet className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">FINANCIAL STATEMENTS</span>
        <input
          aria-label="Financial statements stock symbol"
          value={symbolDraft}
          onChange={(e) => setSymbolDraft(e.target.value.toUpperCase())}
          onBlur={commitSymbol}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitSymbol(); } }}
          placeholder="TICKER..."
          className="ml-2 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground w-24 focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
        />
        {dataStatus ? (
          <DataStatusBadge status={dataStatus} compact showAsOf />
        ) : dataSource ? (
          <span className="font-terminal text-[7px] text-muted-foreground/70 tracking-wider border border-border/50 px-1.5 py-0.5" title="Which provider supplied the figures on screen">
            SOURCE: {dataSource.toUpperCase()}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setShowImportModal(true)}
            title="Import a PDF financial statement for this symbol"
            className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%] hover:bg-[hsl(38,95%,50%)/10%] transition-colors"
          >
            <Upload className="w-3 h-3" />
            IMPORT PDF
          </button>
          <ExportButton onExport={handleExport} />
        </div>
        <span className="font-terminal text-[8px] text-muted-foreground tracking-widest">FSTM</span>
      </div>

      {showImportModal && (
        <ImportStatementModal
          symbol={symbol}
          onClose={() => setShowImportModal(false)}
          onImported={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/lse/financials", symbol] });
            queryClient.invalidateQueries({ queryKey: ["/api/finance/metric-overrides", symbol] });
          }}
        />
      )}

      {joinConflicts.length > 0 && (
        <div className="shrink-0 border-b border-[hsl(20,90%,45%)]/40 bg-[hsl(20,90%,50%)]/5 px-4 py-2 font-terminal text-[8px] text-muted-foreground">
          PRIVATE/PUBLIC STATEMENT CONFLICT: {joinConflicts.length} {statement.toUpperCase()} ROW{joinConflicts.length === 1 ? "" : "S"} USE PRIVATE IMPORTS OVER PUBLIC DATA. FIRST CONFLICT: {joinConflicts[0].fiscal_year} / {joinConflicts[0].period} VS {joinConflicts[0].joinConflict?.publicProvider} ({joinConflicts[0].joinConflict?.differingFields.slice(0, 4).join(", ")}).
        </div>
      )}
      {reports.length > 0 && (normalizedFieldCounts.imported > 0 || normalizedFieldCounts.conflicts > 0 || normalizedFieldCounts.missing > 0) && (
        <div role="status" aria-live="polite" className="shrink-0 border-b border-border/60 bg-[#080808] px-4 py-2 font-terminal text-[8px] text-muted-foreground">
          NORMALIZED INPUT: {normalizedFieldCounts.imported} IMPORTED / {normalizedFieldCounts.conflicts} CONFLICT / {normalizedFieldCounts.missing} MISSING FIELDS. INVALID OR UNMAPPED VALUES REMAIN ABSENT; NO FALLBACK VALUES CREATED.
        </div>
      )}

      <div className="flex border-b border-border bg-[#060606] shrink-0">
        {([{ value: "balance" as Statement, label: "BALANCE SHEET" }, { value: "income" as Statement, label: "INCOME STATEMENT" }, { value: "cashflow" as Statement, label: "CASH FLOW STATEMENT" }]).map((s) => (
          <button
            key={s.value}
            onClick={() => setStatement(s.value)}
            className={`px-3 py-2 font-terminal text-[8px] tracking-wider border-r border-border/50 ${
              statement === s.value ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)] border-b-2 border-b-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 px-3">
          {([{ value: "values" as ViewMode, label: "VALUES" }, { value: "commonsize" as ViewMode, label: statement === "balance" ? "% OF ASSETS" : statement === "income" ? "% OF REVENUE" : "% OF OCF" }, { value: "growth" as ViewMode, label: "YoY GROWTH" }, { value: "analysis" as ViewMode, label: "RATIO ANALYSIS" }]).map((v) => (
            <button
              key={v.value}
              onClick={() => setViewMode(v.value)}
              className={`px-2 py-1 font-terminal text-[7.5px] tracking-wider border ${
                viewMode === v.value ? "border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)]" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border/50 bg-[#060606] shrink-0 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="font-terminal text-[7px] text-muted-foreground tracking-widest mr-1">PERIOD</span>
          {(["FY", "Q1", "Q2", "Q3", "Q4"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-1.5 py-0.5 font-terminal text-[7.5px] tracking-wider border ${
                period === p ? "border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)]" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="font-terminal text-[7px] text-muted-foreground tracking-widest mr-1">DEPTH</span>
          {([{ n: 5, label: "5" }, { n: 10, label: "10" }, { n: 20, label: "20" }, { n: 999, label: "ALL" }]).map((d) => (
            <button
              key={d.n}
              onClick={() => setDepth(d.n)}
              className={`px-1.5 py-0.5 font-terminal text-[7.5px] tracking-wider border ${
                depth === d.n ? "border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)]" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <span className="font-terminal text-[7px] text-muted-foreground/60">
          {years.length} period{years.length === 1 ? "" : "s"} returned
        </span>
      </div>

      {!configured && !years.length && !analysisPeriods.length ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md text-center font-terminal text-[10px] text-muted-foreground border border-border px-4 py-3">
            Provider observations and imported statements are unavailable for this selection. Connect an authorized source or explicitly import and review a statement; missing figures are not filled.
          </div>
        </div>
      ) : activeLoading ? (
        <div className="p-4 font-terminal text-[9px] text-muted-foreground">LOADING...</div>
      ) : viewMode === "analysis" && !analysisPeriods.length ? (
        <div className="p-4 font-terminal text-[9px] text-muted-foreground">NO CROSS-STATEMENT DATA AVAILABLE FOR {symbol}.</div>
      ) : viewMode !== "analysis" && !years.length ? (
        <div className="p-4 font-terminal text-[9px] text-muted-foreground">NO {statement === "balance" ? "BALANCE SHEET" : statement === "income" ? "INCOME STATEMENT" : "CASH FLOW STATEMENT"} DATA AVAILABLE FOR {symbol}.</div>
      ) : (
        <div className="flex-1 overflow-auto scrollbar-thin p-4 space-y-3">
          {viewMode === "analysis" ? (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-[#050505]">
                  <th className="px-2 py-1.5 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider min-w-[220px]">DERIVED METRIC</th>
                  {analysisPeriods.map((periodItem) => (
                    <th key={`${periodItem.fiscalYear}-${periodItem.period}`} className="px-2 py-1.5 text-right font-terminal text-[8px] text-foreground tracking-wider">
                      {periodItem.period === "FY" ? `FY${periodItem.fiscalYear}` : `${periodItem.period} FY${periodItem.fiscalYear}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysisPeriods[0]?.metrics.map((metric) => (
                  <tr key={metric.key} className="border-b border-border/20">
                    <td className="px-2 py-1.5 font-terminal text-[9px] text-muted-foreground" title={metric.trace.formula}>
                      <div className="text-foreground">{metric.label}</div>
                      <div className="text-[7px] text-muted-foreground/60">{metric.trace.formula}</div>
                    </td>
                    {analysisPeriods.map((periodItem) => {
                      const periodMetric = periodItem.metrics.find((item) => item.key === metric.key) ?? metric;
                      return (
                        <td key={`${periodItem.fiscalYear}-${periodMetric.key}`} className="px-2 py-1.5 text-right font-terminal text-[9px] tabular-nums text-muted-foreground">
                          {formatMetric(periodMetric, curr)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <CustomLineItemBuilder
                stateKey={`FinancialStatementsPanel.builder.${symbol}.${statement}.${period}`}
                availableRefs={availableRefs}
                periodLabels={years.map(periodLabel)}
                onAddManual={customState.addManual}
                onAddFormula={customState.addFormula}
              />
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border sticky top-0 bg-[#050505]">
                    <th className="px-2 py-1.5 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider min-w-[220px]">LINE ITEM</th>
                    {years.map((y, yi) => (
                      <th key={`${y.fiscalYear}-${y.period}-${yi}`} className="px-2 py-1.5 text-right font-terminal text-[8px] text-foreground tracking-wider">{periodLabel(y)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sections.map((section, si) => (
                    <Fragment key={si}>
                      {section.title && (
                        <tr key={`${si}-hdr`}>
                          <td colSpan={years.length + 1} className="px-2 pt-3 pb-1 font-terminal text-[7px] text-[hsl(38,95%,55%)] tracking-widest">{section.title}</td>
                        </tr>
                      )}
                      {section.items.map((item) => (
                        <tr key={item.key} className={`border-b border-border/20 ${item.bold ? "border-t border-border/50" : ""}`}>
                          <td className={`px-2 py-1.5 font-terminal text-[9px] ${item.bold ? "text-foreground font-bold" : "text-muted-foreground pl-4"}`}>{item.label}</td>
                          {years.map((y, yi) => (
                            <td key={`${y.fiscalYear}-${y.period}-${yi}`} className={`px-2 py-1.5 text-right font-terminal text-[9px] tabular-nums ${item.bold ? "text-foreground font-bold" : "text-muted-foreground"}`}>
                              {cellValue(item.key, yi)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  {customItems.length > 0 && (
                    <Fragment>
                      <tr>
                        <td colSpan={years.length + 1} className="px-2 pt-3 pb-1 font-terminal text-[7px] text-[hsl(38,95%,55%)] tracking-widest">CUSTOM PARTICULARS</td>
                      </tr>
                      {customItems.map(item => (
                        <tr key={item.id} className="border-b border-border/20 group">
                          <td className="px-2 py-1.5 font-terminal text-[9px] text-muted-foreground pl-4">
                            <span className="inline-flex items-center gap-1.5">
                              {item.label}
                              <span className="text-[7px] text-muted-foreground/50">{item.kind === "formula" ? "ƒ" : "✎"}</span>
                              <button onClick={() => customState.remove(item.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[hsl(0,80%,60%)] transition-opacity">
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          </td>
                          {years.map((y, yi) => (
                            <td key={`${y.fiscalYear}-${y.period}-${yi}`} className="px-2 py-1.5 text-right font-terminal text-[9px] tabular-nums text-muted-foreground">
                              {item.kind === "manual" && viewMode === "values" ? (
                                <EditableValue
                                  value={(item.values[yi] ?? 0) / 1e6}
                                  decimals={1}
                                  prefix={curr}
                                  suffix="M"
                                  onChange={v => customState.updateValue(item.id, yi, v * 1e6)}
                                />
                              ) : (
                                customCellValue(item, yi)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      <div className="px-4 py-1.5 border-t border-border bg-[#060606] shrink-0">
        <span className="font-terminal text-[7.5px] text-muted-foreground/70">
          Figures follow their recorded per-field source and status. Imported statements and manual corrections are not provider observations. VALUES shows retained figures; % view is common-size analysis; YoY GROWTH compares the prior fiscal year.
        </span>
      </div>
    </div>
  );
}
