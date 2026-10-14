import { z } from "zod";

export const P6_FINANCE_SCHEMA_VERSION = "1" as const;

export const financeWorkflowFamilySchema = z.enum([
  "company_fundamentals",
  "valuation",
  "portfolio_risk",
  "fixed_income",
  "derivatives",
  "macro_fx",
  "alternative_assets",
  "corporate_actions_events",
  "research_reporting",
  "capital_allocation",
  "personal_finance",
  "strategy_backtest",
]);
export type FinanceWorkflowFamily = z.infer<typeof financeWorkflowFamilySchema>;

export const p6StrategyKindSchema = z.enum([
  "buy_and_hold",
  "rsi_mean_reversion",
  "moving_average_crossover",
  "breakout",
  "dual_momentum",
]);
export type P6StrategyKind = z.infer<typeof p6StrategyKindSchema>;

export const p6StrategyDefinitionSchema = z.object({
  schemaVersion: z.literal(P6_FINANCE_SCHEMA_VERSION),
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300),
  kind: p6StrategyKindSchema,
  parameters: z.record(z.number().finite()).default({}),
  sourceLanguage: z.enum(["rules", "json", "brue"]).default("rules"),
  source: z.string().max(500_000).default(""),
}).strict();
export type P6StrategyDefinition = z.infer<typeof p6StrategyDefinitionSchema>;

export const p6BacktestBarSchema = z.object({
  at: z.string().datetime({ offset: true }),
  open: z.number().finite().positive(),
  high: z.number().finite().positive(),
  low: z.number().finite().positive(),
  close: z.number().finite().positive(),
  volume: z.number().finite().nonnegative().nullable().default(null),
  availableAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.high < Math.max(value.open, value.close, value.low)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["high"], message: "high must be at least open, close and low." });
  }
  if (value.low > Math.min(value.open, value.close, value.high)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["low"], message: "low must be at most open, close and high." });
  }
});
export type P6BacktestBar = z.infer<typeof p6BacktestBarSchema>;

export const p6BacktestAssumptionsSchema = z.object({
  startingCapital: z.number().finite().positive().default(100_000),
  feesBps: z.number().finite().min(0).max(10_000).default(0),
  slippageBps: z.number().finite().min(0).max(10_000).default(0),
  riskFreeRateAnnual: z.number().finite().min(-1).max(10).default(0),
  execution: z.enum(["next_bar_open", "next_bar_close"]).default("next_bar_open"),
  maxParticipationRate: z.number().finite().gt(0).max(1).nullable().default(null),
  pointInTimeRequired: z.boolean().default(true),
  seed: z.number().int().default(20260922),
}).strict();
export type P6BacktestAssumptions = z.infer<typeof p6BacktestAssumptionsSchema>;

export const p6BacktestRequestSchema = z.object({
  schemaVersion: z.literal(P6_FINANCE_SCHEMA_VERSION),
  strategy: p6StrategyDefinitionSchema,
  instrumentRef: z.string().trim().min(1).max(300),
  bars: z.array(p6BacktestBarSchema).min(3).max(1_000_000),
  benchmarkBars: z.array(p6BacktestBarSchema).max(1_000_000).nullable().default(null),
  assumptions: p6BacktestAssumptionsSchema.default({}),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
}).strict();
export type P6BacktestRequest = z.infer<typeof p6BacktestRequestSchema>;

export const p6BacktestTradeSchema = z.object({
  side: z.enum(["buy", "sell"]),
  signalAt: z.string().datetime({ offset: true }),
  executedAt: z.string().datetime({ offset: true }),
  price: z.number().finite().positive(),
  rawPrice: z.number().finite().positive(),
  quantity: z.number().finite().positive(),
  grossValue: z.number().finite().positive(),
  fees: z.number().finite().nonnegative(),
  slippageCost: z.number().finite().nonnegative(),
  reason: z.string().trim().min(1).max(300),
}).strict();
export type P6BacktestTrade = z.infer<typeof p6BacktestTradeSchema>;

export const p6BacktestMetricsSchema = z.object({
  totalReturn: z.number().finite(),
  annualizedReturn: z.number().finite(),
  annualizedVolatility: z.number().finite(),
  sharpe: z.number().finite(),
  sortino: z.number().finite(),
  maxDrawdown: z.number().finite(),
  winRate: z.number().finite(),
  turnover: z.number().finite().nonnegative(),
  tradeCount: z.number().int().nonnegative(),
  costImpact: z.number().finite().nonnegative(),
  benchmarkReturn: z.number().finite().nullable(),
  excessReturn: z.number().finite().nullable(),
}).strict();
export type P6BacktestMetrics = z.infer<typeof p6BacktestMetricsSchema>;

