import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const pulse = read("../components/terminal/IntelligencePulse.tsx");
const overlays = read("../components/terminal/TerminalUxOverlays.tsx");
const terminal = read("../pages/Terminal.tsx");
const handoff = read("./universalChatHandoff.ts");
const hook = read("./useProactivePulse.ts");
const routes = read("../../../server/waveDRoutes.ts");
const shared = read("../../../shared/waveDContracts.ts");

test("Phase 3 reviews the existing authenticated Wave D Action Inbox, never another agent registry", () => {
  assert.match(routes, /app\.get\("\/api\/wave-d\/action-inbox", requireWaveDRetailRead/);
  assert.match(shared, /export interface ActionInboxItem/);
  assert.match(pulse, /useProactiveInboxReview\(tab === "proactive" && proactiveEnabled\)/);
  assert.match(pulse, /aria-label="Proactive action inbox review"/);
  assert.match(pulse, /aria-pressed=\{tab === "proactive"\}/);
  assert.doesNotMatch(pulse, /POST|runP9WorkflowNow|executeAgent|createArtifact|startConversation/);
});

test("Phase 3 polling requires user opt-in, pauses when hidden and cancels on close", () => {
  assert.match(pulse, /checked=\{proactiveEnabled\}/);
  assert.match(pulse, /setProactiveEnabled\(event\.target\.checked\)/);
  assert.match(hook, /if \(!enabled\) \{/);
  assert.match(hook, /document\.visibilityState === "hidden"/);
  assert.match(hook, /new AbortController\(\)/);
  assert.match(hook, /controller\.abort\(\)/);
  assert.match(hook, /document\.removeEventListener\("visibilitychange", visibilityChanged\)/);
  assert.match(hook, /window\.clearInterval\(interval\)/);
  assert.match(hook, /credentials: "same-origin", cache: "no-store"/);
  assert.doesNotMatch(hook, /localStorage|sessionStorage|window\.open\(/);
});

test("Phase 3 unavailable is not misrepresented as zero alerts or generated certainty", () => {
  assert.match(pulse, /Action Inbox access is not authorized/);
  assert.match(pulse, /No all-clear is implied/);
  assert.match(pulse, /Server snapshot:/);
  assert.match(pulse, /source evidence/);
  assert.match(pulse, /Suggested only:/);
  assert.match(pulse, /No source references were included/);
  assert.match(pulse, /target="_blank" rel="noopener noreferrer"/);
  assert.match(pulse, /This does not start an AI agent/);
  assert.match(hook, /response\.status === 401 \|\| response\.status === 403/);
});

test("Phase 3 AI alert review only stages canonical unsent Chat draft after a user click", () => {
  assert.match(pulse, /buildActionInboxChatDraft\(item, proactive\.review\.asOf!\)/);
  assert.match(pulse, /if \(onStageAiReview\(drafted\)\) onClose\(\)/);
  assert.match(pulse, /Draft review in Chat/);
  assert.match(pulse, /Keep or review your unsaved Workbench edits/);
  assert.match(overlays, /onStageAiReview=\{onStageAiReview\}/);
  assert.match(terminal, /onStageAiReview=\{\(draft\) => \{/);
  assert.match(terminal, /if \(workbenchDirtyRef\.current \|\| !draft\.trim\(\)\) return false/);
  assert.match(terminal, /handleAskLios\(draft\)/);
  assert.match(handoff, /stageUniversalChatQuestion\(existing: string, incoming: string \| null\)/);
  assert.doesNotMatch(pulse, /runConversation\(|sendMessage\(|submitPrompt\(/);
});

test("Phase 3 proactive review reuses existing accessible modal instead of an inaccessible fixed overlay", () => {
  assert.match(pulse, /<Dialog open onOpenChange=\{open => \{ if \(!open\) onClose\(\); \}\}>/);
  assert.match(pulse, /<DialogContent/);
  assert.match(pulse, /<DialogTitle/);
  assert.match(pulse, /<DialogDescription/);
  assert.match(pulse, /onCloseAutoFocus=\{event => \{ event\.preventDefault\(\); if \(opener\?\.isConnected\) opener\.focus\(\); \}\}/);
  assert.doesNotMatch(pulse, /onMouseDown=\{onClose\}/);
});
