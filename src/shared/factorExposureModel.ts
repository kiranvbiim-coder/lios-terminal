import type { FactorDefinition, SecurityFactorExposure } from "./factorAttribution";

/**
 * Raw per-security inputs that feed the style-factor and sector-dummy
 * exposure model. Every field is nullable/optional because real market and
 * fundamentals data is frequently incomplete; the model NEVER fabricates a
 * missing value — a security lacking what a factor needs is excluded from
 * that computation (see `buildFactorExposures`'s inclusion gate).
 */
export interface SecurityRawInputs {
  securityId: string;
  sector: string;
  marketCap: number | null;
  bookValue: number | null;
  eps: number | null;
  price: number | null;
  roe: number | null;
  roa: number | null;
  netMargin: number | null;
  /** Trailing months, decimal returns, most recent last, chronological. */
  monthlyReturns: readonly number[];
  /** Precomputed trailing realized vol from daily bars; preferred volatility source when present. */
  dailyVolatilityAnnualized: number | null;
}

export const STANDARD_STYLE_FACTOR_IDS = [
  "market_beta",
  "size",
  "value",
  "momentum",
  "volatility",
  "quality",
] as const;

export interface FactorExposureModelResult {
  /** 6 style factors + one dummy factor per distinct sector actually present among INCLUDED securities. */
  factors: FactorDefinition[];
  securities: SecurityFactorExposure[];
  excluded: Array<{ securityId: string; reason: string }>;
}

const MIN_MONTHLY_RETURNS_FOR_MOMENTUM = 12;
const MIN_OVERLAP_FOR_BETA = 12;