const datedValueSchema = z.object({
  at: z.string().datetime({ offset: true }),
  value: z.number().finite(),
}).strict();

export const p6BacktestResultSchema = z.object({
  schemaVersion: z.literal(P6_FINANCE_SCHEMA_VERSION),
  engineId: z.literal("lios.backtest.core-v1"),
  engineVersion: z.literal("1.0.0"),
  status: z.literal("completed"),
  reproducibilityHash: z.string().regex(/^[a-f0-9]{64}$/),
  reproducibilityId: z.string().uuid(),
  strategyHash: z.string().regex(/^[a-f0-9]{64}$/),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  pointInTimeVerified: z.boolean(),
  equityCurve: z.array(datedValueSchema),
  drawdown: z.array(datedValueSchema),
  benchmark: z.array(datedValueSchema),
  exposure: z.array(datedValueSchema),
  trades: z.array(p6BacktestTradeSchema),
  metrics: p6BacktestMetricsSchema,
  assumptions: p6BacktestAssumptionsSchema,
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(200).default([]),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500).default([]),
}).strict();
export type P6BacktestResult = z.infer<typeof p6BacktestResultSchema>;

export const p6BacktestLifecycleSchema = z.object({
  state: z.enum(["edited_not_run", "running", "completed", "failed", "stale"]),
  lastSuccessfulHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  currentInputHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  message: z.string().max(1_000).nullable().default(null),
}).strict();
export type P6BacktestLifecycle = z.infer<typeof p6BacktestLifecycleSchema>;

export const p6ParameterSweepRequestSchema = z.object({
  request: p6BacktestRequestSchema,
  parameter: z.string().trim().min(1).max(120),
  values: z.array(z.number().finite()).min(1).max(500),
}).strict();
export type P6ParameterSweepRequest = z.infer<typeof p6ParameterSweepRequestSchema>;

export const p6MonteCarloRequestSchema = z.object({
  result: p6BacktestResultSchema,
  paths: z.number().int().min(10).max(10_000).default(500),
  seed: z.number().int().default(20260922),
}).strict();
export type P6MonteCarloRequest = z.infer<typeof p6MonteCarloRequestSchema>;

export const p6PersonalAccountSchema = z.object({
  id: z.string().trim().min(1).max(200),
  kind: z.enum(["cash", "bank", "investment", "retirement", "property", "other_asset", "credit_card", "loan", "other_liability"]),
  balance: z.number().finite(),
  currency: z.string().trim().min(3).max(12).default("INR"),
}).strict();
export type P6PersonalAccount = z.infer<typeof p6PersonalAccountSchema>;

export const p6PersonalTransactionSchema = z.object({
  id: z.string().trim().min(1).max(200),
  at: z.string().date(),
  amount: z.number().finite(),
  category: z.string().trim().min(1).max(200),
  accountId: z.string().trim().min(1).max(200),
}).strict();
export type P6PersonalTransaction = z.infer<typeof p6PersonalTransactionSchema>;

export const p6DebtSchema = z.object({
  id: z.string().trim().min(1).max(200),
  principal: z.number().finite().nonnegative(),
  annualRate: z.number().finite().min(0).max(10),
  monthlyPayment: z.number().finite().positive(),
  currency: z.string().trim().min(3).max(12).default("INR"),
}).strict();
export type P6Debt = z.infer<typeof p6DebtSchema>;

export const p6GoalSchema = z.object({
  id: z.string().trim().min(1).max(200),
  targetAmount: z.number().finite().positive(),
  currentAmount: z.number().finite().nonnegative().default(0),
  monthlyContribution: z.number().finite().nonnegative().default(0),
  annualReturnAssumption: z.number().finite().min(-1).max(10).default(0),
  targetDate: z.string().date(),
  currency: z.string().trim().min(3).max(12).default("INR"),
}).strict();
export type P6Goal = z.infer<typeof p6GoalSchema>;

