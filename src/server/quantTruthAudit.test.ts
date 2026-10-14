import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { quantRunEnvelopeSchema } from "@shared/quantModelRegistry";
import {
  QUANT_ANALYTICAL_SURFACES,
  QUANT_COMPUTE_ENDPOINTS,
  QUANT_DATA_PROVIDER_SOURCES,
  QUANT_MODEL_REGISTRY,
  summarizeQuantRegistry,
} from "./quantModelRegistry";
import { runQuantTruthAudit } from "./quantTruthAudit";

test("quant truth audit classifies every current engine, model export and stochastic source", () => {
  const audit = runQuantTruthAudit();

  // Public source CI deliberately does not redistribute the CoinGecko symbol
  // catalog. Preserve a real audit failure for its absence, rather than
  // inventing catalog rows or weakening the actual audit/release command.
  const repositoryRoot = path.resolve(process.cwd(), "..");
  const distribution = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, "third_party/source-distribution.json"), "utf8",
  )) as { distribution: string; withheldDatasets: string[] };
  assert.equal(distribution.distribution, "sanitized_proprietary_source_only");
  assert.ok(distribution.withheldDatasets.includes("src/server/data/crypto_coingecko_ids.json"));

  const missingProviderSources = Object.entries(QUANT_DATA_PROVIDER_SOURCES).flatMap(
    ([provider, sources]) => sources
      .filter((relative) => !fs.existsSync(path.join(process.cwd(), relative)))
      .map((relative) => ({ provider, relative })),
  );
  assert.deepEqual(missingProviderSources, [
    { provider: "CoinGecko", relative: "server/data/crypto_coingecko_ids.json" },
  ], "No other registered provider source may be missing");

  const expectedIssues = missingProviderSources.map(
    ({ provider, relative }) => `Registered provider source is missing: ${provider} (${relative})`,
  );
  assert.deepEqual(audit.issues, expectedIssues);
  assert.equal(audit.ok, false, "Withheld provider data is not a successful quant audit");
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
