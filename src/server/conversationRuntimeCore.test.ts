import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNotAborted,
  eventBase,
  hashPayload,
  isAbortLike,
  normalizedMentionToken,
  sourceScopeAllowsExternalData,
  sourceScopeAllowsFiles,
  sourceScopeAllowsProjectData,
  userMentionTokens,
} from "./conversationRuntimeCore";

test("conversation runtime core builds stable event and payload helpers", () => {
  const event = eventBase("req-1");
  assert.equal(event.requestId, "req-1");
  assert.ok(!Number.isNaN(Date.parse(event.at)));

  assert.equal(hashPayload({ a: 1, b: "x" }), hashPayload({ a: 1, b: "x" }));
  assert.notEqual(hashPayload({ a: 1 }), hashPayload({ a: 2 }));
});

test("conversation runtime core centralizes cancellation semantics", () => {
  const controller = new AbortController();
  assert.doesNotThrow(() => assertNotAborted(controller.signal));
  controller.abort();
  assert.throws(() => assertNotAborted(controller.signal), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "AbortError");
    return true;
  });
  const timeout = new Error("timeout");
  timeout.name = "TimeoutError";
  assert.equal(isAbortLike(timeout), true);
  assert.equal(isAbortLike(new Error("other")), false);
});

test("conversation runtime core normalizes explicit resource mentions only", () => {
  assert.equal(normalizedMentionToken("  Revenue Growth  "), "revenue_growth");
  assert.equal(normalizedMentionToken("AAPL!"), "aapl");

  const tokens = userMentionTokens("Compare @AAPL with @msft and @AAPL");
  assert.deepEqual([...tokens].sort(), ["aapl", "msft"]);

  // Dots are intentionally valid inside resource identifiers (for example,
  // filenames and provider-specific handles); extraction must preserve them.
  assert.deepEqual([...userMentionTokens("Open @model.v2")], ["model.v2"]);
});

test("conversation runtime source scopes stay fail-closed by capability", () => {
  assert.equal(sourceScopeAllowsProjectData("auto"), true);
  assert.equal(sourceScopeAllowsProjectData("my_data"), true);
  assert.equal(sourceScopeAllowsProjectData("web"), false);
  assert.equal(sourceScopeAllowsProjectData("files"), false);

  assert.equal(sourceScopeAllowsFiles("auto"), true);
  assert.equal(sourceScopeAllowsFiles("my_data"), true);
  assert.equal(sourceScopeAllowsFiles("files"), true);
  assert.equal(sourceScopeAllowsFiles("web"), false);

  assert.equal(sourceScopeAllowsExternalData("auto"), true);
  assert.equal(sourceScopeAllowsExternalData("web"), true);
  assert.equal(sourceScopeAllowsExternalData("my_data"), false);
  assert.equal(sourceScopeAllowsExternalData("files"), false);
});
