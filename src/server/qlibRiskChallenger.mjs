/**
 * A bounded, dependency-free adaptation of the risk_analysis mathematics in
 * microsoft/qlib, qlib/contrib/evaluate.py (MIT, Microsoft Corporation).
 * Source observation: be725493eb1a6bbb42bf11b37aa7669f59610ff1.
 *
 * This is NOT the Qlib Python runtime, a forecasting model, portfolio advice,
 * or a replacement for the canonical P11 pricing/risk engine. It is a
 * read-only numerical challenger on unverified caller-submitted returns. No market data,
 * live quote, provider, brokerage, position or persistent store is accessed.
 *
 * Qlib uses its own annualization convention (typically 238 sessions/day);
 * here annualizationSessions is mandatory, to avoid silently assuming 252.
 */
export const QLIB_RISK_CHALLENGER_SOURCE = Object.freeze({
  repository: "microsoft/qlib",
  commit: "be725493eb1a6bbb42bf11b37aa7669f59610ff1",
  originalPath: "qlib/contrib/evaluate.py",
  originalFunction: "risk_analysis",
  license: "MIT",
  implementation: "adapted_formula_not_qlib_runtime",
});

/**
 * @param {{returns:number[], annualizationSessions:number, mode:"sum"|"product"}} input
 * @returns {{method:string, inputTruth:"user_assumption", runtime:"liOS_adapted_formula", accumulation:"sum"|"product", sampleCount:number, annualizationSessions:number,
 *   mean:number, std:number, annualizedReturn:number, informationRatio:number|null, maxDrawdown:number, caveats:string[]}}
 */
export function evaluateQlibRiskChallenger(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Qlib challenger input must be an object.");
  }
  const { returns, annualizationSessions, mode } = input;
  if (!Array.isArray(returns) || returns.length < 2 || returns.length > 512) {
    throw new RangeError("Requires 2 to 512 explicitly declared period returns.");
  }
  if (!Number.isSafeInteger(annualizationSessions) || annualizationSessions < 1 || annualizationSessions > 365) {
    throw new RangeError("Annualization sessions must be a declared integer from 1 to 365.");
  }
  if (mode !== "sum" && mode !== "product") {
    throw new TypeError("Select Qlib's explicit sum or product accumulation convention.");
  }
  if (returns.some((r) => typeof r !== "number" || !Number.isFinite(r) || r <= -1 || r > 10)) {
    throw new RangeError("Returns must be finite decimal fractions greater than -1 and no greater than 10; -100% and invalid observations fail closed.");
  }

  const n = returns.length;
  let arithmetic = 0;
  for (const r of returns) arithmetic += r;
  const arithmeticMean = arithmetic / n;

  let mean;
  let volatilityInputs;
  let annualizedReturn;
  let maxDrawdown = 0;

  if (mode === "sum") {
    mean = arithmeticMean;
    volatilityInputs = returns;
    annualizedReturn = mean * annualizationSessions;
    let total = 0;
    let peak = Number.NEGATIVE_INFINITY;
    for (const r of returns) {
      total += r;
      peak = Math.max(peak, total);
      maxDrawdown = Math.min(maxDrawdown, total - peak);
    }
  } else {
    let cumulative = 1;
    let peak = Number.NEGATIVE_INFINITY;
    for (const r of returns) {
      cumulative *= 1 + r;
      if (!Number.isFinite(cumulative) || cumulative <= 0) {
        throw new RangeError("Compounded return underflow/overflow makes numerical output unavailable.");
      }
      peak = Math.max(peak, cumulative);
      maxDrawdown = Math.min(maxDrawdown, cumulative / peak - 1);
    }
    mean = Math.pow(cumulative, 1 / n) - 1;
    volatilityInputs = returns.map((r) => Math.log1p(r));
    annualizedReturn = Math.pow(cumulative, annualizationSessions / n) - 1;
  }

  const volatilityMean = volatilityInputs.reduce((acc, value) => acc + value, 0) / n;
  const sumSquares = volatilityInputs.reduce((acc, value) => acc + (value - volatilityMean) ** 2, 0);
  // Constant returns must have exactly zero variance; accumulated roundoff
  // otherwise produces a tiny std and a fabricated enormous information ratio.
  const constantSeries = volatilityInputs.every((value) => Object.is(value, volatilityInputs[0]));
  const std = constantSeries ? 0 : Math.sqrt(sumSquares / (n - 1)); // Qlib/pandas ddof=1.
  const informationRatio = std === 0 ? null : (mean / std) * Math.sqrt(annualizationSessions);
  const metrics = [mean, std, annualizedReturn, maxDrawdown, informationRatio ?? 0];
  if (metrics.some((x) => !Number.isFinite(x))) {
    throw new RangeError("Qlib challenger numerical output is not finite.");
  }
  const normalized = (value) => Object.is(value, -0) ? 0 : value;
  return {
    method: "qlib_risk_analysis_mit_adaptation_v1",
    inputTruth: "unknown",
    runtime: "liOS_adapted_formula",
    accumulation: mode,
    sampleCount: n,
    annualizationSessions,
    mean: normalized(mean),
    std: normalized(std),
    annualizedReturn: normalized(annualizedReturn),
    informationRatio: informationRatio === null ? null : normalized(informationRatio),
    maxDrawdown: normalized(maxDrawdown),
    caveats: [
      "Agent-supplied returns have no server-verified user or source origin; not observed data or point-in-time backtest evidence.",
      "Qlib accumulation differs between sum (arithmetic cumulative P&L) and product (compounded return).",
      "Information ratio is not benchmark-relative unless input returns are precomputed active returns.",
      ...(informationRatio === null ? ["Zero sample volatility: information ratio is undefined, not an infinite success."] : []),
      "Formula-challenger only; no installed Qlib runtime, model training, trade execution or independent acceptance is claimed.",
    ],
  };
}
