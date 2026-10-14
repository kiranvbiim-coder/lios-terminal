import assert from "node:assert/strict";
import test from "node:test";
import {
  codingCheckInputSchema,
  codingConversationToolDescriptors,
} from "./coding-tools";

test("coding tools expose only bounded read/preview and once-only write/check authorities", () => {
  const byId = new Map(codingConversationToolDescriptors.map((tool) => [tool.id, tool]));
  const inspect = byId.get("lios.coding.inspect")!;
  const preview = byId.get("lios.coding.preview_patch")!;
  const apply = byId.get("lios.coding.apply_patch")!;
  const check = byId.get("lios.coding.run_check")!;

  assert.equal(inspect.permissionClass, "safe_auto");
  assert.equal(inspect.access, "read");
  assert.equal(inspect.sideEffect, "none");
  assert.equal(preview.permissionClass, "safe_auto");
  assert.equal(preview.access, "read");
  assert.equal(apply.permissionClass, "user_confirm");
  assert.equal(apply.allowProjectApproval, false);
  assert.equal(apply.sideEffect, "internal_write");
  assert.equal(apply.replaySafe, false);
  assert.equal(check.permissionClass, "user_confirm");
  assert.equal(check.allowProjectApproval, false);
  assert.equal(check.sideEffect, "internal_write");
});

test("coding patch schemas reject path escapes and credential-shaped durable plan content", () => {
  const apply = codingConversationToolDescriptors.find((tool) => tool.id === "lios.coding.apply_patch")!;
  const good = {
    workspaceSha256: "a".repeat(64),
    previewSha256: "b".repeat(64),
    changes: [{
      path: "src/index.ts",
      beforeSha256: "c".repeat(64),
      content: "export const value = 1;\n",
    }],
  };
  assert.equal(apply.inputSchema.safeParse(good).success, true);
  assert.equal(apply.inputSchema.safeParse({
    ...good,
    changes: [{ ...good.changes[0], path: "../outside.ts" }],
  }).success, false);
  assert.equal(apply.inputSchema.safeParse({
    ...good,
    changes: [{ ...good.changes[0], content: "api_key=sk-1234567890abcdef1234567890abcdef" }],
  }).success, false);
});

test("coding check input is a closed command vocabulary", () => {
  assert.equal(codingCheckInputSchema.safeParse({
    workspaceSha256: "a".repeat(64),
    check: "git-diff-check",
    targets: [],
  }).success, true);
  assert.equal(codingCheckInputSchema.safeParse({
    workspaceSha256: "a".repeat(64),
    check: "shell",
    targets: ["rm -rf /"],
  }).success, false);
  assert.equal(codingCheckInputSchema.safeParse({
    workspaceSha256: "a".repeat(64),
    check: "node-test",
    targets: ["../escape.test.ts"],
  }).success, false);
});
