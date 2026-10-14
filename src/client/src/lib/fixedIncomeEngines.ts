/**
 * Fixed income engines: yield curve bootstrapping, spread analysis,
 * curve scenarios, and credit probability-of-default models. These
 * complement the existing QuantLib bond pricer (Python sidecar) and
 * Nelson-Siegel/Svensson curve fitting (quantModels.ts).
 *
 * All functions are deterministic and pure.
 */

// ─── Yield Curve Bootstrapping ────────────────────────────────────────────

export interface MarketInstrument {
  maturity: number;       // years
  couponRate: number;     // decimal (0.05 = 5%)
  price: number;          // per 100 face
  frequency: number;      // 1=annual, 2=semi
  instrumentType: "zero" | "coupon_bond" | "swap_rate";
}

export interface BootstrappedPoint {
  maturity: number;
  spotRate: number;        // continuously compounded, decimal
  discountFactor: number;
  zeroRate: number;        // annual compounding, decimal
  forwardRate: number;     // instantaneous forward rate to next point
}

export interface BootstrappedCurve {
  points: BootstrappedPoint[];
  method: "bootstrap";
  asOf: string;
}

/**
 * Bootstrap a spot rate curve from market instruments.
 * Uses iterative stripping: shortest maturity first, each new instrument
 * uses previously bootstrapped discount factors for intermediate coupons.
 */
export function bootstrapYieldCurve(instruments: MarketInstrument[], asOf: string = new Date().toISOString()): BootstrappedCurve {
  const sorted = [...instruments].sort((a, b) => a.maturity - b.maturity);
  const points: BootstrappedPoint[] = [];
  const dfMap = new Map<number, number>(); // maturity → discount factor

  for (const inst of sorted) {
    let spotRate: number;

    if (inst.instrumentType === "zero" || inst.couponRate === 0) {
      // Zero coupon: DF = price/100
      const df = inst.price / 100;
      spotRate = -Math.log(df) / inst.maturity;
      dfMap.set(inst.maturity, df);
    } else {
      // Coupon bond: strip intermediate coupons using known DFs
      const periodsPerYear = inst.frequency;
      const dt = 1 / periodsPerYear;
      const couponPerPeriod = inst.couponRate * 100 / periodsPerYear;
      const totalPeriods = Math.round(inst.maturity * periodsPerYear);

      let pvCoupons = 0;
      for (let i = 1; i < totalPeriods; i++) {
        const t = i * dt;
        // Interpolate DF from existing points
        const df = interpolateDF(t, points);
        pvCoupons += couponPerPeriod * df;
      }

      // Last period: coupon + principal
      const lastDF = (inst.price - pvCoupons) / (couponPerPeriod + 100);
      spotRate = -Math.log(Math.max(lastDF, 1e-10)) / inst.maturity;
      dfMap.set(inst.maturity, lastDF);
    }

    const df = Math.exp(-spotRate * inst.maturity);
    const zeroRate = Math.pow(1 / df, 1 / inst.maturity) - 1;

    // Forward rate from previous point
    const prev = points.length > 0 ? points[points.length - 1] : null;
    const forwardRate = prev
      ? (spotRate * inst.maturity - prev.spotRate * prev.maturity) / (inst.maturity - prev.maturity)
      : spotRate;

    points.push({ maturity: inst.maturity, spotRate, discountFactor: df, zeroRate, forwardRate: Math.max(0, forwardRate) });
  }

  return { points, method: "bootstrap", asOf };
}

function interpolateDF(t: number, points: BootstrappedPoint[]): number {
  if (points.length === 0) return 1;
  if (t <= points[0].maturity) return Math.exp(-points[0].spotRate * t);
  if (t >= points[points.length - 1].maturity) return Math.exp(-points[points.length - 1].spotRate * t);

  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].maturity) {
      const t0 = points[i - 1].maturity;
      const t1 = points[i].maturity;
      const r0 = points[i - 1].spotRate;
      const r1 = points[i].spotRate;
      const r = r0 + (r1 - r0) * (t - t0) / (t1 - t0);
      return Math.exp(-r * t);
    }
  }
  return Math.exp(-points[points.length - 1].spotRate * t);
}

// ─── Spread Analysis ──────────────────────────────────────────────────────

export interface SpreadAnalysisInputs {
  bondYield: number;        // decimal
  benchmarkYield: number;   // decimal (risk-free or swap rate)
  bondPrice: number;        // per 100 face
  couponRate: number;       // decimal
  maturity: number;         // years
  frequency: number;        // 1 or 2
  recoveryRate?: number;    // decimal, default 0.40
}

export interface SpreadAnalysisResult {
  nominalSpread: number;       // yield - benchmark, bps
  zSpread: number;             // parallel shift to benchmark curve, bps
  creditSpread: number;        // approximated credit component, bps
  impliedProbOfDefault: number; // decimal, from spread
  spreadDuration: number;      // sensitivity to 1bp spread change
}

