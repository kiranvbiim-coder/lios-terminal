import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  EncryptedStorageProvider,
  FilesystemStorageProvider,
  StorageIntegrityError,
  StorageNotFoundError,
  loadOrCreateStorageKey,
} from "../storageProvider";
import { AGENT_EVENT_LIMIT, foldAgentReceipt, type AgentEventInput } from "./agent-run-events";
import { createExecutionJournal, type ExecutionJournalOptions, type ExecutionOwner } from "./execution-journal";

const OWNER: ExecutionOwner = { userId: 1, projectId: 2, chatId: 3 };
const OTHER: ExecutionOwner = { userId: 2, projectId: 2, chatId: 3 };
const RUN = "650e8400-e29b-41d4-a716-446655440000";
const OLD_RUN = "650e8400-e29b-41d4-a716-446655440001";
const INPUT_HASH = crypto.createHash("sha256").update("private tool arguments").digest("hex");

async function fixture(t: TestContext, maxRecords?: number) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-agent-ledger-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options: ExecutionJournalOptions = { directory: path.join(root, "execution-journal"), keyDirectory: path.join(root, "data"), ...(maxRecords ? { maxRecords } : {}) };
  return { root, options, journal: await createExecutionJournal(options) };
}

async function provider(options: ExecutionJournalOptions) {
  assert.ok(options.directory);
  return new EncryptedStorageProvider(
    new FilesystemStorageProvider(options.directory),
    await loadOrCreateStorageKey(options.keyDirectory),
    { acceptPlaintext: false },
  );
}

const step = (stepId: string): AgentEventInput => ({ kind: "step_started", stepId, label: "Fetch quote" });
const call = (toolCallId: string, stepId = "s1"): AgentEventInput => ({
  kind: "tool_call_started", toolCallId, stepId, toolId: "lios.market-data", inputSha256: INPUT_HASH,
  decision: "allow", permissionClass: "safe_auto", sideEffect: "none",
});
const done = (toolCallId: string, status: "succeeded" | "failed" = "succeeded"): AgentEventInput => ({
  kind: "tool_call_finished", toolCallId, status, outputRef: "execution-receipt:abc123",
});

async function begun(t: TestContext) {
  const f = await fixture(t);
  await f.journal.begin({ id: RUN, owner: OWNER, label: "Agent run", agentRun: true });
  return f;
}

test("an agent run records a sequenced, sealed event stream and folds to a concise receipt", async (t) => {
  const { journal } = await begun(t);
  const sealed = await journal.appendAgentEvent(RUN, step("s1"));
  assert.equal(sealed.seq, 0);
  await journal.appendAgentEvent(RUN, call("c1"));
  await journal.appendAgentEvent(RUN, done("c1"));
  await journal.appendAgentEvent(RUN, { kind: "evidence", role: "source", ref: "market:AAPL#2026-10-05" });
  await journal.appendAgentEvent(RUN, { kind: "evidence", role: "assumption", ref: "assumption:growth-5pct" });
  await journal.appendAgentEvent(RUN, { kind: "step_finished", stepId: "s1", status: "completed" });
  await journal.finish(RUN, "completed", null);

  const record = await journal.read(RUN, OWNER);
  assert.equal(record?.version, 2);
  assert.deepEqual(record?.events?.map((event) => event.seq), [0, 1, 2, 3, 4, 5]);
  const receipt = foldAgentReceipt({ ...record!, events: record!.events! });
  assert.equal(receipt.status, "completed");
  assert.deepEqual(receipt.steps, [{ stepId: "s1", label: "Fetch quote", status: "completed" }]);
  assert.equal(receipt.tools.length, 1);
  assert.equal(receipt.tools[0]?.status, "succeeded");
  assert.equal(receipt.tools[0]?.outputRef, "execution-receipt:abc123");
  assert.equal(typeof receipt.tools[0]?.durationMs, "number");
  assert.deepEqual(receipt.sources, ["market:AAPL#2026-10-05"]);
  assert.deepEqual(receipt.assumptions, ["assumption:growth-5pct"]);
  assert.equal(JSON.stringify(receipt).includes(INPUT_HASH), false, "the receipt projection does not expose input hashes");
});

