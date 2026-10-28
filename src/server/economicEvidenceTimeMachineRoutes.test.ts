import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("B06 economic-vintage compare rejects unrecorded, cross-series and bad-hash rows before field revisions",()=>{
  const source=readFileSync(new URL("./dataFabricRoutes.ts",import.meta.url),"utf8");
  const start=source.indexOf('app.get("/api/data-snapshots/economics/:seriesId/compare"');
  const end=source.indexOf('app.get("/api/data-snapshots/economics/:seriesId/as-of"',start);
  assert.ok(start!==-1 && end>start);
  const route=source.slice(start,end);
  for(const token of [
    'requireRole(...READ_ROLES)','z.string().uuid().safeParse(req.query.baselineId)',
    'z.string().uuid().safeParse(req.query.currentId)',
    'getEconomicDatasetSnapshot(baselineId.data)','getEconomicDatasetSnapshot(currentId.data)',
    'economicCapturePairIssue(baseline,current,seriesId.data)',
    'economicSnapshotContentHash(snapshot.payload,snapshot.lineage) !== snapshot.contentHash',
    'compareEconomicDatasetPayloads(baseline.payload,current.payload)',
    'result.revisions.slice(0,48)','result.addedDates.slice(0,16)',
    'res.setHeader("Cache-Control", "no-store")',
  ])assert.ok(route.includes(token),"missing backend boundary "+token);
  assert.doesNotMatch(route,/captureFredSeriesSnapshot|getIndicatorHistory|getIndicatorProfile/);
});
