import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preview = readFileSync(new URL("./WorkspaceSharePreview.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../../lib/terminalWorkspace.ts", import.meta.url), "utf8");

// Source contract checks are additional guards, not browser/AT acceptance.
test("workspace sharing displays the exact sanitized layout in an accessible modal", () => {
  assert.match(preview, /from "@\/components\/ui\/dialog"/);
  assert.match(preview, /<Dialog open onOpenChange=/);
  assert.match(preview, /<DialogTitle/);
  assert.match(preview, /<DialogDescription/);
  assert.match(preview, /getWorkspacePanes\(workspaceForShare\(workspace\)\)/);
  assert.match(preview, /role="note"/);
  assert.match(preview, /An Artifact pane is shown as a Market pane/);
  assert.match(preview, /Anyone you give the link to can read/);
});

test("clipboard failure cannot masquerade as success and can be retried", () => {
  assert.match(preview, /await navigator\.clipboard\.writeText\(url\)/);
  assert.match(preview, /setCopyState\("copied"\)/);
  assert.match(preview, /catch \{/);
  assert.match(preview, /setCopyState\("error"\)/);
  assert.match(preview, /role=\{copyState === "error" \? "alert" : "status"\}/);
  assert.match(preview, /Could not copy the link/);
  assert.match(preview, /onClick=\{\(\) => void copy\(\)\}/);
  assert.match(preview, /disabled=\{copyState === "copying"\}/);
  assert.doesNotMatch(preview, /setTimeout\(/);
});

test("share URL implementation uses explicit allowlisting, not complete workspace serialization", () => {
  assert.match(workspace, /export function workspaceForShare/);
  assert.match(workspace, /view: pane\.view === "artifact" \? "market" : pane\.view, symbol: pane\.symbol/);
  assert.match(workspace, /url\.search = ""/);
  assert.match(workspace, /url\.hash = "#\/"/);
  assert.match(workspace, /url\.searchParams\.set\("ws", serializeWorkspace\(workspaceForShare\(workspace\)\)\)/);
});
