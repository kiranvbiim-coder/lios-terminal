import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const screen = (name: string) =>
  readFileSync(new URL("../components/terminal/" + name + ".tsx", import.meta.url), "utf8");

test("Sprint B graph relationships are filtered from the existing recorded Intelligence Object store", () => {
  const ui = screen("GraphExplorer");
  const selector = readFileSync(new URL("./graphExplorerPresentation.ts", import.meta.url), "utf8");
  assert.match(ui, /loadIntelligenceObjects\(/);
  assert.match(ui, /buildCrossDomainGraph\(graphObjects\)/);
  assert.match(ui, /Filter recorded relationship type/);
  assert.match(ui, /relation: relation \|\| undefined/);
  assert.match(ui, /graphNodeConnections\(graph, selected\.id\)\.filter/);
  assert.match(selector, /relationEdges = settings\.relation \? graph\.edges\.filter/);
  assert.match(selector, /participating\.has\(node\.objectId\)/);
  assert.doesNotMatch(ui, /fetch\(|apiRequest\(|runPython\(/);
});

test("Sprint B source review reads only published evidence and never computes a synthetic trust score", () => {
  const ui = screen("ProvenanceDrawer");
  assert.match(ui, /getEvidenceSnapshot\(/);
  assert.match(ui, /subscribeEvidence\(setSnapshot\)/);
  assert.match(ui, /filterPublishedSources\(/);
  assert.match(ui, /safePublishedSourceUrl\(item\.sourceUrl\)/);
  assert.match(ui, /noopener noreferrer/);
  assert.match(ui, /not independent verification/);
  assert.doesNotMatch(ui, /fetch\(|apiRequest\(/);
});

test("Sprint B provenance panel is parseable TSX before checking only source-text invariants", () => {
  // Source-grep tests passed while a missing JSX expression brace broke both tsc
  // and the production build. The TypeScript parser catches that regression here.
  const ui = screen("ProvenanceDrawer");
  const compiled = ts.transpileModule(ui, {
    fileName: "ProvenanceDrawer.tsx",
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  const errors = (compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")), []);
  assert.match(ui, /\{tab === "sources" && <div/);
  assert.match(ui, /\{visibleSources\.length\} of \{review\.recorded\} recorded sources shown/);
});

test("Analytical Studio compares only the exact explicitly reviewed capture pair and distinct recorded receipts", () => {
  const ui = screen("AnalyticalStudio");
  const parsed = ts.transpileModule(ui, {
    fileName: "AnalyticalStudio.tsx",
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  assert.deepEqual((parsed.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error)
    .map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")), []);
  assert.match(ui, /comparisonReviewKey\(leftSnapshot, rightSnapshot\)/);
  assert.match(ui, /reviewedPairKey === pairKey/);
  assert.match(ui, /expandedPairKey === pairKey/);
  assert.match(ui, /resolveRecordedReceiptPair\(evidence\.receipts, receiptA, receiptB\)/);
  assert.match(ui, /useState<string \| null>\(\(\) => getEvidenceSnapshot\(\)\.receipts\[0\]\?\.id/);
  assert.match(ui, /useState<string \| null>\(\(\) => getEvidenceSnapshot\(\)\.receipts\[1\]\?\.id/);
  assert.match(ui, /<option key=\{item\.id\} value=\{item\.id\}>/);
  assert.match(ui, /Previously selected receipt unavailable/);
  assert.match(ui, /evidence\.receipts\.length > 0 \|\| receiptA !== null \|\| receiptB !== null/);
  assert.match(ui, /export function ReceiptSelect\(/);
  assert.doesNotMatch(ui, /Math\.min\(receiptA|Math\.min\(receiptB|setAllowCrossContext/);
});

test("Sprint B comparisons and rich insights stay on the canonical capture and receipt surfaces", () => {
  const ui = screen("AnalyticalStudio");
  assert.match(ui, /describeSnapshotPair\(/);
  assert.match(ui, /context\.kind === "same-context"/);
  assert.match(ui, /allowCrossContext/);
  assert.match(ui, /Record(?:ed|ed insight) change/i);
  assert.match(ui, /RecordedAnalyticalDifference/);
  assert.match(ui, /diffCalculationReceipts\(/);
  assert.match(ui, /warningsAdded/);
  assert.match(ui, /warningsRemoved/);
  assert.doesNotMatch(ui, /fetch\(|apiRequest\(|runPython\(/);
});
