import assert from "node:assert/strict";
import test from "node:test";
import { calculationJobEnqueueSchema, calculationJobOwnerFromRequest } from "./calculationJobRoutes";

test("calculation job enqueue schema rejects caller-selected organization scope", () => {
  const parsed = calculationJobEnqueueSchema.safeParse({
    kind: "factor-risk-capture",
    input: { symbols: ["AAPL"] },
    organizationId: 999,
  });
  assert.equal(parsed.success, false);
});

test("calculation job owner scope comes from authenticated user identity", () => {
  const req = {
    user: {
      id: 42,
      email: "analyst@example.test",
      name: "Analyst",
      role: "internal_analyst",
      organizationId: 17,
      mustChangePassword: false,
    },
  } as never;
  assert.deepEqual(calculationJobOwnerFromRequest(req), { userId: 42, organizationId: 17 });
});

test("internal calculation jobs remain explicitly unscoped when the authenticated user has no organization", () => {
  const req = {
    user: {
      id: 43,
      email: "admin@example.test",
      name: "Admin",
      role: "internal_admin",
      organizationId: null,
      mustChangePassword: false,
    },
  } as never;
  assert.deepEqual(calculationJobOwnerFromRequest(req), { userId: 43, organizationId: null });
});
