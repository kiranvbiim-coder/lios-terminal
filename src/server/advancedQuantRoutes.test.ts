import test from "node:test";
import assert from "node:assert/strict";
import { quantModelWorkspace } from "@shared/quantLab";
import {
  ADVANCED_QUANT_PATHS,
  advancedQuantCatalog,
  advancedQuantReceiptHeaders,
  advancedQuantRunResponse,
  buildAdvancedQuantRunReceipt,
  isAdvancedQuantPath,
  parseAdvancedQuantRunRequest,
} from "./advancedQuantRoutes";
import { ADVANCED_QUANT_REGISTRY } from "./advancedQuantRegistry";
import { ADVANCED_QUANT_DEPTH2_REGISTRY } from "./advancedQuantRegistryDepth2";
import { QUANT_MODEL_REGISTRY } from "./quantModelRegistry";

const ALL_ADVANCED = [...ADVANCED_QUANT_REGISTRY, ...ADVANCED_QUANT_DEPTH2_REGISTRY];

test("advanced quant path allowlist is exact, unique and catalogued", () => {
  assert.equal(ADVANCED_QUANT_PATHS.length, 85);
  assert.equal(new Set(ADVANCED_QUANT_PATHS).size, ADVANCED_QUANT_PATHS.length);
  const catalog = advancedQuantCatalog();
  assert.equal(catalog.count, 85);
  assert.equal(catalog.aiCalculates, false);
  assert.equal(catalog.computeBoundary, "python-pydantic");
  assert.ok(catalog.families.valuation?.includes("probabilistic-dcf"));
  assert.ok(catalog.families.valuation?.includes("dcf-sensitivity"));
  assert.ok(catalog.families.valuation?.includes("project-finance"));
  assert.ok(catalog.families.derivatives?.includes("local-volatility"));
  assert.ok(catalog.families.portfolio?.includes("black-litterman"));
  assert.ok(catalog.families.decision?.includes("scenario-graph"));
  assert.ok(catalog.families["supply-chain"]?.includes("facility-location"));
});

test("advanced quant path guard rejects arbitrary sidecar paths", () => {
  assert.equal(isAdvancedQuantPath("valuation/probabilistic-dcf"), true);
  assert.equal(isAdvancedQuantPath("valuation/project-finance"), true);
  assert.equal(isAdvancedQuantPath("../../admin/secrets"), false);
  assert.equal(isAdvancedQuantPath("valuation/not-a-real-model"), false);
  assert.equal(isAdvancedQuantPath(""), false);
});

test("every allowlisted advanced route has exactly one registry entry", () => {
  assert.equal(ALL_ADVANCED.length, ADVANCED_QUANT_PATHS.length);
  const byEndpoint = new Map(ALL_ADVANCED.map((entry) => [entry.apiEndpoint, entry]));
  assert.equal(byEndpoint.size, ALL_ADVANCED.length);
  for (const path of ADVANCED_QUANT_PATHS) {
    const endpoint = `/api/quant/advanced/${path}`;
    const entry = byEndpoint.get(endpoint);
    assert.ok(entry, `missing registry entry for ${endpoint}`);
    assert.equal(entry.engineEndpoint, `/advanced/${path}`);
    assert.equal(entry.engine, "python_sidecar");
    assert.equal(entry.status, "implemented");
    assert.ok(entry.sourceFiles.some((file) => file.startsWith("python-service/")));
  }
});

test("global quant registry composes base and both advanced waves without duplicate ids", () => {
  const ids = QUANT_MODEL_REGISTRY.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of ALL_ADVANCED) assert.ok(ids.includes(entry.id));
});

test("all advanced models map to usable Quant Lab workspaces", () => {
  for (const entry of ALL_ADVANCED) {
    const workspace = quantModelWorkspace(entry);
    assert.notEqual(workspace, "registry", `${entry.id} fell back to registry-only workspace`);
  }
  assert.equal(quantModelWorkspace(ALL_ADVANCED.find((e) => e.category === "valuation")!), "results");
  assert.equal(quantModelWorkspace(ALL_ADVANCED.find((e) => e.category === "credit_risk")!), "risk");
  assert.equal(quantModelWorkspace(ALL_ADVANCED.find((e) => e.category === "fixed_income")!), "derivatives");
  assert.equal(quantModelWorkspace(ALL_ADVANCED.find((e) => e.category === "macro")!), "econometrics");
});

test("seeded stochastic advanced models declare stochastic determinism", () => {
  const stochasticPaths = [
    "derivatives/exotic-monte-carlo",
    "valuation/probabilistic-dcf",
    "credit/creditmetrics",
    "forecasting/probabilistic-ar1",
    "risk/tail-report",
    "supply-chain/disruption-simulation",
  ];
  for (const path of stochasticPaths) {
    const entry = ALL_ADVANCED.find((item) => item.engineEndpoint === `/advanced/${path}`);
    assert.ok(entry, `missing stochastic entry ${path}`);
    assert.equal(entry.determinism, "seeded_stochastic");
  }
});

const SOURCE_BINDING = {
  contractFamily: "market_data",
  field: "observations",
  connectorId: "market_snapshot_connector",
  provider: "Example Market Provider",
  priority: "primary" as const,
  sourceReference: "provider://market-snapshots/2026-08-30",
  asOf: "2026-08-30T12:00:00.000Z",
  retrievedAt: "2026-08-30T12:01:00.000Z",
  freshness: "current",
  snapshot: { id: "market-snapshot-20260830", contentHash: "b".repeat(64) },
  transformations: ["validated provider snapshot"],
};

