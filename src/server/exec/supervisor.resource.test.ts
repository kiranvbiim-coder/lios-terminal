import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { ChildAdapterInput } from "./child";
import { withProcessResourceReservations } from "./resource-supervisor";
import { createProcessSupervisor } from "./supervisor";
import { createStubChildAdapter, createSilentIdleArgv } from "./supervisor.test-support";
import type { ProcessResourceRequest, SpawnProcessAdapter } from "./types";

const request: ProcessResourceRequest = {
  memoryBytes: 512 * 1024 * 1024,
  diskBytes: 0,
  workload: "heavy",
};

test("GM-10 acquires after final authorization and releases only after proven extinction", async () => {
  const events: string[] = [];
  const adapter = createStubChildAdapter({ autoExtinction: false });
  const release = mock.fn(() => { events.push("release"); });
  const acquire = mock.fn((_request: ProcessResourceRequest) => {
    events.push("acquire");
    return { release };
  });
  const createAdapter = mock.fn((_input: ChildAdapterInput): SpawnProcessAdapter<NodeJS.Signals | null> => {
    events.push("adapter");
    return adapter;
  });
  const supervisor = withProcessResourceReservations(
    createProcessSupervisor({ createAdapter }),
    { acquire },
  );

  const run = await supervisor.spawn({
    mode: "child",
    argv: createSilentIdleArgv(),
    resourceRequest: request,
    authorizationCheck: () => { events.push("auth"); },
  });
  assert.deepEqual(events, ["auth", "acquire", "adapter"]);

  adapter.settle(0);
  await run.wait();
  assert.equal(release.mock.callCount(), 0, "root exit is not descendant extinction");

  adapter.settleExtinction();
  await run.waitForExtinction?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(release.mock.callCount(), 1);
  assert.deepEqual(events, ["auth", "acquire", "adapter", "release"]);
});

test("adapter construction failure releases an acquired reservation exactly once", async () => {
  const release = mock.fn();
  const acquire = mock.fn((_request: ProcessResourceRequest) => ({ release }));
  const supervisor = withProcessResourceReservations(
    createProcessSupervisor({
      createAdapter: () => { throw new Error("construction failed"); },
    }),
    { acquire },
  );

  await assert.rejects(
    supervisor.spawn({
      mode: "child",
      argv: createSilentIdleArgv(),
      resourceRequest: request,
      authorizationCheck: () => undefined,
    }),
    /construction failed/,
  );
  assert.equal(acquire.mock.callCount(), 1);
  assert.equal(release.mock.callCount(), 1);
});

test("failed extinction remains fail-closed and does not free capacity", async () => {
  const adapter = createStubChildAdapter({ autoExtinction: false });
  const release = mock.fn();
  const supervisor = withProcessResourceReservations(
    createProcessSupervisor({ createAdapter: () => adapter }),
    { acquire: () => ({ release }) },
  );
  const run = await supervisor.spawn({
    mode: "child",
    argv: createSilentIdleArgv(),
    resourceRequest: request,
  });

  adapter.settle(0);
  await run.wait();
  adapter.rejectExtinction(new Error("cannot prove extinction"));
  await assert.rejects(run.waitForExtinction!(), /cannot prove extinction/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(release.mock.callCount(), 0);
});
