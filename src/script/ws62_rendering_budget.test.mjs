import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (name) => readFileSync(resolve(root, name), "utf8");
const shell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const search = read("client/src/components/terminal/WorkSearchDialog.tsx");
const chart = read("client/src/components/terminal/ArtifactChart.tsx");
const data = read("client/src/components/terminal/ArtifactPane.tsx");
const budget = read("client/src/lib/conversationRenderBudget.ts");
const transport = read("client/src/lib/gateway/conversationRun.ts");

test("WS-62 Chat renders bounded history, not full saved messages on each streaming token", () => {
  assert.match(shell, /selectConversationMessageWindow\(displayMessages, visibleMessageCount\)/);
  assert.match(shell, /visibleMessages\.map\(\(message\) =>/);
  assert.doesNotMatch(shell, /displayMessages\.map\(\(message\) =>/);
  assert.match(shell, /data-testid="chat-load-earlier"/);
  assert.match(shell, /historyScrollAnchorRef/);
  assert.match(shell, /useLayoutEffect/);
  assert.match(shell, /appendConversationPresentationEvent\(current, runtimeEvent\)/);
  assert.match(shell, /appendConversationPresentationEvent\(current, textEvent\)/);
  assert.match(shell, /pendingTextEventRef\.current = runtimeEvent/);
  assert.match(shell, /requestAnimationFrame\(flushPendingText\)/);
  assert.match(shell, /flushPendingText\(\);[\s\S]*recordP3TrustManifest|flushPendingText\(\);/);
  assert.match(budget, /CHAT_RENDER_BATCH = 80/);
  assert.match(budget, /event\.type !== "text" \|\| event\.requestId !== next\.requestId/);
  assert.match(transport, /events\.splice\(previousIndex, 1\)/);
  assert.match(transport, /prior\.type === "text" && prior\.requestId === requestId/);
});

test("WS-62 existing search debounce and stale-request cancellation remain bounded", () => {
  assert.match(search, /new AbortController\(\)/);
  assert.match(search, /window\.setTimeout\(/);
  assert.match(search, /limit=30/);
  assert.match(search, /controller\.abort\(\)/);
  assert.match(search, /if \(controller\.signal\.aborted\) return/);
});

test("WS-62 chart and data tables stay windowed instead of rendering complete source", () => {
  assert.match(chart, /WINDOW_SIZE = 250/);
  assert.match(chart, /selectArtifactChartViewport\(prepared, \{ offset, limit: WINDOW_SIZE \}\)/);
  assert.match(chart, /ComposedChart data=\{viewport\.rows\}/);
  assert.match(data, /TABLE_PAGE_SIZE = 100/);
  assert.match(data, /content\.rows\.slice\(offset, offset \+ TABLE_PAGE_SIZE\)/);
  assert.match(data, /queryDataArtifact\(artifactId, \{ limit: TABLE_PAGE_SIZE, offset \}\)/);
  assert.match(data, /rows\.length > TABLE_PAGE_SIZE \? rows\.slice\(0, TABLE_PAGE_SIZE\)/);
});
