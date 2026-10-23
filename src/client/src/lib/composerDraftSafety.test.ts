import test from "node:test";
import assert from "node:assert/strict";
import { clearSubmittedComposerDraft, mayClearComposerDraft, restoreFailedComposerDraft } from "./composerDraftSafety";

test("WS-18 ordinary successful Send clears only the submitted draft", () => {
  assert.equal(mayClearComposerDraft("Explain duration", "Explain duration", false), true);
  assert.equal(clearSubmittedComposerDraft("Explain duration", "Explain duration", "Explain duration"), "");
});

test("WS-18 newly written draft cannot be erased by delayed successful Send", () => {
  assert.equal(clearSubmittedComposerDraft("A newer question", "Old question", "Old question"), "A newer question");
});

test("WS-18 sending a previous response again does not discard an unrelated editor draft", () => {
  assert.equal(mayClearComposerDraft("Unsent next topic", "Retry earlier topic", false), false);
  assert.equal(clearSubmittedComposerDraft("Unsent next topic", "Unsent next topic", "Retry earlier topic"), "Unsent next topic");
});

test("WS-18 continuation and approval retry never automatically clear editor", () => {
  assert.equal(mayClearComposerDraft("Follow-up", "Follow-up", true), false);
  assert.equal(clearSubmittedComposerDraft("Follow-up", "Follow-up", "Prior request"), "Follow-up");
});

test("WS-18 failed normal Send restores a previously cleared editor", () => {
  assert.equal(restoreFailedComposerDraft("", "Question about spreads", "Question about spreads"), "Question about spreads");
});

test("WS-18 failed retry restores original unrelated unsent text rather than the old prompt", () => {
  assert.equal(restoreFailedComposerDraft("", "Unsent current draft", "Old message"), "Unsent current draft");
});

test("WS-18 failed request never overwrites an existing newer draft", () => {
  assert.equal(restoreFailedComposerDraft("Edited during response", "Old request", "Old request"), "Edited during response");
});

test("WS-18 draft recovery works when original draft was empty but retry failed", () => {
  assert.equal(restoreFailedComposerDraft("", "", "Retried message"), "Retried message");
});

test("WS-18 mixed whitespace and command payloads follow deliberate Send semantics", () => {
  assert.equal(mayClearComposerDraft("  /chart  ", "/chart", false), true);
  assert.equal(clearSubmittedComposerDraft("  /chart  ", "  /chart  ", "/chart"), "");
  assert.equal(restoreFailedComposerDraft("existing", "", "   "), "existing");
});
