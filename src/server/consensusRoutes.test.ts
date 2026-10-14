import test from "node:test";
import assert from "node:assert/strict";
import { buildEstimateVintageLedger } from "./estimateVintageLedger";
import { snapshotVintageRows } from "./consensusRoutes";

type SnapshotFixture = Parameters<typeof snapshotVintageRows>[0];

function snapshot(metadata: Record<string, unknown> = {}): SnapshotFixture {
  return {
    id: 1,
    symbol: "ACME",
    organizationId: 7,
    investigationId: null,
    metric: "eps",
    fiscalPeriod: "FY2027",
    periodEnd: null,
    currency: "USD",
    unit: "per_share",
    mean: 2.1,
    median: 2.1,
    high: 2.3,
    low: 1.9,
    contributorCount: 2,
    standardDeviation: 0.2,
    upwardRevisionCount: 1,
    downwardRevisionCount: 0,
    unchangedRevisionCount: 1,
    estimateAsOf: new Date("2026-01-15T00:00:00.000Z"),
    publishedAt: new Date("2026-01-14T00:00:00.000Z"),
    retrievedAt: new Date("2026-01-16T00:00:00.000Z"),
    availableAt: new Date("2026-01-16T00:00:00.000Z"),
    sourceType: "licensed_provider",
    provider: "licensed-feed",
    sourceName: "Licensed consensus feed",
    sourceUrl: "https://example.com/consensus",
    methodology: null,
    snapshotHash: "hash-1",
    metadata,
    createdByUserId: 11,
    createdAt: new Date("2026-01-16T00:00:00.000Z"),
  } as SnapshotFixture;
}

test("consensus intelligence keeps provider aggregates aggregate-only", () => {
  assert.deepEqual(snapshotVintageRows(snapshot()), []);
});

test("consensus intelligence adapts only explicit contributor vintages", () => {
  const rows = snapshotVintageRows(snapshot({
    vintageObservations: [
      { contributor: "Analyst A", value: 2, publishedAt: "2026-01-10T00:00:00.000Z", vintageAt: "2026-01-11T00:00:00.000Z" },
      { contributor: "Analyst B", value: 2.2, publishedAt: "2026-01-10T00:00:00.000Z", vintageAt: "2026-01-11T00:00:00.000Z" },
    ],
  }));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.contributor), ["Analyst A", "Analyst B"]);
  assert.equal(rows[0].provider, "licensed-feed");
  assert.equal(rows[0].sourceReference, "https://example.com/consensus");
  assert.equal(rows[0].vintageAt, "2026-01-11T00:00:00.000Z");
});

test("consensus intelligence ledger reports revisions and dispersion without fabricating contributors", () => {
  const rows = [
    ...snapshotVintageRows(snapshot({ vintageObservations: [{ contributor: "Analyst A", value: 2, publishedAt: "2026-01-10T00:00:00.000Z", vintageAt: "2026-01-11T00:00:00.000Z" }] })),
    ...snapshotVintageRows({ ...snapshot({ vintageObservations: [{ contributor: "Analyst A", value: 2.2, publishedAt: "2026-02-10T00:00:00.000Z", retrievedAt: "2026-02-12T00:00:00.000Z", vintageAt: "2026-02-11T00:00:00.000Z" }] }), id: 2 }),
    ...snapshotVintageRows({ ...snapshot({ vintageObservations: [{ contributor: "Analyst B", value: 1.8, publishedAt: "2026-02-10T00:00:00.000Z", retrievedAt: "2026-02-12T00:00:00.000Z", vintageAt: "2026-02-11T00:00:00.000Z" }] }), id: 3 }),
  ];
  const ledger = buildEstimateVintageLedger(rows);
  assert.equal(ledger.groups.length, 1);
  assert.equal(ledger.groups[0].latest.length, 2);
  assert.equal(ledger.groups[0].latest[0].revisionDirection, "up");
  assert.equal(ledger.groups[0].dispersion?.contributorCount, 2);
  assert.equal(ledger.groups[0].dispersion?.low, 1.8);
  assert.equal(ledger.groups[0].dispersion?.high, 2.2);
});