/**
 * Bond spread analysis. Nominal spread is trivial; Z-spread is the
 * parallel shift to a flat benchmark curve that reprices the bond.
 * Credit spread uses the recovery-adjusted approach.
 */
export function computeSpreadAnalysis(inputs: SpreadAnalysisInputs): SpreadAnalysisResult {
  const { bondYield, benchmarkYield, bondPrice, couponRate, maturity, frequency } = inputs;
  const recovery = inputs.recoveryRate ?? 0.40;

  // Nominal spread (bps)
  const nominalSpread = (bondYield - benchmarkYield) * 10_000;

  // Z-spread: find z such that sum(CF/(1+r_bench+z)^t) = price
  // Use Newton-Raphson on a flat benchmark
  let z = bondYield - benchmarkYield; // initial guess
  const dt = 1 / frequency;
  const couponPerPeriod = couponRate * 100 / frequency;
  const totalPeriods = Math.round(maturity * frequency);

  for (let iter = 0; iter < 100; iter++) {
    let pv = 0;
    let dpv = 0;
    for (let i = 1; i <= totalPeriods; i++) {
      const t = i * dt;
      const disc = Math.pow(1 + (benchmarkYield + z) / frequency, -i);
      const cf = i === totalPeriods ? couponPerPeriod + 100 : couponPerPeriod;
      pv += cf * disc;
      dpv -= t * cf * disc / (1 + (benchmarkYield + z) / frequency);
    }
    const f = pv - bondPrice;
    if (Math.abs(f) < 1e-8) break;
    if (Math.abs(dpv) < 1e-14) break;
    z -= f / dpv;
  }
  const zSpread = z * 10_000;

  // Implied probability of default (reduced-form, annual)
  // spread ≈ PD × (1 - recovery) → PD = spread / (1 - recovery)
  const creditSpreadDecimal = Math.max(0, z);
  const impliedProbOfDefault = (1 - recovery) > 1e-10 ? creditSpreadDecimal / (1 - recovery) : 0;
  const creditSpread = creditSpreadDecimal * 10_000;

  // Spread duration: ΔP / P for 1bp spread change
  const bpShift = 0.0001;
  let pvUp = 0;
  let pvDown = 0;
  for (let i = 1; i <= totalPeriods; i++) {
    const cf = i === totalPeriods ? couponPerPeriod + 100 : couponPerPeriod;
    pvUp += cf / Math.pow(1 + (bondYield + bpShift) / frequency, i);
    pvDown += cf / Math.pow(1 + (bondYield - bpShift) / frequency, i);
  }
  const spreadDuration = (pvDown - pvUp) / (2 * bpShift * bondPrice);

  return {
    nominalSpread,
    zSpread,
    creditSpread,
    impliedProbOfDefault: Math.max(0, Math.min(impliedProbOfDefault, 1)),
    spreadDuration,
  };
}

// ─── Curve Scenario Engine ────────────────────────────────────────────────

export type CurveScenarioType = "parallel_shift" | "twist" | "butterfly";

export interface CurveScenarioInputs {
  basePoints: Array<{ maturity: number; yield: number }>;
  scenarioType: CurveScenarioType;
  /** Parallel: uniform shift in bps. Twist: short-end vs long-end. Butterfly: belly vs wings. */
  shiftBps: number;
  pivotMaturity?: number;   // for twist/butterfly
}

export interface CurveScenarioResult {
  scenarioType: CurveScenarioType;
  shiftBps: number;
  basePoints: Array<{ maturity: number; yield: number }>;
  shiftedPoints: Array<{ maturity: number; yield: number; shiftBps: number }>;
}

/**
 * Apply a scenario to a yield curve. Three types:
 * - Parallel: uniform shift across all maturities
 * - Twist: short end moves by +shiftBps, long end by -shiftBps (steepening)
 * - Butterfly: wings move by +shiftBps, belly by -shiftBps
 */
export function applyCurveScenario(inputs: CurveScenarioInputs): CurveScenarioResult {
  const { basePoints, scenarioType, shiftBps } = inputs;
  const pivot = inputs.pivotMaturity ?? 5;
  const maxMat = Math.max(...basePoints.map((p) => p.maturity), 1);

  const shiftedPoints = basePoints.map((point) => {
    let bpShift: number;

    switch (scenarioType) {
      case "parallel_shift":
        bpShift = shiftBps;
        break;
      case "twist": {
        // Linear interpolation: short end gets +shift, long end gets -shift
        const position = (point.maturity - pivot) / Math.max(maxMat - pivot, 1);
        bpShift = shiftBps * (1 - 2 * Math.max(0, Math.min(1, (point.maturity / maxMat))));
        break;
      }
      case "butterfly": {
        // Belly gets -shift, wings get +shift
        const distFromPivot = Math.abs(point.maturity - pivot) / Math.max(maxMat / 2, 1);
        bpShift = shiftBps * (distFromPivot > 0.5 ? 1 : -1);
        break;
      }
    }

    return {
      maturity: point.maturity,
      yield: point.yield + bpShift / 10_000,
      shiftBps: bpShift,
    };
  });

  return { scenarioType, shiftBps, basePoints, shiftedPoints };
}

