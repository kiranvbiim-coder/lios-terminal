import { runInstitutionalDcf, type InstitutionalDcfInput, type InstitutionalDcfResult } from "./institutionalDcf";

export interface DcfSensitivityCell {
  discountRatePct: number;
  terminalGrowthPct: number;
  valuePerShare: number | null;
  upsidePct: number | null;
  status: InstitutionalDcfResult["status"];
}

export interface DcfSensitivitySurface {
  discountRatesPct: number[];
  terminalGrowthRatesPct: number[];
  cells: DcfSensitivityCell[][];
}

export interface ReverseDcfResult {
  status: "solved" | "not-bracketed" | "unavailable";
  parameter: "explicit-growth-shock" | "terminal-growth";
  targetPrice: number | null;
  solvedValue: number | null;
  impliedValuePerShare: number | null;
  iterations: number;
  lowerBound: number;
  upperBound: number;
  detail: string;
}

export interface DcfDriverImpact {
  driver: "revenue-growth" | "ebitda-margin" | "capex" | "working-capital" | "discount-rate" | "terminal-growth";
  label: string;
  shock: string;
  baseValuePerShare: number | null;
  shockedValuePerShare: number | null;
  absoluteImpactPerShare: number | null;
  impactPct: number | null;
}

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

function shiftDiscountRate(input: InstitutionalDcfInput, shiftPctPoints: number): InstitutionalDcfInput {
  if (input.cashFlowMode === "fcff") {
    return {
      ...input,
      discount: {
        ...input.discount,
        currentWaccPct: input.discount.currentWaccPct + shiftPctPoints,
        terminalWaccPct: (input.discount.terminalWaccPct ?? input.discount.currentWaccPct) + shiftPctPoints,
      },
    };
  }
  return {
    ...input,
    discount: {
      ...input.discount,
      currentCostOfEquityPct: input.discount.currentCostOfEquityPct + shiftPctPoints,
      terminalCostOfEquityPct: (input.discount.terminalCostOfEquityPct ?? input.discount.currentCostOfEquityPct) + shiftPctPoints,
    },
  };
}

export function buildDcfSensitivitySurface(
  input: InstitutionalDcfInput,
  discountShiftsPctPoints: number[] = [-2, -1, 0, 1, 2],
  terminalGrowthShiftsPctPoints: number[] = [-1, -0.5, 0, 0.5, 1],
): DcfSensitivitySurface {
  const baseDiscount = input.cashFlowMode === "fcff"
    ? (input.discount.terminalWaccPct ?? input.discount.currentWaccPct)
    : (input.discount.terminalCostOfEquityPct ?? input.discount.currentCostOfEquityPct);
  const discountRatesPct = discountShiftsPctPoints.map(shift => baseDiscount + shift);
  const terminalGrowthRatesPct = terminalGrowthShiftsPctPoints.map(shift => input.terminal.growthPct + shift);
  const cells = terminalGrowthShiftsPctPoints.map(growthShift => discountShiftsPctPoints.map(discountShift => {
    const shiftedRateInput = shiftDiscountRate(input, discountShift);
    const shifted: InstitutionalDcfInput = {
      ...shiftedRateInput,
      terminal: { ...shiftedRateInput.terminal, growthPct: shiftedRateInput.terminal.growthPct + growthShift },
    };
    const result = runInstitutionalDcf(shifted);
    return {
      discountRatePct: baseDiscount + discountShift,
      terminalGrowthPct: input.terminal.growthPct + growthShift,
      valuePerShare: result.valuePerShare,
      upsidePct: result.upsidePct,
      status: result.status,
    };
  }));
  return { discountRatesPct, terminalGrowthRatesPct, cells };
}

function solveBisection(args: {
  lower: number;
  upper: number;
  target: number;
  evaluate: (value: number) => number | null;
  parameter: ReverseDcfResult["parameter"];
  detail: string;
}): ReverseDcfResult {
  const { target, evaluate, parameter, detail } = args;
  if (!(finite(target) && target > 0)) {
    return { status: "unavailable", parameter, targetPrice: null, solvedValue: null, impliedValuePerShare: null, iterations: 0, lowerBound: args.lower, upperBound: args.upper, detail: "A positive observed market price is required." };
  }
  let lower = args.lower;
  let upper = args.upper;
  let lowerValue = evaluate(lower);
  let upperValue = evaluate(upper);
  if (!finite(lowerValue) || !finite(upperValue)) {
    return { status: "unavailable", parameter, targetPrice: target, solvedValue: null, impliedValuePerShare: null, iterations: 0, lowerBound: lower, upperBound: upper, detail: "The DCF could not produce valid values at both search bounds." };
  }
  const lowerError = lowerValue - target;
  const upperError = upperValue - target;
  if (lowerError === 0) return { status: "solved", parameter, targetPrice: target, solvedValue: lower, impliedValuePerShare: lowerValue, iterations: 0, lowerBound: lower, upperBound: upper, detail };
  if (upperError === 0) return { status: "solved", parameter, targetPrice: target, solvedValue: upper, impliedValuePerShare: upperValue, iterations: 0, lowerBound: lower, upperBound: upper, detail };
  if (Math.sign(lowerError) === Math.sign(upperError)) {
    return { status: "not-bracketed", parameter, targetPrice: target, solvedValue: null, impliedValuePerShare: null, iterations: 0, lowerBound: lower, upperBound: upper, detail: "The observed price is outside the value range generated by the configured search bounds." };
  }

  let iterations = 0;
  let solvedValue: number | null = null;
  let solvedPrice: number | null = null;
  while (iterations < 80) {
    iterations += 1;
    const midpoint = (lower + upper) / 2;
    const midpointValue = evaluate(midpoint);
    if (!finite(midpointValue)) break;
    const midpointError = midpointValue - target;
    solvedValue = midpoint;
    solvedPrice = midpointValue;
    if (Math.abs(midpointError) <= Math.max(0.0001, target * 1e-7)) break;
    if (Math.sign(midpointError) === Math.sign(lowerValue - target)) {
      lower = midpoint;
      lowerValue = midpointValue;
    } else {
      upper = midpoint;
      upperValue = midpointValue;
    }
  }
  return {
    status: finite(solvedPrice) ? "solved" : "unavailable",
    parameter,
    targetPrice: target,
    solvedValue,
    impliedValuePerShare: solvedPrice,
    iterations,
    lowerBound: args.lower,
    upperBound: args.upper,
    detail,
  };
}

