import type { QuantModelRegistryEntry } from "@shared/quantModelRegistry";

type PythonGroup = {
  category: string;
  source: string;
  status?: QuantModelRegistryEntry["status"];
  validationLevel?: QuantModelRegistryEntry["validationLevel"];
  determinism?: QuantModelRegistryEntry["determinism"];
  limitation: string;
  reference?: { label: string; url: string };
  models: Array<[path: string, label: string]>;
};

const PYTHON_GROUPS: PythonGroup[] = [
  {
    category: "fixed_income", source: "python-service/fixed_income.py",
    limitation: "Single fixed-rate bond analytics are implemented; curve bootstrapping, callable structures, spreads and key-rate risk are not yet part of this endpoint.",
    reference: { label: "QuantLib", url: "https://www.quantlib.org/docs.shtml" },
    models: [["fixed-income/bond-price", "Fixed-Rate Bond Price, Duration And Convexity"]],
  },
  {
    category: "portfolio_optimization", source: "python-service/portfolio_optimization.py",
    limitation: "Optimization consumes user-supplied moments or returns; estimation error, transaction costs and mandate constraints are not yet modeled.",
    reference: { label: "Markowitz Portfolio Selection", url: "https://www.jstor.org/stable/2975974" },
    models: [
      ["portfolio/min-variance", "Minimum Variance"], ["portfolio/max-sharpe", "Maximum Sharpe"],
      ["portfolio/efficient-frontier", "Efficient Frontier"], ["portfolio/risk-parity", "Equal Risk Contribution"],
      ["portfolio/max-diversification", "Maximum Diversification"], ["portfolio/mean-cvar", "Mean-CVaR Optimization"],
    ],
  },
  {
    category: "credit_and_operational_risk", source: "python-service/credit_operational_risk.py", determinism: "seeded_stochastic",
    limitation: "Credit VaR uses one-factor Gaussian dependence and operational risk uses Poisson-lognormal LDA; tail dependence and parameter uncertainty remain future work.",
    reference: { label: "Merton Corporate Debt", url: "https://doi.org/10.1111/j.1540-6261.1974.tb03058.x" },
    models: [["credit/credit-var", "Credit Portfolio VaR"], ["credit/operational-risk-lda", "Operational Risk LDA"]],
  },
  {
    category: "statistics", source: "python-service/statistics_econometrics.py",
    limitation: "Library routines require explicit effect sizes, multiple-testing control and known-answer coverage before production validation.",
    reference: { label: "SciPy Statistics", url: "https://docs.scipy.org/doc/scipy/reference/stats.html" },
    models: [
      ["stats/normality", "Normality Tests"], ["stats/hypothesis-tests", "Hypothesis Test Suite"],
      ["stats/correlation", "Correlation Analysis"], ["stats/partial-correlation", "Partial Correlation"],
      ["stats/ols-diagnostics", "OLS Diagnostics"], ["stats/gls", "Generalized Least Squares"],
      ["stats/logistic", "Logistic Regression"], ["stats/probit", "Probit Regression"],
      ["stats/robust-regression", "Robust M-Estimator Regression"], ["stats/influence-diagnostics", "Influence Diagnostics"],
      ["stats/vif", "Variance Inflation Factors"], ["stats/reset-test", "Ramsey RESET Specification Test"],
      ["stats/autocorrelation-tests", "Breusch-Godfrey And Ljung-Box Autocorrelation"],
    ],
  },
  {
    category: "statistics", source: "python-service/professional_statistics.py", status: "validated", validationLevel: "known_answer",
    limitation: "Professional statistical output remains conditional on sampling design, data quality, missingness mechanism, stated priors, and analyst interpretation; diagnostics cannot repair an invalid research design.",
    reference: { label: "SciPy Statistical Functions", url: "https://docs.scipy.org/doc/scipy/reference/stats.html" },
    models: [
      ["stats/descriptive-diagnostics", "Robust Descriptive And Data Diagnostics"],
      ["stats/professional-inference", "Professional Inference, Effects And Power"],
      ["stats/multiple-testing", "Family-Wise Error And False Discovery Control"],
    ],
  },
  {
    category: "statistics", source: "python-service/professional_statistics.py", status: "validated", validationLevel: "known_answer", determinism: "seeded_stochastic",
    limitation: "Monte Carlo, resampling, clustering, and posterior simulation are reproducible for a fixed environment and seed but still carry finite-simulation and model uncertainty.",
    reference: { label: "Bayesian Data Analysis", url: "https://sites.stat.columbia.edu/gelman/book/" },
    models: [
      ["stats/distribution-fit", "Distribution Fitting, QQ And Goodness-Of-Fit"],
      ["stats/seeded-resampling", "Bootstrap, Block Bootstrap, Permutation And Jackknife"],
      ["stats/multivariate-structure", "PCA, Factor, Shrinkage And Cluster Diagnostics"],
      ["stats/bayesian-normal", "Bayesian Estimation And Predictive Checks"],
    ],
  },
  {
    category: "econometrics", source: "python-service/econometrics.py",
    limitation: "Methods are operational but causal interpretation depends on identification assumptions that the current UI does not yet enforce.",
    reference: { label: "Statsmodels", url: "https://www.statsmodels.org/stable/index.html" },
    models: [
      ["econometrics/panel-ols", "Panel OLS"], ["econometrics/iv-2sls", "Instrumental Variables 2SLS"],
      ["econometrics/did", "Difference In Differences"], ["econometrics/rd", "Regression Discontinuity"],
      ["econometrics/var", "Vector Autoregression"], ["econometrics/vecm", "Vector Error Correction"],
      ["econometrics/granger", "Granger Predictive Causality"], ["econometrics/johansen", "Johansen Cointegration"],
      ["econometrics/unit-root", "Unit Root Tests"], ["econometrics/heteroskedasticity", "Heteroskedasticity Tests"],
      ["econometrics/quantile-regression", "Quantile Regression"], ["econometrics/sur", "Seemingly Unrelated Regression"],
      ["econometrics/mixed-effects-panel", "Hierarchical Mixed-Effects Panel Model"],
    ],
  },
  {
    category: "options_and_volatility", source: "python-service/options_volatility.py",
    limitation: "Calibration lacks persisted market snapshots, arbitrage-surface checks and an independent benchmark suite.",
    reference: { label: "QuantLib", url: "https://www.quantlib.org/docs.shtml" },
    models: [
      ["options/sabr-calibrate", "SABR Calibration"], ["options/sabr-smile", "SABR Volatility Smile"],
      ["options/heston-calibrate", "Heston Calibration"], ["options/heston-price", "Heston Option Pricing"],
    ],
  },
  {
    category: "forecasting", source: "python-service/forecasting.py",
    limitation: "Rolling out-of-sample comparison, leakage controls and forecast calibration are not yet mandatory.",
    reference: { label: "Diebold-Mariano Forecast Comparison", url: "https://doi.org/10.1080/07350015.1995.10524599" },
    models: [
      ["forecasting/sarimax", "SARIMAX Forecast"], ["forecasting/stl", "STL Decomposition"],
      ["forecasting/changepoint", "Changepoint Detection"], ["forecasting/garch", "GARCH And EGARCH"],
    ],
  },
  {
    category: "economics_and_policy", source: "python-service/economics_policy.py",
    limitation: "Policy engines calculate supplied scenarios but do not yet persist source datasets, uncertainty or behavioral-response assumptions.",
    models: [
      ["economics/leontief-io", "Leontief Input-Output Model"], ["economics/taylor-rule", "Taylor Rule"],
      ["economics/phillips-curve", "Phillips Curve"], ["economics/gini", "Gini And Lorenz Analysis"],
      ["economics/income-tax-microsim", "Income Tax Microsimulation"], ["economics/carbon-tax-dividend", "Carbon Tax And Dividend"],
    ],
  },
  {
    category: "machine_learning", source: "python-service/ml_cluster.py", status: "experimental", validationLevel: "research_only",
    limitation: "Generic train/test splitting is not suitable for time-ordered financial prediction until chronological validation and leakage controls are added.",
    reference: { label: "Scikit-learn Time Series Validation", url: "https://scikit-learn.org/stable/modules/cross_validation.html" },
    models: [
      ["ml/classification", "Machine Learning Classification"], ["ml/regression", "Machine Learning Regression"],
      ["ml/clustering", "Unsupervised Clustering"], ["ml/anomaly-detection", "Anomaly Detection"],
    ],
  },
  {
    category: "supply_chain", source: "python-service/supply_chain.py",
    limitation: "Operational models use user-supplied topology and distributions; calibration and data lineage are not yet persisted.",
    models: [
      ["supplychain/route-optimization", "Route Optimization"], ["supplychain/safety-stock", "Multi-Echelon Safety Stock"],
      ["supplychain/bullwhip", "Bullwhip Effect"], ["supplychain/network-analysis", "Supply Network Analysis"],
      ["supplychain/resilience", "Supply Chain Resilience Index"],
    ],
  },
  {
    category: "environment", source: "python-service/environment.py",
    limitation: "Scenario calculations require verified emissions, permanence and additionality inputs before decision use.",
    models: [["environment/climate-transition-risk", "Climate Transition Risk"], ["environment/carbon-credit-mrv", "Carbon Credit MRV Valuation"]],
  },
  {
    category: "general_optimization", source: "python-service/optimization_engine.py", status: "experimental",
    validationLevel: "research_only", determinism: "seeded_stochastic",
    limitation: "Free-form heuristic optimization is research-only; convexity, global optimality and economic suitability are not guaranteed.",
    reference: { label: "SciPy Optimization", url: "https://docs.scipy.org/doc/scipy/tutorial/optimize.html" },
    models: [
      ["optimization/genetic-algorithm", "Genetic Algorithm"], ["optimization/stochastic", "Stochastic Optimization"],
      ["optimization/multi-objective", "Multi-Objective Optimization"], ["optimization/sensitivity-analysis", "Sobol Sensitivity Analysis"],
    ],
  },
];

