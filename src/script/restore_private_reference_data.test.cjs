"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { blobHash, verifyAsset, REFERENCE_ASSETS } = require("./restore_private_reference_data.cjs");

test("Git blob identity is byte sensitive", () => {
  assert.equal(blobHash(Buffer.from("hello")), "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0");
  assert.notEqual(blobHash(Buffer.from("hello")), blobHash(Buffer.from("hello\n")));
});
test("reference data verification rejects mismatched content", () => {
  const bytes = Buffer.from('[{"symbol":"AAPL"},{"symbol":"MSFT"}]');
  const metadata = { name: "fixture.json", bytes: bytes.length, blobSha: blobHash(bytes), minItems: 2, type: "array" };
  assert.equal(verifyAsset(bytes, metadata).items, 2);
  assert.throws(() => verifyAsset(bytes, { ...metadata, minItems: 3 }), /checked minimum/);
  assert.throws(() => verifyAsset(bytes, { ...metadata, type: "object" }), /unexpected data shape/);
});
test("all four original assets are pinned", () => {
  assert.equal(REFERENCE_ASSETS.length, 4);
  for (const item of REFERENCE_ASSETS) assert.match(item.blobSha, /^[a-f0-9]{40}$/);
});
