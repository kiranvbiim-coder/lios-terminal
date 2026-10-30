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

test("client-facing Wave D and voice routes pass the gate while authoring and signals stay internal", () => {
  assert.equal(isAuthenticatedSelfServiceRoute("GET", "/wave-d/pulse"), true);
  assert.equal(isAuthenticatedSelfServiceRoute("GET", "/wave-d/report-templates"), true);
  assert.equal(isAuthenticatedSelfServiceRoute("POST", "/voice/transcribe"), true);
  assert.equal(isAuthenticatedSelfServiceRoute("POST", "/wave-d/action-inbox/inbox:abc"), true);
  assert.equal(isAuthenticatedSelfServiceRoute("POST", "/wave-d/action-inbox/a/b"), false);
  assert.equal(isAuthenticatedSelfServiceRoute("POST", "/wave-d/pulse/cards"), false);
  assert.equal(isAuthenticatedSelfServiceRoute("DELETE", "/wave-d/pulse/cards/x"), false);
  assert.equal(isAuthenticatedSelfServiceRoute("GET", "/wave-d/briefs/other"), false);
  assert.equal(isAuthenticatedSelfServiceRoute("GET", "/wave-d/signals"), false);
  assert.equal(isAuthenticatedSelfServiceRoute("POST", "/wave-d/pulse/ask"), false);
});
