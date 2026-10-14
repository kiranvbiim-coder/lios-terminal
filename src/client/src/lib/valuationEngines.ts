/**
 * Advanced valuation engines: Residual Income, EVA, Implied Analysis,
 * and Valuation Bridge. These complement the existing DCF/LBO/WACC/
 * terminal-value/FCFF-FCFE/EV-bridge in valuationModels.ts.
 *
 * All functions are deterministic and pure — they take numbers in,
 * return numbers out, with no provider or AI dependency.
 */

// ─── Residual Income Model ────────────────────────────────────────────────

export interface ResidualIncomeInputs {
  bookValueOfEquity: number;
  costOfEquity: number;        // decimal (0.10 = 10%)
  forecastNetIncome: number[]; // per-year net income forecasts
  forecastBookValue: number[]; // per-year ending book value (same length)
  terminalGrowth: number;      // decimal (0.02 = 2%)
}

export interface ResidualIncomeResult {
  intrinsicValue: number;
  residualIncomes: number[];
  pvResidualIncomes: number[];
  terminalResidualIncome: number;
  pvTerminalValue: number;
  currentBookValue: number;
}

/**
 * Residual Income Model: equity value = book value + PV(excess returns).
 * Excess return = net income - (cost of equity × beginning book value).
 * Terminal value uses Gordon growth on the last residual income.
 */
export function computeResidualIncome(inputs: ResidualIncomeInputs): ResidualIncomeResult {
  const { bookValueOfEquity, costOfEquity, forecastNetIncome, forecastBookValue, terminalGrowth } = inputs;
  const n = forecastNetIncome.length;
  if (n === 0 || n !== forecastBookValue.length) {
    return { intrinsicValue: bookValueOfEquity, residualIncomes: [], pvResidualIncomes: [], terminalResidualIncome: 0, pvTerminalValue: 0, currentBookValue: bookValueOfEquity };
  }

  const residualIncomes: number[] = [];
  const pvResidualIncomes: number[] = [];
  let beginningBV = bookValueOfEquity;

  for (let t = 0; t < n; t++) {
    const equityCharge = costOfEquity * beginningBV;
    const ri = forecastNetIncome[t] - equityCharge;
    residualIncomes.push(ri);
    pvResidualIncomes.push(ri / Math.pow(1 + costOfEquity, t + 1));
    beginningBV = forecastBookValue[t];
  }

  const lastRI = residualIncomes[n - 1];
  const terminalResidualIncome = costOfEquity > terminalGrowth && lastRI !== 0
    ? (lastRI * (1 + terminalGrowth)) / (costOfEquity - terminalGrowth)
    : 0;
  const pvTerminalValue = terminalResidualIncome / Math.pow(1 + costOfEquity, n);

  const sumPvRI = pvResidualIncomes.reduce((s, v) => s + v, 0);
  const intrinsicValue = bookValueOfEquity + sumPvRI + pvTerminalValue;

  return { intrinsicValue, residualIncomes, pvResidualIncomes, terminalResidualIncome, pvTerminalValue, currentBookValue: bookValueOfEquity };
}

// ─── Economic Value Added (EVA) ───────────────────────────────────────────

export interface EvaInputs {
  investedCapital: number;
  nopat: number;               // net operating profit after tax
  wacc: number;                // decimal (0.10 = 10%)
  forecastNopat: number[];     // per-year NOPAT forecasts
  forecastInvestedCapital: number[]; // per-year ending invested capital
  terminalGrowth: number;      // decimal
}

export interface EvaResult {
  marketValueAdded: number;
  intrinsicEnterpriseValue: number;
  evaPerPeriod: number[];
  pvEva: number[];
  terminalEva: number;
  pvTerminalValue: number;
  currentEva: number;
  currentSpread: number;       // ROIC - WACC
}

/**
 * EVA Model: EV = invested capital + PV(future EVA).
 * EVA = NOPAT - (WACC × beginning invested capital).
 * Positive EVA = creating shareholder value; negative = destroying it.
 */
