import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Phase 3 plugin browser lives in Chat and never replaces P13 installer or MCP approval", () => {
  const ui = readFileSync(new URL("../components/terminal/ChatExtensionsDialog.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../components/terminal/ProjectExperienceShell.tsx", import.meta.url), "utf8");
  assert.match(ui, /\/api\/extensions\/chat-catalog/);
  assert.match(ui, /GovernedExtensionsPanel/);
  assert.match(ui, /MCP tool calls remain Project-scoped/);
  assert.match(ui, /not automatically callable in Chat/);
  assert.match(shell, /<ChatExtensionsDialog/);
  assert.match(shell, /projectAvailable=\\{chatMode === "project"/);
  assert.match(ui, /Inspect in Chat/);
  assert.match(ui, /Do not call the remote server/);
  assert.match(shell, /Never overwrite a pending user draft/);
  assert.match(shell, /setInput\\(current => current\\.trim\\(\\)/);
  assert.match(shell, /pendingComposerDialog\.current = "plugins"/);
  assert.doesNotMatch(shell, /<DropdownMenuItem onSelect=\{openPluginCenter\}>/);
});
