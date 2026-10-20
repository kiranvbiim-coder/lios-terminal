import type { ArtifactContent } from "@shared/artifactContracts";

// Synthetic renderer fixture shaped like the deterministic DCF-sensitivity contract.
// These deliberately constructed inputs and outputs are UI data, not a provider record,
// an independent numerical benchmark, or evidence of a real product run.
export const dcfSensitivityParameters = {
  freeCashFlows: [100, 110, 120],
  waccPct: 10,
  terminalMethod: "gordon_growth",
  terminalGrowthPct: 3,
  netDebt: 50,
  sharesOutstanding: 21.697706818518384,
  waccGridPct: [9, 10, 11],
  terminalGrowthGridPct: [2, 3, 4],
  bearCase: { freeCashFlows: [90, 95, 100], waccPct: 11, terminalMethod: "gordon_growth", terminalGrowthPct: 2 },
  bullCase: { freeCashFlows: [110, 125, 140], waccPct: 9, terminalMethod: "gordon_growth", terminalGrowthPct: 4 },
};

export const dcfSensitivityOutputs = {
  base: {
    pvExplicitCashFlows: 271.9759579263711, terminalValue: 1765.7142857142858, pvTerminalValue: 1326.6072770204999,
    enterpriseValue: 1598.583234946871, equityValue: 1548.583234946871, valuePerShare: 71.370824940136,
    waccPct: 10, terminalMethod: "gordon_growth", terminalGrowthPct: 3, exitMultiple: null, terminalMetric: null,
  },
  sensitivity: {
    waccPct: [9, 10, 11],
    terminalGrowthPct: [2, 3, 4],
    valuePerShareMatrix: [
      [72.69007366420095, 83.77327245970301, 99.28975077340591],
      [63.20887339740708, 71.370824940136, 82.25342699710791],
      [55.83685926838747, 62.07117733121734, 70.0867291262843],
    ],
  },
  scenarios: {
    bear: {
      pvExplicitCashFlows: 231.30435036936132, terminalValue: 1133.3333333333335, pvTerminalValue: 828.6835654744103,
      enterpriseValue: 1059.9879158437716, equityValue: 1009.9879158437716, valuePerShare: 46.54814097597518,
      waccPct: 11, terminalMethod: "gordon_growth", terminalGrowthPct: 2, exitMultiple: null, terminalMetric: null,
    },
    base: {
      pvExplicitCashFlows: 271.9759579263711, terminalValue: 1765.7142857142858, pvTerminalValue: 1326.6072770204999,
      enterpriseValue: 1598.583234946871, equityValue: 1548.583234946871, valuePerShare: 71.370824940136,
      waccPct: 10, terminalMethod: "gordon_growth", terminalGrowthPct: 3, exitMultiple: null, terminalMetric: null,
    },
    bull: {
      pvExplicitCashFlows: 314.23311755952955, terminalValue: 2912, pvTerminalValue: 2248.5982939378187,
      enterpriseValue: 2562.831411497348, equityValue: 2512.831411497348, valuePerShare: 115.81092105792106,
      waccPct: 9, terminalMethod: "gordon_growth", terminalGrowthPct: 4, exitMultiple: null, terminalMetric: null,
    },
  },
  conventions: {
    discountTiming: "year_end", explicitCashFlowTiming: "end_of_period", sensitivityTerminalMethod: "gordon_growth",
    currencyUnits: "same_as_free_cash_flows_and_net_debt", perShareUnits: "currency_units_per_share",
  },
};

export const dcfSensitivityValuation: Extract<ArtifactContent, { kind: "valuation" }> = {
  kind: "valuation",
  symbol: "ACME",
  modelId: "python.advanced.valuation.dcf-sensitivity",
  assumptions: dcfSensitivityParameters,
  outputs: dcfSensitivityOutputs,
  summary: {
    modelPath: "valuation/dcf-sensitivity",
    modelVersion: "1.0.0",
    validationLevel: "known_answer",
    inputSnapshotHash: "a".repeat(64),
    outputSnapshotHash: "b".repeat(64),
    dataClassification: "manual",
  },
};
