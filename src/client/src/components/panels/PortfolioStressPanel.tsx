import { useTerminalArtifactContext } from "@/lib/terminalArtifactState";
import { useTerminalQuantRun } from "@/lib/useTerminalQuantRun";
import { TERMINAL_STRESS_SCENARIOS as SCENARIOS } from "@shared/terminalStressScenarios";
import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useQuotes } from "@/lib/useFinance";
import { getCurrencySymbol } from "@/lib/finance";
import { Flame, AlertTriangle } from "lucide-react";
import { BarChart, Bar, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { ViewMode } from "@/lib/terminalTypes";
import { assertSquareMatrix, assertWeights, withManualProvenance, type AdvancedRiskResponse } from "@/lib/advancedPortfolioRisk";
import { StructuredJsonEditor, applySchemaDefaults, type JsonFieldSchema } from "@/components/ui/StructuredJsonEditor";
import { AdvancedPortfolioRiskReceipt } from "@/lib/advancedPortfolioRiskReceipt";
interface Props { onSymbol: (s: string) => void; onNav: (v: ViewMode) => void; }
type ReverseStressResult = { minimumMahalanobisShock: Record<string, number>; portfolioReturnPct: number; mahalanobisDistance: number };
type CorrelationBreakdownResult = { baseVolatilityPct: number; stressedVolatilityPct: number; volatilityIncreasePct: number };

// This panel lives only in the internal LIMURIA INTELLIGENCE terminal (see
// Terminal.tsx's "portfoliostress" case) -- it is never rendered in the
// separate client-facing dashboard app. It therefore must read positions
// through the internal admin org/portfolio endpoints (requireRole
// internal_admin/internal_analyst/internal_compliance in adminRoutes.ts),
// the same ones AdminConsolePanel's portfolio tab uses to create and view
// client portfolios. It previously called useClientPortfolios(), which
// hits requireFullClient (client_user roles only) -- for every internal
// user that request 403s, and useClientPortfolios() silently swallows
// any non-ok response into an empty array, so the panel always rendered
// "NO CLIENT HOLDINGS AVAILABLE" regardless of what data actually existed.
interface AdminOrganization { id: number; name: string }
interface AdminPortfolio { id: number; organizationId: number; name: string }
interface AdminPosition { id: number; portfolioId: number; symbol: string; shares: number; avgCost: number }


const REVERSE_STRESS_SCHEMA: JsonFieldSchema[] = [
  { kind: "stringArray", key: "assets", label: "Assets", default: ["A", "B"] },
  { kind: "numberArray", key: "weights", label: "Weights", default: [0.5, 0.5] },
  { kind: "numberMatrix", key: "covMatrixPct2", label: "Covariance Matrix (pct^2)", default: [[4, 1], [1, 3]] },
  { kind: "number", key: "targetPortfolioLossPct", label: "Target Portfolio Loss %", min: 0, step: 0.1, default: 12 },
];

const CORRELATION_BREAKDOWN_SCHEMA: JsonFieldSchema[] = [
  { kind: "stringArray", key: "assets", label: "Assets", default: ["A", "B"] },
  { kind: "numberArray", key: "weights", label: "Weights", default: [0.5, 0.5] },
  { kind: "numberArray", key: "assetVolatilityPct", label: "Asset Volatility %", default: [18, 12] },
  { kind: "numberMatrix", key: "baseCorrelationMatrix", label: "Base Correlation Matrix", default: [[1, 0.3], [0.3, 1]] },
  { kind: "number", key: "stressedPairwiseCorrelation", label: "Stressed Pairwise Correlation", min: -0.99, max: 0.999, step: 0.01, default: 0.8 },
];

// Simplified sector → factor mapping
function classifyAsset(sym: string): keyof typeof SCENARIOS[0]["factors"] {
  if (["AAPL","MSFT","GOOGL","NVDA","META","AMZN","TSLA","ADBE","NFLX"].includes(sym)) return "tech";
  if (["JPM","BAC","GS","MS","WFC","C","BRK-B"].includes(sym)) return "financial";
  if (["VNQ","XLRE","O","SPG"].includes(sym)) return "real_estate";
  if (["TLT","BND","AGG","IEF"].includes(sym)) return "bonds";
  if (["GC=F","GLD","IAU"].includes(sym)) return "gold";
  if (["CL=F","XLE","CVX","XOM"].includes(sym)) return "oil";
  if (["EEM","FXI","VWO","^NSEI","INFY.NS"].includes(sym)) return "emerging";
  return "equity";
}

export default function PortfolioStressPanel({ onSymbol }: Props) {
  const terminal = useTerminalArtifactContext();
  const quant = useTerminalQuantRun();
  const nativeScope = `PortfolioStressPanel.${terminal?.symbol ?? "manual"}`;
  function runAdvancedPortfolioRisk<T extends Record<string, unknown>>(path: string, parameters: Record<string, unknown>): Promise<AdvancedRiskResponse<T>> {
    return quant.run<AdvancedRiskResponse<T>>(path, withManualProvenance(parameters), `${nativeScope}.${path}`);
  }
  const [reverseStressInput, setReverseStressInput] = useTerminalArtifactState<Record<string, unknown>>("PortfolioStressPanel.reverseStressInput", () => applySchemaDefaults(REVERSE_STRESS_SCHEMA, {}));
  const [correlationStressInput, setCorrelationStressInput] = useTerminalArtifactState<Record<string, unknown>>("PortfolioStressPanel.correlationStressInput", () => applySchemaDefaults(CORRELATION_BREAKDOWN_SCHEMA, {}));
  const reverseStressMutation = useMutation({
    mutationFn: async () => {
      const payload = reverseStressInput as { assets?: string[]; weights?: number[]; covMatrixPct2?: number[][]; targetPortfolioLossPct?: number };
      if (!payload.assets?.length || new Set(payload.assets).size !== payload.assets.length || !payload.weights || !payload.covMatrixPct2 || !Number.isFinite(payload.targetPortfolioLossPct) || payload.targetPortfolioLossPct! <= 0) throw new Error("Reverse stress requires unique assets, weights, a covariance matrix, and positive targetPortfolioLossPct.");
      assertWeights(payload.weights, payload.assets.length, "Weights");
      assertSquareMatrix(payload.covMatrixPct2, payload.assets.length, "covMatrixPct2", true);
      return runAdvancedPortfolioRisk<ReverseStressResult>("risk/reverse-stress", payload as Record<string, unknown>);
    },
  });
  const reverseStress = { ...reverseStressMutation, data: terminal?.target ? quant.stored?.[`${nativeScope}.risk/reverse-stress`] as typeof reverseStressMutation.data : reverseStressMutation.data };
  const correlationBreakdownMutation = useMutation({
    mutationFn: async () => {
      const payload = correlationStressInput as { assets?: string[]; weights?: number[]; assetVolatilityPct?: number[]; baseCorrelationMatrix?: number[][]; stressedPairwiseCorrelation?: number };
      if (!payload.assets?.length || new Set(payload.assets).size !== payload.assets.length || !payload.weights || !payload.assetVolatilityPct || !payload.baseCorrelationMatrix || !Number.isFinite(payload.stressedPairwiseCorrelation) || payload.stressedPairwiseCorrelation! < -0.99 || payload.stressedPairwiseCorrelation! > 0.999) throw new Error("Correlation stress requires unique assets, weights, volatilities, a base correlation matrix, and a stress correlation in [-0.99, 0.999].");
      assertWeights(payload.weights, payload.assets.length, "Weights");
      if (payload.assetVolatilityPct.length !== payload.assets.length || payload.assetVolatilityPct.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("assetVolatilityPct requires one non-negative finite value per asset.");
      assertSquareMatrix(payload.baseCorrelationMatrix, payload.assets.length, "baseCorrelationMatrix");
      if (payload.baseCorrelationMatrix.some((row, rowIndex) => row.some((value, columnIndex) => Math.abs(value) > 1 || (rowIndex === columnIndex && Math.abs(value - 1) > 1e-8)))) throw new Error("Base correlation values must be in [-1, 1] with a unit diagonal.");
      return runAdvancedPortfolioRisk<CorrelationBreakdownResult>("risk/correlation-breakdown", payload as Record<string, unknown>);
    },
  });
  const correlationBreakdown = { ...correlationBreakdownMutation, data: terminal?.target ? quant.stored?.[`${nativeScope}.risk/correlation-breakdown`] as typeof correlationBreakdownMutation.data : correlationBreakdownMutation.data };
  const [scenario, setScenario] = useTerminalArtifactState("PortfolioStressPanel.scenario", SCENARIOS[0]);
  const [orgId, setOrgId] = useTerminalArtifactState<number | null>("PortfolioStressPanel.orgId", null);
  const [portfolioId, setPortfolioId] = useTerminalArtifactState<number | null>("PortfolioStressPanel.portfolioId", null);

  const { data: organizations = [] } = useQuery<AdminOrganization[]>({
    queryKey: ["/api/admin/organizations"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/organizations")).json(),
  });
  const { data: orgPortfolios = [] } = useQuery<AdminPortfolio[]>({
    queryKey: ["/api/admin/organizations", orgId, "portfolios"],
    queryFn: async () => (await apiRequest("GET", `/api/admin/organizations/${orgId}/portfolios`)).json(),
    enabled: orgId !== null,
  });
  const { data: rawPositions = [], isLoading: holdingsLoading } = useQuery<AdminPosition[]>({
    queryKey: ["/api/admin/portfolios", portfolioId, "positions"],
    queryFn: async () => (await apiRequest("GET", `/api/admin/portfolios/${portfolioId}/positions`)).json(),
    enabled: portfolioId !== null,
  });
  const positions = useMemo(
    () => rawPositions.map((p) => ({ symbol: p.symbol, shares: p.shares, avgCost: p.avgCost, price: null as number | null })),
    [rawPositions],
  );

  const syms = useMemo(() => Array.from(new Set(positions.map(p => p.symbol))), [positions]);
  const { data: quotes = [] } = useQuotes(syms);
  const qMap = useMemo(() => new Map(quotes.map(q => [q.symbol, q])), [quotes]);

  const missingPriceCount = positions.filter((position) => {
    const price = qMap.get(position.symbol)?.price ?? position.price;
    return typeof price !== "number" || !Number.isFinite(price);
  }).length;

  // Compute current portfolio value from real quote/enriched-holding prices only.
  const portfolio = useMemo(() => {
    return positions.flatMap(p => {
      const price = qMap.get(p.symbol)?.price ?? p.price;
      if (typeof price !== "number" || !Number.isFinite(price)) return [];
      const factor = classifyAsset(p.symbol);
      const impact = scenario.factors[factor] ?? scenario.factors.equity;
      const currentValue = p.shares * price;
      const stressValue  = currentValue * (1 + impact);
      const costBasis = p.shares * p.avgCost;
      const pnl = currentValue - costBasis;
      const stressPnl = stressValue - costBasis;
      return { ...p, price, factor, impact, currentValue, stressValue, pnl, stressPnl, symbol: p.symbol };
    });
  }, [positions, qMap, scenario]);

  const totCurrent = portfolio.reduce((s,p) => s + p.currentValue, 0);
  const totStress  = portfolio.reduce((s,p) => s + p.stressValue, 0);
  const totLoss    = totStress - totCurrent;

  // Grouped by native currency -- same reasoning as PortfolioPanel: summing
  // raw numbers across currencies is meaningless, so totals are shown
  // per-currency rather than blended into one number.
  const currencyGroups = useMemo(() => {
    const byCurrency = new Map<string, typeof portfolio>();
    for (const p of portfolio) {
      const curr = getCurrencySymbol(p.symbol);
      if (!byCurrency.has(curr)) byCurrency.set(curr, []);
      byCurrency.get(curr)!.push(p);
    }
    return Array.from(byCurrency.entries()).map(([curr, ps]) => ({
      curr,
      current: ps.reduce((s, p) => s + p.currentValue, 0),
      stress: ps.reduce((s, p) => s + p.stressValue, 0),
    }));
  }, [portfolio]);
  const fmtByCurrency = (key: "current" | "stress") =>
    currencyGroups.length ? currencyGroups.map((g) => `${g.curr}${g[key].toLocaleString("en-US", { maximumFractionDigits: 0 })}`).join(" / ") : "—";
  const fmtLossByCurrency = () =>
    currencyGroups.length ? currencyGroups.map((g) => `${g.curr}${Math.abs(g.stress - g.current).toLocaleString("en-US", { maximumFractionDigits: 0 })}`).join(" / ") : "—";
  const singleCurrency = currencyGroups.length === 1;
  const totLossPct = singleCurrency && totCurrent > 0 ? totLoss / totCurrent * 100 : null;

  const chartData = portfolio.map(p => ({ name: p.symbol, current: p.currentValue, stress: p.stressValue, impact: p.stressPnl }));

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0">
        <Flame className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">PORTFOLIO STRESS TEST — APPLY MACRO SHOCKS TO HOLDINGS</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">PSTRS</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Org / portfolio selector */}
        <div className="w-64 shrink-0 border-r border-border bg-[#060606] p-4 space-y-2 overflow-y-auto scrollbar-thin">
          <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">SELECT CLIENT PORTFOLIO</div>
          <select
            value={orgId ?? ""}
            onChange={(e) => { const next = e.target.value ? Number(e.target.value) : null; setOrgId(next); setPortfolioId(null); }}
            className="w-full bg-[#050505] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground"
          >
            <option value="">SELECT ORGANIZATION…</option>
            {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
          <select
            value={portfolioId ?? ""}
            onChange={(e) => setPortfolioId(e.target.value ? Number(e.target.value) : null)}
            disabled={orgId === null}
            className="w-full bg-[#050505] border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground disabled:opacity-40"
          >
            <option value="">{orgId === null ? "SELECT AN ORGANIZATION FIRST" : "SELECT PORTFOLIO…"}</option>
            {orgPortfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {orgId !== null && !orgPortfolios.length && (
            <p className="font-terminal text-[7px] text-muted-foreground leading-relaxed">This organization has no portfolios yet. Create one and add positions from Admin Console → Portfolios.</p>
          )}
        </div>
        <div className="w-64 shrink-0 border-r border-border bg-[#060606] p-4 space-y-2 overflow-y-auto scrollbar-thin">
          <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-3">SELECT SCENARIO</div>
          {SCENARIOS.map(s => (
            <button key={s.id} onClick={() => setScenario(s)}
              className={`w-full text-left p-3 border transition-all space-y-1 ${scenario.id === s.id ? "" : "border-border hover:border-opacity-60"}`}
              style={{ borderColor: scenario.id === s.id ? s.color : undefined, backgroundColor: scenario.id === s.id ? `${s.color}15` : undefined }}>
              <div className="font-terminal text-[9px] font-bold" style={{ color: scenario.id === s.id ? s.color : "hsl(0,0%,65%)" }}>{s.label}</div>
              <div className="font-terminal text-[7.5px] text-muted-foreground leading-tight">{s.desc}</div>
            </button>
          ))}

          {/* Scenario factors */}
          <div className="mt-4 border border-border p-3 space-y-1.5">
            <div className="font-terminal text-[7.5px] text-muted-foreground tracking-widest mb-2">FACTOR IMPACTS · SCENARIO ASSUMPTIONS</div>
            {Object.entries(scenario.factors).map(([factor, impact]) => (
              <div key={factor} className="flex items-center justify-between">
                <span className="font-terminal text-[8px] text-muted-foreground capitalize">{factor.replace("_"," ")}</span>
                <span className={`font-terminal text-[9px] tabular-nums font-bold ${impact >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>
                  {impact >= 0 ? "+" : ""}{(impact * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {portfolioId === null && <div className="m-4 border border-[hsl(38,95%,55%)]/35 bg-[hsl(38,95%,50%)]/5 p-3 font-terminal text-[9px] leading-relaxed text-muted-foreground">SELECT AN ORGANIZATION AND PORTFOLIO TO STRESS TEST. LOAD REAL CLIENT PORTFOLIO POSITIONS BEFORE TREATING ANY SCENARIO AS A PORTFOLIO RESULT.</div>}
          {portfolioId !== null && holdingsLoading && <div className="m-4 border border-border bg-[#080808] p-3 font-terminal text-[9px] text-muted-foreground">LOADING PORTFOLIO HOLDINGS...</div>}
          {portfolioId !== null && !holdingsLoading && !positions.length && <div className="m-4 border border-[hsl(38,95%,55%)]/35 bg-[hsl(38,95%,50%)]/5 p-3 font-terminal text-[9px] leading-relaxed text-muted-foreground">THIS PORTFOLIO HAS NO POSITIONS YET. ADD POSITIONS FROM ADMIN CONSOLE → PORTFOLIOS BEFORE STRESS TESTING.</div>}
          {!!missingPriceCount && <div className="m-4 border border-[hsl(20,90%,45%)]/40 bg-[hsl(20,90%,50%)]/5 p-3 font-terminal text-[9px] leading-relaxed text-muted-foreground">{missingPriceCount} HOLDING{missingPriceCount === 1 ? "" : "S"} EXCLUDED BECAUSE NO LIVE OR ENRICHED PRICE WAS AVAILABLE. AVG COST IS NOT USED AS A PRICE SUBSTITUTE.</div>}
          {/* Summary KPIs */}
          <div className="shrink-0 grid grid-cols-4 border-b border-border bg-[#060606]" style={{ borderTop: `2px solid ${scenario.color}` }}>
            {[
              { label: "CURRENT VALUE",   val: fmtByCurrency("current"), cls: "" },
              { label: "STRESS VALUE",    val: fmtByCurrency("stress"),  cls: "text-[hsl(0,80%,60%)]" },
              { label: "PORTFOLIO LOSS",  val: fmtLossByCurrency(), cls: "text-[hsl(0,80%,60%)]" },
              { label: "DRAWDOWN %",      val: totLossPct === null ? "—" : `${totLossPct.toFixed(1)}%`,  cls: totLossPct !== null && totLossPct < -40 ? "text-[hsl(0,80%,55%)]" : "text-[hsl(38,95%,55%)]" },
            ].map(k => (
              <div key={k.label} className="p-3 border-r border-border last:border-r-0 text-center">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-0.5">{k.label}</div>
                <div className={`font-terminal text-[13px] font-bold tabular-nums ${k.cls || "text-foreground"}`}>{k.val}</div>
              </div>
            ))}
          </div>

          {!singleCurrency && currencyGroups.length > 1 && <div className="shrink-0 px-4 py-2 border-b border-cyan-500/20 bg-cyan-500/[0.025] font-terminal text-[8.5px] text-muted-foreground"><span className="text-cyan-300">CROSS-CURRENCY AGGREGATION WITHHELD:</span> native-currency holdings are shown separately. Drawdown %, aggregate chart and blended totals require an explicit FX normalization base.</div>}
          {/* Warning if severe */}
          {totLossPct !== null && totLossPct < -30 && (
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-[hsl(0,80%,8%)] border-b border-[hsl(0,80%,20%)] font-terminal text-[8.5px] text-[hsl(0,80%,65%)]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              SEVERE LOSS SCENARIO — Portfolio would experience a {Math.abs(totLossPct).toFixed(0)}% drawdown in a {scenario.label} scenario. Consider hedges (TLT, GLD) or reducing position sizes.
            </div>
          )}

          <div className="mx-4 mt-4 border border-border bg-[#080808] p-3 space-y-3 shrink-0">
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">REVERSE &amp; CORRELATION STRESS / MANUAL ASSUMPTIONS</div>
            <div className="font-terminal text-[7px] text-muted-foreground leading-relaxed">The holdings display has no immutable return/covariance snapshot. These engines therefore require complete analyst-entered matrices and are explicitly MANUAL—not a live holdings risk result.</div>
            <div className="grid gap-3 xl:grid-cols-2">
              <div className="space-y-2">
                <StructuredJsonEditor schema={REVERSE_STRESS_SCHEMA} value={reverseStressInput} onChange={setReverseStressInput} />
                <button disabled={reverseStress.isPending} onClick={() => reverseStress.mutate()} className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40">{reverseStress.isPending ? "RUNNING…" : "RUN REVERSE STRESS"}</button>
                {reverseStress.error && <div className="font-terminal text-[7px] text-red-300">{reverseStress.error.message}</div>}
                {reverseStress.data && <><div className="font-terminal text-[7px] text-foreground">MINIMUM SHOCK RETURN {reverseStress.data.portfolioReturnPct.toFixed(2)}% · MAHALANOBIS {reverseStress.data.mahalanobisDistance.toFixed(3)} · {Object.entries(reverseStress.data.minimumMahalanobisShock).map(([asset, shock]) => `${asset} ${shock.toFixed(2)}%`).join(" / ")}</div><AdvancedPortfolioRiskReceipt receipt={reverseStress.data.receipt} /></>}
              </div>
              <div className="space-y-2">
                <StructuredJsonEditor schema={CORRELATION_BREAKDOWN_SCHEMA} value={correlationStressInput} onChange={setCorrelationStressInput} />
                <button disabled={correlationBreakdown.isPending} onClick={() => correlationBreakdown.mutate()} className="border border-amber-400/50 px-2 py-1 font-terminal text-[8px] text-amber-200 disabled:opacity-40">{correlationBreakdown.isPending ? "RUNNING…" : "RUN CORRELATION BREAKDOWN"}</button>
                {correlationBreakdown.error && <div className="font-terminal text-[7px] text-red-300">{correlationBreakdown.error.message}</div>}
                {correlationBreakdown.data && <><div className="font-terminal text-[7px] text-foreground">BASE VOL {correlationBreakdown.data.baseVolatilityPct.toFixed(2)}% · STRESSED VOL {correlationBreakdown.data.stressedVolatilityPct.toFixed(2)}% · INCREASE {correlationBreakdown.data.volatilityIncreasePct.toFixed(2)}%</div><AdvancedPortfolioRiskReceipt receipt={correlationBreakdown.data.receipt} /></>}
              </div>
            </div>
          </div>
          {/* Bar chart */}
          {singleCurrency ? (
            <div className="p-4 h-44 shrink-0">
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground mb-2">CURRENT vs STRESSED POSITION VALUES · {currencyGroups[0]?.curr}</div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: 40 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(0,0%,8%)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: "hsl(0,0%,50%)" }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(value) => `${currencyGroups[0]?.curr ?? ''}${(value/1000).toFixed(0)}k`} tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7, fill: "hsl(0,0%,50%)" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,15%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} formatter={(value: number, name) => [`${currencyGroups[0]?.curr ?? ''}${value.toFixed(0)}`, name === "current" ? "Current" : "Stressed"]} />
                  <Bar dataKey="current" name="current" fill="hsl(38,95%,30%)" radius={[2,2,0,0]} />
                  <Bar dataKey="stress"  name="stress"  fill="hsl(0,80%,40%)"  radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : currencyGroups.length > 1 ? (
            <div className="mx-4 mt-4 border border-border bg-[#080808] p-4 font-terminal text-[8px] text-muted-foreground">POSITION-VALUE CHART WITHHELD · select/normalize to one base currency before comparing monetary magnitudes.</div>
          ) : null}

          {/* Position table */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-[#070707] z-10">
                <tr className="border-b border-border">
                  {["SYMBOL","SHARES","PRICE","CURR VALUE","FACTOR","IMPACT","STRESS VALUE","STRESS P&L"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-terminal text-[7.5px] text-muted-foreground tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {portfolio.map(p => (
                  <tr key={p.symbol} className="border-b border-border/30 hover:bg-white/[1.5%] cursor-pointer" onClick={() => onSymbol(p.symbol)}>
                    <td className="px-3 py-2.5 font-terminal text-[10px] font-bold text-foreground">{p.symbol}</td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">{p.shares}</td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">{getCurrencySymbol(p.symbol)}{p.price.toFixed(2)}</td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums">{getCurrencySymbol(p.symbol)}{p.currentValue.toFixed(0)}</td>
                    <td className="px-3 py-2.5 font-terminal text-[8px] text-muted-foreground capitalize">{p.factor.replace("_"," ")}</td>
                    <td className={`px-3 py-2.5 font-terminal text-[9px] font-bold tabular-nums ${p.impact >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>
                      {p.impact >= 0 ? "+" : ""}{(p.impact*100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-2.5 font-terminal text-[9px] tabular-nums text-[hsl(0,80%,60%)]">{getCurrencySymbol(p.symbol)}{p.stressValue.toFixed(0)}</td>
                    <td className={`px-3 py-2.5 font-terminal text-[9px] font-bold tabular-nums ${p.stressPnl >= 0 ? "text-[hsl(142,71%,55%)]" : "text-[hsl(0,80%,60%)]"}`}>
                      {p.stressPnl >= 0 ? "+" : ""}{getCurrencySymbol(p.symbol)}{p.stressPnl.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}