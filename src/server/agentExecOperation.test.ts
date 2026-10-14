import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  currentAgentExecPolicy,
  proposeAgentExecOperation,
} from "./agentExecOperation";

const USER = { id: 7, organizationId: null, role: "internal_analyst" as const };
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function strictEnv(): NodeJS.ProcessEnv {
  return {
    LIOS_EXECUTION_ISOLATION: "strict",
    LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
    LIOS_EXECUTION_SANDBOX_TARGET: "unix:///var/run/docker.sock",
    LIOS_EXECUTION_SANDBOX_IMAGE: "alpine@sha256:" + "a".repeat(64),
    LIOS_EXECUTION_SANDBOX_USER: "10001:10001",
    LIOS_EXECUTION_SANDBOX_SHELL: "/bin/sh",
    LIOS_EXECUTION_SANDBOX_BASE64: "/usr/bin/base64",
    LIOS_EXECUTION_SANDBOX_TAR: "/bin/tar",
    LIOS_EXECUTION_SANDBOX_PYTHON: "/usr/bin/python3",
    LIOS_EXECUTION_SANDBOX_NODE: "/usr/bin/node",
    LIOS_EXECUTION_SANDBOX_XLSX: "/opt/lios/node_modules/xlsx",
  };
}

test("agent execution policy is secret-safe and depends on sandbox policy, not raw code", () => {
  const env = strictEnv();
  const python = currentAgentExecPolicy("python", env);
  const pythonAgain = currentAgentExecPolicy("python", { ...env });
  assert.deepEqual(pythonAgain, python);
  assert.match(python.policyRevision, /^[a-f0-9]{64}$/);
  assert.equal(python.permissionClass, "user_confirm");

  const shell = currentAgentExecPolicy("shell", env);
  assert.notEqual(shell.policyRevision, python.policyRevision, "Python and shell have distinct policy identities");

  const changedImage = currentAgentExecPolicy("python", {
    ...env,
    LIOS_EXECUTION_SANDBOX_IMAGE: "alpine@sha256:" + "b".repeat(64),
  });
  assert.notEqual(changedImage.policyRevision, python.policyRevision);

  const changedLimit = currentAgentExecPolicy("python", {
    ...env,
    LIOS_EXECUTION_SANDBOX_MAX_MEMORY_BYTES: String(1024 * 1024 * 1024),
  });
  assert.notEqual(changedLimit.policyRevision, python.policyRevision);
});

test("proposal refuses aliases, child request ids and malformed tool call ids before preparation", async () => {
  const common = {
    user: USER,
    projectId: 42,
    chatId: 5,
    toolCallId: "step-1-call",
    execution: { kind: "python" as const, code: "print(1)" },
    recordPreparedEvidence: async () => undefined,
    env: strictEnv(),
  };
  await assert.rejects(
    () => proposeAgentExecOperation({ ...common, requestId: "conversation:" + REQUEST_ID }),
    /canonical lowercase UUID/,
  );
  await assert.rejects(
    () => proposeAgentExecOperation({ ...common, requestId: "ABCD1234-0000-4000-8000-000000000044" }),
    /canonical lowercase UUID/,
  );
  await assert.rejects(
    () => proposeAgentExecOperation({ ...common, requestId: REQUEST_ID, toolCallId: "call with spaces" }),
    /opaque toolCallId/,
  );
});

test("L9 coordinator has one exact approved launch path and never mints a second session id", () => {
  const source = fs.readFileSync(new URL("./agentExecOperation.ts", import.meta.url), "utf8");
  assert.equal((source.match(/executePreparedGovernedCommand\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /executeJournaledGovernedCommand|runCommand\(|spawn\(/);
  assert.doesNotMatch(source, /randomUUID\(/);
  assert.match(source, /proposeExactConversationOperation/);
  assert.doesNotMatch(source, /reviewExactConversationOperation|reviewAgentExecOperation/);
  assert.match(source, /consumeExactConversationOperation/);
  assert.match(source, /Same canonical agent-run id/);
  assert.match(source, /tool_call_execution_prepared/);
  const durableEvidence = source.indexOf("await input.recordPreparedEvidence");
  const reviewRegistration = source.indexOf("await proposeExactConversationOperation");
  assert.ok(durableEvidence >= 0 && reviewRegistration > durableEvidence, "L2 prepared evidence must persist before GM-11 review registration");
  assert.match(source, /backendGenerationId: prepared\.facts\.runtimeGenerationId \?\? null/);
  assert.match(source, /executePreparedGovernedCommand\(\s*approved\.prepared,/);
  const executeStart = source.indexOf("export async function executeApprovedAgentExecOperation");
  assert.ok(executeStart >= 0);
  const executeBody = source.slice(executeStart);
  assert.doesNotMatch(executeBody, /prepareStrictAgentExecIntent|proposeExactConversationOperation|reviewExactConversationOperation/);
  assert.match(executeBody, /approvedOperationDigest: approved\.approvedOperationDigest/);
  assert.match(executeBody, /lease: approved\.lease/);
  assert.match(executeBody, /currentPolicy: approved\.currentPolicy/);
});
