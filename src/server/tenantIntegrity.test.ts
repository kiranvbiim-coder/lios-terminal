import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TenantIntegrityError, requireRequestHierarchy } from "./tenantIntegrity";

// These tests focus on invariant semantics. Database-backed integration tests
// should run against the test Postgres/PGlite fixture in the CI security suite.
describe("tenant integrity", () => {
  it("rejects a workstream without an engagement", async () => {
    await assert.rejects(requireRequestHierarchy({ organizationId: 1, workstreamId: 20 }), TenantIntegrityError);
  });

  it("exposes a stable 403 error type for ownership violations", () => {
    const error = new TenantIntegrityError("cross tenant");
    assert.equal(error.statusCode, 403);
    assert.equal(error.name, "TenantIntegrityError");
  });
});
