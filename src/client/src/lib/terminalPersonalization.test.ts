import test from "node:test";
import assert from "node:assert/strict";
import { analyticalContextKey, recordRecentAnalyticalContext, toggleTerminalFavorite } from "./terminalPersonalization";

test("favorites toggle deterministically without duplicates", () => {
  assert.deepEqual(toggleTerminalFavorite(["valuation"], "valuation"), []);
  assert.deepEqual(toggleTerminalFavorite(["valuation"], "peercomp"), ["peercomp", "valuation"]);
});

test("analytical contexts keep one latest entry per view and symbol", () => {
  let recents = recordRecentAnalyticalContext([], "valuation", "aapl", 1);
  recents = recordRecentAnalyticalContext(recents, "financialstatements", "AAPL", 2);
  recents = recordRecentAnalyticalContext(recents, "valuation", "AAPL", 3);
  assert.equal(recents.length, 2);
  assert.equal(recents[0].key, analyticalContextKey("valuation", "AAPL"));
  assert.equal(recents[0].label, "AAPL · DCF");
  assert.equal(recents[0].lastOpenedAt, 3);
});

test("global analytical contexts discard a stale active ticker", () => {
  const [recent] = recordRecentAnalyticalContext([], "market", "AAPL", 1);
  assert.equal(recent.symbol, "");
  assert.equal(recent.label, "Markets");
  assert.equal(recent.key, "GLOBAL:market");
});
