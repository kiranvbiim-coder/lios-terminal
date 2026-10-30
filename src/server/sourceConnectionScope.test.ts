import assert from "node:assert/strict";
import test from "node:test";
import { assertSourceConnectionScope } from "./sourceConnectionScope";

test("P5 BYOD adapters accept only exact user and organization matches", () => {
  const owner = { userId: 17, organizationId: 3 };
  assert.doesNotThrow(() => assertSourceConnectionScope(owner, { userId: 17, organizationId: 3 }));
  assert.throws(() => assertSourceConnectionScope(owner, { userId: 18, organizationId: 3 }), /not available/);
  assert.throws(() => assertSourceConnectionScope(owner, { userId: 17, organizationId: 4 }), /not available/);
  assert.throws(() => assertSourceConnectionScope(owner, { userId: 17, organizationId: null }), /not available/);
  assert.doesNotThrow(() => assertSourceConnectionScope(
    { userId: 17, organizationId: null }, { userId: 17, organizationId: null },
  ));
});

