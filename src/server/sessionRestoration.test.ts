import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionRestoration } from "./sessionRestoration";

const user = {
  id: 11,
  email: "restore@example.com",
  name: "Restore User",
  role: "client_user" as const,
  organizationId: 17,
};

test("startup restoration distinguishes signed-out, online and offline sessions", () => {
  assert.equal(resolveSessionRestoration({ authenticated: false }).state, "signed_out");
  assert.equal(resolveSessionRestoration({ authenticated: true, user }).state, "authenticated_online");
  const offline = resolveSessionRestoration({ authenticated: true, user, offline: true });
  assert.equal(offline.state, "authenticated_offline");
  assert.equal(offline.reason, "offline_lease_authorized");
});

test("revocation and force-reauth cannot restore as an authenticated usable state", () => {
  assert.equal(resolveSessionRestoration({ authenticated: true, user, revoked: true }).state, "revoked");
  assert.equal(resolveSessionRestoration({ authenticated: true, user, forceReauth: true }).state, "reauth_required");
});
