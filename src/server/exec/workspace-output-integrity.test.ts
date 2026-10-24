import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { matchesWorkspaceOutputDigest } from "./workspace-output-integrity";

const file = (bytes: Buffer) => ({
  data: bytes,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});

test("legitimate returned worker file passes end-consumer integrity check", () => {
  const valid = file(Buffer.from('{"ok":true,"result":100}', "utf8"));
  assert.equal(matchesWorkspaceOutputDigest(valid), true);
});

test("changed worker output bytes and substituted hashes are rejected before parsing", () => {
  const valid = file(Buffer.from('{"ok":true,"result":100}', "utf8"));
  assert.equal(matchesWorkspaceOutputDigest({ ...valid, data: Buffer.from('{"ok":true,"result":101}', "utf8") }), false);
  assert.equal(matchesWorkspaceOutputDigest({ ...valid, sha256: "0".repeat(64) }), false);
  assert.equal(matchesWorkspaceOutputDigest({ ...valid, sha256: valid.sha256.toUpperCase() }), false);
  assert.equal(matchesWorkspaceOutputDigest({ ...valid, sha256: "invalid" }), false);
});

test("empty data is covered by hash identity, not accepted based on string shape alone", () => {
  const empty = file(Buffer.alloc(0));
  assert.equal(matchesWorkspaceOutputDigest(empty), true);
  assert.equal(matchesWorkspaceOutputDigest({ ...empty, data: Buffer.from("x") }), false);
});
