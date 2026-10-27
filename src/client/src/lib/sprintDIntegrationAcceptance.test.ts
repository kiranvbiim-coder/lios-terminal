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

test("Sprint D: main analytical modal traps focus while the nonmodal evidence drawer does not", () => {
  const studio = component("AnalyticalStudio");
  const drawer = component("ProvenanceDrawer");
  const hook = readFileSync(new URL("../hooks/useManagedOverlayFocus.ts", import.meta.url), "utf8");
  // Radix Dialog now owns the focus trap and Escape behavior for this modal;
  // do not install a competing manual focus trap over its primitive.
  assert.match(studio, /<Dialog open onOpenChange=\{open => \{ if \(!open\) onClose\(\); \}\}>/);
  assert.match(studio, /<DialogContent/);
  assert.match(studio, /onCloseAutoFocus=\{event => \{ event\.preventDefault\(\); if \(opener\?\.isConnected\) opener\.focus\(\); \}\}/);
  assert.doesNotMatch(studio, /useManagedOverlayFocus\(onClose, true\)/);
  assert.match(drawer, /useManagedOverlayFocus\(onClose, false\)/);
  assert.match(drawer, /aria-modal="false"/);
  assert.match(hook, /event\.key === "Escape"/);
  assert.match(hook, /event\.key !== "Tab" \|\| !modal/);
  assert.match(hook, /if \(previous\?\.isConnected\) previous\.focus\(\)/);
  assert.match(drawer, /NO SOURCE METADATA PUBLISHED YET/i);
  assert.match(drawer, /NO CALCULATION RECEIPTS PUBLISHED YET/i);
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
