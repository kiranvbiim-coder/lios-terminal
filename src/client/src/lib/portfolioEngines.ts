/**
 * Portfolio analytics engines: attribution, factor exposure, rebalancing,
 * benchmark-relative metrics, and concentration risk. These complement
 * the existing portfolio analytics (beta, volatility, drawdown) in
 * server/portfolioAnalytics.ts and the quantModels.ts OLS regression.
 *
 * All functions are deterministic and pure.
 */

// ─── Brinson-Fachler Performance Attribution ──────────────────────────────

export interface BrinsonHolding {
  symbol: string;
  sector: string;
  portfolioWeight: number;   // decimal (0.10 = 10%)
  benchmarkWeight: number;   // decimal
  portfolioReturn: number;   // decimal
  benchmarkReturn: number;   // decimal
}

export interface BrinsonSectorAttribution {
  sector: string;
  allocationEffect: number;  // decimal
  selectionEffect: number;   // decimal
  interactionEffect: number; // decimal
  totalEffect: number;       // decimal
  portfolioWeight: number;
  benchmarkWeight: number;
  portfolioReturn: number;
  benchmarkReturn: number;
}

export interface BrinsonAttributionResult {
  totalPortfolioReturn: number;
  totalBenchmarkReturn: number;
  totalActiveReturn: number;
  totalAllocationEffect: number;
  totalSelectionEffect: number;
  totalInteractionEffect: number;
  sectors: BrinsonSectorAttribution[];
}

/**
 * Brinson-Fachler attribution: decomposes active return into allocation
 * (sector weight differences), selection (stock picking within sectors),
 * and interaction effects.
 *
 * Allocation = (Wp_s - Wb_s) × (Rb_s - Rb_total)
 * Selection  = Wb_s × (Rp_s - Rb_s)
 * Interaction = (Wp_s - Wb_s) × (Rp_s - Rb_s)
 */
export function computeBrinsonAttribution(holdings: BrinsonHolding[]): BrinsonAttributionResult {
  // Aggregate by sector
  const sectorMap = new Map<string, { pw: number; bw: number; pwr: number; bwr: number }>();

  for (const h of holdings) {
    const existing = sectorMap.get(h.sector) ?? { pw: 0, bw: 0, pwr: 0, bwr: 0 };
    existing.pw += h.portfolioWeight;
    existing.bw += h.benchmarkWeight;
    existing.pwr += h.portfolioWeight * h.portfolioReturn;
    existing.bwr += h.benchmarkWeight * h.benchmarkReturn;
    sectorMap.set(h.sector, existing);
  }

  const totalPortfolioReturn = Array.from(sectorMap.values()).reduce((s, v) => s + v.pwr, 0);
  const totalBenchmarkReturn = Array.from(sectorMap.values()).reduce((s, v) => s + v.bwr, 0);

  const sectors: BrinsonSectorAttribution[] = [];

  for (const [sector, data] of Array.from(sectorMap.entries())) {
    const sectorPReturn = data.pw > 0 ? data.pwr / data.pw : 0;
    const sectorBReturn = data.bw > 0 ? data.bwr / data.bw : 0;

    const allocation = (data.pw - data.bw) * (sectorBReturn - totalBenchmarkReturn);
    const selection = data.bw * (sectorPReturn - sectorBReturn);
    const interaction = (data.pw - data.bw) * (sectorPReturn - sectorBReturn);

    sectors.push({
      sector,
      allocationEffect: allocation,
      selectionEffect: selection,
      interactionEffect: interaction,
      totalEffect: allocation + selection + interaction,
      portfolioWeight: data.pw,
      benchmarkWeight: data.bw,
      portfolioReturn: sectorPReturn,
      benchmarkReturn: sectorBReturn,
    });
  }

  return {
    totalPortfolioReturn,
    totalBenchmarkReturn,
    totalActiveReturn: totalPortfolioReturn - totalBenchmarkReturn,
    totalAllocationEffect: sectors.reduce((s, sec) => s + sec.allocationEffect, 0),
    totalSelectionEffect: sectors.reduce((s, sec) => s + sec.selectionEffect, 0),
    totalInteractionEffect: sectors.reduce((s, sec) => s + sec.interactionEffect, 0),
    sectors,
  };
}

// ─── Benchmark-Relative Metrics ───────────────────────────────────────────

export interface BenchmarkRelativeMetrics {
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  treynorRatio: number | null;
  informationRatio: number | null;
  trackingError: number | null;
  jensensAlpha: number | null;
  calmarRatio: number | null;
  upCaptureRatio: number | null;
  downCaptureRatio: number | null;
}

