/**
 * Opportunity Radar / Risk Radar composite scoring.
 *
 * Roadmap line "turn existing signals into ranked opportunities/risks" had no
 * implementation anywhere in the repo before this file. This is pure,
 * deterministic scoring math over a typed bag of REAL per-symbol signals --
 * it fetches nothing itself (server/radarRoutes.ts owns the fetching, via
 * connectors that already exist elsewhere in the app) and never invents a
 * number: every input either comes from a real, already-integrated data
 * source or is `null` when that source has no data for a symbol, in which
 * case the corresponding factor simply contributes 0 points and is marked
 * `rawValue: null` in the breakdown -- it is never backfilled with a guess.
 *
 * Real signal sources (see server/radarRoutes.ts for the exact call sites):
 *  - trailingPE, revenueGrowth, returnOnEquity, beta
 *      -> server/marketData.ts `getFundamentals()` (yfinance-backed, the
 *         same function that already powers Quote/Valuation/Peer-Comp).
 *  - price, high52, low52, changePercent
 *      -> server/marketData.ts `getQuotes()` (the same live quote feed the
 *         Screener/Watchlist/Heatmap panels already render).
 *  - newsSentimentScore / newsArticleCount
 *      -> server/marketData.ts `getNews(symbol)`, tallying the REAL
 *         per-article `sentiment` field that `inferSentiment()` already
 *         computes from live RSS feeds (the same classifier
 *         `getMarketSentiment()` uses for the market-wide sentiment gauge --
 *         this just applies it per symbol instead of in aggregate).
 *  - insiderNetValue
 *      -> server/secEdgarData.ts `getInsiderTransactions()`, net open-market
 *         (Form 4 code P/S only, excluding derivative/equity-comp rows) buy
 *         value minus sell value in the most recent filings.
 *
 * Explicitly NOT used: short interest / days-to-cover / borrow rate. The
 * only short-interest data anywhere in this repo
 * (ShortInterestPanel.tsx's `SHORT_DATA`) is a hardcoded synthetic table
 * ("Synthetic short interest data (in production: fetch from
 * Quandl/FINRA)") -- there is no real connector for it, so per the
 * anti-fabrication rule it is omitted rather than faked. Elevated realized
 * market risk is instead represented on the Risk Radar by `beta`, a real
 * fundamentals field.
 */

export interface RadarSignalInputs {
  symbol: string;

  /** Trailing P/E ratio. Real: getFundamentals().trailingPE (yfinance). */
  trailingPE: number | null;
  /** Latest trade price. Real: getQuotes()[].price. */
  price: number | null;
  /** 52-week high. Real: getQuotes()[].high52. */
  high52: number | null;
  /** 52-week low. Real: getQuotes()[].low52. */
  low52: number | null;
  /** Most recent session % price change. Real: getQuotes()[].changePercent. */
  changePercent: number | null;
  /**
   * Net sentiment of recent real news coverage, in [-1, 1]:
   * (positiveArticles - negativeArticles) / totalArticles.
   * Real: tally of getNews(symbol)[].sentiment (inferSentiment() classifier).
   */
  newsSentimentScore: number | null;
  /** Count of real news articles the sentiment score above was computed from. */
  newsArticleCount: number;
  /**
   * Net signed dollar value of open-market insider transactions (Form 4
   * codes P/S only) across the recent filings window: sum(buy value) -
   * sum(sell value). Real: getInsiderTransactions(symbol) from SEC EDGAR.
   */
  insiderNetValue: number | null;
  /** YoY revenue growth, as a fraction (0.12 = 12%). Real: getFundamentals(). */
  revenueGrowth: number | null;
  /** Return on equity, as a fraction. Real: getFundamentals(). */
  returnOnEquity: number | null;
  /** Beta vs. market (systematic volatility). Real: getFundamentals(). */
  beta: number | null;
}

