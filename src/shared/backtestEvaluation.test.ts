import assert from "node:assert/strict";
import test from "node:test";

import {
  backtestEvaluationPolicySchema,
  buildBacktestEvaluationPlan,
} from "./backtestEvaluation";

const request = {
  schemaVersion: "1" as const,
  strategyRef: "strategy:mean-reversion",
  instrumentRefs: ["security:AAPL"],
  startDate: "2020-01-01",
  endDate: "2024-01-01",
  frequency: "1d",
  startingCapital: 100_000,
  benchmarkRef: "security:SPY",
  assumptions: { feesBps: 1, slippageBps: 2, seed: 42 },
  pointInTimeRequired: true,
};

test("P6 policy accepts a reproducible single run with bounded costs", () => {
  const plan = buildBacktestEvaluationPlan(request, {
    schemaVersion: "1",
    modes: ["single_run"],
    costs: { feesBps: 1, slippageBps: 2, marketImpactBps: 3, maxParticipationRate: 0.25 },
  });

  assert.deepEqual(plan.policy.modes, ["single_run"]);
  assert.equal(plan.policy.pointInTimeRequired, true);
  assert.equal(plan.policy.costs.maxParticipationRate, 0.25);
});

test("P6 policy requires configuration for every selected robustness mode", () => {
  assert.throws(
    () => backtestEvaluationPolicySchema.parse({
      schemaVersion: "1",
      modes: ["walk_forward", "parameter_sensitivity", "monte_carlo"],
      costs: {},
    }),
    /requires .* configuration/,
  );
});

test("P6 policy rejects unused robustness configuration", () => {
  assert.throws(
    () => backtestEvaluationPolicySchema.parse({
      schemaVersion: "1",
      modes: ["single_run"],
      costs: {},
      monteCarlo: { iterations: 100, seed: 7 },
    }),
    /requires monte_carlo mode/,
  );
});

test("P6 policy requires deterministic seed for Monte Carlo", () => {
  assert.throws(
    () => backtestEvaluationPolicySchema.parse({
      schemaVersion: "1",
      modes: ["monte_carlo"],
      costs: {},
      monteCarlo: { iterations: 100 },
    }),
  );
});

test("P6 plan rejects requests that disable point-in-time semantics", () => {
  assert.throws(
    () => buildBacktestEvaluationPlan({ ...request, pointInTimeRequired: false }, {
      schemaVersion: "1",
      modes: ["single_run"],
      costs: {},
    }),
    /point-in-time semantics/,
  );
});
