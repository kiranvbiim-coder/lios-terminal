import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  ContainerExtinctionError,
  createContainerExecutionLifecycle,
  type ContainerControlRunner,
} from "./container-lifecycle";

const TARGET = "unix:///var/run/docker.sock";


test("extinction retries retain the admitted delay and exact attempt bound with donor timing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let inspections = 0;
  const lifecycle = createContainerExecutionLifecycle({
    engine: "docker",
    engineTarget: TARGET,
    generationId: "lios-exec-retry-timing",
    finalizeAttempts: 2,
    retryDelayMs: 25,
    runner: async (argv) => {
      if (argv[2] === "inspect") {
        inspections += 1;
        return inspections === 1
          ? { code: 0, stdout: "still-present", stderr: "" }
          : { code: 1, stdout: "", stderr: "No such container" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  let settled = false;
  const finalization = lifecycle.finalize().then(() => { settled = true; });
  await nextTurn();
  assert.equal(inspections, 1);
  t.mock.timers.tick(24);
  await nextTurn();
  assert.equal(inspections, 1);
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await finalization;
  assert.equal(inspections, 2);
  assert.equal(settled, true);
  t.mock.timers.tick(100);
  assert.equal(inspections, 2);
});
test("finalize closes the cancel-before-container-create race", async () => {
  let exists = false;
  let firstInspectSeenResolve!: () => void;
  const firstInspectSeen = new Promise<void>((resolve) => {
    firstInspectSeenResolve = resolve;
  });
  let inspectCount = 0;
  const commands: string[][] = [];
  const runner: ContainerControlRunner = async (argv) => {
    commands.push([...argv]);
    if (argv[2] === "rm") {
      if (exists) {
        exists = false;
        return { code: 0, stdout: "removed", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "No such container" };
    }
    if (argv[2] === "inspect") {
      inspectCount += 1;
      if (inspectCount === 1) firstInspectSeenResolve();
      return exists
        ? { code: 0, stdout: "deadbeef", stderr: "" }
        : { code: 1, stdout: "", stderr: "No such container" };
    }
    throw new Error("unexpected control command");
  };
  const lifecycle = createContainerExecutionLifecycle({
    engine: "docker",
    engineTarget: TARGET,
    generationId: "lios-exec-test",
    runner,
    finalizeAttempts: 2,
    retryDelayMs: 0,
  });

  lifecycle.onCancel("manual-cancel");
  await firstInspectSeen;
  // The first inspection result is already fixed as "not found". Simulate
  // docker run completing container creation immediately afterwards.
  exists = true;

  await lifecycle.finalize();
  assert.equal(exists, false);
  assert.ok(commands.some((argv) => argv[2] === "rm"));
  assert.ok(commands.some((argv) => argv[2] === "inspect"));
  assert.ok(inspectCount >= 2, "finalize performs a post-client-extinction inspection");
});

test("finalize is idempotent and does not repeat authoritative cleanup", async () => {
  let calls = 0;
  const runner: ContainerControlRunner = async (argv) => {
    calls += 1;
    return argv[2] === "inspect"
      ? { code: 1, stdout: "", stderr: "does not exist" }
      : { code: 1, stdout: "", stderr: "does not exist" };
  };
  const lifecycle = createContainerExecutionLifecycle({
    engine: "podman",
    engineTarget: TARGET,
    generationId: "lios-exec-idempotent",
    runner,
    retryDelayMs: 0,
  });
  await lifecycle.finalize();
  const afterFirst = calls;
  await lifecycle.finalize();
  assert.equal(calls, afterFirst);
});

test("successful finalization returns bridge outputs before removing the generation", async () => {
  const events: string[] = [];
  let exists = true;
  const runner: ContainerControlRunner = async (argv) => {
    if (argv[2] === "rm") {
      events.push("remove");
      exists = false;
      return { code: 0, stdout: "", stderr: "" };
    }
    if (argv[2] === "inspect") {
      events.push("inspect");
      return exists
        ? { code: 0, stdout: "id", stderr: "" }
        : { code: 1, stdout: "", stderr: "No such container" };
    }
    throw new Error("unexpected command");
  };
  const lifecycle = createContainerExecutionLifecycle({
    engine: "docker",
    engineTarget: TARGET,
    generationId: "lios-exec-output",
    runner,
    retryDelayMs: 0,
    beforeRemove: async () => {
      events.push("export");
      return {
        workspaceOutputs: [{
          path: "result.txt",
          size: 2,
          sha256: "a".repeat(64),
          data: Buffer.from("ok"),
        }],
      };
    },
  });
  const result = await lifecycle.finalize();
  assert.equal(result.workspaceOutputs?.[0]?.data.toString("utf8"), "ok");
  assert.deepEqual(events.slice(0, 2), ["export", "remove"]);
});

test("output return failure still removes the generation before surfacing the error", async () => {
  const events: string[] = [];
  const runner: ContainerControlRunner = async (argv) => {
    if (argv[2] === "rm") {
      events.push("remove");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (argv[2] === "inspect") {
      events.push("inspect");
      return { code: 1, stdout: "", stderr: "No such container" };
    }
    throw new Error("unexpected command");
  };
  const lifecycle = createContainerExecutionLifecycle({
    engine: "docker",
    engineTarget: TARGET,
    generationId: "lios-exec-export-error",
    runner,
    retryDelayMs: 0,
    beforeRemove: async () => {
      events.push("export");
      throw new Error("copy failed");
    },
  });
  await assert.rejects(() => lifecycle.finalize(), /copy failed/);
  assert.deepEqual(events, ["export", "remove", "inspect"]);
});

test("cancellation skips output return and still proves extinction", async () => {
  let exported = false;
  const runner: ContainerControlRunner = async (argv) => {
    if (argv[2] === "rm") return { code: 1, stdout: "", stderr: "No such container" };
    if (argv[2] === "inspect") return { code: 1, stdout: "", stderr: "No such container" };
    throw new Error("unexpected command");
  };
  const lifecycle = createContainerExecutionLifecycle({
    engine: "docker",
    engineTarget: TARGET,
    generationId: "lios-exec-cancel-output",
    runner,
    retryDelayMs: 0,
    beforeRemove: async () => {
      exported = true;
      return {};
    },
  });
  lifecycle.onCancel("manual-cancel");
  const result = await lifecycle.finalize();
  assert.equal(exported, false);
  assert.deepEqual(result, {});
});

test("finalize fails closed when the named generation remains observable", async () => {
  const runner: ContainerControlRunner = async (argv) => {
    if (argv[2] === "rm") return { code: 1, stdout: "", stderr: "permission denied" };
    if (argv[2] === "inspect") return { code: 0, stdout: "still-running", stderr: "" };
    throw new Error("unexpected control command");
  };
  const lifecycle = createContainerExecutionLifecycle({
    engine: "docker",
    engineTarget: TARGET,
    generationId: "lios-exec-stuck",
    runner,
    finalizeAttempts: 2,
    retryDelayMs: 0,
  });
  await assert.rejects(
    () => lifecycle.finalize(),
    (error: unknown) => {
      assert.ok(error instanceof ContainerExtinctionError);
      assert.match(error.message, /could not prove/i);
      assert.match(error.message, /lios-exec-stuck/);
      return true;
    },
  );
});

test("ambiguous inspect failure is not accepted as extinction", async () => {
  const runner: ContainerControlRunner = async (argv) => {
    if (argv[2] === "rm") return { code: 1, stdout: "", stderr: "daemon unavailable" };
    if (argv[2] === "inspect") return { code: 125, stdout: "", stderr: "cannot connect to daemon" };
    throw new Error("unexpected control command");
  };
  const lifecycle = createContainerExecutionLifecycle({
    engine: "docker",
    engineTarget: TARGET,
    generationId: "lios-exec-unknown",
    runner,
    finalizeAttempts: 1,
    retryDelayMs: 0,
  });
  await assert.rejects(() => lifecycle.finalize(), ContainerExtinctionError);
});
