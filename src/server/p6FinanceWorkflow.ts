import { p6ExecutionIntentSchema, type FinanceWorkflowFamily, type P6BacktestResult, type P6FinanceWorkflowDescriptor } from "@shared/p6FinanceContracts";
import { p6Hash } from "./p6BacktestEngine";

export const P6_FINANCE_WORKFLOWS: readonly P6FinanceWorkflowDescriptor[] = [
  {
    family: "company_fundamentals",
    deterministic: true,
    artifactKind: "data",
    engineRefs: ["lios.semantic-finance", "lios.sec-edgar", "lios.xbrl"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "governed_data_fabric",
  },
  {
    family: "valuation",
    deterministic: true,
    artifactKind: "valuation",
    engineRefs: ["lios.valuation.dcf", "lios.valuation.comps", "lios.valuation.residual-income", "lios.valuation.eva"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "governed_data_fabric",
  },
  {
    family: "portfolio_risk",
    deterministic: true,
    artifactKind: "portfolio",
    engineRefs: ["lios.portfolio.optimization", "lios.portfolio.risk", "lios.factor-risk", "lios.stress"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "mixed",
  },
  {
    family: "fixed_income",
    deterministic: true,
    artifactKind: "report",
    engineRefs: ["quantlib", "lios.fixed-income", "lios.fixed-income.structured"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "mixed",
  },
  {
    family: "derivatives",
    deterministic: true,
    artifactKind: "report",
    engineRefs: ["lios.derivatives", "lios.derivatives.surface", "quantlib"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "mixed",
  },
  {
    family: "macro_fx",
    deterministic: true,
    artifactKind: "report",
    engineRefs: ["lios.semantic-finance", "lios.economics", "lios.fx"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "governed_data_fabric",
  },
  {
    family: "alternative_assets",
    deterministic: true,
    artifactKind: "report",
    engineRefs: ["lios.market-data", "lios.portfolio.risk"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "governed_data_fabric",
  },
  {
    family: "corporate_actions_events",
    deterministic: true,
    artifactKind: "data",
    engineRefs: ["lios.sec-edgar", "lios.corporate-actions", "lios.events"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "governed_data_fabric",
  },
  {
    family: "research_reporting",
    deterministic: true,
    artifactKind: "report",
    engineRefs: ["lios.report-engine", "lios.artifact-export"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "mixed",
  },
  {
    family: "capital_allocation",
    deterministic: true,
    artifactKind: "decision",
    engineRefs: ["lios.capital-allocation.core-v1", "lios.scenario-action"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "mixed",
  },
  {
    family: "personal_finance",
    deterministic: true,
    artifactKind: "decision",
    engineRefs: ["lios.personal-finance.core-v1"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "user_owned_data",
  },
  {
    family: "strategy_backtest",
    deterministic: true,
    artifactKind: "backtest",
    engineRefs: ["lios.backtest.core-v1"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "governed_data_fabric",
  },
];

export function financeWorkflowDescriptor(family: FinanceWorkflowFamily): P6FinanceWorkflowDescriptor {
  const workflow = P6_FINANCE_WORKFLOWS.find((item) => item.family === family);
  if (!workflow) throw new Error("Unknown P6 finance workflow: " + family);
  return workflow;
}

export interface ValuationDecisionInput {
  symbol: string;
  currentPrice: number;
  fairValue: number;
  downsideFairValue?: number | null;
  upsideFairValue?: number | null;
  materialityPct?: number;
  sourceRefs?: string[];
}

export interface ValuationDecisionCandidate {
  id: "increase_review" | "hold_review" | "reduce_review";
  label: string;
  expectedOutcomes: string[];
  risks: string[];
  tradeoffs: string[];
}

export function buildValuationDecisionSupport(input: ValuationDecisionInput) {
  if (!(input.currentPrice > 0) || !(input.fairValue > 0)) throw new Error("Valuation decision support requires positive currentPrice and fairValue.");
  const materiality = Math.max(0, input.materialityPct ?? 10) / 100;
  const valuationGap = input.fairValue / input.currentPrice - 1;
  const preferredCandidateId: ValuationDecisionCandidate["id"] =
    valuationGap > materiality ? "increase_review" : valuationGap < -materiality ? "reduce_review" : "hold_review";
  const candidates: ValuationDecisionCandidate[] = [
    {
      id: "increase_review",
      label: "Review increasing exposure",
      expectedOutcomes: ["Benefits if the supplied fair-value case is realized."],
      risks: ["Valuation assumptions may be optimistic or become stale.", "Market price can diverge from model value for extended periods."],
      tradeoffs: ["Higher exposure increases concentration and downside sensitivity."],
    },
    {
      id: "hold_review",
      label: "Review maintaining exposure",
      expectedOutcomes: ["Preserves current exposure while assumptions are monitored."],
      risks: ["Opportunity cost if valuation gap closes quickly.", "Existing downside remains."],
      tradeoffs: ["Avoids immediate transaction costs but does not rebalance risk."],
    },
    {
      id: "reduce_review",
      label: "Review reducing exposure",
      expectedOutcomes: ["Reduces exposure if supplied fair value remains below market price."],
      risks: ["May forego upside if assumptions improve or the model is conservative."],
      tradeoffs: ["Risk reduction may create tax or transaction costs."],
    },
  ];
  const artifact = {
    kind: "decision" as const,
    objective: "Evaluate valuation-driven exposure alternatives for " + input.symbol,
    constraints: ["Candidate only; user approval is required before any external action.", "Deterministic valuation remains calculator of record."],
    alternatives: candidates,
    selectedAlternativeId: null,
    implementation: [],
    monitoring: ["Refresh source data and valuation assumptions before acting.", "Re-run downside/base/upside valuation scenarios after material new information."],
  };
  return {
    engineId: "lios.valuation-decision.core-v1",
    deterministic: true as const,
    symbol: input.symbol,
    valuationGap,
    preferredCandidateId,
    candidateOnly: true as const,
    approvalRequired: true as const,
    artifact,
    sourceRefs: input.sourceRefs ?? [],
    resultHash: p6Hash({ input, candidates, preferredCandidateId }),
  };
}

export interface RebalanceHolding {
  instrumentRef: string;
  currentWeight: number;
  targetWeight: number;
}

export function buildPortfolioRebalanceDecision(input: {
  portfolioRef: string;
  portfolioValue: number;
  holdings: RebalanceHolding[];
  tolerancePct?: number;
  sourceRefs?: string[];
}) {
  if (!(input.portfolioValue > 0)) throw new Error("portfolioValue must be positive.");
  const currentSum = input.holdings.reduce((sum, item) => sum + item.currentWeight, 0);
  const targetSum = input.holdings.reduce((sum, item) => sum + item.targetWeight, 0);
  if (Math.abs(currentSum - 1) > 1e-6 || Math.abs(targetSum - 1) > 1e-6) throw new Error("Current and target portfolio weights must each sum to 1.");
  const tolerance = Math.max(0, input.tolerancePct ?? 1) / 100;
  const trades = input.holdings.map((holding) => {
    const deltaWeight = holding.targetWeight - holding.currentWeight;
    return {
      instrumentRef: holding.instrumentRef,
      currentWeight: holding.currentWeight,
      targetWeight: holding.targetWeight,
      deltaWeight,
      notionalChange: deltaWeight * input.portfolioValue,
      outsideTolerance: Math.abs(deltaWeight) > tolerance,
    };
  });
  return {
    engineId: "lios.portfolio-rebalance.core-v1",
    deterministic: true as const,
    candidateOnly: true as const,
    approvalRequired: true as const,
    portfolioRef: input.portfolioRef,
    tolerance,
    trades,
    grossTurnover: trades.reduce((sum, trade) => sum + Math.abs(trade.deltaWeight), 0) / 2,
    sourceRefs: input.sourceRefs ?? [],
    resultHash: p6Hash({ input, trades }),
    artifact: {
      kind: "decision" as const,
      objective: "Review portfolio rebalance toward the supplied target weights.",
      constraints: ["No order is sent by this workflow.", "User confirmation is required for any external execution workflow."],
      alternatives: [
        {
          id: "rebalance_to_target",
          label: "Review rebalance to target",
          expectedOutcomes: ["Moves modeled weights toward supplied targets."],
          risks: ["Realized fills, tax, spread and market impact may differ from modeled notional changes."],
          tradeoffs: ["Higher turnover can increase implementation costs."],
        },
        {
          id: "hold_current",
          label: "Maintain current weights",
          expectedOutcomes: ["Avoids immediate turnover."],
          risks: ["Current risk exposures remain."],
          tradeoffs: ["May preserve drift away from target allocation."],
        },
      ],
      selectedAlternativeId: null,
      implementation: [],
      monitoring: ["Recompute weights after material price moves or cash flows."],
    },
  };
}

export interface CapitalAllocationAlternative {
  id: string;
  label: string;
  expectedReturn: number;
  riskScore: number;
  liquidityScore: number;
  strategicFit: number;
  maximumAmount?: number | null;
}

export function rankCapitalAllocationCandidates(input: {
  availableCapital: number;
  alternatives: CapitalAllocationAlternative[];
  weights?: { return: number; risk: number; liquidity: number; strategicFit: number };
}) {
  if (!(input.availableCapital >= 0)) throw new Error("availableCapital must be non-negative.");
  if (!input.alternatives.length) throw new Error("At least one capital-allocation alternative is required.");
  const weights = input.weights ?? { return: 0.4, risk: 0.25, liquidity: 0.15, strategicFit: 0.2 };
  const scored = input.alternatives.map((alternative) => {
    for (const value of [alternative.riskScore, alternative.liquidityScore, alternative.strategicFit]) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("riskScore, liquidityScore and strategicFit must be between 0 and 1.");
    }
    const score =
      alternative.expectedReturn * weights.return -
      alternative.riskScore * weights.risk +
      alternative.liquidityScore * weights.liquidity +
      alternative.strategicFit * weights.strategicFit;
    return { ...alternative, score };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    engineId: "lios.capital-allocation.core-v1",
    deterministic: true as const,
    candidateOnly: true as const,
    approvalRequired: true as const,
    availableCapital: input.availableCapital,
    weights,
    candidates: scored,
    resultHash: p6Hash({ input, scored }),
  };
}

export function buildGovernedExecutionIntent(input: {
  backtest: P6BacktestResult;
  instrumentRef: string;
  side: "buy" | "sell" | "rebalance" | "hold";
  strategyRef?: string;
  quantity?: number | null;
  notional?: number | null;
  adapterRef?: string | null;
}) {
  if (input.backtest.status !== "completed") throw new Error("Execution intent requires a completed backtest.");
  return p6ExecutionIntentSchema.parse({
    schemaVersion: "1",
    strategyRef: input.strategyRef ?? input.backtest.strategyHash,
    backtestReproducibilityHash: input.backtest.reproducibilityHash,
    instrumentRef: input.instrumentRef,
    side: input.side,
    quantity: input.quantity ?? null,
    notional: input.notional ?? null,
    state: "draft",
    approvalRequired: true,
    externalExecutionPerformed: false,
    adapterRef: input.adapterRef ?? null,
    notes: [
      "Research execution intent only.",
      "No broker order is sent by P6.",
      "An external execution adapter, separate user approval and applicable policy checks are required before any future side effect.",
    ],
  });
}

export function assertP6CalculatorOfRecord(result: { deterministic?: boolean; aiDerived?: boolean }): void {
  if (result.deterministic !== true) throw new Error("P6 calculator-of-record output must be deterministic.");
  if (result.aiDerived === true) throw new Error("AI-derived output cannot replace a deterministic P6 calculator-of-record result.");
}
