import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { newestResumableRunId } from "./useInterruptedAgentRun";

const A = "a1111111-1111-4111-8111-111111111111";
const B = "b2222222-2222-4222-8222-222222222222";
const source = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), "client/src", relative), "utf8");

test("only an interrupted record the Home flagged resumable is offered; every other state stays hidden", () => {
  assert.equal(newestResumableRunId([{ id: A, status: "interrupted", resumable: true }]), A);
  assert.equal(newestResumableRunId([
    { id: A, status: "cancelled", resumable: true },
    { id: B, status: "interrupted", resumable: false },
  ]), null, "terminal cancelled and non-resumable interrupted (no checkpoint, outcome unknown, drift-less unknown) are hidden");
  for (const status of ["completed", "failed", "denied", "running", "waiting_approval", "cancelled"]) {
    assert.equal(newestResumableRunId([{ id: A, status, resumable: true }]), null, status);
  }
  assert.equal(newestResumableRunId([{ id: "not-a-uuid", status: "interrupted", resumable: true }]), null);
  assert.equal(newestResumableRunId([{ id: A, status: "interrupted" }]), null);
  assert.equal(newestResumableRunId({ id: A }), null);
  assert.equal(newestResumableRunId(null), null);
  assert.equal(newestResumableRunId([{ id: B, status: "completed" }, { id: A, status: "interrupted", resumable: true }]), A, "newest-first list: the first resumable wins");
});

test("the resume control is request-bound, hidden while busy, explicit-click only, and sends nothing but the requestId", () => {
  const trace = source("components/terminal/ConversationRuntimeTrace.tsx");
  assert.match(trace, /const canResume = !busy && !!resumableRequestId && !!onResume;/);
  assert.match(trace, /\{canResume && resumableRequestId && onResume && \(/);
  assert.match(trace, /<ResearchCheckpointCard/);
  const checkpointCard = source("components/terminal/ResearchCheckpointCard.tsx");
  assert.match(checkpointCard, /data-testid="agent-run-resume"/);
  assert.match(checkpointCard, /data-request-id=\{requestId\}/);
  assert.match(trace, /if \(!events\.length && !busy && !resumableRequestId && !checkpointLookupError\) return null;/);

  const hook = source("lib/useInterruptedAgentRun.ts");
  assert.match(hook, /resumeConversationRun\(gateway, requestId, onEvent\)/);
  assert.doesNotMatch(hook, /useEffect\([^)]*resume\(/, "discovery never resumes");
  assert.match(hook, /resuming\.current/, "duplicate clicks are ignored");

  const client = source("lib/gateway/conversationRun.ts");
  assert.match(client, /client\.request\("conversation\.resume", \{ requestId \}/);

  const shell = source("components/terminal/ProjectExperienceShell.tsx");
  assert.match(shell, /\{\.\.\.interruptedRun\.traceProps\}/);
  assert.match(hook, /shell\.setRuntimeRequestId\(requestId\)/);
  assert.match(hook, /resumableRequestId: offered, onResume: resume/);
  assert.match(hook, /resumableCheckpointView\(history.data, offered\)/);
  assert.match(hook, /history.isFetching \|\| history.isError/);
  assert.match(hook, /checkpointLookupError: !busy && chatId !== null && history.isError/);
  assert.match(hook, /onRetryCheckpointLookup: \(\) =>/);
  assert.match(hook, /\.catch\(\(error: unknown\) =>/);
  assert.match(hook, /shell.busyRef.current = false;/);
});
