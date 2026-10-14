import { presentValueDiscreteDividends, type DiscreteDividend, type OptionGreeks } from "./optionsModels";

/**
 * Position-level options risk expressed in desk-friendly units.
 *
 * deltaShares      = equivalent underlying shares for a $1 spot move
 * gamma            = P&L curvature per $1^2 spot move
 * thetaPerDay      = currency P&L for one calendar day passing
 * vegaPerVolPoint  = currency P&L for a +1 percentage-point vol move
 * rhoPer100bp      = currency P&L for a +100bp parallel rate move
 */
export interface PositionGreekRisk {
  deltaShares: number;
  gamma: number;
  thetaPerDay: number;
  vegaPerVolPoint: number;
  rhoPer100bp: number;
  dollarDelta: number;
  gammaPnlOnePctMove: number;
}

export interface HedgePlan {
  mode: "delta" | "delta_gamma" | "delta_vega" | "delta_gamma_vega";
  hedgeContractsA: number;
  hedgeContractsB: number;
  underlyingShares: number;
  underlyingNotional: number;
  residualRisk: PositionGreekRisk;
  determinant?: number;
  warning?: string;
}

export interface GreekScenarioPnl {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  total: number;
}

export interface PutCallParityAnalysis {
  prepaidUnderlying: number;
  pvStrike: number;
  fairCallMinusPut: number;
  observedCallMinusPut: number;
  residual: number;
  residualBpsOfSpot: number;
  fairForward: number;
  syntheticImpliedForward: number;
  forwardBasis: number;
  impliedRatePct: number | null;
  status: "aligned" | "synthetic_long_rich" | "synthetic_long_cheap";
  tradeDescription: string;
}

export interface BoxSpreadAnalysis {
  lowStrike: number;
  highStrike: number;
  terminalPayoff: number;
  fairPresentValue: number;
  observedPresentValue: number;
  residual: number;
  impliedRatePct: number | null;
  status: "aligned" | "box_rich" | "box_cheap";
}

const EPS = 1e-12;

export function scaleOptionGreeks(
  greeks: OptionGreeks,
  signedContracts: number,
  contractMultiplier = 100,
  spot = 0
): PositionGreekRisk {
  const scale = signedContracts * contractMultiplier;
  const deltaShares = greeks.delta * scale;
  const gamma = greeks.gamma * scale;
  const thetaPerDay = greeks.theta * scale;
  const vegaPerVolPoint = greeks.vega * scale;
  const rhoPer100bp = greeks.rho * scale;
  const onePctMove = spot * 0.01;
  return {
    deltaShares,
    gamma,
    thetaPerDay,
    vegaPerVolPoint,
    rhoPer100bp,
    dollarDelta: deltaShares * spot,
    gammaPnlOnePctMove: 0.5 * gamma * onePctMove * onePctMove,
  };
}

export function addGreekRisk(...risks: PositionGreekRisk[]): PositionGreekRisk {
  const combined = risks.reduce(
    (acc, risk) => ({
      deltaShares: acc.deltaShares + risk.deltaShares,
      gamma: acc.gamma + risk.gamma,
      thetaPerDay: acc.thetaPerDay + risk.thetaPerDay,
      vegaPerVolPoint: acc.vegaPerVolPoint + risk.vegaPerVolPoint,
      rhoPer100bp: acc.rhoPer100bp + risk.rhoPer100bp,
      dollarDelta: acc.dollarDelta + risk.dollarDelta,
      gammaPnlOnePctMove: acc.gammaPnlOnePctMove + risk.gammaPnlOnePctMove,
    }),
    {
      deltaShares: 0,
      gamma: 0,
      thetaPerDay: 0,
      vegaPerVolPoint: 0,
      rhoPer100bp: 0,
      dollarDelta: 0,
      gammaPnlOnePctMove: 0,
    }
  );
  return combined;
}

export function applyUnderlyingDeltaHedge(risk: PositionGreekRisk, spot: number): HedgePlan {
  const underlyingShares = -risk.deltaShares;
  return {
    mode: "delta",
    hedgeContractsA: 0,
    hedgeContractsB: 0,
    underlyingShares,
    underlyingNotional: underlyingShares * spot,
    residualRisk: {
      ...risk,
      deltaShares: 0,
      dollarDelta: 0,
    },
  };
}

/**
 * Neutralize gamma OR vega with one hedge option, then neutralize the remaining
 * delta with the underlying. Hedge contract quantity is signed: positive =
 * long hedge option, negative = short hedge option.
 */