test("legacy advanced consumers retain sidecar result fields at the response root with a receipt", () => {
  const parsed = parseAdvancedQuantRunRequest({ iterations: 25 });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  const registryEntry = QUANT_MODEL_REGISTRY.find((entry) => entry.apiEndpoint === "/api/quant/advanced/valuation/reverse-dcf");
  assert.ok(registryEntry);
  const result = { convergence: "complete" };
  const receipt = buildAdvancedQuantRunReceipt({
    path: "valuation/reverse-dcf",
    registryEntry,
    parameters: parsed.data.parameters,
    inputProvenance: parsed.data.inputProvenance,
    result,
    runId: "aqr_test_receipt",
    calculatedAt: "2026-08-30T12:02:00.000Z",
  });
  const response = advancedQuantRunResponse(result, receipt);
  const headers = advancedQuantReceiptHeaders(receipt);
  assert.equal(response.convergence, "complete");
  assert.equal(response.receipt.dataClassification, "manual");
  assert.equal(response.receipt.inputProvenance.declaration, "legacy_default");
  assert.equal(headers["X-LIOS-Model-Path"], response.receipt.modelPath);
  assert.equal(headers["X-LIOS-Input-Hash"], response.receipt.inputSnapshotHash);
  assert.equal(headers["X-LIOS-Output-Hash"], response.receipt.outputSnapshotHash);
});

test("corrected numerical receipts cannot collide with the prior calculation revision", () => {
  const parsed = parseAdvancedQuantRunRequest({ currentRevenue: 100, reinvestmentPctOfRevenue: 10 });
  assert.ok(parsed.success);
  for (const modelPath of ["valuation/probabilistic-dcf", "valuation/reverse-dcf", "valuation/expectation-surface", "derivatives/black-scholes-greeks", "derivatives/portfolio-greeks"] as const) {
    const registryEntry = QUANT_MODEL_REGISTRY.find((entry) => entry.apiEndpoint === `/api/quant/advanced/${modelPath}`);
    assert.ok(registryEntry);
    const input = {
      path: modelPath,
      parameters: parsed.data.parameters,
      inputProvenance: parsed.data.inputProvenance,
      result: { valuePerShare: 10 },
    };
    const current = buildAdvancedQuantRunReceipt({ ...input, registryEntry });
    const prior = buildAdvancedQuantRunReceipt({ ...input, registryEntry: { ...registryEntry, version: "1.0.0" } });
    assert.notEqual(current.modelVersion, prior.modelVersion);
    assert.notEqual(current.inputSnapshotHash, prior.inputSnapshotHash);
  }
});

test("advanced route receipts preserve explicit source-bound and synthetic classifications", () => {
  const registryEntry = QUANT_MODEL_REGISTRY.find((entry) => entry.apiEndpoint === "/api/quant/advanced/valuation/reverse-dcf");
  assert.ok(registryEntry);
  for (const dataClassification of ["live", "cached"] as const) {
    const parsed = parseAdvancedQuantRunRequest({
      iterations: 25,
      inputProvenance: {
        dataClassification,
        sourceBindings: [{ ...SOURCE_BINDING, freshness: dataClassification === "live" ? "current" : "cached" }],
        transformations: ["model input normalization"],
      },
    });
    assert.equal(parsed.success, true, dataClassification);
    if (!parsed.success) continue;
    const receipt = buildAdvancedQuantRunReceipt({
      path: "valuation/reverse-dcf",
      registryEntry,
      parameters: parsed.data.parameters,
      inputProvenance: parsed.data.inputProvenance,
      result: { convergence: "complete" },
      runId: `aqr_${dataClassification}`,
      calculatedAt: "2026-08-30T12:02:00.000Z",
    });
    assert.equal(receipt.dataClassification, dataClassification);
    assert.deepEqual(receipt.datasetSnapshotIds, [SOURCE_BINDING.snapshot.id]);
  }

  const synthetic = parseAdvancedQuantRunRequest({
    trials: 100,
    inputProvenance: {
      dataClassification: "synthetic",
      syntheticContext: "experiment",
      transformations: ["generated experiment input"],
    },
  });
  assert.equal(synthetic.success, true);
  if (!synthetic.success) return;
  const receipt = buildAdvancedQuantRunReceipt({
    path: "valuation/reverse-dcf",
    registryEntry,
    parameters: synthetic.data.parameters,
    inputProvenance: synthetic.data.inputProvenance,
    result: { convergence: "complete" },
    runId: "aqr_synthetic",
    calculatedAt: "2026-08-30T12:02:00.000Z",
  });
  assert.equal(receipt.dataClassification, "synthetic");
  assert.equal(advancedQuantRunResponse(receipt.result, receipt).receipt.dataClassification, "synthetic");
});

test("advanced route rejects live provenance without source lineage before engine dispatch", () => {
  const parsed = parseAdvancedQuantRunRequest({
    iterations: 25,
    inputProvenance: { dataClassification: "live", transformations: [] },
  });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.match(parsed.error.message, /Source-bound classifications require at least one source binding/);
});

test("DCF sensitivity is the only newly promoted advanced valuation known-answer entry", () => {
  const entry = ADVANCED_QUANT_REGISTRY.find((item) => item.engineEndpoint === "/advanced/valuation/dcf-sensitivity");
  assert.ok(entry);
  assert.equal(entry.validationLevel, "known_answer");
  assert.equal(entry.determinism, "deterministic");
  assert.ok(entry.sourceFiles.includes("python-service/fixtures/dcf_sensitivity_known_answers.json"));
  assert.ok(entry.sourceFiles.includes("python-service/test_dcf_sensitivity_known_answers.py"));
  const otherValuation = ALL_ADVANCED.filter((item) => item.category === "valuation" && item !== entry);
  assert.equal(otherValuation.every((item) => item.validationLevel !== "known_answer"), true);
});
