import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appendWorkspaceSlot, removeWorkspaceSlot, workspaceFromSlots, MAX_WORKSPACE_PANES, type WorkspaceSlot } from "./workspaceComposerModel";

const makeSlot = (id: string): WorkspaceSlot => ({ objectId: id, pane: { view: "chart", symbol: id } });

test("workspace composition preserves every pane and original order at capacity", () => {
  const four = ["A", "B", "C", "D"].map(makeSlot);
  const full = appendWorkspaceSlot(four, makeSlot("E"));
  assert.equal(MAX_WORKSPACE_PANES, 4);
  assert.deepEqual(full, four, "fifth object must not silently replace the oldest object");
  assert.deepEqual(full.map((slot) => slot.objectId), ["A", "B", "C", "D"]);
  const workspace = workspaceFromSlots(full);
  assert.deepEqual([workspace?.primary.symbol, workspace?.secondary?.symbol, workspace?.tertiary?.symbol, workspace?.quaternary?.symbol], ["A", "B", "C", "D"]);
});

test("object addition is idempotent; explicit removal frees a slot", () => {
  const initial = ["A", "B"].map(makeSlot);
  assert.deepEqual(appendWorkspaceSlot(initial, makeSlot("B")), initial);
  assert.deepEqual(appendWorkspaceSlot(initial, makeSlot("C")).map((slot) => slot.objectId), ["A", "B", "C"]);
  const remaining = removeWorkspaceSlot(["A", "B", "C", "D"].map(makeSlot), 1);
  assert.deepEqual(remaining.map((slot) => slot.objectId), ["A", "C", "D"]);
  assert.deepEqual(appendWorkspaceSlot(remaining, makeSlot("E")).map((slot) => slot.objectId), ["A", "C", "D", "E"]);
  assert.equal(workspaceFromSlots([]), null);
  assert.equal(workspaceFromSlots([makeSlot("A")])?.secondary, null);
});

test("Workspace Composer keeps the original professional integration plus responsive keyboard UX", () => {
  const component = readFileSync(new URL("../components/terminal/WorkspaceComposer.tsx", import.meta.url), "utf8");
  assert.match(component, /from "@\/components\/ui\/dialog"/);
  assert.match(component, /<Dialog open onOpenChange=/);
  assert.match(component, /<DialogTitle/);
  assert.match(component, /<DialogDescription/);
  assert.match(component, /onOpenAutoFocus=/);
  assert.match(component, /lg:flex-row/);
  assert.match(component, /max-h-\[38%\]/);
  assert.match(component, /role="status" aria-live="polite"/);
  assert.match(component, /aria-label=\{selected \?/);
  assert.match(component, /disabled=\{selected \|\| slots\.length >= PANE_IDS\.length\}/);
  assert.match(component, /onDragOver=/);
  assert.match(component, /onDrop=\{drop\}/);
  assert.match(component, /onApplyWorkspace\(next, "V5 Intelligence Composition"\)/);
});
