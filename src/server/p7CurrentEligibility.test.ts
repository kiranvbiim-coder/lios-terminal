import test from "node:test";
import assert from "node:assert/strict";
import type { P7InsightLens } from "@shared/p7ResearchContracts";
import { retainPermittedProjectInsights } from "./p7ProjectIntelligence";
const lens: P7InsightLens = {
  schemaVersion: "1", projectId: 19, generatedAt: "2026-10-27T00:00:00Z",
  counts: { change: 2, risk: 1, contradiction: 1 },
  insights: [
    { id: "kept", title: "Active source", summary: "Retained", kind: "change", severity: "info",
      sourceRefs: ["source:active"], entityRefs: [], deterministic: true, occurredAt: null },
    { id: "revoked", title: "Archived source", summary: "Revoked",
      kind: "change", severity: "watch", sourceRefs: ["source:archived"], entityRefs: [], deterministic: true, occurredAt: null },
    { id: "mixed", title: "Referenced source became excluded", summary: "Mixed",
      kind: "risk", severity: "material", sourceRefs: ["source:active","source:excluded"], entityRefs: [], deterministic: true, occurredAt: null },
    { id: "snapshot-only", title: "Old change delta", summary: "Snapshot is not current rights",
      kind: "contradiction", severity: "watch", sourceRefs: ["source:old-snapshot"], entityRefs: [], deterministic: true, occurredAt: null },
  ],
};
test("current P7 lens removes revoked snapshot delta and mixed source findings, recomputes counts", () => {
  const before = structuredClone(lens);
  const current = retainPermittedProjectInsights(lens, new Set(["source:active"]));
  assert.deepEqual(current.insights.map(x=>x.id),["kept"]);
  assert.deepEqual(current.counts, { change: 1 });
  assert.deepEqual(lens, before, "historical source object must remain unchanged");
});
test("no current refs means no current insights, not a resurrected old title", () => {
  const current = retainPermittedProjectInsights(lens, new Set());
  assert.deepEqual(current.insights,[]);
  assert.deepEqual(current.counts,{});
});
