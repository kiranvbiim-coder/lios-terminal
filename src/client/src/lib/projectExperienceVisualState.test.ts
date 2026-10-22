import assert from "node:assert/strict";
import test from "node:test";
import { fillStarterPrompt, findStarterPlaceholder, PROJECT_STARTER_PROMPTS, QUICK_CHAT_STARTER_PROMPTS, TEMPORARY_CHAT_STARTER_PROMPTS, starterPromptsForChatMode, resolveProjectConversationVisualIntensity } from "./projectExperienceVisualState";

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

test("Quick Chat has universal first-use prompts; specialist finance starters require explicit Project mode", () => {
  assert.deepEqual(starterPromptsForChatMode("quick"), QUICK_CHAT_STARTER_PROMPTS);
  assert.deepEqual(starterPromptsForChatMode("project"), PROJECT_STARTER_PROMPTS);
  assert.deepEqual(starterPromptsForChatMode("temporary"), TEMPORARY_CHAT_STARTER_PROMPTS);
  assert.equal(starterPromptsForChatMode("quick").length, 3);
  assert.equal(starterPromptsForChatMode("temporary").length, 3);
  assert.ok(QUICK_CHAT_STARTER_PROMPTS.every(({ prompt }) => findStarterPlaceholder(prompt) !== null));
  assert.ok(TEMPORARY_CHAT_STARTER_PROMPTS.every(({ prompt }) => findStarterPlaceholder(prompt) !== null));
  assert.ok(!QUICK_CHAT_STARTER_PROMPTS.some(({ label }) => /portfolio|valuation|ticker/i.test(label)));
  assert.ok(!TEMPORARY_CHAT_STARTER_PROMPTS.some(({ prompt }) => /attach|upload|file/i.test(prompt)),
    "Temporary Chat must not advertise persistent file uploads");
  assert.match(QUICK_CHAT_STARTER_PROMPTS[2].prompt, /after I attach it/);
  assert.match(fillStarterPrompt(QUICK_CHAT_STARTER_PROMPTS[0].prompt, "AAPL"), /\[topic\]/,
    "recent ticker is never silently inserted into an unrelated universal question");
});

test("signed-in first fold is Chat-first; a new Project and sources are optional", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const shell = fs.readFileSync(path.join(root, "components", "terminal", "ProjectExperienceShell.tsx"), "utf8");
  assert.match(shell, /starterPromptsForChatMode\(chatMode\)\.map/);
  assert.match(shell, /LiOS · Universal intelligence/);
  assert.match(shell, /LiOS · Temporary Chat/);
  assert.match(shell, /New Project \(optional\)/);
  assert.match(shell, /Regular Chats save your work automatically/);
  assert.match(shell, /Temporary Chat does not save your conversation/);
  assert.doesNotMatch(shell, /LiOS · Financial intelligence/);
  assert.match(shell, /ChatTerminalControl/);
  assert.match(shell, /firstSendChatRef\.current = created\.id/);
});

test("archiving or trashing an open Quick Chat returns to Quick Chat, never a hidden Project", async () => {
  const { resolveInitialChatMode } = await import("./projectEntry");
  assert.equal(resolveInitialChatMode({ projectId: null, chatId: null }), "quick");
  assert.equal(resolveInitialChatMode({ projectId: 77, chatId: null }), "project");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const shell = fs.readFileSync(path.join(root, "components", "terminal", "ProjectExperienceShell.tsx"), "utf8");
  const actionBody = shell.slice(shell.indexOf("const handleChatLifecycleAction"), shell.indexOf("const handleProjectLifecycleAction"));
  assert.equal((actionBody.match(/setChatMode\(resolveInitialChatMode\(\{ projectId: chat\.projectId, chatId: null \}\)\)/g) ?? []).length, 2);
  assert.doesNotMatch(actionBody, /setChatMode\("project"\)/);
});
