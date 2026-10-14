import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilityRouteSchema,
  compareEngineScalars,
  compareSemver,
  engineCapabilitySchema,
  engineDataPlaneRefSchema,
  engineIntegrationDecisionSchema,
  isPackCompatible,
  lepMessageSchema,
  packCapabilityAvailabilitySchema,
  runtimePackComponentMetadataSchema,
} from "./engineFabricContracts";
import { hiddenEnginePackManifestV1Schema } from "./hiddenEnginePackManifest";

test("P11 capability grammar is frozen across approved domains", () => {
  for (const capability of [
    "finance.valuation.reverse_dcf",
    "portfolio.optimize.hrp",
    "pricing.derivatives.black_scholes",
    "risk.scenario.xva",
    "forecast.model.tournament",
    "backtest.strategy.standard",
    "research.project.search",
    "documents.sec.xbrl",
    "data.local.duckdb",
    "provider.market.history",
    "broker.execution.order",
    "reporting.export.xlsx",
    "local-ai.provider.invoke",
  ]) {
    assert.equal(engineCapabilitySchema.parse(capability), capability);
  }
  assert.throws(() => engineCapabilitySchema.parse("random.magic.run"), /prefix/i);
  assert.throws(() => engineCapabilitySchema.parse("Finance.DCF"), /lowercase/i);
});

test("P11 intake decisions are closed and do not permit adapt-later", () => {
  for (const decision of ["library", "vendor", "sidecar", "connector", "reference", "reject"]) {
    assert.equal(engineIntegrationDecisionSchema.parse(decision), decision);
  }
  assert.throws(() => engineIntegrationDecisionSchema.parse("adapt_later"));
});

test("P11 runtime pack component metadata carries version/schema/platform/provenance state", () => {
  const parsed = runtimePackComponentMetadataSchema.parse({
    packId: "lios.portfolio",
    packVersion: "1.0.0",
    adapterVersion: "1.0.0",
    inputSchemaVersion: "1",
    outputSchemaVersion: "1",
    supportedPlatforms: ["darwin-arm64", "win32-x64"],
    installState: "active",
    visibility: "internal",
    provenance: {
      decision: "library",
      upstreamRepository: "skfolio/skfolio",
      upstreamCommit: "eb73a4cfe3136d5615a6047060705695d4462588",
      license: "BSD-3-Clause",
    },
  });
  assert.equal(parsed.installState, "active");
  assert.equal(parsed.visibility, "internal");
});

test("P11 capability routes prohibit a component from being its own validator/fallback", () => {
  assert.throws(() => capabilityRouteSchema.parse({
    capability: "portfolio.optimize.hrp",
    deterministic: true,
    primary: { componentId: "engine:portfolio", packId: "lios.portfolio" },
    validator: { componentId: "engine:portfolio", packId: "lios.portfolio" },
    fallback: null,
    entitlement: null,
  }), /distinct/i);
});

test("P11 catalog availability distinguishes live, planned, deferred and policy-blocked capabilities", () => {
  const live = packCapabilityAvailabilitySchema.parse({ capability: "finance.valuation.reverse_dcf", offline: "full" });
  assert.equal(live.executionStatus, "available");
  assert.equal(packCapabilityAvailabilitySchema.parse({
    capability: "research.project.runtime",
    executionStatus: "planned",
    offline: "local_data_only",
  }).executionStatus, "planned");
  assert.equal(packCapabilityAvailabilitySchema.parse({
    capability: "data.columnar.arrow",
    executionStatus: "deferred",
    offline: "local_data_only",
  }).executionStatus, "deferred");
  assert.equal(packCapabilityAvailabilitySchema.parse({
    capability: "broker.execution.order",
    executionStatus: "policy_blocked",
    offline: "network_required",
  }).executionStatus, "policy_blocked");
});

test("P11 core compatibility is fail-closed for platform and semver range", () => {
  const base = {
    schemaVersion: "1",
    id: "lios.portfolio",
    version: "1.0.0",
    displayName: "Portfolio Engine",
    visibility: "internal",
    publisher: { id: "lios.first-party", keyId: "release" },
    liosCore: { min: "1.0.0", maxExclusive: "2.0.0" },
    platforms: ["darwin-arm64"],
    runtime: { kind: "python", version: "3.12", entrypoint: "adapter", isolation: "process" },
    capabilities: ["portfolio.optimize.hrp"],
    permissions: {
      network: { allowed: false, allowedHosts: [] },
      filesystem: { mode: "scoped_temp", roots: ["$LIOS_PACK_TEMP"] },
      secretHandles: [],
      processSpawn: false,
      gpu: false,
      externalSideEffects: false,
      brokerWrite: false,
    },
    resources: {
      memorySoftMb: 256,
      memoryHardMb: 512,
      cpuMaxCores: 2,
      maxConcurrency: 1,
      maxWorkers: 1,
      defaultTimeoutSec: 60,
      maxTimeoutSec: 120,
      maxDatasetMb: 1024,
      idleShutdownSec: 300,
    },
    dataPlane: ["parquet"],
    licenses: { sbom: "sbom.cdx.json", notices: "THIRD_PARTY_NOTICES.txt" },
    integrity: {
      manifestSha256: "a".repeat(64),
      payloadSha256: "b".repeat(64),
      signature: { algorithm: "ed25519", keyId: "release", value: "x".repeat(64) },
    },
  } as const;
  const manifest = hiddenEnginePackManifestV1Schema.parse(base);
  assert.deepEqual(isPackCompatible(manifest, "1.5.0", "darwin-arm64"), { compatible: true, reason: "compatible" });
  assert.equal(isPackCompatible(manifest, "2.0.0", "darwin-arm64").compatible, false);
  assert.equal(isPackCompatible(manifest, "1.5.0", "win32-x64").compatible, false);
  assert.equal(compareSemver("1.2.3", "1.2.4"), -1);
});

test("P11 LEP v1 validates execute/result/data-handle control messages", () => {
  const ref = engineDataPlaneRefSchema.parse({
    schemaVersion: "1",
    id: "00000000-0000-4000-8000-000000000111",
    format: "parquet",
    path: "/tmp/lios/data.parquet",
    sha256: "c".repeat(64),
    bytes: 128,
    rows: 2,
    immutable: true,
  });
  const execute = lepMessageSchema.parse({
    protocolVersion: "1",
    kind: "execute",
    requestId: "00000000-0000-4000-8000-000000000222",
    capability: "portfolio.optimize.hrp",
    executionContextRef: "project:1",
    inputSchemaVersion: "1",
    outputSchemaVersion: "1",
    dataRefs: [ref],
    input: { objective: "risk" },
    deadlineMs: 30_000,
  });
  assert.equal(execute.kind, "execute");
});

test("P11 cross-engine validation flags discrepancy and never averages engines", () => {
  const same = compareEngineScalars(100, 100.00001, { relativeTolerance: 1e-5 });
  assert.equal(same.state, "match");
  const different = compareEngineScalars(100, 105, { relativeTolerance: 1e-4, absoluteTolerance: 1e-4 });
  assert.equal(different.state, "discrepancy");
  assert.equal(different.primary, 100);
  assert.equal(different.validator, 105);
});
