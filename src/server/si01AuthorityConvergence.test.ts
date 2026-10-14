import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const serverRoot = path.resolve(process.cwd(), "server");
const read = (relative: string) => fs.readFileSync(path.join(serverRoot, relative), "utf8");

function productionTsFiles(dir = serverRoot): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...productionTsFiles(full));
    else if (
      entry.isFile()
      && entry.name.endsWith(".ts")
      && !entry.name.endsWith(".test.ts")
      && !entry.name.endsWith(".test-support.ts")
    ) files.push(full);
  }
  return files;
}

function relative(file: string): string {
  return path.relative(serverRoot, file).split(path.sep).join("/");
}

test("SP-01 Gateway exposes execution only through the governed sandbox/session authority", () => {
  const source = read("gatewayConversation.ts");
  assert.match(source, /from "\.\/governedSandboxSession"/);
  assert.match(source, /execution\.operation\.propose/);
  assert.match(source, /execution\.operation\.review/);
  assert.match(source, /execution\.session\.input/);
  assert.match(source, /writeInputScoped\(sessionId, owner, input\)/);
  assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(|\bexec(File|Sync)?\s*\(/);
  assert.doesNotMatch(source, /from "\.\/exec\/authority\/governed-command"/);
});

test("SP-01 reviewed Terminal uses server-held exact operation, GM-11 journal and shared conversation run", () => {
  const source = read("governedSandboxSession.ts");
  assert.match(source, /prepareInternalExecIntent/);
  assert.match(source, /proposeExactConversationOperation/);
  assert.match(source, /reviewExactConversationOperation/);
  assert.match(source, /consumeExactConversationOperation/);
  assert.match(source, /startJournaledGovernedInteractiveSession/);
  assert.match(source, /conversationRuns\.setInputHandlerScoped/);
  assert.match(source, /withConversationExecutionScope/);
  assert.doesNotMatch(source, /node:child_process/);
});

test("exact-operation approval remains server-side and cannot accept renderer argv/env authority", () => {
  const source = read("conversationGrantStore.ts");
  assert.match(source, /const exactOperations = new Map/);
  assert.match(source, /PreparedGovernedCommand/);
  assert.match(source, /input\.operationDigest !== pending\.prepared\.operation\.digest/);
  assert.match(source, /input\.approvalDigest !== pending\.prepared\.approvalDigest/);
  assert.match(source, /exactOperations\.delete\(input\.requestId\)/);
  assert.doesNotMatch(source, /input\.argv\b|input\.env\b|input\.executable\b/);
});

test("conversation execution owns one process-wide supervisor and one encrypted journal", () => {
  const scope = read("exec/execution-scope.ts");
  const index = read("exec/index.ts");
  const runner = read("exec/run-command.ts");

  assert.match(scope, /let journal: Promise<ExecutionJournal> \| null = null/);
  assert.match(scope, /journal \?\?= createExecutionJournal\(\)/);
  assert.match(scope, /getProcessSupervisor\(\)/);
  assert.match(index, /let current: ProcessSupervisor \| null = null/);
  assert.match(index, /withProcessResourceReservations/);
  assert.match(index, /new LocalResourceReservationPool\(\)/);
  assert.match(runner, /import \{ getProcessSupervisor \} from "\.\/index"/);
  assert.doesNotMatch(runner, /createProcessSupervisor/);
});

test("production code cannot instantiate a competing GM-10 process supervisor", () => {
  const offenders = productionTsFiles()
    .filter((file) => relative(file) !== "exec/index.ts")
    .filter((file) => /import\s+\{[^}]*\bcreateProcessSupervisor\b[^}]*\}\s+from/.test(fs.readFileSync(file, "utf8")))
    .map(relative);
  assert.deepEqual(offenders, []);
});

