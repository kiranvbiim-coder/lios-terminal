import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import {
  describeFinanceDatabaseInstallFailure,
  extractFinanceDatabaseTarGz,
  getFinanceDatabaseInstallStatus,
  installPublicFinanceDatabase,
} from "./financeDatabaseInstallService";

function fixtureTar(entries: Array<{ path: string; text: string }>) {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.text);
    const header = Buffer.alloc(512);
    Buffer.from(entry.path).copy(header, 0);
    Buffer.from(bytes.length.toString(8).padStart(11, "0") + "\0").copy(header, 124);
    header[156] = 48;
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

test("pinned-donor archive extractor streams all seven categories without Git", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-public-catalog-archive-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = [
    "equities/NMS.csv", "etfs/AMS.csv", "funds/AMS.csv",
    "indices.csv", "currencies.csv", "cryptos.csv", "moneymarkets.csv",
  ];
  const entries = paths.map((file, i) => ({
    path: "FinanceDatabase-pinned/database/" + file,
    text: "symbol,name,exchange\nT" + i + ",Synthetic Item " + i + ",SYNTH\n",
  }));
  entries.push({ path: "FinanceDatabase-pinned/../../malicious.csv", text: "NEVER" });
  const archive = fixtureTar(entries);
  const progress: number[] = [];
  const result = await extractFinanceDatabaseTarGz(Readable.from([archive]), root, (files) => progress.push(files));
  assert.equal(result.files, 7);
  assert.equal(progress.at(-1), 7);
  assert.equal(fs.existsSync(path.join(root, "malicious.csv")), false);
  for (const [i, file] of paths.entries()) {
    const text = fs.readFileSync(path.join(root, "database", file), "utf8");
    assert.ok(text.includes("Synthetic Item " + i));
  }
});

test("truncated donor archive fails closed", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-public-catalog-truncated-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = fixtureTar([{ path: "Donor/database/equities/NMS.csv", text: "symbol,name\nSYNTH,One\n" }]);
  await assert.rejects(extractFinanceDatabaseTarGz(Readable.from([archive.subarray(0, archive.length - 6)]), root));
});

test("interrupted donor download rejects extraction and closes the source", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-catalog-disconnect-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const body = new Readable({ read() { this.destroy(new Error("download disconnected")); } });
  await assert.rejects(extractFinanceDatabaseTarGz(body, root), /download disconnected/);
  assert.equal(body.destroyed, true);
});

test("asynchronous source cancellation errors remain handled after archive refusal", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-catalog-cancel-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const body = new Readable({
    read() { this.push(Buffer.from("not a gzip archive")); this.push(null); },
    destroy(_error, callback) { setImmediate(() => callback(new Error("cancel failed"))); },
  });
  await assert.rejects(extractFinanceDatabaseTarGz(body, root));
  await new Promise<void>(resolve => body.closed ? resolve() : body.once("close", resolve));
});

test("install failures are described in plain language, never as raw network errors", () => {
  const dns = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND codeload.github.com"), { code: "ENOTFOUND" }) });
  assert.match(describeFinanceDatabaseInstallFailure(dns), /Could not reach the public data host.*internet connection/);
  assert.match(describeFinanceDatabaseInstallFailure(new Error("Public donor archive unavailable (HTTP 503)")), /HTTP 503.*Try again later/);
  assert.match(describeFinanceDatabaseInstallFailure(Object.assign(new Error("Download stalled: no data for 60 s"), { name: "AbortError" })), /stalled or took too long/);
  const full = Object.assign(new Error("Not enough free disk space: about 700 MB needed, 12 MB available"), { code: "ENOSPC" });
  assert.match(describeFinanceDatabaseInstallFailure(full), /Not enough free disk space.*Free up about 1 GB/);
  assert.match(describeFinanceDatabaseInstallFailure(Object.assign(new Error("write"), { code: "ENOSPC" })), /not enough free disk space/i);
  assert.match(describeFinanceDatabaseInstallFailure(new Error("Catalog SHA256 does not match manifest")), /did not pass verification and nothing was changed/);
});

test("an offline install fails with a plain-language status, leaves no catalog and can be retried", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-catalog-offline-"));
  const previousRoot = process.env.LIOS_DATA_ROOT;
  const realFetch = globalThis.fetch;
  process.env.LIOS_DATA_ROOT = root;
  t.after(() => {
    globalThis.fetch = realFetch;
    if (previousRoot === undefined) delete process.env.LIOS_DATA_ROOT;
    else process.env.LIOS_DATA_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const originalError = console.error;
  console.error = () => undefined;
  t.after(() => { console.error = originalError; });
  globalThis.fetch = (async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ENETUNREACH"), { code: "ENETUNREACH" }) });
  }) as typeof fetch;
  const temporaryBefore = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith("lios-financedatabase-download-"));
  await assert.rejects(installPublicFinanceDatabase(), /fetch failed/);
  const failed = getFinanceDatabaseInstallStatus();
  assert.equal(failed.state, "failed");
  assert.match(failed.error ?? "", /Could not reach the public data host/);
  assert.equal(fs.existsSync(path.join(root, "instrument-catalogs", "financedatabase_universe.json")), false);
  const temporaryAfter = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith("lios-financedatabase-download-"));
  assert.deepEqual(temporaryAfter, temporaryBefore, "failed download must not leak its scratch directory");
  // A second click after a failure starts a fresh attempt (it is not stuck in the failed state).
  await assert.rejects(installPublicFinanceDatabase(), /fetch failed/);
  assert.equal(getFinanceDatabaseInstallStatus().state, "failed");
});

test("concurrent install attempts are refused while one is running", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-catalog-concurrent-"));
  const previousRoot = process.env.LIOS_DATA_ROOT;
  const realFetch = globalThis.fetch;
  process.env.LIOS_DATA_ROOT = root;
  const originalError = console.error;
  console.error = () => undefined;
  t.after(() => {
    console.error = originalError;
    globalThis.fetch = realFetch;
    if (previousRoot === undefined) delete process.env.LIOS_DATA_ROOT;
    else process.env.LIOS_DATA_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });
  let release: () => void = () => undefined;
  globalThis.fetch = (() => new Promise((_resolve, reject) => { release = () => reject(new TypeError("fetch failed")); })) as typeof fetch;
  const first = installPublicFinanceDatabase();
  const firstSettled = assert.rejects(first, /fetch failed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(getFinanceDatabaseInstallStatus().state, "fetching");
  await assert.rejects(installPublicFinanceDatabase(), /already in progress/);
  release();
  await firstSettled;
});
