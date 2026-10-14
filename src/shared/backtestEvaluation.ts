import { z } from "zod";
import type { BacktestRequest } from "./runtimeContracts";

export const BACKTEST_EVALUATION_SCHEMA_VERSION = "1" as const;

export const backtestEvaluationModeSchema = z.enum([
  "single_run",
  "walk_forward",
  "parameter_sensitivity",
  "monte_carlo",
]);
export type BacktestEvaluationMode = z.infer<typeof backtestEvaluationModeSchema>;

const positiveInt = z.number().int().positive();

export const backtestCostAssumptionsSchema = z.object({
  feesBps: z.number().finite().nonnegative().default(0),
  slippageBps: z.number().finite().nonnegative().default(0),
  marketImpactBps: z.number().finite().nonnegative().default(0),
  maxParticipationRate: z.number().finite().positive().max(1).default(1),
}).strict();
export type BacktestCostAssumptions = z.infer<typeof backtestCostAssumptionsSchema>;

export const walkForwardEvaluationSchema = z.object({
  trainingDays: positiveInt,
  testDays: positiveInt,
  stepDays: positiveInt,
  anchored: z.boolean().default(true),
}).strict();
export type WalkForwardEvaluation = z.infer<typeof walkForwardEvaluationSchema>;

export const parameterSensitivityEvaluationSchema = z.object({
  dimensions: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    values: z.array(z.number().finite()).min(1).max(100),
  }).strict()).min(1).max(20),
}).strict();
export type ParameterSensitivityEvaluation = z.infer<typeof parameterSensitivityEvaluationSchema>;

export const monteCarloEvaluationSchema = z.object({
  iterations: z.number().int().positive().max(100_000),
  seed: z.number().int(),
}).strict();
export type MonteCarloEvaluation = z.infer<typeof monteCarloEvaluationSchema>;

export const backtestEvaluationPolicySchema = z.object({
  schemaVersion: z.literal(BACKTEST_EVALUATION_SCHEMA_VERSION),
  modes: z.array(backtestEvaluationModeSchema).min(1).max(4),
  pointInTimeRequired: z.literal(true).default(true),
  costs: backtestCostAssumptionsSchema,
  walkForward: walkForwardEvaluationSchema.nullable().default(null),
  parameterSensitivity: parameterSensitivityEvaluationSchema.nullable().default(null),
  monteCarlo: monteCarloEvaluationSchema.nullable().default(null),
}).strict().superRefine((policy, ctx) => {
  const modes = new Set(policy.modes);
  const checks: Array<[BacktestEvaluationMode, unknown, string]> = [
    ["walk_forward", policy.walkForward, "walkForward"],
    ["parameter_sensitivity", policy.parameterSensitivity, "parameterSensitivity"],
    ["monte_carlo", policy.monteCarlo, "monteCarlo"],
  ];

  for (const [mode, config, path] of checks) {
    if (modes.has(mode) && config === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `${mode} mode requires ${path} configuration.` });
    }
    if (!modes.has(mode) && config !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `${path} configuration requires ${mode} mode.` });
    }
  }
});
export type BacktestEvaluationPolicy = z.infer<typeof backtestEvaluationPolicySchema>;

export interface BacktestEvaluationPlan {
  request: BacktestRequest;
  policy: BacktestEvaluationPolicy;
}

/**
 * Normalizes the policy at the P6 engine boundary without selecting an engine.
 * The engine adapter remains replaceable; this contract owns only
 * reproducibility, point-in-time and execution-assumption guardrails.
 */
export function buildBacktestEvaluationPlan(
  request: BacktestRequest,
  policy: unknown,
): BacktestEvaluationPlan {
  if (!request.pointInTimeRequired) {
    throw new Error("Robust backtest evaluation requires point-in-time semantics.");
  }
  return {
    request: { ...request, assumptions: { ...request.assumptions } },
    policy: backtestEvaluationPolicySchema.parse(policy),
  };
}