function pythonEntries(): QuantModelRegistryEntry[] {
  return PYTHON_GROUPS.flatMap((group) => group.models.map(([path, label]) => ({
    id: `python.${path.replaceAll("/", ".")}`, label, category: group.category,
    program: "quant_acceleration" as const, engine: "python_sidecar" as const,
    status: group.status ?? "implemented", validationLevel: group.validationLevel ?? "benchmark_required",
    determinism: group.determinism ?? "deterministic", dataMode: "user_supplied" as const, version: "1.0.0",
    apiEndpoint: `/api/quant/${path}`, engineEndpoint: `/${path}`, surfaces: ["Quant Workbench"], components: [label],
    sourceFiles: [group.source, "server/quantRoutes.ts"], references: group.reference ? [group.reference] : [],
    limitations: [group.limitation],
    nextValidation: "Add golden inputs, independent expected outputs, boundary cases and persisted run lineage.",
  })));
}

const CLIENT_ENTRIES: QuantModelRegistryEntry[] = [
  {
    id: "typescript.asset-pricing-risk", label: "Asset Pricing And Risk Library", category: "asset_pricing_and_risk",
    program: "quant_acceleration", engine: "typescript", status: "experimental", validationLevel: "benchmark_required",
    determinism: "seeded_stochastic", dataMode: "mixed", version: "1.0.1", apiEndpoint: "/api/quant/risk/manual-original", surfaces: ["Asset Pricing", "Advanced Risk", "Quant Workbench"],
    components: ["olsRegression", "capmExpectedReturn", "jensensAlpha", "treynorRatio", "sortinoRatio", "informationRatio", "calmarRatio", "parametricVaR", "historicalVaR", "expectedShortfall", "cornishFisherVaR", "monteCarloVaR", "counterpartyCVA", "riskDecomposition", "liquidityCostEstimate", "ewmaVolatility", "computeCovarianceMatrix", "pca", "engleGrangerTest", "kalmanDynamicBeta", "rollingVolatility", "rollingBeta", "rollingCorrelation", "brinsonAttribution", "cagr", "maxDrawdownPct", "blackLitterman", "detectHiddenRelationships"],
    sourceFiles: ["client/src/lib/quantModels.ts"], references: [{ label: "Black-Litterman", url: "https://rpc.cfainstitute.org/research/financial-analysts-journal/1992/faj-v48-n5-28" }],
    limitations: ["Broad client library with incomplete direct known-answer coverage. Original Monte Carlo VaR now takes an explicit seed; automatic browser calculations are not retained native runs."],
    nextValidation: "Split by domain and add cross-library golden tests plus explicit original-run custody.",
  },
  {
    id: "typescript.financial-diagnostics", label: "Financial Quality And Distress Diagnostics", category: "financial_statement_analysis",
    program: "financial_modelling", engine: "typescript", status: "experimental", validationLevel: "benchmark_required",
    determinism: "deterministic", dataMode: "mixed", version: "1.0.0", surfaces: ["Valuation"],
    components: ["altmanZScore", "piotroskiFScore", "beneishMScore", "ohlsonOScore", "sloanAccrualRatio", "cashEarningsQuality", "revenueQuality", "earningsPersistenceProxy", "financialDistressComposite", "mertonDistanceToDefault", "detectRedFlags"],
    sourceFiles: ["client/src/lib/quantModels.ts"], references: [{ label: "Penman Financial Statement Analysis", url: "https://business.columbia.edu/faculty/research/financial-statement-analysis-and-security-valuation" }],
    limitations: ["Inputs may be provider-derived or overridden and are not yet frozen into a model receipt."],
    nextValidation: "Add published-case fixtures, accounting reconciliation and point-in-time statement snapshots.",
  },
  {
    id: "typescript.forecasting-term-structure", label: "Client Forecasting And Term-Structure Library", category: "forecasting",
    program: "quant_acceleration", engine: "typescript", status: "experimental", validationLevel: "research_only",
    determinism: "deterministic", dataMode: "user_supplied", version: "1.0.0", surfaces: ["Quant Workbench", "Yield Curve", "Regime Classifier"],
    components: ["fitGaussianHMM", "fitGPD", "evtVaRPct", "evtExpectedShortfallPct", "evtVaR", "evtExpectedShortfall", "studentTCDF", "studentTQuantile", "fitTCopula", "nelderMead", "fitGARCH11", "forecastGARCH11", "fitEGARCH11", "fitNelsonSiegel", "fitSvensson", "fitHoltWinters", "forecastHoltWinters", "fitARIMA", "forecastARIMA", "autoARIMA"],
    sourceFiles: ["client/src/lib/quantModels.ts"], references: [],
    limitations: ["Browser implementations need comparison against Python references and rolling out-of-sample validation."],
    nextValidation: "Benchmark against Python, document tolerances and retire unnecessary duplicate implementations.",
  },
  {
    id: "typescript.valuation-core", label: "DCF, WACC, LBO And Capital Budgeting", category: "valuation",
    program: "financial_modelling", engine: "typescript", status: "implemented", validationLevel: "implementation_reviewed",
    determinism: "deterministic", dataMode: "mixed", version: "1.0.0", surfaces: ["Valuation", "M&A Deal Desk", "FP&A"],
    components: ["computeWacc", "unleverBeta", "leverBeta", "computeNetDebt", "terminalValue", "fcfeFromFcff", "evToEquityBridge", "runLboModel", "applyCarryWaterfall", "computeLiquidationValue", "computeReplacementCost", "syntheticCreditRating", "factorCostOfEquity", "gordonGrowthDDM", "twoStageDDM", "computeNPV", "computeIRR", "computeMIRR", "paybackPeriod", "discountedPaybackPeriod"],
    sourceFiles: ["client/src/lib/valuationModels.ts", "client/src/lib/quantModels.ts", "client/src/components/panels/ValuationPanel.tsx"],
    references: [{ label: "Damodaran Valuation", url: "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valuation/val.htm" }, { label: "McKinsey Valuation", url: "https://books.wiley.com/series/wiley-valuation-7e/" }],
    limitations: ["A unified three-statement forecast, residual-income valuation and immutable calculation lineage remain incomplete."],
    nextValidation: "Add company fixtures and reconcile DCF, APV, residual income, comps and reverse DCF.",
  },
  {
    id: "spreadsheet.financial-model-templates", label: "Advanced Financial Model Templates", category: "financial_modelling",
    program: "financial_modelling", engine: "spreadsheet", status: "validated", validationLevel: "known_answer",
    determinism: "deterministic", dataMode: "user_supplied", version: "1.0.0", surfaces: ["Spreadsheet Studio"],
    components: ["buildApvModel", "buildCreditAnalysisModel", "buildLboDebtPaydownModel", "buildNavModel", "buildProjectFinanceModel", "buildSaasMetricsModel", "buildSotpModel", "buildTransactionCompsModel", "buildEpvModel"],
    sourceFiles: ["client/src/lib/templates/apv.ts", "client/src/lib/templates/creditAnalysis.ts", "client/src/lib/templates/lboDebtPaydown.ts", "client/src/lib/templates/nav.ts", "client/src/lib/templates/projectFinance.ts", "client/src/lib/templates/saasMetrics.ts", "client/src/lib/templates/sotp.ts", "client/src/lib/templates/transactionComps.ts", "client/src/lib/templates/epv.ts"],
    references: [{ label: "Rosenbaum And Pearl Investment Banking", url: "https://www.wiley.com/en-us/shop/general-finance-investments/institutional-corporate-finance-c-FI10" }],
    limitations: ["Templates have focused tests but are not yet connected to point-in-time statements or a receipt ledger."],
    nextValidation: "Connect canonical assumptions, source data, model versions and export reconciliation.",
  },
  {
    id: "typescript.descriptive-resampling", label: "Descriptive And Resampling Statistics", category: "statistics",
    program: "quant_acceleration", engine: "typescript", status: "experimental", validationLevel: "benchmark_required",
    determinism: "seeded_stochastic", dataMode: "user_supplied", version: "1.0.1", apiEndpoint: "/api/quant/statistics/resampling", surfaces: ["Data And Statistics Explorer", "Quant Workbench"],
    components: ["computeDescriptiveStats", "computeHistogram", "computeDailyReturns", "zScoreSeries", "bootstrapMeanCI", "permutationTestMeanDiff", "resamplingRandom"],
    sourceFiles: ["client/src/lib/statistics.ts"], references: [],
    limitations: ["Percentile bootstrap and two-sided Monte Carlo permutation use explicit recorded seeds; finite-simulation error and inference assumptions remain."],
    nextValidation: "Compare interval coverage and permutation p-values independently across population shapes and group sizes.",
  },
  {
    id: "ai.quant-consensus", label: "Quant Consensus Interpretation", category: "ai_interpretation",
    program: "shared_foundation", engine: "ai_interpretation", status: "implemented", validationLevel: "research_only",
    determinism: "provider_dependent", dataMode: "user_supplied", version: "1.0.0", apiEndpoint: "/api/quant/consensus-note",
    surfaces: ["Quant Workbench"], components: ["getConsensusNote"],
    sourceFiles: ["server/quantConsensusService.ts", "server/quantRoutes.ts"], references: [],
    limitations: ["AI may interpret supplied outputs but must never replace deterministic calculations or create unsupported facts."],
    nextValidation: "Persist prompt, provider, policy and output lineage through the future model router.",
  },
  {
    id: "ai.assumption-challenge", label: "Assumption Challenge", category: "ai_interpretation",
    program: "shared_foundation", engine: "ai_interpretation", status: "implemented", validationLevel: "research_only",
    determinism: "provider_dependent", dataMode: "user_supplied", version: "1.0.0", apiEndpoint: "/api/quant/challenge-assumption",
    surfaces: ["Quant Workbench"], components: ["getAssumptionChallenge"],
    sourceFiles: ["server/challengeAssumptionService.ts", "server/quantRoutes.ts"], references: [],
    limitations: ["Generated critique is advisory and may omit material assumptions; deterministic model outputs remain authoritative."],
    nextValidation: "Add prompt-policy fixtures, provider lineage, groundedness review and failure-mode evaluation.",
  },
  {
    id: "data.damodaran-industries", label: "Damodaran Industry Benchmarks", category: "valuation_reference_data",
    program: "financial_modelling", engine: "data_service", status: "implemented", validationLevel: "implementation_reviewed",
    determinism: "provider_dependent", dataMode: "live_provider", version: "1.0.0", apiEndpoint: "/api/quant/damodaran/industries",
    surfaces: ["Valuation"], components: ["getDamodaranIndustryBenchmarks"],
    sourceFiles: ["server/damodaranData.ts", "server/quantRoutes.ts"],
    references: [{ label: "Damodaran Data", url: "https://pages.stern.nyu.edu/~adamodar/" }],
    limitations: ["Industry aggregates are reference inputs and may differ from company-specific capital structure, geography and timing."],
    nextValidation: "Persist source date and checksum, test parser drift, and surface stale-data warnings in valuation receipts.",
  },
  {
    id: "data.damodaran-industry", label: "Damodaran Industry Benchmark Lookup", category: "valuation_reference_data",
    program: "financial_modelling", engine: "data_service", status: "implemented", validationLevel: "implementation_reviewed",
    determinism: "provider_dependent", dataMode: "live_provider", version: "1.0.0", apiEndpoint: "/api/quant/damodaran/industries/:industry",
    surfaces: ["Valuation"], components: ["getDamodaranIndustryBenchmark"],
    sourceFiles: ["server/damodaranData.ts", "server/quantRoutes.ts"],
    references: [{ label: "Damodaran Data", url: "https://pages.stern.nyu.edu/~adamodar/" }],
    limitations: ["Name matching selects a reference industry and does not establish that the selected peer group is economically appropriate."],
    nextValidation: "Add canonical industry identifiers, aliases, effective dates and an explicit user-selection receipt.",
  },
  {
    id: "data.point-in-time-financials", label: "Point-In-Time Financial Statement Snapshots", category: "financial_data_fabric",
    program: "shared_foundation", engine: "data_service", status: "implemented", validationLevel: "regression_tested",
    determinism: "provider_dependent", dataMode: "point_in_time", version: "1.0.0", apiEndpoint: "/api/data-snapshots/financials/:symbol",
    surfaces: ["Integrated Model Studio"], components: ["buildFinancialDatasetPayload", "captureFinancialDatasetSnapshot", "getFinancialDatasetAsOf"],
    sourceFiles: ["server/pointInTimeDatasetStore.ts", "server/dataFabricRoutes.ts", "shared/pointInTimeData.ts"], references: [],
    limitations: ["Annual financial statements are frozen with revision diagnostics; fiscal-period constituent estimates, options, commodities, portfolios and private series remain later A2 coverage."],
    nextValidation: "Add restatement fixtures, provider disagreement policies, entitlement metadata and point-in-time coverage for every canonical data class.",
  },
  {
    id: "data.point-in-time-market-series", label: "Point-In-Time Market Series And Corporate Actions", category: "financial_data_fabric",
    program: "shared_foundation", engine: "data_service", status: "implemented", validationLevel: "regression_tested",
    determinism: "provider_dependent", dataMode: "point_in_time", version: "1.0.0", apiEndpoint: "/api/data-snapshots/markets/:symbol",
    surfaces: ["Point-In-Time Market Data"], components: ["buildMarketDatasetPayload", "captureMarketDatasetSnapshot", "getMarketDatasetAsOf", "compareMarketDatasetPayloads"],
    sourceFiles: ["server/marketDatasetStore.ts", "server/dataFabricRoutes.ts", "shared/pointInTimeData.ts", "client/src/components/panels/MarketDataFabricPanel.tsx"], references: [],
    limitations: ["The current history waterfall does not guarantee one adjustment convention across every fallback provider, so captures preserve price-basis uncertainty and withhold total returns where dividend double-counting cannot be ruled out. Exchange-holiday classification remains pending."],
    nextValidation: "Add provider-specific raw/adjusted close contracts, exchange calendars, currency conversion, reviewed source-rights policies and golden cross-vendor action-adjustment cases.",
  },
  {
    id: "data.point-in-time-consensus", label: "Point-In-Time Estimates And Consensus History", category: "financial_data_fabric",
    program: "shared_foundation", engine: "data_service", status: "implemented", validationLevel: "regression_tested",
    determinism: "provider_dependent", dataMode: "point_in_time", version: "1.0.0", apiEndpoint: "/api/consensus/capture/:symbol",
    surfaces: ["Consensus And Variant Perception"], components: ["captureProviderConsensus", "buildRevisionSeries", "compareConsensusBenchmarks"],
    sourceFiles: ["server/consensusProviderCapture.ts", "server/consensusService.ts", "server/consensusRoutes.ts", "client/src/components/panels/ConsensusIntelligencePanel.tsx"], references: [],
    limitations: ["Consensus capture accepts attributed provider or user-supplied aggregates/observations. Constituent estimates and provider publication timestamps are preserved only when supplied and are never inferred."],
    nextValidation: "Add contributor-level licensed feeds, fiscal-period estimate waterfalls, surprise vintages, provider disagreement policies and publication-time contracts.",
  },
  {
    id: "data.point-in-time-macro-rates-fx", label: "Point-In-Time Macro, Rates, Curves And FX", category: "financial_data_fabric",
    program: "shared_foundation", engine: "data_service", status: "implemented", validationLevel: "regression_tested",
    determinism: "provider_dependent", dataMode: "point_in_time", version: "1.0.0", apiEndpoint: "/api/data-snapshots/economics/:seriesId",
    surfaces: ["Macro And Rates Data Fabric", "Point-In-Time Market Data"], components: ["buildScalarSeriesPayload", "buildYieldCurvePayload", "captureFredSeriesSnapshot", "captureFredYieldCurveSnapshot", "compareEconomicDatasetPayloads", "compareYieldCurvePayloads"],
    sourceFiles: ["server/economicDatasetStore.ts", "server/dataFabricRoutes.ts", "server/fredData.ts", "server/marketDatasetStore.ts", "client/src/components/panels/EconomicDataFabricPanel.tsx"],
    references: [{ label: "FRED API", url: "https://fred.stlouisfed.org/docs/api/fred/" }],
    limitations: ["FRED realtime dates are date-granular rather than timestamp-granular. The current FX path freezes daily Yahoo-style symbols and does not yet normalize institutional spot, forward, or fixing conventions."],
    nextValidation: "Add release-calendar timestamps, cross-provider macro revisions, institutional FX spot/forward/fixing contracts, holiday calendars, reviewed source-rights policies and golden vintage fixtures.",
  },
  {
    id: "data.point-in-time-universes-columnar", label: "Point-In-Time Universes, Entitlements And Columnar Scans", category: "financial_data_fabric",
    program: "shared_foundation", engine: "data_service", status: "implemented", validationLevel: "regression_tested",
    determinism: "deterministic", dataMode: "point_in_time", version: "1.0.0", apiEndpoint: "/api/data-universes",
    surfaces: ["Universe And Columnar Data Fabric"], components: ["normalizeUniversePayload", "membersEffectiveAsOf", "captureUniverseSnapshot", "compareUniversePayloads", "createEntitlementPolicy", "flattenSnapshotForColumnar", "writeParquetRecords", "scanColumnarArtifact"],
    sourceFiles: ["server/universeDatasetStore.ts", "server/dataEntitlementStore.ts", "server/columnarArtifactStore.ts", "server/dataFabricRoutes.ts", "shared/pointInTimeUniverse.ts", "client/src/components/panels/UniverseDataFabricPanel.tsx"],
    references: [{ label: "DuckDB Node.js Client", url: "https://duckdb.org/docs/stable/clients/node_neo/overview" }, { label: "DuckDB Parquet", url: "https://duckdb.org/docs/stable/data/parquet/overview" }],
    limitations: ["Historical membership is available only when an attributed import or canonical listing provides effective intervals; current lists are never treated as reconstructed history. Automatically created rights policies are internal-only and pending formal review."],
    nextValidation: "Add licensed index constituent feeds with announcement/effective timestamps, explicit corporate-action exit taxonomy, reviewed redistribution decisions, and million-row cross-asset Parquet benchmarks.",
  },
  {
    id: "data.point-in-time-cross-asset", label: "Point-In-Time Estimates, Options, Commodities, Portfolios And Private Series", category: "financial_data_fabric",
    program: "shared_foundation", engine: "data_service", status: "implemented", validationLevel: "regression_tested",
    determinism: "provider_dependent", dataMode: "point_in_time", version: "1.0.0", apiEndpoint: "/api/alternative-data/:dataClass",
    surfaces: ["Cross-Asset Point-In-Time Fabric"], components: ["captureAlternativeDataset", "captureFmpEstimates", "captureLseOptionsChain", "capturePortfolioSnapshot", "calculateEstimateSurprises"],
    sourceFiles: ["server/alternativeDatasetStore.ts", "server/fmpData.ts", "server/dataFabricRoutes.ts", "shared/pointInTimeAlternativeData.ts", "client/src/components/panels/CrossAssetDataFabricPanel.tsx"],
    references: [{ label: "FMP Financial Estimates API", url: "https://site.financialmodelingprep.com/developer/docs" }],
    limitations: ["FMP automatic estimates are provider aggregates, not constituent-level records, and have no source publication timestamp; they are available to models only at retrieval. Commodity term structures and private series require attributed imports when no entitled connector exists."],
    nextValidation: "Add a licensed constituent-estimate feed with publication timestamps, institutional option quotes with bid/ask and open interest, and realistic million-row private-series benchmarks.",
  },
  {
    id: "typescript.integrated-three-statement", label: "Integrated Three-Statement Forecast", category: "financial_modelling",
    program: "financial_modelling", engine: "typescript", status: "implemented", validationLevel: "regression_tested",
    determinism: "deterministic", dataMode: "point_in_time", version: "3.0.0", apiEndpoint: "/api/financial-models/integrated",
    surfaces: ["Integrated Model Studio"], components: ["deriveIntegratedModelAssumptions", "deriveSpecializedModelSchedules", "solveCircularDebtInterest", "runIntegratedFinancialModel"],
    sourceFiles: ["shared/integratedFinancialModel.ts", "server/dataFabricRoutes.ts", "client/src/components/panels/IntegratedModelStudioPanel.tsx"],
    references: [{ label: "Financial Modeling, Benninga", url: "https://mitpress.mit.edu/9780262027281/financial-modeling/" }],
    limitations: ["Specialized schedules use only disclosed or analyst-supplied inputs; missing pension, associate, minority, segment, or transaction data remains explicit and is never inferred. Complex multi-step purchase accounting remains a later M&A phase."],
    nextValidation: "Add public-company filed-statement reconciliations, deferred-tax effects for pension and purchase accounting, scenario matrices and spreadsheet export parity.",
  },
  {
    id: "runtime.quant-lab", label: "Quant Lab And Asynchronous Compute Runtime", category: "compute_runtime",
    program: "shared_foundation", engine: "data_service", status: "implemented", validationLevel: "regression_tested",
    determinism: "deterministic", dataMode: "mixed", version: "1.0.0", apiEndpoint: "/api/quant-lab/runtime",
    surfaces: ["Quant Lab"], components: ["createQuantExperiment", "enqueueQuantRun", "cancelQuantRun", "rerunQuantRun", "compareQuantRuns", "quantRunEnvelope"],
    sourceFiles: ["server/quantLabRuntime.ts", "server/quantLabRoutes.ts", "shared/quantLab.ts", "client/src/components/panels/QuantLabPanel.tsx"],
    references: [{ label: "NIST Reproducibility Terminology", url: "https://www.nist.gov/publications/terminology-reproducible-science-defining-terminology-increasingly-important" }],
    limitations: ["The first runtime adapter executes registered Python-sidecar models; TypeScript, spreadsheet, and external distributed-worker adapters require explicit contracts before they can join the queue. Progress is lifecycle-granular for engines that do not stream intermediate progress. Cancellation and timeout stop result persistence immediately, but the loopback sidecar may finish already-running native computation until per-job process isolation is added."],
    nextValidation: "Add durable distributed workers, engine-native progress callbacks, container image digests, per-organization compute pools, and load tests beyond the local concurrency ceiling.",
  },
  {
    id: "data.sec-filing-search", label: "SEC Filing Semantic Search", category: "research_data",
    program: "shared_foundation", engine: "data_service", status: "implemented", validationLevel: "implementation_reviewed",
    determinism: "deterministic", dataMode: "live_provider", version: "1.0.0", engineEndpoint: "/sec/filing-search",
    surfaces: ["Filing Intelligence", "Research Intelligence"], components: ["search_filings"],
    sourceFiles: ["python-service/sec_search.py", "python-service/main.py"], references: [],
    limitations: ["Research retrieval depends on available filing text and indexing quality."],
    nextValidation: "Maintain provider-contract tests and citation-level relevance evaluation.",
  },
];

