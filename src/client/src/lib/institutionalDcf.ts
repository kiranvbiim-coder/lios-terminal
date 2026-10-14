import { terminalValue, type TerminalValueMethod } from "./valuationModels";

export type DcfCashFlowMode = "fcff" | "fcfe";
export type DcfDiscountTiming = "year-end" | "mid-year" | "stub";
export type DcfScenarioKey = "bear" | "base" | "bull" | "custom";
export type DcfModelSuitability = "high" | "medium" | "low";

export interface DcfYearAssumption {
  revenueGrowthPct: number;
  ebitdaMarginPct: number;
  daPctRevenue: number;
  taxRatePct: number;
  capexPctRevenue: number;
  nwcInvestmentPctRevenue: number;
  otherInvestmentPctRevenue?: number;
  netBorrowing?: number;
  costOfDebtPct?: number;
}

export interface DcfDiscountSettings {
  currentWaccPct: number;
  terminalWaccPct?: number;
  currentCostOfEquityPct: number;
  terminalCostOfEquityPct?: number;
  maturityFadeYears?: number;
  timing: DcfDiscountTiming;
  stubFractionYears?: number;
}

export interface InstitutionalDcfTerminalSettings {
  method: TerminalValueMethod;
  growthPct: number;
  exitMultiple: number;
  hybridWeightPct?: number;
  fadeStartGrowthPct?: number;
  fadeYears?: number;
}

export interface InstitutionalDcfBridge {
  netDebt: number | null;
  preferredEquity?: number;
  minorityInterest?: number;
  pensionLiabilities?: number;
  leaseLiabilities?: number;
  convertibleClaims?: number;
  optionWarrantValue?: number;
  otherClaims?: number;
  excessCash?: number;
  marketableSecurities?: number;
  nonOperatingAssets?: number;
  jointVentureStakes?: number;
}

export interface InstitutionalDcfInput {
  baseRevenue: number | null;
  basicShares: number | null;
  dilutedShares: number | null;
  spotPrice: number | null;
  startingInvestedCapital: number | null;
  startingNetDebt: number | null;
  startingNopat?: number | null;
  cashFlowMode: DcfCashFlowMode;
  years: DcfYearAssumption[];
  discount: DcfDiscountSettings;
  terminal: InstitutionalDcfTerminalSettings;
  bridge: InstitutionalDcfBridge;
  riskFreeRatePct?: number | null;
  sourceAsOf?: string | null;
}

export interface DcfProjection {
  year: number;
  revenue: number;
  ebitda: number;
  da: number;
  ebit: number;
  nopat: number;
  capex: number;
  nwcInvestment: number;
  otherInvestment: number;
  netInvestment: number;
  fcff: number;
  interestExpense: number;
  netBorrowing: number;
  fcfe: number;
  selectedCashFlow: number;
  openingNetDebt: number | null;
  closingNetDebt: number | null;
  openingInvestedCapital: number | null;
  closingInvestedCapital: number | null;
  averageInvestedCapital: number | null;
  roicPct: number | null;
  ronicPct: number | null;
  reinvestmentRatePct: number | null;
  supportedGrowthPct: number | null;
  discountRatePct: number;
  discountFactor: number;
  pvCashFlow: number;
}

export interface DcfHealthDiagnostic {
  id: string;
  severity: "ok" | "watch" | "critical";
  label: string;
  value: string;
  detail: string;
}

export interface DcfReconciliation {
  fcffEquityValue: number | null;
  fcfeEquityValue: number | null;
  fcffVsFcfeDeltaPct: number | null;
  evaEnterpriseValue: number | null;
  dcfVsEvaDeltaPct: number | null;
}

export interface InstitutionalDcfResult {
  status: "ready" | "partial" | "incomplete";
  blockingIssues: string[];
  warnings: string[];
  projections: DcfProjection[];
  pvExplicitCashFlows: number | null;
  terminalValue: number | null;
  pvTerminalValue: number | null;
  enterpriseValue: number | null;
  equityValue: number | null;
  valuePerShare: number | null;
  upsidePct: number | null;
  terminalValuePct: number | null;
  terminalReturnOnCapitalPct: number | null;
  impliedTerminalEvEbitda: number | null;
  health: DcfHealthDiagnostic[];
}

export interface DcfScenarioDefinition {
  key: DcfScenarioKey;
  label: string;
  description: string;
  revenueGrowthShockPctPoints: number;
  ebitdaMarginShockPctPoints: number;
  capexShockPctPoints: number;
  nwcShockPctPoints: number;
  waccShockPctPoints: number;
  costOfEquityShockPctPoints: number;
  terminalGrowthShockPctPoints: number;
}

