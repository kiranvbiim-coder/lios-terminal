import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioPipelineRouteHandlers, registerScenarioPipelineRoutes } from "./scenarioPipelineRoutes";
import { ScenarioPipelineError, type ScenarioPipelineRequest } from "./scenarioPipeline";

const validRequest: ScenarioPipelineRequest = {
  scenarioId: "downside", scenarioName: "Downside case", financialDatasetSnapshotId: "00000000-0000-4000-8000-000000000001", scenarioAssumptions: { revenueGrowth: -0.1 },
  valuation: { discountRate: 0.1, terminalGrowth: 0.02, netDebt: 1, sharesOutstanding: 10 }, factorRiskSnapshotId: "factor-risk-1", portfolioWeights: { AAA: 1 }, factorShocks: { value: -0.1 },
};
function response() {
  let statusCode = 200; let body: unknown;
  return { target: { status(code: number) { statusCode = code; return this; }, json(value: unknown) { body = value; return this; } }, get status() { return statusCode; }, get body() { return body; } };
}

test("preview validates input before invoking the pipeline", async () => {
  let calls = 0;
  const handlers = createScenarioPipelineRouteHandlers({ runScenarioPipeline: async () => { calls += 1; throw new Error("must not run"); } });
  const output = response();
  await handlers.previewHandler({ body: { ...validRequest, unknown: true } } as never, output.target as never);
  assert.equal(output.status, 400);
  assert.equal(calls, 0);
});

test("preview returns exact trace and receipt calculation from injected service", async () => {
  const expected = { trace: { traceHash: "hash" }, receiptCalculation: { name: "Scenario-to-action pipeline" } } as never;
  const handlers = createScenarioPipelineRouteHandlers({ runScenarioPipeline: async () => expected });
  const output = response();
  await handlers.previewHandler({ body: validRequest } as never, output.target as never);
  assert.equal(output.status, 200);
  assert.deepEqual(output.body, expected);
});

test("preview translates missing snapshot errors to 404", async () => {
  const handlers = createScenarioPipelineRouteHandlers({ runScenarioPipeline: async () => { throw new ScenarioPipelineError(404, "Financial dataset snapshot not found."); } });
  const output = response();
  await handlers.previewHandler({ body: validRequest } as never, output.target as never);
  assert.equal(output.status, 404);
});

test("registration exposes the review-only preview endpoint", () => {
  const registrations: string[] = [];
  const app = { post(path: string) { registrations.push(path); return this; } };
  registerScenarioPipelineRoutes(app as never, { runScenarioPipeline: async () => ({}) as never });
  assert.deepEqual(registrations, ["/api/scenario-pipeline/preview"]);
});