export interface RadarFactorContribution {
  /** Stable machine key, e.g. "valuation". */
  key: string;
  /** Human label for the UI, e.g. "VALUATION (P/E)". */
  label: string;
  /** The real underlying value the factor was computed from (for display). Null = no data for this symbol. */
  rawValue: number | null;
  /** Normalized directional read of the raw value, in [-1, 1]. Null = no data. */
  tilt: number | null;
  /** Maximum absolute points this factor can contribute to the 0-100 score. */
  weight: number;
  /** Signed points actually applied to the score (0 when rawValue is null). */
  contribution: number;
}

export interface RadarScoreResult {
  symbol: string;
  /** 0-100 composite score. 50 = neutral (no usable signal either way). */
  score: number;
  factors: RadarFactorContribution[];
}

const BASE_SCORE = 50;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (!present.length) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

// ── Shared tilt computations ────────────────────────────────────────────
// Every tilt is normalized so +1 = most bullish/favorable extreme, -1 =
// most bearish/unfavorable extreme, 0 = neutral, null = no real data
// available for this symbol. Both scoreOpportunity and scoreRisk read the
// same tilts; they differ only in which factors they weight and in which
// direction (a bullish tilt is an opportunity point, a bearish tilt is a
// risk point).

/** Cheap (low trailing P/E) = positive tilt. PE<=10 saturates cheap, PE>=40 saturates expensive, PE=25 is neutral. */
function valuationTilt(inputs: RadarSignalInputs): number | null {
  if (inputs.trailingPE === null || inputs.trailingPE <= 0) return null;
  return clamp((25 - inputs.trailingPE) / 15, -1, 1);
}

/**
 * Momentum: average of (a) recent session % change, +-5% saturates, and
 * (b) position within the 52-week range, where sitting at the 52-week high
 * is the classic "52-week-high momentum" proxy (George & Hwang) and sitting
 * at the low is the bearish mirror. Either sub-signal may be missing.
 */
function momentumTilt(inputs: RadarSignalInputs): number | null {
  const changeTilt = inputs.changePercent === null ? null : clamp(inputs.changePercent / 5, -1, 1);
  let rangeTilt: number | null = null;
  if (
    inputs.price !== null && inputs.high52 !== null && inputs.low52 !== null &&
    inputs.high52 > inputs.low52
  ) {
    const posInRange = (inputs.price - inputs.low52) / (inputs.high52 - inputs.low52);
    rangeTilt = clamp((posInRange - 0.5) * 2, -1, 1);
  }
  return average([changeTilt, rangeTilt]);
}

/** Net positive real news coverage = positive tilt. Requires at least one article. */
function sentimentTilt(inputs: RadarSignalInputs): number | null {
  if (inputs.newsArticleCount <= 0 || inputs.newsSentimentScore === null) return null;
  return clamp(inputs.newsSentimentScore, -1, 1);
}

/** Net open-market insider buying = positive tilt. +-$1M saturates. */
function insiderTilt(inputs: RadarSignalInputs): number | null {
  if (inputs.insiderNetValue === null) return null;
  return clamp(inputs.insiderNetValue / 1_000_000, -1, 1);
}

/** Improving fundamentals (revenue growth, ROE) = positive tilt. +-20% growth / +-25% ROE saturate. */
function fundamentalsTilt(inputs: RadarSignalInputs): number | null {
  const growthTilt = inputs.revenueGrowth === null ? null : clamp(inputs.revenueGrowth / 0.20, -1, 1);
  const roeTilt = inputs.returnOnEquity === null ? null : clamp(inputs.returnOnEquity / 0.25, -1, 1);
  return average([growthTilt, roeTilt]);
}

/** Elevated systematic risk (beta above market) = positive (risky) tilt. beta=1 neutral, beta>=2.5 saturates. */
function volatilityTilt(inputs: RadarSignalInputs): number | null {
  if (inputs.beta === null) return null;
  return clamp((inputs.beta - 1) / 1.5, -1, 1);
}