export interface DcfProbabilisticRange {
  low: number;
  mode: number;
  high: number;
}

export interface DcfProbabilisticSettings {
  runs: number;
  seed: number;
  growthShockPctPoints: DcfProbabilisticRange;
  marginShockPctPoints: DcfProbabilisticRange;
  capexShockPctPoints: DcfProbabilisticRange;
  waccShockPctPoints: DcfProbabilisticRange;
  terminalGrowthShockPctPoints: DcfProbabilisticRange;
  correlationMatrix?: number[][];
}

export interface DcfProbabilisticResult {
  runsRequested: number;
  validRuns: number;
  seed: number;
  p10: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  probabilityAboveSpotPct: number | null;
}

export interface DcfSuitabilityAssessment {
  suitability: DcfModelSuitability;
  primaryMethod: string;
  reasons: string[];
  companionMethods: string[];
}

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

const pct = (value: number): number => value / 100;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function validateInstitutionalDcfInput(input: InstitutionalDcfInput): string[] {
  const issues: string[] = [];
  if (!finite(input.baseRevenue) || input.baseRevenue <= 0) issues.push("Base revenue is required from a source or analyst input.");
  if (!input.years.length) issues.push("At least one explicit forecast year is required.");
  if (!finite(input.discount.currentWaccPct) || input.discount.currentWaccPct <= 0) issues.push("A positive WACC is required.");
  if (!finite(input.discount.currentCostOfEquityPct) || input.discount.currentCostOfEquityPct <= 0) issues.push("A positive cost of equity is required.");
  if (input.cashFlowMode === "fcfe" && !finite(input.startingNetDebt)) issues.push("FCFE requires an observed or analyst-entered opening net-debt balance.");
  if (input.cashFlowMode === "fcff" && !finite(input.bridge.netDebt)) issues.push("Per-share FCFF valuation requires an observed or analyst-entered net-debt bridge.");
  if (!finite(input.dilutedShares) || input.dilutedShares <= 0) issues.push("Diluted shares are required from a source or analyst input.");
  if (!finite(input.spotPrice) || input.spotPrice <= 0) issues.push("A current market price is required to calculate upside/downside.");
  if (input.terminal.method === "valueDriver" && !finite(input.startingInvestedCapital)) {
    issues.push("Value-driver terminal value requires an invested-capital base; it is not inferred.");
  }
  if (input.cashFlowMode === "fcfe" && input.terminal.method === "valueDriver") {
    issues.push("Value-driver terminal value is an enterprise-value method and is not used with FCFE.");
  }
  const terminalRate = input.cashFlowMode === "fcff"
    ? (input.discount.terminalWaccPct ?? input.discount.currentWaccPct)
    : (input.discount.terminalCostOfEquityPct ?? input.discount.currentCostOfEquityPct);
  if (input.terminal.method !== "exitMultiple" && input.terminal.growthPct >= terminalRate) {
    issues.push("Terminal growth must remain below the terminal discount rate.");
  }
  return issues;
}

export function buildDiscountRatePath(input: InstitutionalDcfInput): number[] {
  const start = input.cashFlowMode === "fcff" ? input.discount.currentWaccPct : input.discount.currentCostOfEquityPct;
  const end = input.cashFlowMode === "fcff"
    ? (input.discount.terminalWaccPct ?? start)
    : (input.discount.terminalCostOfEquityPct ?? start);
  const fadeYears = Math.max(1, Math.round(input.discount.maturityFadeYears ?? input.years.length));
  return input.years.map((_, index) => {
    const alpha = clamp((index + 1) / fadeYears, 0, 1);
    return start + (end - start) * alpha;
  });
}

function discountFactorAtYear(ratesPct: number[], index: number, timing: DcfDiscountTiming, stubFractionYears = 0.5): number {
  if (index < 0) return 1;
  let factor = 1;
  if (timing === "mid-year") {
    for (let i = 0; i < index; i++) factor *= 1 + pct(ratesPct[i]);
    factor *= Math.pow(1 + pct(ratesPct[index]), 0.5);
    return factor;
  }
  if (timing === "stub") {
    const stub = clamp(stubFractionYears, 1 / 365, 1);
    factor *= Math.pow(1 + pct(ratesPct[0]), stub);
    for (let i = 1; i <= index; i++) factor *= 1 + pct(ratesPct[i]);
    return factor;
  }
  for (let i = 0; i <= index; i++) factor *= 1 + pct(ratesPct[i]);
  return factor;
}