export function computeEva(inputs: EvaInputs): EvaResult {
  const { investedCapital, nopat, wacc, forecastNopat, forecastInvestedCapital, terminalGrowth } = inputs;
  const n = forecastNopat.length;

  const currentRoic = investedCapital > 0 ? nopat / investedCapital : 0;
  const currentSpread = currentRoic - wacc;
  const currentEva = nopat - wacc * investedCapital;

  if (n === 0 || n !== forecastInvestedCapital.length) {
    return { marketValueAdded: 0, intrinsicEnterpriseValue: investedCapital, evaPerPeriod: [], pvEva: [], terminalEva: 0, pvTerminalValue: 0, currentEva, currentSpread };
  }

  const evaPerPeriod: number[] = [];
  const pvEva: number[] = [];
  let beginningIC = investedCapital;

  for (let t = 0; t < n; t++) {
    const capitalCharge = wacc * beginningIC;
    const eva = forecastNopat[t] - capitalCharge;
    evaPerPeriod.push(eva);
    pvEva.push(eva / Math.pow(1 + wacc, t + 1));
    beginningIC = forecastInvestedCapital[t];
  }

  const lastEva = evaPerPeriod[n - 1];
  const terminalEva = wacc > terminalGrowth && lastEva !== 0
    ? (lastEva * (1 + terminalGrowth)) / (wacc - terminalGrowth)
    : 0;
  const pvTerminalValue = terminalEva / Math.pow(1 + wacc, n);

  const sumPvEva = pvEva.reduce((s, v) => s + v, 0);
  const marketValueAdded = sumPvEva + pvTerminalValue;
  const intrinsicEnterpriseValue = investedCapital + marketValueAdded;

  return { marketValueAdded, intrinsicEnterpriseValue, evaPerPeriod, pvEva, terminalEva, pvTerminalValue, currentEva, currentSpread };
}

// ─── Implied Analysis ─────────────────────────────────────────────────────

export interface ImpliedGrowthInputs {
  enterpriseValue: number;
  lastFcf: number;
  wacc: number;           // decimal
  terminalGrowth: number; // decimal — solve for this
  forecastYears: number;
  fcfGrowthRate?: number; // decimal — explicit period growth; defaults to implied
}

export interface ImpliedGrowthResult {
  impliedGrowthRate: number;    // decimal — the growth rate the market is pricing
  impliedTerminalValue: number;
  impliedFcfCagr: number;
}

/**
 * Implied Growth: what revenue/FCF growth rate does the current EV imply?
 * Uses a simplified DCF inversion: EV = sum(FCF_t / (1+WACC)^t) + TV/(1+WACC)^n.
 * Solves for g in terminal value = FCF_n*(1+g)/(WACC-g) such that total PV = EV.
 */
export function computeImpliedGrowth(inputs: ImpliedGrowthInputs): ImpliedGrowthResult {
  const { enterpriseValue, lastFcf, wacc, forecastYears } = inputs;
  const g = inputs.fcfGrowthRate ?? 0.05;

  // Compute PV of explicit forecast period
  let pvExplicit = 0;
  let terminalFcf = lastFcf;
  for (let t = 1; t <= forecastYears; t++) {
    terminalFcf = lastFcf * Math.pow(1 + g, t);
    pvExplicit += terminalFcf / Math.pow(1 + wacc, t);
  }

  // Residual EV that must be explained by terminal value
  const residualEv = enterpriseValue - pvExplicit;
  const discountFactor = Math.pow(1 + wacc, forecastYears);
  const undiscountedTV = residualEv * discountFactor;

  // Solve: TV = FCF_n*(1+g_term)/(WACC - g_term) for g_term
  // g_term = (TV*WACC - FCF_n) / (TV + FCF_n)
  const impliedGrowthRate = undiscountedTV > 0 && terminalFcf > 0
    ? (undiscountedTV * wacc - terminalFcf) / (undiscountedTV + terminalFcf)
    : 0;

  return {
    impliedGrowthRate: Math.max(-0.5, Math.min(impliedGrowthRate, wacc - 0.001)),
    impliedTerminalValue: undiscountedTV,
    impliedFcfCagr: g,
  };
}

export interface ImpliedWaccInputs {
  enterpriseValue: number;
  fcfForecast: number[];     // explicit period FCFs
  terminalGrowth: number;    // decimal
}

