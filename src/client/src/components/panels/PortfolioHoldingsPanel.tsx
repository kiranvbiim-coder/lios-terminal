import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useMemo, useState } from "react";
import { Briefcase, Plus, Trash2 } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { useFundamentalsMany, usePortfolioAnalytics, useQuotes } from "@/lib/useFinance";
import { formatBig, formatMoney, formatPct, pctClass, type PortfolioPositionInput } from "@/lib/finance";
import { Skeleton } from "@/components/ui/skeleton";
import { FusionMetric, FusionMetricGrid } from "@/components/terminal/FusionPrimitives";
import { toneForChange } from "@/lib/fusionExperience";
import { evaluatePortfolioValuationCoverage, resolveHoldingCurrency } from "@/lib/portfolioTruth";

interface Position extends PortfolioPositionInput {
  id: number;
}

interface Props {
  onSymbol: (sym: string) => void;
}

const ALLOCATION_COLORS = [
  "hsl(38,95%,55%)",
  "hsl(186,80%,55%)",
  "hsl(142,71%,45%)",
  "hsl(265,70%,65%)",
  "hsl(0,80%,55%)",
  "hsl(200,80%,55%)",
  "hsl(60,90%,55%)",
  "hsl(300,70%,60%)",
];

function formatMetric(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 && suffix === "%" ? "+" : ""}${value.toFixed(2)}${suffix}`;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export default function PortfolioPanel({ onSymbol }: Props) {
  const [positions, setPositions] = useTerminalArtifactState<Position[]>("PortfolioHoldingsPanel.positions", []);
  const [addSym, setAddSym] = useTerminalArtifactState("PortfolioPanel.addSym", "");
  const [addShares, setAddShares] = useTerminalArtifactState("PortfolioPanel.addShares", "");
  const [addCost, setAddCost] = useTerminalArtifactState("PortfolioPanel.addCost", "");
  const [nextId, setNextId] = useTerminalArtifactState("PortfolioHoldingsPanel.nextId", 1);

  const analyticsPositions = useMemo<PortfolioPositionInput[]>(() => {
    return positions.map(({ symbol, shares, avgCost }) => ({ symbol, shares, avgCost }));
  }, [positions]);

  const symbols = useMemo(() => Array.from(new Set(positions.map((position) => position.symbol))), [positions]);
  const { data: quotes = [] } = useQuotes(symbols);
  const { map: fundamentalsMap, isLoading: fundamentalsLoading } = useFundamentalsMany(symbols);
  const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));

  const positionsWithValue = positions.map((position) => {
    const quote = quoteMap.get(position.symbol);
    const currentPrice = isFiniteNumber(quote?.price) ? quote!.price : null;
    const value = currentPrice === null ? null : currentPrice * position.shares;
    const cost = position.avgCost * position.shares;
    const pnl = value === null ? null : value - cost;
    const pnlPct = pnl === null || cost <= 0 ? null : (pnl / cost) * 100;
    const currencyCode = resolveHoldingCurrency(position.symbol, quote?.currency);
    return { ...position, currentPrice, value, cost, pnl, pnlPct, currencyCode, quote };
  });

  const valuationCoverage = evaluatePortfolioValuationCoverage(
    positionsWithValue.map((position) => ({
      symbol: position.symbol,
      quoteCurrency: position.quote?.currency,
      hasLivePrice: position.currentPrice !== null,
    })),
  );
  const analyticsInput = valuationCoverage.canAggregateWeights ? analyticsPositions : [];
  const { data: analytics, isLoading: analyticsLoading } = usePortfolioAnalytics(analyticsInput);

  // Keep native currencies separate. Without an explicit FX normalization
  // layer, adding USD + INR + GBP notionals would manufacture a meaningless
  // portfolio total and corrupt allocation/concentration weights.
  const byCurrency = new Map<string, typeof positionsWithValue>();
  for (const position of positionsWithValue) {
    if (position.value === null) continue;
    if (!byCurrency.has(position.currencyCode)) byCurrency.set(position.currencyCode, []);
    byCurrency.get(position.currencyCode)!.push(position);
  }
  const currencyTotals = Array.from(byCurrency.entries()).map(([currencyCode, currencyPositions]) => {
    const value = currencyPositions.reduce((sum, position) => sum + (position.value ?? 0), 0);
    const cost = currencyPositions.reduce((sum, position) => sum + position.cost, 0);
    return { currencyCode, value, cost, pnl: value - cost };
  });

  const totalsComplete = valuationCoverage.allPriced;
  const totalValueStr = positionsWithValue.length === 0
    ? "—"
    : totalsComplete
      ? currencyTotals.map((item) => formatBig(item.value, item.currencyCode)).join(" / ") || "—"
      : "—";
  const totalPnlStr = positionsWithValue.length === 0
    ? "—"
    : totalsComplete
      ? currencyTotals.map((item) => item.pnl >= 0 ? `+${formatBig(item.pnl, item.currencyCode)}` : formatBig(item.pnl, item.currencyCode)).join(" / ") || "—"
      : "—";

  const aggregateCurrency = valuationCoverage.canAggregateWeights ? currencyTotals[0] ?? null : null;
  const totalValueForWeights = aggregateCurrency?.value ?? null;
  const totalPnl = aggregateCurrency?.pnl ?? null;
  const totalPnlPct = aggregateCurrency && aggregateCurrency.cost > 0 ? (aggregateCurrency.pnl / aggregateCurrency.cost) * 100 : null;

  const allocation = valuationCoverage.canAggregateWeights
    ? positionsWithValue.flatMap((position) => position.value === null ? [] : [{ name: position.symbol, value: position.value }])
    : [];
  const largestHolding = valuationCoverage.canAggregateWeights
    ? positionsWithValue
      .filter((position) => position.value !== null)
      .reduce<typeof positionsWithValue[number] | null>((largest, position) => !largest || (position.value ?? 0) > (largest.value ?? 0) ? position : largest, null)
    : null;
  const largestWeightPct = largestHolding && largestHolding.value !== null && totalValueForWeights && totalValueForWeights > 0
    ? (largestHolding.value / totalValueForWeights) * 100
    : null;
  const valuationCoverageLabel = valuationCoverage.reason === "mixed_currency"
    ? "FX NORMALIZATION REQUIRED"
    : valuationCoverage.reason === "missing_quotes"
      ? `${valuationCoverage.pricedCount}/${valuationCoverage.holdingCount} LIVE PRICES`
      : valuationCoverage.reason === "ready"
        ? "LIVE VALUE COVERAGE COMPLETE"
        : "NO HOLDINGS";

  const handleAdd = (event: React.FormEvent) => {
    event.preventDefault();
    if (!addSym.trim() || !addShares || !addCost) return;

    setPositions((current) => [
      ...current,
      {
        id: nextId,
        symbol: addSym.trim().toUpperCase(),
        shares: Number(addShares),
        avgCost: Number(addCost),
      },
    ]);
    setNextId((value) => value + 1);
    setAddSym("");
    setAddShares("");
    setAddCost("");
  };

  const handleRemove = (id: number) => {
    setPositions((current) => current.filter((position) => position.id !== id));
  };

  const riskCards = [
    { label: `${analytics?.benchmarkSymbol ?? "SPY"} RETURN`, value: formatMetric(analytics?.benchmarkReturnPct, "%"), cls: pctClass(analytics?.benchmarkReturnPct ?? 0) },
    { label: "ACTIVE RETURN", value: formatMetric(analytics?.activeReturnPct, "%"), cls: pctClass(analytics?.activeReturnPct ?? 0) },
    { label: "BETA", value: formatMetric(analytics?.beta), cls: "" },
    { label: "VOLATILITY", value: formatMetric(analytics?.annualizedVolatilityPct, "%"), cls: "" },
    { label: "MAX DRAWDOWN", value: formatMetric(analytics?.maxDrawdownPct, "%"), cls: pctClass(analytics?.maxDrawdownPct ?? 0) },
    { label: "EFFECTIVE ASSETS", value: formatMetric(analytics?.effectiveNumberOfAssets), cls: "" },
  ];

  const weightedMetric = (accessor: (symbol: string) => number | null | undefined) => {
    let weighted = 0;
    let weightCovered = 0;
    let holdingsCovered = 0;
    for (const position of positionsWithValue) {
      const metric = accessor(position.symbol);
      if (!valuationCoverage.canAggregateWeights || !isFiniteNumber(metric) || !isFiniteNumber(position.value) || !totalValueForWeights || totalValueForWeights <= 0) continue;
      const weight = position.value / totalValueForWeights;
      weighted += metric * weight;
      weightCovered += weight;
      holdingsCovered += 1;
    }
    return {
      value: weightCovered > 0 ? weighted / weightCovered : null,
      coverage: valuationCoverage.canAggregateWeights
        ? `${holdingsCovered}/${positionsWithValue.length} · ${(weightCovered * 100).toFixed(0)}% WT`
        : valuationCoverageLabel,
    };
  };

  const qualityCards = [
    {
      label: "REV GROWTH",
      metric: weightedMetric((symbol) => {
        const value = fundamentalsMap.get(symbol)?.revenueGrowth;
        return isFiniteNumber(value) ? value * 100 : null;
      }),
      suffix: "%",
    },
    {
      label: "NET MARGIN",
      metric: weightedMetric((symbol) => {
        const value = fundamentalsMap.get(symbol)?.profitMargins;
        return isFiniteNumber(value) ? value * 100 : null;
      }),
      suffix: "%",
    },
    {
      label: "ROE",
      metric: weightedMetric((symbol) => {
        const value = fundamentalsMap.get(symbol)?.returnOnEquity;
        return isFiniteNumber(value) ? value * 100 : null;
      }),
      suffix: "%",
    },
    {
      label: "P/E",
      metric: weightedMetric((symbol) => fundamentalsMap.get(symbol)?.trailingPE),
      suffix: "x",
    },
    {
      label: "P/B",
      metric: weightedMetric((symbol) => fundamentalsMap.get(symbol)?.priceToBook),
      suffix: "x",
    },
    {
      label: "DEBT / EQUITY",
      metric: weightedMetric((symbol) => fundamentalsMap.get(symbol)?.debtToEquity),
      suffix: "x",
    },
  ];

  return (
    <div className="h-full overflow-y-auto scrollbar-thin bg-[#050505]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-[#070707] sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-[hsl(38,95%,55%)]" />
          <span className="panel-label">PORTFOLIO</span>
        </div>
        <div className="text-right">
          <div className="font-terminal text-lg font-bold tabular-nums">{totalValueStr}</div>
          <div className={`font-terminal text-[10px] tabular-nums ${totalPnl === null ? "text-muted-foreground" : pctClass(totalPnl)}`}>
            {totalPnlStr}{totalPnlPct === null ? "" : ` (${formatPct(totalPnlPct)})`}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <form data-fusion-portfolio-add onSubmit={handleAdd} className="flex items-center gap-2 p-3 border border-border bg-[#080808]">
          <span className="font-terminal text-[9px] text-muted-foreground shrink-0">ADD POSITION</span>
          <input value={addSym} onChange={(event) => setAddSym(event.target.value.toUpperCase())} placeholder="TICKER" className="w-20 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none" />
          <input type="number" value={addShares} onChange={(event) => setAddShares(event.target.value)} placeholder="SHARES" className="w-20 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none" />
          <input type="number" value={addCost} onChange={(event) => setAddCost(event.target.value)} placeholder="AVG COST" step="0.01" className="w-24 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none" />
          <button type="submit" className="flex items-center gap-1.5 px-3 py-1.5 bg-[hsl(38,95%,50%)/15%] border border-[hsl(38,95%,50%)/40%] font-terminal text-[10px] text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)/25%]">
            <Plus className="w-3 h-3" /> ADD
          </button>
        </form>

        {positionsWithValue.length > 0 && valuationCoverage.reason !== "ready" && (
          <div className="border border-amber-500/25 bg-amber-500/[0.03] px-3 py-2 font-terminal text-[8px] leading-relaxed text-muted-foreground">
            <span className="text-amber-300">{valuationCoverage.reason === "mixed_currency" ? "CROSS-CURRENCY GUARD" : "VALUATION COVERAGE"}</span>
            {" · "}
            {valuationCoverage.reason === "mixed_currency"
              ? "Per-currency values remain visible, but blended allocation, concentration, weighted exposure and portfolio-return analytics are withheld until an explicit FX-normalization layer is available."
              : `Live prices are available for ${valuationCoverage.pricedCount} of ${valuationCoverage.holdingCount} holdings. Aggregate valuation and weight-based analytics remain unavailable until coverage is complete.`}
          </div>
        )}

        <FusionMetricGrid>
          <FusionMetric label="TOTAL VALUE" value={totalValueStr} secondary={`${positionsWithValue.length} holdings · ${valuationCoverageLabel.toLowerCase()}`} />
          <FusionMetric label="TOTAL P&L" value={totalPnlStr} change={totalPnlPct === null ? undefined : formatPct(totalPnlPct)} tone={toneForChange(totalPnlPct)} />
          <FusionMetric label="ACTIVE RETURN" value={formatMetric(analytics?.activeReturnPct, "%")} secondary={`vs ${analytics?.benchmarkSymbol ?? "SPY"}`} tone={toneForChange(analytics?.activeReturnPct)} />
          <FusionMetric label="VOLATILITY" value={formatMetric(analytics?.annualizedVolatilityPct, "%")} secondary="Annualized" />
          <FusionMetric label="MAX DRAWDOWN" value={formatMetric(analytics?.maxDrawdownPct, "%")} secondary="Observed portfolio path" tone={toneForChange(analytics?.maxDrawdownPct)} />
          <FusionMetric label="TOP CONCENTRATION" value={largestWeightPct == null ? "—" : `${largestWeightPct.toFixed(1)}%`} secondary={largestHolding?.symbol ?? "No holdings"} tone={largestWeightPct != null && largestWeightPct > 30 ? "warning" : "neutral"} />
        </FusionMetricGrid>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
          {riskCards.map((card) => (
            <div key={card.label} className="bg-[#080808] border border-border p-2">
              <div className="font-terminal text-[7px] text-muted-foreground tracking-widest mb-1">{card.label}</div>
              <div className={`font-terminal text-[12px] font-bold tabular-nums ${card.cls}`}>{card.value}</div>
            </div>
          ))}
        </div>
        <div className="font-terminal text-[8px] text-muted-foreground">
          Effective assets (skfolio inverse-Herfindahl): {analytics?.diversificationAsOf
            ? `recorded closes as of ${analytics.diversificationAsOf}`
            : "unavailable — missing, stale or non-comparable position prices"}. Not verified live pricing.
        </div>

        <div className="bg-[#080808] border border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="panel-label">QUALITY / VALUATION EXPOSURE</div>
            <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">
              {fundamentalsLoading ? "LOADING LIVE PROVIDER METRICS" : valuationCoverage.canAggregateWeights ? "WEIGHTED BY LIVE HOLDING VALUE" : valuationCoverageLabel}
            </div>
          </div>
          <div data-fusion-responsive-grid="six" className="grid grid-cols-6 gap-2">
            {qualityCards.map((card) => (
              <div key={card.label} className="border border-border/60 bg-[#050505] px-2 py-1.5">
                <div className="font-terminal text-[7px] text-muted-foreground tracking-widest">{card.label}</div>
                <div className="font-terminal text-[12px] font-bold tabular-nums">
                  {card.metric.value == null ? "—" : `${card.metric.value.toFixed(2)}${card.suffix}`}
                </div>
                <div className="font-terminal text-[7px] text-muted-foreground">{card.metric.coverage}</div>
              </div>
            ))}
          </div>
        </div>

        <div data-fusion-portfolio-chart-grid className="grid grid-cols-3 gap-3">
          <div data-fusion-portfolio-chart-main className="col-span-2 bg-[#080808] border border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="panel-label">30D VS {analytics?.benchmarkSymbol ?? "SPY"}</div>
              <div className="font-terminal text-[8px] tracking-widest text-muted-foreground">INDEXED TO 100</div>
            </div>
            {analyticsLoading ? (
              <Skeleton className="w-full h-[140px] bg-border" />
            ) : analytics?.chart.length ? (
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={analytics.chart} margin={{ top: 4, right: 4, bottom: 4, left: 48 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(0,0%,12%)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: "hsl(0,0%,45%)" }} tickLine={false} axisLine={false} interval={4} />
                  <YAxis tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: "hsl(0,0%,45%)" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "#0d0d0d", border: "1px solid hsl(0,0%,13%)", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }} />
                  <Line type="monotone" dataKey="portfolio" stroke="hsl(38,95%,55%)" strokeWidth={1.7} dot={false} name="Portfolio" />
                  <Line type="monotone" dataKey="benchmark" stroke="hsl(186,80%,55%)" strokeWidth={1.5} dot={false} name={analytics.benchmarkSymbol} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[140px] flex items-center justify-center px-4 text-center font-terminal text-xs text-muted-foreground">{positionsWithValue.length > 0 && !valuationCoverage.canAggregateWeights ? valuationCoverageLabel : "INSUFFICIENT HISTORY FOR ANALYTICS"}</div>
            )}
          </div>

          <div className="bg-[#080808] border border-border p-3">
            <div className="panel-label mb-2">ALLOCATION</div>
            {allocation.length ? <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={allocation} cx="50%" cy="50%" outerRadius={52} dataKey="value" nameKey="name" label={({ name }) => name} labelLine={false}>
                  {allocation.map((_, index) => <Cell key={index} fill={ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer> : <div className="h-[140px] flex items-center justify-center px-4 text-center font-terminal text-xs text-muted-foreground">{positionsWithValue.length > 0 && !valuationCoverage.canAggregateWeights ? valuationCoverageLabel : "ADD REAL HOLDINGS TO VIEW ALLOCATION"}</div>}
          </div>
        </div>

        <div className="bg-[#080808] border border-border">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr_1.5fr_1.5fr_1fr_auto] px-3 py-1.5 border-b border-border font-terminal text-[8px] text-muted-foreground">
            {['SYMBOL', 'SHARES', 'AVG COST', 'CURRENT', 'VALUE', 'P&L', 'RETURN', 'WEIGHT', ''].map((heading, index) => (
              <span key={heading + index} className={index > 0 ? 'text-right' : ''}>{heading}</span>
            ))}
          </div>
          {positionsWithValue.map((position) => {
            const weightPct = valuationCoverage.canAggregateWeights && position.value !== null && totalValueForWeights && totalValueForWeights > 0 ? (position.value / totalValueForWeights) * 100 : null;
            return (
              <div
                key={position.id}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr_1.5fr_1.5fr_1fr_auto] px-3 py-2.5 border-b border-border/50 hover:bg-white/5 group items-center cursor-pointer"
                onClick={() => onSymbol(position.symbol)}
              >
                <span className="font-terminal text-[11px] font-bold text-[hsl(38,95%,55%)]">{position.symbol}</span>
                <span className="font-terminal text-[10px] tabular-nums text-right">{position.shares}</span>
                <span className="font-terminal text-[10px] tabular-nums text-right text-muted-foreground">{formatMoney(position.avgCost, position.currencyCode)}</span>
                <span className="font-terminal text-[10px] tabular-nums text-right">{formatMoney(position.currentPrice, position.currencyCode)}</span>
                <span className="font-terminal text-[10px] tabular-nums text-right">{formatBig(position.value, position.currencyCode)}</span>
                <span className={`font-terminal text-[10px] tabular-nums text-right font-semibold ${position.pnl === null ? "text-muted-foreground" : pctClass(position.pnl)}`}>
                  {position.pnl === null ? "—" : formatBig(position.pnl, position.currencyCode)}
                </span>
                <span className={`font-terminal text-[10px] tabular-nums text-right font-semibold ${position.pnlPct === null ? "text-muted-foreground" : pctClass(position.pnlPct)}`}>
                  {position.pnlPct === null ? "—" : formatPct(position.pnlPct)}
                </span>
                <span className="font-terminal text-[10px] tabular-nums text-right text-muted-foreground">{weightPct === null ? "—" : `${weightPct.toFixed(1)}%`}</span>
                <button onClick={(event) => { event.stopPropagation(); handleRemove(position.id); }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[hsl(0,80%,60%)] transition-all p-1">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
          {!positionsWithValue.length && <div className="px-3 py-8 text-center font-terminal text-[10px] text-muted-foreground">NO HOLDINGS LOADED. ADD A POSITION ABOVE TO START AN ANALYSIS.</div>}
        </div>
      </div>
    </div>
  );
}
