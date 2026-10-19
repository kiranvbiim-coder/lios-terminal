import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectPythonRuntime } from "./pythonRuntime";
import { getProcessSupervisor } from "./exec";

test("strict inspection refuses a user-selected host interpreter without starting or mutating it", async t => {
  let launches = 0;
  t.mock.method(getProcessSupervisor(), "spawn", async () => {
    launches += 1;
    throw new Error("Unexpected host process admission.");
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-byo-inspection-"));
  const prior = process.env.LIOS_EXECUTION_ISOLATION;
  process.env.LIOS_EXECUTION_ISOLATION = "strict";
  t.after(() => { if (prior === undefined) delete process.env.LIOS_EXECUTION_ISOLATION; else process.env.LIOS_EXECUTION_ISOLATION = prior; fs.rmSync(root, { recursive: true, force: true }); });
  const directory = path.join(root, process.platform === "win32" ? "Scripts" : "bin");
  fs.mkdirSync(directory);
  const executable = path.join(directory, process.platform === "win32" ? "python.exe" : "python");
  const marker = path.join(root, "host-process-started");
  if (process.platform === "win32") fs.linkSync(process.execPath, executable);
  else fs.writeFileSync(executable, `#!/bin/sh\nprintf started > '${marker}'\nprintf '%s' '{"python":"3.13.5","packages":{}}'\n`, { mode: 0o700 });
  const result = await inspectPythonRuntime({ runtimeId: "external-path", environmentPath: root });
  assert.equal(result.state, "unavailable");
  assert.equal(result.runtimeId, "external-path");
  assert.deepEqual(result.packages, {});
  assert.equal(launches, 0);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(result.detail.includes(root), false);
  assert.deepEqual(fs.readdirSync(directory), [path.basename(executable)]);
});
