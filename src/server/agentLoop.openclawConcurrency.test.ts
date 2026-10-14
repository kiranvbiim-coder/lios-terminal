import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  runAgentLoop,
  type AgentLoopDeps,
  type AgentLoopTool,
  type AgentPlannedStep,
  type AgentToolRun,
} from "./agentLoop";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const plan = (steps: unknown[]) => JSON.stringify({ steps });
const complete = (answer = "Done.") => JSON.stringify({ decision: "complete", answer });
const step = (id: string, toolId: string, dependsOn: string[] = []) => ({
  id,
  toolId,
  label: `Run ${id}`,
  input: {},
  dependsOn,
});

const safeRead = (id: string): AgentLoopTool => ({
  id,
  label: id,
  kind: "retrieve",
  permissionClass: "safe_auto",
  sideEffect: "none",
  decision: "allow",
});

const internalWrite = (id: string): AgentLoopTool => ({
  id,
  label: id,
  kind: "artifact_write",
  permissionClass: "user_confirm",
  sideEffect: "internal_write",
  decision: "allow",
});

function depsFor(input: {
  models: string[];
  tools: AgentLoopTool[];
  invoke: (step: AgentPlannedStep) => Promise<AgentToolRun>;
  checkpoint?: boolean;
  signal?: AbortSignal;
}): AgentLoopDeps {
  const models = [...input.models];
  return {
    goal: "Research independent facts and compose the result.",
    tools: input.tools,
    budget: { maxSteps: 8, maxAiCalls: 4, maxRevisions: 1 },
    signal: input.signal ?? new AbortController().signal,
    callModel: async () => {
      const next = models.shift();
      if (next === undefined) throw new Error("model called more often than scripted");
      return next;
    },
    invokeTool: async ({ step: planned }) => input.invoke(planned),
    ledger: async () => undefined,
    onPlan: async () => undefined,
    onStepStart: async () => undefined,
    onStepResult: async () => undefined,
    onRevise: async () => undefined,
    ...(input.checkpoint ? { checkpoint: async () => undefined } : {}),
  };
}

test("OpenClaw-derived scheduling overlaps adjacent dependency-ready side-effect-free retrieval tools", async () => {
  const release = deferred();
  const bothStarted = deferred();
  const started: string[] = [];
  const deps = depsFor({
    models: [
      plan([step("a", "read.a"), step("b", "read.b")]),
      complete("Combined."),
    ],
    tools: [safeRead("read.a"), safeRead("read.b")],
    invoke: async (planned) => {
      started.push(planned.id);
      if (started.length === 2) bothStarted.resolve();
      await release.promise;
      return { kind: "ok", summary: planned.id, deterministic: true, sourceRefs: [`src:${planned.id}`] };
    },
  });

  const run = runAgentLoop(deps);
  const overlapped = await Promise.race([
    bothStarted.promise.then(() => true),
    delay(100).then(() => false),
  ]);
  release.resolve();
  const outcome = await run;

  assert.equal(overlapped, true, "independent safe retrievals should be admitted before either sibling settles");
  assert.deepEqual(started, ["a", "b"]);
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.steps.map(({ id }) => id), ["a", "b"], "review/result order stays deterministic");
});

