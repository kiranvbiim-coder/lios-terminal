import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { withConversationExecutionScope } from "./execution-scope";
import { runCommand } from "./run-command";

// This path is also used by Temporary conversations: owning subprocesses does not require a journal.
test("conversation scope admits real commands while open and fences inherited async work after closure", { timeout: 10_000 }, async () => {
  const release = Promise.withResolvers<void>();
  let late: Promise<unknown> | null = null;
  const result = await withConversationExecutionScope(crypto.randomUUID(), async () => {
    late = release.promise.then(() => runCommand({ argv: [process.execPath, "-e", "process.exitCode = 42"], timeoutMs: 5_000 }));
    return runCommand({
      argv: [process.execPath, "-e", "process.stdout.write(JSON.stringify({value: 42}))"],
      timeoutMs: 5_000,
      scopeKey: "producer-cannot-escape-conversation",
    });
  });
  assert.deepEqual(JSON.parse(result.stdout), { value: 42 });
  assert.ok(late);
  const rejected = assert.rejects(late, /Conversation execution scope is closed/);
  release.resolve();
  await rejected;
});
