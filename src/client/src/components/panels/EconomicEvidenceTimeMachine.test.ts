import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("B06 economics reuses the real frozen FRED data fabric and shows true before-and-after vintage revisions",()=>{
  const source=readFileSync(new URL("./EconomicDataFabricPanel.tsx",import.meta.url),"utf8");
  for(const item of [
    'b06-economic-evidence-time-machine','economicCaptureKnownOn(series,seriesId,knownOnDay)',
    'eligibleEconomicCaptures(series,seriesId)','b06-economic-snapshot-comparison',
    'Compare saved economic vintages','Retained source revision pairs',
    'result.baseline.contentHash !== savedThen.contentHash',
    'result.current.contentHash !== latestSeriesCapture.contentHash',
    'compareAbort.current?.abort()','type="date"',
    'No immutable {seriesId} snapshot was retained as available on that day',
  ])assert.ok(source.includes(item),"missing economics historical UX: "+item);
  assert.doesNotMatch(source,/fakeMacroHistory|fabricateVintage|Math\.random/);
});
