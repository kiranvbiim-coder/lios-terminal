/**
 * Derivatives engines: futures pricing, interest rate swap valuation,
 * option strategy payoff engine, and futures roll/carry analysis.
 * These complement the existing BSM/American options pricing in
 * optionsModels.ts and SABR/Heston in the Python sidecar.
 *
 * All functions are deterministic and pure.
 */

// ─── Futures Pricing ──────────────────────────────────────────────────────

export interface FuturesPricingInputs {
  spotPrice: number;
  riskFreeRate: number;      // decimal
  timeToExpiry: number;      // years
  storageCosPct?: number;    // decimal, annualized (commodities)
  convenienceYieldPct?: number; // decimal, annualized (commodities)
  dividendYield?: number;    // decimal (equity index futures)
}

export interface FuturesPricingResult {
  theoreticalPrice: number;
  basisPoints: number;        // (futures - spot) / spot × 10000
  carryReturn: number;        // annualized carry, decimal
  rollYield: number;          // (spot - futures) / futures, annualized
  costOfCarry: number;        // decimal, annualized
}

/**
 * Cost-of-carry futures pricing:
 * F = S × e^((r + c - y) × T)
 * where r = risk-free, c = storage, y = convenience yield or dividend yield
 */
export function priceFutures(inputs: FuturesPricingInputs): FuturesPricingResult {
  const { spotPrice, riskFreeRate, timeToExpiry } = inputs;
  const storage = inputs.storageCosPct ?? 0;
  const convenience = inputs.convenienceYieldPct ?? 0;
  const divYield = inputs.dividendYield ?? 0;

  const costOfCarry = riskFreeRate + storage - convenience - divYield;
  const theoreticalPrice = spotPrice * Math.exp(costOfCarry * timeToExpiry);
  const basis = spotPrice > 0 ? (theoreticalPrice - spotPrice) / spotPrice * 10_000 : 0;
  const rollYield = theoreticalPrice > 0 ? (spotPrice - theoreticalPrice) / theoreticalPrice / Math.max(timeToExpiry, 1e-6) : 0;

  return {
    theoreticalPrice,
    basisPoints: basis,
    carryReturn: costOfCarry,
    rollYield,
    costOfCarry,
  };
}

// ─── Futures Term Structure ───────────────────────────────────────────────

export interface FuturesContract {
  expiry: string;          // ISO date
  price: number;
  timeToExpiry: number;    // years
}

export interface FuturesTermStructure {
  contracts: FuturesContract[];
  spotPrice: number;
  structure: "contango" | "backwardation" | "flat";
  impliedConvenienceYield: number; // from front month
  rollYieldAnnualized: number;
}

export function analyzeFuturesTermStructure(spotPrice: number, contracts: FuturesContract[], riskFreeRate: number): FuturesTermStructure {
  const sorted = [...contracts].sort((a, b) => a.timeToExpiry - b.timeToExpiry);
  if (sorted.length === 0) {
    return { contracts: sorted, spotPrice, structure: "flat", impliedConvenienceYield: 0, rollYieldAnnualized: 0 };
  }

  const front = sorted[0];
  const structure = front.price > spotPrice * 1.001 ? "contango" : front.price < spotPrice * 0.999 ? "backwardation" : "flat";

  // Implied convenience yield from front month: y = r - ln(F/S)/T
  const impliedConvenienceYield = front.timeToExpiry > 0.01
    ? riskFreeRate - Math.log(front.price / spotPrice) / front.timeToExpiry
    : 0;

  const rollYieldAnnualized = front.timeToExpiry > 0.01 && front.price > 0
    ? (spotPrice - front.price) / front.price / front.timeToExpiry
    : 0;

  return { contracts: sorted, spotPrice, structure, impliedConvenienceYield, rollYieldAnnualized };
}

// ─── Interest Rate Swap ───────────────────────────────────────────────────

