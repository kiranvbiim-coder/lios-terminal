import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as ts from "typescript";

const component = (name: string) =>
  readFileSync(new URL("../components/terminal/" + name + ".tsx", import.meta.url), "utf8");

test("Sprint D: graphical overlays and market component must parse as real TypeScript JSX", () => {
  for (const name of ["ProvenanceDrawer", "AnalyticalStudio", "GraphExplorer", "FusionMarketCanvas"]) {
    const src = component(name);
    const result = ts.transpileModule(src, {
      fileName: name + ".tsx",
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")), [], name + " invalid JSX");
  }
});

test("Sprint D: stored comparison consent never propagates to new A/B captures or missing receipts", () => {
  const ui = component("AnalyticalStudio");
  assert.match(ui, /comparisonReviewKey\(leftSnapshot, rightSnapshot\)/);
  assert.match(ui, /reviewedPairKey === pairKey/);
  assert.match(ui, /resolveRecordedReceiptPair\(evidence.receipts, receiptA, receiptB\)/);
  assert.match(ui, /diffCalculationReceipts\(actualReceipts\[0\], actualReceipts\[1\]\)/);
  assert.match(ui, /context.kind === "cross-context" && pairKey !== null/);
  assert.doesNotMatch(ui, /Math\.min\(receiptA|Math\.min\(receiptB/);
});

test("Sprint D: performance measures do not introduce a new animation or market data owner", () => {
  const market = component("FusionMarketCanvas");
  assert.match(market, /EMPTY_BREADTH_SERIES/);
  assert.match(market, /RECORDED OBSERVATIONS/);
  assert.match(market, /SESSION_LABEL\[item\]/);
  assert.match(market, /Ranges count recorded trading sessions/);
  assert.match(market, /recordedBreadthRows\(series, points\)/);
  assert.doesNotMatch(market, /setInterval\(|requestAnimationFrame\(|fetch\(/);
});