// ─── Credit Risk Models ───────────────────────────────────────────────────

export interface CreditTransitionInputs {
  currentRating: string;
  horizonYears: number;
  /** Annual transition matrix: transitionMatrix[from][to] = probability */
  transitionMatrix: Record<string, Record<string, number>>;
}

export interface CreditTransitionResult {
  currentRating: string;
  horizonYears: number;
  upgradeProbability: number;
  downgradeProbability: number;
  defaultProbability: number;
  stayProbability: number;
  expectedRating: string;
  transitions: Array<{ toRating: string; probability: number }>;
}

const RATING_ORDER = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "D"];

/**
 * Credit transition analysis using a Markov transition matrix.
 * Computes upgrade/downgrade/default probabilities over the horizon.
 */
export function computeCreditTransition(inputs: CreditTransitionInputs): CreditTransitionResult {
  const { currentRating, horizonYears, transitionMatrix } = inputs;
  const row = transitionMatrix[currentRating];
  if (!row) {
    return { currentRating, horizonYears, upgradeProbability: 0, downgradeProbability: 0, defaultProbability: 0, stayProbability: 1, expectedRating: currentRating, transitions: [] };
  }

  const currentIdx = RATING_ORDER.indexOf(currentRating);
  let upgradeProbability = 0;
  let downgradeProbability = 0;
  let defaultProbability = 0;
  let stayProbability = 0;
  let bestProb = 0;
  let expectedRating = currentRating;
  const transitions: Array<{ toRating: string; probability: number }> = [];

  for (const [toRating, annualProb] of Object.entries(row)) {
    // Multi-year: approximate with (1 - (1-p)^n) for default, p^n for stay
    const prob = toRating === currentRating
      ? Math.pow(annualProb, horizonYears)
      : 1 - Math.pow(1 - annualProb, horizonYears);

    const toIdx = RATING_ORDER.indexOf(toRating);

    if (toRating === currentRating) {
      stayProbability = prob;
    } else if (toRating === "D") {
      defaultProbability = prob;
    } else if (toIdx >= 0 && currentIdx >= 0 && toIdx < currentIdx) {
      upgradeProbability += prob;
    } else {
      downgradeProbability += prob;
    }

    if (prob > bestProb && toRating !== "D") {
      bestProb = prob;
      expectedRating = toRating;
    }

    transitions.push({ toRating, probability: prob });
  }

  return { currentRating, horizonYears, upgradeProbability, downgradeProbability, defaultProbability, stayProbability, expectedRating, transitions };
}

// ─── Recovery-Adjusted Expected Loss ──────────────────────────────────────

export interface ExpectedLossInputs {
  exposure: number;        // current exposure amount
  probabilityOfDefault: number; // decimal
  lossGivenDefault: number;     // decimal (1 - recovery rate)
}

export interface ExpectedLossResult {
  expectedLoss: number;
  unexpectedLoss: number;  // simplified: EL × sqrt(PD × (1-PD)) / PD
  creditVaR99: number;     // 99th percentile one-factor Vasicek approximation
}

/**
 * Expected loss = EAD × PD × LGD.
 * Unexpected loss and Credit VaR use simplified one-factor approximations.
 */
export function computeExpectedLoss(inputs: ExpectedLossInputs): ExpectedLossResult {
  const { exposure, probabilityOfDefault: pd, lossGivenDefault: lgd } = inputs;
  const expectedLoss = exposure * pd * lgd;

  // Simplified UL: standard deviation of loss
  const ul = pd > 1e-10 ? expectedLoss * Math.sqrt((1 - pd) / pd) : 0;

  // Vasicek one-factor 99% VaR approximation
  // Using correlation ρ ≈ 0.15 (Basel average)
  const rho = 0.15;
  const normInv99 = 2.326; // Φ^(-1)(0.99)
  const normInvPd = pd > 1e-10 && pd < 1 ? -2.326 * (pd < 0.5 ? 1 : -1) * Math.sqrt(Math.abs(Math.log(pd * (1 - pd)))) : 0;
  // Simplified: CVaR ≈ LGD × Φ((Φ^(-1)(PD) + √ρ × Φ^(-1)(0.99)) / √(1-ρ))
  // For a rough approximation:
  const creditVaR99 = exposure * lgd * Math.min(1, pd * (1 + normInv99 * Math.sqrt(rho / (1 - rho))));

  return { expectedLoss, unexpectedLoss: ul, creditVaR99 };
}
