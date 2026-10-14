import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hiddenEnginePackManifestV1Schema,
  type HiddenEnginePackPlatform,
} from "@shared/hiddenEnginePackManifest";
import {
  createP11PackArtifact,
  P11PackManager,
  type P11PackArtifact,
} from "../server/p11PackManager";

function currentPlatform(): HiddenEnginePackPlatform {
  const value = `${process.platform}-${process.arch}`;
  const parsed = [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "win32-arm64",
    "win32-x64",
  ].find((item) => item === value);
  if (!parsed) throw new Error(`Unsupported P11 platform acceptance runner: ${value}`);
  return parsed as HiddenEnginePackPlatform;
}

function signedArtifact(
  version: string,
  platform: HiddenEnginePackPlatform,
  privateKey: crypto.KeyObject,
): P11PackArtifact {
  const base = hiddenEnginePackManifestV1Schema.parse({
    schemaVersion: "1",
    id: "lios.platform-proof",
    version,
    displayName: "LiOS Platform Proof",
    visibility: "internal",
    publisher: { id: "lios.first-party", keyId: "platform-test-key" },
    liosCore: { min: "1.0.0", maxExclusive: "2.0.0" },
    platforms: [platform],
    runtime: {
      kind: "node",
      version: process.version,
      entrypoint: "adapter/index.js",
      isolation: "worker",
    },
    capabilities: ["finance.valuation.reverse_dcf"],
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
      memorySoftMb: 64,
      memoryHardMb: 128,
      cpuMaxCores: 1,
      maxConcurrency: 1,
      maxWorkers: 1,
      defaultTimeoutSec: 30,
      maxTimeoutSec: 60,
      maxDatasetMb: 64,
      idleShutdownSec: 60,
    },
    dataPlane: ["json"],
    licenses: {
      sbom: "sbom.cdx.json",
      notices: "licenses/THIRD_PARTY_NOTICES.txt",
    },
    integrity: {
      manifestSha256: "0".repeat(64),
      payloadSha256: "0".repeat(64),
      signature: {
        algorithm: "ed25519",
        keyId: "platform-test-key",
        value: "A".repeat(88),
      },
    },
  });
  return createP11PackArtifact({
    manifest: base,
    privateKey,
    files: {
      "adapter/index.js": `export const platformProof = ${JSON.stringify(`${platform}-${version}`)};\n`,
      "runtime/engine": "LiOS platform acceptance fixture.\n",
      "schemas/input.json": JSON.stringify({ type: "object" }),
      "licenses/THIRD_PARTY_NOTICES.txt": "LiOS first-party platform fixture.\n",
      "sbom.cdx.json": JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", version: 1, components: [] }),
    },
  });
}

const platform = currentPlatform();
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p11-platform-"));
const keys = crypto.generateKeyPairSync("ed25519");

try {
  const manager = new P11PackManager({
    rootDir: root,
    coreVersion: "1.0.0",
    platform,
    publisherKeys: { "platform-test-key": keys.publicKey },
  });

  const first = signedArtifact("1.0.0", platform, keys.privateKey);
  const second = signedArtifact("1.1.0", platform, keys.privateKey);

  const installed = manager.install(first);
  assert.equal(installed.activeVersion, null);
  assert.equal(installed.versions[0]?.state, "installed_inactive");

  const health = manager.health("lios.platform-proof", "1.0.0");
  assert.equal(health.healthy, true);

  const active = manager.activate("lios.platform-proof", "1.0.0");
  assert.equal(active.activeVersion, "1.0.0");

  const updated = manager.installAndActivate(second);
  assert.equal(updated.activeVersion, "1.1.0");
  assert.equal(updated.previousActiveVersion, "1.0.0");

  const rolledBack = manager.rollback("lios.platform-proof");
  assert.equal(rolledBack.activeVersion, "1.0.0");
  assert.equal(rolledBack.previousActiveVersion, "1.1.0");

  const deactivated = manager.deactivate("lios.platform-proof");
  assert.equal(deactivated.activeVersion, null);

  manager.remove("lios.platform-proof", "1.1.0");
  manager.remove("lios.platform-proof", "1.0.0");
  assert.equal(manager.inspect("lios.platform-proof"), null);

  console.log(`P11 clean-runner lifecycle acceptance: PASS (${platform})`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
