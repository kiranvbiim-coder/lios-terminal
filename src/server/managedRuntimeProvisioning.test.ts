import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-prod-provisioning-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
const { createProductionProvisioningAuthority } = await import("./managedRuntimeProvisioning");
const { managedRuntimeRoot } = await import("./pythonRuntimeManager");
const { StrictProvisioningRequestError } = await import("./strictProvisioningAuthority");

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const request = (runtimePath: string) => ({
  runtimePath, selectedPackIds: ["core"], packageSpecs: ["numpy==0"], lockFiles: [], hashVerified: false, requireVerified: false,
});

test("production authority is derived from the current managed runtime root and cannot be redirected by the request", async () => {
  const authority = createProductionProvisioningAuthority();
  assert.equal(Object.isFrozen(authority), true);
  const outside = path.join(root, "outside", "install-1-2");
  await assert.rejects(authority.provisionManagedRuntime(request(outside)), (error: unknown) => error instanceof StrictProvisioningRequestError && error.code === "staging_path_outside_runtime_root");
  await assert.rejects(authority.provisionManagedRuntime(request(path.join(managedRuntimeRoot(), "current"))), (error: unknown) => error instanceof StrictProvisioningRequestError && error.code === "invalid_staging_path");
  assert.equal(fs.existsSync(path.dirname(outside)), false, "refusal must occur before any process or directory creation");
});

test("verified provisioning refuses to run without release lock files", async () => {
  const authority = createProductionProvisioningAuthority();
  const staging = path.join(managedRuntimeRoot(), "install-1-2");
  await assert.rejects(
    authority.provisionManagedRuntime({ ...request(staging), hashVerified: true, requireVerified: true }),
    (error: unknown) => error instanceof StrictProvisioningRequestError && error.code === "invalid_release_lock",
  );
  assert.equal(fs.existsSync(staging), false);
});
