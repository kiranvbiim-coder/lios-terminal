import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const composer = readFileSync(new URL("../components/terminal/WorkspaceComposer.tsx", import.meta.url), "utf8");

test("Workbench arrangement reuses canonical workspace model and keeps original Apply authorization", () => {
  assert.match(composer, /import \{ appendWorkspaceSlot, moveWorkspaceSlot, removeWorkspaceSlot, workspaceFromSlots/);
  assert.match(composer, /setSlots\(current => moveWorkspaceSlot\(current, index, direction\)\)/);
  assert.match(composer, /const next = workspaceFromSlots\(slots\)/);
  assert.match(composer, /onApplyWorkspace\(next, "V5 Intelligence Composition"\) === false/);
  assert.match(composer, /Save or reset the unsaved Artifact before moving or replacing its pane/);
  assert.match(composer, /onClose\(\)/);
});

test("Workbench pane movement has explicit, named and 44px keyboard controls", () => {
  assert.match(composer, /Move \$\{getTerminalCapability\(slot\.pane\.view\)\.label\} earlier from \$\{paneId\} pane/);
  assert.match(composer, /Move \$\{getTerminalCapability\(slot\.pane\.view\)\.label\} later from \$\{paneId\} pane/);
  assert.match(composer, /onClick=\{\(\) => movePane\(index, -1\)\}/);
  assert.match(composer, /onClick=\{\(\) => movePane\(index, 1\)\}/);
  assert.match(composer, /disabled=\{index === 0\}/);
  assert.match(composer, /disabled=\{index >= slots\.length - 1\}/);
  assert.match(composer, /min-h-11/);
  assert.match(composer, /focus-visible:outline/);
  assert.match(composer, /role="status" aria-live="polite"/);
  assert.match(composer, /original content and revision remain unchanged/);
});

test("the existing non-eviction and original pane content remain intact", () => {
  assert.match(composer, /if \(slots\.length >= PANE_IDS\.length\)/);
  assert.match(composer, /if \(slots\.some\(slot => slot\.objectId === object\.id\)\)/);
  assert.match(composer, /if \(!slot \|\| target < 0 \|\| target >= slots\.length\) return/);
  assert.match(composer, /Remove \$\{getTerminalCapability\(slot\.pane\.view\)\.label\} from \$\{paneId\} pane/);
  assert.match(composer, /onClick=\{\(\) => \{ setSlots\(current => removeWorkspaceSlot\(current, index\)\); setNotice\(""\);/);
});