function terminalDiscountFactor(ratesPct: number[], timing: DcfDiscountTiming, stubFractionYears = 0.5): number {
  if (!ratesPct.length) return 1;
  let factor = 1;
  if (timing === "stub") {
    const stub = clamp(stubFractionYears, 1 / 365, 1);
    factor *= Math.pow(1 + pct(ratesPct[0]), stub);
    for (let i = 1; i < ratesPct.length; i++) factor *= 1 + pct(ratesPct[i]);
    return factor;
  }
  // Even under the mid-year convention the continuing value is measured at
  // the end of the final explicit forecast year, not at the year's midpoint.
  for (const rate of ratesPct) factor *= 1 + pct(rate);
  return factor;
}

function bridgeEnterpriseValueToCommonEquity(enterpriseValue: number, bridge: InstitutionalDcfBridge, cashFlowMode: DcfCashFlowMode): number | null {
  const netDebt = cashFlowMode === "fcff" ? bridge.netDebt : 0;
  if (!finite(netDebt)) return null;
  const deductions = netDebt
    + (bridge.preferredEquity ?? 0)
    + (bridge.minorityInterest ?? 0)
    + (bridge.pensionLiabilities ?? 0)
    + (bridge.leaseLiabilities ?? 0)
    + (bridge.convertibleClaims ?? 0)
    + (bridge.optionWarrantValue ?? 0)
    + (bridge.otherClaims ?? 0);
  const addbacks = (bridge.excessCash ?? 0)
    + (bridge.marketableSecurities ?? 0)
    + (bridge.nonOperatingAssets ?? 0)
    + (bridge.jointVentureStakes ?? 0);
  const equity = enterpriseValue - deductions + addbacks;
  return Number.isFinite(equity) ? equity : null;
}

function emptyResult(issues: string[]): InstitutionalDcfResult {
  return {
    status: "incomplete",
    blockingIssues: issues,
    warnings: [],
    projections: [],
    pvExplicitCashFlows: null,
    terminalValue: null,
    pvTerminalValue: null,
    enterpriseValue: null,
    equityValue: null,
    valuePerShare: null,
    upsidePct: null,
    terminalValuePct: null,
    terminalReturnOnCapitalPct: null,
    impliedTerminalEvEbitda: null,
    health: [],
  };
}

