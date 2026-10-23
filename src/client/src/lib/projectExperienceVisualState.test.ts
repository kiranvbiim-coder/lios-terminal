import assert from "node:assert/strict";
import test from "node:test";
import { fillStarterPrompt, findStarterPlaceholder, resolveProjectConversationVisualIntensity, starterPromptsForChatMode } from "./projectExperienceVisualState";

test("an empty Project or Quick Chat opens in the immersive orientation state", () => {
  assert.equal(resolveProjectConversationVisualIntensity({ messageCount: 0, streaming: false, busy: false }), "immersive");
});

test("conversation work recedes the environment into contextual mode", () => {
  assert.equal(resolveProjectConversationVisualIntensity({ messageCount: 1, streaming: false, busy: false }), "contextual");
  assert.equal(resolveProjectConversationVisualIntensity({ messageCount: 0, streaming: true, busy: false }), "contextual");
  assert.equal(resolveProjectConversationVisualIntensity({ messageCount: 0, streaming: false, busy: true }), "contextual");
});


test("the first unfinished placeholder can be selected without consuming another field", () => {
  assert.deepEqual(findStarterPlaceholder("Explain [topic] using [source]."), { start: 8, end: 15 });
  assert.equal(findStarterPlaceholder("No placeholder here"), null);
  assert.equal(findStarterPlaceholder("An unfinished [topic"), null);
});

test("recent identity fills only the company slot and never guesses a file or topic", () => {
  const company = "Research [company or ticker] using sources I choose.";
  assert.equal(fillStarterPrompt(company, "brk.b"), "Research BRK.B using sources I choose.");
  const file = "Summarize [a file I choose].";
  assert.equal(fillStarterPrompt(file, "AAPL"), file);
  assert.equal(fillStarterPrompt("Explain [topic or question].", "AAPL"), "Explain [topic or question].");
  assert.equal(fillStarterPrompt(company, null), company);
  assert.equal(fillStarterPrompt(company, "not a ticker!"), company);
  assert.equal(findStarterPlaceholder(fillStarterPrompt(company, "AAPL")), null);
});

test("Temporary starters never invite retained attachments while Quick Chat retains file work and Projects retain finance", () => {
  assert.ok(starterPromptsForChatMode("quick").some(starter => starter.id === "analyze-file"));
  assert.ok(starterPromptsForChatMode("temporary").every(starter => starter.id !== "analyze-file" && !/attach|upload|valuation/i.test(starter.prompt)));
  assert.ok(starterPromptsForChatMode("project").some(starter => starter.id === "deterministic-valuation"));
  for (const mode of ["quick", "temporary"] as const) {
    for (const starter of starterPromptsForChatMode(mode)) {
      assert.equal(fillStarterPrompt(starter.prompt, "MSFT"), starter.prompt, "Ambient finance identity must not be inserted into a general starter.");
    }
  }
});
