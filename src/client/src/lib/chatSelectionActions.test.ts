import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { selectionActionsForChatMode, activeObjectPromptForChatMode } from "./chatSelectionActions";

test("ordinary Quick Chat selection offers universal tools without pretending a Project exists", () => {
  const actions = selectionActionsForChatMode("quick");
  assert.deepEqual(actions.map(action => action.id), ["explain", "compare", "source", "report", "ask"]);
  assert.ok(actions.every(action => !/Project|portfolio|DCF|valuation|financial implications/i.test(action.prompt("A sample"))));
  assert.ok(actions.every(action => action.prompt("A sample").includes("“A sample”")));
  assert.match(actions.find(action => action.id === "source")!.prompt("Evidence"), /do not invent citations/i);
});

test("Temporary Chat has universal selection actions without persistent Project assumptions", () => {
  const quick = selectionActionsForChatMode("quick");
  const temporary = selectionActionsForChatMode("temporary");
  assert.deepEqual(temporary, quick);
  for (const action of temporary) assert.doesNotMatch(action.prompt("Text"), /current Project/i);
});

test("specialist finance Project Chat keeps its original full selection capabilities", () => {
  const actions = selectionActionsForChatMode("project");
  assert.deepEqual(actions.map(action => action.id), ["explain", "compare", "model", "source", "alert", "report", "ask"]);
  assert.match(actions.find(action => action.id === "model")!.prompt("ROI"), /governed Project data/);
  assert.match(actions.find(action => action.id === "alert")!.prompt("risk"), /Ask before any external action/);
});

test("asking about selection or focused object never invents a Project in a Quick/Temporary Chat", () => {
  assert.match(activeObjectPromptForChatMode("quick", "Selected words", undefined, "research"), /Selected words/);
  assert.doesNotMatch(activeObjectPromptForChatMode("quick", "Selected words", undefined, "research"), /Project/);
  assert.doesNotMatch(activeObjectPromptForChatMode("temporary", "", "AAPL", "valuation"), /Project/);
  assert.match(activeObjectPromptForChatMode("project", "", "AAPL", "valuation"), /Project context/);
  assert.match(activeObjectPromptForChatMode("project", "Selected words", undefined, "research"), /current Project context/);
});

test("selection actions are derived from the live Chat mode, not a fixed finance toolbar", () => {
  const shell = readFileSync(new URL("../components/terminal/ProjectExperienceShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /selectionActionsForChatMode\(chatMode\)\.map/);
  assert.match(shell, /activeObjectPromptForChatMode\(chatMode,/);
  assert.doesNotMatch(shell, /const SELECTION_AI_ACTIONS/);
  assert.doesNotMatch(shell, /Analyze this selection in the current Project context/);
});
