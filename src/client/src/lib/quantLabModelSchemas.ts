import type { JsonFieldSchema } from "@/components/ui/StructuredJsonEditor";

// Auto-derived per-model structured form schemas for the Quant Lab experiment parameter
// editor. Field kinds/defaults are generated from the EXAMPLES/ADVANCED_QUANT_EXAMPLES seed
// values in this panel; every top-level (and, for object-array rows, every item) property of
// each covered model's example JSON has a matching schema field of the same key.
//
// All five previously raw-JSON models now have structured schemas, including
// nested object arrays and dynamic records. Unknown keys are still preserved by
// StructuredJsonEditor for forward-compatible payloads.
export const QUANT_LAB_MODEL_SCHEMAS: Record<string, JsonFieldSchema[]> = {
  "python.advanced.fixed-income.callable-oas": [
    { kind: "number", key: "faceValue", label: "FACE VALUE", default: 100 },
    { kind: "number", key: "couponRatePct", label: "COUPON RATE PCT", default: 5 },
    { kind: "number", key: "maturityYears", label: "MATURITY YEARS", default: 5 },
    { kind: "number", key: "frequency", label: "FREQUENCY", default: 2 },
    { kind: "number", key: "flatRiskFreeRatePct", label: "FLAT RISK FREE RATE PCT", default: 4 },
    { kind: "number", key: "shortRateVolatilityPct", label: "SHORT RATE VOLATILITY PCT", default: 1 },
    { kind: "number", key: "marketPrice", label: "MARKET PRICE", default: 100 },
    { kind: "objectArray", key: "callSchedule", label: "CALL SCHEDULE", itemFields: [
      { kind: "number", key: "year", label: "YEAR", default: 3 },
      { kind: "number", key: "callPricePct", label: "CALL PRICE PCT", default: 100 }
    ], default: [
      {
        "year": 3,
        "callPricePct": 100
      }
    ] }
  ],
  "python.advanced.fixed-income.floating-rate-note": [
    { kind: "number", key: "faceValue", label: "FACE VALUE", default: 100 },
    { kind: "number", key: "referenceRatePct", label: "REFERENCE RATE PCT", default: 4.5 },
    { kind: "number", key: "quotedMarginBps", label: "QUOTED MARGIN BPS", default: 125 },
    { kind: "number", key: "discountMarginBps", label: "DISCOUNT MARGIN BPS", default: 140 },
    { kind: "number", key: "maturityYears", label: "MATURITY YEARS", default: 3 },
    { kind: "number", key: "frequency", label: "FREQUENCY", default: 4 }
  ],
  "python.advanced.fixed-income.inflation-linked-bond": [
    { kind: "number", key: "faceValue", label: "FACE VALUE", default: 100 },
    { kind: "number", key: "realCouponRatePct", label: "REAL COUPON RATE PCT", default: 1.5 },
    { kind: "number", key: "realYieldPct", label: "REAL YIELD PCT", default: 1.8 },
    { kind: "number", key: "maturityYears", label: "MATURITY YEARS", default: 7 },
    { kind: "number", key: "frequency", label: "FREQUENCY", default: 2 },
    { kind: "number", key: "baseIndex", label: "BASE INDEX", default: 250 },
    { kind: "number", key: "currentIndex", label: "CURRENT INDEX", default: 285 },
    { kind: "number", key: "expectedInflationPct", label: "EXPECTED INFLATION PCT", default: 2.5 }
  ],
  "python.advanced.fixed-income.credit-spread-curve": [
    { kind: "numberArray", key: "maturitiesYears", label: "MATURITIES YEARS", default: [
      1,
      2,
      3,
      5,
      7,
      10
    ] },
    { kind: "numberArray", key: "spreadsBps", label: "SPREADS BPS", default: [
      80,
      95,
      110,
      135,
      155,
      175
    ] },
    { kind: "number", key: "recoveryRatePct", label: "RECOVERY RATE PCT", default: 40 },
    { kind: "numberArray", key: "queryMaturitiesYears", label: "QUERY MATURITIES YEARS", default: [
      1,
      2.5,
      5,
      10
    ] }
  ],
  "python.advanced.derivatives.local-volatility": [
    { kind: "number", key: "spot", label: "SPOT", default: 100 },
    { kind: "number", key: "ratePct", label: "RATE PCT", default: 4 },
    { kind: "number", key: "dividendYieldPct", label: "DIVIDEND YIELD PCT", default: 1 },
    { kind: "numberArray", key: "maturitiesYears", label: "MATURITIES YEARS", default: [
      0.25,
      0.5,
      1
    ] },
    { kind: "numberArray", key: "strikes", label: "STRIKES", default: [
      90,
      100,
      110
    ] },
    { kind: "numberMatrix", key: "impliedVolatilityPct", label: "IMPLIED VOLATILITY PCT", default: [
      [
        23,
        21,
        22
      ],
      [
        24,
        22,
        23
      ],
      [
        25,
        23,
        24
      ]
    ] }
  ],
  "python.advanced.derivatives.portfolio-greeks": [
    { kind: "objectArray", key: "positions", label: "POSITIONS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "long_call" },
      { kind: "number", key: "quantity", label: "QUANTITY", default: 10 },
      { kind: "number", key: "contractMultiplier", label: "CONTRACT MULTIPLIER", default: 100 },
      { kind: "number", key: "spot", label: "SPOT", default: 100 },
      { kind: "number", key: "strike", label: "STRIKE", default: 100 },
      { kind: "number", key: "maturityYears", label: "MATURITY YEARS", default: 0.75 },
      { kind: "number", key: "ratePct", label: "RATE PCT", default: 4 },
      { kind: "number", key: "dividendYieldPct", label: "DIVIDEND YIELD PCT", default: 1 },
      { kind: "number", key: "volatilityPct", label: "VOLATILITY PCT", default: 22 },
      { kind: "select", key: "optionType", label: "OPTION TYPE", options: ["call","put"], default: "call" }
    ], default: [
      {
        "name": "long_call",
        "quantity": 10,
        "contractMultiplier": 100,
        "spot": 100,
        "strike": 100,
        "maturityYears": 0.75,
        "ratePct": 4,
        "dividendYieldPct": 1,
        "volatilityPct": 22,
        "optionType": "call"
      },
      {
        "name": "short_put",
        "quantity": -5,
        "contractMultiplier": 100,
        "spot": 100,
        "strike": 95,
        "maturityYears": 0.75,
        "ratePct": 4,
        "dividendYieldPct": 1,
        "volatilityPct": 24,
        "optionType": "put"
      }
    ] }
  ],
  "python.advanced.derivatives.futures-basis": [
    { kind: "number", key: "spotPrice", label: "SPOT PRICE", default: 100 },
    { kind: "number", key: "futuresPrice", label: "FUTURES PRICE", default: 102.2 },
    { kind: "number", key: "daysToMaturity", label: "DAYS TO MATURITY", default: 180 },
    { kind: "number", key: "financingRatePct", label: "FINANCING RATE PCT", default: 5 },
    { kind: "number", key: "incomeYieldPct", label: "INCOME YIELD PCT", default: 1.5 },
    { kind: "number", key: "storageCostPct", label: "STORAGE COST PCT", default: 0.5 }
  ],
  "python.advanced.derivatives.strategy-payoff": [
    { kind: "objectArray", key: "legs", label: "LEGS", itemFields: [
      { kind: "select", key: "optionType", label: "OPTION TYPE", options: ["call","put"], default: "call" },
      { kind: "number", key: "strike", label: "STRIKE", default: 95 },
      { kind: "number", key: "quantity", label: "QUANTITY", default: 1 },
      { kind: "number", key: "premium", label: "PREMIUM", default: 8 },
      { kind: "number", key: "contractMultiplier", label: "CONTRACT MULTIPLIER", default: 100 }
    ], default: [
      {
        "optionType": "call",
        "strike": 95,
        "quantity": 1,
        "premium": 8,
        "contractMultiplier": 100
      },
      {
        "optionType": "call",
        "strike": 110,
        "quantity": -1,
        "premium": 3,
        "contractMultiplier": 100
      }
    ] },
    { kind: "number", key: "underlyingMin", label: "UNDERLYING MIN", default: 70 },
    { kind: "number", key: "underlyingMax", label: "UNDERLYING MAX", default: 140 },
    { kind: "number", key: "gridPoints", label: "GRID POINTS", default: 401 }
  ],
  "python.advanced.portfolio.black-litterman": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "Equity",
      "Bonds",
      "Gold"
    ] },
    { kind: "numberArray", key: "marketWeights", label: "MARKET WEIGHTS", default: [
      0.6,
      0.3,
      0.1
    ] },
    { kind: "numberMatrix", key: "covarianceMatrix", label: "COVARIANCE MATRIX", default: [
      [
        4,
        0.4,
        0.2
      ],
      [
        0.4,
        1.5,
        0.1
      ],
      [
        0.2,
        0.1,
        3
      ]
    ] },
    { kind: "number", key: "riskAversion", label: "RISK AVERSION", default: 2.5 },
    { kind: "number", key: "tau", label: "TAU", default: 0.05 },
    { kind: "numberMatrix", key: "viewMatrix", label: "VIEW MATRIX", default: [
      [
        1,
        -1,
        0
      ],
      [
        0,
        0,
        1
      ]
    ] },
    { kind: "numberArray", key: "viewReturnsPct", label: "VIEW RETURNS PCT", default: [
      4,
      6
    ] },
    { kind: "numberArray", key: "viewUncertaintyPct2", label: "VIEW UNCERTAINTY PCT 2", default: [
      1.5,
      2
    ] }
  ],
  "python.advanced.portfolio.bayesian-mean-shrinkage": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "A",
      "B",
      "C"
    ] },
    { kind: "numberArray", key: "sampleMeanReturnsPct", label: "SAMPLE MEAN RETURNS PCT", default: [
      10,
      7,
      13
    ] },
    { kind: "numberArray", key: "standardErrorsPct", label: "STANDARD ERRORS PCT", default: [
      4,
      2,
      6
    ] },
    { kind: "numberArray", key: "priorMeanReturnsPct", label: "PRIOR MEAN RETURNS PCT", default: [
      8,
      8,
      8
    ] },
    { kind: "number", key: "priorStdPct", label: "PRIOR STD PCT", default: 5 }
  ],
  "python.advanced.portfolio.ledoit-wolf-covariance": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "A",
      "B",
      "C"
    ] },
    { kind: "numberMatrix", key: "returnsMatrixPct", label: "RETURNS MATRIX PCT", default: [
      [
        0.2,
        0.9,
        0.4
      ],
      [
        0.4384,
        0.89185,
        0.56514
      ],
      [
        0.6673,
        0.86757,
        0.72587
      ],
      [
        0.87757,
        0.82765,
        0.88019
      ],
      [
        1.06083,
        0.7729,
        1.02615
      ],
      [
        1.20977,
        0.70445,
        1.1619
      ],
      [
        1.31845,
        0.62368,
        1.2857
      ],
      [
        1.38254,
        0.53224,
        1.39595
      ],
      [
        1.39949,
        0.432,
        1.49118
      ],
      [
        1.36862,
        0.32499,
        1.57012
      ],
      [
        1.29116,
        0.2134,
        1.63167
      ],
      [
        1.1702,
        0.09949,
        1.67494
      ],
      [
        1.01056,
        -0.0144,
        1.69925
      ],
      [
        0.8186,
        -0.12596,
        1.70416
      ],
      [
        0.60199,
        -0.23292,
        1.68944
      ],
      [
        0.36934,
        -0.33309,
        1.6551
      ],
      [
        0.12995,
        -0.42444,
        1.60139
      ],
      [
        -0.10665,
        -0.50511,
        1.52878
      ],
      [
        -0.33102,
        -0.57345,
        1.43799
      ],
      [
        -0.53423,
        -0.62807,
        1.32994
      ],
      [
        -0.70816,
        -0.66785,
        1.20576
      ],
      [
        -0.84589,
        -0.69199,
        1.0668
      ],
      [
        -0.94192,
        -0.7,
        0.91457
      ],
      [
        -0.99243,
        -0.69171,
        0.75074
      ],
      [
        -0.9954,
        -0.66728,
        0.57715
      ],
      [
        -0.95071,
        -0.62723,
        0.39575
      ],
      [
        -0.86015,
        -0.57236,
        0.20858
      ],
      [
        -0.72732,
        -0.50379,
        0.01776
      ],
      [
        -0.55752,
        -0.42291,
        -0.17451
      ],
      [
        -0.35752,
        -0.33139,
        -0.36605
      ],
      [
        -0.1353,
        -0.23108,
        -0.55465
      ],
      [
        0.10029,
        -0.12402,
        -0.73813
      ],
      [
        0.33986,
        -0.0124,
        -0.91438
      ],
      [
        0.57385,
        0.10152,
        -1.08134
      ],
      [
        0.79294,
        0.2154,
        -1.23708
      ],
      [
        0.98838,
        0.32693,
        -1.37979
      ],
      [
        1.1524,
        0.43384,
        -1.50779
      ],
      [
        1.27845,
        0.53394,
        -1.61959
      ],
      [
        1.3615,
        0.62521,
        -1.71387
      ],
      [
        1.39825,
        0.70577,
        -1.78952
      ],
      [
        1.38723,
        0.774,
        -1.84564
      ],
      [
        1.32888,
        0.82849,
        -1.88156
      ],
      [
        1.22552,
        0.86814,
        -1.89684
      ],
      [
        1.08128,
        0.89214,
        -1.89129
      ],
      [
        0.9019,
        0.9,
        -1.86494
      ],
      [
        0.69454,
        0.89156,
        -1.81809
      ],
      [
        0.46747,
        0.867,
        -1.75125
      ],
      [
        0.22973,
        0.82681,
        -1.66518
      ],
      [
        -0.00919,
        0.77181,
        -1.56085
      ],
      [
        -0.23977,
        0.70312,
        -1.43947
      ],
      [
        -0.45283,
        0.62215,
        -1.30241
      ],
      [
        -0.63985,
        0.53054,
        -1.15124
      ],
      [
        -0.79339,
        0.43016,
        -0.9877
      ],
      [
        -0.90733,
        0.32305,
        -0.81366
      ],
      [
        -0.97712,
        0.21139,
        -0.6311
      ],
      [
        -0.99999,
        0.09747,
        -0.44213
      ],
      [
        -0.97501,
        -0.0164,
        -0.24888
      ],
      [
        -0.90319,
        -0.1279,
        -0.05358
      ],
      [
        -0.78739,
        -0.23476,
        0.14155
      ],
      [
        -0.63223,
        -0.33479,
        0.3343
      ]
    ] }
  ],
  "python.advanced.valuation.real-option": [
    { kind: "number", key: "underlyingProjectValue", label: "UNDERLYING PROJECT VALUE", default: 120 },
    { kind: "number", key: "exerciseInvestment", label: "EXERCISE INVESTMENT", default: 100 },
    { kind: "number", key: "timeToDecisionYears", label: "TIME TO DECISION YEARS", default: 2 },
    { kind: "number", key: "riskFreeRatePct", label: "RISK FREE RATE PCT", default: 4 },
    { kind: "number", key: "volatilityPct", label: "VOLATILITY PCT", default: 30 },
    { kind: "number", key: "dividendOrDelayCostPct", label: "DIVIDEND OR DELAY COST PCT", default: 3 },
    { kind: "string", key: "optionType", label: "OPTION TYPE", default: "defer" }
  ],
  "python.advanced.valuation.expectation-surface": [
    { kind: "number", key: "currentRevenue", label: "CURRENT REVENUE", default: 1000 },
    { kind: "number", key: "netDebt", label: "NET DEBT", default: 150 },
    { kind: "number", key: "sharesOutstanding", label: "SHARES OUTSTANDING", default: 100 },
    { kind: "number", key: "years", label: "YEARS", default: 5 },
    { kind: "number", key: "waccPct", label: "WACC PCT", default: 10 },
    { kind: "number", key: "terminalGrowthPct", label: "TERMINAL GROWTH PCT", default: 3 },
    { kind: "number", key: "taxRatePct", label: "TAX RATE PCT", default: 25 },
    { kind: "number", key: "reinvestmentPctOfRevenue", label: "REINVESTMENT PCT OF REVENUE", default: 8 },
    { kind: "numberArray", key: "revenueGrowthGridPct", label: "REVENUE GROWTH GRID PCT", default: [
      2,
      5,
      8,
      11
    ] },
    { kind: "numberArray", key: "ebitMarginGridPct", label: "EBIT MARGIN GRID PCT", default: [
      15,
      20,
      25
    ] }
  ],
  "python.advanced.valuation.project-finance": [
    { kind: "number", key: "initialEquityInvestment", label: "INITIAL EQUITY INVESTMENT", default: 250 },
    { kind: "number", key: "taxRatePct", label: "TAX RATE PCT", default: 25 },
    { kind: "number", key: "equityDiscountRatePct", label: "EQUITY DISCOUNT RATE PCT", default: 12 },
    { kind: "number", key: "openingDebt", label: "OPENING DEBT", default: 400 },
    { kind: "objectArray", key: "years", label: "YEARS", itemFields: [
      { kind: "number", key: "revenue", label: "REVENUE", default: 180 },
      { kind: "number", key: "operatingCost", label: "OPERATING COST", default: 90 },
      { kind: "number", key: "capex", label: "CAPEX", default: 10 },
      { kind: "number", key: "debtService", label: "DEBT SERVICE", default: 70 },
      { kind: "number", key: "depreciation", label: "DEPRECIATION", default: 20 }
    ], default: [
      {
        "revenue": 180,
        "operatingCost": 90,
        "capex": 10,
        "debtService": 70,
        "depreciation": 20
      },
      {
        "revenue": 200,
        "operatingCost": 95,
        "capex": 10,
        "debtService": 70,
        "depreciation": 20
      },
      {
        "revenue": 220,
        "operatingCost": 100,
        "capex": 12,
        "debtService": 70,
        "depreciation": 20
      },
      {
        "revenue": 240,
        "operatingCost": 105,
        "capex": 12,
        "debtService": 70,
        "depreciation": 20
      },
      {
        "revenue": 260,
        "operatingCost": 110,
        "capex": 15,
        "debtService": 70,
        "depreciation": 20
      },
      {
        "revenue": 280,
        "operatingCost": 115,
        "capex": 15,
        "debtService": 50,
        "depreciation": 20
      }
    ] }
  ],
  "python.advanced.valuation.saas-cohort": [
    { kind: "objectArray", key: "cohorts", label: "COHORTS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "2026-Q1" },
      { kind: "number", key: "startingCustomers", label: "STARTING CUSTOMERS", default: 1000 },
      { kind: "number", key: "monthlyArpu", label: "MONTHLY ARPU", default: 100 },
      { kind: "number", key: "monthlyLogoChurnPct", label: "MONTHLY LOGO CHURN PCT", default: 2 },
      { kind: "number", key: "monthlyExpansionPct", label: "MONTHLY EXPANSION PCT", default: 0.5 },
      { kind: "number", key: "grossMarginPct", label: "GROSS MARGIN PCT", default: 80 },
      { kind: "number", key: "acquisitionCostPerCustomer", label: "ACQUISITION COST PER CUSTOMER", default: 450 },
      { kind: "number", key: "monthsSinceAcquisition", label: "MONTHS SINCE ACQUISITION", default: 6 }
    ], default: [
      {
        "name": "2026-Q1",
        "startingCustomers": 1000,
        "monthlyArpu": 100,
        "monthlyLogoChurnPct": 2,
        "monthlyExpansionPct": 0.5,
        "grossMarginPct": 80,
        "acquisitionCostPerCustomer": 450,
        "monthsSinceAcquisition": 6
      },
      {
        "name": "2026-Q2",
        "startingCustomers": 700,
        "monthlyArpu": 110,
        "monthlyLogoChurnPct": 1.8,
        "monthlyExpansionPct": 0.6,
        "grossMarginPct": 82,
        "acquisitionCostPerCustomer": 500,
        "monthsSinceAcquisition": 3
      }
    ] },
    { kind: "number", key: "forecastMonths", label: "FORECAST MONTHS", default: 60 },
    { kind: "number", key: "annualDiscountRatePct", label: "ANNUAL DISCOUNT RATE PCT", default: 12 }
  ],
  "python.advanced.valuation.insurance-embedded-value": [
    { kind: "number", key: "adjustedNetAssetValue", label: "ADJUSTED NET ASSET VALUE", default: 500 },
    { kind: "numberArray", key: "futureProfitAfterTax", label: "FUTURE PROFIT AFTER TAX", default: [
      90,
      95,
      100,
      105,
      110
    ] },
    { kind: "numberArray", key: "costOfCapitalCharge", label: "COST OF CAPITAL CHARGE", default: [
      15,
      14,
      13,
      12,
      11
    ] },
    { kind: "number", key: "discountRatePct", label: "DISCOUNT RATE PCT", default: 10 },
    { kind: "number", key: "newBusinessValue", label: "NEW BUSINESS VALUE", default: 120 }
  ],
  "python.advanced.fixed-income.bootstrap-par-curve": [
    { kind: "numberArray", key: "maturitiesYears", label: "MATURITIES YEARS", default: [
      0.5,
      1,
      1.5,
      2,
      2.5,
      3
    ] },
    { kind: "numberArray", key: "parYieldsPct", label: "PAR YIELDS PCT", default: [
      4.6,
      4.5,
      4.42,
      4.35,
      4.3,
      4.28
    ] },
    { kind: "number", key: "frequency", label: "FREQUENCY", default: 2 }
  ],
  "python.advanced.fixed-income.spread-analytics": [
    { kind: "objectArray", key: "cashFlows", label: "CASH FLOWS", itemFields: [
      { kind: "number", key: "timeYears", label: "TIME YEARS", default: 1 },
      { kind: "number", key: "amount", label: "AMOUNT", default: 5 }
    ], default: [
      {
        "timeYears": 1,
        "amount": 5
      },
      {
        "timeYears": 2,
        "amount": 5
      },
      {
        "timeYears": 3,
        "amount": 105
      }
    ] },
    { kind: "objectArray", key: "curve", label: "CURVE", itemFields: [
      { kind: "number", key: "maturityYears", label: "MATURITY YEARS", default: 1 },
      { kind: "number", key: "zeroRatePct", label: "ZERO RATE PCT", default: 4 }
    ], default: [
      {
        "maturityYears": 1,
        "zeroRatePct": 4
      },
      {
        "maturityYears": 2,
        "zeroRatePct": 4.2
      },
      {
        "maturityYears": 3,
        "zeroRatePct": 4.3
      }
    ] },
    { kind: "number", key: "marketPrice", label: "MARKET PRICE", default: 99 }
  ],
  "python.advanced.fixed-income.key-rate-risk": [
    { kind: "objectArray", key: "cashFlows", label: "CASH FLOWS", itemFields: [
      { kind: "number", key: "timeYears", label: "TIME YEARS", default: 1 },
      { kind: "number", key: "amount", label: "AMOUNT", default: 4 }
    ], default: [
      {
        "timeYears": 1,
        "amount": 4
      },
      {
        "timeYears": 2,
        "amount": 4
      },
      {
        "timeYears": 3,
        "amount": 4
      },
      {
        "timeYears": 5,
        "amount": 104
      }
    ] },
    { kind: "objectArray", key: "curve", label: "CURVE", itemFields: [
      { kind: "number", key: "maturityYears", label: "MATURITY YEARS", default: 1 },
      { kind: "number", key: "zeroRatePct", label: "ZERO RATE PCT", default: 4 }
    ], default: [
      {
        "maturityYears": 1,
        "zeroRatePct": 4
      },
      {
        "maturityYears": 2,
        "zeroRatePct": 4.15
      },
      {
        "maturityYears": 3,
        "zeroRatePct": 4.25
      },
      {
        "maturityYears": 5,
        "zeroRatePct": 4.4
      }
    ] },
    { kind: "numberArray", key: "keyMaturitiesYears", label: "KEY MATURITIES YEARS", default: [
      1,
      2,
      3,
      5
    ] },
    { kind: "number", key: "bumpBps", label: "BUMP BPS", default: 1 }
  ],
  "python.advanced.fixed-income.immunize-duration": [
    { kind: "objectArray", key: "assets", label: "ASSETS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "2Y" },
      { kind: "number", key: "price", label: "PRICE", default: 99 },
      { kind: "number", key: "durationYears", label: "DURATION YEARS", default: 1.9 }
    ], default: [
      {
        "name": "2Y",
        "price": 99,
        "durationYears": 1.9
      },
      {
        "name": "5Y",
        "price": 101,
        "durationYears": 4.5
      },
      {
        "name": "10Y",
        "price": 98,
        "durationYears": 8.2
      }
    ] },
    { kind: "number", key: "targetDurationYears", label: "TARGET DURATION YEARS", default: 5 }
  ],
  "python.advanced.derivatives.black-scholes-greeks": [
    { kind: "number", key: "spot", label: "SPOT", default: 100 },
    { kind: "number", key: "strike", label: "STRIKE", default: 100 },
    { kind: "number", key: "maturityYears", label: "MATURITY YEARS", default: 1 },
    { kind: "number", key: "ratePct", label: "RATE PCT", default: 4 },
    { kind: "number", key: "dividendYieldPct", label: "DIVIDEND YIELD PCT", default: 1 },
    { kind: "number", key: "volatilityPct", label: "VOLATILITY PCT", default: 22 },
    { kind: "select", key: "optionType", label: "OPTION TYPE", options: ["call","put"], default: "call" }
  ],
  "python.advanced.derivatives.implied-volatility": [
    { kind: "number", key: "spot", label: "SPOT", default: 100 },
    { kind: "number", key: "strike", label: "STRIKE", default: 100 },
    { kind: "number", key: "maturityYears", label: "MATURITY YEARS", default: 1 },
    { kind: "number", key: "ratePct", label: "RATE PCT", default: 4 },
    { kind: "number", key: "dividendYieldPct", label: "DIVIDEND YIELD PCT", default: 1 },
    { kind: "select", key: "optionType", label: "OPTION TYPE", options: ["call","put"], default: "call" },
    { kind: "number", key: "marketPrice", label: "MARKET PRICE", default: 10.5 }
  ],
  "python.advanced.derivatives.surface-arbitrage": [
    { kind: "number", key: "spot", label: "SPOT", default: 100 },
    { kind: "number", key: "ratePct", label: "RATE PCT", default: 4 },
    { kind: "number", key: "dividendYieldPct", label: "DIVIDEND YIELD PCT", default: 1 },
    { kind: "objectArray", key: "quotes", label: "QUOTES", itemFields: [
      { kind: "number", key: "maturityYears", label: "MATURITY YEARS", default: 0.5 },
      { kind: "number", key: "strike", label: "STRIKE", default: 90 },
      { kind: "number", key: "callPrice", label: "CALL PRICE", default: 13 }
    ], default: [
      {
        "maturityYears": 0.5,
        "strike": 90,
        "callPrice": 13
      },
      {
        "maturityYears": 0.5,
        "strike": 100,
        "callPrice": 7
      },
      {
        "maturityYears": 0.5,
        "strike": 110,
        "callPrice": 3
      },
      {
        "maturityYears": 1,
        "strike": 90,
        "callPrice": 16
      },
      {
        "maturityYears": 1,
        "strike": 100,
        "callPrice": 10
      },
      {
        "maturityYears": 1,
        "strike": 110,
        "callPrice": 6
      }
    ] }
  ],
  "python.advanced.derivatives.exotic-monte-carlo": [
    { kind: "number", key: "spot", label: "SPOT", default: 100 },
    { kind: "number", key: "strike", label: "STRIKE", default: 100 },
    { kind: "number", key: "maturityYears", label: "MATURITY YEARS", default: 1 },
    { kind: "number", key: "ratePct", label: "RATE PCT", default: 4 },
    { kind: "number", key: "dividendYieldPct", label: "DIVIDEND YIELD PCT", default: 1 },
    { kind: "number", key: "volatilityPct", label: "VOLATILITY PCT", default: 22 },
    { kind: "select", key: "optionType", label: "OPTION TYPE", options: ["call","put"], default: "call" },
    { kind: "string", key: "payoffType", label: "PAYOFF TYPE", default: "asian_arithmetic" },
    { kind: "number", key: "nPaths", label: "N PATHS", default: 10000 },
    { kind: "number", key: "nSteps", label: "N STEPS", default: 52 },
    { kind: "number", key: "seed", label: "SEED", default: 42 }
  ],
  "python.advanced.derivatives.interest-rate-swap": [
    { kind: "number", key: "notional", label: "NOTIONAL", default: 10000000 },
    { kind: "number", key: "fixedRatePct", label: "FIXED RATE PCT", default: 4.1 },
    { kind: "number", key: "maturityYears", label: "MATURITY YEARS", default: 5 },
    { kind: "number", key: "paymentsPerYear", label: "PAYMENTS PER YEAR", default: 2 },
    { kind: "number", key: "discountRatePct", label: "DISCOUNT RATE PCT", default: 4 },
    { kind: "number", key: "forwardRatePct", label: "FORWARD RATE PCT", default: 4.35 }
  ],
  "python.advanced.derivatives.black-swaption": [
    { kind: "number", key: "notional", label: "NOTIONAL", default: 10000000 },
    { kind: "number", key: "forwardSwapRatePct", label: "FORWARD SWAP RATE PCT", default: 4.2 },
    { kind: "number", key: "strikePct", label: "STRIKE PCT", default: 4 },
    { kind: "number", key: "volatilityPct", label: "VOLATILITY PCT", default: 25 },
    { kind: "number", key: "optionExpiryYears", label: "OPTION EXPIRY YEARS", default: 1 },
    { kind: "number", key: "swapAnnuity", label: "SWAP ANNUITY", default: 4.4 },
    { kind: "boolean", key: "payer", label: "PAYER", default: true }
  ],
  "python.advanced.portfolio.hrp": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "A",
      "B",
      "C",
      "D"
    ] },
    { kind: "numberMatrix", key: "covMatrix", label: "COV MATRIX", default: [
      [
        4,
        1,
        0.5,
        0.3
      ],
      [
        1,
        3,
        0.4,
        0.2
      ],
      [
        0.5,
        0.4,
        5,
        1.2
      ],
      [
        0.3,
        0.2,
        1.2,
        6
      ]
    ] }
  ],
  "python.advanced.portfolio.risk-budget": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "A",
      "B",
      "C"
    ] },
    { kind: "numberMatrix", key: "covMatrix", label: "COV MATRIX", default: [
      [
        4,
        1,
        0.5
      ],
      [
        1,
        3,
        0.4
      ],
      [
        0.5,
        0.4,
        5
      ]
    ] },
    { kind: "numberArray", key: "riskBudgets", label: "RISK BUDGETS", default: [
      0.4,
      0.35,
      0.25
    ] },
    { kind: "boolean", key: "allowShort", label: "ALLOW SHORT", default: false }
  ],
  "python.advanced.portfolio.factor-risk": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "A",
      "B",
      "C"
    ] },
    { kind: "numberArray", key: "expectedReturnsPct", label: "EXPECTED RETURNS PCT", default: [
      8,
      7,
      10
    ] },
    { kind: "numberMatrix", key: "factorLoadings", label: "FACTOR LOADINGS", default: [
      [
        1,
        0.3
      ],
      [
        0.8,
        -0.2
      ],
      [
        1.2,
        0.6
      ]
    ] },
    { kind: "numberMatrix", key: "factorCovMatrix", label: "FACTOR COV MATRIX", default: [
      [
        4,
        0.5
      ],
      [
        0.5,
        2
      ]
    ] },
    { kind: "numberArray", key: "idiosyncraticVariancePct2", label: "IDIOSYNCRATIC VARIANCE PCT 2", default: [
      2,
      1.5,
      3
    ] },
    { kind: "numberArray", key: "maxFactorExposureAbs", label: "MAX FACTOR EXPOSURE ABS", default: [
      1.1,
      0.4
    ] },
    { kind: "number", key: "riskAversion", label: "RISK AVERSION", default: 1 }
  ],
  "python.advanced.portfolio.tracking-error": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "A",
      "B",
      "C"
    ] },
    { kind: "numberArray", key: "expectedReturnsPct", label: "EXPECTED RETURNS PCT", default: [
      8,
      7,
      10
    ] },
    { kind: "numberMatrix", key: "covMatrix", label: "COV MATRIX", default: [
      [
        4,
        1,
        0.5
      ],
      [
        1,
        3,
        0.4
      ],
      [
        0.5,
        0.4,
        5
      ]
    ] },
    { kind: "numberArray", key: "benchmarkWeights", label: "BENCHMARK WEIGHTS", default: [
      0.4,
      0.4,
      0.2
    ] },
    { kind: "number", key: "maxTrackingErrorPct", label: "MAX TRACKING ERROR PCT", default: 2.5 }
  ],
  "python.advanced.portfolio.tax-aware-rebalance": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "A",
      "B",
      "C"
    ] },
    { kind: "numberArray", key: "targetWeights", label: "TARGET WEIGHTS", default: [
      0.3,
      0.4,
      0.3
    ] },
    { kind: "objectArray", key: "lots", label: "LOTS", itemFields: [
      { kind: "string", key: "asset", label: "ASSET", default: "A" },
      { kind: "number", key: "currentWeight", label: "CURRENT WEIGHT", default: 0.5 },
      { kind: "number", key: "costBasisWeightEquivalent", label: "COST BASIS WEIGHT EQUIVALENT", default: 0.35 },
      { kind: "number", key: "unrealizedGainPct", label: "UNREALIZED GAIN PCT", default: 30 }
    ], default: [
      {
        "asset": "A",
        "currentWeight": 0.5,
        "costBasisWeightEquivalent": 0.35,
        "unrealizedGainPct": 30
      },
      {
        "asset": "B",
        "currentWeight": 0.3,
        "costBasisWeightEquivalent": 0.28,
        "unrealizedGainPct": 5
      },
      {
        "asset": "C",
        "currentWeight": 0.2,
        "costBasisWeightEquivalent": 0.22,
        "unrealizedGainPct": -10
      }
    ] },
    { kind: "number", key: "taxRatePct", label: "TAX RATE PCT", default: 20 },
    { kind: "number", key: "turnoverPenalty", label: "TURNOVER PENALTY", default: 0.2 },
    { kind: "number", key: "taxPenalty", label: "TAX PENALTY", default: 1 }
  ],
  "python.advanced.portfolio.regime-blend": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "equity",
      "bonds",
      "cash"
    ] },
    { kind: "numberArray", key: "regimeProbabilities", label: "REGIME PROBABILITIES", default: [
      0.6,
      0.3,
      0.1
    ] },
    { kind: "numberMatrix", key: "regimeWeights", label: "REGIME WEIGHTS", default: [
      [
        0.7,
        0.25,
        0.05
      ],
      [
        0.3,
        0.6,
        0.1
      ],
      [
        0.15,
        0.35,
        0.5
      ]
    ] }
  ],
  "python.advanced.valuation.probabilistic-dcf": [
    { kind: "number", key: "currentRevenue", label: "CURRENT REVENUE", default: 1000 },
    { kind: "number", key: "netDebt", label: "NET DEBT", default: 150 },
    { kind: "number", key: "sharesOutstanding", label: "SHARES OUTSTANDING", default: 100 },
    { kind: "number", key: "years", label: "YEARS", default: 5 },
    { kind: "number", key: "waccPct", label: "WACC PCT", default: 10 },
    { kind: "number", key: "terminalGrowthPct", label: "TERMINAL GROWTH PCT", default: 3 },
    { kind: "objectArray", key: "scenarios", label: "SCENARIOS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "bear" },
      { kind: "number", key: "revenueGrowthPct", label: "REVENUE GROWTH PCT", default: 2 },
      { kind: "number", key: "ebitMarginPct", label: "EBIT MARGIN PCT", default: 14 },
      { kind: "number", key: "taxRatePct", label: "TAX RATE PCT", default: 25 },
      { kind: "number", key: "reinvestmentPctOfRevenue", label: "REINVESTMENT PCT OF REVENUE", default: 10 },
      { kind: "number", key: "probability", label: "PROBABILITY", default: 0.2 }
    ], default: [
      {
        "name": "bear",
        "revenueGrowthPct": 2,
        "ebitMarginPct": 14,
        "taxRatePct": 25,
        "reinvestmentPctOfRevenue": 10,
        "probability": 0.2
      },
      {
        "name": "base",
        "revenueGrowthPct": 7,
        "ebitMarginPct": 20,
        "taxRatePct": 25,
        "reinvestmentPctOfRevenue": 8,
        "probability": 0.6
      },
      {
        "name": "bull",
        "revenueGrowthPct": 12,
        "ebitMarginPct": 25,
        "taxRatePct": 25,
        "reinvestmentPctOfRevenue": 5,
        "probability": 0.2
      }
    ] },
    { kind: "number", key: "nSimulations", label: "N SIMULATIONS", default: 10000 },
    { kind: "number", key: "growthVolPct", label: "GROWTH VOL PCT", default: 2 },
    { kind: "number", key: "marginVolPct", label: "MARGIN VOL PCT", default: 2 },
    { kind: "number", key: "seed", label: "SEED", default: 42 }
  ],
  "python.advanced.valuation.reverse-dcf": [
    { kind: "number", key: "currentRevenue", label: "CURRENT REVENUE", default: 1000 },
    { kind: "number", key: "marketEquityValue", label: "MARKET EQUITY VALUE", default: 1500 },
    { kind: "number", key: "netDebt", label: "NET DEBT", default: 150 },
    { kind: "number", key: "years", label: "YEARS", default: 5 },
    { kind: "number", key: "waccPct", label: "WACC PCT", default: 10 },
    { kind: "number", key: "terminalGrowthPct", label: "TERMINAL GROWTH PCT", default: 3 },
    { kind: "number", key: "ebitMarginPct", label: "EBIT MARGIN PCT", default: 20 },
    { kind: "number", key: "taxRatePct", label: "TAX RATE PCT", default: 25 },
    { kind: "number", key: "reinvestmentPctOfRevenue", label: "REINVESTMENT PCT OF REVENUE", default: 8 },
    { kind: "string", key: "solveFor", label: "SOLVE FOR", default: "revenue_growth" }
  ],
  "python.advanced.valuation.residual-income": [
    { kind: "number", key: "bookValueEquity", label: "BOOK VALUE EQUITY", default: 800 },
    { kind: "numberArray", key: "roePct", label: "ROE PCT", default: [
      15,
      14,
      13,
      12,
      12
    ] },
    { kind: "number", key: "costOfEquityPct", label: "COST OF EQUITY PCT", default: 10 },
    { kind: "number", key: "payoutRatioPct", label: "PAYOUT RATIO PCT", default: 30 },
    { kind: "number", key: "terminalRoePct", label: "TERMINAL ROE PCT", default: 11 },
    { kind: "number", key: "terminalGrowthPct", label: "TERMINAL GROWTH PCT", default: 3 }
  ],
  "python.advanced.valuation.eva": [
    { kind: "number", key: "investedCapital", label: "INVESTED CAPITAL", default: 1000 },
    { kind: "numberArray", key: "nopat", label: "NOPAT", default: [
      120,
      130,
      140,
      150,
      160
    ] },
    { kind: "number", key: "waccPct", label: "WACC PCT", default: 9 },
    { kind: "number", key: "capitalGrowthPct", label: "CAPITAL GROWTH PCT", default: 4 },
    { kind: "number", key: "terminalEvaGrowthPct", label: "TERMINAL EVA GROWTH PCT", default: 2 }
  ],
  "python.advanced.valuation.sotp": [
    { kind: "objectArray", key: "segments", label: "SEGMENTS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "Software" },
      { kind: "number", key: "metric", label: "METRIC", default: 100 },
      { kind: "number", key: "multiple", label: "MULTIPLE", default: 8 },
      { kind: "number", key: "ownershipPct", label: "OWNERSHIP PCT", default: 100 }
    ], default: [
      {
        "name": "Software",
        "metric": 100,
        "multiple": 8,
        "ownershipPct": 100
      },
      {
        "name": "Services",
        "metric": 80,
        "multiple": 5,
        "ownershipPct": 100
      }
    ] },
    { kind: "number", key: "netDebt", label: "NET DEBT", default: 150 },
    { kind: "number", key: "nonOperatingAssets", label: "NON OPERATING ASSETS", default: 50 },
    { kind: "number", key: "sharesOutstanding", label: "SHARES OUTSTANDING", default: 100 }
  ],
  "python.advanced.valuation.merger-accretion": [
    { kind: "number", key: "acquirerShares", label: "ACQUIRER SHARES", default: 100 },
    { kind: "number", key: "acquirerNetIncome", label: "ACQUIRER NET INCOME", default: 200 },
    { kind: "number", key: "acquirerSharePrice", label: "ACQUIRER SHARE PRICE", default: 40 },
    { kind: "number", key: "targetShares", label: "TARGET SHARES", default: 30 },
    { kind: "number", key: "targetNetIncome", label: "TARGET NET INCOME", default: 45 },
    { kind: "number", key: "offerPricePerShare", label: "OFFER PRICE PER SHARE", default: 25 },
    { kind: "number", key: "stockConsiderationPct", label: "STOCK CONSIDERATION PCT", default: 60 },
    { kind: "number", key: "debtInterestRatePct", label: "DEBT INTEREST RATE PCT", default: 6 },
    { kind: "number", key: "taxRatePct", label: "TAX RATE PCT", default: 25 },
    { kind: "number", key: "annualSynergiesAfterTax", label: "ANNUAL SYNERGIES AFTER TAX", default: 20 }
  ],
  "python.advanced.credit.merton": [
    { kind: "number", key: "equityValue", label: "EQUITY VALUE", default: 500 },
    { kind: "number", key: "equityVolPct", label: "EQUITY VOL PCT", default: 35 },
    { kind: "number", key: "debtFaceValue", label: "DEBT FACE VALUE", default: 400 },
    { kind: "number", key: "riskFreeRatePct", label: "RISK FREE RATE PCT", default: 4 },
    { kind: "number", key: "maturityYears", label: "MATURITY YEARS", default: 1 }
  ],
  "python.advanced.credit.rating-migration": [
    { kind: "stringArray", key: "ratings", label: "RATINGS", default: [
      "A",
      "BBB",
      "BB",
      "D"
    ] },
    { kind: "numberMatrix", key: "transitionMatrix", label: "TRANSITION MATRIX", default: [
      [
        0.88,
        0.1,
        0.015,
        0.005
      ],
      [
        0.04,
        0.88,
        0.07,
        0.01
      ],
      [
        0.01,
        0.07,
        0.86,
        0.06
      ],
      [
        0,
        0,
        0,
        1
      ]
    ] },
    { kind: "numberArray", key: "currentDistribution", label: "CURRENT DISTRIBUTION", default: [
      0.4,
      0.4,
      0.2,
      0
    ] },
    { kind: "number", key: "periods", label: "PERIODS", default: 3 }
  ],
  "python.advanced.credit.creditmetrics": [
    { kind: "objectArray", key: "exposures", label: "EXPOSURES", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "A" },
      { kind: "number", key: "ead", label: "EAD", default: 1000000 },
      { kind: "number", key: "pdPct", label: "PD PCT", default: 1 },
      { kind: "number", key: "lgdPct", label: "LGD PCT", default: 45 }
    ], default: [
      {
        "name": "A",
        "ead": 1000000,
        "pdPct": 1,
        "lgdPct": 45
      },
      {
        "name": "B",
        "ead": 700000,
        "pdPct": 3,
        "lgdPct": 50
      },
      {
        "name": "C",
        "ead": 500000,
        "pdPct": 6,
        "lgdPct": 60
      }
    ] },
    { kind: "number", key: "assetCorrelation", label: "ASSET CORRELATION", default: 0.2 },
    { kind: "number", key: "confidencePct", label: "CONFIDENCE PCT", default: 99 },
    { kind: "number", key: "nSimulations", label: "N SIMULATIONS", default: 20000 },
    { kind: "number", key: "seed", label: "SEED", default: 42 }
  ],
  "python.advanced.credit.stress-pd": [
    { kind: "numberArray", key: "basePdPct", label: "BASE PD PCT", default: [
      1,
      3,
      8
    ] },
    { kind: "number", key: "macroShock", label: "MACRO SHOCK", default: 1.5 },
    { kind: "numberArray", key: "beta", label: "BETA", default: [
      0.8,
      1,
      1.3
    ] }
  ],
  "python.advanced.credit.covenant-headroom": [
    { kind: "number", key: "ebitda", label: "EBITDA", default: 120 },
    { kind: "number", key: "netDebt", label: "NET DEBT", default: 360 },
    { kind: "number", key: "interestExpense", label: "INTEREST EXPENSE", default: 30 },
    { kind: "number", key: "cashFlowFromOperations", label: "CASH FLOW FROM OPERATIONS", default: 90 },
    { kind: "number", key: "debtService", label: "DEBT SERVICE", default: 50 },
    { kind: "number", key: "maxNetLeverage", label: "MAX NET LEVERAGE", default: 3.5 },
    { kind: "number", key: "minInterestCoverage", label: "MIN INTEREST COVERAGE", default: 3 },
    { kind: "number", key: "minDebtServiceCoverage", label: "MIN DEBT SERVICE COVERAGE", default: 1.5 }
  ],
  "python.advanced.econometrics.weak-instruments": [
    { kind: "numberArray", key: "endogenous", label: "ENDOGENOUS", default: [
      0,
      1.1414709848078965,
      1.5092974268256816,
      1.041120008059867,
      0.44319750469207164,
      0.5410757253368615,
      1.520584501801074,
      2.756986598718789,
      3.389358246623382,
      3.1121184852417563,
      2.4559788891106304,
      2.3000097934492962,
      3.063427081999565,
      4.320167036826641,
      5.190607355694871,
      5.150287840157117,
      4.512096683334935,
      4.138602508120443,
      4.649012753228323,
      5.849877209662952,
      6.912945250727628,
      7.136655638536055,
      6.591148690709596,
      6.053779595824829,
      6.294421637993375,
      7.367648249902227,
      8.562558450479603,
      9.056375928404503,
      8.67090578830787,
      8.036366115787033,
      8.011968375907138,
      8.895962354676934,
      10.15142668124169,
      10.899911860107267,
      10.729082686120023,
      10.07181733050385,
      9.808221146556884,
      10.456461866643,
      11.696368578709386,
      12.663795386284088,
      12.745113160479349,
      12.14137733119529,
      11.683478452084366,
      12.068225257371402,
      13.217701925105413,
      14.350903524534118,
      14.701788347648808,
      14.223573122745224,
      13.631745338676332,
      13.746247347240528,
      14.737625146296072,
      15.970229175843373,
      16.586627592040486,
      16.295925150181834,
      15.641210951148382,
      15.50024482664138,
      16.278448997913088,
      17.536164755247825,
      18.392872648084534,
      18.336738007139136
    ] },
    { kind: "numberMatrix", key: "instruments", label: "INSTRUMENTS", default: [
      [
        1,
        1.1449569463147378,
        1.1858872607769482,
        1.1403023058681399,
        1.0352375733029895,
        0.9042764519856243,
        0.7838531634528578,
        0.7092418602501237,
        0.7106734317869587,
        0.8100075033995546,
        1.018325995288921,
        1.3347131570637643,
        1.7463563791363885,
        2.2299566830374618,
        2.7542936152614197,
        3.283662185463226,
        3.781803489859171,
        4.2158963128019336,
        4.560170286650366,
        4.79874285122862,
        4.927367703050975,
        4.953902254343305,
        4.897442641117117,
        4.786221503890232,
        4.654499966191387,
        4.5387959608368105,
        4.473864112857275,
        4.488869738115324,
        4.6041781472117425,
        4.829112707716125,
        5.1609284709235475,
        5.585114352572432,
        6.076990601624621,
        6.604425697988051,
        7.13137358648758,
        7.621841846765279,
        8.043853958732493,
        8.372969473193638,
        8.594974565760545,
        8.707446781450196,
        8.720021713324083,
        8.653332257555869,
        8.536737218207834,
        8.405089310774624,
        8.294898362403146,
        8.240312087141179,
        8.26935689702228,
        8.400852583461424,
        8.642340519676617,
        8.989253460267088,
        9.42541833148088,
        9.924836661948405,
        10.454546653193105,
        10.978251815717693,
        11.46031670824408,
        11.86968990472816,
        12.183322324981278,
        12.388704618186669,
        12.485244268636633,
        12.484330823480319
      ],
      [
        0,
        0.19866933079506122,
        0.3894183423086505,
        0.5646424733950354,
        0.7173560908995228,
        0.8414709848078965,
        0.9320390859672263,
        0.9854497299884601,
        0.9995736030415051,
        0.9738476308781951,
        0.9092974268256817,
        0.8084964038195901,
        0.6754631805511511,
        0.5155013718214642,
        0.3349881501559051,
        0.1411200080598672,
        -0.058374143427580086,
        -0.2555411020268312,
        -0.44252044329485246,
        -0.6118578909427189,
        -0.7568024953079283,
        -0.8715757724135882,
        -0.9516020738895161,
        -0.9936910036334644,
        -0.9961646088358407,
        -0.9589242746631385,
        -0.8834546557201531,
        -0.7727644875559871,
        -0.6312666378723216,
        -0.46460217941375737,
        -0.27941549819892586,
        -0.0830894028174964,
        0.11654920485049364,
        0.31154136351337786,
        0.49411335113860816,
        0.6569865987187891,
        0.7936678638491531,
        0.8987080958116269,
        0.9679196720314863,
        0.998543345374605,
        0.9893582466233818,
        0.9407305566797731,
        0.8545989080882804,
        0.7343970978741134,
        0.5849171928917617,
        0.4121184852417566,
        0.22288991410024764,
        0.024775425453357765,
        -0.17432678122297965,
        -0.36647912925192844,
        -0.5440211108893698,
        -0.6998746875935423,
        -0.8278264690856537,
        -0.9227754216128066,
        -0.9809362300664916,
        -0.9999902065507035,
        -0.9791777291513174,
        -0.9193285256646757,
        -0.8228285949687089,
        -0.6935250847771224
      ]
    ] }
  ],
  "python.advanced.econometrics.event-study": [
    { kind: "numberArray", key: "assetReturnsPct", label: "ASSET RETURNS PCT", default: [
      0,
      0.09973978670818216,
      0.19792316740361837,
      0.2930180232688381,
      0.3835404308833624,
      0.4680778183523698,
      0.5453110080186673,
      0.6140348017888217,
      0.6731767878463173,
      0.7218140752792762,
      0.759187695484469,
      0.7847144456185245,
      0.7979959892832436,
      0.7988250724318653,
      0.7871887574991496,
      0.7632686252877551,
      0.7274379414605454,
      0.6802558318547617,
      0.622458557510337,
      0.5549480255626175,
      0.47877771528316515,
      0.39513623888807137,
      0.3053287936418654,
      0.2107567946907367,
      0.11289600644789377,
      0.013273513783478325,
      -0.0865561076240867,
      -0.18503504992161746,
      -0.2806265821516959,
      -0.3718390304252872,
      -0.457249054993875,
      -0.5355238609901888,
      -0.6054419962463427,
      -0.6659124116463899,
      -0.7159914865828668,
      -0.75489775384077,
      -0.7820240941320776,
      -0.7969472099891834,
      -0.7994342311803024,
      -0.7894463485715529,
      -0.7671394197305108,
      -0.732861536820995,
      -0.6871475947412736,
      -0.6307109442680773,
      -0.5644322604563136,
      -0.4893457999993855,
      -0.40662326199940674,
      -0.31755550399459764,
      -0.2235323985591407,
      -0.1260211448065144,
      -0.026543373238045453,
      0.07334859879214221,
      0.17209599047025242,
      0.26815788177606836,
      0.3600352590244941,
      0.44629440647275215,
      0.5255892789750313,
      0.59668250656679,
      0.6584647032092045,
      0.7099717783872602,
      0.7503999814197911,
      0.779118443720037,
      0.7956790232889409,
      0.7998232978211594,
      0.7914865972987055,
      0.7707990131449506,
      0.7380833681914722,
      0.693850179135739,
      0.6387896900987923,
      0.5737611015965965,
      0.49977916300335395,
      0.4179983377269123,
      0.3296947881934053,
      0.23624646175941663,
      0.13911158830434686,
      0.039805925040862895,
      -0.060120896369447445,
      -0.1591095512998669,
      -0.25561535489781895,
      -0.3481323663753591,
      -0.43521688871149583,
      -0.5155099970613464,
      -0.5877587443238363,
      -0.6508357129621539,
      -0.7037566079773362,
      -0.7456956165025228,
      -0.7759982943365429,
      -0.7941917783267893,
      -0.7999921652405628,
      -0.7933089419800634,
      -0.7742463980090092,
      -0.7431019979504359,
      -0.7003617397507429,
      -0.6466925708442872,
      -0.582931980661736,
      -0.5100749318876064,
      -0.429258334400348,
      -0.3417433041739386,
      -0.24889548398490186,
      -0.1521637330135303,
      -0.05305751788096055,
      0.046876642072595356,
      0.1460793077049072,
      0.2430024545979732,
      0.33613362946131276,
      0.42401955145971115,
      0.5052887901745909,
      0.5786731663170069,
      0.6430275412412967,
      0.6973476864506447,
      0.7407859542469017,
      0.7726645049894122,
      0.7924858845558963,
      0.7999407869476511,
      0.7949128809062102,
      0.7774806252237231,
      0.7479160444197465,
      0.7066804838895964,
      0.6544174107637554,
      0.591942372818515,
      0.5202302721256935,
      0.4404001520318692,
      0.35369773486123157,
      0.26147598283535406,
      0.1651739855502373,
      0.06629450346447859,
      -0.033619482175072636,
      -0.13300884703960875,
      -0.23032265333205226,
      -0.32404235165265466,
      5.587294522545513,
      -0.4949284723135632,
      -0.5694282738952985,
      -0.635042337713114,
      -0.6907467782463246,
      -0.7356723463312416,
      -0.7691179935036455,
      -0.790561811625597,
      -0.7996691770873738,
      -0.796297972496982,
      -0.7805008043745261,
      -0.7525241822450575,
      -0.7128046719398827,
      -0.6619620831327804,
      -0.600789797417341,
      -0.5302423878525534,
      -0.45142072316948423,
      -0.3655547890829245,
      -0.27398449477569004,
      -0.17813876406396742,
      -0.07951323751907854,
      0.02035306650340482,
      0.11990176773036187,
      0.21757944197407098,
      0.3118618617971029,
      0.4012777815716908,
      0.48443189577568085,
      0.5600266122685332,
      0.6268823007826844,
      0.6839557006593348
    ] },
    { kind: "numberArray", key: "marketReturnsPct", label: "MARKET RETURNS PCT", default: [
      0,
      0.062337366692613846,
      0.12370197962726147,
      0.18313626454302379,
      0.2397127693021015,
      0.2925486364702311,
      0.34081938001166706,
      0.38377175111801354,
      0.42073549240394825,
      0.4511337970495476,
      0.4744923096777931,
      0.49044652851157783,
      0.4987474933020272,
      0.4992656702699158,
      0.49199297343696846,
      0.4770428908048469,
      0.45464871341284085,
      0.425159894909226,
      0.3890365984439606,
      0.3468425159766359,
      0.2992360720519782,
      0.2469601493050446,
      0.19083049602616586,
      0.13172299668171042,
      0.0705600040299336,
      0.008295946114673953,
      -0.054097567265054186,
      -0.11564690620101091,
      -0.17539161384480992,
      -0.23239939401580448,
      -0.28578065937117186,
      -0.334702413118868,
      -0.37840124765396416,
      -0.41619525727899365,
      -0.44749467911429175,
      -0.4718110961504812,
      -0.4887650588325485,
      -0.4980920062432396,
      -0.499646394487689,
      -0.49340396785722057,
      -0.4794621373315692,
      -0.4580384605131218,
      -0.429467246713296,
      -0.3941943401675483,
      -0.35277016278519596,
      -0.3058411249996159,
      -0.2541395387496292,
      -0.19847218999662353,
      -0.13970774909946293,
      -0.0787632155040715,
      -0.01658960827377841,
      0.04584287424508888,
      0.10755999404390776,
      0.16759867611004273,
      0.2250220368903088,
      0.2789340040454701,
      0.32849329935939453,
      0.3729265666042437,
      0.41154043950575275,
      0.4437323614920376,
      0.46899998838736945,
      0.4869490273250231,
      0.49729938955558806,
      0.4998895611382246,
      0.4946791233116909,
      0.4817493832155941,
      0.4613021051196701,
      0.4336563619598368,
      0.39924355631174513,
      0.3586006884978728,
      0.3123619768770962,
      0.26124896107932016,
      0.2060592426208783,
      0.14765403859963538,
      0.08694474269021678,
      0.02487870315053931,
      -0.03757556023090465,
      -0.0994434695624168,
      -0.15975959681113683,
      -0.21758272898459943,
      -0.2720105554446849,
      -0.32219374816334145,
      -0.3673492152023977,
      -0.40677232060134616,
      -0.4398478799858351,
      -0.4660597603140767,
      -0.4849989339603393,
      -0.49636986145424333,
      -0.49999510327535174,
      -0.4958180887375396,
      -0.4839039987556307,
      -0.46443874871902235,
      -0.43772608734421425,
      -0.4041828567776795,
      -0.364332487913585,
      -0.31879683242975404,
      -0.26828645900021747,
      -0.21358956510871163,
      -0.15555967749056365,
      -0.09510233313345644,
      -0.03316094867560034,
      0.029297901295372096,
      0.091299567315567,
      0.15187653412373325,
      0.21008351841332046,
      0.26501221966231947,
      0.3158054938591193,
      0.36167072894812935,
      0.40189221327581043,
      0.4358423040316529,
      0.4629912214043136,
      0.4829153156183826,
      0.4953036778474352,
      0.49996299184228193,
      0.4968205505663813,
      0.4859253907648269,
      0.4674475277623415,
      0.4416753024309977,
      0.40901088172734706,
      0.3699639830115719,
      0.3251439200785584,
      0.27525009501991826,
      0.2210610842882697,
      0.1634224892720963,
      0.1032337409688983,
      0.041434064665299114,
      -0.021012176359420397,
      -0.08313052939975546,
      -0.14395165833253265,
      -0.20252646978290914,
      -0.25794092340905467,
      -0.309330295195977,
      -0.3558926711845615,
      -0.39690146107069624,
      -0.4317167364039528,
      -0.459795216457026,
      -0.4806987459397784,
      -0.4941011322659981,
      -0.4997932356796086,
      -0.4976862328106137,
      -0.4878130027340788,
      -0.47032761390316086,
      -0.4455029199624267,
      -0.4137263019579877,
      -0.3754936233858381,
      -0.33140149240784583,
      -0.2821379519809276,
      -0.2284717431768278,
      -0.17124030923480626,
      -0.11133672753997963,
      -0.04969577344942409,
      0.012720666564628013,
      0.07493860483147617,
      0.13598715123379435,
      0.1949136636231893,
      0.25079861348230675,
      0.3027699348598005,
      0.3500166326678332,
      0.3918014379891777,
      0.4274723129120842
    ] },
    { kind: "number", key: "eventIndex", label: "EVENT INDEX", default: 130 },
    { kind: "number", key: "estimationWindow", label: "ESTIMATION WINDOW", default: 100 },
    { kind: "number", key: "eventWindowBefore", label: "EVENT WINDOW BEFORE", default: 3 },
    { kind: "number", key: "eventWindowAfter", label: "EVENT WINDOW AFTER", default: 3 }
  ],
  "python.advanced.econometrics.synthetic-control": [
    { kind: "numberArray", key: "treatedPre", label: "TREATED PRE", default: [
      1,
      2,
      3,
      4,
      5,
      6
    ] },
    { kind: "numberMatrix", key: "donorPre", label: "DONOR PRE", default: [
      [
        1,
        1.2
      ],
      [
        2,
        2.1
      ],
      [
        3,
        3.1
      ],
      [
        4,
        4.2
      ],
      [
        5,
        5.1
      ],
      [
        6,
        6.2
      ]
    ] },
    { kind: "numberArray", key: "treatedPost", label: "TREATED POST", default: [
      7.8,
      9
    ] },
    { kind: "numberMatrix", key: "donorPost", label: "DONOR POST", default: [
      [
        7,
        7.2
      ],
      [
        8,
        8.2
      ]
    ] }
  ],
  "python.advanced.econometrics.propensity-match": [
    { kind: "numberArray", key: "treated", label: "TREATED", default: [
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1
    ] },
    { kind: "numberMatrix", key: "covariates", label: "COVARIATES", default: [
      [
        0,
        0
      ],
      [
        0.016666666666666666,
        0.14237172979226365
      ],
      [
        0.03333333333333333,
        0.28184285212220994
      ],
      [
        0.05,
        0.415571854993052
      ],
      [
        0.06666666666666667,
        0.5408342133588315
      ],
      [
        0.08333333333333333,
        0.6550778971785186
      ],
      [
        0.1,
        0.7559753651467324
      ],
      [
        0.11666666666666667,
        0.8414709848078965
      ],
      [
        0.13333333333333333,
        0.9098229129411239
      ],
      [
        0.15,
        0.9596385829666849
      ],
      [
        0.16666666666666666,
        0.9899030763721239
      ],
      [
        0.18333333333333332,
        0.9999998001333682
      ],
      [
        0.2,
        0.9897230488598214
      ],
      [
        0.21666666666666667,
        0.9592821957288404
      ],
      [
        0.23333333333333334,
        0.9092974268256817
      ],
      [
        0.25,
        0.8407871057952504
      ],
      [
        0.26666666666666666,
        0.7551470262316581
      ],
      [
        0.2833333333333333,
        0.6541219745065957
      ],
      [
        0.3,
        0.5397701824006438
      ],
      [
        0.31666666666666665,
        0.4144213937610953
      ],
      [
        0.3333333333333333,
        0.28062939951435684
      ],
      [
        0.35,
        0.1411200080598672
      ],
      [
        0.36666666666666664,
        -0.00126448893037729
      ],
      [
        0.38333333333333336,
        -0.14362322388181803
      ],
      [
        0.4,
        -0.2830558540822556
      ],
      [
        0.4166666666666667,
        -0.41672165175349984
      ],
      [
        0.43333333333333335,
        -0.5418973795594052
      ],
      [
        0.45,
        -0.6560327724248436
      ],
      [
        0.4666666666666667,
        -0.7568024953079283
      ],
      [
        0.48333333333333334,
        -0.8421535183649058
      ],
      [
        0.5,
        -0.9103469443107828
      ],
      [
        0.5166666666666667,
        -0.9599934358068326
      ],
      [
        0.5333333333333333,
        -0.9900815210958355
      ],
      [
        0.55,
        -0.9999982012007936
      ],
      [
        0.5666666666666667,
        -0.98954143884678
      ],
      [
        0.5833333333333334,
        -0.9589242746631385
      ],
      [
        0.6,
        -0.908770486804673
      ],
      [
        0.6166666666666667,
        -0.8401018824204437
      ],
      [
        0.6333333333333333,
        -0.7543174798871631
      ],
      [
        0.65,
        -0.6531650059375308
      ],
      [
        0.6666666666666666,
        -0.5387052883861563
      ],
      [
        0.6833333333333333,
        -0.4132702698971407
      ],
      [
        0.7,
        -0.27941549819892586
      ],
      [
        0.7166666666666667,
        -0.13986806068604749
      ],
      [
        0.7333333333333333,
        0.002528975838921635
      ],
      [
        0.75,
        0.14487448832747585
      ],
      [
        0.7666666666666667,
        0.2842684034549854
      ],
      [
        0.7833333333333333,
        0.4178707822039908
      ],
      [
        0.8,
        0.5429596793024328
      ],
      [
        0.8166666666666667,
        0.6569865987187891
      ],
      [
        0.8333333333333334,
        0.7576284153927202
      ],
      [
        0.85,
        0.8428347053749521
      ],
      [
        0.8666666666666667,
        0.9108695200967674
      ],
      [
        0.8833333333333333,
        0.9603467536818973
      ],
      [
        0.9,
        0.9902583827456352
      ],
      [
        0.9166666666666666,
        0.999995003338201
      ],
      [
        0.9333333333333333,
        0.9893582466233818
      ],
      [
        0.95,
        0.9585648203418708
      ],
      [
        0.9666666666666667,
        0.9082420937206396
      ],
      [
        0.9833333333333333,
        0.8394153157791026
      ]
    ] },
    { kind: "numberArray", key: "outcome", label: "OUTCOME", default: [
      5,
      6.51,
      5.02,
      6.53,
      5.04,
      6.55,
      5.06,
      6.57,
      5.08,
      6.59,
      5.1,
      6.61,
      5.12,
      6.63,
      5.14,
      6.65,
      5.16,
      6.67,
      5.18,
      6.69,
      5.2,
      6.71,
      5.22,
      6.73,
      5.24,
      6.75,
      5.26,
      6.77,
      5.28,
      6.79,
      5.3,
      6.81,
      5.32,
      6.83,
      5.34,
      6.85,
      5.36,
      6.87,
      5.38,
      6.89,
      5.4,
      6.91,
      5.42,
      6.93,
      5.44,
      6.95,
      5.46,
      6.97,
      5.48,
      6.99,
      5.5,
      7.01,
      5.52,
      7.03,
      5.54,
      7.05,
      5.5600000000000005,
      7.07,
      5.58,
      7.09
    ] },
    { kind: "number", key: "caliper", label: "CALIPER", default: 0.2 }
  ],
  "python.advanced.econometrics.local-projections": [
    { kind: "numberArray", key: "response", label: "RESPONSE", default: [
      100,
      101.29481,
      102.55885,
      103.76328,
      104.88294,
      105.89797,
      106.79499,
      107.56797,
      108.21859,
      108.75615,
      109.19694,
      109.56332,
      109.88224,
      110.18361,
      110.49843,
      110.85688,
      111.2864,
      111.81002,
      112.44494,
      113.20141,
      114.08215,
      115.08213,
      116.18892,
      117.38344,
      118.64117,
      119.93364,
      121.23024,
      122.50009,
      123.71397,
      124.84616,
      125.876,
      126.7892,
      127.57872,
      128.24521,
      128.79697,
      129.24945,
      129.62424,
      129.94778,
      130.2497,
      130.56096,
      130.91196,
      131.3306,
      131.84061,
      132.46,
      133.20002,
      134.06438,
      135.0491,
      136.14267,
      137.32685,
      138.57776,
      139.86736,
      141.1652,
      142.44033,
      143.66322,
      144.80757,
      145.85196,
      146.78121,
      147.58728,
      148.26979,
      148.83604
    ] },
    { kind: "numberArray", key: "shock", label: "SHOCK", default: [
      0.7,
      0.93551,
      1.15576,
      1.3517,
      1.51505,
      1.63869,
      1.71687,
      1.74552,
      1.72238,
      1.6471,
      1.52128,
      1.34841,
      1.13373,
      0.88407,
      0.60756,
      0.31332,
      0.01114,
      -0.28891,
      -0.57689,
      -0.84332,
      -1.07957,
      -1.27821,
      -1.43323,
      -1.54031,
      -1.59699,
      -1.60269,
      -1.55879,
      -1.4685,
      -1.33678,
      -1.17007,
      -0.97607,
      -0.76342,
      -0.54131,
      -0.31915,
      -0.10617,
      0.08895,
      0.25841,
      0.39564,
      0.4955,
      0.55457,
      0.57118,
      0.54554,
      0.47972,
      0.37752,
      0.24435,
      0.08697,
      -0.08675,
      -0.26821,
      -0.4484,
      -0.61827,
      -0.76914,
      -0.89302,
      -0.98297,
      -1.03341,
      -1.04032,
      -1.00142,
      -0.91633,
      -0.78653,
      -0.61536,
      -0.4079
    ] },
    { kind: "numberMatrix", key: "controls", label: "CONTROLS", default: [
      [
        1,
        0.986143231562925,
        0.9449569463147377,
        0.8775825618903728,
        0.785887260776948,
        0.6724122440830567,
        0.5403023058681398,
        0.39321867977635777,
        0.23523757330298942,
        0.0707372016677029,
        -0.09572354801437566,
        -0.25953145961883317,
        -0.4161468365471424,
        -0.5612293127757414,
        -0.6907581397498764,
        -0.8011436155469337,
        -0.8893265682130413,
        -0.9528631362378159,
        -0.9899924966004454,
        -0.9996856634034069,
        -0.981674004711079,
        -0.9364566872907963,
        -0.8652868429362359,
        -0.7701368397532452,
        -0.6536436208636119,
        -0.5190356253846217,
        -0.3700433169625381,
        -0.2107957994307797,
        -0.04570638473858045,
        0.12064971553245465,
        0.28366218546322625,
        0.4388133729573608,
        0.5818034898591706,
        0.70866977429126,
        0.815896312801933,
        0.9005114787622862,
        0.960170286650366,
        0.9932193798938977,
        0.9987428512286196,
        0.9765876257280235,
        0.9273677030509753,
        0.8524471413395285,
        0.7539022543433046,
        0.6344640694218329,
        0.49744264111711656,
        0.3466353178350258,
        0.1862215038902314,
        0.020646833430616282,
        -0.14550003380861354,
        -0.3076145804956974,
        -0.46120403916318925,
        -0.6020119026848236,
        -0.7261358871427251,
        -0.8301360779166542,
        -0.9111302618846769,
        -0.9668738037428051,
        -0.9958218527882577,
        -0.9971721561963784,
        -0.9708872922838755,
        -0.9176957075960194
      ]
    ] },
    { kind: "number", key: "horizons", label: "HORIZONS", default: 6 },
    { kind: "number", key: "lags", label: "LAGS", default: 2 }
  ],
  "python.advanced.econometrics.bayesian-var": [
    { kind: "stringArray", key: "seriesNames", label: "SERIES NAMES", default: [
      "growth",
      "inflation"
    ] },
    { kind: "numberMatrix", key: "data", label: "DATA", default: [
      [
        2,
        2.165896132693415,
        2.3271946967961523,
        2.479425538604203,
        2.618369803069737,
        2.7401768531960373,
        2.8414709848078967,
        2.919444979253755,
        2.9719379013633125,
        2.9974949866040546,
        2.995407957751765,
        2.9657346537575,
        2.909297426825682,
        2.8276603521259607,
        2.7230858817383243,
        2.5984721441039564,
        2.457272626635812,
        2.3034004673678563,
        2.1411200080598674,
        1.974928614204831,
        1.8094320371245147,
        1.64921677231038,
        1.4987229514116551,
        1.3621212904831481,
        1.2431975046920716,
        1.14524739276116,
        1.0709854987292382,
        1.022469882334903,
        1.0010450829020718,
        1.007304857399847,
        1.0410757253368614,
        1.1014217765192704,
        1.18667060843242,
        1.294459674429608,
        1.421801758255691,
        1.5651677603749228,
        1.7205845018010741,
        1.8837448349397703,
        2.0501270098821727,
        2.2151199880878156,
        2.37415123057122,
        2.5228134191296796,
        2.656986598718789,
        2.772952355978483,
        2.867496869618806,
        2.937999976774739,
        2.982507786986373,
        2.9997868314142213,
        2.989358246623382,
        2.9515110455830014,
        2.8872941080946943,
        2.7984871126234903,
        2.6875512151130616,
        2.557560841649729,
        2.4121184852417565,
        2.2552548679965176,
        2.091317235554749,
        1.9248488795381906,
        1.760463226869684,
        1.6027159853960378
      ],
      [
        4,
        3.992197667229329,
        3.9689124217106446,
        3.930507621912314,
        3.8775825618903728,
        3.810963119505218,
        3.731688868873821,
        3.640996858163325,
        3.5403023058681398,
        3.4311765167986663,
        3.3153223623952686,
        3.194547707988987,
        3.070737201667703,
        2.9458228649730636,
        2.8217539443505077,
        2.700466493810426,
        2.5838531634528574,
        2.473733665295695,
        2.371826377277261,
        2.279721528543308,
        2.1988563844530664,
        2.1304928185340155,
        2.0756976213675364,
        2.0353258536786836,
        2.010007503399555,
        2.0001376549183134,
        2.0058703239194537,
        2.0271160540205537,
        2.0635433127092035,
        2.11458366479698,
        2.179440642660439,
        2.257102174852001,
        2.346356379136388,
        2.445810473507583,
        2.553912510086207,
        2.6689755927471124,
        2.78920420056922,
        2.912722206338965,
        3.0376021528879766,
        3.161895330417537,
        3.283662185463226,
        3.401002586978036,
        3.5120854772418406,
        3.615177444904708,
        3.70866977429126,
        3.7911035488707387,
        3.861192417161521,
        3.9178426658157575,
        3.960170286650366,
        3.987514771299061,
        3.9994494182244993,
        3.9957879912530556,
        3.9765876257280235,
        3.9421479369316925,
        3.8930063446890766,
        3.829929687111292,
        3.7539022543433047,
        3.6661104290454265,
        3.567924173288695,
        3.46087565075495
      ]
    ] },
    { kind: "number", key: "lags", label: "LAGS", default: 2 },
    { kind: "number", key: "ridgePrior", label: "RIDGE PRIOR", default: 1 },
    { kind: "number", key: "forecastSteps", label: "FORECAST STEPS", default: 8 }
  ],
  "python.advanced.forecasting.model-tournament": [
    { kind: "numberArray", key: "series", label: "SERIES", default: [
      100,
      101.29481,
      102.55885,
      103.76328,
      104.88294,
      105.89797,
      106.79499,
      107.56797,
      108.21859,
      108.75615,
      109.19694,
      109.56332,
      109.88224,
      110.18361,
      110.49843,
      110.85688,
      111.2864,
      111.81002,
      112.44494,
      113.20141,
      114.08215,
      115.08213,
      116.18892,
      117.38344,
      118.64117,
      119.93364,
      121.23024,
      122.50009,
      123.71397,
      124.84616,
      125.876,
      126.7892,
      127.57872,
      128.24521,
      128.79697,
      129.24945,
      129.62424,
      129.94778,
      130.2497,
      130.56096,
      130.91196,
      131.3306,
      131.84061,
      132.46,
      133.20002,
      134.06438,
      135.0491,
      136.14267,
      137.32685,
      138.57776,
      139.86736,
      141.1652,
      142.44033,
      143.66322,
      144.80757,
      145.85196,
      146.78121,
      147.58728,
      148.26979,
      148.83604
    ] },
    { kind: "number", key: "horizon", label: "HORIZON", default: 8 },
    { kind: "number", key: "validationWindow", label: "VALIDATION WINDOW", default: 20 },
    { kind: "stringArray", key: "models", label: "MODELS", default: [
      "naive",
      "drift",
      "ar1"
    ] }
  ],
  "python.advanced.forecasting.probabilistic-ar1": [
    { kind: "numberArray", key: "series", label: "SERIES", default: [
      100,
      101.29481,
      102.55885,
      103.76328,
      104.88294,
      105.89797,
      106.79499,
      107.56797,
      108.21859,
      108.75615,
      109.19694,
      109.56332,
      109.88224,
      110.18361,
      110.49843,
      110.85688,
      111.2864,
      111.81002,
      112.44494,
      113.20141,
      114.08215,
      115.08213,
      116.18892,
      117.38344,
      118.64117,
      119.93364,
      121.23024,
      122.50009,
      123.71397,
      124.84616,
      125.876,
      126.7892,
      127.57872,
      128.24521,
      128.79697,
      129.24945,
      129.62424,
      129.94778,
      130.2497,
      130.56096,
      130.91196,
      131.3306,
      131.84061,
      132.46,
      133.20002,
      134.06438,
      135.0491,
      136.14267,
      137.32685,
      138.57776,
      139.86736,
      141.1652,
      142.44033,
      143.66322,
      144.80757,
      145.85196,
      146.78121,
      147.58728,
      148.26979,
      148.83604
    ] },
    { kind: "number", key: "horizon", label: "HORIZON", default: 8 },
    { kind: "number", key: "nSimulations", label: "N SIMULATIONS", default: 10000 },
    { kind: "number", key: "seed", label: "SEED", default: 42 },
    { kind: "numberArray", key: "confidenceLevels", label: "CONFIDENCE LEVELS", default: [
      0.5,
      0.8,
      0.95
    ] }
  ],
  "python.advanced.forecasting.nowcast": [
    { kind: "numberArray", key: "targetHistory", label: "TARGET HISTORY", default: [
      2,
      2.2186693307950613,
      2.4294183423086504,
      2.6246424733950353,
      2.7973560908995228,
      2.941470984807897,
      3.0520390859672264,
      3.12544972998846,
      3.159573603041505,
      3.1538476308781953,
      3.109297426825682,
      3.0284964038195903,
      2.915463180551151,
      2.7755013718214645,
      2.614988150155905,
      2.441120008059867,
      2.2616258565724197,
      2.084458897973169,
      1.9174795567051475,
      1.768142109057281,
      1.6431975046920715,
      1.5484242275864117,
      1.4883979261104838,
      1.4663089963665357,
      1.4838353911641593,
      1.5410757253368614,
      1.6365453442798468,
      1.767235512444013,
      1.9287333621276783,
      2.1153978205862427,
      2.3205845018010742,
      2.5369105971825037,
      2.7565492048504936,
      2.971541363513378,
      3.174113351138608,
      3.3569865987187892,
      3.513667863849153,
      3.6387080958116274,
      3.7279196720314864,
      3.7785433453746053
    ] },
    { kind: "numberMatrix", key: "indicatorHistory", label: "INDICATOR HISTORY", default: [
      [
        0,
        0
      ],
      [
        0.19866933079506122,
        0.025
      ],
      [
        0.3894183423086505,
        0.05
      ],
      [
        0.5646424733950354,
        0.075
      ],
      [
        0.7173560908995228,
        0.1
      ],
      [
        0.8414709848078965,
        0.125
      ],
      [
        0.9320390859672263,
        0.15
      ],
      [
        0.9854497299884601,
        0.175
      ],
      [
        0.9995736030415051,
        0.2
      ],
      [
        0.9738476308781951,
        0.225
      ],
      [
        0.9092974268256817,
        0.25
      ],
      [
        0.8084964038195901,
        0.275
      ],
      [
        0.6754631805511511,
        0.3
      ],
      [
        0.5155013718214642,
        0.325
      ],
      [
        0.3349881501559051,
        0.35
      ],
      [
        0.1411200080598672,
        0.375
      ],
      [
        -0.058374143427580086,
        0.4
      ],
      [
        -0.2555411020268312,
        0.425
      ],
      [
        -0.44252044329485246,
        0.45
      ],
      [
        -0.6118578909427189,
        0.475
      ],
      [
        -0.7568024953079283,
        0.5
      ],
      [
        -0.8715757724135882,
        0.525
      ],
      [
        -0.9516020738895161,
        0.55
      ],
      [
        -0.9936910036334644,
        0.575
      ],
      [
        -0.9961646088358407,
        0.6
      ],
      [
        -0.9589242746631385,
        0.625
      ],
      [
        -0.8834546557201531,
        0.65
      ],
      [
        -0.7727644875559871,
        0.675
      ],
      [
        -0.6312666378723216,
        0.7
      ],
      [
        -0.46460217941375737,
        0.725
      ],
      [
        -0.27941549819892586,
        0.75
      ],
      [
        -0.0830894028174964,
        0.775
      ],
      [
        0.11654920485049364,
        0.8
      ],
      [
        0.31154136351337786,
        0.825
      ],
      [
        0.49411335113860816,
        0.85
      ],
      [
        0.6569865987187891,
        0.875
      ],
      [
        0.7936678638491531,
        0.9
      ],
      [
        0.8987080958116269,
        0.925
      ],
      [
        0.9679196720314863,
        0.95
      ],
      [
        0.998543345374605,
        0.975
      ]
    ] },
    { kind: "numberArray", key: "currentIndicators", label: "CURRENT INDICATORS", default: [
      0.5,
      1.05
    ] }
  ],
  "python.advanced.forecasting.regime-conditioned": [
    { kind: "numberArray", key: "regimeProbabilities", label: "REGIME PROBABILITIES", default: [
      0.6,
      0.3,
      0.1
    ] },
    { kind: "numberMatrix", key: "regimeForecasts", label: "REGIME FORECASTS", default: [
      [
        2,
        2.2,
        2.4
      ],
      [
        0,
        -0.5,
        -0.2
      ],
      [
        4,
        4.5,
        5
      ]
    ] }
  ],
  "python.advanced.risk.tail-report": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "A",
      "B"
    ] },
    { kind: "numberMatrix", key: "returnsMatrixPct", label: "RETURNS MATRIX PCT", default: [
      [
        0,
        0.9
      ],
      [
        0.23840319695407344,
        0.8908319344019536
      ],
      [
        0.4673020107703806,
        0.8635145230007256
      ],
      [
        0.6775709680740424,
        0.81860431650675
      ],
      [
        0.8608273090794273,
        0.7570162920737126
      ],
      [
        1.0097651817694757,
        0.680005212030627
      ],
      [
        1.1184469031606714,
        0.5891400600077409
      ],
      [
        1.1825396759861522,
        0.4862720752813258
      ],
      [
        1.1994883236498062,
        0.3734970365889611
      ],
      [
        1.1686171570538342,
        0.2531125638252106
      ],
      [
        1.091156912190818,
        0.12757130753070642
      ],
      [
        0.970195684583508,
        -0.0005690201323979178
      ],
      [
        0.8105558166613812,
        -0.1286977548757235
      ],
      [
        0.618601646185757,
        -0.2542044685990006
      ],
      [
        0.40198578018708614,
        -0.3745321528924282
      ],
      [
        0.16934400967184066,
        -0.4872293141940883
      ],
      [
        -0.0700489721130961,
        -0.5899999192428095
      ],
      [
        -0.30664932243219745,
        -0.6807501732638414
      ],
      [
        -0.5310245319538229,
        -0.7576311778529526
      ],
      [
        -0.7342294691312626,
        -0.8190765994694391
      ],
      [
        -0.908162994369514,
        -0.8638345810997909
      ],
      [
        -1.0458909268963057,
        -0.8909932469404009
      ],
      [
        -1.1419224886674193,
        -0.8999992804801977
      ],
      [
        -1.1924292043601572,
        -0.8906691974830232
      ],
      [
        -1.1953975306030087,
        -0.8631930841998848
      ],
      [
        -1.150709129595766,
        -0.8181307246506919
      ],
      [
        -1.0601455868641838,
        -0.7564001958762216
      ],
      [
        -0.9273173850671845,
        -0.6792591635147107
      ],
      [
        -0.7575199654467859,
        -0.5882792587772507
      ],
      [
        -0.5575226152965088,
        -0.4853140588521461
      ],
      [
        -0.335298597838711,
        -0.37246132308879637
      ],
      [
        -0.09970728338099567,
        -0.2520202543414164
      ],
      [
        0.13985904582059236,
        -0.12644465620772954
      ],
      [
        0.37384963621605344,
        0.001707059487368946
      ],
      [
        0.5929360213663297,
        0.12982399644166673
      ],
      [
        0.7883839184625469,
        0.25529596691690365
      ],
      [
        0.9524014366189837,
        0.3755666703441164
      ],
      [
        1.0784497149739523,
        0.48818577405987346
      ],
      [
        1.1615036064377835,
        0.5908588351076001
      ],
      [
        1.198252014449526,
        0.6814940460232112
      ],
      [
        1.187229895948058,
        0.7582448522307808
      ],
      [
        1.1288766680157276,
        0.8195475727836102
      ],
      [
        1.0255186897059365,
        0.8641532579853294
      ],
      [
        0.8812765174489361,
        0.8911531348404372
      ],
      [
        0.7019006314701141,
        0.8999971219219409
      ],
      [
        0.4945421822901079,
        0.890505036443815
      ],
      [
        0.26746789692029715,
        0.8628702652112278
      ],
      [
        0.029730510544029316,
        0.8176558246585064
      ],
      [
        -0.20919213746757556,
        0.7557828902455768
      ],
      [
        -0.4397749551023141,
        0.6785120289089741
      ],
      [
        -0.6528253330672437,
        0.5874175169277026
      ],
      [
        -0.8398496251122508,
        0.4843552664383544
      ],
      [
        -0.9933917629027844,
        0.3714250140479699
      ],
      [
        -1.1073305059353677,
        0.2509275418941481
      ],
      [
        -1.1771234760797897,
        0.125317802708232
      ],
      [
        -1.1999882478608441,
        -0.002845096112865808
      ],
      [
        -1.175013274981581,
        -0.1309500304277522
      ],
      [
        -1.1031942307976108,
        -0.2563870570336871
      ],
      [
        -0.9873943139624506,
        -0.3766005872899014
      ],
      [
        -0.8322301017325469,
        -0.48914145334936626
      ],
      [
        -0.6438875016005219,
        -0.5917168062287628
      ],
      [
        -0.4298751386841944,
        -0.6822368291193333
      ],
      [
        -0.19872501053797129,
        -0.7588573142259729
      ],
      [
        0.04034765666536403,
        -0.8200172356962092
      ],
      [
        0.2778117901218467,
        -0.864470553147798
      ],
      [
        0.5042004441919691,
        -0.8913115978464126
      ],
      [
        0.7104882176486677,
        -0.8999935243286813
      ],
      [
        0.8884510679429384,
        -0.8903394515468116
      ],
      [
        1.030994177827795,
        -0.8625460665509203
      ],
      [
        1.1324348033329257,
        -0.8171796172895266
      ],
      [
        1.1887288268338443,
        -0.7551643761688072
      ],
      [
        1.197631983259634,
        -0.6777638094080358
      ],
      [
        1.158789331859133,
        -0.5865548358369641
      ],
      [
        1.073749406568605,
        -0.4833956995729942
      ],
      [
        0.9459024808503795,
        -0.3703881111234716
      ],
      [
        0.7803454081885401,
        -0.24983442823057903
      ],
      [
        0.5836784266245596,
        -0.12419074883397745
      ],
      [
        0.3637420280948427,
        0.003983128189245707
      ],
      [
        0.12930438275933287,
        0.13207585503352567
      ],
      [
        -0.11028822027321795,
        0.2574777372047729
      ],
      [
        -0.34548397999807834,
        0.3776339020766188
      ],
      [
        -0.5669063836781594,
        0.49009635053449874
      ],
      [
        -0.765728018817537,
        0.5925738312344601
      ],
      [
        -0.9340224942411581,
        0.6829785213645486
      ],
      [
        -1.0650804402978054,
        0.7594685628592429
      ],
      [
        -1.1536769902554682,
        0.820485587456276
      ],
      [
        -1.1962800792499153,
        0.8647864660798634
      ],
      [
        -1.1911912565647598,
        0.8914686357049549
      ],
      [
        -1.1386133975017487,
        0.8999884877061711
      ],
      [
        -1.0406426153826975,
        0.8901724430567722
      ],
      [
        -0.9011846961260114,
        0.8622204887373337
      ],
      [
        -0.7257993868875409,
        0.8167021033051766
      ],
      [
        -0.5214787464862761,
        0.7545446546348766
      ],
      [
        -0.29636839408394505,
        0.6770145062082471
      ],
      [
        -0.0594427690540409,
        0.5856912168844048
      ],
      [
        0.1798526515955428,
        0.48243535979034957
      ],
      [
        0.41197791458387445,
        0.3693506159732387
      ],
      [
        0.6276789181892357,
        0.248740915098523
      ],
      [
        0.8183563440817627,
        0.12306349638705025
      ],
      [
        0.9764084850085264,
        -0.005121153896870124
      ],
      [
        1.095534300873153,
        -0.13320146845887162
      ],
      [
        1.1709846213203705,
        -0.25856800568623367
      ],
      [
        1.199751480171203,
        -0.3786666130520681
      ],
      [
        1.1806880335423393,
        -0.49105046408845504
      ],
      [
        1.1145542808926885,
        -0.5934299087543674
      ],
      [
        1.003986766243267,
        -0.6837191215729392
      ],
      [
        0.8533934674871789,
        -0.7600785971532457
      ],
      [
        0.6687780642211937,
        -0.8209526273149483
      ],
      [
        0.45750058998592813,
        -0.8651009962764015
      ],
      [
        0.22798401095452528,
        -0.8916242481649715
      ],
      [
        -0.010621571148484651,
        -0.8999820120624634
      ],
      [
        -0.24880370472811053,
        -0.8900040112407319
      ],
      [
        -0.47706681974571946,
        -0.8618935322910463
      ],
      [
        -0.6863107861314766,
        -0.8162232834689689
      ],
      [
        -0.868193707253094,
        -0.7539237266346775
      ],
      [
        -1.0154644850102048,
        -0.6762641205076967
      ],
      [
        -1.1222518982334466,
        -0.5848266614508919
      ],
      [
        -1.1842986697447784,
        -0.4814742486259375
      ],
      [
        -1.1991311905639532,
        -0.368312530256155
      ],
      [
        -1.166158134892636,
        -0.24764700424643724
      ]
    ] },
    { kind: "numberArray", key: "weights", label: "WEIGHTS", default: [
      0.6,
      0.4
    ] },
    { kind: "number", key: "portfolioValue", label: "PORTFOLIO VALUE", default: 1000000 },
    { kind: "number", key: "confidencePct", label: "CONFIDENCE PCT", default: 99 },
    { kind: "number", key: "ewmaLambda", label: "EWMA LAMBDA", default: 0.94 },
    { kind: "number", key: "evtThresholdPct", label: "EVT THRESHOLD PCT", default: 95 },
    { kind: "number", key: "monteCarloSims", label: "MONTE CARLO SIMS", default: 20000 },
    { kind: "number", key: "studentTDegreesFreedom", label: "STUDENT TDEGREES FREEDOM", default: 6 },
    { kind: "number", key: "seed", label: "SEED", default: 42 }
  ],
  "python.advanced.risk.liquidity-var": [
    { kind: "objectArray", key: "positions", label: "POSITIONS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "A" },
      { kind: "number", key: "marketValue", label: "MARKET VALUE", default: 500000 },
      { kind: "number", key: "dailyVolumeValue", label: "DAILY VOLUME VALUE", default: 5000000 },
      { kind: "number", key: "bidAskSpreadBps", label: "BID ASK SPREAD BPS", default: 8 },
      { kind: "number", key: "dailyVolatilityPct", label: "DAILY VOLATILITY PCT", default: 2 },
      { kind: "number", key: "liquidationDays", label: "LIQUIDATION DAYS", default: 1 }
    ], default: [
      {
        "name": "A",
        "marketValue": 500000,
        "dailyVolumeValue": 5000000,
        "bidAskSpreadBps": 8,
        "dailyVolatilityPct": 2,
        "liquidationDays": 1
      },
      {
        "name": "B",
        "marketValue": 300000,
        "dailyVolumeValue": 1000000,
        "bidAskSpreadBps": 20,
        "dailyVolatilityPct": 3,
        "liquidationDays": 1
      }
    ] },
    { kind: "number", key: "participationRatePct", label: "PARTICIPATION RATE PCT", default: 20 },
    { kind: "number", key: "confidencePct", label: "CONFIDENCE PCT", default: 99 }
  ],
  "python.advanced.risk.reverse-stress": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "A",
      "B",
      "C"
    ] },
    { kind: "numberArray", key: "weights", label: "WEIGHTS", default: [
      0.4,
      0.35,
      0.25
    ] },
    { kind: "numberMatrix", key: "covMatrixPct2", label: "COV MATRIX PCT 2", default: [
      [
        4,
        1,
        0.5
      ],
      [
        1,
        3,
        0.4
      ],
      [
        0.5,
        0.4,
        5
      ]
    ] },
    { kind: "number", key: "targetPortfolioLossPct", label: "TARGET PORTFOLIO LOSS PCT", default: 12 }
  ],
  "python.advanced.risk.correlation-breakdown": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "A",
      "B",
      "C"
    ] },
    { kind: "numberArray", key: "weights", label: "WEIGHTS", default: [
      0.4,
      0.35,
      0.25
    ] },
    { kind: "numberArray", key: "assetVolatilityPct", label: "ASSET VOLATILITY PCT", default: [
      18,
      12,
      25
    ] },
    { kind: "numberMatrix", key: "baseCorrelationMatrix", label: "BASE CORRELATION MATRIX", default: [
      [
        1,
        0.3,
        0.4
      ],
      [
        0.3,
        1,
        0.2
      ],
      [
        0.4,
        0.2,
        1
      ]
    ] },
    { kind: "number", key: "stressedPairwiseCorrelation", label: "STRESSED PAIRWISE CORRELATION", default: 0.8 }
  ],
  "python.advanced.supply-chain.facility-location": [
    { kind: "objectArray", key: "facilities", label: "FACILITIES", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "North" },
      { kind: "number", key: "fixedCost", label: "FIXED COST", default: 100 },
      { kind: "number", key: "capacity", label: "CAPACITY", default: 120 }
    ], default: [
      {
        "name": "North",
        "fixedCost": 100,
        "capacity": 120
      },
      {
        "name": "South",
        "fixedCost": 80,
        "capacity": 100
      }
    ] },
    { kind: "stringArray", key: "customerNames", label: "CUSTOMER NAMES", default: [
      "C1",
      "C2"
    ] },
    { kind: "numberArray", key: "demand", label: "DEMAND", default: [
      70,
      60
    ] },
    { kind: "numberMatrix", key: "transportCost", label: "TRANSPORT COST", default: [
      [
        2,
        5
      ],
      [
        4,
        2
      ]
    ] },
    { kind: "number", key: "maxOpenFacilities", label: "MAX OPEN FACILITIES", default: 2 }
  ],
  "python.advanced.supply-chain.stochastic-inventory": [
    { kind: "numberArray", key: "demandScenarios", label: "DEMAND SCENARIOS", default: [
      80,
      90,
      100,
      110,
      120,
      130,
      95,
      105,
      115,
      125
    ] },
    { kind: "number", key: "unitPurchaseCost", label: "UNIT PURCHASE COST", default: 10 },
    { kind: "number", key: "holdingCostPerUnit", label: "HOLDING COST PER UNIT", default: 2 },
    { kind: "number", key: "stockoutCostPerUnit", label: "STOCKOUT COST PER UNIT", default: 8 },
    { kind: "number", key: "salvageValuePerUnit", label: "SALVAGE VALUE PER UNIT", default: 1 },
    { kind: "number", key: "maxOrderQuantity", label: "MAX ORDER QUANTITY", default: 160 }
  ],
  "python.advanced.supply-chain.supplier-portfolio": [
    { kind: "objectArray", key: "suppliers", label: "SUPPLIERS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "A" },
      { kind: "number", key: "unitCost", label: "UNIT COST", default: 10 },
      { kind: "number", key: "capacity", label: "CAPACITY", default: 80 },
      { kind: "number", key: "disruptionProbabilityPct", label: "DISRUPTION PROBABILITY PCT", default: 5 },
      { kind: "number", key: "emissionsPerUnit", label: "EMISSIONS PER UNIT", default: 2 }
    ], default: [
      {
        "name": "A",
        "unitCost": 10,
        "capacity": 80,
        "disruptionProbabilityPct": 5,
        "emissionsPerUnit": 2
      },
      {
        "name": "B",
        "unitCost": 11,
        "capacity": 80,
        "disruptionProbabilityPct": 2,
        "emissionsPerUnit": 1
      },
      {
        "name": "C",
        "unitCost": 9.5,
        "capacity": 60,
        "disruptionProbabilityPct": 12,
        "emissionsPerUnit": 3
      }
    ] },
    { kind: "number", key: "demand", label: "DEMAND", default: 120 },
    { kind: "number", key: "riskPenaltyPerExpectedLostUnit", label: "RISK PENALTY PER EXPECTED LOST UNIT", default: 5 },
    { kind: "number", key: "carbonPricePerEmissionUnit", label: "CARBON PRICE PER EMISSION UNIT", default: 0.5 },
    { kind: "number", key: "concentrationPenalty", label: "CONCENTRATION PENALTY", default: 20 },
    { kind: "number", key: "maxSupplierShare", label: "MAX SUPPLIER SHARE", default: 0.6 }
  ],
  "python.advanced.supply-chain.disruption-simulation": [
    { kind: "objectArray", key: "suppliers", label: "SUPPLIERS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "A" },
      { kind: "number", key: "allocation", label: "ALLOCATION", default: 60 },
      { kind: "number", key: "disruptionProbabilityPct", label: "DISRUPTION PROBABILITY PCT", default: 5 },
      { kind: "number", key: "recoveryDaysMean", label: "RECOVERY DAYS MEAN", default: 20 },
      { kind: "number", key: "recoveryDaysStd", label: "RECOVERY DAYS STD", default: 5 },
      { kind: "number", key: "backupCostPremiumPct", label: "BACKUP COST PREMIUM PCT", default: 20 }
    ], default: [
      {
        "name": "A",
        "allocation": 60,
        "disruptionProbabilityPct": 5,
        "recoveryDaysMean": 20,
        "recoveryDaysStd": 5,
        "backupCostPremiumPct": 20
      },
      {
        "name": "B",
        "allocation": 40,
        "disruptionProbabilityPct": 10,
        "recoveryDaysMean": 30,
        "recoveryDaysStd": 8,
        "backupCostPremiumPct": 30
      }
    ] },
    { kind: "number", key: "dailyDemand", label: "DAILY DEMAND", default: 100 },
    { kind: "number", key: "inventoryBufferUnits", label: "INVENTORY BUFFER UNITS", default: 500 },
    { kind: "number", key: "unitBaseCost", label: "UNIT BASE COST", default: 10 },
    { kind: "number", key: "simulations", label: "SIMULATIONS", default: 10000 },
    { kind: "number", key: "seed", label: "SEED", default: 42 }
  ],
  "python.advanced.supply-chain.resilience-frontier": [
    { kind: "objectArray", key: "suppliers", label: "SUPPLIERS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "A" },
      { kind: "number", key: "unitCost", label: "UNIT COST", default: 10 },
      { kind: "number", key: "capacity", label: "CAPACITY", default: 80 },
      { kind: "number", key: "disruptionProbabilityPct", label: "DISRUPTION PROBABILITY PCT", default: 5 },
      { kind: "number", key: "emissionsPerUnit", label: "EMISSIONS PER UNIT", default: 2 }
    ], default: [
      {
        "name": "A",
        "unitCost": 10,
        "capacity": 80,
        "disruptionProbabilityPct": 5,
        "emissionsPerUnit": 2
      },
      {
        "name": "B",
        "unitCost": 11,
        "capacity": 80,
        "disruptionProbabilityPct": 2,
        "emissionsPerUnit": 1
      },
      {
        "name": "C",
        "unitCost": 9.5,
        "capacity": 60,
        "disruptionProbabilityPct": 12,
        "emissionsPerUnit": 3
      }
    ] },
    { kind: "number", key: "demand", label: "DEMAND", default: 120 },
    { kind: "number", key: "carbonPricePerEmissionUnit", label: "CARBON PRICE PER EMISSION UNIT", default: 0.5 },
    { kind: "number", key: "concentrationPenalty", label: "CONCENTRATION PENALTY", default: 20 },
    { kind: "number", key: "maxSupplierShare", label: "MAX SUPPLIER SHARE", default: 0.6 },
    { kind: "numberArray", key: "riskPenaltyGrid", label: "RISK PENALTY GRID", default: [
      0,
      1,
      5,
      10,
      25
    ] }
  ],
  "python.advanced.climate.financed-emissions": [
    { kind: "objectArray", key: "assets", label: "ASSETS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "Issuer A" },
      { kind: "number", key: "exposure", label: "EXPOSURE", default: 50 },
      { kind: "number", key: "enterpriseValueIncludingCash", label: "ENTERPRISE VALUE INCLUDING CASH", default: 100 },
      { kind: "number", key: "scope1", label: "SCOPE 1", default: 10 },
      { kind: "number", key: "scope2", label: "SCOPE 2", default: 10 },
      { kind: "number", key: "scope3", label: "SCOPE 3", default: 20 },
      { kind: "number", key: "revenue", label: "REVENUE", default: 100 }
    ], default: [
      {
        "name": "Issuer A",
        "exposure": 50,
        "enterpriseValueIncludingCash": 100,
        "scope1": 10,
        "scope2": 10,
        "scope3": 20,
        "revenue": 100
      },
      {
        "name": "Issuer B",
        "exposure": 40,
        "enterpriseValueIncludingCash": 200,
        "scope1": 20,
        "scope2": 10,
        "scope3": 30,
        "revenue": 150
      }
    ] },
    { kind: "boolean", key: "includeScope3", label: "INCLUDE SCOPE 3", default: true }
  ],
  "python.advanced.climate.climate-var": [
    { kind: "objectArray", key: "assets", label: "ASSETS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "A" },
      { kind: "number", key: "marketValue", label: "MARKET VALUE", default: 1000 },
      { kind: "number", key: "scope12Tonnes", label: "SCOPE 12 TONNES", default: 100 },
      { kind: "number", key: "annualRevenue", label: "ANNUAL REVENUE", default: 500 },
      { kind: "number", key: "ebitdaMarginPct", label: "EBITDA MARGIN PCT", default: 20 },
      { kind: "number", key: "carbonCostPassThroughPct", label: "CARBON COST PASS THROUGH PCT", default: 30 },
      { kind: "number", key: "physicalHazardExposurePct", label: "PHYSICAL HAZARD EXPOSURE PCT", default: 20 },
      { kind: "number", key: "physicalDamageSensitivity", label: "PHYSICAL DAMAGE SENSITIVITY", default: 0.3 },
      { kind: "number", key: "valuationMultiple", label: "VALUATION MULTIPLE", default: 8 }
    ], default: [
      {
        "name": "A",
        "marketValue": 1000,
        "scope12Tonnes": 100,
        "annualRevenue": 500,
        "ebitdaMarginPct": 20,
        "carbonCostPassThroughPct": 30,
        "physicalHazardExposurePct": 20,
        "physicalDamageSensitivity": 0.3,
        "valuationMultiple": 8
      }
    ] },
    { kind: "objectArray", key: "scenarios", label: "SCENARIOS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "orderly" },
      { kind: "number", key: "carbonPricePerTonne", label: "CARBON PRICE PER TONNE", default: 80 },
      { kind: "number", key: "demandShockPct", label: "DEMAND SHOCK PCT", default: 2 },
      { kind: "number", key: "physicalHazardSeverity", label: "PHYSICAL HAZARD SEVERITY", default: 0.2 }
    ], default: [
      {
        "name": "orderly",
        "carbonPricePerTonne": 80,
        "demandShockPct": 2,
        "physicalHazardSeverity": 0.2
      },
      {
        "name": "disorderly",
        "carbonPricePerTonne": 180,
        "demandShockPct": 8,
        "physicalHazardSeverity": 0.6
      }
    ] }
  ],
  "python.advanced.climate.abatement-curve": [
    { kind: "objectArray", key: "projects", label: "PROJECTS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "Efficiency" },
      { kind: "number", key: "annualAbatementTonnes", label: "ANNUAL ABATEMENT TONNES", default: 100 },
      { kind: "number", key: "annualizedCost", label: "ANNUALIZED COST", default: -2000 },
      { kind: "number", key: "implementationCapex", label: "IMPLEMENTATION CAPEX", default: 10000 }
    ], default: [
      {
        "name": "Efficiency",
        "annualAbatementTonnes": 100,
        "annualizedCost": -2000,
        "implementationCapex": 10000
      },
      {
        "name": "Solar",
        "annualAbatementTonnes": 200,
        "annualizedCost": 6000,
        "implementationCapex": 50000
      },
      {
        "name": "CCUS",
        "annualAbatementTonnes": 300,
        "annualizedCost": 24000,
        "implementationCapex": 120000
      }
    ] },
    { kind: "number", key: "carbonPricePerTonne", label: "CARBON PRICE PER TONNE", default: 60 },
    { kind: "number", key: "abatementTargetTonnes", label: "ABATEMENT TARGET TONNES", default: 400 }
  ],
  "python.advanced.climate.transition-pathway": [
    { kind: "number", key: "baseEmissions", label: "BASE EMISSIONS", default: 1000 },
    { kind: "numberArray", key: "years", label: "YEARS", default: [
      2026,
      2030,
      2035,
      2040
    ] },
    { kind: "numberArray", key: "emissionsTargets", label: "EMISSIONS TARGETS", default: [
      950,
      700,
      450,
      200
    ] },
    { kind: "numberArray", key: "carbonPrices", label: "CARBON PRICES", default: [
      50,
      80,
      120,
      180
    ] },
    { kind: "numberArray", key: "revenueForecast", label: "REVENUE FORECAST", default: [
      1000,
      1200,
      1500,
      1800
    ] }
  ],
  "python.advanced.macro.yield-curve-signals": [
    { kind: "numberArray", key: "maturitiesYears", label: "MATURITIES YEARS", default: [
      0.25,
      1,
      2,
      5,
      10,
      30
    ] },
    { kind: "numberArray", key: "yieldsPct", label: "YIELDS PCT", default: [
      4.8,
      4.6,
      4.4,
      4.3,
      4.35,
      4.5
    ] }
  ],
  "python.advanced.macro.financial-conditions-index": [
    { kind: "stringArray", key: "indicatorNames", label: "INDICATOR NAMES", default: [
      "credit_spread",
      "equity_vol",
      "fx"
    ] },
    { kind: "numberMatrix", key: "historicalValues", label: "HISTORICAL VALUES", default: [
      [
        2,
        22,
        100
      ],
      [
        2.1986693307950613,
        21.944572926251702,
        100.33264788552987
      ],
      [
        2.3894183423086504,
        21.779827785258952,
        100.66119323036837
      ],
      [
        2.5646424733950353,
        21.51033024756149,
        100.98158409038845
      ],
      [
        2.7173560908995227,
        21.143549043107793,
        101.28986909058507
      ],
      [
        2.8414709848078967,
        20.689648976332226,
        101.5822461573156
      ],
      [
        2.9320390859672263,
        20.16120922347256,
        101.8551094092092
      ],
      [
        2.98544972998846,
        19.57287471910543,
        102.1050936284402
      ],
      [
        2.999573603041505,
        18.94095029321196,
        102.32911576390198
      ],
      [
        2.973847630878195,
        18.282948806670813,
        102.5244129544237
      ],
      [
        2.909297426825682,
        17.617105807942497,
        102.68857660308987
      ],
      [
        2.80849640381959,
        16.96187416152467,
        102.81958208242507
      ],
      [
        2.675463180551151,
        16.33541265381143,
        102.91581370408994
      ],
      [
        2.5155013718214643,
        15.755082748897035,
        102.9760846451379
      ],
      [
        2.334988150155905,
        15.236967441000495,
        102.9996515850823
      ],
      [
        2.1411200080598674,
        14.795425537812266,
        102.9862238732553
      ],
      [
        1.9416258565724198,
        14.442693727147834,
        102.93596711339751
      ],
      [
        1.7444588979731688,
        14.188547455048736,
        102.84950112127001
      ],
      [
        1.5574795567051476,
        14.04003001359822,
        102.72789228047705
      ],
      [
        1.3881421090572812,
        14.001257346386373,
        102.57264039077532
      ],
      [
        1.2431975046920716,
        14.073303981155684,
        102.38566017106915
      ],
      [
        1.1284242275864118,
        14.254173250836814,
        102.16925764521497
      ],
      [
        1.0483979261104839,
        14.538852628255057,
        101.92610170186848
      ],
      [
        1.0063089963665357,
        14.91945264098702,
        101.65919117912638
      ],
      [
        1.0038353911641593,
        15.385425516545553,
        101.37181787990744
      ],
      [
        1.0410757253368614,
        15.923857498461514,
        101.06752597420319
      ],
      [
        1.1165453442798468,
        16.51982673214985,
        100.75006828889009
      ],
      [
        1.2272355124440129,
        17.156816802276882,
        100.4233600241796
      ],
      [
        1.3687333621276783,
        17.817174461045678,
        100.09143046752096
      ],
      [
        1.5353978205862426,
        18.48259886212982,
        99.75837330046781
      ],
      [
        1.7205845018010741,
        19.134648741852907,
        99.42829611137354
      ],
      [
        1.9169105971825036,
        19.755253491829443,
        99.10526973657427
      ],
      [
        2.1165492048504935,
        20.327213959436683,
        98.79327805483382
      ],
      [
        2.3115413635133777,
        20.83467909716504,
        98.49616885423497
      ],
      [
        2.494113351138608,
        21.263585251207733,
        98.21760637747472
      ],
      [
        2.656986598718789,
        21.602045915049146,
        97.96102613082176
      ],
      [
        2.793667863849153,
        21.840681146601465,
        97.72959251407622
      ],
      [
        2.898708095811627,
        21.97287751957559,
        97.52615979408104
      ],
      [
        2.967919672031486,
        21.99497140491448,
        97.35323690309775
      ],
      [
        2.998543345374605,
        21.906350502912094,
        97.21295649618772
      ]
    ] },
    { kind: "numberArray", key: "tighteningDirection", label: "TIGHTENING DIRECTION", default: [
      1,
      1,
      1
    ] },
    { kind: "numberArray", key: "latestValues", label: "LATEST VALUES", default: [
      2.5,
      22,
      102
    ] }
  ],
  "python.advanced.macro.recession-probability": [
    { kind: "stringArray", key: "featureNames", label: "FEATURE NAMES", default: [
      "curve",
      "claims",
      "fci"
    ] },
    { kind: "numberMatrix", key: "historicalFeatures", label: "HISTORICAL FEATURES", default: [
      [
        0,
        1,
        0
      ],
      [
        0.12467,
        0.99704,
        0.08333
      ],
      [
        0.2474,
        0.98819,
        0.16667
      ],
      [
        0.36627,
        0.97349,
        0.25
      ],
      [
        0.47943,
        0.95304,
        0.33333
      ],
      [
        0.5851,
        0.92694,
        0.41667
      ],
      [
        0.68164,
        0.89537,
        0.5
      ],
      [
        0.76754,
        0.8585,
        0.58333
      ],
      [
        0.84147,
        0.81655,
        0.66667
      ],
      [
        0.90227,
        0.76978,
        0.75
      ],
      [
        0.94898,
        0.71845,
        0.83333
      ],
      [
        0.98089,
        0.66287,
        0.91667
      ],
      [
        0.99749,
        0.60337,
        0
      ],
      [
        0.99853,
        0.5403,
        0.08333
      ],
      [
        0.98399,
        0.47404,
        0.16667
      ],
      [
        0.95409,
        0.40497,
        0.25
      ],
      [
        0.9093,
        0.33351,
        0.33333
      ],
      [
        0.85032,
        0.26008,
        0.41667
      ],
      [
        0.77807,
        0.18511,
        0.5
      ],
      [
        0.69369,
        0.10904,
        0.58333
      ],
      [
        0.59847,
        0.03233,
        0.66667
      ],
      [
        0.49392,
        -0.04457,
        0.75
      ],
      [
        0.38166,
        -0.12121,
        0.83333
      ],
      [
        0.26345,
        -0.19713,
        0.91667
      ],
      [
        0.14112,
        -0.27189,
        0
      ],
      [
        0.01659,
        -0.34504,
        0.08333
      ],
      [
        -0.1082,
        -0.41615,
        0.16667
      ],
      [
        -0.23129,
        -0.48479,
        0.25
      ],
      [
        -0.35078,
        -0.55057,
        0.33333
      ],
      [
        -0.4648,
        -0.6131,
        0.41667
      ],
      [
        -0.57156,
        -0.67199,
        0.5
      ],
      [
        -0.6694,
        -0.72692,
        0.58333
      ],
      [
        -0.7568,
        -0.77754,
        0.66667
      ],
      [
        -0.83239,
        -0.82356,
        0.75
      ],
      [
        -0.89499,
        -0.86472,
        0.83333
      ],
      [
        -0.94362,
        -0.90076,
        0.91667
      ],
      [
        -0.97753,
        -0.93147,
        0
      ],
      [
        -0.99618,
        -0.95667,
        0.08333
      ],
      [
        -0.99929,
        -0.97622,
        0.16667
      ],
      [
        -0.98681,
        -0.98999,
        0.25
      ],
      [
        -0.95892,
        -0.99791,
        0.33333
      ],
      [
        -0.91608,
        -0.99992,
        0.41667
      ],
      [
        -0.85893,
        -0.99603,
        0.5
      ],
      [
        -0.78839,
        -0.98624,
        0.58333
      ],
      [
        -0.70554,
        -0.97062,
        0.66667
      ],
      [
        -0.61168,
        -0.94925,
        0.75
      ],
      [
        -0.50828,
        -0.92228,
        0.83333
      ],
      [
        -0.39694,
        -0.88984,
        0.91667
      ],
      [
        -0.27942,
        -0.85215,
        0
      ],
      [
        -0.15753,
        -0.80942,
        0.08333
      ],
      [
        -0.03318,
        -0.7619,
        0.16667
      ],
      [
        0.09169,
        -0.70987,
        0.25
      ],
      [
        0.21512,
        -0.65364,
        0.33333
      ],
      [
        0.3352,
        -0.59355,
        0.41667
      ],
      [
        0.45004,
        -0.52995,
        0.5
      ],
      [
        0.55787,
        -0.46322,
        0.58333
      ],
      [
        0.65699,
        -0.39374,
        0.66667
      ],
      [
        0.74585,
        -0.32194,
        0.75
      ],
      [
        0.82308,
        -0.24823,
        0.83333
      ],
      [
        0.88746,
        -0.17305,
        0.91667
      ],
      [
        0.938,
        -0.09685,
        0
      ],
      [
        0.9739,
        -0.02008,
        0.08333
      ],
      [
        0.9946,
        0.05681,
        0.16667
      ],
      [
        0.99978,
        0.13337,
        0.25
      ],
      [
        0.98936,
        0.20913,
        0.33333
      ],
      [
        0.9635,
        0.28366,
        0.41667
      ],
      [
        0.9226,
        0.35651,
        0.5
      ],
      [
        0.86731,
        0.42726,
        0.58333
      ],
      [
        0.79849,
        0.49547,
        0.66667
      ],
      [
        0.7172,
        0.56076,
        0.75
      ],
      [
        0.62472,
        0.62273,
        0.83333
      ],
      [
        0.5225,
        0.68102,
        0.91667
      ],
      [
        0.41212,
        0.73528,
        0
      ],
      [
        0.29531,
        0.78519,
        0.08333
      ],
      [
        0.17389,
        0.83045,
        0.16667
      ],
      [
        0.04976,
        0.87081,
        0.25
      ],
      [
        -0.07515,
        0.90601,
        0.33333
      ],
      [
        -0.19889,
        0.93586,
        0.41667
      ],
      [
        -0.31952,
        0.96017,
        0.5
      ],
      [
        -0.43517,
        0.9788,
        0.58333
      ]
    ] },
    { kind: "numberArray", key: "recessionLabels", label: "RECESSION LABELS", default: [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
      1,
      1
    ] },
    { kind: "numberArray", key: "latestFeatures", label: "LATEST FEATURES", default: [
      -0.5,
      0.7,
      0.8
    ] },
    { kind: "number", key: "l2PenaltyInverseC", label: "L 2 PENALTY INVERSE C", default: 1 }
  ],
  "python.advanced.macro.inflation-decomposition": [
    { kind: "objectArray", key: "components", label: "COMPONENTS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "Housing" },
      { kind: "number", key: "weightPct", label: "WEIGHT PCT", default: 35 },
      { kind: "number", key: "inflationRatePct", label: "INFLATION RATE PCT", default: 4 }
    ], default: [
      {
        "name": "Housing",
        "weightPct": 35,
        "inflationRatePct": 4
      },
      {
        "name": "Food",
        "weightPct": 20,
        "inflationRatePct": 3
      },
      {
        "name": "Energy",
        "weightPct": 10,
        "inflationRatePct": 6
      },
      {
        "name": "Core services",
        "weightPct": 35,
        "inflationRatePct": 3.5
      }
    ] }
  ],
  "python.advanced.macro.company-transmission": [
    { kind: "stringArray", key: "macroFactorNames", label: "MACRO FACTOR NAMES", default: [
      "gdp",
      "rates"
    ] },
    { kind: "numberMatrix", key: "macroChanges", label: "MACRO CHANGES", default: [
      [
        0,
        1
      ],
      [
        0.14237,
        0.99383
      ],
      [
        0.28184,
        0.97541
      ],
      [
        0.41557,
        0.94496
      ],
      [
        0.54083,
        0.90285
      ],
      [
        0.65508,
        0.84961
      ],
      [
        0.75598,
        0.78589
      ],
      [
        0.84147,
        0.71247
      ],
      [
        0.90982,
        0.63028
      ],
      [
        0.95964,
        0.5403
      ],
      [
        0.9899,
        0.44367
      ],
      [
        1,
        0.34156
      ],
      [
        0.98972,
        0.23524
      ],
      [
        0.95928,
        0.12602
      ],
      [
        0.9093,
        0.01524
      ],
      [
        0.84079,
        -0.09572
      ],
      [
        0.75515,
        -0.20551
      ],
      [
        0.65412,
        -0.31276
      ],
      [
        0.53977,
        -0.41615
      ],
      [
        0.41442,
        -0.51441
      ],
      [
        0.28063,
        -0.60632
      ],
      [
        0.14112,
        -0.69076
      ],
      [
        -0.00126,
        -0.76668
      ],
      [
        -0.14362,
        -0.83314
      ],
      [
        -0.28306,
        -0.88933
      ],
      [
        -0.41672,
        -0.93455
      ],
      [
        -0.5419,
        -0.96824
      ],
      [
        -0.65603,
        -0.98999
      ],
      [
        -0.7568,
        -0.99954
      ],
      [
        -0.84215,
        -0.99675
      ],
      [
        -0.91035,
        -0.98167
      ],
      [
        -0.95999,
        -0.95449
      ],
      [
        -0.99008,
        -0.91553
      ],
      [
        -1,
        -0.86529
      ],
      [
        -0.98954,
        -0.80437
      ],
      [
        -0.95892,
        -0.73353
      ],
      [
        -0.90877,
        -0.65364
      ],
      [
        -0.8401,
        -0.5657
      ],
      [
        -0.75432,
        -0.47077
      ],
      [
        -0.65317,
        -0.37004
      ],
      [
        -0.53871,
        -0.26475
      ],
      [
        -0.41327,
        -0.15619
      ],
      [
        -0.27942,
        -0.04571
      ],
      [
        -0.13987,
        0.06534
      ],
      [
        0.00253,
        0.17558
      ],
      [
        0.14487,
        0.28366
      ],
      [
        0.28427,
        0.38824
      ],
      [
        0.41787,
        0.48803
      ],
      [
        0.54296,
        0.5818
      ],
      [
        0.65699,
        0.6684
      ],
      [
        0.75763,
        0.74675
      ],
      [
        0.84283,
        0.8159
      ],
      [
        0.91087,
        0.87498
      ],
      [
        0.96035,
        0.92327
      ],
      [
        0.99026,
        0.96017
      ],
      [
        1,
        0.98523
      ],
      [
        0.98936,
        0.99814
      ],
      [
        0.95856,
        0.99874
      ],
      [
        0.90824,
        0.98703
      ],
      [
        0.83942,
        0.96314
      ]
    ] },
    { kind: "numberArray", key: "companyMetricChange", label: "COMPANY METRIC CHANGE", default: [
      -0.6,
      -0.40909426516019237,
      -0.21611950984651312,
      -0.026218450759605244,
      0.15588289506816563,
      0.3261003978875883,
      0.4811068713412841,
      0.6184362940869164,
      0.7364796313317905,
      0.8344440004029934,
      0.9121496018562257,
      0.9700001475705827,
      1.0086798752346038,
      1.0290732749364617,
      1.0320682541451034,
      1.0184337862668429,
      0.9888195304216209,
      0.9436900879127844,
      0.8834432250900537,
      0.8084563504941086,
      0.719255561528561,
      0.6166493299359395,
      0.5018708434809402,
      0.37666538934931865,
      0.24339391233116903,
      0.10503070540473472,
      -0.034958439244346974,
      -0.1726360757379121,
      -0.30387013822226255,
      -0.4245068386565156,
      -0.5306190555444684,
      -0.6187248141111613,
      -0.6860977878419052,
      -0.7308255103275351,
      -0.7520009813507741,
      -0.7497431423118295,
      -0.7251686459000216,
      -0.6802466882950583,
      -0.6177156007226714,
      -0.540771648158668,
      -0.4529044232711472,
      -0.35764291954089605,
      -0.2583476322152565,
      -0.15800695027566983,
      -0.059159006601599035,
      0.03616239200785583,
      0.1264764077676466,
      0.2106902432174333,
      0.28807683416674673,
      0.35807813288759627,
      0.4201836373421027,
      0.47378612540602216,
      0.5181304388457817,
      0.5521728629712985,
      0.5746606376614162,
      0.5841820754856338,
      0.5792544301298369,
      0.5585218604831476,
      0.520926320906691,
      0.46587858348985706
    ] },
    { kind: "record", key: "scenarioMacroChanges", label: "SCENARIO MACRO CHANGES", valueKind: "number", default: {
      "gdp": -2,
      "rates": 1.5
    } }
  ],
  "python.advanced.macro.fiscal-multiplier": [
    { kind: "number", key: "baselineGdp", label: "BASELINE GDP", default: 100000 },
    { kind: "number", key: "fiscalImpulse", label: "FISCAL IMPULSE", default: 1000 },
    { kind: "number", key: "multiplier", label: "MULTIPLIER", default: 1.4 },
    { kind: "number", key: "importLeakagePct", label: "IMPORT LEAKAGE PCT", default: 20 },
    { kind: "number", key: "crowdingOutPct", label: "CROWDING OUT PCT", default: 10 },
    { kind: "number", key: "taxFeedbackPct", label: "TAX FEEDBACK PCT", default: 15 }
  ],
  "python.advanced.research.filing-diff": [
    { kind: "string", key: "oldText", label: "OLD TEXT", default: "Revenue was 100. Gross margin was 30%. Demand remained stable." },
    { kind: "string", key: "newText", label: "NEW TEXT", default: "Revenue was 120. Gross margin was 32%. Demand remained stable. Supply risk increased." },
    { kind: "number", key: "maxChanges", label: "MAX CHANGES", default: 50 }
  ],
  "python.advanced.research.consensus-divergence": [
    { kind: "numberArray", key: "analystEstimates", label: "ANALYST ESTIMATES", default: [
      90,
      95,
      100,
      102,
      108,
      110
    ] },
    { kind: "number", key: "internalEstimate", label: "INTERNAL ESTIMATE", default: 125 },
    { kind: "number", key: "marketPrice", label: "MARKET PRICE", default: 100 }
  ],
  "python.advanced.research.catalyst-monitor": [
    { kind: "objectArray", key: "catalysts", label: "CATALYSTS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "margin" },
      { kind: "number", key: "currentValue", label: "CURRENT VALUE", default: 18 },
      { kind: "number", key: "triggerValue", label: "TRIGGER VALUE", default: 20 },
      { kind: "select", key: "direction", label: "DIRECTION", options: ["above","below"], default: "above" }
    ], default: [
      {
        "name": "margin",
        "currentValue": 18,
        "triggerValue": 20,
        "direction": "above"
      },
      {
        "name": "leverage",
        "currentValue": 2.5,
        "triggerValue": 3,
        "direction": "below"
      }
    ] }
  ],
  "python.advanced.financial-modeling.three-statement": [
    { kind: "number", key: "forecastYears", label: "FORECAST YEARS", default: 5 },
    { kind: "number", key: "startingRevenue", label: "STARTING REVENUE", default: 1000 },
    { kind: "numberArray", key: "revenueGrowthPct", label: "REVENUE GROWTH PCT", default: [
      8,
      7,
      6,
      5,
      5
    ] },
    { kind: "numberArray", key: "ebitdaMarginPct", label: "EBITDA MARGIN PCT", default: [
      20,
      21,
      22,
      22,
      23
    ] },
    { kind: "numberArray", key: "depreciationPctOfRevenue", label: "DEPRECIATION PCT OF REVENUE", default: [
      4,
      4,
      4,
      4,
      4
    ] },
    { kind: "numberArray", key: "capexPctOfRevenue", label: "CAPEX PCT OF REVENUE", default: [
      5,
      5,
      5,
      5,
      5
    ] },
    { kind: "numberArray", key: "netWorkingCapitalPctOfRevenue", label: "NET WORKING CAPITAL PCT OF REVENUE", default: [
      10,
      10,
      10,
      10,
      10
    ] },
    { kind: "number", key: "taxRatePct", label: "TAX RATE PCT", default: 25 },
    { kind: "number", key: "startingCash", label: "STARTING CASH", default: 100 },
    { kind: "number", key: "minimumCash", label: "MINIMUM CASH", default: 50 },
    { kind: "number", key: "startingDebt", label: "STARTING DEBT", default: 300 },
    { kind: "number", key: "debtInterestRatePct", label: "DEBT INTEREST RATE PCT", default: 6 },
    { kind: "number", key: "mandatoryDebtAmortizationPct", label: "MANDATORY DEBT AMORTIZATION PCT", default: 5 },
    { kind: "number", key: "debtCapacity", label: "DEBT CAPACITY", default: 600 },
    { kind: "number", key: "startingNetPPE", label: "STARTING NET PPE", default: 500 },
    { kind: "number", key: "startingNWC", label: "STARTING NWC", default: 100 },
    { kind: "numberArray", key: "annualDividends", label: "ANNUAL DIVIDENDS", default: [
      10,
      10,
      10,
      10,
      10
    ] },
    { kind: "boolean", key: "cashSweep", label: "CASH SWEEP", default: true }
  ],
  "python.advanced.decision.model-tournament": [
    { kind: "objectArray", key: "candidates", label: "CANDIDATES", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "DCF" },
      { kind: "number", key: "estimate", label: "ESTIMATE", default: 120 },
      { kind: "number", key: "lowerBound", label: "LOWER BOUND", default: 100 },
      { kind: "number", key: "upperBound", label: "UPPER BOUND", default: 140 },
      { kind: "number", key: "assuranceScore", label: "ASSURANCE SCORE", default: 92 },
      { kind: "number", key: "validationScore", label: "VALIDATION SCORE", default: 90 },
      { kind: "number", key: "dataQualityScore", label: "DATA QUALITY SCORE", default: 88 },
      { kind: "number", key: "suitabilityScore", label: "SUITABILITY SCORE", default: 95 },
      { kind: "number", key: "historicalRmse", label: "HISTORICAL RMSE", default: 10 }
    ], default: [
      {
        "name": "DCF",
        "estimate": 120,
        "lowerBound": 100,
        "upperBound": 140,
        "assuranceScore": 92,
        "validationScore": 90,
        "dataQualityScore": 88,
        "suitabilityScore": 95,
        "historicalRmse": 10
      },
      {
        "name": "Residual income",
        "estimate": 115,
        "lowerBound": 100,
        "upperBound": 130,
        "assuranceScore": 90,
        "validationScore": 88,
        "dataQualityScore": 90,
        "suitabilityScore": 85,
        "historicalRmse": 12
      },
      {
        "name": "Comps",
        "estimate": 130,
        "lowerBound": 110,
        "upperBound": 150,
        "assuranceScore": 85,
        "validationScore": 82,
        "dataQualityScore": 92,
        "suitabilityScore": 80,
        "historicalRmse": 15
      }
    ] },
    { kind: "number", key: "disagreementWarningPct", label: "DISAGREEMENT WARNING PCT", default: 20 },
    { kind: "number", key: "outlierMadThreshold", label: "OUTLIER MAD THRESHOLD", default: 3.5 }
  ],
  "python.advanced.decision.scenario-graph": [
    { kind: "objectArray", key: "nodes", label: "NODES", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "rates" },
      { kind: "number", key: "baseline", label: "BASELINE", default: 4 },
      { kind: "string", key: "domain", label: "DOMAIN", default: "macro" }
    ], default: [
      {
        "name": "rates",
        "baseline": 4,
        "domain": "macro"
      },
      {
        "name": "wacc",
        "baseline": 9,
        "domain": "valuation"
      },
      {
        "name": "equity_value",
        "baseline": 100,
        "domain": "valuation"
      },
      {
        "name": "portfolio",
        "baseline": 100,
        "domain": "portfolio"
      }
    ] },
    { kind: "objectArray", key: "edges", label: "EDGES", itemFields: [
      { kind: "string", key: "source", label: "SOURCE", default: "rates" },
      { kind: "string", key: "target", label: "TARGET", default: "wacc" },
      { kind: "number", key: "coefficient", label: "COEFFICIENT", default: 0.7 },
      { kind: "string", key: "mode", label: "MODE", default: "absolute" }
    ], default: [
      {
        "source": "rates",
        "target": "wacc",
        "coefficient": 0.7,
        "mode": "absolute"
      },
      {
        "source": "wacc",
        "target": "equity_value",
        "coefficient": -5,
        "mode": "absolute"
      },
      {
        "source": "equity_value",
        "target": "portfolio",
        "coefficient": 0.4,
        "mode": "absolute"
      }
    ] },
    { kind: "objectArray", key: "shocks", label: "SHOCKS", itemFields: [
      { kind: "string", key: "node", label: "NODE", default: "rates" },
      { kind: "number", key: "change", label: "CHANGE", default: 1.5 }
    ], default: [
      {
        "node": "rates",
        "change": 1.5
      }
    ] }
  ],
  "python.advanced.decision.uncertainty": [
    { kind: "number", key: "centralEstimate", label: "CENTRAL ESTIMATE", default: 120 },
    { kind: "objectArray", key: "factors", label: "FACTORS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "terminal_margin" },
      { kind: "number", key: "standardDeviation", label: "STANDARD DEVIATION", default: 2 },
      { kind: "number", key: "sensitivity", label: "SENSITIVITY", default: 5 },
      { kind: "string", key: "category", label: "CATEGORY", default: "parameter" }
    ], default: [
      {
        "name": "terminal_margin",
        "standardDeviation": 2,
        "sensitivity": 5,
        "category": "parameter"
      },
      {
        "name": "wacc",
        "standardDeviation": 1,
        "sensitivity": -8,
        "category": "market"
      },
      {
        "name": "revenue",
        "standardDeviation": 3,
        "sensitivity": 2,
        "category": "data"
      }
    ] },
    { kind: "numberMatrix", key: "correlationMatrix", label: "CORRELATION MATRIX", default: [
      [
        1,
        0.2,
        0.1
      ],
      [
        0.2,
        1,
        0.1
      ],
      [
        0.1,
        0.1,
        1
      ]
    ] },
    { kind: "number", key: "confidencePct", label: "CONFIDENCE PCT", default: 95 }
  ],
  "python.stats.normality": [
    { kind: "numberArray", key: "data", label: "DATA", default: [
      1.2,
      1.8,
      2.1,
      2.4,
      2.9,
      3.2,
      3.8,
      4.1,
      4.7,
      5.2
    ] }
  ],
  "python.stats.correlation": [
    { kind: "numberArray", key: "x", label: "X", default: [
      1,
      2,
      3,
      4,
      5,
      6
    ] },
    { kind: "numberArray", key: "y", label: "Y", default: [
      1.2,
      1.9,
      3.1,
      3.8,
      5.2,
      5.9
    ] }
  ],
  "python.stats.ols-diagnostics": [
    { kind: "numberArray", key: "y", label: "Y", default: [
      2.1,
      3.9,
      6.2,
      7.8,
      10.1,
      11.9
    ] },
    { kind: "numberMatrix", key: "x", label: "X", default: [
      [
        1,
        2,
        3,
        4,
        5,
        6
      ]
    ] }
  ],
  "python.stats.descriptive-diagnostics": [
    { kind: "numberArray", key: "data", label: "DATA", default: [
      101,
      102,
      99,
      103,
      0,
      100,
      98,
      104,
      101,
      135
    ] },
    { kind: "number", key: "trimProportion", label: "TRIM PROPORTION", default: 0.05 },
    { kind: "number", key: "winsorProportion", label: "WINSOR PROPORTION", default: 0.05 },
    { kind: "number", key: "outlierZThreshold", label: "OUTLIER ZTHRESHOLD", default: 3.5 }
  ],
  "python.stats.distribution-fit": [
    { kind: "numberArray", key: "data", label: "DATA", default: [
      0.8,
      1.1,
      1.3,
      1.4,
      1.8,
      2,
      2.2,
      2.5,
      3.1,
      3.8,
      4.2,
      5.1
    ] },
    { kind: "stringArray", key: "distributions", label: "DISTRIBUTIONS", default: [
      "normal",
      "student_t",
      "lognormal",
      "gamma"
    ] },
    { kind: "number", key: "nMcSamples", label: "N MC SAMPLES", default: 499 },
    { kind: "number", key: "seed", label: "SEED", default: 42 }
  ],
  "python.stats.professional-inference": [
    { kind: "numberArray", key: "group1", label: "GROUP 1", default: [
      0.12,
      0.08,
      0.15,
      0.11,
      0.09,
      0.14,
      0.13,
      0.1
    ] },
    { kind: "numberArray", key: "group2", label: "GROUP 2", default: [
      0.06,
      0.05,
      0.09,
      0.07,
      0.04,
      0.08,
      0.06,
      0.05
    ] },
    { kind: "boolean", key: "paired", label: "PAIRED", default: false },
    { kind: "number", key: "alpha", label: "ALPHA", default: 0.05 },
    { kind: "select", key: "alternative", label: "ALTERNATIVE", options: ["two-sided","greater","less"], default: "two-sided" },
    { kind: "number", key: "targetPower", label: "TARGET POWER", default: 0.8 }
  ],
  "python.stats.seeded-resampling": [
    { kind: "numberArray", key: "data", label: "DATA", default: [
      0.01,
      -0.004,
      0.008,
      0.012,
      -0.006,
      0.015,
      0.003,
      -0.002,
      0.009,
      0.005,
      -0.007,
      0.011
    ] },
    { kind: "numberArray", key: "group2", label: "GROUP 2", default: [
      0.003,
      -0.006,
      0.004,
      0.007,
      -0.009,
      0.008,
      0.001,
      -0.005,
      0.006,
      0.002,
      -0.008,
      0.005
    ] },
    { kind: "string", key: "statistic", label: "STATISTIC", default: "mean" },
    { kind: "number", key: "confidence", label: "CONFIDENCE", default: 0.95 },
    { kind: "number", key: "iterations", label: "ITERATIONS", default: 2000 },
    { kind: "number", key: "blockLength", label: "BLOCK LENGTH", default: 4 },
    { kind: "number", key: "seed", label: "SEED", default: 42 }
  ],
  "python.stats.multiple-testing": [
    { kind: "numberArray", key: "pValues", label: "P VALUES", default: [
      0.001,
      0.01,
      0.03,
      0.08,
      0.2,
      0.7
    ] },
    { kind: "stringArray", key: "labels", label: "LABELS", default: [
      "VALUE",
      "QUALITY",
      "MOMENTUM",
      "LOW_VOL",
      "SIZE",
      "LIQUIDITY"
    ] },
    { kind: "number", key: "alpha", label: "ALPHA", default: 0.05 }
  ],
  "python.stats.multivariate-structure": [
    { kind: "numberMatrix", key: "data", label: "DATA", default: [
      [
        1,
        1.1,
        4
      ],
      [
        2,
        1.9,
        3.8
      ],
      [
        3,
        3.2,
        3.1
      ],
      [
        4,
        3.9,
        2.9
      ],
      [
        5,
        5.1,
        2.2
      ],
      [
        6,
        5.8,
        2
      ],
      [
        7,
        7.2,
        1.4
      ],
      [
        8,
        7.9,
        1.1
      ],
      [
        9,
        9.1,
        0.7
      ],
      [
        10,
        9.8,
        0.4
      ]
    ] },
    { kind: "stringArray", key: "featureNames", label: "FEATURE NAMES", default: [
      "VALUE",
      "QUALITY",
      "DEFENSIVE"
    ] },
    { kind: "number", key: "nComponents", label: "N COMPONENTS", default: 2 },
    { kind: "number", key: "maxClusters", label: "MAX CLUSTERS", default: 4 },
    { kind: "number", key: "seed", label: "SEED", default: 42 }
  ],
  "python.stats.bayesian-normal": [
    { kind: "numberArray", key: "data", label: "DATA", default: [
      0.02,
      0.01,
      0.03,
      -0.01,
      0.015,
      0.025,
      0.005,
      0.018,
      0.012,
      0.022
    ] },
    { kind: "number", key: "priorMean", label: "PRIOR MEAN", default: 0 },
    { kind: "number", key: "priorKappa", label: "PRIOR KAPPA", default: 0.01 },
    { kind: "number", key: "priorAlpha", label: "PRIOR ALPHA", default: 2 },
    { kind: "number", key: "priorBeta", label: "PRIOR BETA", default: 0.001 },
    { kind: "number", key: "confidence", label: "CONFIDENCE", default: 0.95 },
    { kind: "number", key: "draws", label: "DRAWS", default: 4000 },
    { kind: "number", key: "seed", label: "SEED", default: 42 }
  ],
  "python.fixed-income.bond-price": [
    { kind: "number", key: "faceValue", label: "FACE VALUE", default: 1000 },
    { kind: "number", key: "couponRatePct", label: "COUPON RATE PCT", default: 5 },
    { kind: "number", key: "frequency", label: "FREQUENCY", default: 2 },
    { kind: "number", key: "yearsToMaturity", label: "YEARS TO MATURITY", default: 7 },
    { kind: "number", key: "marketYieldPct", label: "MARKET YIELD PCT", default: 4.5 },
    { kind: "select", key: "dayCount", label: "DAY COUNT", options: ["30/360","actual/360","actual/365","actual/actual"], default: "30/360" }
  ],
  "python.portfolio.min-variance": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: [
      "AAPL",
      "MSFT",
      "NVDA"
    ] },
    { kind: "numberArray", key: "expectedReturns", label: "EXPECTED RETURNS", default: [
      0.1,
      0.09,
      0.14
    ] },
    { kind: "numberMatrix", key: "covMatrix", label: "COV MATRIX", default: [
      [
        0.04,
        0.012,
        0.018
      ],
      [
        0.012,
        0.03,
        0.014
      ],
      [
        0.018,
        0.014,
        0.07
      ]
    ] },
    { kind: "boolean", key: "allowShort", label: "ALLOW SHORT", default: false }
  ],
  "python.forecasting.sarimax": [
    { kind: "numberArray", key: "series", label: "SERIES", default: [
      100,
      102,
      101,
      104,
      106,
      105,
      108,
      110,
      109,
      112,
      114,
      113,
      116,
      118,
      117,
      120,
      122,
      121,
      124,
      126,
      125,
      128,
      130,
      129
    ] },
    { kind: "numberArray", key: "order", label: "ORDER", default: [
      1,
      1,
      1
    ] },
    { kind: "number", key: "horizon", label: "HORIZON", default: 6 },
    { kind: "number", key: "confidenceLevel", label: "CONFIDENCE LEVEL", default: 0.95 }
  ],
  "python.advanced.portfolio.stress-aware": [
    { kind: "stringArray", key: "assets", label: "ASSETS", default: ["A", "B", "C"] },
    { kind: "numberArray", key: "expectedReturnsPct", label: "EXPECTED RETURNS PCT", default: [8, 7, 10] },
    { kind: "numberMatrix", key: "covMatrix", label: "COV MATRIX", default: [[4, 1, 0.5], [1, 3, 0.4], [0.5, 0.4, 5]] },
    { kind: "objectArray", key: "scenarios", label: "SCENARIOS", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "recession" },
      { kind: "numberArray", key: "assetReturnsPct", label: "ASSET RETURNS PCT", default: [-15, -8, -22] },
      { kind: "number", key: "probability", label: "PROBABILITY", default: 0.5 }
    ], default: [
      { name: "recession", assetReturnsPct: [-15, -8, -22], probability: 0.5 },
      { name: "inflation", assetReturnsPct: [-8, -5, -10], probability: 0.5 }
    ] },
    { kind: "number", key: "maxExpectedStressLossPct", label: "MAX EXPECTED STRESS LOSS PCT", default: 12 },
    { kind: "number", key: "riskAversion", label: "RISK AVERSION", default: 1 }
  ],
  "python.advanced.forecasting.reconcile-hierarchy": [
    { kind: "stringArray", key: "seriesNames", label: "SERIES NAMES", default: ["total", "A", "B"] },
    { kind: "record", key: "baseForecasts", label: "BASE FORECASTS", valueKind: "array", itemSchema: { kind: "numberArray", key: "value", label: "FORECAST VALUES", default: [] }, default: {
      total: [120, 125, 130],
      A: [55, 58, 60],
      B: [60, 62, 65]
    } },
    { kind: "record", key: "hierarchy", label: "HIERARCHY", valueKind: "array", itemSchema: { kind: "stringArray", key: "value", label: "CHILD SERIES", default: [] }, default: {
      total: ["A", "B"]
    } }
  ],
  "python.advanced.research.evidence-graph": [
    { kind: "objectArray", key: "claims", label: "CLAIMS", itemFields: [
      { kind: "string", key: "claimId", label: "CLAIM ID", default: "c1" },
      { kind: "string", key: "text", label: "TEXT", default: "Margins are improving" },
      { kind: "objectArray", key: "evidence", label: "EVIDENCE", itemFields: [
        { kind: "string", key: "sourceId", label: "SOURCE ID", default: "10-K" },
        { kind: "number", key: "reliabilityScore", label: "RELIABILITY SCORE", default: 95 },
        { kind: "select", key: "stance", label: "STANCE", options: ["supports", "refutes"], default: "supports" },
        { kind: "number", key: "strength", label: "STRENGTH", default: 0.9 }
      ], default: [
        { sourceId: "10-K", reliabilityScore: 95, stance: "supports", strength: 0.9 }
      ] }
    ], default: [
      { claimId: "c1", text: "Margins are improving", evidence: [
        { sourceId: "10-K", reliabilityScore: 95, stance: "supports", strength: 0.9 },
        { sourceId: "channel-check", reliabilityScore: 70, stance: "refutes", strength: 0.4 }
      ] },
      { claimId: "c2", text: "Demand remains strong", evidence: [
        { sourceId: "earnings", reliabilityScore: 90, stance: "supports", strength: 0.8 }
      ] }
    ] }
  ],
  "python.advanced.decision.value-of-information": [
    { kind: "stringArray", key: "stateNames", label: "STATE NAMES", default: ["boom", "base", "recession"] },
    { kind: "numberArray", key: "stateProbabilities", label: "STATE PROBABILITIES", default: [0.2, 0.6, 0.2] },
    { kind: "objectArray", key: "alternatives", label: "ALTERNATIVES", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "invest" },
      { kind: "numberArray", key: "payoffs", label: "PAYOFFS", default: [40, 15, -30] }
    ], default: [
      { name: "invest", payoffs: [40, 15, -30] },
      { name: "wait", payoffs: [10, 8, 2] },
      { name: "hedge", payoffs: [18, 10, 5] }
    ] }
  ],
  "python.advanced.decision.mcda": [
    { kind: "objectArray", key: "criteria", label: "CRITERIA", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "return" },
      { kind: "number", key: "weight", label: "WEIGHT", default: 0.4 },
      { kind: "select", key: "direction", label: "DIRECTION", options: ["maximize", "minimize"], default: "maximize" }
    ], default: [
      { name: "return", weight: 0.4, direction: "maximize" },
      { name: "risk", weight: 0.35, direction: "minimize" },
      { name: "liquidity", weight: 0.25, direction: "maximize" }
    ] },
    { kind: "objectArray", key: "alternatives", label: "ALTERNATIVES", itemFields: [
      { kind: "string", key: "name", label: "NAME", default: "A" },
      { kind: "record", key: "values", label: "VALUES", valueKind: "number", default: { return: 12, risk: 8, liquidity: 9 } }
    ], default: [
      { name: "A", values: { return: 12, risk: 8, liquidity: 9 } },
      { name: "B", values: { return: 10, risk: 5, liquidity: 7 } },
      { name: "C", values: { return: 14, risk: 12, liquidity: 5 } }
    ] }
  ],
};
