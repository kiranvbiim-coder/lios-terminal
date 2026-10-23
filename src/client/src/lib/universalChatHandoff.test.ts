import test from "node:test";
import assert from "node:assert/strict";
import { stageUniversalChatQuestion, workbenchQuestionDraft } from "./universalChatHandoff";

test("WS-15 an Ask request is a staged draft, never auto-submitted", () => {
  assert.equal(workbenchQuestionDraft(null, "research", "AAPL"), null);
  assert.equal(workbenchQuestionDraft("   ", "chart", "MSFT"), null);
  assert.equal(stageUniversalChatQuestion("An unsent note", null), "An unsent note");
});

test("WS-15 selected Workbench symbol is an explicit editable note, not an implicit source grant", () => {
  const result = workbenchQuestionDraft("Compare margins", "financialstatements", "aapl");
  assert.match(result ?? "", /Compare margins/);
  assert.match(result ?? "", /AAPL/);
  assert.match(result ?? "", /financialstatements/);
  assert.match(result ?? "", /only authorized sources/);
});

test("WS-15 unknown, oversized and malicious symbols are never attached", () => {
  const prompt = "What changed?";
  for (const invalid of ["../../secret", "SYMBOL_TOO_LONG_EXAMPLE", "<script>", "AAPL\nsecret", "a b", ""]) {
    assert.equal(workbenchQuestionDraft(prompt, "research", invalid), prompt);
  }
});

test("WS-15 preserve the unsent Chat composer and separate a Workbench question", () => {
  assert.equal(stageUniversalChatQuestion("Draft financial query", "Follow-up"), "Draft financial query\n\nFollow-up");
  assert.equal(stageUniversalChatQuestion("Draft\n", "New task"), "Draft\n\nNew task");
});

test("WS-15 return handoff retry is idempotent, no duplicate question from the same action", () => {
  assert.equal(stageUniversalChatQuestion("Draft\n\nFollow-up", "Follow-up"), "Draft\n\nFollow-up");
  assert.equal(stageUniversalChatQuestion("Follow-up", "Follow-up"), "Follow-up");
});

test("WS-15 no context or network call needed to open existing Chat", () => {
  assert.equal(workbenchQuestionDraft("Please explain", "research", null), "Please explain");
  assert.equal(stageUniversalChatQuestion("", "Please explain"), "Please explain");
  assert.equal(stageUniversalChatQuestion("  ", "Please explain"), "Please explain");
});