export interface ImpliedWaccResult {
  impliedWacc: number;        // decimal
  iterations: number;
  /**
   * False when the Newton-Raphson search exhausted MAX_ITER, or landed on
   * the [0.1%, 50%] clamp boundary, without actually satisfying the PV
   * tolerance -- i.e. no rate in that range reconciles the forecast cash
   * flows with the given enterprise value. Rendering impliedWacc as if it
   * were a genuine solve in that case (e.g. the exact 0.001 floor) reads
   * as "the market requires a 0.10% return", which is not what happened.
   */
  converged: boolean;
}

/**
 * Implied WACC: what discount rate equates PV(FCFs + TV) to current EV?
 * Newton-Raphson on f(r) = sum(FCF_t/(1+r)^t) + TV/(1+r)^n - EV = 0.
 */
export function computeImpliedWacc(inputs: ImpliedWaccInputs): ImpliedWaccResult {
  const { enterpriseValue, fcfForecast, terminalGrowth } = inputs;
  const n = fcfForecast.length;
  if (n === 0 || enterpriseValue <= 0) return { impliedWacc: 0, iterations: 0, converged: false };

  let r = 0.10; // initial guess
  const MAX_ITER = 100;
  const TOL = 1e-8;
  const MIN_RATE = 0.001;
  const MAX_RATE = 0.50;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let pv = 0;
    let dpv = 0;
    for (let t = 0; t < n; t++) {
      const disc = Math.pow(1 + r, t + 1);
      pv += fcfForecast[t] / disc;
      dpv -= (t + 1) * fcfForecast[t] / (disc * (1 + r));
    }
    // Terminal value
    const lastFcf = fcfForecast[n - 1];
    if (r > terminalGrowth) {
      const tv = (lastFcf * (1 + terminalGrowth)) / (r - terminalGrowth);
      const discN = Math.pow(1 + r, n);
      pv += tv / discN;
      // Derivative of TV term
      const dtvdr = -lastFcf * (1 + terminalGrowth) / Math.pow(r - terminalGrowth, 2);
      dpv += (dtvdr * discN - tv * n * Math.pow(1 + r, n - 1)) / (discN * discN);
    }

    const f = pv - enterpriseValue;
    if (Math.abs(f) < TOL) return { impliedWacc: Math.max(MIN_RATE, r), iterations: iter + 1, converged: true };
    if (Math.abs(dpv) < 1e-14) break;
    r = r - f / dpv;
    r = Math.max(MIN_RATE, Math.min(r, MAX_RATE));
  }

  return { impliedWacc: Math.max(MIN_RATE, r), iterations: MAX_ITER, converged: false };
}

export interface ImpliedMarginInputs {
  enterpriseValue: number;
  revenue: number;
  wacc: number;               // decimal
  terminalGrowth: number;     // decimal
  revenueGrowth: number;      // decimal
  forecastYears: number;
  taxRate: number;             // decimal
  daPercentRevenue: number;   // decimal — D&A as % of revenue
  capexPercentRevenue: number;// decimal
  nwcPercentRevenue: number;  // decimal — NWC as % of revenue
}

export interface ImpliedMarginResult {
  impliedOperatingMargin: number; // decimal
  impliedEbitMargin: number;      // decimal
  /** False when the binary search never met tolerance and margin landed on
   * the [-50%, 80%] search boundary -- no margin in that range reconciles
   * the forecast with the given enterprise value. See ImpliedWaccResult's
   * `converged` for the identical reasoning. */
  converged: boolean;
}

/**
 * Implied Margin: what operating margin would justify the current EV?
 * Solves: EV = sum(FCFF_t/(1+WACC)^t) + TV/(1+WACC)^n where
 * FCFF = Revenue × margin × (1-tax) + D&A - CapEx - ΔNWC.
 */
