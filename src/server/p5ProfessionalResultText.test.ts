import assert from "node:assert/strict";
import test from "node:test";
import { buildP5ProfessionalResultText } from "./p5ProfessionalExecution";

const input = {
  label: "Valuation", modelPath: "valuation/dcf-sensitivity", symbol: "TEST",
  result: { scenarios: {
    bear: { valuePerShare: 57.94959481828568, waccPct: 11, terminalGrowthPct: 1 },
    base: { valuePerShare: 71.370824940136, waccPct: 10, terminalGrowthPct: 2 },
    bull: { valuePerShare: 93.59872295241708, waccPct: 9, terminalGrowthPct: 3 },
  } }, validationLevel: "known_answer", dataClassification: "manual", savedToProject: true,
};

test("professional result projects the recorded scenario values without changing them", () => {
  const original = structuredClone(input);
  const text = buildP5ProfessionalResultText(input);
  const rows = text.split("\n").filter(line => /^\| (Bear|Base|Bull) \|/.test(line));
  assert.deepEqual(rows.map(line => line.split("|").slice(1, 5).map(cell => cell.trim())), [
    ["Bear", "57.95", "11%", "1%"], ["Base", "71.37", "10%", "2%"], ["Bull", "93.60", "9%", "3%"],
  ]);
  assert.deepEqual(input, original);
});

test("missing scenario values are not calculated or fabricated by presentation", () => {
  const text = buildP5ProfessionalResultText({ ...input, result: { scenarios: { base: { valuePerShare: 12 } } } });
  assert.equal(text.split("\n").some(line => /^\| (Bear|Base|Bull) \|/.test(line)), false);
});
