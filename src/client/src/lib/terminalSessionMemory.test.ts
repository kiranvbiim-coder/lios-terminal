import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceState } from "./terminalTypes";
import {
  loadSessionMemory,
  rememberAnalyticalSession,
  clearSessionMemory,
  subscribeSessionMemory,
} from "./terminalSessionMemory";

const STORAGE_KEY = "limuria-terminal-session-memory-v1";
const workspace: WorkspaceState = {
  primary: { view: "market", symbol: "AAPL" }, secondary: null, focusedPane: "primary",
};
const valid = (id: string, active = 100) => ({
  id, title: id, symbol: "AAPL", view: "market", workspace,
  startedAt: 50, lastActiveAt: active, visitCount: 2,
});

function withBrowserStorage<T>(
  records: Record<string, string>,
  fn: (controls: {
    data: Map<string, string>;
    events: Array<{ type: string; detail: unknown }>;
    failRead(): void;
    failWrite(): void;
    failRemove(): void;
  }) => T,
): T {
  const originals = ["window", "localStorage", "CustomEvent"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const data = new Map(Object.entries(records));
  const events: Array<{ type: string; detail: unknown }> = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  let readFails = false;
  let writeFails = false;
  let removeFails = false;
  const storage = {
    getItem: (key: string) => {
      if (readFails) throw new Error("Access to storage denied");
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (writeFails) throw new Error("Storage quota exceeded");
      data.set(key, value);
    },
    removeItem: (key: string) => {
      if (removeFails) throw new Error("Storage mutation denied");
      data.delete(key);
    },
  };
  const mockWindow = {
    dispatchEvent(event: { type: string; detail: unknown }) {
      events.push(event);
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
    addEventListener(type: string, listener: (event: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  class MemoryEvent {
    constructor(public type: string, public init: { detail: unknown }) {}
    get detail() { return this.init.detail; }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: mockWindow });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: MemoryEvent });
  try {
    return fn({
      data, events,
      failRead: () => { readFails = true; },
      failWrite: () => { writeFails = true; },
      failRemove: () => { removeFails = true; },
    });
  } finally {
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("SI-06.23 resume ignores corrupt local memory entries and sorts only valid records", () => {
  const invalids = [
    null, 15, {}, { ...valid("bad-visits"), visitCount: Number.NaN },
    { ...valid("bad-counter"), visitCount: 0 },
    { ...valid("bad-date"), lastActiveAt: "yesterday" },
    { ...valid("bad-workspace"), workspace: { primary: null } },
    { ...valid("bad-view"), view: "not-a-capability" },
    { ...valid("bad-pane"), workspace: { ...workspace, primary: { view: "not-a-capability", symbol: "AAPL" } } },
    { ...valid("bad-time"), startedAt: 500, lastActiveAt: 100 },
  ];
  withBrowserStorage({
    [STORAGE_KEY]: JSON.stringify([valid("older", 90), ...invalids, valid("newer", 120)]),
  }, () => {
    assert.deepEqual(loadSessionMemory().map((entry) => entry.id), ["newer", "older"]);
    assert.equal(loadSessionMemory()[0].visitCount, 2);
  });
});

test("SI-06.23 corrupt JSON and forbidden reads never break local workspace resume", () => {
  withBrowserStorage({ [STORAGE_KEY]: "invalid-json" }, ({ failRead }) => {
    assert.deepEqual(loadSessionMemory(), []);
    failRead();
    assert.deepEqual(loadSessionMemory(), []);
  });
});

test("SI-06.23 unavailable writes do not interrupt a user action or falsely broadcast persisted history", () => {
  withBrowserStorage({}, ({ failWrite, data, events }) => {
    failWrite();
    const result = rememberAnalyticalSession({ title: "Morning Research", symbol: "aapl", view: "market", workspace });
    assert.equal(result.symbol, "AAPL");
    assert.equal(result.visitCount, 1);
    assert.equal(data.has(STORAGE_KEY), false);
    assert.deepEqual(events, [], "failed persistence cannot claim history was saved");
  });
});

test("SI-06.23 clearing blocked storage does not claim that retained history was removed", () => {
  withBrowserStorage({ [STORAGE_KEY]: JSON.stringify([valid("private-history")]) }, ({ failRemove, data, events }) => {
    failRemove();
    assert.doesNotThrow(() => clearSessionMemory());
    assert.equal(data.has(STORAGE_KEY), true);
    assert.equal(events.length, 0);
  });
});

test("SI-06.23 valid history updates remain bounded, deduplicated and observable", () => {
  withBrowserStorage({}, ({ data, events }) => {
    const seen: number[] = [];
    const unsubscribe = subscribeSessionMemory((entries) => seen.push(entries.length));
    try {
      rememberAnalyticalSession({ title: "First", symbol: "aapl", view: "market", workspace });
      rememberAnalyticalSession({ title: "Return", symbol: "aapl", view: "market", workspace });
      const rows = loadSessionMemory();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].visitCount, 2);
      assert.equal(rows[0].title, "Return");
      assert.equal(events.length, 2);
      assert.deepEqual(seen, [1, 1]);
      clearSessionMemory();
      assert.deepEqual(loadSessionMemory(), []);
      assert.equal(data.has(STORAGE_KEY), false);
      assert.deepEqual(seen, [1, 1, 0]);
    } finally {
      unsubscribe();
    }
  });
});
