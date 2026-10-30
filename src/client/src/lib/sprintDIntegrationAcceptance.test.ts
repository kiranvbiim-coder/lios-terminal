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

