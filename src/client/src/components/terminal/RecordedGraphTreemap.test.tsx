import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("B08 optional treemap consumes only currently visible recorded graph counts with a plain-text accessible legend",()=>{
 const source=readFileSync(new URL("./GraphExplorer.tsx",import.meta.url),"utf8");
 const plot=readFileSync(new URL("./RecordedGraphTreemap.tsx",import.meta.url),"utf8");
 assert.match(source,/recordedGraphDomainCounts\(presentation\.nodes\)/);
 assert.match(source,/RecordedGraphTreemap/);
 assert.match(source,/React\.lazy\(\(\) => import\("\.\/RecordedGraphTreemap"\)\)/);
 assert.match(source,/Show recorded object treemap/);
 assert.match(source,/inferred display labels/);
 assert.match(source,/No recorded objects match the active graph filters/);
 assert.match(plot,/from "echarts\/charts"/);
 assert.match(plot,/TreemapChart/);
 assert.match(plot,/renderer:"svg"/);
 assert.match(plot,/aria-hidden="true"/);
 assert.match(plot,/animation:false/);
 assert.doesNotMatch(plot,/Math\.random|fetch\(|WebGLRenderer|from "highcharts"/);
});
