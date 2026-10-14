import assert from "node:assert/strict";
import test from "node:test";
import { parseProjectWorkspaceDirectives } from "./projectWorkspaceDirectives";

test("Project chat workspace directives are hidden from visible prose and normalized into safe actions", () => {
  const parsed = parseProjectWorkspaceDirectives(
    "Revenue growth is slowing. Open the model.\n<<WORKSPACE_OPEN: valuation, nvda>>",
  );
  assert.equal(parsed.visibleText, "Revenue growth is slowing. Open the model.");
  assert.deepEqual(parsed.actions, [{
    type: "open-panel",
    view: "valuation",
    symbol: "NVDA",
    placement: "secondary",
    reason: "Suggested by LiOS from the active conversation.",
  }]);
});

test("legacy NAVIGATE directives remain backward compatible without bypassing the safe-action layer", () => {
  const parsed = parseProjectWorkspaceDirectives("See the quote.\n<<NAVIGATE: AAPL, quote>>");
  assert.equal(parsed.visibleText, "See the quote.");
  assert.equal(parsed.actions.length, 1);
  assert.deepEqual(parsed.actions[0], {
    type: "open-panel",
    view: "quote",
    symbol: "AAPL",
    placement: "secondary",
    reason: "Suggested by LiOS from the active conversation.",
  });
});

test("layout directives remain proposals rather than direct mutations", () => {
  const parsed = parseProjectWorkspaceDirectives(
    "A research layout would help.\n<<WORKSPACE_LAYOUT: research>>",
  );
  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0].type, "propose-layout");
  assert.equal((parsed.actions[0] as any).preset, "research");
});

test("malformed directives stay visible and produce no action", () => {
  const source = "Do not run this <<WORKSPACE_LAYOUT: delete-everything>>";
  const parsed = parseProjectWorkspaceDirectives(source);
  assert.equal(parsed.visibleText, source);
  assert.deepEqual(parsed.actions, []);
});
