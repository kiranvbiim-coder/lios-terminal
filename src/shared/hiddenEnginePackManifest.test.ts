import assert from "node:assert/strict";
import test from "node:test";
import {
  LIOS_HIDDEN_ENGINE_PACK_MANIFEST_VERSION,
  hiddenEnginePackManifestV1Schema,
  parseHiddenEnginePackManifestV1,
} from "./hiddenEnginePackManifest";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function validManifest() {
  return {
    schemaVersion: LIOS_HIDDEN_ENGINE_PACK_MANIFEST_VERSION,
    id: "lios.portfolio",
    version: "1.0.0",
    displayName: "Portfolio Engine",
    visibility: "internal",
    publisher: {
      id: "lios.first-party",
      keyId: "release-2026-01",
    },
    liosCore: {
      min: "1.0.0",
      maxExclusive: "2.0.0",
    },
    platforms: ["darwin-arm64", "darwin-x64", "win32-x64"],
    runtime: {
      kind: "python",
      version: "3.12",
      entrypoint: "lios_portfolio_adapter",
      isolation: "process",
    },
    capabilities: [
      "portfolio.optimize",
      "portfolio.black_litterman",
      "portfolio.performance",
    ],
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
      memorySoftMb: 1024,
      memoryHardMb: 2048,
      cpuMaxCores: 4,
      maxConcurrency: 2,
      maxWorkers: 2,
      defaultTimeoutSec: 300,
      maxTimeoutSec: 600,
      maxDatasetMb: 4096,
      idleShutdownSec: 900,
    },
    dataPlane: ["arrow-ipc", "parquet"],
    licenses: {
      sbom: "licenses/sbom.cdx.json",
      notices: "licenses/THIRD_PARTY_NOTICES.txt",
    },
    integrity: {
      manifestSha256: HASH_A,
      payloadSha256: HASH_B,
      signature: {
        algorithm: "ed25519",
        keyId: "release-2026-01",
        value: "ZmFrZS1zaWduYXR1cmUtZm9yLWNvbnRyYWN0LXRlc3Rz",
      },
    },
  } as const;
}

test("P11-01 manifest v1 accepts the complete frozen first-party pack contract", () => {
  const parsed = parseHiddenEnginePackManifestV1(validManifest());
  assert.equal(parsed.schemaVersion, "1");
  assert.equal(parsed.visibility, "internal");
  assert.equal(parsed.runtime.kind, "python");
  assert.deepEqual(parsed.dataPlane, ["arrow-ipc", "parquet"]);
  assert.equal(parsed.resources.memoryHardMb, 2048);
});

test("P11-01 manifest v1 is strict and rejects undeclared top-level fields", () => {
  assert.throws(
    () => hiddenEnginePackManifestV1Schema.parse({ ...validManifest(), arbitraryFutureField: true }),
    /unrecognized key/i,
  );
});

test("P11-01 fails closed on duplicate platform, capability and data-plane declarations", () => {
  assert.throws(
    () => hiddenEnginePackManifestV1Schema.parse({
      ...validManifest(),
      platforms: ["darwin-arm64", "darwin-arm64"],
    }),
    /platforms must be unique/i,
  );
  assert.throws(
    () => hiddenEnginePackManifestV1Schema.parse({
      ...validManifest(),
      capabilities: ["portfolio.optimize", "portfolio.optimize"],
    }),
    /capabilities must be unique/i,
  );
  assert.throws(
    () => hiddenEnginePackManifestV1Schema.parse({
      ...validManifest(),
      dataPlane: ["arrow-ipc", "arrow-ipc"],
    }),
    /data-plane formats must be unique/i,
  );
});

test("P11-01 permission manifest rejects privilege contradictions", () => {
  assert.throws(
    () => hiddenEnginePackManifestV1Schema.parse({
      ...validManifest(),
      permissions: {
        ...validManifest().permissions,
        network: { allowed: false, allowedHosts: ["api.example.com"] },
      },
    }),
    /network access is disabled/i,
  );

  assert.throws(
    () => hiddenEnginePackManifestV1Schema.parse({
      ...validManifest(),
      permissions: {
        ...validManifest().permissions,
        brokerWrite: true,
        externalSideEffects: false,
      },
    }),
    /implies external side effects/i,
  );
});

test("P11-01 resource budgets reject unsafe internal contradictions", () => {
  assert.throws(
    () => hiddenEnginePackManifestV1Schema.parse({
      ...validManifest(),
      resources: {
        ...validManifest().resources,
        memorySoftMb: 4096,
        memoryHardMb: 2048,
      },
    }),
    /memoryHardMb/i,
  );

  assert.throws(
    () => hiddenEnginePackManifestV1Schema.parse({
      ...validManifest(),
      resources: {
        ...validManifest().resources,
        defaultTimeoutSec: 600,
        maxTimeoutSec: 300,
      },
    }),
    /maxTimeoutSec/i,
  );

  assert.throws(
    () => hiddenEnginePackManifestV1Schema.parse({
      ...validManifest(),
      resources: {
        ...validManifest().resources,
        maxConcurrency: 1,
        maxWorkers: 2,
      },
    }),
    /maxWorkers/i,
  );
});

test("P11-01 integrity metadata requires SHA-256 and Ed25519 signature metadata", () => {
  assert.throws(
    () => hiddenEnginePackManifestV1Schema.parse({
      ...validManifest(),
      integrity: {
        ...validManifest().integrity,
        manifestSha256: "not-a-hash",
      },
    }),
    /sha-256/i,
  );

  assert.throws(
    () => hiddenEnginePackManifestV1Schema.parse({
      ...validManifest(),
      integrity: {
        ...validManifest().integrity,
        signature: {
          ...validManifest().integrity.signature,
          algorithm: "rsa",
        },
      },
    }),
  );
});

test("P11-01 only permits explicitly supported in-process runtime kinds", () => {
  assert.throws(
    () => hiddenEnginePackManifestV1Schema.parse({
      ...validManifest(),
      runtime: {
        ...validManifest().runtime,
        kind: "python",
        isolation: "in_process",
      },
    }),
    /Node or WASM packs/i,
  );
});
