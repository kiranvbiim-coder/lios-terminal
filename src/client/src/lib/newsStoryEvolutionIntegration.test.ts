import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as ts from "typescript";

const panel = readFileSync(new URL("../components/panels/NewsPanel.tsx", import.meta.url), "utf8");
const evolution = readFileSync(new URL("../components/panels/NewsStoryEvolution.tsx", import.meta.url), "utf8");

test("Story Evolution renders in the real News read-through, not a disconnected demo", () => {
  assert.match(panel, /<NewsStoryEvolution exactUrl=\{selectedItem\.url\} history=\{observedRevisions\}/);
  assert.match(panel, /observeNewsFeed\(current, news, newsQuery\.dataUpdatedAt\)/);
  assert.match(panel, /newsQuery\.isSuccess/);
  // The read-through must reject delayed image rechecks after A→B→A selection
  // changes, including when artifact state changes selection outside a card click.
  assert.match(panel, /activeNewsStoryRef\.current !== selectedStoryUrl/);
  assert.match(panel, /\[selectedStoryUrl\]/);
  assert.match(panel, /onSelect=\{\(\) => \{/);
  assert.match(panel, /newsQuery\.isError \? \(/);
  assert.match(panel, /Retry news/);
  assert.match(panel, /recheckGenerationRef\.current\+\+/);
  assert.match(panel, /generation !== recheckGenerationRef\.current/);
  assert.match(panel, /safePulseSourceUrl\(selectedItem\.url\)/);
  assert.match(panel, /Read original publisher/);
  assert.match(panel, /rel="noopener noreferrer"/);
  assert.match(evolution, /same article URL only|Same article URL only/);
  assert.doesNotMatch(evolution, /Math\.random\(|fetch\(|setInterval\(/);
});

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
