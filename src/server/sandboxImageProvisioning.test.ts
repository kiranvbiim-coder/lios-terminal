import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  inspectSandboxImageReadiness,
  requireSandboxReleasePlatform,
  requiredSandboxReleasePlatform,
} from "./sandboxImageProvisioning";

const SHA = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");

function releaseFixture(t: TestContext, releasePlatform: "linux/arm64" | "linux/amd64") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-sandbox-arch-repair-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "sandbox-image-dist");
  fs.mkdirSync(directory);
  const image = "sha256:" + "b".repeat(64);
  const archive = Buffer.from("image-test-fixture-not-an-actual-OCI-archive");
  fs.writeFileSync(path.join(directory, "sandbox-image.tar.gz"), archive);
  const browserInventory = Buffer.from("[]");
  for (const name of ["browser-artifact-inventory.json", "browser-dependency-inventory.json"]) {
    fs.writeFileSync(path.join(directory, name), browserInventory);
  }
  const baseImage = { reference: "python@sha256:" + "a".repeat(64), platform: releasePlatform };
  const browser = {
    playwrightVersion: "1.63.0",
    chromiumRevision: "1243",
    browserVersion: "153.0.8010.12",
    modulePath: "/opt/lios/node_modules/playwright-core",
    executablePath: "/opt/lios/browser/chromium",
    qualification: "qualified",
    artifactInventory: { file: "browser-artifact-inventory.json", sha256: SHA(browserInventory) },
    dependencyInventory: { file: "browser-dependency-inventory.json", sha256: SHA(browserInventory) },
  };
  const lock = {
    schemaVersion: 1, releaseStatus: "ready", acceptedPlatforms: [releasePlatform],
    verifiedImageId: image, provenance: { verified: true },
    baseImage, node: { version: "22.12.0" }, xlsx: { version: "0.20.3" },
    docling: { version: "2.129.0" }, browser,
  };
  const lockBytes = Buffer.from(JSON.stringify(lock));
  fs.writeFileSync(path.join(directory, "source-lock.json"), lockBytes);
  const release = {
    schemaVersion: 1, platform: releasePlatform, image,
    archive: "sandbox-image.tar.gz", archiveSha256: SHA(archive),
    provenance: {
      sourceLock: "source-lock.json", sourceLockSha256: SHA(lockBytes),
      baseImage, node: lock.node, xlsx: lock.xlsx, docling: lock.docling, browser,
    },
  };
  fs.writeFileSync(path.join(directory, "sandbox-image.json"), JSON.stringify(release));
  return { root, image };
}

function useReleaseEnvironment(t: TestContext, resourcesPath: string, image: string) {
  const variables = [
    "ELECTRON_RESOURCES_PATH",
    "LIOS_EXECUTION_ISOLATION",
    "LIOS_EXECUTION_SANDBOX_IMAGE",
    "LIOS_EXECUTION_SANDBOX_ENGINE",
    "LIOS_EXECUTION_SANDBOX_TARGET",
  ] as const;
  const previous = variables.map(name => [name, process.env[name]] as const);
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  process.env.ELECTRON_RESOURCES_PATH = resourcesPath;
  process.env.LIOS_EXECUTION_ISOLATION = "strict";
  process.env.LIOS_EXECUTION_SANDBOX_IMAGE = image;
  // Keep engine unavailable: never run a real container or import a fixture archive.
  delete process.env.LIOS_EXECUTION_SANDBOX_ENGINE;
  delete process.env.LIOS_EXECUTION_SANDBOX_TARGET;
}

test("repair host architecture mapping matches supported desktop OCI platforms", () => {
  for (const host of ["win32", "darwin", "linux"] as const) {
    assert.equal(requiredSandboxReleasePlatform(host, "arm64"), "linux/arm64");
    assert.equal(requiredSandboxReleasePlatform(host, "x64"), "linux/amd64");
    assert.doesNotThrow(() => requireSandboxReleasePlatform("linux/arm64", host, "arm64"));
    assert.doesNotThrow(() => requireSandboxReleasePlatform("linux/amd64", host, "x64"));
    assert.throws(() => requireSandboxReleasePlatform("linux/arm64", host, "x64"), /expected linux\/amd64/);
    assert.throws(() => requireSandboxReleasePlatform("linux/amd64", host, "arm64"), /expected linux\/arm64/);
  }
  assert.throws(() => requiredSandboxReleasePlatform("freebsd", "x64"), /unsupported/);
  assert.throws(() => requiredSandboxReleasePlatform("win32", "ia32"), /unsupported/);
});

test("platform-compatible packaged release reaches strict engine readiness on the actual host", async t => {
  const hostPlatform = requiredSandboxReleasePlatform();
  const { root, image } = releaseFixture(t, hostPlatform);
  useReleaseEnvironment(t, root, image);
  const status = await inspectSandboxImageReadiness();
  assert.equal(status.image, image);
  assert.equal(status.state, "engine_unavailable");
  assert.equal(status.ready, false);
  assert.equal(status.repairAction, "install_engine");
});

test("different architecture cannot be repaired even with internally self-consistent signed-fixture metadata", async t => {
  const hostPlatform = requiredSandboxReleasePlatform();
  const wrongPlatform = hostPlatform === "linux/arm64" ? "linux/amd64" : "linux/arm64";
  const { root, image } = releaseFixture(t, wrongPlatform);
  useReleaseEnvironment(t, root, image);
  const status = await inspectSandboxImageReadiness();
  assert.equal(status.state, "integrity_failed");
  assert.equal(status.ready, false);
  assert.match(status.reason, /expected linux\/(?:arm64|amd64).*found linux\/(?:arm64|amd64)/);
  assert.equal(status.repairAction, "reinstall_app");
});