test("a reused tool-call id, a second terminal state and out-of-order events are rejected", async (t) => {
  const { journal } = await begun(t);
  await assert.rejects(journal.appendAgentEvent(RUN, call("c1")), StorageIntegrityError, "tool call before its step");
  await journal.appendAgentEvent(RUN, step("s1"));
  await assert.rejects(journal.appendAgentEvent(RUN, step("s1")), StorageIntegrityError, "step id reuse");
  await journal.appendAgentEvent(RUN, call("c1"));
  await assert.rejects(journal.appendAgentEvent(RUN, call("c1")), StorageIntegrityError, "duplicate toolCallId");
  await assert.rejects(journal.appendAgentEvent(RUN, { kind: "step_finished", stepId: "s1", status: "completed" }), StorageIntegrityError, "step cannot finish with a call in flight");
  await assert.rejects(journal.appendAgentEvent(RUN, done("never-started")), StorageIntegrityError);
  await journal.appendAgentEvent(RUN, done("c1"));
  await assert.rejects(journal.appendAgentEvent(RUN, done("c1", "failed")), StorageIntegrityError, "single terminal per call");
  await journal.appendAgentEvent(RUN, { kind: "step_finished", stepId: "s1", status: "completed" });
  await assert.rejects(journal.appendAgentEvent(RUN, { kind: "step_finished", stepId: "s1", status: "failed" }), StorageIntegrityError, "single terminal per step");
  await assert.rejects(journal.appendAgentEvent(RUN, call("c2")), StorageIntegrityError, "no calls under a finished step");
  assert.equal((await journal.read(RUN, OWNER))?.events?.length, 4, "rejected events leave no trace");
});

test("raw, oversized, unhashed or credential-looking content cannot be stored", async (t) => {
  const { journal } = await begun(t);
  await journal.appendAgentEvent(RUN, step("s1"));
  const bad: unknown[] = [
    { ...call("c1"), inputSha256: "{\"symbol\":\"AAPL\"}" },
    { ...call("c1"), inputSha256: INPUT_HASH.slice(1) },
    { ...call("c1"), args: { symbol: "AAPL" } },
    { ...call("c1"), seq: 99 },
    { ...call("c1"), at: "2020-01-01T00:00:00.000Z" },
    { ...call("c1"), toolId: "has space" },
    { kind: "step_started", stepId: "s2", label: "x".repeat(201) },
    { kind: "tool_call_finished", toolCallId: "c1", status: "succeeded", outputRef: "the quote was 123.45 and then {\"a\":1}" },
    { kind: "tool_call_finished", toolCallId: "c1", status: "succeeded", outputRef: "x".repeat(301) },
    { kind: "evidence", role: "source", ref: "token:abcdef123456" },
    { kind: "evidence", role: "source", ref: "api-key-9f8e7d" },
    { kind: "evidence", role: "thought", ref: "r" },
    { kind: "reasoning", text: "chain of thought" },
    "not an object",
    null,
  ];
  for (const event of bad) await assert.rejects(journal.appendAgentEvent(RUN, event), StorageIntegrityError, JSON.stringify(event)?.slice(0, 60));
  assert.equal((await journal.read(RUN, OWNER))?.events?.length, 1);
});

test("the ledger is bounded", async (t) => {
  const { journal } = await begun(t);
  for (let i = 0; i < AGENT_EVENT_LIMIT; i += 1) await journal.appendAgentEvent(RUN, { kind: "evidence", role: "source", ref: `source:${i}` });
  await assert.rejects(journal.appendAgentEvent(RUN, { kind: "evidence", role: "source", ref: "source:overflow" }), /ledger is full/);
  assert.equal((await journal.read(RUN, OWNER))?.events?.length, AGENT_EVENT_LIMIT);
});

