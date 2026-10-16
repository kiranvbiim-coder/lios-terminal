import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceState } from "./terminalTypes";
import type { AuthSessionState } from "@shared/identityContracts";
import {
  loadSessionMemory,
  rememberAnalyticalSession,
  clearSessionMemory,
  subscribeSessionMemory,
  setSessionMemoryOwner,
} from "./terminalSessionMemory";

const LEGACY_STORAGE_KEY = "limuria-terminal-session-memory-v1";
const STORAGE_KEY = "limuria-terminal-session-memory-v2.11.22";
const OTHER_STORAGE_KEY = "limuria-terminal-session-memory-v2.12.22";

function verifiedSession(userId = 11, organizationId = 22): AuthSessionState {
  return {
    version: 1, state: "authenticated_online",
    principal: {
      version: 1, kind: "human", userId, organizationId,
      email: `user${userId}@example.test`, name: "Analyst", role: "client_user", audience: "client",
    },
    restoredAt: "2026-10-15T06:00:00.000Z", reason: null,
  };
}
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
  setSessionMemoryOwner(verifiedSession());
  events.length = 0; // Initial account-selection notification isn't a saved-history mutation.
  try {
    return fn({
      data, events,
      failRead: () => { readFails = true; },
      failWrite: () => { writeFails = true; },
      failRemove: () => { removeFails = true; },
    });
  } finally {
    setSessionMemoryOwner(null);
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

test("SI-06.23 a second authenticated user cannot load or mutate the first user's recent history", () => {
  withBrowserStorage({ [STORAGE_KEY]: JSON.stringify([valid("first-owner")]) }, ({ data }) => {
    assert.deepEqual(loadSessionMemory().map((entry) => entry.id), ["first-owner"]);
    setSessionMemoryOwner(verifiedSession(12));
    assert.deepEqual(loadSessionMemory(), [], "the next identity sees no prior account history");
    rememberAnalyticalSession({ title: "Second owner", symbol: "msft", view: "market", workspace });
    assert.equal(JSON.parse(data.get(OTHER_STORAGE_KEY) ?? "[]").length, 1);
    assert.equal(JSON.parse(data.get(STORAGE_KEY) ?? "[]")[0].id, "first-owner",
      "a different authenticated user's history is not modified");
    clearSessionMemory();
    assert.equal(data.has(OTHER_STORAGE_KEY), false);
    assert.equal(data.has(STORAGE_KEY), true, "sign-out clears only the current owner's records");
    setSessionMemoryOwner(verifiedSession());
    assert.deepEqual(loadSessionMemory().map((entry) => entry.id), ["first-owner"]);
  });
});

test("SI-06.23 unscoped legacy history is never adopted by a newly authenticated account", () => {
  withBrowserStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify([valid("unknown-prior-owner")]),
  }, ({ data }) => {
    assert.deepEqual(loadSessionMemory(), []);
    assert.equal(data.has(LEGACY_STORAGE_KEY), false,
      "legacy device-global data has no verifiable owner and must be retired");
    rememberAnalyticalSession({ title: "New verified owner", symbol: "aapl", view: "market", workspace });
    assert.equal(loadSessionMemory().length, 1);
    assert.notEqual(loadSessionMemory()[0].id, "unknown-prior-owner");
  });
});

test("SI-06.23 revoked, malformed, or absent authenticated principal cannot access any account history", () => {
  withBrowserStorage({ [STORAGE_KEY]: JSON.stringify([valid("private-item")]) }, ({ data, events }) => {
    const revoked: AuthSessionState = { ...verifiedSession(), state: "revoked", reason: "revoked" };
    setSessionMemoryOwner(revoked);
    assert.deepEqual(loadSessionMemory(), []);
    setSessionMemoryOwner(null);
    assert.deepEqual(loadSessionMemory(), []);
    const unsaved = rememberAnalyticalSession({ title: "Signed out", view: "market", workspace });
    assert.equal(unsaved.title, "Signed out");
    assert.equal(data.has(OTHER_STORAGE_KEY), false);
    assert.equal(JSON.parse(data.get(STORAGE_KEY) ?? "[]")[0].id, "private-item");
    setSessionMemoryOwner({ ...verifiedSession(), principal: { ...verifiedSession().principal!, userId: -1 } } as AuthSessionState);
    assert.deepEqual(loadSessionMemory(), [], "invalid claimed identity must fail closed");
    assert.equal(events.at(-1)?.type, "lios:session-memory");
    assert.deepEqual(events.at(-1)?.detail, []);
  });
});

test("SI-06.23 scoped history remains distinct when the same user changes organization", () => {
  withBrowserStorage({ [STORAGE_KEY]: JSON.stringify([valid("original-org")]) }, ({ data }) => {
    setSessionMemoryOwner(verifiedSession(11, 23));
    assert.deepEqual(loadSessionMemory(), []);
    rememberAnalyticalSession({ title: "New organization", symbol: "aapl", view: "market", workspace });
    assert.equal(data.has("limuria-terminal-session-memory-v2.11.23"), true);
    setSessionMemoryOwner(verifiedSession());
    assert.deepEqual(loadSessionMemory().map((row) => row.id), ["original-org"]);
  });
});
