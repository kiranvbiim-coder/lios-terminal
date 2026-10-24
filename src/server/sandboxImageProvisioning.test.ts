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

test("Podman fallback checks its Host.OS field and permits image repair only on Linux", async t => {
  const platform = requiredSandboxReleasePlatform();
  const { root, image } = releaseFixture(t, platform);
  useReleaseEnvironment(t, root, image);
  const target = "unix:///run/user/1000/podman/podman.sock";
  process.env.LIOS_EXECUTION_SANDBOX_ENGINE = "podman";
  process.env.LIOS_EXECUTION_SANDBOX_TARGET = target;
  const invocations: string[][] = [];
  const result = await inspectSandboxImageReadiness({
    engineProbe: async (engine, address, args) => {
      assert.equal(engine, "podman");
      assert.equal(address, target);
      invocations.push([...args]);
      if (args[0] === "image") throw new Error("No such image.");
      return "linux\n";
    },
  });
  assert.equal(result.state, "image_missing");
  assert.equal(result.repairAction, "load");
  assert.deepEqual(invocations[0], ["image", "inspect", "--format", "{{.Id}} {{.Os}}/{{.Architecture}}", image]);
  assert.deepEqual(invocations[1], ["info", "--format", "{{.Host.OS}}"]);
});

test("Docker Windows-container mode and unknown OS never offer Linux image import", async t => {
  const platform = requiredSandboxReleasePlatform();
  const { root, image } = releaseFixture(t, platform);
  useReleaseEnvironment(t, root, image);
  process.env.LIOS_EXECUTION_SANDBOX_ENGINE = "docker";
  process.env.LIOS_EXECUTION_SANDBOX_TARGET = process.platform === "win32"
    ? "npipe:////./pipe/docker_engine" : "unix:///var/run/docker.sock";
  for (const os of ["windows", "unknown", "", "linux\nwindows"]) {
    const queried: string[][] = [];
    const result = await inspectSandboxImageReadiness({
      engineProbe: async (engine, _target, args) => {
        assert.equal(engine, "docker");
        queried.push([...args]);
        if (args[0] === "image") throw new Error("Image inspect failed.");
        return os;
      },
    });
    assert.equal(result.state, "incompatible", os);
    assert.equal(result.ready, false);
    assert.equal(result.repairAction, "retry");
    assert.match(result.reason, /requires an engine running Linux containers/);
    assert.deepEqual(queried[1], ["info", "--format", "{{.OSType}}"]);
  }
});

test("image inspect success requires exact digest/platform and never needs engine fallback", async t => {
  const platform = requiredSandboxReleasePlatform();
  const { root, image } = releaseFixture(t, platform);
  useReleaseEnvironment(t, root, image);
  process.env.LIOS_EXECUTION_SANDBOX_ENGINE = "docker";
  process.env.LIOS_EXECUTION_SANDBOX_TARGET = process.platform === "win32"
    ? "npipe:////./pipe/docker_engine" : "unix:///var/run/docker.sock";
  let calls = 0;
  const ready = await inspectSandboxImageReadiness({
    engineProbe: async (_engine, _target, args) => {
      calls++;
      assert.equal(args[0], "image");
      return `${image} ${platform}`;
    },
  });
  assert.equal(ready.state, "ready");
  assert.equal(ready.repairAction, "none");
  assert.equal(calls, 1);
  const mismatch = await inspectSandboxImageReadiness({
    engineProbe: async () => `${image} linux/386`,
  });
  assert.equal(mismatch.state, "integrity_failed");
  assert.equal(mismatch.ready, false);
});