test("append after the run is terminal is rejected", async (t) => {
  const { journal } = await begun(t);
  await journal.appendAgentEvent(RUN, step("s1"));
  await journal.finish(RUN, "cancelled", null);
  await assert.rejects(journal.appendAgentEvent(RUN, step("s2")), /already finalized/);
  assert.equal((await journal.read(RUN, OWNER))?.events?.length, 1);
});

test("version-1 records read losslessly, are never rewritten on read, and are not agent runs", async (t) => {
  const { journal, options } = await fixture(t);
  const legacy = {
    version: 1, id: OLD_RUN, owner: OWNER, label: "Old build", status: "completed",
    startedAt: "2026-10-01T00:00:00.000Z", endedAt: "2026-10-01T00:00:05.000Z", stdout: "ok", stderr: "", exitCode: 0,
  };
  await (await provider(options)).put(OLD_RUN, Buffer.from(JSON.stringify(legacy)));
  const file = path.join(options.directory!, OLD_RUN);
  const before = await fs.readFile(file);
  const record = await journal.read(OLD_RUN, OWNER);
  assert.equal(record?.version, 1);
  assert.equal(record?.stdout, "ok");
  assert.equal("events" in (record ?? {}), false);
  assert.deepEqual(await fs.readFile(file), before, "reading never rewrites the stored bytes");
  assert.equal((await journal.list(OWNER)).length, 1);

  await journal.begin({ id: RUN, owner: OWNER, label: "Plain run" });
  assert.equal((await journal.read(RUN, OWNER))?.version, 1, "runs that are not agent runs stay version 1");
  await assert.rejects(journal.appendAgentEvent(RUN, step("s1")), /not an agent run/);
});

test("owner isolation holds after a restart", async (t) => {
  const { journal, options } = await begun(t);
  await journal.appendAgentEvent(RUN, step("s1"));
  const restarted = await createExecutionJournal(options);
  assert.equal((await restarted.read(RUN, OTHER)), null);
  assert.deepEqual(await restarted.list(OTHER), []);
  assert.equal((await restarted.read(RUN, { ...OWNER, chatId: 4 })), null);
  assert.equal((await restarted.read(RUN, OWNER))?.events?.length, 1);
});

test("recovery marks an in-flight agent run interrupted, keeps its ledger, and executes nothing", async (t) => {
  const { journal, options } = await begun(t);
  await journal.appendAgentEvent(RUN, step("s1"));
  await journal.appendAgentEvent(RUN, call("c1"));
  const restarted = await createExecutionJournal(options);
  await restarted.recoverInterrupted();
  const record = await restarted.read(RUN, OWNER);
  assert.equal(record?.status, "interrupted");
  assert.equal(record?.events?.length, 2, "recovery adds no events: it never resumes or invents outcomes");
  const receipt = foldAgentReceipt({ ...record!, events: record!.events! });
  assert.equal(receipt.tools[0]?.status, "unfinished");
  assert.equal(receipt.steps[0]?.status, "unfinished");
  await assert.rejects(restarted.appendAgentEvent(RUN, done("c1")), /already finalized/);
});

test("a tampered or inconsistent stored ledger fails closed on read", async (t) => {
  const { options } = await fixture(t);
  const base = {
    version: 2, id: RUN, owner: OWNER, label: "Agent run", status: "running", startedAt: "2026-10-05T00:00:00.000Z",
    endedAt: null, stdout: "", stderr: "", exitCode: null,
  };
  const at = "2026-10-05T00:00:01.000Z";
  const started = { kind: "step_started", stepId: "s1", seq: 0, at };
  const callEvent = (seq: number) => ({ ...call("c1"), seq, at });
  const cases: Array<[string, unknown[]]> = [
    ["duplicate tool call id", [started, callEvent(1), callEvent(2)]],
    ["non-contiguous sequence", [started, { ...callEvent(5) }]],
    ["time moving backwards", [started, { ...callEvent(1), at: "2026-10-05T00:00:00.500Z" }]],
    ["finish before start", [{ kind: "tool_call_finished", toolCallId: "zz", status: "succeeded", outputRef: null, seq: 0, at }]],
    ["unknown event kind", [{ kind: "reasoning", text: "hmm", seq: 0, at }]],
    ["over the bound", Array.from({ length: AGENT_EVENT_LIMIT + 1 }, (_, seq) => ({ kind: "evidence", role: "source", ref: `s:${seq}`, seq, at }))],
  ];
  for (const [name, events] of cases) {
    const journal = await createExecutionJournal(options);
    await (await provider(options)).put(RUN, Buffer.from(JSON.stringify({ ...base, events })));
    await assert.rejects(journal.read(RUN, OWNER), StorageIntegrityError, name);
  }
});

