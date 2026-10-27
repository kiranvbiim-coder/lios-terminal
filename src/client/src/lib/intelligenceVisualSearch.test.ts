import test from "node:test";
import assert from "node:assert/strict";
import type { IntelligenceCard } from "@shared/waveDContracts";
import { intelligenceSearchCounts, searchRecordedIntelligence } from "./intelligenceVisualSearch";

function card(id: string, kind: IntelligenceCard["kind"], source = "Recorded filing"): IntelligenceCard {
  return {
    id, kind, priority: "important", title: `${id} water supply update`,
    whatHappened: "Verified source mentions infrastructure", whyItMatters: "Relevant public event",
    whyItMattersToUser: "Relevant to a saved subject", nextActions: ["ask"],
    createdAt: "2026-10-27T06:00:00Z", score: 62, status: "unread", unread: true,
    evidence: [{ id: `ev-${id}`, source, provider: "Publisher", url: "https://example.org/report?api_key=SECRET" }],
  };
}

test("only recorded cards match a bounded, case-insensitive, multiword query", () => {
  const input = [card("a", "news"), card("b", "market_move"), card("c", "alert")];
  const matching = searchRecordedIntelligence(input, "Water INFRASTRUCTURE", "all");
  assert.deepEqual(matching.results.map(item => item.id), ["a", "b", "c"]);
  assert.deepEqual(searchRecordedIntelligence(input, "water missing", "all").results, []);
  assert.equal(searchRecordedIntelligence(input, "w", "all").total, 0);
  assert.equal(input.length, 3);
});

test("factual facets preserve server order without synthesizing tags or rankings", () => {
  const input = [card("z", "alert"), card("m", "market_move"), card("r", "research"), card("n", "news")];
  assert.deepEqual(intelligenceSearchCounts(input), { all: 4, research: 2, markets: 1, signals: 1 });
  assert.deepEqual(searchRecordedIntelligence(input, "water", "research").results.map(item => item.id), ["r", "n"]);
  assert.deepEqual(searchRecordedIntelligence(input, "water", "signals").results.map(item => item.id), ["z"]);
  assert.deepEqual(searchRecordedIntelligence(input, "water", "markets").results.map(item => item.id), ["m"]);
});

test("search never indexes secret-bearing source URLs or inferred external text", () => {
  const input = [card("one", "news", "Issuer publication")];
  assert.equal(searchRecordedIntelligence(input, "SECRET", "all").total, 0);
  assert.equal(searchRecordedIntelligence(input, "example.org", "all").total, 0);
  assert.equal(searchRecordedIntelligence(input, "issuer", "all").total, 1);
});

test("result limits report omitted server matches without mutating input", () => {
  const input = Array.from({ length: 50 }, (_, i) => card(String(i), "news"));
  const result = searchRecordedIntelligence(input, "water", "all", 12);
  assert.equal(result.total, 50);
  assert.equal(result.results.length, 12);
  assert.equal(result.limited, true);
  assert.equal(searchRecordedIntelligence(input, "water", "all", 500).results.length, 48);
  assert.equal(input.length, 50);
});
