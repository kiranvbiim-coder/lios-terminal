import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** This source-ownership regression complements the pure snapshot-selection tests.
 * The actual data-fabric route must keep the existing authenticated store.
 */
test("B06 compares only exact saved market captures using server-side hashes and rights",()=>{
  const source=readFileSync(new URL("./dataFabricRoutes.ts",import.meta.url),"utf8");
  const from=source.indexOf('app.get("/api/data-snapshots/markets/:symbol/compare"');
  const to=source.indexOf('app.get("/api/data-snapshots/markets/:symbol/as-of"',from);
  assert.ok(from>0 && to>from,"comparison route precedes existing market as-of");
  const handler=source.slice(from,to);
  for(const token of [
    'requireRole(...READ_ROLES)',
    'z.string().uuid().safeParse(req.query.baselineId)',
    'z.string().uuid().safeParse(req.query.currentId)',
    'getMarketDatasetSnapshot(baselineId.data)',
    'getMarketDatasetSnapshot(currentId.data)',
    'marketCapturePairIssue(baseline, current, symbol.data)',
    'stableSnapshotHash({ payload: snapshot.payload, lineage: snapshot.lineage })',
    'compareMarketDatasetPayloads(baseline.payload, current.payload',
    'report.revisions.slice(0, 48)',
    'report.addedDates.slice(0, 16)',
    'report.removedDates.slice(0, 16)',
    'res.setHeader("Cache-Control", "no-store")',
  ]) assert.ok(handler.includes(token),"missing truth check: "+token);
  assert.doesNotMatch(handler,/getOHLCV|getQuotes|captureMarketDatasetSnapshot|Math\.random/);
});
