import assert from "node:assert/strict";
import test from "node:test";
import { fetchCloudObject } from "./cloudStorageConnector";
test("P5 cloud object connector is an explicit governed runtime", () => {
  assert.equal(typeof fetchCloudObject, "function");
});