export interface SwapInputs {
  notional: number;
  fixedRate: number;         // decimal
  floatingRates: number[];   // decimal, one per period
  frequency: number;         // periods per year (1, 2, 4)
  remainingPeriods: number;
  discountRate: number;      // decimal, flat discount
}

export interface SwapResult {
  fixedLegPV: number;
  floatingLegPV: number;
  swapValueToFixedPayer: number;  // positive = fixed payer benefits
  swapValueToFloatingPayer: number;
  dv01: number;              // PV change for 1bp rate shift
  fixedLegCashflows: number[];
  floatingLegCashflows: number[];
}

/**
 * Plain vanilla interest rate swap valuation.
 * Fixed payer pays fixedRate, receives floating.
 * Value to fixed payer = PV(floating leg) - PV(fixed leg).
 */
export function valueSwap(inputs: SwapInputs): SwapResult {
  const { notional, fixedRate, floatingRates, frequency, remainingPeriods, discountRate } = inputs;
  const dt = 1 / frequency;
  const n = Math.min(remainingPeriods, floatingRates.length);

  let fixedLegPV = 0;
  let floatingLegPV = 0;
  const fixedLegCashflows: number[] = [];
  const floatingLegCashflows: number[] = [];

  for (let i = 0; i < n; i++) {
    const t = (i + 1) * dt;
    const df = 1 / Math.pow(1 + discountRate / frequency, i + 1);

    const fixedCF = notional * fixedRate * dt;
    const floatingCF = notional * floatingRates[i] * dt;

    fixedLegCashflows.push(fixedCF);
    floatingLegCashflows.push(floatingCF);

    fixedLegPV += fixedCF * df;
    floatingLegPV += floatingCF * df;
  }

  const swapValueToFixedPayer = floatingLegPV - fixedLegPV;

  // DV01: shift discount rate by 1bp
  const bpShift = 0.0001;
  let fixedPVUp = 0;
  let floatingPVUp = 0;
  for (let i = 0; i < n; i++) {
    const df = 1 / Math.pow(1 + (discountRate + bpShift) / frequency, i + 1);
    fixedPVUp += fixedLegCashflows[i] * df;
    floatingPVUp += floatingLegCashflows[i] * df;
  }
  const valueUp = floatingPVUp - fixedPVUp;
  const dv01 = Math.abs(swapValueToFixedPayer - valueUp);

  return {
    fixedLegPV,
    floatingLegPV,
    swapValueToFixedPayer,
    swapValueToFloatingPayer: -swapValueToFixedPayer,
    dv01,
    fixedLegCashflows,
    floatingLegCashflows,
  };
}

// ─── Options Strategy Payoff Engine ───────────────────────────────────────

export type OptionLegType = "call" | "put";
export type LegDirection = "long" | "short";

export interface StrategyLeg {
  type: OptionLegType;
  direction: LegDirection;
  strike: number;
  premium: number;         // per share
  quantity: number;        // number of contracts (×100 shares each)
}

export interface StrategyPayoffPoint {
  underlyingPrice: number;
  payoff: number;          // total P&L at this price
  legPayoffs: number[];    // individual leg P&L
}

export interface StrategyAnalysis {
  name: string;
  legs: StrategyLeg[];
  payoffCurve: StrategyPayoffPoint[];
  maxProfit: number | null;    // null = unlimited
  maxLoss: number | null;      // null = unlimited
  breakevens: number[];
  netPremium: number;          // positive = net credit, negative = net debit
}

/**
 * Options strategy payoff engine. Computes P&L at expiration across
 * a range of underlying prices. Supports any combination of call/put
 * legs in long/short directions.
 */
