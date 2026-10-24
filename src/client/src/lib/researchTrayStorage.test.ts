import assert from "node:assert/strict";
import test from "node:test";
import {
  createResearchContextItem,
  loadResearchTray,
  saveResearchTray,
  subscribeResearchTray,
  MAX_RESEARCH_TRAY_ITEMS,
} from "./terminalResearchTray";
import {
  appendResearchThreadEvent,
  clearResearchThread,
  loadResearchThread,
  subscribeResearchThread,
} from "./terminalResearchThread";

const TRAY = "limuria-terminal-research-tray-v1";
const THREAD = "limuria-terminal-research-thread-v1";

function withBrowser<T>(run: (context: {
  store: Map<string, string>;
  simulateStorage: (key: string | null, value: string | null) => void;
  failWrite: (enabled: boolean) => void;
}) => T): T {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const hadStorage = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const store = new Map<string, string>();
  const emitter = new EventTarget();
  let blocked = false;
  const fakeStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (blocked) throw new Error("quota exceeded or storage disabled");
      store.set(key, value);
    },
    removeItem: (key: string) => {
      if (blocked) throw new Error("storage disabled");
      store.delete(key);
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: emitter });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: fakeStorage });
  try {
    return run({
      store,
      failWrite: enabled => { blocked = enabled; },
      simulateStorage: (key, value) => {
        if (key !== null) {
          if (value === null) store.delete(key);
          else store.set(key, value);
        }
        const event = new Event("storage");
        Object.defineProperties(event, {
          key: { value: key },
          newValue: { value },
        });
        emitter.dispatchEvent(event);
      },
    });
  } finally {
    if (hadWindow && previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (hadStorage && previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("WS-33 tray save publishes only after durable write and never sorts caller state on failure", () => withBrowser(({ store, failWrite }) => {
  const first = createResearchContextItem({ view: "valuation", symbol: "AAPL", kind: "note", note: "Earlier" });
  const second = createResearchContextItem({ view: "valuation", symbol: "MSFT", kind: "note", note: "Later" });
  first.updatedAt = 10;
  second.updatedAt = 20;
  const original = [first, second];
  let notifications = 0;
  const unsub = subscribeResearchTray(() => { notifications++; });
  failWrite(true);
  assert.throws(() => saveResearchTray(original), /quota exceeded/);
  assert.deepEqual(original.map(i => i.id), [first.id, second.id], "caller array order must not change");
  assert.equal(store.has(TRAY), false);
  assert.equal(notifications, 0, "failed write does not publish a success event");
  failWrite(false);
  saveResearchTray(original);
  assert.deepEqual(original.map(i => i.id), [first.id, second.id]);
  assert.deepEqual(loadResearchTray().map(i => i.id), [second.id, first.id]);
  assert.equal(notifications, 1);
  unsub();
}));

test("WS-33 cross-tab tray edit and remove follow storage events; unrelated and corrupt payloads cannot erase it", () => withBrowser(({ simulateStorage }) => {
  const a = createResearchContextItem({ view: "valuation", symbol: "AAPL", kind: "note", note: "Open" });
  const b = createResearchContextItem({ view: "valuation", symbol: "MSFT", kind: "note", note: "Preserved" });
  const snapshots: string[][] = [];
  const unsubscribe = subscribeResearchTray(items => snapshots.push(items.map(i => i.id)));
  simulateStorage(TRAY, JSON.stringify([a, b]));
  assert.deepEqual(snapshots.at(-1), [a.id, b.id]);
  simulateStorage("unrelated", "[]");
  simulateStorage(TRAY, "{invalid json");
  assert.equal(snapshots.length, 1);
  simulateStorage(TRAY, JSON.stringify([b]));
  assert.deepEqual(snapshots.at(-1), [b.id]);
  simulateStorage(TRAY, null);
  assert.deepEqual(snapshots.at(-1), []);
  unsubscribe();
  simulateStorage(TRAY, JSON.stringify([a]));
  assert.equal(snapshots.length, 3, "unsubscribe detaches the cross-tab listener");
}));

test("WS-33 research history updates cross-tab, clear failures stay durable and corrupt data is ignored", () => withBrowser(({ store, failWrite, simulateStorage }) => {
  const snapshots: number[] = [];
  const unsub = subscribeResearchThread(events => snapshots.push(events.length));
  const initial = appendResearchThreadEvent({ kind: "pin", view: "valuation", symbol: "NVDA" });
  assert.equal(initial.length, 1);
  assert.equal(snapshots.at(-1), 1);
  failWrite(true);
  assert.throws(() => clearResearchThread(), /storage disabled/);
  assert.equal(snapshots.at(-1), 1);
  assert.equal(loadResearchThread().length, 1);
  failWrite(false);
  simulateStorage(THREAD, "not json");
  assert.equal(snapshots.at(-1), 1);
  const second = [{ ...initial[0], id: "other", createdAt: initial[0].createdAt + 1 }, ...initial];
  simulateStorage(THREAD, JSON.stringify(second));
  assert.equal(snapshots.at(-1), 2);
  clearResearchThread();
  assert.equal(snapshots.at(-1), 0);
  assert.equal(store.get(THREAD), "[]");
  unsub();
}));

test("WS-33 bounded pin catalog remains an explicit UX capacity contract", () => {
  assert.equal(MAX_RESEARCH_TRAY_ITEMS, 120);
});