export const KNOWN_STOCHASTIC_OR_SYNTHETIC_SOURCES: Record<string, string> = {
  "client/src/components/panels/CryptoChainPanel.tsx": "Synthetic transaction graph generator.",
  "client/src/components/panels/DeveloperConsolePanel.tsx": "Non-financial UI identifier only.",
  "client/src/components/panels/HawkesProcessPanel.tsx": "Stochastic research simulation.",
  "client/src/components/panels/IsingPanel.tsx": "Stochastic research simulation.",
  "client/src/components/panels/MonteCarloPanel.tsx": "Monte Carlo simulation; seed control is pending.",
  "client/src/components/panels/PortfolioOptimizerPanel.tsx": "Synthetic scenario generator.",
  "client/src/components/panels/QuotePanel.tsx": "Visual microstructure animation only.",
  "client/src/components/panels/RiskNetworkPanel.tsx": "Synthetic network simulation.",
  "client/src/components/ui/sidebar.tsx": "Non-financial UI state identifier only.",
  "client/src/lib/terminalTabs.ts": "Non-financial UI tab identifier only.",
  "client/src/lib/quantModels.ts": "Monte Carlo analytics with unseeded experimental paths.",
  "client/src/lib/statistics.ts": "Bootstrap and permutation sampling with unseeded experimental paths.",
  "client/src/components/terminal/TerminalMacroManager.tsx": "User-defined command macro orchestration; not a stochastic calculation source.",
  "client/src/lib/terminalChangeIntelligence.ts": "Analytical snapshot comparison; no stochastic calculation.",
  "client/src/lib/terminalCommandComposer.ts": "User-defined workflow composition; no stochastic calculation.",
  "client/src/lib/terminalDecisionReplay.ts": "Decision replay state; no stochastic calculation.",
  "client/src/lib/terminalResearchPackages.ts": "Research package state; no stochastic calculation.",
  "client/src/lib/terminalResearchThread.ts": "Research thread state; no stochastic calculation.",
  "client/src/lib/terminalResearchTray.ts": "Research tray state; no stochastic calculation.",
  "client/src/lib/terminalSessionMemory.ts": "Session memory state; no stochastic calculation.",
  "client/src/lib/terminalThesisMap.ts": "Thesis map state; no stochastic calculation.",
  "client/src/lib/terminalUiActionPreview.ts": "UI action preview state; no stochastic calculation.",
  "client/src/lib/terminalDecisionCheckpoints.ts": "Decision checkpoint state; no stochastic calculation.",
  "client/src/lib/terminalDecisionObjects.ts": "Decision object state; no stochastic calculation.",
  "client/src/lib/terminalIntelligenceObjects.ts": "Intelligence object state; no stochastic calculation.",
  "client/src/lib/terminalScenarioUniverse.ts": "Scenario workspace state; no stochastic calculation.",
  "client/src/lib/terminalSignalWaterfall.ts": "Signal presentation state; no stochastic calculation.",
  "client/src/lib/manualFinanceData.ts": "User-entered finance data and formula state; no stochastic calculation.",
  "client/src/lib/livingWorkspaceActions.ts": "Workspace action identifiers and lifecycle state; no stochastic financial calculation.",
};