test("an unwritable journal fails the append visibly and nothing is kept in memory", async (t) => {
  const { journal, options } = await begun(t);
  await journal.appendAgentEvent(RUN, step("s1"));
  await fs.rm(options.directory!, { recursive: true, force: true });
  await assert.rejects(journal.appendAgentEvent(RUN, call("c1")));
  const restarted = await createExecutionJournal(options);
  assert.equal(await restarted.read(RUN, OWNER), null, "no plaintext or in-memory copy survives the failed write");
});

test("a backwards clock step cannot make the stored chain unreadable", async (t) => {
  const { journal } = await begun(t);
  await journal.appendAgentEvent(RUN, step("s1"));
  const original = Date.now;
  t.after(() => { Date.now = original; });
  Date.now = () => original() - 3_600_000;
  await journal.appendAgentEvent(RUN, call("c1"));
  Date.now = original;
  const record = await journal.read(RUN, OWNER);
  assert.equal(record?.events?.length, 2);
  assert.ok(record!.events![1]!.at >= record!.events![0]!.at);
});

test("a full ledger plus a worst-case transcript is still readable", async (t) => {
  const { journal } = await begun(t);
  // Control characters serialize to six bytes each; the transcript cap and the ledger cap must fit the read bound together.
  await journal.append(RUN, "stdout", "\u0001".repeat(256 * 1024));
  for (let i = 0; i < AGENT_EVENT_LIMIT; i += 1) await journal.appendAgentEvent(RUN, { kind: "evidence", role: "source", ref: `source:${"x".repeat(250)}${i}` });
  const record = await journal.read(RUN, OWNER);
  assert.equal(record?.events?.length, AGENT_EVENT_LIMIT);
  assert.equal(record?.stdout.length, 256 * 1024);
});

const waiting = (toolCallId: string): AgentEventInput => ({ kind: "tool_call_waiting_approval", toolCallId });
const resumed = (toolCallId: string, approvalRef = "approval:0001"): AgentEventInput => ({ kind: "tool_call_resumed", toolCallId, approvalRef });

async function paused(t: TestContext) {
  const f = await begun(t);
  await f.journal.appendAgentEvent(RUN, step("s1"));
  await f.journal.appendAgentEvent(RUN, { ...call("c1"), decision: "confirm", permissionClass: "user_confirm" });
  await f.journal.appendAgentEvent(RUN, waiting("c1"));
  return f;
}