/**
 * Solves the uniform percentage-point shock to every explicit-period revenue
 * growth assumption that makes the model equal the observed market price.
 * This is a market-implied expectation diagnostic, not a forecast.
 */
export function solveReverseDcfExplicitGrowth(input: InstitutionalDcfInput, bounds: [number, number] = [-30, 30]): ReverseDcfResult {
  return solveBisection({
    lower: bounds[0],
    upper: bounds[1],
    target: input.spotPrice ?? NaN,
    parameter: "explicit-growth-shock",
    detail: "Uniform percentage-point shock applied to all explicit-period revenue-growth assumptions until model value matches spot.",
    evaluate: shock => runInstitutionalDcf({
      ...input,
      years: input.years.map(year => ({ ...year, revenueGrowthPct: year.revenueGrowthPct + shock })),
    }).valuePerShare,
  });
}

/**
 * Solves the perpetual growth rate implied by market price. The upper search
 * bound is capped below the terminal discount rate, preserving DCF validity.
 */
export function solveReverseDcfTerminalGrowth(input: InstitutionalDcfInput, lowerBound = -5): ReverseDcfResult {
  const terminalDiscount = input.cashFlowMode === "fcff"
    ? (input.discount.terminalWaccPct ?? input.discount.currentWaccPct)
    : (input.discount.terminalCostOfEquityPct ?? input.discount.currentCostOfEquityPct);
  const upperBound = terminalDiscount - 0.25;
  return solveBisection({
    lower: lowerBound,
    upper: upperBound,
    target: input.spotPrice ?? NaN,
    parameter: "terminal-growth",
    detail: "Perpetual growth implied by the observed market price with all other assumptions held constant; upper bound remains below the terminal discount rate.",
    evaluate: growthPct => runInstitutionalDcf({
      ...input,
      terminal: { ...input.terminal, method: "gordon", growthPct },
    }).valuePerShare,
  });
}

function shockInput(input: InstitutionalDcfInput, driver: DcfDriverImpact["driver"]): { input: InstitutionalDcfInput; shock: string } {
  switch (driver) {
    case "revenue-growth":
      return { input: { ...input, years: input.years.map(year => ({ ...year, revenueGrowthPct: year.revenueGrowthPct + 1 })) }, shock: "+1.0 pp all explicit years" };
    case "ebitda-margin":
      return { input: { ...input, years: input.years.map(year => ({ ...year, ebitdaMarginPct: year.ebitdaMarginPct + 1 })) }, shock: "+1.0 pp all explicit years" };
    case "capex":
      return { input: { ...input, years: input.years.map(year => ({ ...year, capexPctRevenue: year.capexPctRevenue + 1 })) }, shock: "+1.0 pp CapEx / revenue" };
    case "working-capital":
      return { input: { ...input, years: input.years.map(year => ({ ...year, nwcInvestmentPctRevenue: year.nwcInvestmentPctRevenue + 0.5 })) }, shock: "+0.5 pp ΔNWC / revenue" };
    case "discount-rate":
      return { input: shiftDiscountRate(input, 0.5), shock: "+0.5 pp discount rate" };
    case "terminal-growth":
      return { input: { ...input, terminal: { ...input.terminal, growthPct: input.terminal.growthPct + 0.25 } }, shock: "+0.25 pp terminal growth" };
  }
}

export function buildDcfDriverImpacts(input: InstitutionalDcfInput): DcfDriverImpact[] {
  const baseValue = runInstitutionalDcf(input).valuePerShare;
  const definitions: Array<[DcfDriverImpact["driver"], string]> = [
    ["revenue-growth", "REVENUE GROWTH"],
    ["ebitda-margin", "EBITDA MARGIN"],
    ["capex", "CAPEX INTENSITY"],
    ["working-capital", "WORKING CAPITAL"],
    ["discount-rate", "DISCOUNT RATE"],
    ["terminal-growth", "TERMINAL GROWTH"],
  ];
  return definitions.map(([driver, label]) => {
    const shocked = shockInput(input, driver);
    const shockedValue = runInstitutionalDcf(shocked.input).valuePerShare;
    const absoluteImpactPerShare = finite(baseValue) && finite(shockedValue) ? shockedValue - baseValue : null;
    const impactPct = finite(absoluteImpactPerShare) && finite(baseValue) && Math.abs(baseValue) > 1e-9
      ? (absoluteImpactPerShare / Math.abs(baseValue)) * 100
      : null;
    return { driver, label, shock: shocked.shock, baseValuePerShare: baseValue, shockedValuePerShare: shockedValue, absoluteImpactPerShare, impactPct };
  });
}