export function solveSingleOptionHedge(
  primaryRisk: PositionGreekRisk,
  hedgeGreeks: OptionGreeks,
  target: "gamma" | "vega",
  spot: number,
  hedgeContractMultiplier = 100
): HedgePlan {
  const hedgePerContract = scaleOptionGreeks(hedgeGreeks, 1, hedgeContractMultiplier, spot);
  const denominator = target === "gamma" ? hedgePerContract.gamma : hedgePerContract.vegaPerVolPoint;
  const primaryTarget = target === "gamma" ? primaryRisk.gamma : primaryRisk.vegaPerVolPoint;

  if (Math.abs(denominator) < EPS) {
    return {
      mode: target === "gamma" ? "delta_gamma" : "delta_vega",
      hedgeContractsA: 0,
      hedgeContractsB: 0,
      underlyingShares: -primaryRisk.deltaShares,
      underlyingNotional: -primaryRisk.deltaShares * spot,
      residualRisk: { ...primaryRisk, deltaShares: 0, dollarDelta: 0 },
      warning: `Selected hedge option has insufficient ${target} exposure.`,
    };
  }

  const hedgeContractsA = -primaryTarget / denominator;
  const hedgeRisk = scaleOptionGreeks(hedgeGreeks, hedgeContractsA, hedgeContractMultiplier, spot);
  const residualBeforeStock = addGreekRisk(primaryRisk, hedgeRisk);
  const underlyingShares = -residualBeforeStock.deltaShares;
  const residualRisk: PositionGreekRisk = {
    ...residualBeforeStock,
    deltaShares: 0,
    dollarDelta: 0,
  };

  return {
    mode: target === "gamma" ? "delta_gamma" : "delta_vega",
    hedgeContractsA,
    hedgeContractsB: 0,
    underlyingShares,
    underlyingNotional: underlyingShares * spot,
    residualRisk,
  };
}

/**
 * Solve a two-option hedge for gamma and vega simultaneously, then use the
 * underlying to remove the remaining delta. This is the classic three-
 * instrument local hedge: two options control curvature/volatility, stock
 * controls first-order spot exposure.
 */
export function solveDeltaGammaVegaHedge(
  primaryRisk: PositionGreekRisk,
  hedgeAGreeks: OptionGreeks,
  hedgeBGreeks: OptionGreeks,
  spot: number,
  hedgeAMultiplier = 100,
  hedgeBMultiplier = 100
): HedgePlan {
  const a = scaleOptionGreeks(hedgeAGreeks, 1, hedgeAMultiplier, spot);
  const b = scaleOptionGreeks(hedgeBGreeks, 1, hedgeBMultiplier, spot);
  const determinant = a.gamma * b.vegaPerVolPoint - b.gamma * a.vegaPerVolPoint;

  if (Math.abs(determinant) < 1e-10) {
    const fallback = applyUnderlyingDeltaHedge(primaryRisk, spot);
    return {
      ...fallback,
      mode: "delta_gamma_vega",
      determinant,
      warning: "Selected hedge options are nearly collinear in gamma/vega space. Choose different strikes or option sides.",
    };
  }

  const rhsGamma = -primaryRisk.gamma;
  const rhsVega = -primaryRisk.vegaPerVolPoint;
  const hedgeContractsA = (rhsGamma * b.vegaPerVolPoint - b.gamma * rhsVega) / determinant;
  const hedgeContractsB = (a.gamma * rhsVega - rhsGamma * a.vegaPerVolPoint) / determinant;

  const hedgeARisk = scaleOptionGreeks(hedgeAGreeks, hedgeContractsA, hedgeAMultiplier, spot);
  const hedgeBRisk = scaleOptionGreeks(hedgeBGreeks, hedgeContractsB, hedgeBMultiplier, spot);
  const residualBeforeStock = addGreekRisk(primaryRisk, hedgeARisk, hedgeBRisk);
  const underlyingShares = -residualBeforeStock.deltaShares;

  return {
    mode: "delta_gamma_vega",
    hedgeContractsA,
    hedgeContractsB,
    underlyingShares,
    underlyingNotional: underlyingShares * spot,
    determinant,
    residualRisk: {
      ...residualBeforeStock,
      deltaShares: 0,
      dollarDelta: 0,
    },
  };
}

/** Local delta-gamma-theta-vega-rho P&L approximation. */
export function approximateGreekScenarioPnl(
  risk: PositionGreekRisk,
  spot: number,
  spotShockPct: number,
  volShockPoints = 0,
  daysElapsed = 0,
  rateShockBps = 0
): GreekScenarioPnl {
  const dS = spot * (spotShockPct / 100);
  const delta = risk.deltaShares * dS;
  const gamma = 0.5 * risk.gamma * dS * dS;
  const theta = risk.thetaPerDay * daysElapsed;
  const vega = risk.vegaPerVolPoint * volShockPoints;
  const rho = risk.rhoPer100bp * (rateShockBps / 100);
  return { delta, gamma, theta, vega, rho, total: delta + gamma + theta + vega + rho };
}

