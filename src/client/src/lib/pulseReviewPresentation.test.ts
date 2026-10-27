import test from "node:test";
import assert from "node:assert/strict";
import type { IntelligenceCard } from "@shared/waveDContracts";
import { normalizePulseReviewPresentation } from "./pulseReviewPresentation";

const cards = [{ id: "owned", kind: "news" }, { id: "other", kind: "research" }] as IntelligenceCard[];
test("A06 reports only saved source-backed review history and currently authorized IDs", () => {
  assert.deepEqual(normalizePulseReviewPresentation({
    status: "compared", reviewedAt: "2026-10-27T09:00:00.000Z",
    newCardIds: ["owned", "hidden-in-filter"], newCount: 2, sourceBackedCount: 3,
  }, cards), {
    status: "compared", reviewedAt: "2026-10-27T09:00:00.000Z",
    newCardIds: ["owned"], newCount: 2, sourceBackedCount: 3,
  });
  assert.deepEqual(normalizePulseReviewPresentation({
    status: "not_reviewed", reviewedAt: null, newCardIds: [], newCount: 0, sourceBackedCount: 2,
  }, cards)?.status, "not_reviewed");
});
test("A06 refuses stale, malformed or contradictory review assertions", () => {
  const stable = { status: "compared", reviewedAt: "2026-10-27T09:00:00.000Z",
    newCardIds: ["owned"], newCount: 1, sourceBackedCount: 2 };
  for (const data of [
    null, {}, { ...stable, reviewedAt: null }, { ...stable, status: "not_reviewed" },
    { ...stable, newCount: 4 }, { ...stable, newCardIds: ["owned", "owned"] },
    { ...stable, newCardIds: ["owned", "owned"], newCount: 2 },
    { ...stable, newCount: -1 }, { ...stable, newCardIds: [123] },
    { ...stable, sourceBackedCount: 121 },
  ]) assert.equal(normalizePulseReviewPresentation(data, cards), null);
});
