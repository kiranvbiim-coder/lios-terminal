"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { issueNativeDraftGrant, authorizeNativeDraftGrant } = require("./nativeDraftGrant.cjs");
const scope = { owner: "owner@example.invalid", artifactId: "artifact:11111111-1111-4111-8111-111111111111", baseVersion: 1, contentHash: "a".repeat(64) };
test("native consumption refuses unchanged old grants after signout, account switch and same-account session replacement", async () => {
  const key = crypto.randomBytes(32).toString("hex");
  const grant = issueNativeDraftGrant(key, { ...scope, sessionBinding: "b".repeat(64) });
  const input = { ...scope, grant };
  const current = await authorizeNativeDraftGrant(key, input, async () => ({ grant: issueNativeDraftGrant(key, { ...scope, sessionBinding: "b".repeat(64) }) }));
  assert.equal(current.owner, scope.owner);
  await assert.rejects(authorizeNativeDraftGrant(key, input, async () => { throw Error("Not signed in"); }), /Not signed in/);
  await assert.rejects(authorizeNativeDraftGrant(key, input, async () => ({ grant: issueNativeDraftGrant(key, { ...scope, owner: "other@example.invalid", sessionBinding: "c".repeat(64) }) })), /scope/);
  await assert.rejects(authorizeNativeDraftGrant(key, input, async () => ({ grant: issueNativeDraftGrant(key, { ...scope, sessionBinding: "c".repeat(64) }) })), /replaced desktop session/);
  let contacted = false;
  await assert.rejects(authorizeNativeDraftGrant(key, { ...input, grant: grant + "forged" }, async () => { contacted = true; return { grant }; }), /authorized/);
  assert.equal(contacted, false, "Invalid MAC must fail before live session lookup");
});
