const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { ensureLocalWorkspace, workspacePaths, WORKSPACE_VERSION } = require("./desktopWorkspace.cjs");

test("local workspace bootstrap creates isolated directories and metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-workspace-"));
  const workspace = ensureLocalWorkspace(root);
  assert.equal(workspace.version, WORKSPACE_VERSION);
  assert.match(workspace.workspaceId, /^ws_[a-f0-9]{32}$/);
  for (const directory of [workspace.paths.root, workspace.paths.connectors, workspace.paths.datasets, workspace.paths.exports]) assert.equal(fs.statSync(directory).isDirectory(), true);
  const metadata = JSON.parse(fs.readFileSync(workspace.paths.metadata, "utf8"));
  assert.equal(metadata.workspaceId, workspace.workspaceId);
  assert.equal(fs.statSync(workspace.paths.metadata).mode & 0o777, 0o600);
});

test("local workspace bootstrap is idempotent and preserves identity", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-workspace-"));
  const first = ensureLocalWorkspace(root);
  const second = ensureLocalWorkspace(root);
  assert.equal(second.workspaceId, first.workspaceId);
  assert.equal(second.createdAt, first.createdAt);
  assert.deepEqual(second.paths, workspacePaths(root));
});
