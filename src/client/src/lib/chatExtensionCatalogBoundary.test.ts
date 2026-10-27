import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Phase 3 plugin browser lives in Chat and never replaces P13 installer or MCP approval", () => {
  const ui = readFileSync(new URL("../components/terminal/ChatExtensionsDialog.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../components/terminal/ProjectExperienceShell.tsx", import.meta.url), "utf8");
  assert.match(ui, /\/api\/extensions\/chat-catalog/);
  assert.match(ui, /GovernedExtensionsPanel/);
  assert.match(ui, /ChatMcpConnectForm/);
  assert.match(ui, /verifyMcp\(mcp.id\)/);
  assert.match(ui, /\/api\/setup\/source-connections\/test/);
  assert.match(ui, /No remote tools were executed/);
  assert.ok(shell.includes('projectId={chatMode === "project" ? selection.projectId : null}'));
  assert.match(ui, /queryClient\.invalidateQueries/);
  assert.match(ui, /onCatalogChanged=/);
  const manager = readFileSync(new URL("../components/GovernedExtensionsPanel.tsx", import.meta.url), "utf8");
  assert.match(manager, /onCatalogChanged\?\.\(\)/);
  assert.match(ui, /MCP tool calls remain Project-scoped/);
  assert.match(ui, /not automatically callable in Chat/);
  assert.match(shell, /<ChatExtensionsDialog/);
  assert.ok(shell.includes('projectAvailable={chatMode === "project"'));
  assert.match(ui, /Inspect in Chat/);
  assert.match(ui, /canInspectMcpInChat\(projectId, mcp\)/);
  assert.match(ui, /Do not call the remote server/);
  assert.match(shell, /Never overwrite a pending user draft/);
  assert.ok(shell.includes("setInput(current => current.trim()"));
  assert.match(shell, /pendingComposerDialog\.current = "plugins"/);
  assert.doesNotMatch(shell, /<DropdownMenuItem onSelect=\{openPluginCenter\}>/);
});

test("Phase 3 MCP credential setup remains inside Chat and uses the existing encrypted vault", () => {
  const form = readFileSync(new URL("../components/terminal/ChatMcpConnectForm.tsx", import.meta.url), "utf8");
  assert.match(form, /type="password"/);
  assert.match(form, /\/api\/setup\/credentials\/\$\{createdCredentialRef\}/);
  assert.match(form, /credentialRef: createdCredentialRef/);
  assert.match(form, /credentialWritten && savedId === null/);
  assert.match(form, /setBearerToken\(""/);
  assert.doesNotMatch(form, /config:\s*\{[^}]*bearerToken/);
  assert.doesNotMatch(form, /localStorage|sessionStorage/);
});

test("A10 MCP verification and setup never offer cross-Project actions in Chat", () => {
  const dialog = readFileSync(new URL("../components/terminal/ChatExtensionsDialog.tsx", import.meta.url), "utf8");
  assert.ok(dialog.includes('projectAvailable && canInspectMcpInChat(projectId, mcp) && <button'));
  assert.ok(dialog.includes('projectAvailable && projectId && <button'));
  assert.ok(dialog.includes('connectMcp && projectAvailable && projectId && <ChatMcpConnectForm'));
  assert.ok(!dialog.includes('mcp.status !== "invalid" && <button'), "All verification actions must be Project scoped");
  assert.match(dialog, /explicit user-approved operation/);
});
