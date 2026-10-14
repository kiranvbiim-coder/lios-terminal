import assert from "node:assert/strict";
import test from "node:test";
import { belongsToOrganization } from "./tenantScope";

test("tenant scope admits only matching, non-null organizations", () => {
  assert.equal(belongsToOrganization(7, 7), true);
  assert.equal(belongsToOrganization(8, 7), false);
  assert.equal(belongsToOrganization(null, null), false);
  assert.equal(belongsToOrganization(7, null), false);
});