/**
 * Computes benchmark-relative portfolio metrics from return series.
 * All returns are decimal (0.01 = 1%). riskFreeRate is annualized decimal.
 */
export function computeBenchmarkRelativeMetrics(
  portfolioReturns: number[],
  benchmarkReturns: number[],
  riskFreeRate: number,
  annualizationFactor: number = 252,
  maxDrawdownPct: number | null = null,
): BenchmarkRelativeMetrics {
  const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (n < 2) {
    return { sharpeRatio: null, sortinoRatio: null, treynorRatio: null, informationRatio: null, trackingError: null, jensensAlpha: null, calmarRatio: null, upCaptureRatio: null, downCaptureRatio: null };
  }

  const pSlice = portfolioReturns.slice(0, n);
  const bSlice = benchmarkReturns.slice(0, n);

  const periodicRf = riskFreeRate / annualizationFactor;
  const meanP = pSlice.reduce((s, v) => s + v, 0) / n;
  const meanB = bSlice.reduce((s, v) => s + v, 0) / n;

  // Standard deviation
  const stdP = Math.sqrt(pSlice.reduce((s, v) => s + (v - meanP) ** 2, 0) / (n - 1));
  const annualizedStdP = stdP * Math.sqrt(annualizationFactor);

  // Downside deviation (for Sortino)
  const downsideDeviations = pSlice.filter((r) => r < periodicRf).map((r) => (r - periodicRf) ** 2);
  const downsideDev = downsideDeviations.length > 0
    ? Math.sqrt(downsideDeviations.reduce((s, v) => s + v, 0) / n) * Math.sqrt(annualizationFactor)
    : null;

  // Active returns
  const activeReturns = pSlice.map((p, i) => p - bSlice[i]);
  const meanActive = activeReturns.reduce((s, v) => s + v, 0) / n;
  const trackingError = Math.sqrt(activeReturns.reduce((s, v) => s + (v - meanActive) ** 2, 0) / (n - 1)) * Math.sqrt(annualizationFactor);

  // Beta
  const covPB = pSlice.reduce((s, v, i) => s + (v - meanP) * (bSlice[i] - meanB), 0) / (n - 1);
  const varB = bSlice.reduce((s, v) => s + (v - meanB) ** 2, 0) / (n - 1);
  const beta = varB > 1e-12 ? covPB / varB : null;

  const annualizedReturnP = meanP * annualizationFactor;
  const annualizedReturnB = meanB * annualizationFactor;
  const excessReturn = annualizedReturnP - riskFreeRate;

  // Sharpe = (Rp - Rf) / σp
  const sharpeRatio = annualizedStdP > 1e-12 ? excessReturn / annualizedStdP : null;

  // Sortino = (Rp - Rf) / downside deviation
  const sortinoRatio = downsideDev != null && downsideDev > 1e-12 ? excessReturn / downsideDev : null;

  // Treynor = (Rp - Rf) / β
  const treynorRatio = beta != null && Math.abs(beta) > 1e-12 ? excessReturn / beta : null;

  // Information Ratio = active return / tracking error
  const informationRatio = trackingError > 1e-12 ? (meanActive * annualizationFactor) / trackingError : null;

  // Jensen's Alpha = Rp - [Rf + β(Rm - Rf)]
  const jensensAlpha = beta != null ? annualizedReturnP - (riskFreeRate + beta * (annualizedReturnB - riskFreeRate)) : null;

  // Calmar = annualized return / max drawdown
  const calmarRatio = maxDrawdownPct != null && maxDrawdownPct > 0 ? annualizedReturnP / (maxDrawdownPct / 100) : null;

  // Up/Down capture
  const upPeriods = bSlice.map((b, i) => ({ p: pSlice[i], b })).filter((x) => x.b > 0);
  const downPeriods = bSlice.map((b, i) => ({ p: pSlice[i], b })).filter((x) => x.b < 0);
  const upCaptureRatio = upPeriods.length > 0
    ? (upPeriods.reduce((s, x) => s + x.p, 0) / upPeriods.length) / (upPeriods.reduce((s, x) => s + x.b, 0) / upPeriods.length)
    : null;
  const downCaptureRatio = downPeriods.length > 0
    ? (downPeriods.reduce((s, x) => s + x.p, 0) / downPeriods.length) / (downPeriods.reduce((s, x) => s + x.b, 0) / downPeriods.length)
    : null;

  return { sharpeRatio, sortinoRatio, treynorRatio, informationRatio, trackingError, jensensAlpha, calmarRatio, upCaptureRatio, downCaptureRatio };
}

