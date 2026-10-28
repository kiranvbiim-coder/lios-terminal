import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("C05 exact source-bound claim review reuses the canonical P3 Prism to Chat composer chain", () => {
  const prism = read("../components/terminal/EvidencePrism.tsx");
  const trust = read("../components/terminal/ConversationTrustPanel.tsx");
  const chat = read("../components/terminal/ConversationRuntimeTrace.tsx");
  const projection = read("./sourceGroundedDecisionReview.ts");
  const server = read("../../../server/recordedClaimReview.ts");
  for (const token of [
    "sourceGroundedDecisionReview(manifest, claim.claimId)",
    'data-testid="c05-recorded-decision-review"',
    "onReviewDecision(decision.draft.prompt, decision.draft.binding)",
  ]) assert.ok(prism.includes(token), "Missing opt-in typed claim review: " + token);
  assert.ok(trust.includes("onReviewDecision={onReviewDecision}"));
  assert.ok(chat.includes("onReviewDecision={onFollowUp}"));
  assert.ok(chat.includes("onFollowUp?: (prompt: string, binding?: RecordedClaimReview) => void"));
  assert.ok(projection.includes("binding:{sourceRequestId:manifest.requestId,trustId:manifest.trustId,claimId}"));
  assert.ok(server.includes("listProjectChatMessages(ctx, chatId)"));
  assert.ok(server.includes("trustManifestSchema.safeParse(saved?.metadata.recordedTrustManifest)"));
  assert.ok(server.includes("parsed.data.requestId !== binding.sourceRequestId"));
  assert.ok(server.includes("parsed.data.trustId !== binding.trustId"));
  assert.ok(server.includes("item.kind !== \"ai\""));
  for(const text of [prism, trust, chat]) {
    assert.doesNotMatch(text,/autoExecuteDecision|recommendation\.execute|automaticallySendRecommendation/);
  }
});
