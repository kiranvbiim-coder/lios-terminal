import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as ts from "typescript";

const panel = readFileSync(new URL("../components/panels/NewsPanel.tsx", import.meta.url), "utf8");
const evolution = readFileSync(new URL("../components/panels/NewsStoryEvolution.tsx", import.meta.url), "utf8");


test("both real TSX screens parse without syntax errors", () => {
  for (const [name, content] of [["NewsPanel", panel], ["NewsStoryEvolution", evolution]] as const) {
    const result = ts.transpileModule(content, {
      fileName: name + ".tsx",
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, " ")), [], name + " invalid TSX");
  }
});
