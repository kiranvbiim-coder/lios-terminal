import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = new URL("../client/src/", import.meta.url);
const read = p => fs.readFileSync(new URL(p, src), "utf8");
const shell = read("components/terminal/ProjectExperienceShell.tsx");
const draft = read("lib/composerDraftSafety.ts");

const send = shell.slice(shell.indexOf("const send = async ("), shell.indexOf("const approveRuntimeAction =", shell.indexOf("const send = async (")));
const cancel = shell.slice(shell.indexOf("const cancelRuntime = async"), shell.indexOf("const interruptedRun =", shell.indexOf("const cancelRuntime = async")));
const composer = shell.slice(shell.indexOf('aria-label="Voice transcript review"'), shell.indexOf('onOpenWorkbench();', shell.indexOf('aria-label="Voice transcript review"')));

test("WS-18 existing persisted/Temporary composer remains the only provider execution route", () => {
  assert.match(send, /runConversation\(requireGateway\(\)/);
  assert.match(send, /createProjectChat\(selection.projectId\)/);
  assert.match(send, /createQuickChat\(\)/);
  assert.match(send, /chatMode === "temporary"/);
  assert.doesNotMatch(draft, /fetch\(|gateway|apiRequest|localStorage|sessionStorage/);
});

test("WS-18 a synchronous ref blocks duplicate Enter and click before busy UI rerenders", () => {
  assert.match(shell, /const sendInFlightRef = useRef\(false\)/);
  assert.match(send, /if \(!message \|\| busy \|\| busyRef.current \|\| creatingChat \|\| chatCreationInFlightRef.current \|\| sendInFlightRef.current\) return/);
  assert.match(send, /sendInFlightRef.current = true/);
  assert.ok(send.indexOf("sendInFlightRef.current = true") < send.indexOf("await runCommand(message)"));
  assert.match(send, /finally \{\s*sendInFlightRef.current = false/);
  assert.match(shell, /if \(sendInFlightRef.current\) \{ setLifecycleNotice\("Finish sending the current request before switching conversations\."\); return false; \}/);
  assert.match(shell, /if \(busy \|\| sendInFlightRef.current \|\| chatCreationInFlightRef.current\) return/);
});

test("WS-18 only exact submitted draft can be cleared, not an unrelated draft on retry", () => {
  assert.match(send, /const originalComposerDraft = input/);
  assert.match(send, /const canClearDraft = mayClearComposerDraft\(/);
  assert.equal((send.match(/setInput\(current => clearSubmittedComposerDraft\(current, originalComposerDraft, message\)\)/g) ?? []).length, 2);
  assert.match(draft, /current === original && original.trim\(\) === submitted.trim\(\)/);
});

test("WS-18 failed and 428 reply restoration cannot stomp newer composer typing", () => {
  assert.equal((send.match(/setInput\(current => restoreFailedComposerDraft\(current, originalComposerDraft, message\)\)/g) ?? []).length, 5);
  assert.match(draft, /if \(current.trim\(\)\) return current/);
  assert.match(send, /if \(result.status === 428\)/);
  assert.match(send, /if \(!result.ok\)/);
  assert.match(send, /Your unsent draft is still available to retry/);
});

test("WS-18 already-staged file ref and transcript safety conditions remain untouched", () => {
  assert.match(send, /sourceScope === "files" && !hasStagedAttachments/);
  assert.match(send, /sourceScope === "web" && hasStagedAttachments/);
  assert.match(send, /chatMode !== "project" \|\| !selection.projectId/);
  assert.match(send, /voiceReview/);
  assert.match(send, /setPendingAttachmentRefs\(attachmentsForRequest\)/);
  assert.match(send, /if \(result.ok\) setPendingAttachmentRefs\(\[\]\)/);
  assert.match(shell, /pendingAttachmentFiles.length \+ pendingAttachmentRefs.length \+ incoming.length > 5/);
});

test("WS-18 Stop is visibly reachable while textarea is disabled in flight", () => {
  assert.match(shell, /disabled=\{busy \|\| creatingChat\}/);
  assert.match(shell, /busy && runtimeRequestId \? \(/);
  assert.match(shell, /aria-label=\{stopRequested \? "Stop requested" : stopping \? "Requesting Stop" : "Stop response"\}/);
  assert.match(shell, /onClick=\{\(\) => void cancelRuntime\(\)\}/);
  assert.match(shell, /min-h-10/);
  assert.match(shell, /focus-visible:outline-2/);
});

test("WS-18 Stop requests are single-flight and cannot falsely mark running work as finished", () => {
  assert.match(cancel, /if \(!busy \|\| !runtimeRequestId \|\| stopInFlightRef.current \|\| stopRequested\) return/);
  assert.match(cancel, /stopInFlightRef.current = true/);
  assert.match(cancel, /await cancelConversationRun\(requireGateway\(\), runtimeRequestId\)/);
  assert.match(cancel, /setStopRequested\(true\)/);
  assert.match(cancel, /could not confirm Stop/);
  assert.match(cancel, /finally \{[\s\S]*stopInFlightRef.current = false/);
  assert.doesNotMatch(cancel, /setBusy\(false\)/);
});

test("WS-18 IME and Shift+Enter remain supported, and send uses original command engine", () => {
  assert.match(shell, /e.nativeEvent.isComposing \|\| e.keyCode === 229/);
  assert.match(shell, /e.key === "Enter" && !e.shiftKey/);
  assert.match(send, /if \(!override\?\.approval && !override\?\.continuationOf && await runCommand\(message\)\) return/);
  assert.match(shell, /aria-label="Send"/);
});

test("WS-18 no native, keyboard or cross-PR acceptance is assumed", () => {
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS18_COMPOSER_DRAFT_STOP_2026-10-23.md", import.meta.url), "utf8");
  for (const pr of ["#100", "#137", "#138"]) assert.ok(doc.includes(pr));
  assert.match(doc, /200% zoom[\s\S]{0,90}NOT_RUN/);
  assert.match(doc, /VoiceOver\/Narrator[\s\S]{0,90}NOT_RUN/);
});
