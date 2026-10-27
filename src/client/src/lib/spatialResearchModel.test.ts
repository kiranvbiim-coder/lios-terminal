import test from "node:test";
import assert from "node:assert/strict";
import { buildSpatialResearchModel, buildExplicitResearchTrails, stepExplicitResearchTrail, clampSpatialPoint, moveSpatialPoint, MAX_SPATIAL_NODES } from "./spatialResearchModel";
import type { ResearchTrayItem } from "./terminalResearchTray";

function pin(id: string, options: Partial<ResearchTrayItem> = {}): ResearchTrayItem {
  return { id, kind: "context", view: "overview", symbol: "", title: id, description: "",
    note: "", tags: [], group: "", createdAt: 100, updatedAt: 100, ...options } as ResearchTrayItem;
}

test("Phase 2 only links pins sharing an explicitly named, nonempty research group", () => {
  const items = [
    pin("one", { group: "Research A" }), pin("two", { group: "Research A" }),
    pin("three", { group: "Research B" }), pin("four", { group: "Research A" }),
    pin("free"),
  ];
  const model = buildSpatialResearchModel(items, {});
  assert.equal(model.nodes.length, 5);
  assert.deepEqual(model.edges, [
    { fromId: "one", toId: "two", group: "Research A" },
    { fromId: "two", toId: "four", group: "Research A" },
  ]);
  assert.equal(model.edges.some(edge => edge.toId === "free"), false);
});

test("Phase 2 saved locations are bounded and malformed or non-finite coordinates never appear", () => {
  const items = [pin("bad"), pin("valid")];
  const model = buildSpatialResearchModel(items, {
    bad: { itemId: "bad", x: Number.NaN, y: 100, updatedAt: 3 },
    valid: { itemId: "valid", x: 25, y: 70, updatedAt: 3 },
  });
  assert.deepEqual(model.nodes[1].point, { x: 25, y: 70 });
  assert.ok(Number.isFinite(model.nodes[0].point.x));
  assert.deepEqual(clampSpatialPoint({ x: Infinity, y: -100 }), { x: 50, y: 10 });
});

test("Phase 2 timeline expresses saved-pin chronology, not forecast or inferred real-world dates", () => {
  const list = [pin("early", { createdAt: 10, kind: "evidence" }), pin("later", { createdAt: 20, kind: "output" })];
  const timeline = buildSpatialResearchModel(list, {
    early: { itemId: "early", x: 90, y: 50, updatedAt: 0 },
  }, "timeline");
  assert.equal(timeline.nodes[0].point.x, 12);
  assert.equal(timeline.nodes[1].point.x, 88);
  assert.equal(timeline.nodes[0].point.y < timeline.nodes[1].point.y, true);
  assert.equal(buildSpatialResearchModel([pin("only", { createdAt: 10 })], {}, "timeline").nodes[0].point.x, 50);
});

test("Phase 2 keyboard movement clamps positions and is deterministic", () => {
  const origin = { x: 50, y: 50 };
  assert.deepEqual(moveSpatialPoint(origin, "up"), { x: 50, y: 46 });
  assert.deepEqual(moveSpatialPoint(origin, "left"), { x: 46, y: 50 });
  assert.deepEqual(moveSpatialPoint({ x: 10, y: 90 }, "left"), { x: 10, y: 90 });
  assert.deepEqual(moveSpatialPoint({ x: 10, y: 90 }, "down"), { x: 10, y: 90 });
});

test("Phase 2 graph caps expensive nodes/edges without mutating source tray", () => {
  const list = Array.from({ length: MAX_SPATIAL_NODES + 10 }, (_, i) => pin(String(i), { group: "explicit" }));
  const before = structuredClone(list);
  const model = buildSpatialResearchModel(list, {});
  assert.equal(model.nodes.length, MAX_SPATIAL_NODES);
  assert.equal(model.edges.length, MAX_SPATIAL_NODES - 1);
  assert.equal(model.hiddenCount, 10);
  assert.deepEqual(list, before);
});

test("Phase 2 explicit evidence trail follows saved-pin chronology, never fabricated relationships", () => {
  const items = [
    pin("late", { group: "Deal diligence", createdAt: 50, kind: "output" }),
    pin("outside", { group: "Other group", createdAt: 2 }),
    pin("early", { group: "Deal diligence", createdAt: 10, kind: "evidence" }),
    pin("middle", { group: "Deal diligence", createdAt: 20, kind: "note" }),
    pin("ungrouped", { group: "", createdAt: 0 }),
  ];
  const model = buildSpatialResearchModel(items, {});
  const trails = buildExplicitResearchTrails(model.nodes);
  assert.deepEqual(trails, [{ group: "Deal diligence", itemIds: ["early", "middle", "late"] }]);
  assert.deepEqual(items.map(item => item.id), ["late", "outside", "early", "middle", "ungrouped"]);
});

test("Phase 2 guided trail wraps safely through real pins, including empty and stale selection", () => {
  const sequence = ["evidence", "context", "output"];
  assert.equal(stepExplicitResearchTrail(sequence, null, "next"), "evidence");
  assert.equal(stepExplicitResearchTrail(sequence, null, "previous"), "output");
  assert.equal(stepExplicitResearchTrail(sequence, "evidence", "previous"), "output");
  assert.equal(stepExplicitResearchTrail(sequence, "output", "next"), "evidence");
  assert.equal(stepExplicitResearchTrail(sequence, "missing", "next"), "evidence");
  assert.equal(stepExplicitResearchTrail([], "missing", "next"), null);
});

test("Phase 2 group trails derive only from current bounded visible research nodes", () => {
  const items = Array.from({ length: MAX_SPATIAL_NODES + 4 }, (_, i) =>
    pin(String(i), { group: i < MAX_SPATIAL_NODES ? "Visible evidence" : "Off-screen private" }));
  const model = buildSpatialResearchModel(items, {});
  const trails = buildExplicitResearchTrails(model.nodes);
  assert.deepEqual(trails.map(t => t.group), ["Visible evidence"]);
  assert.equal(trails[0].itemIds.length, MAX_SPATIAL_NODES);
  assert.equal(trails[0].itemIds.includes(String(MAX_SPATIAL_NODES)), false);
});
