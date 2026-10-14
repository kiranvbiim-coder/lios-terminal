import test from "node:test";
import assert from "node:assert/strict";
import { appendSentimentObservation, summarizeSentimentHistory } from "./sentimentHistory";

const DAY = 24 * 60 * 60 * 1000;

test("sentiment observations are de-duplicated inside the sampling interval", () => {
  const first = appendSentimentObservation([], { at: 1_000_000, score: 40 });
  const second = appendSentimentObservation(first, { at: 1_060_000, score: 42 });
  assert.equal(second.length, 1);
  assert.equal(second[0].score, 42);
  assert.equal(second[0].at, first[0].at, "sampling bucket keeps its original timestamp");

  const unchanged = appendSentimentObservation(second, { at: 1_120_000, score: 42 });
  assert.deepEqual(unchanged, second, "identical observations inside the bucket are idempotent");

  const third = appendSentimentObservation(second, { at: 1_301_000, score: 45 });
  assert.equal(third.length, 2, "a new bucket is created after the sampling interval");
});

test("invalid sentiment samples are rejected without corrupting observed history", () => {
  const history = [{ at: 1_000_000, score: 50 }];
  assert.deepEqual(appendSentimentObservation(history, { at: 1_400_000, score: 101 }), history);
  assert.deepEqual(appendSentimentObservation(history, { at: Number.NaN, score: 40 }), history);
});

test("historical summary uses observed points and returns null when history does not exist", () => {
  const now = 100 * DAY;
  const history = [
    { at: now - 30 * DAY, score: 35 },
    { at: now - 7 * DAY, score: 60 },
    { at: now - DAY, score: 50 },
    { at: now - DAY / 2, score: 48 },
    { at: now - DAY / 4, score: 44 },
  ];
  const summary = summarizeSentimentHistory(history, { at: now, score: 41 });
  assert.equal(summary.dayAgo?.score, 50);
  assert.equal(summary.weekAgo?.score, 60);
  assert.equal(summary.monthAgo?.score, 35);
  assert.equal(summary.sevenDayChange, -19);
  assert.equal(summary.percentile, 20);

  const empty = summarizeSentimentHistory([], { at: now, score: 41 });
  assert.equal(empty.dayAgo, null);
  assert.equal(empty.percentile, null);
});
