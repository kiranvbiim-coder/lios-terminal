"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { issueNativeDraftGrant, verifyNativeDraftGrant, MAX_LIFETIME_MS } = require("./nativeDraftGrant.cjs");

const secret = "a".repeat(48);
const anotherSecret = "b".repeat(48);
const now = Date.UTC(2026, 9, 22, 10, 0, 0);
const scope = {
  owner: "owner@lios.example", artifactId: "artifact:11111111-2222-4333-8444-555555555555",
  baseVersion: 4, contentHash: "b".repeat(64),
};

test("server-signed capability accepts only the exact owned Artifact revision, case-insensitive owner", () => {
  const grant = issueNativeDraftGrant(secret, scope, now);
  assert.match(grant, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(verifyNativeDraftGrant(secret, grant, { ...scope, owner: "OWNER@LIOS.EXAMPLE" }, now + 1000), scope);
  assert.throws(() => verifyNativeDraftGrant(secret, grant, { ...scope, owner: "another@lios.example" }, now + 1000), /scope/);
  assert.throws(() => verifyNativeDraftGrant(secret, grant, { ...scope, baseVersion: 3 }, now + 1000), /scope/);
  assert.throws(() => verifyNativeDraftGrant(secret, grant, { ...scope, contentHash: "c".repeat(64) }, now + 1000), /scope/);
  assert.throws(() => verifyNativeDraftGrant(secret, grant, { ...scope, artifactId: "artifact:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, now + 1000), /scope/);
});

test("renderer cannot forge native recovery by changing an email, MAC, desktop launch key or clock", () => {
  const grant = issueNativeDraftGrant(secret, scope, now);
  assert.throws(() => verifyNativeDraftGrant(anotherSecret, grant, scope, now + 1), /authorized/);
  assert.throws(() => verifyNativeDraftGrant(secret, grant + "evil", scope, now + 1), /authorized|malformed/);
  assert.throws(() => verifyNativeDraftGrant(secret, grant, scope, now + MAX_LIFETIME_MS), /expired/);
  assert.throws(() => verifyNativeDraftGrant(secret, grant, scope, now - 200), /expired/);
  assert.throws(() => verifyNativeDraftGrant(secret, "", scope, now), /malformed/);
  assert.throws(() => verifyNativeDraftGrant(secret, "abcdef.defghi", scope, now), /authorized/);
  assert.throws(() => issueNativeDraftGrant("weak", scope, now), /unavailable/);
});

test("native grant rejects dangerous path components, invalid revision identifiers and unsafe sizes", () => {
  for(const bad of [
    { ...scope, owner: "../user" },
    { ...scope, artifactId: "../../outside" },
    { ...scope, baseVersion: 0 },
    { ...scope, contentHash: "bad" },
  ]) assert.throws(() => issueNativeDraftGrant(secret, bad, now), /scope/);
  const grant=issueNativeDraftGrant(secret, scope, now);
  assert.throws(() => verifyNativeDraftGrant(secret, grant, { ...scope, owner: "owner@lios.example/../../" }, now + 1), /scope/);
});
