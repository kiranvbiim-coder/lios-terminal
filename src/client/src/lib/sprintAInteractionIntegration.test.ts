import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const component = (name: string) =>
  readFileSync(new URL("../components/terminal/" + name + ".tsx", import.meta.url), "utf8");

test("Sprint A uses existing LiOS Omnibox and never creates competing command execution authority", () => {
  const ui = component("CommandBar");
  assert.match(ui, /parseFlexibleTerminalCommand\(query\)/);
  assert.match(ui, /searchTerminalCapabilities\(/);
  assert.match(ui, /onExecute\(result\.command\)/);
  assert.match(ui, /role="combobox"/);
  assert.match(ui, /aria-controls="lios-omnibox-results"/);
  assert.match(ui, /role="listbox"/);
  assert.match(ui, /id=\{`lios-omnibox-result-\$\{index\}`\}/);
  assert.match(ui, /aria-selected=\{active\}/);
  assert.match(ui, /aria-activedescendant=\{selectedResult/);
  assert.match(ui, /event\.altKey && event\.key === "ArrowRight"/);
  assert.doesNotMatch(ui, /event\.key === "Tab" && !event\.shiftKey/);
  assert.match(ui, /document\.activeElement === first/);
  assert.match(ui, /document\.activeElement === last/);
  assert.match(ui, /min-h-11/);
});

test("Sprint A layout commands are tab-scoped geometry only and never replace P4 workspace state", () => {
  const ui = component("DockviewWorkspaceGrid");
  assert.match(ui, /import \{[^}]*requestDockviewLayoutRestore/);
  assert.match(ui, /saveDockviewLayoutState\(layout as DockviewLayoutState, props\.layoutScope\)/);
  assert.match(ui, /loadDockviewLayoutState\(props\.layoutScope\)/);
  assert.match(ui, /requestDockviewLayoutRestore\(null, props\.layoutScope\)/);
  assert.match(ui, /if \(props\.preserveArtifactDraft\)/);
  assert.match(ui, /disabled=\{Boolean\(props\.preserveArtifactDraft\)\}/);
  assert.match(ui, /Default pane arrangement requested/);
  assert.match(ui, /Save layout/);
  assert.match(ui, /Default layout/);
  assert.match(ui, /setLayoutNotice\(" "\), \[props\.layoutScope\]/);
  assert.match(ui, /syncWorkspace\(api, latestPropsRef\.current\.workspace, suppressSyncRef\)/);
  assert.doesNotMatch(ui, /apiRequest\(|fetch\(/);
});

test("Sprint A observed AI progress is visible without simulating execution or hiding review gates", () => {
  const ui = component("ConversationRuntimeTrace");
  assert.match(ui, /observedRunActivity\(events, steps\.length, working, waitingForApproval\)/);
  assert.match(ui, /data-testid="trace-observed-progress"/);
  assert.match(ui, /\{observed\.label\}/);
  assert.match(ui, /aria-live="polite"/);
  assert.match(ui, /data-testid="agent-run-cancel"/);
  assert.match(ui, /governedReviewRisk/);
  assert.match(ui, /onGovernedToolReview/);
  assert.match(ui, /data-testid="trace-show-work"/);
});

test("Sprint A compare and contextual research actions reuse existing governed surfaces", () => {
  const ui = component("ImmersiveDock");
  assert.match(ui, /const hasActiveObject = Boolean\(activeSymbol && capability\.symbolAware\)/);
  assert.match(ui, /\{hasActiveObject && \(/);
  assert.match(ui, /Explore comparison for \$\{activeSymbol\}/);
  assert.match(ui, /onOpenSurface\("innovation-studio"\)/);
  assert.match(ui, /onOpenSurface\("evidence"\)/);
  assert.match(ui, /onOpenSurface\("workspace-composer"\)/);
  assert.match(ui, /saveResearchTray\(next\)/);
  assert.match(ui, /aria-describedby="lios-context-dock-help"/);
  assert.match(ui, /Opening a tool does not run a calculation or grant access/);
  assert.match(ui, /min-h-11/);
  assert.doesNotMatch(ui, /apiRequest\(|fetch\(|runPython\(/);
});
