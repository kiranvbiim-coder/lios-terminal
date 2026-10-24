import assert from "node:assert/strict";
import test from "node:test";
import { appendWorkspaceSlot, removeWorkspaceSlot, workspaceFromSlots, type WorkspaceSlot } from "./workspaceComposerModel";
const slot = (id: string): WorkspaceSlot => ({ objectId: id, pane: { view: "chart", symbol: id } });
test("a fifth object cannot evict any pane, while explicit removal permits replacement", () => {
  const initial = ["A", "B", "C", "D"].map(slot);
  assert.deepEqual(appendWorkspaceSlot(initial, slot("E")).map(item => item.objectId), ["A", "B", "C", "D"]);
  const removed = removeWorkspaceSlot(initial, 1);
  const next = appendWorkspaceSlot(removed, slot("E"));
  const workspace = workspaceFromSlots(next)!;
  assert.deepEqual([workspace.primary.symbol, workspace.secondary?.symbol, workspace.tertiary?.symbol, workspace.quaternary?.symbol], ["A", "C", "D", "E"]);
  assert.deepEqual(initial.map(item => item.objectId), ["A", "B", "C", "D"]);
});
test("duplicate object addition cannot reorder work or consume a spare pane", () => {
  const initial = ["A", "B"].map(slot);
  const next = appendWorkspaceSlot(initial, slot("A"));
  assert.deepEqual(next.map(item => item.objectId), ["A", "B"]);
  assert.deepEqual(appendWorkspaceSlot(next, slot("C")).map(item => item.objectId), ["A", "B", "C"]);
  assert.equal(workspaceFromSlots([]), null);
});
test("composition retains exact canonical Artifact pane identity and revision", () => {
  const artifact = { projectId: 7, chatId: 29, artifactId: "artifact:11111111-1111-4111-8111-111111111111", version: 4 };
  const pane: WorkspaceSlot = { objectId: "retained", pane: { view: "artifact", symbol: "AAPL", artifact } };
  const result = workspaceFromSlots([pane, slot("MSFT")])!;
  assert.equal(result.primary, pane.pane);
  assert.equal(result.primary.artifact, artifact);
  assert.equal(result.primary.artifact?.version, 4);
  assert.equal(result.secondary?.symbol, "MSFT");
});