test("an approval wait is non-terminal: the same step and call continue after a resume", async (t) => {
  const { journal, options } = await paused(t);
  await journal.markWaitingApproval(RUN);
  const record = await journal.read(RUN, OWNER);
  assert.equal(record?.status, "waiting_approval");
  assert.equal(record?.endedAt, null);
  const parked = foldAgentReceipt({ ...record!, events: record!.events! });
  assert.equal(parked.tools[0]?.status, "waiting_approval");
  assert.equal(parked.steps[0]?.status, "running", "the step is still open, not terminalized");

  // Paused: nothing may be appended, and the open call blocks closing its step.
  await assert.rejects(journal.appendAgentEvent(RUN, done("c1")), /waiting for approval/);

  const restarted = await createExecutionJournal(options);
  await assert.rejects(restarted.resumeAfterApproval(RUN, OTHER, "c1", "approval:0001"), StorageNotFoundError, "another owner cannot resume it");
  await assert.rejects(restarted.resumeAfterApproval(RUN, { ...OWNER, chatId: 9 }, "c1", "approval:0001"));
  await assert.rejects(restarted.resumeAfterApproval(RUN, OWNER, "c1", "token:abcdef"), StorageIntegrityError, "a credential-looking ref is refused and nothing changes");
  assert.equal((await restarted.read(RUN, OWNER))?.status, "waiting_approval");
  await assert.rejects(restarted.resumeAfterApproval(RUN, OWNER, "other-call", "approval:0001"), /not the one the approval was bound to/);
  const unchanged = await restarted.read(RUN, OWNER);
  assert.equal(unchanged?.status, "waiting_approval", "a mismatched call id changes nothing");
  assert.equal(unchanged?.events?.at(-1)?.kind, "tool_call_waiting_approval");
  const release = await restarted.resumeAfterApproval(RUN, OWNER, "c1", "approval:0001");
  assert.equal(release.kind, "tool_call_resumed");
  const released = await restarted.read(RUN, OWNER);
  assert.equal(released?.status, "running", "status flip and the resumed event are one save");
  assert.equal(released?.events?.at(-1)?.kind, "tool_call_resumed");
  await restarted.appendAgentEvent(RUN, done("c1"));
  await restarted.appendAgentEvent(RUN, { kind: "step_finished", stepId: "s1", status: "completed" });
  await restarted.finish(RUN, "completed", null);
  const final = await restarted.read(RUN, OWNER);
  const receipt = foldAgentReceipt({ ...final!, events: final!.events! });
  assert.equal(receipt.tools[0]?.status, "succeeded");
  assert.equal(receipt.tools[0]?.approvalRef, "approval:0001");
  assert.deepEqual(final!.events!.map((event) => event.kind), [
    "step_started", "tool_call_started", "tool_call_waiting_approval", "tool_call_resumed", "tool_call_finished", "step_finished",
  ]);
});

test("the approval-wait state machine rejects illegal transitions", async (t) => {
  const { journal } = await begun(t);
  await journal.appendAgentEvent(RUN, step("s1"));
  await assert.rejects(journal.appendAgentEvent(RUN, waiting("c1")), StorageIntegrityError, "waiting before the call started");
  await assert.rejects(journal.appendAgentEvent(RUN, resumed("c1")), StorageIntegrityError, "resume without a wait");
  await journal.appendAgentEvent(RUN, call("c1"));
  await assert.rejects(journal.appendAgentEvent(RUN, resumed("c1")), StorageIntegrityError, "resume before waiting");
  await journal.appendAgentEvent(RUN, waiting("c1"));
  await assert.rejects(journal.appendAgentEvent(RUN, waiting("c1")), StorageIntegrityError, "second wait");
  await assert.rejects(journal.appendAgentEvent(RUN, done("c1", "succeeded")), StorageIntegrityError, "a paused call cannot succeed unreleased");
  await assert.rejects(journal.appendAgentEvent(RUN, done("c1", "failed")), StorageIntegrityError, "a paused call cannot fail unreleased");
  await assert.rejects(journal.appendAgentEvent(RUN, { kind: "step_finished", stepId: "s1", status: "completed" }), StorageIntegrityError, "step cannot close over an open call");
  await assert.rejects(journal.appendAgentEvent(RUN, { kind: "tool_call_finished", toolCallId: "c1", status: "approval_required", outputRef: null }), StorageIntegrityError, "approval_required is no longer a terminal state");
  await assert.rejects(journal.appendAgentEvent(RUN, resumed("c1")), /atomic transition/, "the generic append can never release an approval");
  await journal.markWaitingApproval(RUN);
  await journal.resumeAfterApproval(RUN, OWNER, "c1", "approval:0001");
  await assert.rejects(journal.resumeAfterApproval(RUN, OWNER, "c1", "approval:0002"), /not waiting for approval/, "second resume");
  await assert.rejects(journal.appendAgentEvent(RUN, waiting("c1")), StorageIntegrityError, "no second wait after release");
});