const STYLE_FACTOR_LABELS: Record<(typeof STANDARD_STYLE_FACTOR_IDS)[number], string> = {
  market_beta: "Market Beta",
  size: "Size",
  value: "Value",
  momentum: "Momentum",
  volatility: "Volatility",
  quality: "Quality",
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Population standard deviation (denominator N), consistent with the cross-sectional z-score convention used throughout this module. */
function stdev(values: readonly number[]): number {
  const m = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * cov(security, bench) / var(bench) over the trailing overlapping window,
 * matched by trailing index position (both series chronological, most
 * recent last — we align on the tail so index -1 is the same period for
 * both series).
 */

function marketBeta(securityReturns: readonly number[], benchmarkReturns: readonly number[]): number {
  const n = Math.min(securityReturns.length, benchmarkReturns.length);
  const sec = securityReturns.slice(securityReturns.length - n);
  const bench = benchmarkReturns.slice(benchmarkReturns.length - n);
  const secMean = mean(sec);
  const benchMean = mean(bench);
  let covariance = 0;
  let varianceBench = 0;
  for (let i = 0; i < n; i++) {
    const dSec = sec[i] - secMean;
    const dBench = bench[i] - benchMean;
    covariance += dSec * dBench;
    varianceBench += dBench * dBench;
  }
  covariance /= n;
  varianceBench /= n;
  return covariance / varianceBench;
}

function compoundedReturn(returns: readonly number[]): number {
  return returns.reduce((product, r) => product * (1 + r), 1) - 1;
}

/** z-score a value against a precomputed mean/std; std below the floor collapses the whole factor to 0 for every security (documented degenerate-universe edge case). */
function zscore(value: number, m: number, s: number): number {
  if (s < 1e-9) return 0;
  return (value - m) / s;
}

interface IncludedSecurity {
  raw: SecurityRawInputs;
  marketBetaValue: number;
  sizeRaw: number;
  valueRaw: number;
  momentumRaw: number;
  volatilityRaw: number;
  roeRaw: number | null;
  roaRaw: number | null;
  netMarginRaw: number | null;
}

export function buildFactorExposures(
  inputs: readonly SecurityRawInputs[],
  benchmarkMonthlyReturns: readonly number[],
  asOf: string,
): FactorExposureModelResult {
  const excluded: Array<{ securityId: string; reason: string }> = [];
  const included: IncludedSecurity[] = [];

  for (const raw of inputs) {
    // --- Inclusion gate: each style factor's data requirement is checked independently so the
    // exclusion reason names the specific missing input, never a generic "insufficient data". ---
    const reasons: string[] = [];
    const finiteMonthly = raw.monthlyReturns.every(Number.isFinite);
    const finiteBenchmark = benchmarkMonthlyReturns.every(Number.isFinite);

    if (raw.monthlyReturns.length < MIN_MONTHLY_RETURNS_FOR_MOMENTUM) {
      reasons.push(
        `momentum requires >=${MIN_MONTHLY_RETURNS_FOR_MOMENTUM} monthlyReturns, got ${raw.monthlyReturns.length}`,
      );
    }
    if (!finiteMonthly) reasons.push("monthlyReturns must contain only finite numbers");
    if (!finiteBenchmark) reasons.push("benchmarkMonthlyReturns must contain only finite numbers");
    if (raw.marketCap == null || !Number.isFinite(raw.marketCap) || raw.marketCap <= 0) {
      reasons.push("size requires a finite positive marketCap");
    }
    const hasBookToMarket = raw.bookValue != null
      && Number.isFinite(raw.bookValue)
      && raw.bookValue > 0
      && raw.marketCap != null
      && Number.isFinite(raw.marketCap)
      && raw.marketCap > 0;
    const hasEarningsYield = raw.eps != null
      && Number.isFinite(raw.eps)
      && raw.price != null
      && Number.isFinite(raw.price)
      && raw.price > 0;
    if (!hasBookToMarket && !hasEarningsYield) {
      reasons.push(
        "value requires either (bookValue>0 and marketCap) or (eps and price>0)",
      );
    }
    if (![raw.roe, raw.roa, raw.netMargin].some((value) => value != null && Number.isFinite(value))) {
      reasons.push("quality requires at least one finite value of roe, roa, netMargin");
    }
    const overlap = Math.min(raw.monthlyReturns.length, benchmarkMonthlyReturns.length);
    if (overlap < MIN_OVERLAP_FOR_BETA) {
      reasons.push(
        `market_beta requires >=${MIN_OVERLAP_FOR_BETA} overlapping periods with benchmarkMonthlyReturns, got ${overlap}`,
      );
    } else if (finiteMonthly && finiteBenchmark) {
      const benchmarkTail = benchmarkMonthlyReturns.slice(benchmarkMonthlyReturns.length - overlap);
      const benchmarkSpread = stdev(benchmarkTail);
      if (benchmarkSpread < 1e-12) reasons.push("market_beta requires a non-constant benchmark return series");
    }

    if (reasons.length > 0) {
      excluded.push({ securityId: raw.securityId, reason: reasons.join("; ") });
      continue;
    }

    // --- Per-security raw factor values (pre cross-sectional standardization). ---
    const marketBetaValue = marketBeta(raw.monthlyReturns, benchmarkMonthlyReturns);
    const sizeRaw = Math.log(raw.marketCap as number);
    const valueRaw = hasBookToMarket
      ? (raw.bookValue as number) / (raw.marketCap as number)
      : (raw.eps as number) / (raw.price as number);
    // 12-1 momentum: compounded return over all available trailing months excluding the most recent one.
    const momentumRaw = compoundedReturn(raw.monthlyReturns.slice(0, raw.monthlyReturns.length - 1));
    const volatilityRaw =
      raw.dailyVolatilityAnnualized != null
        ? raw.dailyVolatilityAnnualized
        : stdev(raw.monthlyReturns) * Math.sqrt(12);

    included.push({
      raw,
      marketBetaValue,
      sizeRaw,
      valueRaw,
      momentumRaw,
      volatilityRaw,
      roeRaw: raw.roe,
      roaRaw: raw.roa,
      netMarginRaw: raw.netMargin,
    });
  }

  // --- Cross-sectional standardization over the FINAL included-security set. ---
  const sizeStats = { m: mean(included.map(s => s.sizeRaw)), s: stdev(included.map(s => s.sizeRaw)) };
  const valueStats = { m: mean(included.map(s => s.valueRaw)), s: stdev(included.map(s => s.valueRaw)) };
  const momentumStats = { m: mean(included.map(s => s.momentumRaw)), s: stdev(included.map(s => s.momentumRaw)) };
  const volatilityStats = {
    m: mean(included.map(s => s.volatilityRaw)),
    s: stdev(included.map(s => s.volatilityRaw)),
  };

  const roeValues = included.filter(s => s.roeRaw != null).map(s => s.roeRaw as number);
  const roaValues = included.filter(s => s.roaRaw != null).map(s => s.roaRaw as number);
  const netMarginValues = included.filter(s => s.netMarginRaw != null).map(s => s.netMarginRaw as number);
  const roeStats = { m: mean(roeValues), s: stdev(roeValues) };
  const roaStats = { m: mean(roaValues), s: stdev(roaValues) };
  const netMarginStats = { m: mean(netMarginValues), s: stdev(netMarginValues) };

  const sectorsPresent = new Set<string>();
  const securities: SecurityFactorExposure[] = included.map(s => {
    const exposures: Record<string, number> = {
      market_beta: s.marketBetaValue,
      size: zscore(s.sizeRaw, sizeStats.m, sizeStats.s),
      value: zscore(s.valueRaw, valueStats.m, valueStats.s),
      momentum: zscore(s.momentumRaw, momentumStats.m, momentumStats.s),
      volatility: zscore(s.volatilityRaw, volatilityStats.m, volatilityStats.s),
    };

    // Quality is a composite: mean of the z-scored sub-metrics that are actually available for
    // this security (not a raw average of raw-unit roe/roa/netMargin).
    const qualityZScores: number[] = [];
    if (s.roeRaw != null) qualityZScores.push(zscore(s.roeRaw, roeStats.m, roeStats.s));
    if (s.roaRaw != null) qualityZScores.push(zscore(s.roaRaw, roaStats.m, roaStats.s));
    if (s.netMarginRaw != null) qualityZScores.push(zscore(s.netMarginRaw, netMarginStats.m, netMarginStats.s));
    exposures.quality = mean(qualityZScores);

    const sectorSlug = slug(s.raw.sector);
    sectorsPresent.add(s.raw.sector);
    exposures[`sector_${sectorSlug}`] = 1;

    return {
      securityId: s.raw.securityId,
      exposures,
      sector: s.raw.sector,
      source:
        "Derived from OLS beta vs. benchmark, log market cap, book-to-market/earnings-yield, " +
        "12-1 compounded momentum, realized volatility, and z-scored ROE/ROA/net-margin composite quality, " +
        "cross-sectionally standardized across the included universe.",
      asOf,
      status: "derived",
      units: "z-score (market_beta in beta units; sector dummies are 0/1)",
    };
  });

  const styleFactors: FactorDefinition[] = STANDARD_STYLE_FACTOR_IDS.map(id => ({
    id,
    label: STYLE_FACTOR_LABELS[id],
    source: "Derived style factor definition from cross-sectional exposure model.",
    asOf,
    status: "derived",
    units: id === "market_beta" ? "beta" : "z-score",
  }));

  const sectorFactors: FactorDefinition[] = Array.from(sectorsPresent)
    .sort()
    .map(sector => ({
      id: `sector_${slug(sector)}`,
      label: sector,
      source: "Derived sector dummy factor from securities' reported sector classification.",
      asOf,
      status: "derived",
      units: "dummy (0/1)",
    }));

  return {
    factors: [...styleFactors, ...sectorFactors],
    securities,
    excluded,
  };
}
