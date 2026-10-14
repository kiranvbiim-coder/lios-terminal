import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareStrictAgentExecIntent,
  resolveStrictAgentExecIntent,
} from "./authority/agent-exec-intents";

function strictEnv(): NodeJS.ProcessEnv {
  return {
    LIOS_EXECUTION_ISOLATION: "strict",
    LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
    LIOS_EXECUTION_SANDBOX_TARGET: "unix:///tmp/lios-sp02-docker.sock",
    LIOS_EXECUTION_SANDBOX_IMAGE: "sha256:" + "a".repeat(64),
    LIOS_EXECUTION_SANDBOX_USER: "10001:10001",
    LIOS_EXECUTION_SANDBOX_PYTHON: "/opt/lios/python/bin/python3",
    LIOS_EXECUTION_SANDBOX_SHELL: "/bin/sh",
  };
}

test("agent Python intent resolves only to the strict sandbox runtime", () => {
  const resolved = resolveStrictAgentExecIntent({ kind: "python", code: "print(6 * 7)" }, strictEnv());
  assert.equal(resolved.backend.id, "lios.execution.docker");
  assert.deepEqual(resolved.isolation, {
    filesystem: "sandbox",
    network: "deny",
    processes: "sandbox",
  });
  assert.deepEqual(resolved.intent.argv, [
    "/opt/lios/python/bin/python3",
    "-I",
    "-B",
    "-c",
    "print(6 * 7)",
  ]);
});

test("agent shell intent uses the immutable image shell, never a host fallback", () => {
  const resolved = resolveStrictAgentExecIntent({ kind: "shell", command: "pwd" }, strictEnv());
  assert.equal(resolved.backend.id, "lios.execution.docker");
  assert.deepEqual(resolved.intent.argv, ["/bin/sh", "-c", "pwd"]);
  assert.equal(resolved.intent.envProfile, "default");
  assert.deepEqual(resolved.intent.environmentKeys, []);
});

test("agent execution resolution fails closed when strict isolation is not enabled", () => {
  assert.throws(
    () => resolveStrictAgentExecIntent({ kind: "python", code: "print(1)" }, {}),
    /Strict sandbox runtime is not enabled/,
  );
});

test("agent execution resolution fails closed on incomplete strict runtime configuration", () => {
  assert.throws(
    () => resolveStrictAgentExecIntent(
      { kind: "shell", command: "pwd" },
      { LIOS_EXECUTION_ISOLATION: "strict" },
    ),
    /LIOS_EXECUTION_SANDBOX_ENGINE/,
  );
});


test("agent preparation rejects noncanonical request identity before runtime resolution", async () => {
  for (const requestId of [
    "   ",
    "conversation:00000000-0000-4000-8000-000000000044",
    "abcd1234-0000-4000-8000-000000000044".toUpperCase(),
  ]) {
    await assert.rejects(
      () => prepareStrictAgentExecIntent({
        requestId,
        execution: { kind: "shell", command: "pwd" },
        env: {},
      }),
      /canonical lowercase UUID/,
    );
  }
});

test("agent preparation has no legacy-host fallback", async () => {
  await assert.rejects(
    () => prepareStrictAgentExecIntent({
      requestId: "00000000-0000-4000-8000-000000000044",
      execution: { kind: "python", code: "print(1)" },
      env: {},
    }),
    /Strict sandbox runtime is not enabled/,
  );
});