export function computeImpliedMargin(inputs: ImpliedMarginInputs): ImpliedMarginResult {
  const { enterpriseValue, revenue, wacc, terminalGrowth, revenueGrowth, forecastYears, taxRate, daPercentRevenue, capexPercentRevenue, nwcPercentRevenue } = inputs;

  // Binary search for operating margin
  const LO_BOUND = -0.5;
  const HI_BOUND = 0.8;
  let lo = LO_BOUND;
  let hi = HI_BOUND;
  let converged = false;

  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    let pv = 0;
    let lastFcf = 0;
    let prevRevenue = revenue;

    for (let t = 1; t <= forecastYears; t++) {
      const rev = revenue * Math.pow(1 + revenueGrowth, t);
      const ebit = rev * mid;
      const nopat = ebit * (1 - taxRate);
      const da = rev * daPercentRevenue;
      const capex = rev * capexPercentRevenue;
      const deltaNwc = (rev - prevRevenue) * nwcPercentRevenue;
      const fcff = nopat + da - capex - deltaNwc;
      pv += fcff / Math.pow(1 + wacc, t);
      lastFcf = fcff;
      prevRevenue = rev;
    }

    if (wacc > terminalGrowth && lastFcf > 0) {
      const tv = (lastFcf * (1 + terminalGrowth)) / (wacc - terminalGrowth);
      pv += tv / Math.pow(1 + wacc, forecastYears);
    }

    if (pv < enterpriseValue) lo = mid;
    else hi = mid;

    if (Math.abs(pv - enterpriseValue) / Math.max(enterpriseValue, 1) < 1e-6) { converged = true; break; }
  }

  const impliedOperatingMargin = (lo + hi) / 2;
  const impliedEbitMargin = impliedOperatingMargin; // EBIT margin = operating margin in this context
  // Binary search that never met tolerance and is still pinned against a
  // search boundary hasn't actually located a solution in range.
  const atBoundary = impliedOperatingMargin <= LO_BOUND + 1e-6 || impliedOperatingMargin >= HI_BOUND - 1e-6;

  return { impliedOperatingMargin, impliedEbitMargin, converged: converged && !atBoundary };
}

// ─── Valuation Bridge ─────────────────────────────────────────────────────

export interface ValuationMethodResult {
  method: string;
  label: string;
  enterpriseValue: number | null;
  equityValue: number | null;
  valuePerShare: number | null;
  confidence: "high" | "medium" | "low";
  notes: string;
}

export interface ValuationBridgeResult {
  methods: ValuationMethodResult[];
  weightedEquityValue: number;
  weightedValuePerShare: number;
  rangeHigh: number;
  rangeLow: number;
  sharesOutstanding: number;
}

/**
 * Valuation Bridge: reconciles multiple valuation approaches into a
 * weighted range. Each method contributes its equity value weighted by
 * confidence. High=3, Medium=2, Low=1.
 */
export function buildValuationBridge(
  methods: ValuationMethodResult[],
  sharesOutstanding: number,
): ValuationBridgeResult {
  const WEIGHTS: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const valid = methods.filter((m) => m.equityValue != null && m.equityValue > 0);

  if (valid.length === 0) {
    return { methods, weightedEquityValue: 0, weightedValuePerShare: 0, rangeHigh: 0, rangeLow: 0, sharesOutstanding };
  }

  let totalWeight = 0;
  let weightedSum = 0;
  let high = -Infinity;
  let low = Infinity;

  for (const m of valid) {
    const w = WEIGHTS[m.confidence] ?? 1;
    weightedSum += m.equityValue! * w;
    totalWeight += w;
    high = Math.max(high, m.equityValue!);
    low = Math.min(low, m.equityValue!);
  }

  const weightedEquityValue = weightedSum / totalWeight;
  const weightedValuePerShare = sharesOutstanding > 0 ? weightedEquityValue / sharesOutstanding : 0;

  return {
    methods,
    weightedEquityValue,
    weightedValuePerShare,
    rangeHigh: sharesOutstanding > 0 ? high / sharesOutstanding : 0,
    rangeLow: sharesOutstanding > 0 ? low / sharesOutstanding : 0,
    sharesOutstanding,
  };
}

// ─── Value Creation & Growth Quality (Program B, workstream B2) ──────────

export interface ValueCreationPeriodInputs {
  revenue: number;
  operatingIncome: number;
  incomeBeforeTax: number;
  incomeTaxExpense: number;
  totalDebt: number;
  totalEquity: number;
  cash: number;
  currentAssets: number;
  currentLiabilities: number;
}

