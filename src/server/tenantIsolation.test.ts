import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requireRequestHierarchy } from "./tenantIntegrity";

// requireEngagementInOrganization/requireWorkstreamInEngagement (tenantIntegrity.ts)
// query getDb() directly and take no injectable db parameter, so their
// cross-tenant rejection behavior can only be verified against a real
// database -- see rlsLiveAttackPlan.test.ts, which already documents the
// fail-closed cases that suite must cover. This file sticks to the one
// invariant in the hierarchy check that is genuinely DB-free.
describe("LIOS tenant isolation attack matrix", () => {
  it("rejects a workstream supplied without its engagement, before any database lookup", async () => {
    await assert.rejects(
      requireRequestHierarchy({ organizationId: 1, workstreamId: 20 }),
      /A workstream requires an engagement\./,
    );
  });
});