test("a paused call can be refused or abandoned", async (t) => {
  const refused = await paused(t);
  await refused.journal.appendAgentEvent(RUN, { kind: "tool_call_finished", toolCallId: "c1", status: "denied", outputRef: null });
  await refused.journal.appendAgentEvent(RUN, { kind: "step_finished", stepId: "s1", status: "failed" });
  assert.equal((await refused.journal.read(RUN, OWNER))?.events?.length, 5);

  const abandoned = await paused(t);
  await abandoned.journal.markWaitingApproval(RUN);
  await abandoned.journal.finish(RUN, "cancelled", null);
  const record = await abandoned.journal.read(RUN, OWNER);
  assert.equal(record?.status, "cancelled");
  const receipt = foldAgentReceipt({ ...record!, events: record!.events! });
  assert.equal(receipt.tools[0]?.status, "unfinished", "a call abandoned while paused is reported as unfinished, not as waiting");
});

test("markWaitingApproval needs a waiting call and an open agent run", async (t) => {
  const none = await begun(t);
  await none.journal.appendAgentEvent(RUN, step("s1"));
  await assert.rejects(none.journal.markWaitingApproval(RUN), /no tool call waiting/);
  await assert.rejects(none.journal.resumeAfterApproval(RUN, OWNER, "c1", "approval:0001"), /not waiting for approval/);

  const plain = await fixture(t);
  await plain.journal.begin({ id: OLD_RUN, owner: OWNER, label: "Plain run" });
  await assert.rejects(plain.journal.markWaitingApproval(OLD_RUN), /no tool call waiting/);
  await plain.journal.finish(OLD_RUN, "completed", 0);
  await assert.rejects(plain.journal.markWaitingApproval(OLD_RUN), /Only a running/);
});

test("restart recovery turns an approval pause into an interrupted run: it is never resumed and nothing is added", async (t) => {
  const { journal, options } = await paused(t);
  await journal.markWaitingApproval(RUN);
  await journal.begin({ id: OLD_RUN, owner: OWNER, label: "Other run" });
  const restarted = await createExecutionJournal(options);
  await restarted.recoverInterrupted();
  const record = await restarted.read(RUN, OWNER);
  assert.equal(record?.status, "interrupted");
  assert.notEqual(record?.endedAt, null);
  assert.equal(record?.events?.length, 3, "recovery adds no events");
  const receipt = foldAgentReceipt({ ...record!, events: record!.events! });
  assert.equal(receipt.tools[0]?.status, "unfinished", "an interrupted pause is reported as unfinished, not as waiting");
  assert.equal((await restarted.read(OLD_RUN, OWNER))?.status, "interrupted");
  await assert.rejects(restarted.resumeAfterApproval(RUN, OWNER, "c1", "approval:0001"), /not waiting for approval/, "no resume across a restart");
  await assert.rejects(restarted.appendAgentEvent(RUN, done("c1")), /already finalized/);
});

test("a stored waiting_approval record without a waiting call, or not an agent run, fails closed", async (t) => {
  const { options } = await fixture(t);
  const base = { id: RUN, owner: OWNER, label: "Agent run", status: "waiting_approval", startedAt: "2026-10-05T00:00:00.000Z", endedAt: null, stdout: "", stderr: "", exitCode: null };
  const at = "2026-10-05T00:00:01.000Z";
  const cases: Array<[string, unknown]> = [
    ["v2 with no waiting call", { ...base, version: 2, events: [{ kind: "step_started", stepId: "s1", seq: 0, at }] }],
    ["v1 record", { ...base, version: 1 }],
    ["waiting with an end time", { ...base, version: 2, endedAt: at, events: [{ kind: "step_started", stepId: "s1", seq: 0, at }, { ...call("c1"), seq: 1, at }, { kind: "tool_call_waiting_approval", toolCallId: "c1", seq: 2, at }] }],
  ];
  for (const [name, record] of cases) {
    const journal = await createExecutionJournal(options);
    await (await provider(options)).put(RUN, Buffer.from(JSON.stringify(record)));
    await assert.rejects(journal.read(RUN, OWNER), StorageIntegrityError, name);
  }
});

