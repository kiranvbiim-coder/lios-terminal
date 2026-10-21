import test from "node:test";
import assert from "node:assert/strict";
import {
  formatReadableNumber, formatReadableScalar, heatBackground, heatIntensity, humanizeKey, modelDisplayName,
  provenanceTrustLabel, readableRows, validationTrustLabel,
} from "./artifactReadableFormat";
import { parseSensitivityGrid } from "../components/terminal/SensitivityGridTable";
import { dcfSensitivityOutputs, dcfSensitivityParameters } from "../components/terminal/dcfSensitivityArtifact.fixture";

test("keys become plain-language labels with finance acronyms", () => {
  assert.equal(humanizeKey("netDebt"), "Net debt");
  assert.equal(humanizeKey("waccPct"), "WACC");
  assert.equal(humanizeKey("terminalGrowthPct"), "Terminal growth");
  assert.equal(humanizeKey("pvTerminalValue"), "PV of terminal value");
  assert.equal(humanizeKey("same_as_free_cash_flows_and_net_debt"), "Same as free cash flows and net debt");
  assert.equal(humanizeKey("dcf-sensitivity"), "DCF sensitivity");
  assert.equal(humanizeKey("ebitdaMarginPct"), "EBITDA margin");
});

test("display formatting never changes the stored value and keeps the exact text", () => {
  const perShare = formatReadableNumber("valuePerShare", 71.370824940136);
  assert.equal(perShare.text, "71.37 per share");
  assert.equal(perShare.exact, "71.370824940136");
  assert.equal(formatReadableNumber("valuePerShare", 71.370824940136, { showExact: true }).text, "71.370824940136 per share");
  assert.equal(formatReadableNumber("valuePerShare", 71.370824940136, { bare: true }).text, "71.37");
  assert.equal(formatReadableNumber("waccPct", 9.5).text, "9.5%");
  assert.equal(formatReadableNumber("maxDrawdownPct", -12.5).text, "-12.5%");
  assert.equal(formatReadableNumber("enterpriseValue", 2_500_000_000).text, "2.5 billion");
  assert.equal(formatReadableNumber("enterpriseValue", 2_500_000_000).exact, "2500000000");
  assert.equal(formatReadableNumber("enterpriseValue", 1598.583234946871).text, "1,598.58");
  assert.equal(formatReadableNumber("enterpriseValue", 1598.583234946871).exact, "1598.583234946871");
  assert.equal(formatReadableNumber("count", 12).exact, null);
});

test("exact decimal text and hashes are not coerced through floats", () => {
  assert.deepEqual(formatReadableScalar("revenue", "9007199254740993.25"), { text: "9007199254740993.25", exact: null });
  const hash = "c".repeat(64);
  assert.deepEqual(formatReadableScalar("outputSnapshotHash", hash), { text: `${hash.slice(0, 10)}…${hash.slice(-6)}`, exact: hash });
  assert.equal(formatReadableScalar("terminalMethod", "gordon_growth").text, "Gordon growth");
  assert.equal(formatReadableScalar("flag", true).text, "Yes");
  assert.equal(formatReadableScalar("exitMultiple", null).text, "Not recorded");
});

