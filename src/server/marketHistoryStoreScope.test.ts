import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { historyStorageNamespace, loadHistory, saveHistory, storeDir } from "./marketHistoryStore";

test("history storage keeps legacy global files at the root namespace", () => {
  assert.equal(historyStorageNamespace("global"), "");
});

test("scoped history storage uses an opaque deterministic namespace", () => {
  const first = historyStorageNamespace("scope:abc");
  const second = historyStorageNamespace("scope:abc");
  const other = historyStorageNamespace("scope:def");

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^scoped[\\/][0-9a-f]{32}$/);
  assert.equal(first.includes("scope:abc"), false);
});

test("scoped history records cannot be read through a different scope or the global namespace", () => {
  const symbol = `ZZSCOPE${process.pid}${Date.now()}`;
  const scopeA = "scope:test-a";
  const scopeB = "scope:test-b";
  const directory = path.join(storeDir(), historyStorageNamespace(scopeA));
  try {
    saveHistory(
      symbol,
      [{ date: "2026-09-29", open: 10, high: 12, low: 9, close: 11, volume: 100 }],
      "raw",
      {
        sourceRefs: ["provider:yahoo_finance"],
        providerIds: ["yahoo_finance"],
        providerLabels: ["Yahoo Finance"],
        observedAt: "2026-09-29T00:00:00.000Z",
        asOf: "2026-09-29T00:00:00.000Z",
        isFallback: false,
      },
      scopeA,
    );

    assert.equal(loadHistory(symbol, scopeA)?.bars[0]?.close, 11);
    assert.equal(loadHistory(symbol, scopeB), null);
    assert.equal(loadHistory(symbol, "global"), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
