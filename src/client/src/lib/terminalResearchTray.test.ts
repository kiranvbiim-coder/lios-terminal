import test from "node:test";
import assert from "node:assert/strict";
import {
  createResearchContextItem,
  getResearchTrayGroups,
  pinResearchContext,
  removeResearchTrayItem,
  updateResearchTrayItem,
} from "./terminalResearchTray";

test("research context item uses canonical capability label and normalized symbol", () => {
  const item = createResearchContextItem({ view: "valuation", symbol: " nvda " });
  assert.equal(item.symbol, "NVDA");
  assert.match(item.title, /^NVDA · /);
  assert.equal(item.kind, "context");
});

test("pinning the same analytical context deduplicates instead of flooding the tray", () => {
  const first = pinResearchContext([], { view: "valuation", symbol: "NVDA" });
  const second = pinResearchContext(first, { view: "valuation", symbol: "nvda" });
  assert.equal(second.length, 1);
  assert.equal(second[0].symbol, "NVDA");
});

test("research annotations normalize tags and expose stable groups", () => {
  const [item] = pinResearchContext([], { view: "financialstatements", symbol: "AAPL" });
  const updated = updateResearchTrayItem([item], item.id, {
    note: "Watch margin normalization",
    tags: [" Catalyst ", "catalyst", "Risk"],
    group: "AAPL thesis",
  });
  assert.deepEqual(updated[0].tags, ["catalyst", "risk"]);
  assert.equal(updated[0].note, "Watch margin normalization");
  assert.deepEqual(getResearchTrayGroups(updated), ["AAPL thesis"]);
});

test("research items can be removed without mutating unrelated items", () => {
  const first = createResearchContextItem({ view: "valuation", symbol: "NVDA" });
  const second = createResearchContextItem({ view: "peercomp", symbol: "NVDA" });
  const remaining = removeResearchTrayItem([first, second], first.id);
  assert.deepEqual(remaining.map((item) => item.id), [second.id]);
});
