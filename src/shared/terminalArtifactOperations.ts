import { z } from "zod";
import { encodeTerminalPanelValue, terminalScreenStateSchema, writeTerminalPanelState, type TerminalScreenState } from "./terminalArtifact";
import { TERMINAL_STRESS_SCENARIOS } from "./terminalStressScenarios";

const symbol = z.string().trim().toUpperCase().regex(/^[A-Z0-9^][A-Z0-9.^=:/_-]{0,39}$/);
const numericFilter = z.string().trim().max(32).refine(value => value === "" || /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(Number(value)), "A finite numeric filter is required.");
const indicatorParameters = z.record(z.number().finite()).superRefine((parameters, ctx) => {
  for (const [key, value] of Object.entries(parameters)) {
    const valid = /^(?:SMA20|SMA50|EMA12|EMA26|BB|DONCHIAN)\.period$/.test(key) ? Number.isInteger(value) && value >= 2 && value <= 300
      : /^(?:RSI|ADX)\.period$/.test(key) || /^MACD\.(?:fast|signal)$/.test(key) ? Number.isInteger(value) && value >= 2 && value <= 100
      : key === "MACD.slow" ? Number.isInteger(value) && value >= 3 && value <= 300
      : key === "BB.deviations" && value >= 0.5 && value <= 5 && Number.isInteger(value * 2);
    if (!valid) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Unknown indicator parameter or value outside its supported range." });
  }
});
const chartSettings = z.object({
  range: z.enum(["1D", "5D", "1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y"]).optional(),
  interval: z.enum(["5m", "15m", "1h", "1d", "1wk", "1mo"]).optional(),
  chartType: z.enum(["LINE", "CANDLE", "AREA"]).optional(),
  overlays: z.array(z.enum(["SMA20", "SMA50", "EMA12", "EMA26", "BB", "DONCHIAN", "SR"])).max(7).optional(),
  oscillator: z.enum(["none", "RSI", "MACD", "ADX"]).optional(),
  compareSymbols: z.array(symbol).max(3).optional(), indicatorParams: indicatorParameters.optional(),
  chartLayout: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
}).strict().refine(value => Object.keys(value).length > 0, "Choose at least one chart setting.");
const screenerSettings = z.object({
  mode: z.enum(["equity", "directory", "bond", "macro", "radar"]).optional(),
  sector: z.string().trim().min(1).max(100).regex(/^[\w &/-]+$/).optional(),
  sortField: z.enum(["symbol", "price", "changePercent", "marketCap", "pe", "volume", "eps", "high52"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  minPe: numericFilter.optional(), maxPe: numericFilter.optional(), minBeta: numericFilter.optional(), maxBeta: numericFilter.optional(),
  minDivYield: numericFilter.optional(), minRoe: numericFilter.optional(), minRevGrowth: numericFilter.optional(),
  dynamicFieldId: z.enum(["market_data.price", "market_data.marketCap", "market_data.volume", "market_data.peRatio", "financial_statements.eps", "metric.pe", "metric.epsBasic", "metric.epsDiluted"]).optional(),
  dynamicOperator: z.enum(["gt", "gte", "lt", "lte", "eq", "neq"]).optional(), dynamicValue: numericFilter.optional(),
}).strict().refine(value => Object.keys(value).length > 0, "Choose at least one screener setting.");
const panelSelection = z.discriminatedUnion("target", [
  z.object({ target: z.literal("PortfolioPanel.section"), value: z.enum(["overview", "holdings", "optimizer", "attribution", "risk", "stress", "network", "methodology"]) }).strict(),
  z.object({ target: z.literal("QuantWorkbenchPanel.section"), value: z.enum(["overview", "lab", "methodology"]) }).strict(),
  z.object({ target: z.literal("QuantWorkbenchPanel.selectedFamily"), value: z.enum(["factor-structure", "relative-value", "dynamic-exposure", "dependence-tails", "forecasting", "fixed-income", "portfolio", "credit-counterparty", "operational-liquidity", "statistics", "causal-panel", "time-series-econometrics", "options-volatility", "machine-learning"]) }).strict(),
  z.object({ target: z.literal("QuantWorkbenchLegacyPanel.tab"), value: z.enum(["pca", "hidden", "pairs", "beta", "rolling", "copula", "forecast", "forecastupgrade", "advancedforecast", "bond", "portfolio", "creditrisk", "oprisk", "stats", "panelcausal", "tsecon", "optionsvol", "mlcluster"]) }).strict(),
]);
export const terminalArtifactOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chart.settings"), settings: chartSettings }).strict(),
  z.object({ type: z.literal("screener.settings"), settings: screenerSettings }).strict(),
  z.object({ type: z.literal("valuation.assumptions"), values: z.object({
    terminalGrowthPct: z.number().finite().min(-10).max(20).optional(),
    exitMultiple: z.number().finite().positive().max(200).optional(),
    manualRiskFreePct: z.number().finite().min(-10).max(50).optional(),
    erpPct: z.number().finite().min(0).max(50).optional(),
    manualBeta: z.number().finite().min(-5).max(10).optional(),
    manualCostDebtPct: z.number().finite().min(0).max(100).optional(),
    baseRevenueOverride: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
    sharesOverride: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
    netDebtOverride: z.string().regex(/^-?\d+(?:\.\d+)?$/).optional(),
  }).strict().refine(value => Object.keys(value).length > 0) }).strict(),
  z.object({ type: z.literal("panel.selection"), selection: panelSelection }).strict(),
  z.object({ type: z.literal("portfolio.select"), portfolioId: z.number().int().positive().nullable() }).strict(),
  z.object({ type: z.literal("benchmark.select"), symbol: symbol.nullable() }).strict(),
  z.object({ type: z.literal("scenario.select"), scenarioId: z.string().trim().min(1).max(240).nullable() }).strict(),
  z.object({ type: z.literal("source.settings"), sourceScope: z.enum(["auto", "my_data", "web", "files"]).optional(), asOf: z.string().datetime({ offset: true }).nullable().optional(), marketMode: z.enum(["live", "snapshot"]).optional() }).strict(),
]);
export type TerminalArtifactOperation = z.infer<typeof terminalArtifactOperationSchema>;
export const terminalArtifactUpdateSchema = z.object({ artifactId: z.string().regex(/^artifact:[0-9a-f-]{36}$/i), baseVersion: z.number().int().positive(), baseHash: z.string().regex(/^[a-f0-9]{64}$/), operations: z.array(terminalArtifactOperationSchema).min(1).max(32) }).strict();

