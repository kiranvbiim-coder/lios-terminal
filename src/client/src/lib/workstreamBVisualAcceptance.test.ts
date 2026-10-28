import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GraphExplorerCompactList } from "../components/terminal/GraphExplorerCompactList";
import { safePublicSourceUrl } from "@shared/publicSourceUrl";

const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

test("B07 cross-domain bridge UI exposes only explicit visible edges and recorded notes", () => {
  const graph = source("../components/terminal/GraphExplorer.tsx");
  const pure = source("./graphExplorerPresentation.ts");
  assert.match(graph, /recorded-cross-domain-bridge-inspector/);
  assert.match(graph, /source\.domain !== target\.domain/);
  assert.match(graph, /edge\.explanation/);
  assert.match(graph, /selectAndFocus\(edge\.sourceId\)/);
  assert.match(graph, /source\.label/);
  assert.match(graph, /Domains are inferred display labels/);
  assert.match(pure, /settings\.bridgesOnly\s*\?\s*relationEdges\.filter/);
  assert.match(pure, /settings\.relation \|\| settings\.bridgesOnly/);
  assert.match(pure, /eligibleEdges\.filter\(edge => shown\.has/);
});
test("B08 graph distribution counts existing links, with accessible meters and no synthetic charts", () => {
  const graph = source("../components/terminal/GraphExplorer.tsx");
  const pure = source("./graphExplorerPresentation.ts");
  assert.match(graph, /recorded-graph-relationship-distribution/);
  assert.match(graph, /summarizeRecordedGraphLinks/);
  assert.match(graph, /aria-valuenow=\{count\}/);
  assert.match(graph, /Counts are not influence, consensus, strength or verified exposure/);
  assert.match(pure, /counts\.set\(edge\.relation, \(counts\.get\(edge\.relation\) \?\? 0\) \+ 1\)/);
  assert.doesNotMatch(graph, /Math\.random\(|generateSyntheticData|new Worker\(/);
});
test("B09 works at narrower effective viewports, respects reduced motion and uses source-safe navigation", () => {
  const graph = source("../components/terminal/GraphExplorer.tsx");
  const compact = source("../components/terminal/GraphExplorerCompactList.tsx");
  const p7 = source("../components/terminal/ProjectEvidenceGraph.tsx");
  const sankey = source("../components/panels/RecordedEvidenceSankey.tsx");
  for (const text of [graph,compact,p7]) assert.doesNotMatch(text,/text-\[(?:6|7|8|9|10|11)px\]/);
  assert.match(graph, /max-h-\[48vh\].*overflow-y-auto/);
  assert.match(graph, /grid-rows-\[minmax\(200px,1fr\)_minmax\(160px,0\.6fr\)\] overflow-y-auto/);
  assert.match(graph, /motion-reduce:transition-none/);
  assert.match(graph, /safePublicSourceUrl\(selected\.source\.sourceUrl\)/);
  assert.match(graph, /rel="noopener noreferrer"/);
  assert.match(graph, /referrerPolicy="no-referrer"/);
  assert.match(sankey, /aria-hidden="true"/);
  assert.ok(!sankey.includes('role="img"'));
  assert.equal(safePublicSourceUrl("https://example.org/file?access_token=secret"),null);
  assert.equal(safePublicSourceUrl("https://user:secret@example.org/file"),null);
  assert.equal(safePublicSourceUrl("https://example.org/source"),"https://example.org/source");
});
test("B09 fallback remains keyboard selectable with semantic graph objects",()=>{
  const html=renderToStaticMarkup(React.createElement(GraphExplorerCompactList,{
    nodes:[{objectId:"source-1",label:"Recorded policy filing",domain:"policy",strength:.5}],
    selectedId:"source-1",onSelect:()=>{},emptyMessage:"No records",
  }));
  assert.match(html,/Compact Intelligence Graph/);
  assert.match(html,/Recorded policy filing/);
  assert.match(html,/aria-pressed="true"/);
  assert.match(html,/<button/);
  assert.doesNotMatch(html,/No records/);
});

test("B09 active Visual News, World, Perspectives and Data Fabric panes use readable minimum type",()=>{
  for(const path of [
    "../components/panels/EconomicDataFabricPanel.tsx",
    "../components/panels/MarketDataFabricPanel.tsx",
    "../components/panels/NewsStoryEvolution.tsx",
    "../components/panels/RecordedPerspectivesBoard.tsx",
    "../components/terminal/OfflineProjectWorldMap.tsx",
  ]) {
    assert.doesNotMatch(source(path),/text-\[(?:6|7|8|9|10|11)px\]/,"tiny chart/pane typography in "+path);
  }
});
