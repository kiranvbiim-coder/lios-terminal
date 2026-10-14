import test from "node:test";
import assert from "node:assert/strict";
import { loadTerminalViewState, patchTerminalViewState, restoreTerminalViewStates, saveTerminalViewState } from "./terminalViewState";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

function installWindow() {
  const storage = new MemoryStorage();
  const windowLike = {
    localStorage: storage,
    dispatchEvent: () => true,
  };
  Object.defineProperty(globalThis, "window", { value: windowLike, configurable: true });
  return storage;
}

test("terminal view state is isolated by view and symbol", () => {
  installWindow();
  saveTerminalViewState("options", "AAPL", { workspace: "strategies" });
  saveTerminalViewState("options", "MSFT", { workspace: "chain" });
  assert.deepEqual(loadTerminalViewState("options", "AAPL"), { workspace: "strategies" });
  assert.deepEqual(loadTerminalViewState("options", "MSFT"), { workspace: "chain" });
});

test("terminal view state patches without losing sibling settings", () => {
  installWindow();
  saveTerminalViewState("economics", undefined, { section: "macro", density: "compact" });
  patchTerminalViewState("economics", undefined, { section: "signals" });
  assert.deepEqual(loadTerminalViewState("economics"), { section: "signals", density: "compact" });
});

test("terminal view state rejects non-finite and oversized payloads", () => {
  installWindow();
  assert.deepEqual(saveTerminalViewState("options", "AAPL", { bad: Number.NaN }), {});
  assert.deepEqual(saveTerminalViewState("options", "AAPL", { huge: "x".repeat(13_000) }), {});
  assert.deepEqual(loadTerminalViewState("options", "AAPL"), {});
});

test("restoring snapshot view states rehydrates multiple workstations", () => {
  installWindow();
  restoreTerminalViewStates([
    { view: "options", symbol: "NVDA", state: { workspace: "analytics" } },
    { view: "economics", symbol: "", state: { section: "calendar" } },
  ]);
  assert.deepEqual(loadTerminalViewState("options", "NVDA"), { workspace: "analytics" });
  assert.deepEqual(loadTerminalViewState("economics"), { section: "calendar" });
});
