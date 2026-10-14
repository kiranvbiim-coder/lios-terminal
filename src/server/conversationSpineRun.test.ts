import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

// The journal binds its data directory at first use, so set it before loading anything that touches it.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-spine-run-"));
process.env.LIMURIA_DATA_DIR = dataDir;
const { runOnConversationSpine } = await import("./conversationSpineRun");
const { conversationRuns } = await import("./conversationRunRegistry");
const { cancelConversationRun } = await import("./conversationRunCancel");
const { getConversationExecutionJournal, recoverConversationExecutions } = await import("./exec/execution-scope");
const { createExecutionJournal } = await import("./exec/execution-journal");

const at = "2026-10-05T00:00:00.000Z";
const owner = (userId: number) => ({ userId, projectId: 5, chatId: 6 });
const doneEvent = (requestId: string, status: "completed" | "cancelled" | "failed"): ConversationRuntimeEvent => ({ type: "done", requestId, at, status });
const textEvent = (requestId: string, text: string): ConversationRuntimeEvent => ({ type: "text", requestId, at, text, label: "deterministic" });

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("a spine run is visible in the registry, journaled and completed, and replays its events", { timeout: 20_000 }, async () => {
  const requestId = crypto.randomUUID();
  const userId = 9001;
  const release = Promise.withResolvers<void>();
  let wasActive = false;
  const running = runOnConversationSpine({
    requestId,
    owner: owner(userId),
    label: "Automation rerun",
    run: async ({ emit }) => {
      wasActive = conversationRuns.active(userId).some((run) => run.requestId === requestId);
      await emit(textEvent(requestId, "answer"));
      await release.promise;
      await emit(doneEvent(requestId, "completed"));
      return { text: "answer", cancelled: false };
    },
  });
  release.resolve();
  const result = await running;
  assert.deepEqual(result, { text: "answer", cancelled: false });
  assert.equal(wasActive, true);
  assert.equal(conversationRuns.active(userId).length, 0);

  const journal = await getConversationExecutionJournal();
  const record = await journal.read(requestId, owner(userId));
  assert.equal(record?.status, "completed");
  assert.equal(record?.label, "Automation rerun");
  assert.equal(record?.stdout, "answer");

  const seen: string[] = [];
  const subscription = conversationRuns.subscribe(requestId, userId, -1, ({ event }) => { seen.push(event.type); });
  assert.ok(subscription);
  assert.deepEqual(seen, ["text", "done"]);
  assert.equal(subscription.status, "finished");
});

test("the single cancel entry stops a spine run and the journal records it as cancelled", { timeout: 20_000 }, async () => {
  const requestId = crypto.randomUUID();
  const userId = 9002;
  const started = Promise.withResolvers<void>();
  const running = runOnConversationSpine({
    requestId,
    owner: owner(userId),
    label: "Automation rerun",
    run: async ({ signal, emit }) => {
      started.resolve();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      await emit(doneEvent(requestId, "cancelled"));
      return { text: "", cancelled: true };
    },
  });
  await started.promise;
  assert.equal(cancelConversationRun(requestId, userId + 1), false, "another user cannot cancel it");
  assert.equal(cancelConversationRun(requestId, userId), true);
  assert.deepEqual(await running, { text: "", cancelled: true });
  const journal = await getConversationExecutionJournal();
  assert.equal((await journal.read(requestId, owner(userId)))?.status, "cancelled");
});

test("a failing run rejects its caller, records the failure and ends the registry run", { timeout: 20_000 }, async () => {
  const requestId = crypto.randomUUID();
  const userId = 9003;
  await assert.rejects(
    runOnConversationSpine({
      requestId,
      owner: owner(userId),
      label: "Automation rerun",
      run: async () => { throw new Error("engine exploded"); },
    }),
    /engine exploded/,
  );
  const journal = await getConversationExecutionJournal();
  const record = await journal.read(requestId, owner(userId));
  assert.equal(record?.status, "failed");
  assert.match(record?.stderr ?? "", /engine exploded/);
  assert.equal(conversationRuns.active(userId).length, 0);
});

test("a spine run interrupted by a restart is recovered as interrupted and never resumed", { timeout: 20_000 }, async () => {
  const requestId = crypto.randomUUID();
  const userId = 9004;
  const started = Promise.withResolvers<void>();
  const hold = Promise.withResolvers<void>();
  const running = runOnConversationSpine({
    requestId,
    owner: owner(userId),
    label: "Automation rerun",
    run: async ({ emit }) => {
      await emit(textEvent(requestId, "partial"));
      started.resolve();
      await hold.promise;
      await emit(doneEvent(requestId, "failed"));
      return { text: "partial", cancelled: false };
    },
  });
  await started.promise;
  // Simulate the process dying mid-run: a fresh journal instance performs startup recovery over the same data root.
  await recoverConversationExecutions();
  const reopened = await createExecutionJournal();
  const record = await reopened.read(requestId, owner(userId));
  assert.equal(record?.status, "interrupted");
  assert.equal(record?.stdout, "partial");
  assert.equal(record?.exitCode, null);
  hold.resolve();
  await running.catch(() => undefined);
});

test("a run that ends waiting for approval is journaled failed, never completed", { timeout: 20_000 }, async () => {
  const requestId = crypto.randomUUID();
  const userId = 9003;
  const result = await runOnConversationSpine({
    requestId,
    owner: owner(userId),
    label: "Automation rerun",
    run: async ({ emit }) => {
      await emit({ type: "done", requestId, at, status: "waiting_approval" } as ConversationRuntimeEvent);
      return { text: "", cancelled: false };
    },
  });
  assert.equal(result.cancelled, false);
  const record = await (await getConversationExecutionJournal()).read(requestId, owner(userId));
  assert.equal(record?.status, "failed");
  assert.match(record?.stderr ?? "", /needed an approval/);
});