export function runInstitutionalDcf(input: InstitutionalDcfInput): InstitutionalDcfResult {
  const blockingIssues = validateInstitutionalDcfInput(input);
  if (!finite(input.baseRevenue) || input.baseRevenue <= 0 || !input.years.length) return emptyResult(blockingIssues);

  const rates = buildDiscountRatePath(input);
  const warnings: string[] = [];
  let revenue = input.baseRevenue;
  let openingInvestedCapital = finite(input.startingInvestedCapital) ? input.startingInvestedCapital : null;
  let openingNetDebt = finite(input.startingNetDebt) ? input.startingNetDebt : null;
  let previousNopat = finite(input.startingNopat) ? input.startingNopat : null;
  let pvExplicit = 0;
  const projections: DcfProjection[] = [];

  for (let index = 0; index < input.years.length; index++) {
    const assumption = input.years[index];
    revenue *= 1 + pct(assumption.revenueGrowthPct);
    const ebitda = revenue * pct(assumption.ebitdaMarginPct);
    const da = revenue * pct(assumption.daPctRevenue);
    const ebit = ebitda - da;
    const nopat = ebit * (1 - pct(assumption.taxRatePct));
    const capex = revenue * pct(assumption.capexPctRevenue);
    const nwcInvestment = revenue * pct(assumption.nwcInvestmentPctRevenue);
    const otherInvestment = revenue * pct(assumption.otherInvestmentPctRevenue ?? 0);
    const netInvestment = capex - da + nwcInvestment + otherInvestment;
    const fcff = nopat - netInvestment;

    const netBorrowing = assumption.netBorrowing ?? 0;
    let closingNetDebt: number | null = openingNetDebt;
    let interestExpense = 0;
    let fcfe = fcff;
    if (input.cashFlowMode === "fcfe") {
      if (openingNetDebt === null) {
        closingNetDebt = null;
      } else {
        closingNetDebt = openingNetDebt + netBorrowing;
        const avgNetDebt = (openingNetDebt + closingNetDebt) / 2;
        const debtCost = assumption.costOfDebtPct ?? 0;
        interestExpense = avgNetDebt * pct(debtCost);
        fcfe = fcff - interestExpense * (1 - pct(assumption.taxRatePct)) + netBorrowing;
      }
    }

    const closingInvestedCapital = openingInvestedCapital === null ? null : openingInvestedCapital + netInvestment;
    const averageInvestedCapital = openingInvestedCapital === null || closingInvestedCapital === null
      ? null
      : (openingInvestedCapital + closingInvestedCapital) / 2;
    const roicPct = averageInvestedCapital !== null && averageInvestedCapital > 0
      ? (nopat / averageInvestedCapital) * 100
      : null;
    const incrementalNopat = previousNopat === null ? null : nopat - previousNopat;
    const ronicPct = incrementalNopat !== null && netInvestment > 0
      ? (incrementalNopat / netInvestment) * 100
      : null;
    const reinvestmentRatePct = nopat > 0 ? (netInvestment / nopat) * 100 : null;
    const returnOnNewCapital = finite(ronicPct) ? ronicPct : roicPct;
    const supportedGrowthPct = finite(reinvestmentRatePct) && finite(returnOnNewCapital)
      ? pct(reinvestmentRatePct) * returnOnNewCapital
      : null;

    const selectedCashFlow = input.cashFlowMode === "fcff" ? fcff : fcfe;
    const discountFactor = discountFactorAtYear(rates, index, input.discount.timing, input.discount.stubFractionYears);
    const pvCashFlow = selectedCashFlow / discountFactor;
    pvExplicit += pvCashFlow;

    projections.push({
      year: index + 1,
      revenue,
      ebitda,
      da,
      ebit,
      nopat,
      capex,
      nwcInvestment,
      otherInvestment,
      netInvestment,
      fcff,
      interestExpense,
      netBorrowing,
      fcfe,
      selectedCashFlow,
      openingNetDebt,
      closingNetDebt,
      openingInvestedCapital,
      closingInvestedCapital,
      averageInvestedCapital,
      roicPct,
      ronicPct,
      reinvestmentRatePct,
      supportedGrowthPct,
      discountRatePct: rates[index],
      discountFactor,
      pvCashFlow,
    });

    openingInvestedCapital = closingInvestedCapital;
    openingNetDebt = closingNetDebt;
    previousNopat = nopat;
  }

  const last = projections[projections.length - 1];
  const terminalDiscountRate = input.cashFlowMode === "fcff"
    ? (input.discount.terminalWaccPct ?? rates[rates.length - 1])
    : (input.discount.terminalCostOfEquityPct ?? rates[rates.length - 1]);
  const terminalReturnOnCapitalPct = finite(last.ronicPct) && last.ronicPct > 0
    ? last.ronicPct
    : (finite(last.roicPct) && last.roicPct > 0 ? last.roicPct : null);

  let terminalMethod = input.terminal.method;
  if (input.cashFlowMode === "fcfe" && terminalMethod === "valueDriver") terminalMethod = "gordon";
  const tv = terminalValue({
    method: terminalMethod,
    lastFcf: last.selectedCashFlow,
    lastEbitda: last.ebitda,
    discountRate: terminalDiscountRate,
    terminalGrowth: input.terminal.growthPct,
    exitMultiple: input.terminal.exitMultiple,
    hybridWeight: input.terminal.hybridWeightPct,
    lastNopat: last.nopat,
    roic: terminalReturnOnCapitalPct ?? 0,
    fadeStartGrowth: input.terminal.fadeStartGrowthPct,
    fadeYears: input.terminal.fadeYears,
  });
  const tvDiscountFactor = terminalDiscountFactor(rates, input.discount.timing, input.discount.stubFractionYears);
  const pvTv = tv / tvDiscountFactor;
  const primaryValue = pvExplicit + pvTv;
  const enterpriseValue = input.cashFlowMode === "fcff" ? primaryValue : null;
  const equityValue = input.cashFlowMode === "fcff"
    ? bridgeEnterpriseValueToCommonEquity(primaryValue, input.bridge, input.cashFlowMode)
    : bridgeEnterpriseValueToCommonEquity(primaryValue, { ...input.bridge, netDebt: 0 }, input.cashFlowMode);
  const valuePerShare = equityValue !== null && finite(input.dilutedShares) && input.dilutedShares > 0
    ? equityValue / input.dilutedShares
    : null;
  const upsidePct = valuePerShare !== null && finite(input.spotPrice) && input.spotPrice > 0
    ? ((valuePerShare / input.spotPrice) - 1) * 100
    : null;
  const terminalValuePct = primaryValue > 0 ? (pvTv / primaryValue) * 100 : null;
  const impliedTerminalEvEbitda = last.ebitda > 0 ? tv / last.ebitda : null;

  if (finite(last.supportedGrowthPct)) {
    const gap = last.supportedGrowthPct - input.terminal.growthPct;
    if (gap < -1) warnings.push(`Terminal growth exceeds the reinvestment/return-on-capital support diagnostic by ${Math.abs(gap).toFixed(1)} percentage points.`);
  }
  if (terminalValuePct !== null && terminalValuePct > 80) warnings.push("More than 80% of value comes from terminal value; the result is highly terminal-assumption-sensitive.");

  const health = buildDcfHealthDiagnostics({
    input,
    terminalValuePct,
    terminalReturnOnCapitalPct,
    impliedTerminalEvEbitda,
    terminalDiscountRate,
    finalProjection: last,
  });
  const status = blockingIssues.length ? "partial" : "ready";

  return {
    status,
    blockingIssues,
    warnings,
    projections,
    pvExplicitCashFlows: pvExplicit,
    terminalValue: tv,
    pvTerminalValue: pvTv,
    enterpriseValue,
    equityValue,
    valuePerShare,
    upsidePct,
    terminalValuePct,
    terminalReturnOnCapitalPct,
    impliedTerminalEvEbitda,
    health,
  };
}

