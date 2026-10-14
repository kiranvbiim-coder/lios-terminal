import assert from "node:assert/strict";
import test from "node:test";
import { compareQuantOutputs, createQuantExperimentSchema, quantModelWorkspace, quantRunRequestSchema, QUANT_WORKSPACE_CATEGORIES } from "@shared/quantLab";
import { ADVANCED_QUANT_PATHS } from "./advancedQuantRoutes";
import { QUANT_MODEL_REGISTRY } from "./quantModelRegistry";

test("Quant Lab exposes every required A3 workspace", () => {
  assert.deepEqual(Object.keys(QUANT_WORKSPACE_CATEGORIES), ["dataset", "statistics", "econometrics", "forecasting", "risk", "portfolio", "derivatives", "backtest", "ml", "results", "registry"]);
});

test("registry-driven runtime permits only executable Python models", () => {
  const models = QUANT_MODEL_REGISTRY.filter((model) => model.engine === "python_sidecar" && model.engineEndpoint && model.status !== "planned");
  const advancedModels = models.filter((model) => model.id.startsWith("python.advanced."));
  assert.equal(advancedModels.length, ADVANCED_QUANT_PATHS.length);
  assert.ok(models.every((model) => model.engine === "python_sidecar" && model.engineEndpoint));
  assert.equal(quantModelWorkspace(models.find((model) => model.id === "python.stats.normality")!), "statistics");
  assert.equal(quantModelWorkspace(models.find((model) => model.id === "python.portfolio.max-sharpe")!), "portfolio");
  assert.equal(quantModelWorkspace(models.find((model) => model.id === "python.options.sabr-smile")!), "derivatives");
  assert.ok(models.every((model) => quantModelWorkspace(model) !== "registry"));
});

test("Phase A4 professional statistics is complete and seed-governed", () => {
  const a4Ids = [
    "python.stats.descriptive-diagnostics", "python.stats.distribution-fit", "python.stats.professional-inference",
    "python.stats.seeded-resampling", "python.stats.multiple-testing", "python.stats.multivariate-structure", "python.stats.bayesian-normal",
  ];
  const models = a4Ids.map((id) => QUANT_MODEL_REGISTRY.find((model) => model.id === id));
  assert.ok(models.every(Boolean));
  assert.ok(models.every((model) => model?.status === "validated" && model.validationLevel === "known_answer"));
  assert.deepEqual(models.filter((model) => model?.determinism === "seeded_stochastic").map((model) => model?.id), [
    "python.stats.distribution-fit", "python.stats.seeded-resampling", "python.stats.multivariate-structure", "python.stats.bayesian-normal",
  ]);
});

test("experiment and run contracts enforce resource controls", () => {
  const experiment = createQuantExperimentSchema.safeParse({ name: "Normality", workspace: "statistics", modelId: "python.stats.normality", parameters: { data: [1, 2, 3] } });
  assert.equal(experiment.success, true);
  assert.equal(createQuantExperimentSchema.safeParse({ name: "Too long", workspace: "statistics", modelId: "x", timeoutMs: 120001 }).success, false);
  assert.equal(quantRunRequestSchema.safeParse({ seed: -1 }).success, false);
});

test("run comparison reports numeric and structural differences deterministically", () => {
  const result = compareQuantOutputs({ score: 10, nested: { state: "base" } }, { score: 12, nested: { state: "stress" }, added: true });
  assert.equal(result.equal, false); assert.equal(result.changedPaths, 3);
  assert.deepEqual(result.changes.find((change) => change.path === "score"), { path: "score", left: 10, right: 12, delta: 2, deltaPct: 0.2 });
});
