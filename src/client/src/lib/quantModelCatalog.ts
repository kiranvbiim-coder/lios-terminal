export type QuantModelKey =
  | "pca"
  | "hidden"
  | "pairs"
  | "beta"
  | "rolling"
  | "copula"
  | "forecast"
  | "forecastupgrade"
  | "advancedforecast"
  | "bond"
  | "portfolio"
  | "creditrisk"
  | "oprisk"
  | "stats"
  | "panelcausal"
  | "tsecon"
  | "optionsvol"
  | "mlcluster";

export type QuantModelFamilyKey =
  | "factor-structure"
  | "relative-value"
  | "dynamic-exposure"
  | "dependence-tails"
  | "forecasting"
  | "fixed-income"
  | "portfolio"
  | "credit-counterparty"
  | "operational-liquidity"
  | "statistics"
  | "causal-panel"
  | "time-series-econometrics"
  | "options-volatility"
  | "machine-learning";

export interface QuantModelDefinition {
  key: QuantModelKey;
  family: QuantModelFamilyKey;
  label: string;
  shortLabel: string;
  commandAliases: readonly string[];
  inputHint: string;
  diagnosticHint: string;
}

export interface QuantModelFamilyDefinition {
  key: QuantModelFamilyKey;
  label: string;
  question: string;
  modelKeys: readonly QuantModelKey[];
}

export const QUANT_MODELS: readonly QuantModelDefinition[] = [
  { key: "pca", family: "factor-structure", label: "PCA / Factor Decomposition", shortLabel: "PCA", commandAliases: ["PCA"], inputHint: "Ticker basket or aligned return matrix", diagnosticHint: "Variance explained and factor loadings" },
  { key: "hidden", family: "factor-structure", label: "Hidden Relationships", shortLabel: "Hidden relationships", commandAliases: ["HIDDEN", "RELATIONSHIPS"], inputHint: "3+ aligned securities", diagnosticHint: "Factor-adjusted residual relationships" },
  { key: "pairs", family: "relative-value", label: "Pairs Trading Screener", shortLabel: "Pairs / Engle-Granger", commandAliases: ["PAIR", "PAIRS", "ENGLEGRANGER"], inputHint: "Security pair or candidate basket", diagnosticHint: "Cointegration, spread stability, half-life" },
  { key: "beta", family: "dynamic-exposure", label: "Dynamic Beta (Kalman)", shortLabel: "Kalman beta", commandAliases: ["KALMAN", "DYNAMICBETA"], inputHint: "Asset and benchmark returns", diagnosticHint: "State path and adaptation stability" },
  { key: "rolling", family: "dynamic-exposure", label: "Rolling Statistics", shortLabel: "Rolling exposure", commandAliases: ["ROLLING", "ROLLBETA", "ROLLCORR"], inputHint: "Aligned return series and window", diagnosticHint: "Rolling beta, correlation and volatility" },
  { key: "copula", family: "dependence-tails", label: "Tail Dependence (t-Copula)", shortLabel: "t-Copula", commandAliases: ["COPULA", "TAIL"], inputHint: "Aligned return series", diagnosticHint: "Tail dependence and fitted dependence parameters" },
  { key: "forecast", family: "forecasting", label: "ARIMA / Holt-Winters", shortLabel: "ARIMA / Holt-Winters", commandAliases: ["ARIMA", "HOLT", "HOLTWINTERS"], inputHint: "Historical time series", diagnosticHint: "Forecast path and residual/specification diagnostics" },
  { key: "forecastupgrade", family: "forecasting", label: "SARIMAX / STL / Changepoint / GARCH", shortLabel: "Forecast diagnostics", commandAliases: ["SARIMAX", "STL", "CHANGEPOINT", "GARCH"], inputHint: "FRED series or ticker history", diagnosticHint: "Seasonality, regimes and volatility fit" },
  { key: "advancedforecast", family: "forecasting", label: "Advanced Forecasting / Dataset Methods", shortLabel: "Advanced forecast", commandAliases: ["FORECASTLAB", "NOWCAST"], inputHint: "Analyst-reviewed imported series", diagnosticHint: "Validation window, probabilistic and regime diagnostics" },
  { key: "bond", family: "fixed-income", label: "Fixed Income (QuantLib)", shortLabel: "Bond analytics", commandAliases: ["BOND", "DV01", "DURATION"], inputHint: "Coupon, yield, maturity and convention inputs", diagnosticHint: "Clean/dirty price, duration, convexity and DV01" },
  { key: "portfolio", family: "portfolio", label: "Portfolio Optimizer", shortLabel: "Portfolio optimizer", commandAliases: ["OPTIMIZE", "PORTOPT", "PORTFOLIOOPT"], inputHint: "Assets, returns and allocation constraints", diagnosticHint: "Covariance, weights and risk decomposition" },
  { key: "creditrisk", family: "credit-counterparty", label: "Credit & Counterparty Risk", shortLabel: "Credit / CVA", commandAliases: ["CVA", "CREDITRISK", "COUNTERPARTY"], inputHint: "Exposure, default and recovery assumptions", diagnosticHint: "Expected loss and valuation adjustment" },
  { key: "oprisk", family: "operational-liquidity", label: "Operational Risk & Liquidity", shortLabel: "Op risk / liquidity", commandAliases: ["OPRISK", "LIQUIDITY"], inputHint: "Position and liquidity/operational assumptions", diagnosticHint: "Liquidity cost and operational loss measures" },
  { key: "stats", family: "statistics", label: "Statistics Suite", shortLabel: "Statistics", commandAliases: ["STATS", "BOOTSTRAP", "PERMUTATION", "OLS"], inputHint: "Observed or imported sample", diagnosticHint: "Sampling uncertainty, effect size and specification" },
  { key: "panelcausal", family: "causal-panel", label: "Panel & Causal Inference", shortLabel: "Panel / causal", commandAliases: ["PANEL", "CAUSAL"], inputHint: "Panel, treatment and identification inputs", diagnosticHint: "Identification assumptions and robustness" },
  { key: "tsecon", family: "time-series-econometrics", label: "Time Series Econometrics", shortLabel: "Time-series econometrics", commandAliases: ["TSECON", "ADF", "STATIONARITY"], inputHint: "Historical time series", diagnosticHint: "Stationarity and econometric assumption checks" },
  { key: "optionsvol", family: "options-volatility", label: "Options Volatility (SABR / Heston)", shortLabel: "SABR / Heston", commandAliases: ["SABR", "HESTON", "VOLMODEL"], inputHint: "Observed option surface or explicit parameters", diagnosticHint: "Calibration fit, smile/skew and arbitrage diagnostics" },
  { key: "mlcluster", family: "machine-learning", label: "Machine Learning (sklearn)", shortLabel: "ML / clustering", commandAliases: ["CLUSTER", "ML", "ANOMALY"], inputHint: "Explicit feature matrix or market-derived features", diagnosticHint: "Held-out performance, clusters or anomaly scores" },
] as const;

