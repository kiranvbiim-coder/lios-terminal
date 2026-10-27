import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const search = readFileSync(new URL("../components/terminal/WorkSearchDialog.tsx", import.meta.url), "utf8");
const visual = readFileSync(new URL("../components/terminal/VisualIntelligenceSearch.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/terminal/ProjectExperienceShell.tsx", import.meta.url), "utf8");

test("one Search dialog offers two scoped views rather than a parallel search destination", () => {
  assert.match(shell, /<WorkSearchDialog[\s\S]*?onSelect=\{openWorkSearchResult\}/);
  assert.match(search, />Saved work<\/button>/);
  assert.match(search, />Intelligence<\/button>/);
  assert.match(search, /mode === "work" \? <>/);
  assert.match(search, /<VisualIntelligenceSearch query=\{query\}/);
  assert.match(search, /\/api\/work-search\?q=/);
  assert.match(visual, /fetch\("\/api\/wave-d\/pulse"/);
});

test("intelligence is read only on user-selected tab and unavailable in Temporary Chat", () => {
  assert.match(search, /mode !== "work"\) return/);
  assert.match(search, /\{intelligenceEnabled && <button/);
  assert.match(shell, /intelligenceEnabled=\{chatMode !== "temporary"\}/);
  assert.match(visual, /const searchReady = activeQuery\.length >= 2/);
  assert.match(visual, /if \(!searchReady\) \{ setPending\(false\); return; \}/);
  assert.match(visual, /controller\.abort\(\)/);
  assert.doesNotMatch(visual, /POST|api\/visual-search|window\.open|new Image/);
});

test("search -> Ask stages a user-reviewed prompt without auto-submitting or changing owner", () => {
  assert.match(shell, /onAskIntelligence=\{\(card\) => \{/);
  assert.match(shell, /artifactDraftDirtyRef\.current\) return false/);
  assert.match(shell, /stageUniversalChatQuestion\(current, pulseStoryQuestion\(card\)\)/);
  assert.match(shell, /setProjectHomeRequested\(false\)/);
  assert.doesNotMatch(visual, /runConversation\(|setProjectId\(|setChatId\(/);
  assert.match(search, /if \(staged\) onClose\(\)/);
});

test("saved work retains server ownership validation and navigation review", () => {
  assert.match(search, /const opened = await onSelect\(result\)/);
  assert.match(shell, /matchesSavedSearchChat\(result, chat\)/);
  assert.match(shell, /matchesSavedSearchChat\(result, chat\)/);
});