export function buildDcfHealthDiagnostics(args: {
  input: InstitutionalDcfInput;
  terminalValuePct: number | null;
  terminalReturnOnCapitalPct: number | null;
  impliedTerminalEvEbitda: number | null;
  terminalDiscountRate: number;
  finalProjection: DcfProjection;
}): DcfHealthDiagnostic[] {
  const { input, terminalValuePct, terminalReturnOnCapitalPct, impliedTerminalEvEbitda, terminalDiscountRate, finalProjection } = args;
  const result: DcfHealthDiagnostic[] = [];
  if (terminalValuePct !== null) {
    result.push({
      id: "tv-share",
      severity: terminalValuePct >= 85 ? "critical" : terminalValuePct >= 70 ? "watch" : "ok",
      label: "TERMINAL VALUE / TOTAL VALUE",
      value: `${terminalValuePct.toFixed(1)}%`,
      detail: terminalValuePct >= 70 ? "A large share of value depends on continuing-value assumptions." : "Explicit cash flows contribute a meaningful share of value.",
    });
  }
  const g = input.terminal.growthPct;
  result.push({
    id: "g-vs-discount",
    severity: g >= terminalDiscountRate ? "critical" : g >= terminalDiscountRate - 1 ? "watch" : "ok",
    label: "TERMINAL GROWTH / DISCOUNT RATE",
    value: `${g.toFixed(1)}% / ${terminalDiscountRate.toFixed(1)}%`,
    detail: g >= terminalDiscountRate ? "Perpetual growth cannot equal or exceed the terminal discount rate." : "Terminal growth remains below the discount rate.",
  });
  if (finite(input.riskFreeRatePct)) {
    result.push({
      id: "g-vs-rf",
      severity: g > input.riskFreeRatePct ? "watch" : "ok",
      label: "TERMINAL GROWTH / LONG-RUN RATE REFERENCE",
      value: `${g.toFixed(1)}% / ${input.riskFreeRatePct.toFixed(1)}%`,
      detail: g > input.riskFreeRatePct ? "Review whether perpetual growth is too aggressive relative to the selected long-run rate reference." : "Perpetual growth is not above the selected rate reference.",
    });
  }
  if (terminalReturnOnCapitalPct !== null) {
    result.push({
      id: "terminal-return",
      severity: terminalReturnOnCapitalPct < g ? "critical" : terminalReturnOnCapitalPct < terminalDiscountRate ? "watch" : "ok",
      label: "TERMINAL RETURN ON NEW/INVESTED CAPITAL",
      value: `${terminalReturnOnCapitalPct.toFixed(1)}%`,
      detail: terminalReturnOnCapitalPct < g ? "Growth cannot be supported if the terminal return on capital is below the growth rate without additional financing assumptions." : "Terminal return on capital is economically consistent with positive reinvestment.",
    });
  }
  if (impliedTerminalEvEbitda !== null) {
    result.push({
      id: "implied-multiple",
      severity: impliedTerminalEvEbitda > 25 ? "watch" : "ok",
      label: "IMPLIED TERMINAL EV / EBITDA",
      value: `${impliedTerminalEvEbitda.toFixed(1)}x`,
      detail: "Use this as a market sanity check; it is derived from the selected continuing-value method, not a peer multiple.",
    });
  }
  if (finite(finalProjection.supportedGrowthPct)) {
    const gap = input.terminal.growthPct - finalProjection.supportedGrowthPct;
    result.push({
      id: "growth-support",
      severity: gap > 2 ? "critical" : gap > 0.75 ? "watch" : "ok",
      label: "GROWTH / REINVESTMENT SUPPORT",
      value: `${input.terminal.growthPct.toFixed(1)}% / ${finalProjection.supportedGrowthPct.toFixed(1)}%`,
      detail: gap > 0.75 ? "Terminal growth is above the growth implied by forecast reinvestment and return on new capital." : "Growth is broadly supported by the reinvestment/return-on-capital diagnostic.",
    });
  }
  return result;
}

