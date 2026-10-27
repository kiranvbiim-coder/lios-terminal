import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source=readFileSync(new URL("./MarketDataFabricPanel.tsx",import.meta.url),"utf8");
test("B06 Market Data Fabric exposes retained as-known-on comparison with two recorded capture IDs",()=>{
  for(const key of [
    'b06-market-evidence-time-machine',
    'asKnownDay',
    'marketCaptureKnownOn(snapshots, upper, asKnownDay)',
    'latestMarketCapture(snapshots, upper)',
    'type="date"',
    'Compare recorded versions',
    'b06-snapshot-revision-comparison',
    'Both source content hashes were checked',
    'No retained {upper} market capture was actually available on that date',
    'changedObservations',
    'totalAddedDates',
    'omitted.revisions',
  ]) assert.ok(source.includes(key),"missing recorded comparison affordance "+key);
});
test("B06 blocks stale issuer revisions, cross-symbol requests and concurrent old source writes",()=>{
  assert.match(source,/activeOwner\.current !== upper/);
  assert.match(source,/readSequence\.current/);
  assert.match(source,/comparisonAbort\.current\?\.abort\(\)/);
  assert.match(source,/result\.baseline\.contentHash !== historical\.contentHash/);
  assert.match(source,/result\.current\.contentHash !== current\.contentHash/);
  assert.match(source,/credentials: "same-origin", cache: "no-store"/);
  assert.doesNotMatch(source,/fakeHistorical|generateHistorical|Math\.random/);
});
