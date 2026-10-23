import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../client/src/", import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), "utf8");
const gateway = read("lib/gateway/conversationRun.ts");
const shell = read("components/terminal/ProjectExperienceShell.tsx");
const trace = read("components/terminal/ConversationRuntimeTrace.tsx");
const summary = read("lib/runtimeTraceSummary.ts");
const policy = read("lib/observedRunPolicy.ts");
const gatewayTests = read("lib/gateway/conversationRun.test.ts");

test("WS-22 actual Gateway replay retains exact runSeq and requestId, no new start on reconnect", () => {
  assert.match(gateway, /payload\.requestId !== requestId \|\| payload\.runSeq <= lastSeq/);
  assert.match(gateway, /conversation\.subscribe", \{ requestId, afterSeq: lastSeq \}/);
  assert.match(gateway, /conversation\.resume", \{ requestId \}/);
  assert.match(gatewayTests, /WS-22 failed re-subscription/);
  assert.match(gatewayTests, /result\.errorCode, "run_interrupted"/);
});

test("WS-22 disconnect/restart can never resolve ok true or invent done", () => {
  const interrupted = gateway.slice(gateway.indexOf("const interrupted = "),gateway.indexOf("disposers.push(client.onEvent"));
  assert.match(interrupted, /status: 503, ok: false/);
  assert.match(interrupted, /errorCode: "run_interrupted"/);
  assert.doesNotMatch(interrupted, /complete\(\)/);
  assert.doesNotMatch(interrupted, /type: "done"/);
});

test("WS-22 event trace is current request scoped and only observed done(completed) is success", () => {
  assert.match(shell, /events=\{eventsForRun\(runtimeEvents, runtimeRequestId \?\? runtimeEvents\.at\(-1\)\?\.requestId \?\? null\)\}/);
  assert.match(policy, /event\.requestId === requestId && event\.type === "done" && event\.status === "completed"/);
  assert.match(policy, /events\.filter\(event => event\.requestId === requestId\)/);
  assert.match(shell, /hasObservedCompletion\(result\.events, requestId\)/);
});

test("WS-22 trace never claims running when not busy without terminal event", () => {
  assert.match(summary, /"interrupted"/);
  assert.match(summary, /status = busy \? "running" : events\.length \? "interrupted" : "idle"/);
  assert.match(trace, /data-testid="trace-interrupted"/);
  assert.match(trace, /no confirmed final status/);
  assert.match(trace, /Partial text is not a completed answer or an execution receipt/);
});

test("WS-22 completed event alone is not falsely called execution receipt", () => {
  assert.match(trace, /const observedReceipt = \[\.\.\.events\]\.reverse\(\)\.find\(event => event\.type === "receipt"\)/);
  assert.match(trace, /summary\.status === "completed" && observedReceipt\?\.type === "receipt"/);
  assert.match(trace, /data-testid="trace-receipt-missing"/);
  assert.match(trace, /receipt was not received in this view/);
});

test("WS-22 reattached answer cannot automatically replay workspace mutations", () => {
  const attach = shell.slice(shell.indexOf("const attach = async () =>"),shell.indexOf("const attachQuietly =",shell.indexOf("const attach = async () =>")));
  assert.match(attach, /await attachConversationRun\(gateway, run\.requestId, applyRuntimeEvent\)/);
  assert.match(attach, /!hasObservedCompletion\(result\.events, run\.requestId\)/);
  assert.doesNotMatch(attach, /applyWorkspaceAction\(/);
  assert.doesNotMatch(attach, /conversation\.start/);
});

test("WS-22 neither transport errors nor declined approvals create counterfeit Home done", () => {
  assert.match(shell, /Never fabricate a done\/receipt that Home did not emit/);
  assert.match(shell, /Declining an action must request cancellation from Home/);
  const deny = shell.slice(shell.indexOf("const denyRuntimeAction = "),shell.indexOf("const interruptedRun =",shell.indexOf("const denyRuntimeAction = ")));
  assert.match(deny, /void cancelRuntime\(\)/);
  assert.doesNotMatch(deny, /type: "done"/);
  assert.match(deny, /cancelConversationRun/); // only original RPC can cancel
});

test("WS-22 Stop double clicks guarded and Home acknowledgement is not final completion", () => {
  assert.match(shell, /const cancelInFlightRef = useRef\(false\)/);
  assert.match(shell, /if \(!runtimeRequestId \|\| cancelInFlightRef\.current\) return/);
  assert.match(shell, /cancelConversationRun\(requireGateway\(\), targetRun\)/);
  assert.match(shell, /setCancelPending\(true\)/);
  assert.match(trace, /disabled=\{cancelPending\}/);
  assert.match(trace, /Requesting Stop…/);
  const stop = shell.slice(shell.indexOf("const cancelRuntime = async"), shell.indexOf("const denyRuntimeAction",shell.indexOf("const cancelRuntime = async")));
  assert.doesNotMatch(stop, /setBusy\(false\)|status: "cancelled"|type: "done"/);
});

test("WS-22 Retry never submits same payload or overwrites user-unsent work", () => {
  assert.match(trace, /Review request<\/button>/);
  assert.match(shell, /setInput\(current => stageSafeRunRetry\(current, lastSubmittedMessage\)\)/);
  const retry = shell.slice(shell.indexOf("onRetry={() =>"), shell.indexOf("onOpenTerminal=",shell.indexOf("onRetry={() =>")));
  assert.doesNotMatch(retry, /send\(|runConversation\(|applyWorkspaceAction\(/);
  assert.match(policy, /if \(current\.trim\(\) \|\| !previous\.trim\(\)\) return current/);
});

test("WS-22 native/security execution evidence is explicitly unverified", () => {
  const doc=fs.readFileSync(new URL("../../docs/ux/LIOS_WS22_OBSERVED_RUNTIME_CANCEL_RETRY_RECEIPTS_2026-10-23.md",import.meta.url),"utf8");
  for(const pr of ["#98","#139","#119"]) assert.ok(doc.includes(pr));
  assert.match(doc,/200% zoom[\s\S]{0,100}NOT_RUN/);
  assert.match(doc,/VoiceOver\/Narrator[\s\S]{0,100}NOT_RUN/);
});