export const p6RetirementProjectionInputSchema = z.object({
  currentAge: z.number().finite().min(0).max(120),
  retirementAge: z.number().finite().min(0).max(120),
  currentPortfolio: z.number().finite().nonnegative(),
  monthlyContribution: z.number().finite().nonnegative(),
  annualReturnAssumption: z.number().finite().min(-1).max(10),
  annualInflationAssumption: z.number().finite().min(-1).max(10),
  annualRetirementSpendingToday: z.number().finite().nonnegative(),
  withdrawalRate: z.number().finite().gt(0).max(1),
}).strict();
export type P6RetirementProjectionInput = z.infer<typeof p6RetirementProjectionInputSchema>;

// Optional and explicit: existing personal-finance calls remain unchanged.
// The caller must supply every stochastic assumption; no inferred volatility.
export const p6RetirementStressAssumptionsSchema = z.object({
  annualReturnVolatility: z.number().finite().min(0).max(2),
  paths: z.number().int().min(100).max(2_000),
  yearsInRetirement: z.number().int().min(1).max(60),
  seed: z.number().int().min(0).max(0xffffffff),
}).strict();
export type P6RetirementStressAssumptions = z.infer<typeof p6RetirementStressAssumptionsSchema>;

export const p6PersonalFinanceRequestSchema = z.object({
  schemaVersion: z.literal(P6_FINANCE_SCHEMA_VERSION),
  asOf: z.string().date(),
  accounts: z.array(p6PersonalAccountSchema).max(100_000).default([]),
  transactions: z.array(p6PersonalTransactionSchema).max(1_000_000).default([]),
  debts: z.array(p6DebtSchema).max(10_000).default([]),
  goals: z.array(p6GoalSchema).max(10_000).default([]),
  retirement: p6RetirementProjectionInputSchema.nullable().default(null),
  retirementStress: p6RetirementStressAssumptionsSchema.nullable().optional(),
  fxNormalization: z.object({
    reportingCurrency: z.string().regex(/^[A-Z]{3}$/),
  }).strict().optional(),
}).strict();
export type P6PersonalFinanceRequest = z.infer<typeof p6PersonalFinanceRequestSchema>;

export const p6ExecutionIntentSchema = z.object({
  schemaVersion: z.literal(P6_FINANCE_SCHEMA_VERSION),
  strategyRef: z.string().trim().min(1).max(500),
  backtestReproducibilityHash: z.string().regex(/^[a-f0-9]{64}$/),
  instrumentRef: z.string().trim().min(1).max(300),
  side: z.enum(["buy", "sell", "rebalance", "hold"]),
  quantity: z.number().finite().positive().nullable().default(null),
  notional: z.number().finite().positive().nullable().default(null),
  state: z.enum(["draft", "approved_for_adapter", "rejected"]).default("draft"),
  approvalRequired: z.literal(true),
  externalExecutionPerformed: z.literal(false),
  adapterRef: z.string().trim().min(1).max(300).nullable().default(null),
  notes: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
}).strict();
export type P6ExecutionIntent = z.infer<typeof p6ExecutionIntentSchema>;

export const p6RuntimeCandidateSchema = z.object({
  id: z.string().trim().min(1).max(200),
  role: z.enum(["standard_backtest", "advanced_backtest", "strategy_runtime", "portfolio_optimizer", "filing_parser", "xbrl_validator", "indicator_reference", "ml_quant_pack"]),
  lifecycle: z.enum(["builtin", "managed_bundled", "qualified_optional", "research_only"]),
  bundled: z.boolean(),
  license: z.string().trim().min(1).max(120),
  upstreamCommit: z.string().regex(/^[a-f0-9]{40}$/).nullable().default(null),
  active: z.boolean(),
  notes: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
}).strict();
export type P6RuntimeCandidate = z.infer<typeof p6RuntimeCandidateSchema>;

export const p6FinanceWorkflowDescriptorSchema = z.object({
  family: financeWorkflowFamilySchema,
  deterministic: z.boolean(),
  artifactKind: z.enum(["valuation", "portfolio", "report", "backtest", "strategy", "decision", "data", "spreadsheet"]),
  engineRefs: z.array(z.string().trim().min(1).max(300)).min(1).max(50),
  supportsConversation: z.boolean(),
  supportsRerun: z.boolean(),
  supportsExport: z.boolean(),
  sourcePolicy: z.enum(["governed_data_fabric", "user_owned_data", "mixed"]),
}).strict();
export type P6FinanceWorkflowDescriptor = z.infer<typeof p6FinanceWorkflowDescriptorSchema>;
