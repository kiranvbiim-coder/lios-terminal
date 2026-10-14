import assert from "node:assert/strict";
import test from "node:test";
import { audienceForRole, getAudience, setAudienceFromRole, subscribeAudience } from "./audience";

test("audienceForRole maps role prefixes", () => {
  assert.equal(audienceForRole("client_admin"), "client");
  assert.equal(audienceForRole("internal_admin"), "internal");
  assert.equal(audienceForRole(null), "internal");
  assert.equal(audienceForRole(undefined), "internal");
});

test("audience store follows the session role and resets on sign-out", () => {
  assert.equal(getAudience(), "internal");
  setAudienceFromRole("client_member");
  assert.equal(getAudience(), "client");
  setAudienceFromRole(null);
  assert.equal(getAudience(), "internal");
});

test("subscribers are notified only on audience change and can unsubscribe", () => {
  let calls = 0;
  const unsubscribe = subscribeAudience(() => { calls += 1; });
  setAudienceFromRole("client_admin");
  setAudienceFromRole("client_member");
  assert.equal(calls, 1);
  unsubscribe();
  setAudienceFromRole(null);
  assert.equal(calls, 1);
});
