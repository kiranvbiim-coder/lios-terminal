import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import { getCapeSnapshot, type CapeMonth } from "./shillerCapeService";

// Invented known-answer observations, not a copied or representative Shiller series.
const syntheticSeries: CapeMonth[] = [
  { year: 2000, month: 1, cape: 10, realPrice: 100, realEarnings: 5 },
  { year: 2000, month: 2, cape: 30, realPrice: 300, realEarnings: 15 },
  { year: 2000, month: 3, cape: 20, realPrice: null, realEarnings: null },
  { year: 2000, month: 4, cape: 20, realPrice: 200, realEarnings: -5 },
];
const environmentKeys = ["LIOS_SHILLER_CAPE_FILE", "NODE_ENV", "HOST", "DATABASE_URL"] as const;
let previousEnvironment: Array<string | undefined>;
let root: string;
let file: string;

beforeEach(() => {
  previousEnvironment = environmentKeys.map((key) => process.env[key]);
  process.env.NODE_ENV = "test";
  delete process.env.LIOS_SHILLER_CAPE_FILE;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-synthetic-cape-"));
  file = path.join(root, "synthetic-months.json");
});

afterEach(() => {
  environmentKeys.forEach((key, index) => {
    if (previousEnvironment[index] === undefined) delete process.env[key];
    else process.env[key] = previousEnvironment[index];
  });
  fs.rmSync(root, { recursive: true, force: true });
});

function supply(content: string = JSON.stringify(syntheticSeries)): void {
  fs.writeFileSync(file, content);
  process.env.LIOS_SHILLER_CAPE_FILE = file;
}

test("dataset-free import succeeds but an unconfigured source cannot produce a snapshot", () => {
  assert.throws(getCapeSnapshot, /Shiller CAPE source unavailable.*LIOS_SHILLER_CAPE_FILE.*no dataset is bundled or downloaded/);
  process.env.LIOS_SHILLER_CAPE_FILE = "   ";
  assert.throws(getCapeSnapshot, /Shiller CAPE source unavailable/);
});

test("explicit local synthetic observations retain the original snapshot math and truthful as-of", () => {
  const content = `${JSON.stringify(syntheticSeries, null, 2)}\n`;
  supply(content);
  const snapshot = getCapeSnapshot();
  assert.deepEqual(snapshot.current, syntheticSeries[3]);
  assert.equal(snapshot.asOf, "2000-04-01T00:00:00.000Z");
  assert.equal(snapshot.percentile, 75);
  assert.equal(snapshot.mean, 20);
  assert.equal(snapshot.median, 20);
  assert.deepEqual(snapshot.min, { cape: 10, year: 2000, month: 1 });
  assert.deepEqual(snapshot.max, { cape: 30, year: 2000, month: 2 });
  assert.deepEqual(snapshot.series, syntheticSeries.map(({ year, month, cape }) => ({ year, month, cape })));
  assert.equal(snapshot.count, snapshot.series.length);
  const hash = crypto.createHash("sha256").update(Buffer.from(content)).digest("hex");
  assert.deepEqual(snapshot.source, { contentHash: hash, byteLength: Buffer.byteLength(content), sourceRefs: [`file-content:${hash}`] });
  assert.ok(!JSON.stringify(snapshot.source).includes(root), "local filesystem paths must not be exposed as provenance");
});

test("odd-series median and numeric rounding preserve the original conventions", () => {
  supply(JSON.stringify(syntheticSeries.slice(0, 3)));
  assert.equal(getCapeSnapshot().median, 20);
  assert.equal(getCapeSnapshot().percentile, 66.7);
  supply(JSON.stringify(syntheticSeries.slice(0, 3).map((row, index) => ({ ...row, cape: [10.125, 20.255, 30.375][index] }))));
  const snapshot = getCapeSnapshot();
  assert.equal(snapshot.mean, 20.25);
  assert.equal(snapshot.median, 20.26);
});

