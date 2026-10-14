import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";
import { hiddenEnginePackManifestV1Schema, type HiddenEnginePackManifestV1 } from "@shared/hiddenEnginePackManifest";
import {
  createP11PackArtifact,
  P11PackManager,
  validateP11PackLayout,
  verifyP11PackArtifact,
  type P11PackArtifact,
} from "./p11PackManager";

function artifact(version: string, privateKey: crypto.KeyObject): P11PackArtifact {
  const base = hiddenEnginePackManifestV1Schema.parse({
    schemaVersion: "1",
    id: "lios.portfolio",
    version,
    displayName: "Portfolio",
    visibility: "internal",
    publisher: { id: "lios.first-party", keyId: "test-key" },
    liosCore: { min: "1.0.0", maxExclusive: "2.0.0" },
    platforms: ["darwin-arm64", "win32-x64"],
    runtime: { kind: "node", version: process.version, entrypoint: "adapter/index.js", isolation: "worker" },
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
      memorySoftMb: 128,
      memoryHardMb: 256,
      cpuMaxCores: 1,
      maxConcurrency: 1,
      maxWorkers: 1,
      defaultTimeoutSec: 30,
      maxTimeoutSec: 60,
      maxDatasetMb: 128,
      idleShutdownSec: 60,
    },
    dataPlane: ["json"],
    licenses: { sbom: "sbom.cdx.json", notices: "licenses/THIRD_PARTY_NOTICES.txt" },
    integrity: {
      manifestSha256: "0".repeat(64),
      payloadSha256: "0".repeat(64),
      signature: { algorithm: "ed25519", keyId: "test-key", value: "A".repeat(88) },
    },
  });
  const manifest: HiddenEnginePackManifestV1 = base;
  return createP11PackArtifact({
    manifest,
    privateKey,
    files: {
      "adapter/index.js": "export const run = (input) => input;\n",
      "runtime/node": { bytes: "#!/usr/bin/env node\n", executable: true },
      "schemas/input.json": JSON.stringify({ type: "object" }),
      "licenses/THIRD_PARTY_NOTICES.txt": "LiOS first-party test fixture.\n",
      "sbom.cdx.json": JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", version: 1, components: [] }),
    },
  });
}

test("P11 .lios-pack layout rejects missing or traversal content", () => {
  assert.deepEqual(validateP11PackLayout([
    "manifest.json", "adapter/index.js", "runtime/node", "schemas/input.json", "licenses/THIRD_PARTY_NOTICES.txt",
    "sbom.cdx.json", "checksums.json", "signature.json",
  ]), []);
  assert.ok(validateP11PackLayout(["manifest.json", "../secret"]).length > 0);
  assert.ok(validateP11PackLayout(["manifest.json", "manifest.json"]).some((error) => /duplicate/i.test(error)));
  assert.ok(validateP11PackLayout(["manifest.json", "adapter/index.js", "Adapter/INDEX.js"]).some((error) => /collision/i.test(error)));
  assert.ok(validateP11PackLayout(["runtime/CON.txt"]).some((error) => /unsafe/i.test(error)));
});

test("P11 verifies SHA-256, allow-listed publisher, signature, platform and core compatibility before install", () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const pack = artifact("1.0.0", keys.privateKey);
  const verified = verifyP11PackArtifact(pack, {
    publisherKeys: { "test-key": keys.publicKey },
    coreVersion: "1.0.0",
    platform: "darwin-arm64",
  });
  assert.equal(verified.ok, true);
  assert.deepEqual(artifact("1.0.0", keys.privateKey).archive, pack.archive,
    "Identical signed pack inputs must produce byte-identical archives.");
  const tamperedFiles = unzipSync(pack.archive);
  tamperedFiles["adapter/index.js"] = Buffer.from("tampered");
  const tampered = { archive: zipSync(tamperedFiles) };
  assert.equal(verifyP11PackArtifact(tampered, {
    publisherKeys: { "test-key": keys.publicKey },
    coreVersion: "1.0.0",
    platform: "darwin-arm64",
  }).ok, false);
  assert.equal(verifyP11PackArtifact({ archive: zipSync({ "../outside": Buffer.from("bad") }) }, {
    publisherKeys: { "test-key": keys.publicKey },
    coreVersion: "1.0.0",
    platform: "darwin-arm64",
  }).ok, false);

  const symlinkEntries = unzipSync(pack.archive);
  const symlinkZip = Object.create(null) as Record<string, [Uint8Array, { os: number; attrs: number }]>;
  for (const [name, bytes] of Object.entries(symlinkEntries)) {
    const mode = name === "adapter/index.js" ? 0o120777 : 0o100600;
    symlinkZip[name] = [bytes, { os: 3, attrs: mode << 16 }];
  }
  assert.equal(verifyP11PackArtifact({ archive: zipSync(symlinkZip) }, {
    publisherKeys: { "test-key": keys.publicKey },
    coreVersion: "1.0.0",
    platform: "darwin-arm64",
  }).ok, false);
  assert.equal(verifyP11PackArtifact(pack, {
    publisherKeys: { "test-key": keys.publicKey },
    coreVersion: "1.0.0",
    platform: "darwin-arm64",
  }, { maxArchiveBytes: 10 }).ok, false);
});