export function analyzeStrategy(
  name: string,
  legs: StrategyLeg[],
  spotPrice: number,
  priceRange?: { min: number; max: number; steps: number },
): StrategyAnalysis {
  const range = priceRange ?? {
    min: spotPrice * 0.5,
    max: spotPrice * 1.5,
    steps: 100,
  };

  const step = (range.max - range.min) / range.steps;
  const payoffCurve: StrategyPayoffPoint[] = [];

  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  const netPremium = legs.reduce((sum, leg) => {
    const multiplier = leg.direction === "long" ? -1 : 1;
    return sum + multiplier * leg.premium * leg.quantity * 100;
  }, 0);

  for (let i = 0; i <= range.steps; i++) {
    const price = range.min + i * step;
    const legPayoffs: number[] = [];
    let totalPayoff = 0;

    for (const leg of legs) {
      const intrinsic = leg.type === "call"
        ? Math.max(0, price - leg.strike)
        : Math.max(0, leg.strike - price);

      const multiplier = leg.direction === "long" ? 1 : -1;
      const legPL = (multiplier * intrinsic - (leg.direction === "long" ? leg.premium : -leg.premium)) * leg.quantity * 100;

      legPayoffs.push(legPL);
      totalPayoff += legPL;
    }

    payoffCurve.push({ underlyingPrice: price, payoff: totalPayoff, legPayoffs });
    maxProfit = Math.max(maxProfit, totalPayoff);
    maxLoss = Math.min(maxLoss, totalPayoff);
  }

  // Find breakevens (sign changes)
  const breakevens: number[] = [];
  for (let i = 1; i < payoffCurve.length; i++) {
    const prev = payoffCurve[i - 1].payoff;
    const curr = payoffCurve[i].payoff;
    if ((prev < 0 && curr >= 0) || (prev >= 0 && curr < 0)) {
      // Linear interpolation
      const t = Math.abs(prev) / (Math.abs(prev) + Math.abs(curr));
      breakevens.push(payoffCurve[i - 1].underlyingPrice + t * step);
    }
  }

  return {
    name,
    legs,
    payoffCurve,
    maxProfit: maxProfit === Infinity ? null : maxProfit,
    maxLoss: maxLoss === -Infinity ? null : maxLoss,
    breakevens,
    netPremium,
  };
}

// ─── Pre-built Strategy Templates ─────────────────────────────────────────

export function buildBullCallSpread(spotPrice: number, lowerStrike: number, upperStrike: number, lowerPremium: number, upperPremium: number): StrategyAnalysis {
  return analyzeStrategy("Bull Call Spread", [
    { type: "call", direction: "long", strike: lowerStrike, premium: lowerPremium, quantity: 1 },
    { type: "call", direction: "short", strike: upperStrike, premium: upperPremium, quantity: 1 },
  ], spotPrice);
}

export function buildProtectivePut(spotPrice: number, strike: number, putPremium: number, sharesHeld: number): StrategyAnalysis {
  return analyzeStrategy("Protective Put", [
    { type: "put", direction: "long", strike, premium: putPremium, quantity: Math.ceil(sharesHeld / 100) },
  ], spotPrice);
}

export function buildIronCondor(spotPrice: number, putLower: number, putUpper: number, callLower: number, callUpper: number, premiums: [number, number, number, number]): StrategyAnalysis {
  return analyzeStrategy("Iron Condor", [
    { type: "put", direction: "long", strike: putLower, premium: premiums[0], quantity: 1 },
    { type: "put", direction: "short", strike: putUpper, premium: premiums[1], quantity: 1 },
    { type: "call", direction: "short", strike: callLower, premium: premiums[2], quantity: 1 },
    { type: "call", direction: "long", strike: callUpper, premium: premiums[3], quantity: 1 },
  ], spotPrice);
}

export function buildStraddle(spotPrice: number, strike: number, callPremium: number, putPremium: number): StrategyAnalysis {
  return analyzeStrategy("Long Straddle", [
    { type: "call", direction: "long", strike, premium: callPremium, quantity: 1 },
    { type: "put", direction: "long", strike, premium: putPremium, quantity: 1 },
  ], spotPrice);
}