/** Only presentation/selection fields are mutable here; observations, formulas and receipts are never accepted. */
export function applyTerminalArtifactOperations(view: string, state: TerminalScreenState, operations: TerminalArtifactOperation[]): TerminalScreenState {
  let next = terminalScreenStateSchema.parse({ ...state, panelState: { ...state.panelState } });
  const put = (key: string, value: unknown) => { next = writeTerminalPanelState(next, key, encodeTerminalPanelValue(value)); };
  for (const operation of operations.map(value => terminalArtifactOperationSchema.parse(value))) {
    if (operation.type === "chart.settings") {
      if (view !== "chart") throw new Error("Chart settings require the active chart screen.");
      for (const [key, value] of Object.entries(operation.settings)) put(`chart.${key}`, key === "overlays" ? new Set(value as string[]) : key === "indicatorParams" ? { ...(next.panelState["chart.indicatorParams"] as Record<string, number> ?? {}), ...(value as Record<string, number>) } : value);
      const interval = next.panelState["chart.interval"], range = next.panelState["chart.range"];
      if ((interval === "5m" || interval === "15m") && range !== undefined && range !== "1D" || interval === "1h" && range !== undefined && !["1D", "5D", "1M", "3M"].includes(String(range))) throw new Error("Chart range is incompatible with the selected interval.");
      const params = next.panelState["chart.indicatorParams"] as Record<string, number> | undefined;
      if (params?.["MACD.fast"] !== undefined && params?.["MACD.slow"] !== undefined && params["MACD.fast"] >= params["MACD.slow"]) throw new Error("MACD fast period must precede its slow period.");
    } else if (operation.type === "screener.settings") {
      if (view !== "screener") throw new Error("Screener settings require the active screener screen.");
      for (const [key, value] of Object.entries(operation.settings)) put(`screener.${key}`, value);
      for (const [min, max] of [["minPe", "maxPe"], ["minBeta", "maxBeta"]]) {
        const lo = next.panelState[`screener.${min}`], hi = next.panelState[`screener.${max}`];
        if (lo !== undefined && hi !== undefined && lo !== "" && hi !== "" && Number(lo) > Number(hi)) throw new Error("Screener minimum exceeds maximum.");
      }
      put("screener.activeStrategy", null); put("screener.equityPage", 1);
    } else if (operation.type === "valuation.assumptions") {
      if (view !== "valuation") throw new Error("Valuation assumptions require the selected valuation terminal.");
      for (const [key, value] of Object.entries(operation.values)) put(`InstitutionalValuationPanel.${key}`, value);
    } else if (operation.type === "panel.selection") {
      const portfolio = operation.selection.target.startsWith("PortfolioPanel.");
      if (portfolio ? view !== "portfolio" : view !== "quantworkbench") throw new Error("Selected section/model is not part of the active tool.");
      put(operation.selection.target, operation.selection.value);
    } else if (operation.type === "portfolio.select") {
      if (!["portfolio", "portfoliostress"].includes(view)) throw new Error("Portfolio selection requires a portfolio screen.");
      put("PortfolioStressPanel.portfolioId", operation.portfolioId);
      if (view === "portfolio") put("PortfolioPanel.section", "stress");
    } else if (operation.type === "benchmark.select") {
      if (view !== "riskreturn") throw new Error("Benchmark selection requires the risk/return screen.");
      put("RiskReturnScatterPanel.benchmark", operation.symbol ?? "NONE");
      put("RiskReturnScatterPanel.customBenchmark", "");
    } else if (operation.type === "scenario.select") {
      if (!["portfolio", "portfoliostress"].includes(view)) throw new Error("Scenario selection requires the portfolio stress tool.");
      const scenario = TERMINAL_STRESS_SCENARIOS.find(item => item.id === operation.scenarioId);
      if (!scenario) throw new Error("Choose an existing stress scenario; this operation cannot invent scenario assumptions.");
      put("PortfolioStressPanel.scenario", scenario);
      if (view === "portfolio") put("PortfolioPanel.section", "stress");
    } else {
      if (operation.marketMode === "snapshot" || operation.asOf != null) throw new Error("A presentation operation cannot create a source-bound historical snapshot.");
      if (operation.sourceScope !== undefined && operation.sourceScope !== state.sourceScope) throw new Error("Change source scope explicitly through the Chat Sources control; analytical operations cannot widen data access.");
      if (operation.sourceScope !== undefined) next.sourceScope = operation.sourceScope;
      if (operation.asOf !== undefined) next.asOf = operation.asOf;
      if (operation.marketMode !== undefined) next.marketMode = operation.marketMode;
    }
  }
  return terminalScreenStateSchema.parse(next);
}

