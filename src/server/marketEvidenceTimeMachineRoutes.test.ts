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
    'readAuthorizedCapturePair(',
    'tenantContext(req.user!), [baselineId.data, currentId.data], "market_series", getMarketDatasetSnapshot',
    'marketCapturePairIssue(baseline, current, symbol.data)',
    'stableSnapshotHash({ payload: snapshot.payload, lineage: snapshot.lineage })',
    'compareMarketDatasetPayloads(baseline.payload, current.payload',
    'report.revisions.slice(0, 48)',
    'report.addedDates.slice(0, 16)',
    'report.removedDates.slice(0, 16)',
    'res.setHeader("Cache-Control", "no-store")',
  ]) assert.ok(handler.includes(token),"missing truth check: "+token);
  assert.doesNotMatch(handler,/getOHLCV|getQuotes|captureMarketDatasetSnapshot|Math\.random/);
  const admission=source.slice(source.indexOf("async function readAuthorizedCapturePair"),source.indexOf("export function registerDataFabricRoutes"));
  for(const required of [
    "getDb().transaction(", "for (const id of ids)", '.for("share")',
    "!canAccessDatasetSnapshot(identity, ctx)", "getEntitlementPolicyById(",
    '["display", "derived_output"].every(',
    "return [await read(ids[0], tx), await read(ids[1], tx)]",
  ]) assert.ok(admission.includes(required), "missing both-capture authorization gate: "+required);
});