test("OpenClaw-derived scheduling keeps internal-write tools as serial barriers", async () => {
  const releaseWrite = deferred();
  const writeStarted = deferred();
  const started: string[] = [];
  const deps = depsFor({
    models: [
      plan([
        step("a", "read.a"),
        step("write", "write.artifact"),
        step("c", "read.c"),
      ]),
      complete("Combined."),
    ],
    tools: [safeRead("read.a"), internalWrite("write.artifact"), safeRead("read.c")],
    invoke: async (planned) => {
      started.push(planned.id);
      if (planned.id === "write") {
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      return { kind: "ok", summary: planned.id, deterministic: true, sourceRefs: [] };
    },
  });

  const run = runAgentLoop(deps);
  await writeStarted.promise;
  await delay(25);
  assert.deepEqual(started, ["a", "write"], "a later read must not cross an internal-write barrier");
  releaseWrite.resolve();
  const outcome = await run;

  assert.deepEqual(started, ["a", "write", "c"]);
  assert.equal(outcome.status, "completed");
});

test("OpenClaw-derived scheduling never admits a dependent read before its predecessor settles", async () => {
  const releaseA = deferred();
  const aStarted = deferred();
  const started: string[] = [];
  const deps = depsFor({
    models: [
      plan([
        step("a", "read.a"),
        step("b", "read.b"),
        step("c", "read.c", ["a"]),
      ]),
      complete("Combined."),
    ],
    tools: [safeRead("read.a"), safeRead("read.b"), safeRead("read.c")],
    invoke: async (planned) => {
      started.push(planned.id);
      if (planned.id === "a") {
        aStarted.resolve();
        await releaseA.promise;
      }
      return { kind: "ok", summary: planned.id, deterministic: true, sourceRefs: [] };
    },
  });

  const run = runAgentLoop(deps);
  await aStarted.promise;
  await delay(25);
  assert.deepEqual(started, ["a", "b"], "only the dependency-ready sibling may overlap with a");
  releaseA.resolve();
  const outcome = await run;

  assert.deepEqual(started, ["a", "b", "c"]);
  assert.equal(outcome.status, "completed");
});

test("parallel retrieval admission observes cancellation before starting the next sibling", async () => {
  const controller = new AbortController();
  const started: string[] = [];
  const deps = depsFor({
    models: [plan([step("a", "read.a"), step("b", "read.b")])],
    tools: [safeRead("read.a"), safeRead("read.b")],
    signal: controller.signal,
    invoke: async (planned) => {
      started.push(planned.id);
      if (planned.id === "a") {
        controller.abort();
        throw new DOMException("cancelled", "AbortError");
      }
      return { kind: "ok", summary: planned.id, deterministic: true, sourceRefs: [] };
    },
  });

  await assert.rejects(runAgentLoop(deps), (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.deepEqual(started, ["a"], "a cancellation observed before sibling admission must stop that sibling");
});

test("parallel cancellation preserves falsy thrown reasons", async () => {
  const controller = new AbortController();
  const started: string[] = [];
  const deps = depsFor({
    models: [plan([step("a", "read.a"), step("b", "read.b")])],
    tools: [safeRead("read.a"), safeRead("read.b")],
    signal: controller.signal,
    invoke: async (planned) => {
      started.push(planned.id);
      if (planned.id === "a") {
        controller.abort();
        throw false;
      }
      return { kind: "ok", summary: planned.id, deterministic: true, sourceRefs: [] };
    },
  });

  let rejected = false;
  let reason: unknown = Symbol("not-rejected");
  try {
    await runAgentLoop(deps);
  } catch (error) {
    rejected = true;
    reason = error;
  }
  assert.equal(rejected, true);
  assert.equal(reason, false, "the first cancellation reason must not be lost just because it is falsy");
  assert.deepEqual(started, ["a"]);
});

test("checkpointed runs stay serial until restart recovery supports more than one unfinished step", async () => {
  const releaseA = deferred();
  const aStarted = deferred();
  const started: string[] = [];
  const deps = depsFor({
    models: [
      plan([step("a", "read.a"), step("b", "read.b")]),
      complete("Combined."),
    ],
    tools: [safeRead("read.a"), safeRead("read.b")],
    checkpoint: true,
    invoke: async (planned) => {
      started.push(planned.id);
      if (planned.id === "a") {
        aStarted.resolve();
        await releaseA.promise;
      }
      return { kind: "ok", summary: planned.id, deterministic: true, sourceRefs: [] };
    },
  });

  const run = runAgentLoop(deps);
  await aStarted.promise;
  await delay(25);
  assert.deepEqual(started, ["a"], "durable checkpoint execution must not create multiple unfinished steps");
  releaseA.resolve();
  const outcome = await run;

  assert.deepEqual(started, ["a", "b"]);
  assert.equal(outcome.status, "completed");
});
