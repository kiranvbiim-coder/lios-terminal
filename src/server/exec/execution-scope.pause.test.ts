import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConversationExecutionTranscript, ConversationJournalError } from "./execution-scope";
import { createExecutionJournal } from "./execution-journal";

const OWNER = { userId: 1, projectId: 2, chatId: 3 };
const RUN = "750e8400-e29b-41d4-a716-446655440000";

test("an agent run's approval wait becomes a durable pause; a run with nothing to approve cannot pause", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-transcript-pause-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const journal = await createExecutionJournal({ directory: path.join(root, "j"), keyDirectory: path.join(root, "k") });
  await journal.begin({ id: RUN, owner: OWNER, label: "Agent run", agentRun: true });
  const transcript = new ConversationExecutionTranscript(journal, RUN);
  await assert.rejects(transcript.pauseForApproval(), ConversationJournalError);

  await journal.appendAgentEvent(RUN, { kind: "step_started", stepId: "s1" });
  await journal.appendAgentEvent(RUN, {
    kind: "tool_call_started", toolCallId: "c1", stepId: "s1", toolId: "t.confirm", inputSha256: "a".repeat(64),
    decision: "confirm", permissionClass: "user_confirm", sideEffect: "none",
  });
  await journal.appendAgentEvent(RUN, { kind: "tool_call_waiting_approval", toolCallId: "c1" });
  await transcript.pauseForApproval();
  const record = await journal.read(RUN, OWNER);
  assert.equal(record?.status, "waiting_approval");
  assert.equal(record?.endedAt, null);
});
