import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const screen = (name: string) =>
  readFileSync(new URL("../components/terminal/" + name + ".tsx", import.meta.url), "utf8");


test("Sprint B provenance panel is parseable TSX", () => {
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
});

test("Analytical Studio is parseable TSX", () => {
  const ui = screen("AnalyticalStudio");
  const parsed = ts.transpileModule(ui, {
    fileName: "AnalyticalStudio.tsx",
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  assert.deepEqual((parsed.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error)
    .map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")), []);
});
