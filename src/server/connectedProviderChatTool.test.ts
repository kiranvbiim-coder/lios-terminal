import assert from "node:assert/strict";
import test from "node:test";
import {
  connectedProviderListChatTool,
  connectedProviderPreviewChatTool,
  reviewedChatReleaseRights,
  safePreviewRows,
  sourceAllowedForChat,
} from "./connectedProviderChatTool";

test("P5 Chat: source discovery is read-only while retrieval needs exact user confirmation", () => {
  assert.equal(connectedProviderListChatTool.id, "lios.provider.connected_sources");
  assert.equal(connectedProviderListChatTool.permissionClass, "safe_auto");
  assert.equal(connectedProviderListChatTool.access, "read");
  assert.equal(connectedProviderPreviewChatTool.permissionClass, "user_confirm");
  assert.equal(connectedProviderPreviewChatTool.access, "write", "remote POST-capable connectors must use external-side-effect classification");
  assert.equal(connectedProviderPreviewChatTool.allowProjectApproval, false);
  assert.equal(connectedProviderPreviewChatTool.replaySafe, false);
  assert.equal(connectedProviderPreviewChatTool.sideEffect, "external");
  assert.equal(connectedProviderPreviewChatTool.inputSchema.safeParse({
    connectionId: 9, entityRef: "my-saved-data", capability: "provider_extension",
  }).success, true);
  assert.equal(connectedProviderPreviewChatTool.inputSchema.safeParse({
    connectionId: 9, entityRef: "my-saved-data", query: "DROP TABLE users",
  }).success, false, "an AI cannot supply arbitrary SQL or endpoint parameters");
});

test("P5 Chat: unverified, denied, or out-of-allowed-source connectors never enter Chat", () => {
  const source = { id: 17, status: "healthy" as const };
  assert.equal(sourceAllowedForChat(source, null), true);
  assert.equal(sourceAllowedForChat({ id: 17, status: "configured" }, null), false);
  assert.equal(sourceAllowedForChat({ id: 17, status: "invalid" }, null), false);
  assert.equal(sourceAllowedForChat(source, { providerDeny: ["source:17"] }), false);
  assert.equal(sourceAllowedForChat(source, { providerAllow: ["source:18"] }), false);
  assert.equal(sourceAllowedForChat(source, { mode: "only_refs", allowedSourceRefs: [] }), false);
  assert.equal(sourceAllowedForChat(source, { mode: "only_refs", allowedSourceRefs: ["source-connection:18"] }), false);
  assert.equal(sourceAllowedForChat(source, { mode: "only_refs", allowedSourceRefs: ["source-connection:17"] }), true);
});

test("P5 Chat: unreviewed, internal-only, restricted and unclear data rights fail closed", () => {
  const rights = { dataRights: { internalUse: "permitted", redistribution: "permitted" }, apiTerms: { reviewed: true } };
  assert.equal(reviewedChatReleaseRights(null, "file"), false);
  assert.equal(reviewedChatReleaseRights({ ...rights, dataRights: { ...rights.dataRights, internalUse: "unknown" } }, "file"), false);
  assert.equal(reviewedChatReleaseRights({ ...rights, dataRights: { ...rights.dataRights, redistribution: "restricted" } }, "file"), false);
  assert.equal(reviewedChatReleaseRights({ ...rights, apiTerms: { reviewed: false } }, "private_api"), false);
  assert.equal(reviewedChatReleaseRights(rights, "file"), true);
  assert.equal(reviewedChatReleaseRights(rights, "private_api"), true);
});

test("P5 Chat: sample records are bounded, redact credential fields and URLs, and hide nested data", () => {
  const records = { rows: Array.from({ length: 25 }, (_, i) => ({
    value: i,
    api_key: "very-secret",
    nested: { password: "hidden" },
    sourceUrl: "https://vendor.example/data?token=long-secret",
    plain: "observed",
    notes: "x".repeat(1000),
  })) };
  const preview = safePreviewRows(records, 10);
  assert.equal(preview.length, 10);
  assert.equal(preview[0].value, 0);
  assert.equal(preview[0].api_key, "[REDACTED]");
  assert.equal(preview[0].nested, "[nested value withheld]");
  assert.equal(preview[0].sourceUrl, "[REDACTED]");
  assert.equal(preview[0].plain, "observed");
  assert.equal((preview[0].notes as string).length, 500);
  assert.deepEqual(safePreviewRows({ objects: [{ value: "not rows" }] }, 5), []);
});

