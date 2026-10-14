import { ADVANCED_QUANT_DEPTH2_EXAMPLES } from "./advancedQuantExamplesDepth2";

const seq = <T>(n: number, fn: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => fn(i));
const returns60 = seq(60, (i) => Number((Math.sin(i / 5) * 1.2 + Math.cos(i / 11) * 0.7).toFixed(5)));
const trend60 = seq(60, (i) => Number((100 + i * 0.8 + Math.sin(i / 4) * 2).toFixed(5)));
const macro60 = seq(60, (i) => [Number((Math.sin(i / 7)).toFixed(5)), Number((Math.cos(i / 9)).toFixed(5))]);
const recession80 = seq(80, (i) => [Number((Math.sin(i / 8)).toFixed(5)), Number((Math.cos(i / 13)).toFixed(5)), Number(((i % 12) / 12).toFixed(5))]);

export const ADVANCED_QUANT_EXAMPLES: Record<string, Record<string, unknown>> = {
  ...ADVANCED_QUANT_DEPTH2_EXAMPLES,
  "python.advanced.fixed-income.bootstrap-par-curve": {
    maturitiesYears: [0.5, 1, 1.5, 2, 2.5, 3], parYieldsPct: [4.6, 4.5, 4.42, 4.35, 4.3, 4.28], frequency: 2,
  },
  "python.advanced.fixed-income.spread-analytics": {
    cashFlows: [{ timeYears: 1, amount: 5 }, { timeYears: 2, amount: 5 }, { timeYears: 3, amount: 105 }],
    curve: [{ maturityYears: 1, zeroRatePct: 4 }, { maturityYears: 2, zeroRatePct: 4.2 }, { maturityYears: 3, zeroRatePct: 4.3 }], marketPrice: 99,
  },
  "python.advanced.fixed-income.key-rate-risk": {
    cashFlows: [{ timeYears: 1, amount: 4 }, { timeYears: 2, amount: 4 }, { timeYears: 3, amount: 4 }, { timeYears: 5, amount: 104 }],
    curve: [{ maturityYears: 1, zeroRatePct: 4 }, { maturityYears: 2, zeroRatePct: 4.15 }, { maturityYears: 3, zeroRatePct: 4.25 }, { maturityYears: 5, zeroRatePct: 4.4 }],
    keyMaturitiesYears: [1, 2, 3, 5], bumpBps: 1,
  },
  "python.advanced.fixed-income.immunize-duration": {
    assets: [{ name: "2Y", price: 99, durationYears: 1.9 }, { name: "5Y", price: 101, durationYears: 4.5 }, { name: "10Y", price: 98, durationYears: 8.2 }], targetDurationYears: 5,
  },

  "python.advanced.derivatives.black-scholes-greeks": { spot: 100, strike: 100, maturityYears: 1, ratePct: 4, dividendYieldPct: 1, volatilityPct: 22, optionType: "call" },
  "python.advanced.derivatives.implied-volatility": { spot: 100, strike: 100, maturityYears: 1, ratePct: 4, dividendYieldPct: 1, optionType: "call", marketPrice: 10.5 },
  "python.advanced.derivatives.surface-arbitrage": {
    spot: 100, ratePct: 4, dividendYieldPct: 1,
    quotes: [{ maturityYears: 0.5, strike: 90, callPrice: 13 }, { maturityYears: 0.5, strike: 100, callPrice: 7 }, { maturityYears: 0.5, strike: 110, callPrice: 3 }, { maturityYears: 1, strike: 90, callPrice: 16 }, { maturityYears: 1, strike: 100, callPrice: 10 }, { maturityYears: 1, strike: 110, callPrice: 6 }],
  },
  "python.advanced.derivatives.exotic-monte-carlo": { spot: 100, strike: 100, maturityYears: 1, ratePct: 4, dividendYieldPct: 1, volatilityPct: 22, optionType: "call", payoffType: "asian_arithmetic", nPaths: 10000, nSteps: 52, seed: 42 },
  "python.advanced.derivatives.interest-rate-swap": { notional: 10000000, fixedRatePct: 4.1, maturityYears: 5, paymentsPerYear: 2, discountRatePct: 4, forwardRatePct: 4.35 },
  "python.advanced.derivatives.black-swaption": { notional: 10000000, forwardSwapRatePct: 4.2, strikePct: 4, volatilityPct: 25, optionExpiryYears: 1, swapAnnuity: 4.4, payer: true },

  "python.advanced.portfolio.hrp": { assets: ["A", "B", "C", "D"], covMatrix: [[4, 1, 0.5, 0.3], [1, 3, 0.4, 0.2], [0.5, 0.4, 5, 1.2], [0.3, 0.2, 1.2, 6]] },
  "python.advanced.portfolio.risk-budget": { assets: ["A", "B", "C"], covMatrix: [[4, 1, 0.5], [1, 3, 0.4], [0.5, 0.4, 5]], riskBudgets: [0.4, 0.35, 0.25], allowShort: false },
  "python.advanced.portfolio.factor-risk": { assets: ["A", "B", "C"], expectedReturnsPct: [8, 7, 10], factorLoadings: [[1, 0.3], [0.8, -0.2], [1.2, 0.6]], factorCovMatrix: [[4, 0.5], [0.5, 2]], idiosyncraticVariancePct2: [2, 1.5, 3], maxFactorExposureAbs: [1.1, 0.4], riskAversion: 1 },
  "python.advanced.portfolio.tracking-error": { assets: ["A", "B", "C"], expectedReturnsPct: [8, 7, 10], covMatrix: [[4, 1, 0.5], [1, 3, 0.4], [0.5, 0.4, 5]], benchmarkWeights: [0.4, 0.4, 0.2], maxTrackingErrorPct: 2.5 },
  "python.advanced.portfolio.tax-aware-rebalance": { assets: ["A", "B", "C"], targetWeights: [0.3, 0.4, 0.3], lots: [{ asset: "A", currentWeight: 0.5, costBasisWeightEquivalent: 0.35, unrealizedGainPct: 30 }, { asset: "B", currentWeight: 0.3, costBasisWeightEquivalent: 0.28, unrealizedGainPct: 5 }, { asset: "C", currentWeight: 0.2, costBasisWeightEquivalent: 0.22, unrealizedGainPct: -10 }], taxRatePct: 20, turnoverPenalty: 0.2, taxPenalty: 1 },
  "python.advanced.portfolio.stress-aware": { assets: ["A", "B", "C"], expectedReturnsPct: [8, 7, 10], covMatrix: [[4, 1, 0.5], [1, 3, 0.4], [0.5, 0.4, 5]], scenarios: [{ name: "recession", assetReturnsPct: [-15, -8, -22], probability: 0.5 }, { name: "inflation", assetReturnsPct: [-8, -5, -10], probability: 0.5 }], maxExpectedStressLossPct: 12, riskAversion: 1 },
  "python.advanced.portfolio.regime-blend": { assets: ["equity", "bonds", "cash"], regimeProbabilities: [0.6, 0.3, 0.1], regimeWeights: [[0.7, 0.25, 0.05], [0.3, 0.6, 0.1], [0.15, 0.35, 0.5]] },

  "python.advanced.valuation.dcf-sensitivity": {
    "freeCashFlows": [
      100,
      110,
      120
    ],
    "waccPct": 10,
    "terminalMethod": "gordon_growth",
    "terminalGrowthPct": 3,
    "netDebt": 50,
    "sharesOutstanding": 10,
    "waccGridPct": [
      9,
      10,
      11
    ],
    "terminalGrowthGridPct": [
      2,
      3,
      4
    ],
    "bearCase": {
      "freeCashFlows": [
        90,
        95,
        100
      ],
      "waccPct": 11,
      "terminalMethod": "gordon_growth",
      "terminalGrowthPct": 2
    },
    "bullCase": {
      "freeCashFlows": [
        110,
        125,
        140
      ],
      "waccPct": 9,
      "terminalMethod": "gordon_growth",
      "terminalGrowthPct": 4
    }
  },
  "python.advanced.valuation.probabilistic-dcf": { currentRevenue: 1000, netDebt: 150, sharesOutstanding: 100, years: 5, waccPct: 10, terminalGrowthPct: 3, scenarios: [{ name: "bear", revenueGrowthPct: 2, ebitMarginPct: 14, taxRatePct: 25, reinvestmentPctOfRevenue: 35, probability: 0.2 }, { name: "base", revenueGrowthPct: 7, ebitMarginPct: 20, taxRatePct: 25, reinvestmentPctOfRevenue: 30, probability: 0.6 }, { name: "bull", revenueGrowthPct: 12, ebitMarginPct: 25, taxRatePct: 25, reinvestmentPctOfRevenue: 28, probability: 0.2 }], nSimulations: 10000, growthVolPct: 2, marginVolPct: 2, seed: 42 },
  "python.advanced.valuation.reverse-dcf": { currentRevenue: 1000, marketEquityValue: 1500, netDebt: 150, years: 5, waccPct: 10, terminalGrowthPct: 3, ebitMarginPct: 20, taxRatePct: 25, reinvestmentPctOfRevenue: 30, solveFor: "revenue_growth" },
  "python.advanced.valuation.residual-income": { bookValueEquity: 800, roePct: [15, 14, 13, 12, 12], costOfEquityPct: 10, payoutRatioPct: 30, terminalRoePct: 11, terminalGrowthPct: 3 },
  "python.advanced.valuation.eva": { investedCapital: 1000, nopat: [120, 130, 140, 150, 160], waccPct: 9, capitalGrowthPct: 4, terminalEvaGrowthPct: 2 },
  "python.advanced.valuation.sotp": { segments: [{ name: "Software", metric: 100, multiple: 8, ownershipPct: 100 }, { name: "Services", metric: 80, multiple: 5, ownershipPct: 100 }], netDebt: 150, nonOperatingAssets: 50, sharesOutstanding: 100 },
  "python.advanced.valuation.merger-accretion": { acquirerShares: 100, acquirerNetIncome: 200, acquirerSharePrice: 40, targetShares: 30, targetNetIncome: 45, offerPricePerShare: 25, stockConsiderationPct: 60, debtInterestRatePct: 6, taxRatePct: 25, annualSynergiesAfterTax: 20 },

  "python.advanced.credit.merton": { equityValue: 500, equityVolPct: 35, debtFaceValue: 400, riskFreeRatePct: 4, maturityYears: 1 },
  "python.advanced.credit.rating-migration": { ratings: ["A", "BBB", "BB", "D"], transitionMatrix: [[0.88, 0.1, 0.015, 0.005], [0.04, 0.88, 0.07, 0.01], [0.01, 0.07, 0.86, 0.06], [0, 0, 0, 1]], currentDistribution: [0.4, 0.4, 0.2, 0], periods: 3 },
  "python.advanced.credit.creditmetrics": { exposures: [{ name: "A", ead: 1000000, pdPct: 1, lgdPct: 45 }, { name: "B", ead: 700000, pdPct: 3, lgdPct: 50 }, { name: "C", ead: 500000, pdPct: 6, lgdPct: 60 }], assetCorrelation: 0.2, confidencePct: 99, nSimulations: 20000, seed: 42 },
  "python.advanced.credit.stress-pd": { basePdPct: [1, 3, 8], macroShock: 1.5, beta: [0.8, 1, 1.3] },
  "python.advanced.credit.covenant-headroom": { ebitda: 120, netDebt: 360, interestExpense: 30, cashFlowFromOperations: 90, debtService: 50, maxNetLeverage: 3.5, minInterestCoverage: 3, minDebtServiceCoverage: 1.5 },

  "python.advanced.econometrics.weak-instruments": { endogenous: seq(60, (i) => i * 0.3 + Math.sin(i)), instruments: [seq(60, (i) => i * 0.2 + Math.cos(i / 3)), seq(60, (i) => Math.sin(i / 5))] },
  "python.advanced.econometrics.event-study": { assetReturnsPct: seq(160, (i) => Math.sin(i / 8) * 0.8 + (i === 130 ? 6 : 0)), marketReturnsPct: seq(160, (i) => Math.sin(i / 8) * 0.5), eventIndex: 130, estimationWindow: 100, eventWindowBefore: 3, eventWindowAfter: 3 },
  "python.advanced.econometrics.synthetic-control": { treatedPre: [1, 2, 3, 4, 5, 6], donorPre: [[1, 1.2], [2, 2.1], [3, 3.1], [4, 4.2], [5, 5.1], [6, 6.2]], treatedPost: [7.8, 9], donorPost: [[7, 7.2], [8, 8.2]] },
  "python.advanced.econometrics.propensity-match": { treated: seq(60, (i) => i % 2), covariates: seq(60, (i) => [i / 60, Math.sin(i / 7)]), outcome: seq(60, (i) => 5 + (i % 2) * 1.5 + i / 100), caliper: 0.2 },
  "python.advanced.econometrics.local-projections": { response: trend60, shock: returns60, controls: [seq(60, (i) => Math.cos(i / 6))], horizons: 6, lags: 2 },
  "python.advanced.econometrics.bayesian-var": { seriesNames: ["growth", "inflation"], data: [seq(60, (i) => 2 + Math.sin(i / 6)), seq(60, (i) => 3 + Math.cos(i / 8))], lags: 2, ridgePrior: 1, forecastSteps: 8 },

  "python.advanced.forecasting.model-tournament": { series: trend60, horizon: 8, validationWindow: 20, models: ["naive", "drift", "ar1"] },
  "python.advanced.forecasting.probabilistic-ar1": { series: trend60, horizon: 8, nSimulations: 10000, seed: 42, confidenceLevels: [0.5, 0.8, 0.95] },
  "python.advanced.forecasting.reconcile-hierarchy": { seriesNames: ["total", "A", "B"], baseForecasts: { total: [120, 125, 130], A: [55, 58, 60], B: [60, 62, 65] }, hierarchy: { total: ["A", "B"] } },
  "python.advanced.forecasting.nowcast": { targetHistory: seq(40, (i) => 2 + Math.sin(i / 5) + i * 0.02), indicatorHistory: seq(40, (i) => [Math.sin(i / 5), i / 40]), currentIndicators: [0.5, 1.05] },
  "python.advanced.forecasting.regime-conditioned": { regimeProbabilities: [0.6, 0.3, 0.1], regimeForecasts: [[2, 2.2, 2.4], [0, -0.5, -0.2], [4, 4.5, 5]] },

  "python.advanced.risk.tail-report": { assets: ["A", "B"], returnsMatrixPct: seq(120, (i) => [Math.sin(i / 5) * 1.2, Math.cos(i / 7) * 0.9]), weights: [0.6, 0.4], portfolioValue: 1000000, confidencePct: 99, ewmaLambda: 0.94, evtThresholdPct: 95, monteCarloSims: 20000, studentTDegreesFreedom: 6, seed: 42 },
  "python.advanced.risk.liquidity-var": { positions: [{ name: "A", marketValue: 500000, dailyVolumeValue: 5000000, bidAskSpreadBps: 8, dailyVolatilityPct: 2, liquidationDays: 1 }, { name: "B", marketValue: 300000, dailyVolumeValue: 1000000, bidAskSpreadBps: 20, dailyVolatilityPct: 3, liquidationDays: 1 }], participationRatePct: 20, confidencePct: 99 },
  "python.advanced.risk.reverse-stress": { assets: ["A", "B", "C"], weights: [0.4, 0.35, 0.25], covMatrixPct2: [[4, 1, 0.5], [1, 3, 0.4], [0.5, 0.4, 5]], targetPortfolioLossPct: 12 },
  "python.advanced.risk.correlation-breakdown": { assets: ["A", "B", "C"], weights: [0.4, 0.35, 0.25], assetVolatilityPct: [18, 12, 25], baseCorrelationMatrix: [[1, 0.3, 0.4], [0.3, 1, 0.2], [0.4, 0.2, 1]], stressedPairwiseCorrelation: 0.8 },

  "python.advanced.supply-chain.facility-location": { facilities: [{ name: "North", fixedCost: 100, capacity: 120 }, { name: "South", fixedCost: 80, capacity: 100 }], customerNames: ["C1", "C2"], demand: [70, 60], transportCost: [[2, 5], [4, 2]], maxOpenFacilities: 2 },
  "python.advanced.supply-chain.stochastic-inventory": { demandScenarios: [80, 90, 100, 110, 120, 130, 95, 105, 115, 125], unitPurchaseCost: 10, holdingCostPerUnit: 2, stockoutCostPerUnit: 8, salvageValuePerUnit: 1, maxOrderQuantity: 160 },
  "python.advanced.supply-chain.supplier-portfolio": { suppliers: [{ name: "A", unitCost: 10, capacity: 80, disruptionProbabilityPct: 5, emissionsPerUnit: 2 }, { name: "B", unitCost: 11, capacity: 80, disruptionProbabilityPct: 2, emissionsPerUnit: 1 }, { name: "C", unitCost: 9.5, capacity: 60, disruptionProbabilityPct: 12, emissionsPerUnit: 3 }], demand: 120, riskPenaltyPerExpectedLostUnit: 5, carbonPricePerEmissionUnit: 0.5, concentrationPenalty: 20, maxSupplierShare: 0.6 },
  "python.advanced.supply-chain.disruption-simulation": { suppliers: [{ name: "A", allocation: 60, disruptionProbabilityPct: 5, recoveryDaysMean: 20, recoveryDaysStd: 5, backupCostPremiumPct: 20 }, { name: "B", allocation: 40, disruptionProbabilityPct: 10, recoveryDaysMean: 30, recoveryDaysStd: 8, backupCostPremiumPct: 30 }], dailyDemand: 100, inventoryBufferUnits: 500, unitBaseCost: 10, simulations: 10000, seed: 42 },
  "python.advanced.supply-chain.resilience-frontier": { suppliers: [{ name: "A", unitCost: 10, capacity: 80, disruptionProbabilityPct: 5, emissionsPerUnit: 2 }, { name: "B", unitCost: 11, capacity: 80, disruptionProbabilityPct: 2, emissionsPerUnit: 1 }, { name: "C", unitCost: 9.5, capacity: 60, disruptionProbabilityPct: 12, emissionsPerUnit: 3 }], demand: 120, carbonPricePerEmissionUnit: 0.5, concentrationPenalty: 20, maxSupplierShare: 0.6, riskPenaltyGrid: [0, 1, 5, 10, 25] },

  "python.advanced.climate.financed-emissions": { assets: [{ name: "Issuer A", exposure: 50, enterpriseValueIncludingCash: 100, scope1: 10, scope2: 10, scope3: 20, revenue: 100 }, { name: "Issuer B", exposure: 40, enterpriseValueIncludingCash: 200, scope1: 20, scope2: 10, scope3: 30, revenue: 150 }], includeScope3: true },
  "python.advanced.climate.climate-var": { assets: [{ name: "A", marketValue: 1000, scope12Tonnes: 100, annualRevenue: 500, ebitdaMarginPct: 20, carbonCostPassThroughPct: 30, physicalHazardExposurePct: 20, physicalDamageSensitivity: 0.3, valuationMultiple: 8 }], scenarios: [{ name: "orderly", carbonPricePerTonne: 80, demandShockPct: 2, physicalHazardSeverity: 0.2 }, { name: "disorderly", carbonPricePerTonne: 180, demandShockPct: 8, physicalHazardSeverity: 0.6 }] },
  "python.advanced.climate.abatement-curve": { projects: [{ name: "Efficiency", annualAbatementTonnes: 100, annualizedCost: -2000, implementationCapex: 10000 }, { name: "Solar", annualAbatementTonnes: 200, annualizedCost: 6000, implementationCapex: 50000 }, { name: "CCUS", annualAbatementTonnes: 300, annualizedCost: 24000, implementationCapex: 120000 }], carbonPricePerTonne: 60, abatementTargetTonnes: 400 },
  "python.advanced.climate.transition-pathway": { baseEmissions: 1000, years: [2026, 2030, 2035, 2040], emissionsTargets: [950, 700, 450, 200], carbonPrices: [50, 80, 120, 180], revenueForecast: [1000, 1200, 1500, 1800] },

  "python.advanced.macro.yield-curve-signals": { maturitiesYears: [0.25, 1, 2, 5, 10, 30], yieldsPct: [4.8, 4.6, 4.4, 4.3, 4.35, 4.5] },
  "python.advanced.macro.financial-conditions-index": { indicatorNames: ["credit_spread", "equity_vol", "fx"], historicalValues: seq(40, (i) => [2 + Math.sin(i / 5), 18 + Math.cos(i / 6) * 4, 100 + Math.sin(i / 9) * 3]), tighteningDirection: [1, 1, 1], latestValues: [2.5, 22, 102] },
  "python.advanced.macro.recession-probability": { featureNames: ["curve", "claims", "fci"], historicalFeatures: recession80, recessionLabels: seq(80, (i) => (i % 20 >= 15 ? 1 : 0)), latestFeatures: [-0.5, 0.7, 0.8], l2PenaltyInverseC: 1 },
  "python.advanced.macro.inflation-decomposition": { components: [{ name: "Housing", weightPct: 35, inflationRatePct: 4 }, { name: "Food", weightPct: 20, inflationRatePct: 3 }, { name: "Energy", weightPct: 10, inflationRatePct: 6 }, { name: "Core services", weightPct: 35, inflationRatePct: 3.5 }] },
  "python.advanced.macro.company-transmission": { macroFactorNames: ["gdp", "rates"], macroChanges: macro60, companyMetricChange: seq(60, (i) => macro60[i][0] * 1.2 - macro60[i][1] * 0.6 + Math.sin(i / 3) * 0.05), scenarioMacroChanges: { gdp: -2, rates: 1.5 } },
  "python.advanced.macro.fiscal-multiplier": { baselineGdp: 100000, fiscalImpulse: 1000, multiplier: 1.4, importLeakagePct: 20, crowdingOutPct: 10, taxFeedbackPct: 15 },

  "python.advanced.research.evidence-graph": { claims: [{ claimId: "c1", text: "Margins are improving", evidence: [{ sourceId: "10-K", reliabilityScore: 95, stance: "supports", strength: 0.9 }, { sourceId: "channel-check", reliabilityScore: 70, stance: "refutes", strength: 0.4 }] }, { claimId: "c2", text: "Demand remains strong", evidence: [{ sourceId: "earnings", reliabilityScore: 90, stance: "supports", strength: 0.8 }] }] },
  "python.advanced.research.filing-diff": { oldText: "Revenue was 100. Gross margin was 30%. Demand remained stable.", newText: "Revenue was 120. Gross margin was 32%. Demand remained stable. Supply risk increased.", maxChanges: 50 },
  "python.advanced.research.consensus-divergence": { analystEstimates: [90, 95, 100, 102, 108, 110], internalEstimate: 125, marketPrice: 100 },
  "python.advanced.research.catalyst-monitor": { catalysts: [{ name: "margin", currentValue: 18, triggerValue: 20, direction: "above" }, { name: "leverage", currentValue: 2.5, triggerValue: 3, direction: "below" }] },

  "python.advanced.financial-modeling.three-statement": { forecastYears: 5, startingRevenue: 1000, revenueGrowthPct: [8, 7, 6, 5, 5], ebitdaMarginPct: [20, 21, 22, 22, 23], depreciationPctOfRevenue: [4, 4, 4, 4, 4], capexPctOfRevenue: [5, 5, 5, 5, 5], netWorkingCapitalPctOfRevenue: [10, 10, 10, 10, 10], taxRatePct: 25, startingCash: 100, minimumCash: 50, startingDebt: 300, debtInterestRatePct: 6, mandatoryDebtAmortizationPct: 5, debtCapacity: 600, startingNetPPE: 500, startingNWC: 100, annualDividends: [10, 10, 10, 10, 10], cashSweep: true },

  "python.advanced.decision.model-tournament": { candidates: [{ name: "DCF", estimate: 120, lowerBound: 100, upperBound: 140, assuranceScore: 92, validationScore: 90, dataQualityScore: 88, suitabilityScore: 95, historicalRmse: 10 }, { name: "Residual income", estimate: 115, lowerBound: 100, upperBound: 130, assuranceScore: 90, validationScore: 88, dataQualityScore: 90, suitabilityScore: 85, historicalRmse: 12 }, { name: "Comps", estimate: 130, lowerBound: 110, upperBound: 150, assuranceScore: 85, validationScore: 82, dataQualityScore: 92, suitabilityScore: 80, historicalRmse: 15 }], disagreementWarningPct: 20, outlierMadThreshold: 3.5 },
  "python.advanced.decision.scenario-graph": { nodes: [{ name: "rates", baseline: 4, domain: "macro" }, { name: "wacc", baseline: 9, domain: "valuation" }, { name: "equity_value", baseline: 100, domain: "valuation" }, { name: "portfolio", baseline: 100, domain: "portfolio" }], edges: [{ source: "rates", target: "wacc", coefficient: 0.7, mode: "absolute" }, { source: "wacc", target: "equity_value", coefficient: -5, mode: "absolute" }, { source: "equity_value", target: "portfolio", coefficient: 0.4, mode: "absolute" }], shocks: [{ node: "rates", change: 1.5 }] },
  "python.advanced.decision.uncertainty": { centralEstimate: 120, factors: [{ name: "terminal_margin", standardDeviation: 2, sensitivity: 5, category: "parameter" }, { name: "wacc", standardDeviation: 1, sensitivity: -8, category: "market" }, { name: "revenue", standardDeviation: 3, sensitivity: 2, category: "data" }], correlationMatrix: [[1, 0.2, 0.1], [0.2, 1, 0.1], [0.1, 0.1, 1]], confidencePct: 95 },
  "python.advanced.decision.value-of-information": { stateNames: ["boom", "base", "recession"], stateProbabilities: [0.2, 0.6, 0.2], alternatives: [{ name: "invest", payoffs: [40, 15, -30] }, { name: "wait", payoffs: [10, 8, 2] }, { name: "hedge", payoffs: [18, 10, 5] }] },
  "python.advanced.decision.mcda": { criteria: [{ name: "return", weight: 0.4, direction: "maximize" }, { name: "risk", weight: 0.35, direction: "minimize" }, { name: "liquidity", weight: 0.25, direction: "maximize" }], alternatives: [{ name: "A", values: { return: 12, risk: 8, liquidity: 9 } }, { name: "B", values: { return: 10, risk: 5, liquidity: 7 } }, { name: "C", values: { return: 14, risk: 12, liquidity: 5 } }] },
};