export const DEFAULT_DCF_SCENARIOS: Record<Exclude<DcfScenarioKey, "custom">, DcfScenarioDefinition> = {
  bear: {
    key: "bear",
    label: "BEAR",
    description: "Analyst scenario preset: lower growth/margins, higher reinvestment and discount rates.",
    revenueGrowthShockPctPoints: -3,
    ebitdaMarginShockPctPoints: -2,
    capexShockPctPoints: 0.75,
    nwcShockPctPoints: 0.35,
    waccShockPctPoints: 1,
    costOfEquityShockPctPoints: 1,
    terminalGrowthShockPctPoints: -0.5,
  },
  base: {
    key: "base",
    label: "BASE",
    description: "Unmodified analyst/source-seeded assumptions.",
    revenueGrowthShockPctPoints: 0,
    ebitdaMarginShockPctPoints: 0,
    capexShockPctPoints: 0,
    nwcShockPctPoints: 0,
    waccShockPctPoints: 0,
    costOfEquityShockPctPoints: 0,
    terminalGrowthShockPctPoints: 0,
  },
  bull: {
    key: "bull",
    label: "BULL",
    description: "Analyst scenario preset: stronger growth/margins and lower discount rates.",
    revenueGrowthShockPctPoints: 2,
    ebitdaMarginShockPctPoints: 1.5,
    capexShockPctPoints: -0.25,
    nwcShockPctPoints: -0.15,
    waccShockPctPoints: -0.75,
    costOfEquityShockPctPoints: -0.75,
    terminalGrowthShockPctPoints: 0.25,
  },
};

export function applyDcfScenario(input: InstitutionalDcfInput, scenario: DcfScenarioDefinition): InstitutionalDcfInput {
  return {
    ...input,
    years: input.years.map(year => ({
      ...year,
      revenueGrowthPct: year.revenueGrowthPct + scenario.revenueGrowthShockPctPoints,
      ebitdaMarginPct: year.ebitdaMarginPct + scenario.ebitdaMarginShockPctPoints,
      capexPctRevenue: Math.max(0, year.capexPctRevenue + scenario.capexShockPctPoints),
      nwcInvestmentPctRevenue: year.nwcInvestmentPctRevenue + scenario.nwcShockPctPoints,
    })),
    discount: {
      ...input.discount,
      currentWaccPct: input.discount.currentWaccPct + scenario.waccShockPctPoints,
      terminalWaccPct: (input.discount.terminalWaccPct ?? input.discount.currentWaccPct) + scenario.waccShockPctPoints,
      currentCostOfEquityPct: input.discount.currentCostOfEquityPct + scenario.costOfEquityShockPctPoints,
      terminalCostOfEquityPct: (input.discount.terminalCostOfEquityPct ?? input.discount.currentCostOfEquityPct) + scenario.costOfEquityShockPctPoints,
    },
    terminal: {
      ...input.terminal,
      growthPct: input.terminal.growthPct + scenario.terminalGrowthShockPctPoints,
    },
  };
}

export function runDcfScenarios(input: InstitutionalDcfInput): Array<{ scenario: DcfScenarioDefinition; result: InstitutionalDcfResult }> {
  return [DEFAULT_DCF_SCENARIOS.bear, DEFAULT_DCF_SCENARIOS.base, DEFAULT_DCF_SCENARIOS.bull].map(scenario => ({
    scenario,
    result: runInstitutionalDcf(applyDcfScenario(input, scenario)),
  }));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalPair(random: () => number): [number, number] {
  const u1 = Math.max(1e-12, random());
  const u2 = Math.max(1e-12, random());
  const radius = Math.sqrt(-2 * Math.log(u1));
  return [radius * Math.cos(2 * Math.PI * u2), radius * Math.sin(2 * Math.PI * u2)];
}

function normalCdf(value: number): number {
  // Abramowitz-Stegun style erf approximation; sufficient for deterministic
  // simulation rank mapping, not presented as a standalone statistical test.
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function cholesky(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  if (!n || matrix.some(row => row.length !== n)) return null;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k++) sum -= out[i][k] * out[j][k];
      if (i === j) {
        if (sum <= 1e-10) return null;
        out[i][j] = Math.sqrt(sum);
      } else {
        out[i][j] = sum / out[j][j];
      }
    }
  }
  return out;
}

