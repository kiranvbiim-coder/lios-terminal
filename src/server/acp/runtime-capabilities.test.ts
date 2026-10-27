import assert from "node:assert/strict";
import test from "node:test";
import { inspectCodingRuntimeCapabilities } from "./runtime-capabilities";

test("read-only ACP inventory works with the production CommonJS-safe default resolver", async () => {
  const result = await inspectCodingRuntimeCapabilities({ PATH: "" }, process.platform);
  assert.equal(result.installations.length, 4);
  assert.equal(result.governedCodingAvailable, false);
  assert.equal(result.protocolVerified, false);
  assert.ok(result.reason === "runtime_not_installed" || result.reason === "governed_transport_unavailable");
});

test("a missing runtime never becomes a verified coding execution capability", async () => {
  const result = await inspectCodingRuntimeCapabilities({ PATH: "" }, process.platform,
    () => { throw new Error("not installed"); });
  assert.equal(result.acpxRuntimeModuleInstalled, false);
  assert.equal(result.reason, "runtime_not_installed");
  assert.equal(result.governedCodingAvailable, false);
  assert.deepEqual(result.controls, []);
});
