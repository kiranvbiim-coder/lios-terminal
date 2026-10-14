import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { quantRunEnvelopeSchema } from "@shared/quantModelRegistry";
import {
  QUANT_ANALYTICAL_SURFACES,
  QUANT_COMPUTE_ENDPOINTS,
  QUANT_DATA_PROVIDER_SOURCES,
  QUANT_MODEL_REGISTRY,
  summarizeQuantRegistry,
} from "./quantModelRegistry";
import { runQuantTruthAudit, withheldDatasetPaths } from "./quantTruthAudit";

test("quant truth audit classifies every current engine, model export and stochastic source", () => {
  const audit = runQuantTruthAudit();
  assert.deepEqual(audit.issues, []);
  assert.equal(audit.ok, true);
  assert.equal(audit.counts.registryEntries, QUANT_MODEL_REGISTRY.length);
  assert.equal(audit.counts.quantComputeEndpoints, QUANT_COMPUTE_ENDPOINTS.length);
  const pythonHostedEndpoints = new Set(
    QUANT_MODEL_REGISTRY
      .filter((entry) => entry.engineEndpoint && entry.sourceFiles.some((file) => file.startsWith("python-service/")))
      .map((entry) => entry.engineEndpoint!),
  );
  assert.equal(audit.counts.pythonEndpoints, pythonHostedEndpoints.size);
  assert.ok(audit.counts.exportedModelFunctions > 0);
  assert.equal(audit.counts.analyticalSurfaces, Object.keys(QUANT_ANALYTICAL_SURFACES).length);
  assert.equal(audit.counts.dataProviders, Object.keys(QUANT_DATA_PROVIDER_SOURCES).length);
  assert.equal(
    audit.counts.providerSourceFiles,
    new Set(Object.values(QUANT_DATA_PROVIDER_SOURCES).flat()).size,
  );
});

test("only datasets the source manifest declares withheld are exempt from the provider-source check", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "lios-withheld-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const app = path.join(base, "src");
  fs.mkdirSync(app);
  assert.deepEqual([...withheldDatasetPaths(app)], [], "no manifest means nothing is exempt");
  fs.mkdirSync(path.join(base, "third_party"));
  fs.writeFileSync(path.join(base, "third_party", "source-distribution.json"), JSON.stringify({
    withheldDatasets: ["src/server/data/a.json", "docs/not-app.json", 7],
  }));
  assert.deepEqual([...withheldDatasetPaths(app)], ["server/data/a.json"]);
});

test("quant registry exposes limitations and a next validation action for every entry", () => {
  for (const entry of QUANT_MODEL_REGISTRY) {
    assert.ok(entry.limitations.length > 0, entry.id);
    assert.ok(entry.nextValidation.length > 0, entry.id);
  }
  const summary = summarizeQuantRegistry();
  assert.equal(summary.total, QUANT_MODEL_REGISTRY.length);
  assert.ok((summary.byProgram.quant_acceleration ?? 0) > 0);
  assert.ok((summary.byProgram.financial_modelling ?? 0) > 0);
  assert.ok((summary.byStatus.experimental ?? 0) > 0);
});

test("canonical quant run envelope requires reproducibility hashes and lineage", () => {
  const valid = quantRunEnvelopeSchema.safeParse({
    modelId: "python.portfolio.min-variance", modelVersion: "1.0.0", runId: "run-1",
    inputSnapshotHash: "a".repeat(64), outputSnapshotHash: "b".repeat(64), datasetSnapshotIds: ["prices-2026-08-24"],
    effectiveAt: "2026-08-23T00:00:00.000Z", calculatedAt: "2026-08-24T00:00:00.000Z", seed: null,
    parameters: { allowShort: false }, diagnostics: { converged: true }, warnings: [], result: { weights: [0.5, 0.5] },
  });
  assert.equal(valid.success, true);
  assert.equal(quantRunEnvelopeSchema.safeParse({ modelId: "x" }).success, false);
});