export interface ValueCreationInputs extends ValueCreationPeriodInputs {
  depreciationAndAmortization: number;
  /** Filed cash-flow-statement CapEx. Providers disagree on sign convention
   * (usually a negative outflow, occasionally a positive magnitude) --
   * this function takes the absolute value rather than assume one. */
  capitalExpenditure: number;
  /** Prior-period figures for the incremental/growth metrics below. Pass
   * `null` when no filed prior period exists; those metrics resolve to
   * `null` rather than a misleading zero. */
  prior: ValueCreationPeriodInputs | null;
  /** Decimal WACC (0.09 = 9%) for Economic Profit. Omit to skip that metric. */
  wacc?: number;
}

export interface ValueCreationResult {
  nopat: number;
  investedCapital: number;
  roic: number;
  economicProfit: number | null;
  operatingLeverage: number | null;
  incrementalMargin: number | null;
  incrementalRoic: number | null;
  reinvestmentRate: number | null;
  sustainableGrowth: number | null;
}

function effectiveTaxRate(incomeBeforeTax: number, incomeTaxExpense: number): number {
  return incomeBeforeTax > 0 ? Math.max(0, Math.min(1, incomeTaxExpense / incomeBeforeTax)) : 0;
}

function investedCapitalOf(p: ValueCreationPeriodInputs): number {
  return p.totalDebt + p.totalEquity - p.cash;
}

/**
 * ROIC, NOPAT, Invested Capital, Economic Profit (EVA), and the
 * growth-quality family that needs two periods to mean anything:
 * Operating Leverage (DOL), Incremental Margin, Incremental ROIC,
 * Reinvestment Rate, and Sustainable Growth Rate = ROIC x Reinvestment Rate
 * (Damodaran's fundamental-growth identity).
 */
export function computeValueCreationMetrics(inputs: ValueCreationInputs): ValueCreationResult {
  const { prior, wacc } = inputs;
  const nopat = inputs.operatingIncome * (1 - effectiveTaxRate(inputs.incomeBeforeTax, inputs.incomeTaxExpense));
  const investedCapital = investedCapitalOf(inputs);
  const roic = investedCapital > 0 ? nopat / investedCapital : 0;
  const economicProfit = wacc !== undefined && investedCapital > 0 ? nopat - wacc * investedCapital : null;

  if (!prior) {
    return { nopat, investedCapital, roic, economicProfit, operatingLeverage: null, incrementalMargin: null, incrementalRoic: null, reinvestmentRate: null, sustainableGrowth: null };
  }

  const deltaRevenue = inputs.revenue - prior.revenue;
  const deltaEbit = inputs.operatingIncome - prior.operatingIncome;
  const operatingLeverage = (deltaRevenue !== 0 && prior.revenue > 0 && prior.operatingIncome !== 0)
    ? (deltaEbit / prior.operatingIncome) / (deltaRevenue / prior.revenue) : null;
  const incrementalMargin = deltaRevenue !== 0 ? deltaEbit / deltaRevenue : null;

  const priorNopat = prior.operatingIncome * (1 - effectiveTaxRate(prior.incomeBeforeTax, prior.incomeTaxExpense));
  const priorInvestedCapital = investedCapitalOf(prior);
  const deltaInvestedCapital = investedCapital - priorInvestedCapital;
  const incrementalRoic = deltaInvestedCapital !== 0 ? (nopat - priorNopat) / deltaInvestedCapital : null;

  // Damodaran reinvestment rate: (Net CapEx + delta Non-cash Working Capital) / NOPAT.
  const netCapex = Math.abs(inputs.capitalExpenditure) - inputs.depreciationAndAmortization;
  const nwcCurrent = inputs.currentAssets - inputs.currentLiabilities;
  const nwcPrior = prior.currentAssets - prior.currentLiabilities;
  const reinvestment = netCapex + (nwcCurrent - nwcPrior);
  const reinvestmentRate = nopat > 0 ? reinvestment / nopat : null;
  const sustainableGrowth = reinvestmentRate !== null ? roic * reinvestmentRate : null;

  return { nopat, investedCapital, roic, economicProfit, operatingLeverage, incrementalMargin, incrementalRoic, reinvestmentRate, sustainableGrowth };
}
