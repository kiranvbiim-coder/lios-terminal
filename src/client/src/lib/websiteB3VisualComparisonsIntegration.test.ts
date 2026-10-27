import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path:string){return readFileSync(new URL(path,import.meta.url),"utf8");}

test("B3 uses exactly the existing authorized Investigation detail, group filters, and comparison selection",()=>{
  const explorer=source("../components/panels/PerspectivesExplorer.tsx");
  const board=source("../components/panels/RecordedPerspectivesBoard.tsx");
  const flow=source("../components/panels/RecordedEvidenceFlowPanel.tsx");
  assert.match(explorer,/\/api\/research\/investigations\/\$\{activeId\}/);
  assert.match(explorer,/selectedDetail\.evidence/);
  assert.match(explorer,/selectedDetail\.relationships/);
  assert.match(board,/const model = buildPerspectiveModel\(evidence, relationships\)/);
  assert.match(board,/const filtered = filterPerspectiveLinks\(model\.links, search, group\)/);
  assert.match(board,/<RecordedEvidenceFlowPanel links=\{filtered\} selectedId=\{selected\?\.id \?\? null\} onSelect=\{setFocusedId\}/);
  assert.match(board,/PerspectiveSource item=\{selected\.from\}/);
  assert.match(board,/PerspectiveSource item=\{selected\.to\}/);
  assert.match(flow,/const \[open, setOpen\] = useState\(false\)/);
  assert.match(flow,/onSelect\(row\.id\)/);
  assert.doesNotMatch(flow,/fetch\(|new WebSocket|createRelationship\(|saveArtifact\(|sendMessage\(/);
});

test("existing installed ECharts is used lazily; no additional peer dependency or SVG source guessing",()=>{
  const pkg=JSON.parse(source("../../../package.json")) as {dependencies:Record<string,string>};
  const chart=source("../components/panels/RecordedEvidenceSankey.tsx");
  const flow=source("../components/panels/RecordedEvidenceFlowPanel.tsx");
  const projection=source("./recordedEvidenceFlow.ts");
  assert.equal(pkg.dependencies.echarts,"6.1.0");
  assert.match(chart,/import \{ SankeyChart \} from "echarts\/charts"/);
  assert.match(chart,/import \{ SVGRenderer \} from "echarts\/renderers"/);
  assert.match(chart,/animation: false/);
  assert.match(chart,/draggable: false/);
  assert.match(chart,/tooltip: \{ show: false \}/);
  assert.match(chart,/plot\.dispose\(\)/);
  assert.match(flow,/lazy\(\(\) => import\("\.\/RecordedEvidenceSankey"\)\)/);
  assert.match(flow,/Every available recorded link is still inspectable in the table below/);
  assert.match(projection,/value: 1/);
  assert.match(projection,/from:\$\{link\.from\.id\}/);
  assert.match(projection,/relation:\$\{link\.id\}/);
  assert.match(projection,/to:\$\{link\.to\.id\}/);
  assert.doesNotMatch(projection,/confidence|calculateImpact|predict\(|consensusScore|Math\.random/);
});