test("source byte changes are re-read and hashed without normalizing source content", () => {
  supply();
  const first = getCapeSnapshot();
  supply(`${JSON.stringify(syntheticSeries)}\n`);
  const second = getCapeSnapshot();
  assert.deepEqual(second.series, first.series);
  assert.notEqual(second.source.contentHash, first.source.contentHash);
  supply(JSON.stringify(syntheticSeries.slice(0, 3)));
  assert.equal(getCapeSnapshot().asOf, "2000-03-01T00:00:00.000Z");
});

test("missing files and directories fail meaningfully rather than returning synthetic history", () => {
  process.env.LIOS_SHILLER_CAPE_FILE = file;
  assert.throws(getCapeSnapshot, /source unavailable.*readable regular local JSON file/);
  process.env.LIOS_SHILLER_CAPE_FILE = root;
  assert.throws(getCapeSnapshot, /source unavailable.*readable regular local JSON file/);
});

const invalidSources: Array<{ label: string; content: string; detail: RegExp }> = [
  { label: "malformed JSON", content: "not JSON", detail: /expected a JSON array/ },
  { label: "empty series", content: "[]", detail: /must not be empty/ },
  { label: "non-array root", content: "{}", detail: /monthly record array/ },
  { label: "non-record row", content: "[null]", detail: /expected a monthly record/ },
  { label: "invalid month", content: JSON.stringify([{ ...syntheticSeries[0], month: 13 }]), detail: /valid calendar month/ },
  { label: "fractional year", content: JSON.stringify([{ ...syntheticSeries[0], year: 2000.5 }]), detail: /valid calendar month/ },
  { label: "out-of-domain year", content: JSON.stringify([{ ...syntheticSeries[0], year: 0 }]), detail: /valid calendar month/ },
  { label: "future as-of", content: JSON.stringify([{ ...syntheticSeries[0], year: 9999 }]), detail: /as-of month cannot be in the future/ },
  { label: "duplicate months", content: JSON.stringify([syntheticSeries[0], syntheticSeries[0]]), detail: /unique.*chronological/ },
  { label: "descending months", content: JSON.stringify([syntheticSeries[1], syntheticSeries[0]]), detail: /unique.*chronological/ },
  { label: "zero CAPE", content: JSON.stringify([{ ...syntheticSeries[0], cape: 0 }]), detail: /CAPE must be a finite positive/ },
  { label: "negative CAPE", content: JSON.stringify([{ ...syntheticSeries[0], cape: -1 }]), detail: /CAPE must be a finite positive/ },
  { label: "string CAPE", content: JSON.stringify([{ ...syntheticSeries[0], cape: "20" }]), detail: /CAPE must be a finite positive/ },
  { label: "non-finite CAPE", content: '[{"year":2000,"month":1,"cape":1e400,"realPrice":null,"realEarnings":null}]', detail: /CAPE must be a finite positive/ },
  { label: "invalid real price", content: JSON.stringify([{ ...syntheticSeries[0], realPrice: -1 }]), detail: /realPrice must be a finite positive/ },
  { label: "non-finite real earnings", content: '[{"year":2000,"month":1,"cape":20,"realPrice":null,"realEarnings":1e400}]', detail: /realEarnings must be a finite number/ },
  { label: "omitted unavailable earnings", content: '[{"year":2000,"month":1,"cape":20,"realPrice":null}]', detail: /realEarnings must be a finite number/ },
  { label: "calculation overflow", content: JSON.stringify([{ ...syntheticSeries[0], cape: Number.MAX_VALUE }]), detail: /finite snapshot calculation range/ },
];
for (const { label, content, detail } of invalidSources) {
  test(`invalid synthetic input rejects ${label} without a stale snapshot`, () => {
    supply();
    getCapeSnapshot();
    supply(content);
    assert.throws(getCapeSnapshot, detail);
  });
}

test("local CAPE loading retains the existing hosted BYOD restriction", () => {
  supply();
  process.env.NODE_ENV = "production";
  process.env.HOST = "0.0.0.0";
  delete process.env.DATABASE_URL;
  assert.throws(getCapeSnapshot, /local-desktop only.*hosted control plane/);
});