export const QUANT_MODEL_FAMILIES: readonly QuantModelFamilyDefinition[] = [
  { key: "factor-structure", label: "FACTOR STRUCTURE", question: "What common structure is driving the basket, and what relationships remain after removing it?", modelKeys: ["pca", "hidden"] },
  { key: "relative-value", label: "RELATIVE VALUE", question: "Is a spread statistically stationary enough to support a relative-value hypothesis?", modelKeys: ["pairs"] },
  { key: "dynamic-exposure", label: "DYNAMIC EXPOSURE", question: "Are exposures stable, or are they changing through time?", modelKeys: ["beta", "rolling"] },
  { key: "dependence-tails", label: "DEPENDENCE / TAILS", question: "What happens to dependence when markets move into the tails?", modelKeys: ["copula"] },
  { key: "forecasting", label: "FORECASTING", question: "What part of the series is trend, seasonality or volatility, and what forecast uncertainty follows?", modelKeys: ["forecast", "forecastupgrade", "advancedforecast"] },
  { key: "fixed-income", label: "FIXED INCOME", question: "What are price and rate sensitivities under explicit instrument conventions?", modelKeys: ["bond"] },
  { key: "portfolio", label: "PORTFOLIO", question: "How should assets be combined under return, risk and diversification constraints?", modelKeys: ["portfolio"] },
  { key: "credit-counterparty", label: "CREDIT / COUNTERPARTY", question: "How does default or counterparty exposure translate into expected loss or valuation adjustment?", modelKeys: ["creditrisk"] },
  { key: "operational-liquidity", label: "OPERATIONAL / LIQUIDITY", question: "How much risk comes from inability to trade or operational loss rather than market direction?", modelKeys: ["oprisk"] },
  { key: "statistics", label: "STATISTICS", question: "Is the observed result distinguishable from sampling noise under the stated assumptions?", modelKeys: ["stats"] },
  { key: "causal-panel", label: "CAUSAL / PANEL", question: "What can be learned after controlling for cross-sectional/time structure, and what assumptions are required for causal interpretation?", modelKeys: ["panelcausal"] },
  { key: "time-series-econometrics", label: "TIME-SERIES ECONOMETRICS", question: "Which time-series assumptions hold before a model is trusted?", modelKeys: ["tsecon"] },
  { key: "options-volatility", label: "OPTIONS VOLATILITY", question: "How does implied volatility vary across strikes and maturities beyond a flat-volatility assumption?", modelKeys: ["optionsvol"] },
  { key: "machine-learning", label: "MACHINE LEARNING", question: "Can the supplied features reveal stable structure without pretending the output is causal?", modelKeys: ["mlcluster"] },
] as const;

const MODEL_BY_KEY = new Map(QUANT_MODELS.map((model) => [model.key, model]));
const MODEL_BY_ALIAS = new Map<string, QuantModelDefinition>();
for (const model of QUANT_MODELS) {
  for (const alias of model.commandAliases) MODEL_BY_ALIAS.set(alias.toUpperCase(), model);
}

export function getQuantModel(key: QuantModelKey): QuantModelDefinition {
  const model = MODEL_BY_KEY.get(key);
  if (!model) throw new Error(`Unknown quant model: ${key}`);
  return model;
}

export function modelsForQuantFamily(family: QuantModelFamilyKey): QuantModelDefinition[] {
  const definition = QUANT_MODEL_FAMILIES.find((item) => item.key === family);
  return (definition?.modelKeys ?? []).map(getQuantModel);
}

export interface QuantModelCommandMatch {
  model: QuantModelDefinition;
  alias: string;
  arguments: string[];
}

/** Parse terminal-native model commands without executing or fabricating inputs. */
export function matchQuantModelCommand(input: string): QuantModelCommandMatch | null {
  const tokens = input.trim().replace(/^\/+/, "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const alias = tokens[0].toUpperCase().replace(/[^A-Z0-9]/g, "");
  const model = MODEL_BY_ALIAS.get(alias);
  if (!model) return null;
  return { model, alias, arguments: tokens.slice(1) };
}
