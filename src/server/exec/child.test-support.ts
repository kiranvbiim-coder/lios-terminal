// Ported from OpenClaw src/process/supervisor/adapters/child.test-support.ts (MIT, Copyright (c) 2026 OpenClaw Foundation),
// commit c074824a27c96d3983043f9eeb33823cd1772d8c. Node mocks/injected dependencies replace vitest module mocking.
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { mock } from "node:test";
import { createChildAdapter, type ChildAdapterInput } from "./child";
import type { signalProcessTree } from "./kill-tree";

type StubNativeChild = ChildProcess & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough };
export function createStubChild(pid: number | undefined = 1234) {
  const child = new EventEmitter() as StubNativeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  Object.defineProperties(child, {
    pid: { value: pid, configurable: true },
    exitCode: { value: null, configurable: true, writable: true },
    signalCode: { value: null, configurable: true, writable: true },
  });
  const killMock = mock.fn((_signal?: NodeJS.Signals | number) => true);
  child.kill = killMock;
  const emitExit = (code: number | null, signal: NodeJS.Signals | null = null) => {
    Object.defineProperty(child, "exitCode", { value: code, configurable: true, writable: true });
    Object.defineProperty(child, "signalCode", { value: signal, configurable: true, writable: true });
    child.emit("exit", code, signal);
  };
  const emitClose = (code: number | null, signal: NodeJS.Signals | null = null) => { child.emit("close", code, signal); };
  const closePipes = async () => {
    child.stdout.end();
    child.stderr.end();
    await Promise.all([finished(child.stdout), finished(child.stderr)]);
  };
  return { child, killMock, emitExit, emitClose, closePipes };
}

export function createChildAdapterHarness(params: Partial<ChildAdapterInput> = {}, options: { deferSignals?: boolean; groupExists?: () => boolean } = {}) {
  const stub = createStubChild();
  const spawnMock = mock.fn((_command: string, _args: string[], _options: SpawnOptions): ChildProcess => stub.child);
  const deliveries: Array<() => void> = [];
  const signalTreeMock = mock.fn<typeof signalProcessTree>((_pid, _signal, signalOptions) => {
    const complete = () => signalOptions?.onComplete?.();
    if (options.deferSignals) { deliveries.push(complete); }
    else { complete(); }
  });
  const adapter = createChildAdapter({ argv: ["synthetic-child"], ...params }, {
    spawn: spawnMock,
    signalTree: signalTreeMock,
    groupExists: options.groupExists ?? (() => false),
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  adapter.onStdout((chunk) => stdout.push(chunk));
  adapter.onStderr((chunk) => stderr.push(chunk));
  return { ...stub, adapter, spawnMock, signalTreeMock, deliveries, stdout, stderr };
}