test("recorded objects flatten into labelled rows without JSON", () => {
  const rows = readableRows(dcfSensitivityParameters);
  const byLabel = new Map(rows.map(row => [row.label, row]));
  assert.equal(byLabel.get("Net debt")?.text, "50");
  assert.equal(byLabel.get("Free cash flows")?.text, "100, 110, 120");
  assert.equal(byLabel.get("WACC grid")?.text, "9%, 10%, 11%");
  assert.equal(byLabel.get("Bear case › WACC")?.text, "11%");
  assert.equal(byLabel.get("Bear case › Free cash flows")?.text, "90, 95, 100");
  for (const row of rows) assert.doesNotMatch(`${row.label} ${row.text}`, /[{}\[\]"]/);
  const nested = readableRows({ a: { b: { c: { d: { e: 1 } } } } });
  assert.doesNotMatch(nested.map(row => row.text).join(" "), /[{}]/);
});

test("classification and reference counts cannot promote unverified custody to a verified trust tone", () => {
  for (const classification of ["live", "delayed", "historical", "cached"]) {
    assert.equal(provenanceTrustLabel(classification, 0).tone, "caution");
    assert.equal(provenanceTrustLabel(classification).tone, "caution");
    assert.equal(provenanceTrustLabel(classification, 3).tone, "neutral");
  }
  assert.equal(provenanceTrustLabel("manual", 0).tone, "neutral");
  assert.equal(provenanceTrustLabel("fallback", 1).tone, "caution");
  assert.equal(validationTrustLabel("known_answer")?.tone, "neutral");
  assert.equal(validationTrustLabel("benchmark_required")?.tone, "caution");
  assert.equal(validationTrustLabel("something_new"), null);
});

test("sensitivity grid parsing accepts the real engine grid and rejects inconsistent shapes", () => {
  const grid = parseSensitivityGrid(dcfSensitivityOutputs.sensitivity);
  assert.ok(grid);
  assert.deepEqual(grid.rowValues, [9, 10, 11]);
  assert.deepEqual(grid.columnValues, [2, 3, 4]);
  assert.equal(grid.matrix[1][1], 71.370824940136);
  assert.equal(grid.rowKey, "waccPct");
  assert.equal(parseSensitivityGrid({ waccPct: [9, 10], terminalGrowthPct: [2], valuePerShareMatrix: [[1]] }), null);
  assert.equal(parseSensitivityGrid({ waccPct: [9], terminalGrowthPct: [2], valuePerShareMatrix: [["x"]] }), null);
  assert.equal(parseSensitivityGrid(null), null);
});

test("heat shading is monotonic and safe for degenerate ranges", () => {
  assert.equal(heatIntensity(5, 5, 5), 0);
  assert.equal(heatIntensity(10, 0, 10), 1);
  assert.ok(heatIntensity(7, 0, 10) > heatIntensity(3, 0, 10));
  assert.notEqual(heatBackground(0), heatBackground(1));
});

test("small magnitudes are never rounded to zero and only allow-listed keys are money", () => {
  const cost = formatReadableNumber("costImpact", 0.0012);
  assert.equal(cost.text, "0.0012");
  assert.equal(formatReadableNumber("capRate", 0.045).text, "0.045");
  assert.equal(formatReadableNumber("cashConversion", 0.9876543).text, "0.9877");
  assert.equal(formatReadableNumber("cashConversion", 0.9876543).exact, "0.9876543");
  assert.equal(formatReadableNumber("flowRatio", 1234567).text, "1,234,567");
  assert.equal(formatReadableNumber("valuePerShare", 0.000123, { bare: true }).text, "0.000123");
  assert.equal(formatReadableNumber("slippagePct", 0.00001234).text, "0.00001234%");
  assert.equal(formatReadableNumber("slippagePct", 0.00001234).exact, "0.00001234");
  assert.equal(formatReadableNumber("slippageBps", 0.004).text, "0.004 bps");
  const small = formatReadableNumber("netDebt", 0.0004567);
  assert.equal(small.text, "0.0004567");
  assert.equal(formatReadableNumber("netDebt", 2_500_000_000).text, "2.5 billion");
  assert.equal(formatReadableNumber("costImpact", 2_500_000_000).text, "2,500,000,000");
  assert.equal(formatReadableNumber("valuation", 1_500_000).text, "1,500,000");
  assert.equal(formatReadableNumber("costImpact", 0.0012, { showExact: true }).text, "0.0012");
});

test("currencies sharing a dollar symbol retain distinct ISO identities", () => {
  const labels = ["USD", "CAD", "AUD", "SGD"].map(currency => formatReadableNumber("enterpriseValue", 3200000, { currency }).text);
  assert.equal(new Set(labels).size, 4);
  for (const [index, currency] of ["USD", "CAD", "AUD", "SGD"].entries()) assert.ok(labels[index].includes(currency));
});