function correlatedUniforms(random: () => number, dimension: number, matrix?: number[][]): number[] {
  const normals: number[] = [];
  while (normals.length < dimension) {
    const pair = normalPair(random);
    normals.push(pair[0], pair[1]);
  }
  normals.length = dimension;
  const chol = matrix ? cholesky(matrix) : null;
  const correlated = chol
    ? chol.map((row, i) => row.slice(0, i + 1).reduce((sum, weight, j) => sum + weight * normals[j], 0))
    : normals;
  return correlated.map(normalCdf);
}

function triangularFromUniform(u: number, range: DcfProbabilisticRange): number {
  const low = Math.min(range.low, range.high);
  const high = Math.max(range.low, range.high);
  const mode = clamp(range.mode, low, high);
  if (high === low) return low;
  const f = (mode - low) / (high - low);
  if (u < f) return low + Math.sqrt(u * (high - low) * (mode - low));
  return high - Math.sqrt((1 - u) * (high - low) * (high - mode));
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function runProbabilisticDcf(input: InstitutionalDcfInput, settings: DcfProbabilisticSettings): DcfProbabilisticResult {
  const random = mulberry32(settings.seed);
  const values: number[] = [];
  const dimensions = 5;
  for (let run = 0; run < Math.max(1, Math.floor(settings.runs)); run++) {
    const uniforms = correlatedUniforms(random, dimensions, settings.correlationMatrix);
    const growthShock = triangularFromUniform(uniforms[0], settings.growthShockPctPoints);
    const marginShock = triangularFromUniform(uniforms[1], settings.marginShockPctPoints);
    const capexShock = triangularFromUniform(uniforms[2], settings.capexShockPctPoints);
    const waccShock = triangularFromUniform(uniforms[3], settings.waccShockPctPoints);
    const terminalGrowthShock = triangularFromUniform(uniforms[4], settings.terminalGrowthShockPctPoints);
    const sampled: InstitutionalDcfInput = {
      ...input,
      years: input.years.map(year => ({
        ...year,
        revenueGrowthPct: year.revenueGrowthPct + growthShock,
        ebitdaMarginPct: year.ebitdaMarginPct + marginShock,
        capexPctRevenue: Math.max(0, year.capexPctRevenue + capexShock),
      })),
      discount: {
        ...input.discount,
        currentWaccPct: input.discount.currentWaccPct + waccShock,
        terminalWaccPct: (input.discount.terminalWaccPct ?? input.discount.currentWaccPct) + waccShock,
        currentCostOfEquityPct: input.discount.currentCostOfEquityPct + waccShock,
        terminalCostOfEquityPct: (input.discount.terminalCostOfEquityPct ?? input.discount.currentCostOfEquityPct) + waccShock,
      },
      terminal: { ...input.terminal, growthPct: input.terminal.growthPct + terminalGrowthShock },
    };
    const result = runInstitutionalDcf(sampled);
    if (finite(result.valuePerShare) && result.valuePerShare >= 0) values.push(result.valuePerShare);
  }
  values.sort((a, b) => a - b);
  const probabilityAboveSpotPct = finite(input.spotPrice) && input.spotPrice > 0 && values.length
    ? (values.filter(value => value > input.spotPrice!).length / values.length) * 100
    : null;
  return {
    runsRequested: Math.max(1, Math.floor(settings.runs)),
    validRuns: values.length,
    seed: settings.seed,
    p10: quantile(values, 0.10),
    p25: quantile(values, 0.25),
    median: quantile(values, 0.50),
    p75: quantile(values, 0.75),
    p90: quantile(values, 0.90),
    probabilityAboveSpotPct,
  };
}

export function computeEvaEnterpriseValue(input: InstitutionalDcfInput): number | null {
  if (!finite(input.startingInvestedCapital) || input.startingInvestedCapital <= 0) return null;
  const baseResult = runInstitutionalDcf({ ...input, cashFlowMode: "fcff" });
  if (!baseResult.projections.length) return null;
  const rates = buildDiscountRatePath({ ...input, cashFlowMode: "fcff" });
  let pvEconomicProfit = 0;
  for (let i = 0; i < baseResult.projections.length; i++) {
    const projection = baseResult.projections[i];
    if (!finite(projection.openingInvestedCapital)) return null;
    const economicProfit = projection.nopat - projection.openingInvestedCapital * pct(rates[i]);
    pvEconomicProfit += economicProfit / projection.discountFactor;
  }
  const last = baseResult.projections[baseResult.projections.length - 1];
  if (!finite(last.closingInvestedCapital)) return null;
  const terminalRate = input.discount.terminalWaccPct ?? rates[rates.length - 1];
  const g = input.terminal.growthPct;
  if (terminalRate <= g) return null;
  const nextNopat = last.nopat * (1 + pct(g));
  const nextEconomicProfit = nextNopat - last.closingInvestedCapital * pct(terminalRate);
  const continuingEconomicProfit = nextEconomicProfit / (pct(terminalRate) - pct(g));
  const tvFactor = terminalDiscountFactor(rates, input.discount.timing, input.discount.stubFractionYears);
  return input.startingInvestedCapital + pvEconomicProfit + continuingEconomicProfit / tvFactor;
}

export function reconcileInstitutionalDcf(input: InstitutionalDcfInput): DcfReconciliation {
  const fcff = runInstitutionalDcf({ ...input, cashFlowMode: "fcff" });
  const fcfe = finite(input.startingNetDebt)
    ? runInstitutionalDcf({ ...input, cashFlowMode: "fcfe", terminal: input.terminal.method === "valueDriver" ? { ...input.terminal, method: "gordon" } : input.terminal })
    : null;
  const fcffEquity = fcff.equityValue;
  const fcfeEquity = fcfe?.equityValue ?? null;
  const fcffVsFcfeDeltaPct = finite(fcffEquity) && finite(fcfeEquity) && Math.abs(fcffEquity) > 1e-9
    ? ((fcfeEquity - fcffEquity) / Math.abs(fcffEquity)) * 100
    : null;
  const evaEnterpriseValue = computeEvaEnterpriseValue(input);
  const dcfVsEvaDeltaPct = finite(fcff.enterpriseValue) && finite(evaEnterpriseValue) && Math.abs(fcff.enterpriseValue) > 1e-9
    ? ((evaEnterpriseValue - fcff.enterpriseValue) / Math.abs(fcff.enterpriseValue)) * 100
    : null;
  return { fcffEquityValue: fcffEquity, fcfeEquityValue: fcfeEquity, fcffVsFcfeDeltaPct, evaEnterpriseValue, dcfVsEvaDeltaPct };
}

export function assessDcfModelSuitability(sector?: string | null, industry?: string | null, revenue?: number | null, ebit?: number | null): DcfSuitabilityAssessment {
  const text = `${sector ?? ""} ${industry ?? ""}`.toLowerCase();
  if (/bank|insurance|financial service|broker|capital market|asset management/.test(text)) {
    return {
      suitability: "low",
      primaryMethod: "FCFE / RESIDUAL INCOME",
      reasons: ["Debt and regulatory capital are operating inputs for many financial institutions, which weakens conventional FCFF/WACC interpretation."],
      companionMethods: ["Residual income", "Dividend discount", "Excess return on equity"],
    };
  }
  if (/reit|real estate investment trust/.test(text)) {
    return {
      suitability: "medium",
      primaryMethod: "NAV / AFFO + DCF",
      reasons: ["Property-level NAV, AFFO and capitalization rates should accompany corporate DCF."],
      companionMethods: ["NAV", "AFFO multiple", "Cap-rate valuation"],
    };
  }
  if (/biotech|biotechnology|drug|pharma/.test(text) && (!finite(revenue) || revenue <= 0 || (finite(ebit) && ebit < 0))) {
    return {
      suitability: "low",
      primaryMethod: "RISK-ADJUSTED NPV",
      reasons: ["Pre-commercial or loss-making drug pipelines are better modeled asset-by-asset with probability-of-success and launch assumptions."],
      companionMethods: ["rNPV", "Pipeline SOTP", "Cash runway"],
    };
  }
  if (/utility|utilities/.test(text)) {
    return {
      suitability: "medium",
      primaryMethod: "RATE-BASE DCF",
      reasons: ["Regulated returns, rate base and capital plans should explicitly drive the forecast."],
      companionMethods: ["Rate-base valuation", "Dividend discount"],
    };
  }
  if (/oil|gas|mining|metal|commodity|exploration/.test(text)) {
    return {
      suitability: "medium",
      primaryMethod: "ASSET / RESERVE DCF",
      reasons: ["Finite reserves, depletion, commodity decks and project economics should be modeled explicitly."],
      companionMethods: ["NAV", "Reserve DCF", "Cycle-normalized multiples"],
    };
  }
  return {
    suitability: "high",
    primaryMethod: "FCFF DCF",
    reasons: ["Conventional operating-company cash flows can be modeled through revenue, margins, reinvestment and cost of capital."],
    companionMethods: ["Trading comps", "Reverse DCF", "Residual income / EVA where applicable"],
  };
}