test("a durable approval pause is never evicted to make room for another run", async (t) => {
  const f = await fixture(t, 2);
  await f.journal.begin({ id: RUN, owner: OWNER, label: "Agent run", agentRun: true });
  await f.journal.appendAgentEvent(RUN, step("s1"));
  await f.journal.appendAgentEvent(RUN, call("c1"));
  await f.journal.appendAgentEvent(RUN, waiting("c1"));
  await f.journal.markWaitingApproval(RUN);
  await f.journal.begin({ id: OLD_RUN, owner: OWNER, label: "Second" });
  await f.journal.finish(OLD_RUN, "completed", 0);
  await f.journal.begin({ id: "650e8400-e29b-41d4-a716-446655440002", owner: OWNER, label: "Third" });
  assert.equal((await f.journal.read(RUN, OWNER))?.status, "waiting_approval");
  assert.equal(await f.journal.read(OLD_RUN, OWNER), null, "the finished record was evicted instead");
});

const H = (c: string) => c.repeat(64);
const prepared = (toolCallId: string, extra: Record<string, unknown> = {}): AgentEventInput => ({
  kind: "tool_call_execution_prepared", toolCallId, operationDigest: H("a"), approvalDigest: H("b"), policyRevision: H("c"),
  backendId: "docker-local", backendGenerationId: "gen-7", ...extra,
} as AgentEventInput);

test("execution-prepared evidence attaches to a started call once, before approval, with no phase change", async (t) => {
  const { journal } = await begun(t);
  await journal.appendAgentEvent(RUN, step("s1"));
  await assert.rejects(journal.appendAgentEvent(RUN, prepared("c1")), StorageIntegrityError, "prepare before the call started");
  await journal.appendAgentEvent(RUN, call("c1"));
  await journal.appendAgentEvent(RUN, prepared("c1", { backendGenerationId: null }));
  await assert.rejects(journal.appendAgentEvent(RUN, prepared("c1")), StorageIntegrityError, "at most once");
  // Ordering invariant: prepare, then wait for approval, then atomic resume, then finish.
  await journal.appendAgentEvent(RUN, waiting("c1"));
  await journal.markWaitingApproval(RUN);
  await journal.resumeAfterApproval(RUN, OWNER, "c1", "approval:0001");
  await journal.appendAgentEvent(RUN, done("c1"));
  await assert.rejects(journal.appendAgentEvent(RUN, prepared("c1")), StorageIntegrityError, "a finished call cannot be prepared");
  const record = await journal.read(RUN, OWNER);
  assert.deepEqual(record?.events?.map((event) => event.kind), [
    "step_started", "tool_call_started", "tool_call_execution_prepared", "tool_call_waiting_approval", "tool_call_resumed", "tool_call_finished",
  ]);
  const receipt = foldAgentReceipt({ ...record!, events: record!.events! });
  assert.equal(receipt.tools[0]?.status, "succeeded");
  assert.equal(JSON.stringify(receipt).includes(H("a")), false, "the receipt projection omits digests");
});

test("execution-prepared evidence cannot be added after waiting, and refuses raw or malformed content", async (t) => {
  const { journal } = await paused(t);
  await journal.markWaitingApproval(RUN);
  await assert.rejects(journal.appendAgentEvent(RUN, prepared("c1")), /waiting for approval/);
  const fresh = await begun(t);
  await fresh.journal.appendAgentEvent(RUN, step("s1"));
  await fresh.journal.appendAgentEvent(RUN, call("c1"));
  for (const bad of [
    prepared("c1", { operationDigest: "not-a-digest" }),
    prepared("c1", { argv: ["rm", "-rf", "/"] }),
    prepared("c1", { env: { TOKEN: "x" } }),
    prepared("c1", { backendId: "has spaces and ; chars" }),
    prepared("c1", { approvalDigest: undefined }),
  ]) await assert.rejects(fresh.journal.appendAgentEvent(RUN, bad), StorageIntegrityError);
  assert.equal((await fresh.journal.read(RUN, OWNER))?.events?.length, 2, "rejected events leave no trace");
});
