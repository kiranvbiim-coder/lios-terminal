// Ported from OpenClaw src/process/supervisor/supervisor.test-support.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS: node:test mocks and injected adapters replace vitest module mocks; result and extinction are independently controllable.
import { mock, type Mock } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { ChildAdapterInput } from "./child";
import { createProcessAdapterEvents } from "./process-events";
import { createDeferredCore } from "./deferred";
import { createProcessSupervisor } from "./supervisor";
import type { ManagedRun, ProcessSupervisor, SpawnInput, SpawnProcessAdapter } from "./types";

type StubOutputSubscriber = { listener: (chunk: string) => void; onRaw?: (chunk: Buffer) => void };
type StubKill = (signal?: NodeJS.Signals) => void;
export type StubChildAdapter = SpawnProcessAdapter<NodeJS.Signals | null> & {
  emitStdout: (chunk: string) => void;
  emitStdoutRaw: (chunk: Buffer) => void;
  emitStdoutText: (chunk: string) => void;
  emitStderr: (chunk: string) => void;
  emitError: (error: Error, source: "process" | "stdin" | "stdout" | "stderr") => void;
  settle: (code: number | null, signal?: NodeJS.Signals | null) => void;
  rejectWait: (error: Error) => void;
  settleExtinction: () => void;
  rejectExtinction: (error: Error) => void;
  killMock: Mock<StubKill>;
  disposeMock: Mock<() => void>;
};
export type StubChildAdapterOptions = {
  pid?: number;
  missingPid?: boolean;
  autoExtinction?: boolean;
  onKill?: (signal: NodeJS.Signals | undefined, adapter: StubChildAdapter) => void;
};

export function createSilentIdleArgv(): string[] {
  return [process.execPath, "-e", "setInterval(() => {}, 1_000)"];
}

export function createStubChildAdapter(options: StubChildAdapterOptions = {}): StubChildAdapter {
  const stdoutSubscribers: StubOutputSubscriber[] = [];
  const stderrSubscribers: StubOutputSubscriber[] = [];
  const events = createProcessAdapterEvents();
  const emitOutput = (subscribers: StubOutputSubscriber[], chunk: string) => {
    for (const subscriber of subscribers) {
      subscriber.onRaw?.(Buffer.from(chunk));
      subscriber.listener(chunk);
    }
  };
  const completion = createDeferredCore<{ code: number | null; signal: NodeJS.Signals | null }>();
  const extinction = createDeferredCore();
  void completion.promise.catch(() => undefined);
  void extinction.promise.catch(() => undefined);
  let settled = false;
  const killMock = mock.fn<StubKill>();
  const disposeMock = mock.fn<() => void>();
  const adapter: StubChildAdapter = {
    pid: options.missingPid ? undefined : options.pid ?? 1234,
    supportsRawOutput: true,
    onStdout: (listener, onRaw) => { stdoutSubscribers.push({ listener, onRaw }); },
    onStderr: (listener, onRaw) => { stderrSubscribers.push({ listener, onRaw }); },
    onError: events.onError,
    onExit: events.onExit,
    wait: () => completion.promise,
    waitForExtinction: () => extinction.promise,
    kill: (signal) => {
      killMock(signal);
      options.onKill?.(signal, adapter);
    },
    dispose: () => { disposeMock(); },
    emitStdout: (chunk) => emitOutput(stdoutSubscribers, chunk),
    emitStderr: (chunk) => emitOutput(stderrSubscribers, chunk),
    emitStdoutRaw: (chunk) => {
      for (const subscriber of stdoutSubscribers) { subscriber.onRaw?.(chunk); }
    },
    emitStdoutText: (chunk) => {
      for (const subscriber of stdoutSubscribers) { subscriber.listener(chunk); }
    },
    emitError: events.emitError,
    settle: (code, signal = null) => {
      if (!settled) {
        settled = true;
        events.emitExit(code, signal);
        completion.resolve({ code, signal });
        if (options.autoExtinction !== false) { extinction.resolve(); }
      }
    },
    rejectWait: (error) => completion.reject(error),
    settleExtinction: () => extinction.resolve(),
    rejectExtinction: (error) => extinction.reject(error),
    killMock,
    disposeMock,
  };
  return adapter;
}

export function createTerminatingAdapter(pid?: number): StubChildAdapter {
  return createStubChildAdapter({ pid, onKill: (signal, current) => current.settle(null, signal ?? "SIGTERM") });
}

export function killSignals(adapter: StubChildAdapter): Array<NodeJS.Signals | undefined> {
  return adapter.killMock.mock.calls.map((call) => call.arguments[0]);
}

export function createStubSupervisor(adapters: ReadonlyArray<SpawnProcessAdapter<NodeJS.Signals | null> | Error>) {
  const queue = [...adapters];
  const createAdapter = mock.fn((_params: ChildAdapterInput): SpawnProcessAdapter<NodeJS.Signals | null> => {
    const next = queue.shift();
    if (!next) { throw new Error("no stub adapter queued"); }
    if (next instanceof Error) { throw next; }
    return next;
  });
  return { supervisor: createProcessSupervisor({ createAdapter }), createAdapter };
}

export function spawnChild(supervisor: ProcessSupervisor, options: Omit<SpawnInput, "mode" | "argv"> & { argv?: string[] } = {}): Promise<ManagedRun> {
  return supervisor.spawn({ argv: createSilentIdleArgv(), ...options, mode: "child" });
}

export async function advanceMockTimers(ms: number): Promise<void> {
  mock.timers.tick(ms);
  await nextTurn();
}
