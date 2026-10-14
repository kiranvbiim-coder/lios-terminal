import assert from "node:assert/strict";
import test from "node:test";
import { isAuthenticatedSelfServiceRoute } from "./apiAccessPolicy";

test("only Master AI preference reads and writes pass the global API gate for authenticated clients", () => {
  assert.equal(isAuthenticatedSelfServiceRoute("GET", "/wave-c/ai/state"), true);
  assert.equal(isAuthenticatedSelfServiceRoute("PUT", "/wave-c/ai/state"), true);
  assert.equal(isAuthenticatedSelfServiceRoute("POST", "/wave-c/ai/state"), false);
  assert.equal(isAuthenticatedSelfServiceRoute("DELETE", "/wave-c/ai/state"), false);
  assert.equal(isAuthenticatedSelfServiceRoute("POST", "/wave-c/ai/execute"), false);
  assert.equal(isAuthenticatedSelfServiceRoute("GET", "/wave-c/ai/state/other-user"), false);
});
