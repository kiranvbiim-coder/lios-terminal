import test from "node:test";
import assert from "node:assert/strict";
import { groupResearchThreadByDay, type ResearchThreadEvent } from "./terminalResearchThread";

function event(id: string, createdAt: number): ResearchThreadEvent {
  return {
    id,
    kind: "visit",
    view: "valuation",
    symbol: "NVDA",
    label: "NVDA · DCF",
    detail: "Valuation",
    createdAt,
  };
}

test("research thread groups events by local calendar day while preserving order", () => {
  const first = new Date(2026, 7, 27, 10, 0, 0).getTime();
  const second = new Date(2026, 7, 27, 12, 0, 0).getTime();
  const prior = new Date(2026, 7, 26, 18, 0, 0).getTime();
  const groups = groupResearchThreadByDay([event("second", second), event("first", first), event("prior", prior)]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].events.map((item) => item.id), ["second", "first"]);
  assert.deepEqual(groups[1].events.map((item) => item.id), ["prior"]);
});
