import {
  type AnalyticalDiagnostic,
  type AnalyticalInput,
  type AnalyticalModelDefinition,
  type AnalyticalRunStatus,
} from "./analyticalCore";
import { analyticalModelRegistry, type AnalyticalModelRegistry } from "./analyticalRegistry";
import { type AnalyticalScenario } from "./analyticalScenario";
import {
  DEFAULT_DCF_SCENARIOS,
  runInstitutionalDcf,
  type DcfScenarioDefinition,
  type InstitutionalDcfInput,
} from "./institutionalDcf";

export const INSTITUTIONAL_DCF_MODEL_ID = "valuation.institutional-dcf";

function observedInput(id: string, label: string, value: number | null | undefined, unit: string | undefined, sourceAsOf?: string | null): AnalyticalInput {
  return {
    id,
    label,
    value: typeof value === "number" && Number.isFinite(value) ? value : null,
    unit,
    kind: "observed",
    source: "LiOS governed market/fundamental inputs",
    asOf: sourceAsOf,
  };
}

function assumptionInput(id: string, label: string, value: number | null | undefined, unit?: string): AnalyticalInput {
  return {
    id,
    label,
    value: typeof value === "number" && Number.isFinite(value) ? value : null,
    unit,
    kind: "assumption",
  };
}

function describeDcfInputs(input: InstitutionalDcfInput): AnalyticalInput[] {
  const sourceAsOf = input.sourceAsOf;
  return [
    observedInput("baseRevenue", "BASE REVENUE", input.baseRevenue, "currency", sourceAsOf),
    observedInput("spotPrice", "SPOT PRICE", input.spotPrice, "currency/share", sourceAsOf),
    observedInput("dilutedShares", "DILUTED SHARES", input.dilutedShares, "shares", sourceAsOf),
    observedInput("netDebt", "NET DEBT", input.bridge.netDebt, "currency", sourceAsOf),
    observedInput("startingInvestedCapital", "STARTING INVESTED CAPITAL", input.startingInvestedCapital, "currency", sourceAsOf),
    assumptionInput("discount.currentWaccPct", "CURRENT WACC", input.discount.currentWaccPct, "%"),
    assumptionInput("discount.currentCostOfEquityPct", "CURRENT COST OF EQUITY", input.discount.currentCostOfEquityPct, "%"),
    assumptionInput("terminal.growthPct", "TERMINAL GROWTH", input.terminal.growthPct, "%"),
    assumptionInput("terminal.exitMultiple", "TERMINAL EXIT MULTIPLE", input.terminal.exitMultiple, "x"),
    ...input.years.flatMap((year, index) => [
      assumptionInput(`years.${index}.revenueGrowthPct`, `Y${index + 1} REVENUE GROWTH`, year.revenueGrowthPct, "%"),
      assumptionInput(`years.${index}.ebitdaMarginPct`, `Y${index + 1} EBITDA MARGIN`, year.ebitdaMarginPct, "%"),
      assumptionInput(`years.${index}.taxRatePct`, `Y${index + 1} TAX RATE`, year.taxRatePct, "%"),
      assumptionInput(`years.${index}.capexPctRevenue`, `Y${index + 1} CAPEX / REVENUE`, year.capexPctRevenue, "%"),
      assumptionInput(`years.${index}.nwcInvestmentPctRevenue`, `Y${index + 1} NWC INVESTMENT / REVENUE`, year.nwcInvestmentPctRevenue, "%"),
    ]),
  ];
}

function dcfStatus(status: ReturnType<typeof runInstitutionalDcf>["status"]): AnalyticalRunStatus {
  return status === "ready" ? "success" : status === "partial" ? "partial" : "blocked";
}

function dcfDiagnostics(result: ReturnType<typeof runInstitutionalDcf>): AnalyticalDiagnostic[] {
  const blocking = result.blockingIssues.map((detail, index): AnalyticalDiagnostic => ({
    id: `blocking-${index + 1}`,
    label: "DCF INPUT BLOCKER",
    severity: "critical",
    detail,
    blocking: true,
  }));
  const warnings = result.warnings.map((detail, index): AnalyticalDiagnostic => ({
    id: `warning-${index + 1}`,
    label: "DCF MODEL WARNING",
    severity: "watch",
    detail,
  }));
  const health = result.health.map((diagnostic): AnalyticalDiagnostic => ({
    id: diagnostic.id,
    label: diagnostic.label,
    severity: diagnostic.severity,
    detail: diagnostic.detail,
    metric: diagnostic.value,
    blocking: false,
  }));
  return [...blocking, ...warnings, ...health];
}

