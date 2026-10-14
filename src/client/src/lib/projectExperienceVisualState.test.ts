import assert from "node:assert/strict";
import test from "node:test";
import { fillStarterPrompt, findStarterPlaceholder, PROJECT_STARTER_PROMPTS, resolveProjectConversationVisualIntensity } from "./projectExperienceVisualState";

test("an empty Project or Quick Chat opens in the immersive orientation state", () => {
  assert.equal(resolveProjectConversationVisualIntensity({ messageCount: 0, streaming: false, busy: false }), "immersive");
});

test("conversation work recedes the environment into contextual mode", () => {
  assert.equal(resolveProjectConversationVisualIntensity({ messageCount: 1, streaming: false, busy: false }), "contextual");
  assert.equal(resolveProjectConversationVisualIntensity({ messageCount: 0, streaming: true, busy: false }), "contextual");
  assert.equal(resolveProjectConversationVisualIntensity({ messageCount: 0, streaming: false, busy: true }), "contextual");
});

test("first-use prompts expose data gaps and avoid invented inputs", () => {
  assert.equal(PROJECT_STARTER_PROMPTS.length, 3);
  assert.ok(PROJECT_STARTER_PROMPTS.every(({ prompt }) => /\[[^\]]+\]/.test(prompt)));
  assert.match(PROJECT_STARTER_PROMPTS[1].prompt, /ask me before estimating/i);
  assert.match(PROJECT_STARTER_PROMPTS[2].prompt, /ask me to select the file or source/i);
});

test("starter prompts expose their placeholder for type-over selection", () => {
  for (const starter of PROJECT_STARTER_PROMPTS) {
    const range = findStarterPlaceholder(starter.prompt);
    assert.ok(range, `${starter.id} should have a placeholder`);
    assert.match(starter.prompt.slice(range.start, range.end), /^\[.+\]$/);
  }
  assert.equal(findStarterPlaceholder("No placeholder here"), null);
});

test("starters use the user's own recent ticker, but never guess a portfolio or source", () => {
  const [research, valuation, portfolio] = PROJECT_STARTER_PROMPTS;
  assert.match(fillStarterPrompt(research.prompt, "aapl"), /^Research AAPL using available/);
  assert.match(fillStarterPrompt(valuation.prompt, "BRK.B"), /^Build a deterministic DCF for BRK\.B\./);
  // The portfolio slot is not a ticker and is never filled.
  assert.equal(fillStarterPrompt(portfolio.prompt, "AAPL"), portfolio.prompt);
  // No usable ticker leaves the placeholder for type-over.
  assert.equal(fillStarterPrompt(research.prompt, null), research.prompt);
  assert.equal(fillStarterPrompt(research.prompt, ""), research.prompt);
  assert.equal(fillStarterPrompt(research.prompt, "not a ticker!"), research.prompt);
  // A filled prompt has no placeholder to pre-select, so nothing is highlighted.
  assert.equal(findStarterPlaceholder(fillStarterPrompt(research.prompt, "AAPL")), null);
});
