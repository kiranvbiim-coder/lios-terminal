import assert from "node:assert/strict";
import test from "node:test";
import { requireImmutableSandboxImage } from "./sp02_packaged_contract";
import { inspectResumeReapproval } from "./sp02_resume_reapproval_contract";

type Ev = Record<string, unknown>;
const SHA = "a".repeat(64);
const base = { stepId: "w", toolId: "t.write", inputSha256: SHA };
function ledger(overrides: { link?: string | null; secondRef?: string; firstStatus?: string; stepId?: string; skipWaiting?: boolean; releaseBeforeWaiting?: boolean } = {}): Ev[] {
  const raw: Ev[] = [
    { kind: "tool_call_started", toolCallId: "w-call", ...base },
    { kind: "tool_call_waiting_approval", toolCallId: "w-call" },
    { kind: "tool_call_resumed", toolCallId: "w-call", approvalRef: "approval:one" },
    { kind: "tool_call_finished", toolCallId: "w-call", status: overrides.firstStatus ?? "cancelled", outputRef: null },
    { kind: "tool_call_started", toolCallId: "w-call-r1", ...base, stepId: overrides.stepId ?? "w", ...(overrides.link === null ? {} : { resumesToolCallId: overrides.link ?? "w-call" }) },
    ...(overrides.skipWaiting ? [] : [{ kind: "tool_call_waiting_approval", toolCallId: "w-call-r1" }]),
    { kind: "tool_call_resumed", toolCallId: "w-call-r1", approvalRef: overrides.secondRef ?? "approval:two" },
  ];
  if (overrides.releaseBeforeWaiting) {
    const waiting = raw.findIndex((event) => event.kind === "tool_call_waiting_approval" && event.toolCallId === "w-call-r1");
    const release = raw.length - 1;
    [raw[waiting], raw[release]] = [raw[release]!, raw[waiting]!];
  }
  return raw.map((event, seq) => ({ ...event, seq }));
}

test("a fresh, distinct second approval of the linked retry call is proven", () => {
  assert.deepEqual(inspectResumeReapproval(ledger()), {
    resumedToolCallId: "w-call-r1", originalToolCallId: "w-call", originalApprovalRef: "approval:one", reapprovalRef: "approval:two",
  });
});

test("negative controls: no second approval proof without link, distinct ref, same step, cancelled origin or a re-pause", () => {
  assert.equal(inspectResumeReapproval(ledger({ link: null })), null, "missing link");
  assert.equal(inspectResumeReapproval(ledger({ link: "ghost" })), null, "link to unknown call");
  assert.equal(inspectResumeReapproval(ledger({ secondRef: "approval:one" })), null, "grant carried over");
  assert.equal(inspectResumeReapproval(ledger({ stepId: "other" })), null, "link crosses steps");
  assert.equal(inspectResumeReapproval(ledger({ firstStatus: "succeeded" })), null, "link to a completed call");
  assert.equal(inspectResumeReapproval(ledger({ skipWaiting: true })), null, "resumed call never re-paused");
  assert.equal(inspectResumeReapproval(ledger({ releaseBeforeWaiting: true })), null, "release before the pause");
  assert.equal(inspectResumeReapproval([]), null);
});


test("sandbox image selection refuses missing and mutable references", () => {
  const digest = "sha256:" + "a".repeat(64);
  assert.equal(requireImmutableSandboxImage(` registry.local/lios/sandbox@${digest} `), `registry.local/lios/sandbox@${digest}`);
  assert.equal(requireImmutableSandboxImage(digest), digest);
  assert.throws(() => requireImmutableSandboxImage(undefined), /required/);
  assert.throws(() => requireImmutableSandboxImage(""), /required/);
  assert.throws(() => requireImmutableSandboxImage("alpine:latest"), /sha256 digest/);
  assert.throws(() => requireImmutableSandboxImage("registry.local/lios/sandbox:1.0"), /sha256 digest/);
});
