import test from "node:test";
import assert from "node:assert/strict";
import { relatedNewsCoverage } from "./newsRelatedCoverage";
import type { NewsStoryObservation } from "./newsStoryEvolution";

const base: NewsStoryObservation = {
  url: "https://publisher-one.example.com/solar-report",
  title: "Solar battery innovation expands factories",
  summary: "Solar growth",
  source: "Publisher One",
  publishedAt: "2026-10-27T08:00:00.000Z",
};
test("related coverage links real different-source headlines without claiming the same event", () => {
  const shared = { ...base, url: "https://publisher-two.example.com/solar",
    title: "Solar battery innovation attracts investment", source: "Publisher Two" };
  const result = relatedNewsCoverage(base, [base, shared]);
  assert.deepEqual(result, [shared]);
  assert.equal(result[0]?.url, shared.url);
});

test("refuses generic terms, sole-keyword coincidences, unrelated times, same source and secret links", () => {
  const same = { ...base, url: "https://publisher-one.example.com/next" };
  const later = { ...base, source: "Publisher Two", url: "https://two.example.com/later",
    publishedAt: "2026-10-31T08:00:00.000Z" };
  const alone = { ...base, title: "Solar trade talks", url: "https://two.example.com/alone", source: "Publisher Two" };
  const unsafe = { ...base, url: "https://two.example.com/x?api_key=secret", source: "Publisher Two" };
  const distinct = { ...base, title: "Markets new report", url: "https://two.example.com/other", source: "Publisher Two" };
  assert.deepEqual(relatedNewsCoverage(base, [same, later, alone, unsafe, distinct]), []);
  assert.deepEqual(relatedNewsCoverage({ ...base, title: "Stock market rises today" }, [alone]), []);
});

