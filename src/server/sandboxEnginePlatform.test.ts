import assert from "node:assert/strict";
import test from "node:test";
import { isLinuxSandboxEngineOs, localSandboxEngineOsProbe } from "./sandboxEnginePlatform";

test("Docker and Podman use their own documented host-OS probe templates", () => {
  assert.deepEqual(localSandboxEngineOsProbe("docker"), ["info", "--format", "{{.OSType}}"]);
  assert.deepEqual(localSandboxEngineOsProbe("podman"), ["info", "--format", "{{.Host.OS}}"]);
});

test("only an explicit Linux engine OS may proceed to image import", () => {
  for (const value of ["linux", "linux\n", " linux "]) {
    assert.equal(isLinuxSandboxEngineOs(value), true);
  }
  for (const value of ["", "windows", "Windows", "unknown", "darwin", "linux\nwindows", "linux/amd64", "linux\u0000"]) {
    assert.equal(isLinuxSandboxEngineOs(value), false);
  }
});