test("P11 pack manager proves side-by-side update, health gate, rollback, deactivate and removal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p11-pack-"));
  const keys = crypto.generateKeyPairSync("ed25519");
  try {
    const manager = new P11PackManager({
      rootDir: root,
      coreVersion: "1.0.0",
      platform: "darwin-arm64",
      publisherKeys: { "test-key": keys.publicKey },
    });
    manager.installAndActivate(artifact("1.0.0", keys.privateKey));
    assert.equal(manager.inspect("lios.portfolio")?.activeVersion, "1.0.0");
    assert.throws(() => manager.installAndActivate({ archive: Buffer.from("not-a-zip") }), /verification failed/i);
    assert.equal(manager.inspect("lios.portfolio")?.activeVersion, "1.0.0");
    assert.equal(fs.readFileSync(path.join(root, "lios.portfolio", "1.0.0", "adapter", "index.js"), "utf8"), "export const run = (input) => input;\n");
    assert.ok((fs.statSync(path.join(root, "lios.portfolio", "1.0.0", "runtime", "node")).mode & 0o100) !== 0);

    manager.installAndActivate(artifact("1.1.0", keys.privateKey));
    const updated = manager.inspect("lios.portfolio")!;
    assert.equal(updated.activeVersion, "1.1.0");
    assert.equal(updated.previousActiveVersion, "1.0.0");

    const rolled = manager.rollback("lios.portfolio");
    assert.equal(rolled.activeVersion, "1.0.0");
    assert.equal(rolled.previousActiveVersion, "1.1.0");

    manager.deactivate("lios.portfolio");
    assert.equal(manager.inspect("lios.portfolio")?.activeVersion, null);
    manager.remove("lios.portfolio", "1.1.0");
    assert.deepEqual(manager.discover()[0].versions.map((row) => row.version), ["1.0.0"]);

    fs.rmSync(path.join(root, "state.json"));
    const recovered = new P11PackManager({
      rootDir: root,
      coreVersion: "1.0.0",
      platform: "darwin-arm64",
      publisherKeys: { "test-key": keys.publicKey },
    });
    assert.equal(recovered.inspect("lios.portfolio")?.activeVersion, null);
    assert.deepEqual(recovered.inspect("lios.portfolio")?.versions.map((row) => row.version), ["1.0.0"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P11 manager restores a version moved aside by an interrupted removal before reconciling state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p11-remove-recovery-"));
  const keys = crypto.generateKeyPairSync("ed25519");
  const options = {
    rootDir: root,
    coreVersion: "1.0.0",
    platform: "darwin-arm64" as const,
    publisherKeys: { "test-key": keys.publicKey },
  };
  try {
    const manager = new P11PackManager(options);
    manager.install(artifact("1.0.0", keys.privateKey));
    const versionDir = path.join(root, "lios.portfolio", "1.0.0");
    const interruptedRemoval = `${versionDir}.removing-${crypto.randomUUID()}`;
    fs.renameSync(versionDir, interruptedRemoval);

    const recovered = new P11PackManager(options);
    assert.ok(fs.existsSync(path.join(versionDir, "adapter", "index.js")));
    assert.equal(fs.existsSync(interruptedRemoval), false);
    assert.deepEqual(recovered.inspect("lios.portfolio")?.versions.map((row) => row.version), ["1.0.0"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P11 health blocks activation when an installed pack file no longer matches the signature-bound checksum index", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p11-tamper-"));
  const keys = crypto.generateKeyPairSync("ed25519");
  try {
    const manager = new P11PackManager({
      rootDir: root,
      coreVersion: "1.0.0",
      platform: "darwin-arm64",
      publisherKeys: { "test-key": keys.publicKey },
    });
    manager.install(artifact("1.0.0", keys.privateKey));
    fs.writeFileSync(path.join(root, "lios.portfolio", "1.0.0", "adapter", "index.js"), "tampered");
    assert.equal(manager.health("lios.portfolio", "1.0.0").healthy, false);
    assert.throws(() => manager.activate("lios.portfolio", "1.0.0"), /health gate/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P11 pack manager rejects symlinked roots and package directories before reading or removing files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p11-symlink-root-"));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p11-symlink-target-"));
  const keys = crypto.generateKeyPairSync("ed25519");
  const options = {
    rootDir: root,
    coreVersion: "1.0.0",
    platform: "darwin-arm64" as const,
    publisherKeys: { "test-key": keys.publicKey },
  };
  const rootAlias = path.join(root, "root-alias");
  try {
    fs.symlinkSync(external, rootAlias, process.platform === "win32" ? "junction" : "dir");
  } catch {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
    t.skip("Directory symlinks are unavailable on this runner.");
    return;
  }
  try {
    assert.throws(() => new P11PackManager({ ...options, rootDir: rootAlias }), /symbolic link/i);

    const manager = new P11PackManager(options);
    manager.install(artifact("1.0.0", keys.privateKey));
    const packageDir = path.join(root, "lios.portfolio");
    const savedPackageDir = path.join(root, "lios.portfolio-saved");
    fs.renameSync(packageDir, savedPackageDir);
    fs.mkdirSync(path.join(external, "1.0.0"));
    const sentinel = path.join(external, "1.0.0", "keep.txt");
    fs.writeFileSync(sentinel, "must remain outside the pack manager");
    try {
      fs.symlinkSync(external, packageDir, process.platform === "win32" ? "junction" : "dir");
    } catch {
      fs.renameSync(savedPackageDir, packageDir);
      t.skip("Package-directory symlinks are unavailable on this runner.");
      return;
    }
    assert.throws(() => manager.remove("lios.portfolio", "1.0.0"), /symbolic link/i);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "must remain outside the pack manager");
    fs.rmSync(packageDir, { recursive: true, force: true });
    fs.renameSync(savedPackageDir, packageDir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});