export const INSTITUTIONAL_DCF_ANALYTICAL_MODEL: AnalyticalModelDefinition<InstitutionalDcfInput> = {
  id: INSTITUTIONAL_DCF_MODEL_ID,
  label: "Institutional DCF",
  domain: "valuation",
  version: "1.0.0",
  determinism: "deterministic",
  description: "FCFF/FCFE institutional DCF with explicit reinvestment, capital bridge, terminal-value and health diagnostics.",
  describeInputs: (input) => describeDcfInputs(input),
  execute: (input) => {
    const result = runInstitutionalDcf(input);
    return {
      status: dcfStatus(result.status),
      outputs: [
        { id: "valuePerShare", label: "IMPLIED VALUE / SHARE", value: result.valuePerShare, unit: "currency/share", role: "primary" },
        { id: "upsidePct", label: "UPSIDE / DOWNSIDE", value: result.upsidePct, unit: "%", role: "primary" },
        { id: "enterpriseValue", label: "ENTERPRISE VALUE", value: result.enterpriseValue, unit: "currency", role: "secondary" },
        { id: "equityValue", label: "EQUITY VALUE", value: result.equityValue, unit: "currency", role: "secondary" },
        { id: "pvExplicitCashFlows", label: "PV EXPLICIT CASH FLOWS", value: result.pvExplicitCashFlows, unit: "currency", role: "secondary" },
        { id: "pvTerminalValue", label: "PV TERMINAL VALUE", value: result.pvTerminalValue, unit: "currency", role: "secondary" },
        { id: "terminalValuePct", label: "TERMINAL VALUE / TOTAL", value: result.terminalValuePct, unit: "%", role: "diagnostic" },
        { id: "impliedTerminalEvEbitda", label: "IMPLIED TERMINAL EV / EBITDA", value: result.impliedTerminalEvEbitda, unit: "x", role: "diagnostic" },
      ],
      diagnostics: dcfDiagnostics(result),
      evidence: input.sourceAsOf
        ? [{ id: "source-snapshot", label: "DCF SOURCE SNAPSHOT", source: "LiOS governed market/fundamental inputs", asOf: input.sourceAsOf }]
        : [],
      dependencies: [
        { id: "valuation.terminal-value", kind: "model", label: "Terminal value engine" },
        { id: "valuation.discount-path", kind: "model", label: "Discount-rate path engine" },
      ],
      metadata: {
        cashFlowMode: input.cashFlowMode,
        projectionYears: input.years.length,
        terminalMethod: input.terminal.method,
        nativeStatus: result.status,
      },
    };
  },
};

export function registerInstitutionalDcfAnalyticalModel(registry: AnalyticalModelRegistry = analyticalModelRegistry): AnalyticalModelRegistry {
  if (!registry.has(INSTITUTIONAL_DCF_MODEL_ID)) registry.register(INSTITUTIONAL_DCF_ANALYTICAL_MODEL);
  return registry;
}

export function dcfScenarioAsAnalyticalScenario(definition: DcfScenarioDefinition): AnalyticalScenario {
  return {
    id: `valuation.dcf.${definition.key}`,
    label: definition.label,
    description: definition.description,
    tags: ["valuation", "dcf"],
    shocks: [
      { id: "growth", label: "Revenue growth shock", path: "years.*.revenueGrowthPct", operation: "add", value: definition.revenueGrowthShockPctPoints, unit: "percentage-points" },
      { id: "margin", label: "EBITDA margin shock", path: "years.*.ebitdaMarginPct", operation: "add", value: definition.ebitdaMarginShockPctPoints, unit: "percentage-points" },
      { id: "capex", label: "Capex intensity shock", path: "years.*.capexPctRevenue", operation: "add", value: definition.capexShockPctPoints, unit: "percentage-points" },
      { id: "nwc", label: "Working-capital shock", path: "years.*.nwcInvestmentPctRevenue", operation: "add", value: definition.nwcShockPctPoints, unit: "percentage-points" },
      { id: "wacc", label: "WACC shock", path: "discount.currentWaccPct", operation: "add", value: definition.waccShockPctPoints, unit: "percentage-points" },
      { id: "cost-equity", label: "Cost of equity shock", path: "discount.currentCostOfEquityPct", operation: "add", value: definition.costOfEquityShockPctPoints, unit: "percentage-points" },
      { id: "terminal-growth", label: "Terminal growth shock", path: "terminal.growthPct", operation: "add", value: definition.terminalGrowthShockPctPoints, unit: "percentage-points" },
    ],
  };
}

export const DCF_ANALYTICAL_SCENARIOS = {
  bear: dcfScenarioAsAnalyticalScenario(DEFAULT_DCF_SCENARIOS.bear),
  base: dcfScenarioAsAnalyticalScenario(DEFAULT_DCF_SCENARIOS.base),
  bull: dcfScenarioAsAnalyticalScenario(DEFAULT_DCF_SCENARIOS.bull),
};