interface FactorDef {
  key: string;
  label: string;
  compute: (inputs: RadarSignalInputs) => number | null;
  weight: number;
}

// Weights sum to 50 exactly, so score = clamp(50 + sum(contributions), 0, 100)
// spans the full [0, 100] range without needing to clamp in the typical case.
export const OPPORTUNITY_FACTORS: FactorDef[] = [
  { key: "valuation", label: "VALUATION (LOW P/E)", compute: valuationTilt, weight: 12 },
  { key: "momentum", label: "MOMENTUM (PRICE TREND)", compute: momentumTilt, weight: 12 },
  { key: "sentiment", label: "NEWS SENTIMENT", compute: sentimentTilt, weight: 8 },
  { key: "insider", label: "INSIDER BUYING", compute: insiderTilt, weight: 8 },
  { key: "fundamentals", label: "FUNDAMENTALS (GROWTH/ROE)", compute: fundamentalsTilt, weight: 10 },
];

export const RISK_FACTORS: FactorDef[] = [
  { key: "valuation", label: "VALUATION (HIGH P/E)", compute: valuationTilt, weight: 10 },
  { key: "momentum", label: "MOMENTUM (PRICE TREND)", compute: momentumTilt, weight: 10 },
  { key: "sentiment", label: "NEWS SENTIMENT", compute: sentimentTilt, weight: 8 },
  { key: "insider", label: "INSIDER SELLING", compute: insiderTilt, weight: 8 },
  { key: "fundamentals", label: "FUNDAMENTALS (GROWTH/ROE)", compute: fundamentalsTilt, weight: 8 },
  { key: "volatility", label: "VOLATILITY (BETA)", compute: volatilityTilt, weight: 6 },
];

function scoreFromFactors(
  inputs: RadarSignalInputs,
  factors: FactorDef[],
  direction: (key: string) => 1 | -1,
): RadarScoreResult {
  const breakdown: RadarFactorContribution[] = factors.map((factor) => {
    const tilt = factor.compute(inputs);
    const contribution = tilt === null ? 0 : factor.weight * tilt * direction(factor.key);
    return {
      key: factor.key,
      label: factor.label,
      rawValue: rawValueFor(factor.key, inputs),
      tilt,
      weight: factor.weight,
      contribution,
    };
  });
  const total = breakdown.reduce((sum, f) => sum + f.contribution, 0);
  return {
    symbol: inputs.symbol,
    score: Math.round(clamp(BASE_SCORE + total, 0, 100)),
    factors: breakdown,
  };
}

function rawValueFor(key: string, inputs: RadarSignalInputs): number | null {
  switch (key) {
    case "valuation": return inputs.trailingPE;
    case "momentum": return inputs.changePercent;
    case "sentiment": return inputs.newsArticleCount > 0 ? inputs.newsSentimentScore : null;
    case "insider": return inputs.insiderNetValue;
    case "fundamentals": return inputs.revenueGrowth ?? inputs.returnOnEquity;
    case "volatility": return inputs.beta;
    default: return null;
  }
}

/**
 * Opportunity Radar score: higher = more attractive opportunity (cheap,
 * positive momentum, positive news sentiment, net insider buying, improving
 * fundamentals). All five factors apply their bullish tilt directly.
 */
export function scoreOpportunity(inputs: RadarSignalInputs): RadarScoreResult {
  return scoreFromFactors(inputs, OPPORTUNITY_FACTORS, () => 1);
}

/**
 * Risk Radar score: higher = more risk (expensive, negative momentum,
 * negative news sentiment, net insider selling, deteriorating fundamentals,
 * elevated beta). The five factors shared with scoreOpportunity apply their
 * bearish (negated) tilt; volatility is risk-only and applies directly.
 */
export function scoreRisk(inputs: RadarSignalInputs): RadarScoreResult {
  return scoreFromFactors(inputs, RISK_FACTORS, (key) => (key === "volatility" ? 1 : -1));
}
