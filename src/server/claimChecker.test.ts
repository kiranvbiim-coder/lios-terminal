import assert from "node:assert/strict";
import test from "node:test";
import { checkClaims } from "./claimChecker";

const engine = [
  "AAPL last 227.52 USD. RSI(14) 61.3. Market cap $3.41T. Revenue growth 8.2%.",
  "Net margin 0.2431. Support 218.10, resistance 233.40. 52-week range 164.08 – 237.49.",
].join("\n");

test("figures present in the engine output are verified, including rounding and unit changes", () => {
  const prose = "AAPL trades near $227.5 with RSI of 61. Market cap is about $3.4 trillion and net margin is 24.3%. Growth was 8.2%.";
  const result = checkClaims(prose, [engine]);
  assert.deepEqual(result.unverified, []);
  assert.equal(result.ok, true);
  assert.ok(result.checked >= 5);
});

test("a seeded mismatch is caught", () => {
  const result = checkClaims("AAPL trades at $231.90 with RSI 61.3 and revenue growth of 12.5%.", [engine]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.unverified.sort(), ["$231.90", "12.5%"].sort());
});

test("years, list markers and small counts are not claims; user-supplied figures are allowed", () => {
  const prose = "1. In 2024 there were 3 risks.\n2. Your 5000 position is small.";
  assert.equal(checkClaims(prose, [engine, "User request: my 5000 position"]).ok, true);
  assert.equal(checkClaims(prose, [engine]).ok, false);
});

test("prose with no figures passes", () => {
  assert.deepEqual(checkClaims("Momentum looks constructive but valuation is stretched.", [engine]), { ok: true, checked: 0, unverified: [], unchecked: [], allFiguresChecked: true });
});

// Roadmap §0.0.12 D: reproduced claim-check weaknesses. Matching a number is not verifying a claim.
test("an explicit sign must agree with the source: −15% is not +15%", () => {
  const source = "Revenue growth +15% year over year.";
  assert.equal(checkClaims("Revenue growth was −15%.", [source]).ok, false);
  assert.equal(checkClaims("Revenue growth was -15%.", [source]).ok, false);
  assert.equal(checkClaims("Revenue growth was +15%.", [source]).ok, true);
  assert.equal(checkClaims("Revenue growth was -15%.", ["Revenue growth -15% year over year."]).ok, true);
});

test("a figure must belong to the same metric: revenue growth is not margin", () => {
  const source = "Operating margin 12.0%. Revenue growth 4.1%.";
  const wrongMetric = checkClaims("Revenue growth reached 12.0%.", [source]);
  assert.equal(wrongMetric.ok, false);
  assert.deepEqual(wrongMetric.unverified, ["12.0%"]);
  assert.equal(checkClaims("Operating margin was 12%.", [source]).ok, true);
  assert.equal(checkClaims("Growth of 4.1% was modest.", [source]).ok, true);
});

test("a currency must agree with the source: USD is not EUR at the same amount", () => {
  const source = "Revenue €42.5 billion.";
  assert.equal(checkClaims("Revenue was $42.5 billion.", [source]).ok, false);
  assert.equal(checkClaims("Revenue was 42.5 billion USD.", [source]).ok, false);
  assert.equal(checkClaims("Revenue was €42.5bn.", [source]).ok, true);
  assert.equal(checkClaims("Revenue was 42.5 billion EUR.", [source]).ok, true);
});

test("unsupported small counts are reported as unchecked instead of implying full verification", () => {
  const result = checkClaims("The company completed 3 acquisitions.", [engine]);
  assert.equal(result.checked, 0);
  assert.deepEqual(result.unchecked, ["3"]);
  assert.equal(result.allFiguresChecked, false);
  const supported = checkClaims("There are 3 segments.", ["Segments: 3 reportable segments."]);
  assert.deepEqual(supported.unchecked, []);
  assert.equal(supported.allFiguresChecked, true);
});
