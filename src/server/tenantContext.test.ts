import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLegacyWorkClaim,
  assertOwnedByTenant,
  ownershipScope,
  tenantContext,
} from "./tenantContext";

test("client tenant ownership is exact user plus organization", () => {
  const ctx = tenantContext({
    id: 9,
    role: "client_user",
    organizationId: 12,
  } as any);
  assert.deepEqual(ownershipScope(ctx), { ownerUserId: 9, organizationId: 12 });
  assert.doesNotThrow(() => assertOwnedByTenant(ctx, { ownerUserId: 9, organizationId: 12 }));
  assert.throws(() => assertOwnedByTenant(ctx, { ownerUserId: 10, organizationId: 12 }), /ownership boundary/);
  assert.throws(() => assertOwnedByTenant(ctx, { ownerUserId: 9, organizationId: 13 }), /ownership boundary/);
});

test("legacy local work can only be claimed by the authenticated creator", () => {
  const ctx = tenantContext({
    id: 9,
    role: "client_user",
    organizationId: 12,
  } as any);
  assert.doesNotThrow(() => assertLegacyWorkClaim(ctx, 9));
  assert.throws(() => assertLegacyWorkClaim(ctx, 10), /authenticated creator/);
});