export const QUANT_ANALYTICAL_SURFACES: Record<string, string> = {
  "Advanced Risk": "client/src/components/panels/AdvancedRiskPanel.tsx",
  "Asset Pricing": "client/src/components/panels/AssetPricingPanel.tsx",
  "Backtesting": "client/src/components/panels/BacktestPanel.tsx",
  "Correlation": "client/src/components/panels/CorrelationPanel.tsx",
  "Consensus And Variant Perception": "client/src/components/panels/ConsensusIntelligencePanel.tsx",
  "Data And Statistics Explorer": "client/src/components/panels/DataStatsExplorerPanel.tsx",
  "Decision Engine": "client/src/components/panels/DecisionEnginePanel.tsx",
  "Economics And Policy Quant": "client/src/components/panels/EconomicsPolicyQuantPanel.tsx",
  "Environment Quant": "client/src/components/panels/EnvironmentQuantPanel.tsx",
  "Financial Statements": "client/src/components/panels/FinancialStatementsPanel.tsx",
  "Integrated Model Studio": "client/src/components/panels/IntegratedModelStudioPanel.tsx",
  "Macro And Rates Data Fabric": "client/src/components/panels/EconomicDataFabricPanel.tsx",
  "Universe And Columnar Data Fabric": "client/src/components/panels/UniverseDataFabricPanel.tsx",
  "Cross-Asset Point-In-Time Fabric": "client/src/components/panels/CrossAssetDataFabricPanel.tsx",
  "Point-In-Time Market Data": "client/src/components/panels/MarketDataFabricPanel.tsx",
  "Fixed Income": "client/src/components/panels/FixedIncomePanel.tsx",
  "FP&A": "client/src/components/panels/FpaDashboardPanel.tsx",
  "M&A Deal Desk": "client/src/components/panels/MnaDealDeskPanel.tsx",
  "Monte Carlo": "client/src/components/panels/MonteCarloPanel.tsx",
  "Portfolio Attribution": "client/src/components/panels/PortfolioAttributionPanel.tsx",
  "Portfolio Optimizer": "client/src/components/panels/PortfolioOptimizerPanel.tsx",
  "Portfolio Stress": "client/src/components/panels/PortfolioStressPanel.tsx",
  "Quant Desk": "client/src/components/panels/QuantDeskPanel.tsx",
  "Quant Model Registry": "client/src/components/panels/QuantModelRegistryPanel.tsx",
  "Quant Lab": "client/src/components/panels/QuantLabPanel.tsx",
  "Quant Workbench": "client/src/components/panels/QuantWorkbenchPanel.tsx",
  "Regime Classifier": "client/src/components/panels/RegimeClassifierPanel.tsx",
  "Risk Network": "client/src/components/panels/RiskNetworkPanel.tsx",
  "Risk Return Scatter": "client/src/components/panels/RiskReturnScatterPanel.tsx",
  "Spreadsheet Studio": "client/src/components/panels/SpreadsheetStudioPanel.tsx",
  "Supply Chain Quant": "client/src/components/panels/SupplyChainQuantPanel.tsx",
  "Valuation": "client/src/components/panels/ValuationPanel.tsx",
  "Yield Curve": "client/src/components/panels/YieldCurvePanel.tsx",
};

