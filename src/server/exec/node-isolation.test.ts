import assert from "node:assert/strict";
import test from "node:test";
import { nodeNetworkDenyImport, nodePermissionModelFlag } from "./node-isolation";

test("node permission flag matches supported Node permission-model versions", () => {
  assert.equal(nodePermissionModelFlag("22.12.0"), "--experimental-permission");
  assert.equal(nodePermissionModelFlag("22.13.0"), "--permission");
  assert.equal(nodePermissionModelFlag("23.4.0"), "--experimental-permission");
  assert.equal(nodePermissionModelFlag("23.5.0"), "--permission");
  assert.equal(nodePermissionModelFlag("24.0.0"), "--permission");
  assert.throws(() => nodePermissionModelFlag("22.11.0"), /22\.12\.0 or newer/);
});

test("node network guard produces a data import and validates error codes", () => {
  const value = nodeNetworkDenyImport("LIOS_TEST_NETWORK_DENIED");
  assert.match(value, /^data:text\/javascript,/);
  assert.ok(decodeURIComponent(value).includes("LIOS_TEST_NETWORK_DENIED"));
  assert.throws(() => nodeNetworkDenyImport("bad code"), /uppercase identifier/);
});
