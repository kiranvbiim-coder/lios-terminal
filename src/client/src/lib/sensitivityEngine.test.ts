import { test } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetGrid } from "./spreadsheetEngine";
import { runOneWaySensitivity, runTwoWaySensitivity, runTornadoSensitivity, buildInputRange } from "./sensitivityEngine";

function approxEqual(a: number, b: number, tol = 1e-9) {
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);
}

test("buildInputRange: generates an evenly-spaced series from min to max across the given number of steps", () => {
  assert.deepEqual(buildInputRange(0, 100, 5), [0, 25, 50, 75, 100]);
  assert.deepEqual(buildInputRange(10, 10, 3), [10, 10, 10]);
  assert.deepEqual(buildInputRange(5, 9, 1), [5]);
});

test("runOneWaySensitivity: recalculates the output for every input value and restores the input cell afterward", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "10");        // input
  g.setCell("B1", "=A1*2+1");   // output, a simple linear function of the input

  const result = runOneWaySensitivity(g, "A1", [0, 5, 10, 20], "B1");
  assert.deepEqual(result.outputs.map((o) => o.value), [1, 11, 21, 41]);

  // The input cell must be exactly what it was before the sweep.
  assert.equal(g.getCell("A1").raw, "10");
  approxEqual(g.getCell("A1").value as number, 10);
  approxEqual(g.getCell("B1").value as number, 21); // recalculated back to the original input's output
});

test("runOneWaySensitivity: sweeping through a value that would divide by zero surfaces the error for that trial without breaking the rest", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "5");
  g.setCell("B1", "=10/A1");

  const result = runOneWaySensitivity(g, "A1", [1, 0, 2], "B1");
  approxEqual(result.outputs[0].value as number, 10);
  assert.equal(result.outputs[1].error, "#DIV/0!");
  approxEqual(result.outputs[2].value as number, 5);
});

test("runOneWaySensitivity: a formula that reaches the input cell only through a named range still recalculates correctly", () => {
  const g = new SpreadsheetGrid();
  g.setCell("C1", "8"); // the cell the name is bound to
  g.defineName("WACC", "$C$1");
  g.setCell("B1", "=100/WACC");

  const result = runOneWaySensitivity(g, "C1", [4, 8, 10], "B1");
  approxEqual(result.outputs[0].value as number, 25);
  approxEqual(result.outputs[1].value as number, 12.5);
  approxEqual(result.outputs[2].value as number, 10);
  assert.equal(g.getCell("C1").raw, "8");
});

test("runTwoWaySensitivity: produces a full row x col grid of outputs and restores both input cells", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "2");
  g.setCell("A2", "3");
  g.setCell("B1", "=A1*A2");

  const result = runTwoWaySensitivity(g, "A1", [1, 2], "A2", [10, 20, 30], "B1");
  assert.deepEqual(result.outputs.map((row) => row.map((c) => c.value)), [
    [10, 20, 30],
    [20, 40, 60],
  ]);
  assert.equal(g.getCell("A1").raw, "2");
  assert.equal(g.getCell("A2").raw, "3");
});

test("runTornadoSensitivity: ranks inputs by output swing magnitude, largest first, holding all other inputs at their sheet value", () => {
  const g = new SpreadsheetGrid();
  g.setCell("A1", "100"); // big swing input
  g.setCell("A2", "5");   // small swing input
  g.setCell("B1", "=A1+A2");

  const result = runTornadoSensitivity(g, [
    { ref: "A1", label: "Revenue", lowValue: 50, highValue: 150 },   // swing = 100
    { ref: "A2", label: "Fee Rate", lowValue: 4, highValue: 6 },     // swing = 2
  ], "B1");

  assert.equal(result[0].label, "Revenue");
  approxEqual(result[0].swing, 100);
  assert.equal(result[1].label, "Fee Rate");
  approxEqual(result[1].swing, 2);

  // Every input was tested with the OTHERS held at their real sheet value:
  // Revenue's low/high used A2's actual value of 5, not some other trial value.
  approxEqual(result[0].low.value as number, 55);  // 50 + 5
  approxEqual(result[0].high.value as number, 155); // 150 + 5

  assert.equal(g.getCell("A1").raw, "100");
  assert.equal(g.getCell("A2").raw, "5");
});
