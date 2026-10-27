import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

test("one canonical Search and Home -> guarded Chat draft handoff, no automatic send or Project migration", () => {
  const shell=source("../components/terminal/ProjectExperienceShell.tsx");
  const start=shell.indexOf("const stageRecordedIntelligenceToChat = ");
  const stop=shell.indexOf("const openWorkSearchResult = ",start);
  assert.ok(start>=0 && stop>start);
  const handler=shell.slice(start,stop);
  assert.match(shell, /onAskIntelligence=\{stageRecordedIntelligenceToChat\}/);
  assert.match(shell, /<HomeAttentionPanel key=\{account\.email \?\? "active-account"\} ownerScope=\{account\.email \?\? "active-account"\} onAsk=\{stageRecordedIntelligenceToChat\} \/>/);
  assert.match(handler, /stageUniversalChatQuestion\(current, pulseStoryQuestion\(card\)\)/);
  assert.match(handler, /chatMode === "temporary"/);
  assert.match(handler, /artifactDraftDirtyRef\.current/);
  assert.match(handler, /sendInFlightRef\.current/);
  assert.match(handler, /composerRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(handler,/runConversation\(|sendMessage\(|createProject\(|setProjectId\(|setChatId\(/);
});

test("Home is one account-scoped Wave D read, not another feed, and review is opt-in", () => {
  const home=source("../components/terminal/HomeAttentionPanel.tsx");
  assert.match(home,/queryKey: \["\/api\/wave-d\/pulse", "Home", ownerScope\]/);
  assert.match(home,/gcTime: 0/);
  assert.match(home,/refetchOnMount: "always"/);
  assert.match(home,/apiRequest\("POST", "\/api\/wave-d\/pulse\/review", \{\}\)/);
  assert.match(home,/onClick=\{\(\) => reviewMutation\.mutate\(\)\}/);
  assert.match(home,/data-testid="home-reviewed-continuity"/);
  assert.match(home,/Show only new or revised source-backed items/);
  assert.match(home,/onAsk=\{onAsk \? \(\) => void stageInChat\(entry\.card\) : undefined\}/);
  assert.doesNotMatch(home,/localStorage|sessionStorage|new Image\(|new WebSocket\(|createP9Workflow/);
});

test("server persists bounded private fingerprints, not user-supplied change events or source URLs", () => {
  const routes=source("../../../server/waveDRoutes.ts");
  const store=source("../../../server/waveDStateStore.ts");
  const continuity=source("../../../server/pulseReviewContinuity.ts");
  assert.match(routes,/app\.post\("\/api\/wave-d\/pulse\/review", requireWaveDRetailRead/);
  assert.match(routes,/Object\.keys\(req\.body\)\.length/);
  assert.match(routes,/capturePulseReviewedSnapshot\(visible, current\.now\)/);
  assert.match(routes,/comparePulseWithReviewedSnapshot\(cards, result\.storedState\.pulseReview\)/);
  assert.match(routes,/suppressMutedPulseCards\(current\.cards, current\.storedState\.pulseSubjects\)/);
  assert.match(store,/pulseReview: normalizePulseReviewedSnapshot\(value\.pulseReview\)/);
  assert.match(store,/withUserTransaction/);
  assert.match(continuity,/createHash\("sha256"\)/);
  assert.match(continuity,/const MAX_REVIEW_CARDS = 120/);
  assert.match(continuity,/id: card\.id, fingerprint: hash/);
  assert.doesNotMatch(continuity,/localStorage|indexedDB|apiKey|transmit|openUrl/);
});