export const QUANT_DATA_PROVIDER_SOURCES: Record<string, string[]> = {
  BLS: ["server/blsData.ts", "server/blsRoutes.ts"],
  CFTC: ["server/cftcData.ts", "server/cftcRoutes.ts"],
  CoinGecko: ["server/marketData.ts", "server/data/crypto_coingecko_ids.json"],
  Damodaran: ["server/damodaranData.ts"],
  FamaFrench: ["server/famaFrenchData.ts", "server/famaFrenchRoutes.ts"],
  Finnhub: ["server/finnhubFinancials.ts"],
  FMP: ["server/marketData.ts", "server/providerStatus.ts"],
  FRED: ["server/fredData.ts"],
  LSE: ["server/lseData.ts", "server/lseRoutes.ts"],
  BSE: ["server/bseIndiaQuote.ts", "server/bseBhavcopy.ts"],
  OWID: ["server/owidData.ts", "server/owidRoutes.ts"],
  SEC: ["server/secEdgarData.ts", "server/secEdgarFinancials.ts", "server/secEdgarRoutes.ts"],
  SimFin: ["server/simfinFinancials.ts"],
  Stooq: ["server/marketData.ts"],
  WorldBank: ["server/worldBankData.ts", "server/worldBankRoutes.ts"],
  YahooFinance: ["server/marketData.ts"],
};

export const QUANT_MODEL_REGISTRY: QuantModelRegistryEntry[] = [...pythonEntries(), ...CLIENT_ENTRIES];
export const QUANT_COMPUTE_ENDPOINTS = QUANT_MODEL_REGISTRY
  .filter((entry) => entry.engine === "python_sidecar")
  .flatMap((entry) => entry.apiEndpoint ? [entry.apiEndpoint] : []);

export function summarizeQuantRegistry(entries: QuantModelRegistryEntry[] = QUANT_MODEL_REGISTRY) {
  const countBy = (key: "status" | "validationLevel" | "category" | "program") => entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry[key]] = (acc[entry[key]] ?? 0) + 1;
    return acc;
  }, {});
  return {
    total: entries.length, byStatus: countBy("status"), byValidation: countBy("validationLevel"),
    byCategory: countBy("category"), byProgram: countBy("program"),
    limitationsOpen: entries.filter((entry) => entry.limitations.length > 0).length,
  };
}
