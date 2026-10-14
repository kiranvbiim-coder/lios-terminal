import test from "node:test";
import assert from "node:assert/strict";
import {
  interpretAdvanceDecline,
  interpretHighLow,
  interpretMcClellan,
  interpretTrin,
} from "./marketBreadthSignals";

test("advance/decline interpretation follows constituent direction without hidden thresholds", () => {
  assert.deepEqual(interpretAdvanceDecline(13, 22), {
    label: "DECLINERS +9",
    detail: "More constituents declined than advanced",
    tone: "negative",
  });
  assert.equal(interpretAdvanceDecline(20, 20).tone, "neutral");
  assert.equal(interpretAdvanceDecline(24, 11).tone, "positive");
});

test("high/low interpretation reports the observed balance only", () => {
  assert.equal(interpretHighLow(4, 1).label, "HIGHS +3");
  assert.equal(interpretHighLow(1, 5).label, "LOWS +4");
  assert.equal(interpretHighLow(0, 0).label, "BALANCED");
});

test("TRIN interpretation uses the definitionally neutral level of one", () => {
  assert.equal(interpretTrin(0.791).label, "ADVANCER VOLUME LEAD");
  assert.equal(interpretTrin(1).label, "BALANCED VOLUME");
  assert.equal(interpretTrin(1.2).label, "DECLINER VOLUME LEAD");
  assert.equal(interpretTrin(null).tone, "unavailable");
  assert.equal(interpretTrin(Number.NaN).tone, "unavailable");
});

test("McClellan interpretation reports oscillator sign without full-market textbook thresholds", () => {
  assert.equal(interpretMcClellan(-0.98).label, "MOMENTUM CONTRACTING");
  assert.equal(interpretMcClellan(0).label, "MOMENTUM FLAT");
  assert.equal(interpretMcClellan(0.25).label, "MOMENTUM EXPANDING");
  assert.equal(interpretMcClellan(undefined).tone, "unavailable");
});