/**
 * European put-call parity / synthetic-forward analysis.
 *
 * C - P = (S - PV[cash dividends])e^{-qT} - Ke^{-rT}
 *
 * A non-zero market residual is a relative-value signal, not automatically a
 * realizable arbitrage after bid/ask, stock borrow, dividends, exercise style,
 * funding, taxes and execution costs.
 */
export function analyzePutCallParity(input: {
  spot: number;
  strike: number;
  timeYears: number;
  rate: number;
  dividendYield: number;
  callPrice: number;
  putPrice: number;
  discreteDividends?: DiscreteDividend[];
  tolerance?: number;
}): PutCallParityAnalysis {
  const T = Math.max(0, input.timeYears);
  const pvDividends = presentValueDiscreteDividends(input.discreteDividends ?? [], input.rate, T);
  const adjustedSpot = Math.max(EPS, input.spot - pvDividends);
  const prepaidUnderlying = adjustedSpot * Math.exp(-input.dividendYield * T);
  const pvStrike = input.strike * Math.exp(-input.rate * T);
  const fairCallMinusPut = prepaidUnderlying - pvStrike;
  const observedCallMinusPut = input.callPrice - input.putPrice;
  const residual = observedCallMinusPut - fairCallMinusPut;
  const fairForward = T > 0 ? adjustedSpot * Math.exp((input.rate - input.dividendYield) * T) : adjustedSpot;
  const syntheticImpliedForward = T > 0 ? input.strike + observedCallMinusPut * Math.exp(input.rate * T) : input.strike + observedCallMinusPut;
  const forwardBasis = syntheticImpliedForward - fairForward;
  const impliedDiscountedStrike = prepaidUnderlying - observedCallMinusPut;
  const impliedRatePct = T > EPS && impliedDiscountedStrike > EPS
    ? (-Math.log(impliedDiscountedStrike / input.strike) / T) * 100
    : null;
  const tolerance = input.tolerance ?? Math.max(1e-6, Math.abs(input.spot) * 1e-6);

  let status: PutCallParityAnalysis["status"] = "aligned";
  let tradeDescription = "Synthetic forward is aligned with the funded forward benchmark within tolerance.";
  if (residual > tolerance) {
    status = "synthetic_long_rich";
    tradeDescription = "Synthetic long forward is rich: short call + long put is the relative-value option leg; offset with the corresponding long funded/prepaid forward exposure before costs.";
  } else if (residual < -tolerance) {
    status = "synthetic_long_cheap";
    tradeDescription = "Synthetic long forward is cheap: long call + short put is the relative-value option leg; offset with the corresponding short funded/prepaid forward exposure before costs.";
  }

  return {
    prepaidUnderlying,
    pvStrike,
    fairCallMinusPut,
    observedCallMinusPut,
    residual,
    residualBpsOfSpot: input.spot !== 0 ? (residual / input.spot) * 10_000 : 0,
    fairForward,
    syntheticImpliedForward,
    forwardBasis,
    impliedRatePct,
    status,
    tradeDescription,
  };
}

/**
 * European long-box funding identity:
 * (C(K1)-P(K1)) - (C(K2)-P(K2)) = (K2-K1)e^{-rT}, K1 < K2.
 * Dividends cancel, making the box a clean same-expiry discounting check.
 */
export function analyzeBoxSpread(input: {
  lowStrike: number;
  highStrike: number;
  callLow: number;
  putLow: number;
  callHigh: number;
  putHigh: number;
  timeYears: number;
  rate: number;
  tolerance?: number;
}): BoxSpreadAnalysis {
  if (!(input.highStrike > input.lowStrike)) {
    throw new Error("Box spread requires highStrike > lowStrike.");
  }
  const T = Math.max(0, input.timeYears);
  const terminalPayoff = input.highStrike - input.lowStrike;
  const fairPresentValue = terminalPayoff * Math.exp(-input.rate * T);
  const observedPresentValue = (input.callLow - input.putLow) - (input.callHigh - input.putHigh);
  const residual = observedPresentValue - fairPresentValue;
  const impliedRatePct = T > EPS && observedPresentValue > EPS
    ? (-Math.log(observedPresentValue / terminalPayoff) / T) * 100
    : null;
  const tolerance = input.tolerance ?? Math.max(1e-6, fairPresentValue * 1e-6);
  const status: BoxSpreadAnalysis["status"] = residual > tolerance ? "box_rich" : residual < -tolerance ? "box_cheap" : "aligned";
  return {
    lowStrike: input.lowStrike,
    highStrike: input.highStrike,
    terminalPayoff,
    fairPresentValue,
    observedPresentValue,
    residual,
    impliedRatePct,
    status,
  };
}