// ─── Concentration Risk ───────────────────────────────────────────────────

export interface ConcentrationMetrics {
  herfindahlIndex: number;
  effectivePositions: number;
  topNWeight: number;
  topNSymbols: string[];
  sectorConcentration: Array<{ sector: string; weight: number }>;
}

/**
 * Herfindahl-Hirschman Index for portfolio concentration.
 * HHI = sum(w_i^2). Effective positions ≈ 1/HHI.
 */
export function computeConcentrationMetrics(
  holdings: Array<{ symbol: string; weight: number; sector?: string }>,
  topN: number = 5,
): ConcentrationMetrics {
  if (!holdings.length) {
    return { herfindahlIndex: 0, effectivePositions: 0, topNWeight: 0, topNSymbols: [], sectorConcentration: [] };
  }

  const herfindahlIndex = holdings.reduce((s, h) => s + h.weight * h.weight, 0);
  const effectivePositions = herfindahlIndex > 1e-12 ? 1 / herfindahlIndex : holdings.length;

  const sorted = [...holdings].sort((a, b) => b.weight - a.weight);
  const topNHoldings = sorted.slice(0, topN);
  const topNWeight = topNHoldings.reduce((s, h) => s + h.weight, 0);
  const topNSymbols = topNHoldings.map((h) => h.symbol);

  // Sector concentration
  const sectorWeights = new Map<string, number>();
  for (const h of holdings) {
    const sector = h.sector ?? "Unknown";
    sectorWeights.set(sector, (sectorWeights.get(sector) ?? 0) + h.weight);
  }
  const sectorConcentration = Array.from(sectorWeights.entries())
    .map(([sector, weight]) => ({ sector, weight }))
    .sort((a, b) => b.weight - a.weight);

  return { herfindahlIndex, effectivePositions, topNWeight, topNSymbols, sectorConcentration };
}

// ─── Rebalancing Engine ───────────────────────────────────────────────────

export interface RebalancingTarget {
  symbol: string;
  targetWeight: number;     // decimal
  currentWeight: number;    // decimal
  currentShares: number;
  currentPrice: number;
}

export interface RebalancingTrade {
  symbol: string;
  action: "buy" | "sell" | "hold";
  shares: number;
  notional: number;
  currentWeight: number;
  targetWeight: number;
  drift: number;           // targetWeight - currentWeight
}

export interface RebalancingResult {
  trades: RebalancingTrade[];
  totalBuyNotional: number;
  totalSellNotional: number;
  netCashFlow: number;
  maxDrift: number;
  rebalanceNeeded: boolean;
}

/**
 * Rebalancing proposal: computes trades needed to move from current
 * to target weights. driftThreshold controls the minimum drift (decimal)
 * before a trade is proposed — avoids churning on negligible differences.
 */
export function computeRebalancingProposal(
  targets: RebalancingTarget[],
  portfolioValue: number,
  driftThreshold: number = 0.01,
): RebalancingResult {
  const trades: RebalancingTrade[] = [];
  let totalBuyNotional = 0;
  let totalSellNotional = 0;
  let maxDrift = 0;

  for (const target of targets) {
    const drift = target.targetWeight - target.currentWeight;
    maxDrift = Math.max(maxDrift, Math.abs(drift));

    if (Math.abs(drift) < driftThreshold) {
      trades.push({ symbol: target.symbol, action: "hold", shares: 0, notional: 0, currentWeight: target.currentWeight, targetWeight: target.targetWeight, drift });
      continue;
    }

    const notionalChange = drift * portfolioValue;
    const sharesToTrade = target.currentPrice > 0 ? Math.round(Math.abs(notionalChange) / target.currentPrice) : 0;
    const actualNotional = sharesToTrade * target.currentPrice;

    if (drift > 0) {
      trades.push({ symbol: target.symbol, action: "buy", shares: sharesToTrade, notional: actualNotional, currentWeight: target.currentWeight, targetWeight: target.targetWeight, drift });
      totalBuyNotional += actualNotional;
    } else {
      trades.push({ symbol: target.symbol, action: "sell", shares: sharesToTrade, notional: actualNotional, currentWeight: target.currentWeight, targetWeight: target.targetWeight, drift });
      totalSellNotional += actualNotional;
    }
  }

  return {
    trades: trades.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift)),
    totalBuyNotional,
    totalSellNotional,
    netCashFlow: totalSellNotional - totalBuyNotional,
    maxDrift,
    rebalanceNeeded: maxDrift >= driftThreshold,
  };
}
