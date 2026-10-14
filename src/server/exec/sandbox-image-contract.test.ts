import assert from "node:assert/strict";
import test from "node:test";
import {
  SI01_SANDBOX_IMAGE_CONTRACT,
  assertImmutableBaseImage,
  assertLocalEngineTarget,
  assertLocalSandboxImageId,
  engineTargetArgument,
  sandboxImageBuildInputs,
} from "./sandbox-image-contract";
import { resolveSandboxRuntimeProfile } from "./sandbox-runtime-profile";

const digest = "a".repeat(64);
const pythonBase = `python:3.12-bookworm@sha256:${digest}`;

test("SI-01 sandbox image contract matches strict runtime default tool paths", () => {
  const profile = resolveSandboxRuntimeProfile({
    LIOS_EXECUTION_ISOLATION: "strict",
    LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
    LIOS_EXECUTION_SANDBOX_TARGET: "unix:///tmp/docker.sock",
    LIOS_EXECUTION_SANDBOX_IMAGE: `sha256:${"c".repeat(64)}`,
  });
  assert.deepEqual(profile.tools, SI01_SANDBOX_IMAGE_CONTRACT.tools);
  assert.equal(profile.user, SI01_SANDBOX_IMAGE_CONTRACT.user);
  assert.equal(SI01_SANDBOX_IMAGE_CONTRACT.browser.playwrightModule, "/opt/lios/node_modules/playwright-core");
  assert.equal(SI01_SANDBOX_IMAGE_CONTRACT.browser.chromium, "/opt/lios/browser/chromium");
});

test("mutable or digest-less base image references fail closed", () => {
  assert.throws(() => assertImmutableBaseImage("python:3.12-bookworm", "python"), /@sha256/);
  assert.throws(() => assertImmutableBaseImage(`sha256:${digest}`, "python"), /named OCI reference/);
  assert.equal(assertImmutableBaseImage(pythonBase, "python"), pythonBase);
});

test("only local unix engine targets are admitted", () => {
  assert.equal(assertLocalEngineTarget("unix:///Users/test/.colima/default/docker.sock"), "unix:///Users/test/.colima/default/docker.sock");
  assert.throws(() => assertLocalEngineTarget("tcp://127.0.0.1:2375"), /local unix/);
  assert.throws(() => assertLocalEngineTarget("https://example.invalid"), /local unix/);
});

test("build inputs preserve explicit target and use the canonical artifact lock", () => {
  const inputs = sandboxImageBuildInputs({
    LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
    LIOS_EXECUTION_SANDBOX_TARGET: "unix:///tmp/docker.sock",
  }, "lios-si01-sandbox:test");
  assert.deepEqual(inputs, {
    engine: "docker",
    engineTarget: "unix:///tmp/docker.sock",
    tag: "lios-si01-sandbox:test",
  });
  assert.equal(engineTargetArgument("docker", inputs.engineTarget), "--host=unix:///tmp/docker.sock");
  assert.equal(engineTargetArgument("podman", inputs.engineTarget), "--url=unix:///tmp/docker.sock");
});

test("runtime image output must be a local immutable image id", () => {
  const id = `sha256:${"d".repeat(64)}`;
  assert.equal(assertLocalSandboxImageId(id), id);
  assert.throws(() => assertLocalSandboxImageId("lios-si01-sandbox:test"), /sha256/);
});
