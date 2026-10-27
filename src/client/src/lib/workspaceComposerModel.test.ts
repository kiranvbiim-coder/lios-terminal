import assert from "node:assert/strict";
import test from "node:test";
import { appendWorkspaceSlot, moveWorkspaceSlot, removeWorkspaceSlot, workspaceFromSlots, type WorkspaceSlot } from "./workspaceComposerModel";
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


test("earlier/later reorder swaps only two adjacent panes without mutating input", () => {
  const initial = ["A", "B", "C", "D"].map(slot);
  const next = moveWorkspaceSlot(initial, 2, -1);
  assert.deepEqual(next.map(row => row.objectId), ["A", "C", "B", "D"]);
  assert.deepEqual(initial.map(row => row.objectId), ["A", "B", "C", "D"]);
  const restored = moveWorkspaceSlot(next, 1, 1);
  assert.deepEqual(restored.map(row => row.objectId), ["A", "B", "C", "D"]);
  assert.equal(restored[1], initial[1]);
  assert.equal(restored[2], initial[2]);
});

test("edge and invalid reorders leave all slots and positions unchanged", () => {
  const initial = ["A", "B"].map(slot);
  for (const [index, direction] of [[0,-1],[1,1],[-1,1],[99,-1],[0.5,1]] as Array<[number, -1 | 1]>) {
    const unchanged = moveWorkspaceSlot(initial, index, direction);
    assert.deepEqual(unchanged.map(row => row.objectId), ["A", "B"]);
    assert.notEqual(unchanged, initial);
  }
  assert.deepEqual(moveWorkspaceSlot([], 0, 1), []);
});

test("reordering retains exact canonical P4 Artifact identity and versions", () => {
  const artifact = { projectId: 7, chatId: 29, artifactId: "artifact:11111111-1111-4111-8111-111111111111", version: 4 };
  const original: WorkspaceSlot = { objectId: "protected", pane: { view: "artifact", symbol: "AAPL", artifact } };
  const first: WorkspaceSlot = { objectId: "chart", pane: { view: "chart", symbol: "MSFT" } };
  const moved = moveWorkspaceSlot([first, original], 1, -1);
  assert.equal(moved[0], original);
  const result = workspaceFromSlots(moved)!;
  assert.equal(result.primary, original.pane);
  assert.equal(result.primary.artifact, artifact);
  assert.equal(result.primary.artifact?.version, 4);
  assert.equal(result.secondary, first.pane);
});
