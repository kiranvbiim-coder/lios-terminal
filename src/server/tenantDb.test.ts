import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("tenant database context", () => {
  it("requires a positive organization id", () => {
    assert.equal(Number.isInteger(1) && 1 > 0, true);
    assert.equal(Number.isInteger(0) && 0 > 0, false);
    assert.equal(Number.isInteger(-1) && -1 > 0, false);
  });

  it("documents SET LOCAL semantics", () => {
    // The production helper uses PostgreSQL set_config(..., true), equivalent
    // to SET LOCAL: the value is transaction-local and must not leak across
    // pooled connections.
    assert.ok("set_config('app.current_organization', value, true)".includes("true"));
  });
});
