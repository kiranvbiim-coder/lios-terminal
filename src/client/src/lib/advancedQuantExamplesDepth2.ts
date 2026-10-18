const seq = <T>(n: number, fn: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => fn(i));

export const ADVANCED_QUANT_DEPTH2_EXAMPLES: Record<string, Record<string, unknown>> = {
  "python.advanced.fixed-income.callable-oas": {
    faceValue: 100, couponRatePct: 5, maturityYears: 5, frequency: 2, flatRiskFreeRatePct: 4,
    shortRateVolatilityPct: 1, marketPrice: 100, callSchedule: [{ year: 3, callPricePct: 100 }],
  },
  "python.advanced.fixed-income.floating-rate-note": {
    faceValue: 100, referenceRatePct: 4.5, quotedMarginBps: 125, discountMarginBps: 140, maturityYears: 3, frequency: 4,
  },
  "python.advanced.fixed-income.inflation-linked-bond": {
    faceValue: 100, realCouponRatePct: 1.5, realYieldPct: 1.8, maturityYears: 7, frequency: 2,
    baseIndex: 250, currentIndex: 285, expectedInflationPct: 2.5,
  },
  "python.advanced.fixed-income.credit-spread-curve": {
    maturitiesYears: [1, 2, 3, 5, 7, 10], spreadsBps: [80, 95, 110, 135, 155, 175], recoveryRatePct: 40,
    queryMaturitiesYears: [1, 2.5, 5, 10],
  },

  "python.advanced.derivatives.local-volatility": {
    spot: 100, ratePct: 4, dividendYieldPct: 1, maturitiesYears: [0.25, 0.5, 1], strikes: [90, 100, 110],
    impliedVolatilityPct: [[23, 21, 22], [24, 22, 23], [25, 23, 24]],
  },
  "python.advanced.derivatives.portfolio-greeks": {
    positions: [
      { name: "long_call", quantity: 10, contractMultiplier: 100, spot: 100, strike: 100, maturityYears: 0.75, ratePct: 4, dividendYieldPct: 1, volatilityPct: 22, optionType: "call" },
      { name: "short_put", quantity: -5, contractMultiplier: 100, spot: 100, strike: 95, maturityYears: 0.75, ratePct: 4, dividendYieldPct: 1, volatilityPct: 24, optionType: "put" },
    ],
  },
  "python.advanced.derivatives.futures-basis": {
    spotPrice: 100, futuresPrice: 102.2, daysToMaturity: 180, financingRatePct: 5, incomeYieldPct: 1.5, storageCostPct: 0.5,
  },
  "python.advanced.derivatives.strategy-payoff": {
    legs: [
      { optionType: "call", strike: 95, quantity: 1, premium: 8, contractMultiplier: 100 },
      { optionType: "call", strike: 110, quantity: -1, premium: 3, contractMultiplier: 100 },
    ], underlyingMin: 70, underlyingMax: 140, gridPoints: 401,
  },

  "python.advanced.portfolio.black-litterman": {
    assets: ["Equity", "Bonds", "Gold"], marketWeights: [0.6, 0.3, 0.1],
    covarianceMatrix: [[4, 0.4, 0.2], [0.4, 1.5, 0.1], [0.2, 0.1, 3]], riskAversion: 2.5, tau: 0.05,
    viewMatrix: [[1, -1, 0], [0, 0, 1]], viewReturnsPct: [4, 6], viewUncertaintyPct2: [1.5, 2],
  },
  "python.advanced.portfolio.bayesian-mean-shrinkage": {
    assets: ["A", "B", "C"], sampleMeanReturnsPct: [10, 7, 13], standardErrorsPct: [4, 2, 6],
    priorMeanReturnsPct: [8, 8, 8], priorStdPct: 5,
  },
  "python.advanced.portfolio.ledoit-wolf-covariance": {
    assets: ["A", "B", "C"],
    returnsMatrixPct: seq(60, (i) => [
      Number((Math.sin(i / 5) * 1.2 + 0.2).toFixed(5)),
      Number((Math.cos(i / 7) * 0.8 + 0.1).toFixed(5)),
      Number((Math.sin(i / 9) * 1.5 + Math.cos(i / 13) * 0.4).toFixed(5)),
    ]),
  },

  "python.advanced.valuation.real-option": {
    underlyingProjectValue: 120, exerciseInvestment: 100, timeToDecisionYears: 2, riskFreeRatePct: 4,
    volatilityPct: 30, dividendOrDelayCostPct: 3, optionType: "defer",
  },
  "python.advanced.valuation.expectation-surface": {
    currentRevenue: 1000, netDebt: 150, sharesOutstanding: 100, years: 5, waccPct: 10, terminalGrowthPct: 3,
    // Illustrative analyst assumption, not provider data; percentage of total forecast revenue.
    taxRatePct: 25, reinvestmentPctOfRevenue: 8, revenueGrowthGridPct: [2, 5, 8, 11], ebitMarginGridPct: [15, 20, 25],
  },
  "python.advanced.valuation.project-finance": {
    initialEquityInvestment: 250, taxRatePct: 25, equityDiscountRatePct: 12, openingDebt: 400,
    years: [
      { revenue: 180, operatingCost: 90, capex: 10, debtService: 70, depreciation: 20 },
      { revenue: 200, operatingCost: 95, capex: 10, debtService: 70, depreciation: 20 },
      { revenue: 220, operatingCost: 100, capex: 12, debtService: 70, depreciation: 20 },
      { revenue: 240, operatingCost: 105, capex: 12, debtService: 70, depreciation: 20 },
      { revenue: 260, operatingCost: 110, capex: 15, debtService: 70, depreciation: 20 },
      { revenue: 280, operatingCost: 115, capex: 15, debtService: 50, depreciation: 20 },
    ],
  },
  "python.advanced.valuation.saas-cohort": {
    cohorts: [
      { name: "2026-Q1", startingCustomers: 1000, monthlyArpu: 100, monthlyLogoChurnPct: 2, monthlyExpansionPct: 0.5, grossMarginPct: 80, acquisitionCostPerCustomer: 450, monthsSinceAcquisition: 6 },
      { name: "2026-Q2", startingCustomers: 700, monthlyArpu: 110, monthlyLogoChurnPct: 1.8, monthlyExpansionPct: 0.6, grossMarginPct: 82, acquisitionCostPerCustomer: 500, monthsSinceAcquisition: 3 },
    ], forecastMonths: 60, annualDiscountRatePct: 12,
  },
  "python.advanced.valuation.insurance-embedded-value": {
    adjustedNetAssetValue: 500, futureProfitAfterTax: [90, 95, 100, 105, 110], costOfCapitalCharge: [15, 14, 13, 12, 11],
    discountRatePct: 10, newBusinessValue: 120,
  },
};