/** Deliberately anchored commands: no model, shell, ambiguous prose or numeric calculation. */
export function parseTerminalArtifactInstruction(message: string): TerminalArtifactOperation[] | null {
  const text = message.trim().replace(/[.!?]+$/, "").replace(/^please\s+/i, "");
  const growth = text.match(/^(?:set|change) (?:this |the )?(?:valuation )?terminal growth(?: rate)? to (-?\d+(?:\.\d+)?)%$/i);
  if (growth) return [{ type: "valuation.assumptions", values: { terminalGrowthPct: Number(growth[1]) } }];
  const type = text.match(/^(?:set|change) (?:this |the )?chart(?: type)? to (candlesticks?|candles?|line|area)$/i);
  if (type) return [{ type: "chart.settings", settings: { chartType: /^candle/i.test(type[1]!) ? "CANDLE" : type[1]!.toUpperCase() as "LINE" | "AREA" } }];
  const range = text.match(/^(?:set|change) (?:this |the )?chart range to (1D|5D|1M|3M|6M|1Y|2Y|3Y|5Y)$/i);
  if (range) return [{ type: "chart.settings", settings: { range: range[1]!.toUpperCase() as "3M" } }];
  const oscillator = text.match(/^(?:show|hide) (RSI|MACD|ADX)(?: on (?:this |the )?chart)?$/i);
  if (oscillator) return [{ type: "chart.settings", settings: { oscillator: /^hide/i.test(text) ? "none" : oscillator[1]!.toUpperCase() as "RSI" | "MACD" | "ADX" } }];
  const sort = text.match(/^sort (?:this |the )?screener by (market cap|price|volume|symbol|p\/?e|eps|change)(?: (ascending|descending|asc|desc))?$/i);
  if (sort) {
    const fields: Record<string, "marketCap" | "price" | "volume" | "symbol" | "pe" | "eps" | "changePercent"> = { "market cap": "marketCap", price: "price", volume: "volume", symbol: "symbol", pe: "pe", "p/e": "pe", eps: "eps", change: "changePercent" };
    return [{ type: "screener.settings", settings: { sortField: fields[sort[1]!.toLowerCase()]!, sortDir: /^asc/i.test(sort[2] ?? "") ? "asc" : "desc" } }];
  }
  return null;
}
