import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { extractFinanceDatabaseTarGz } from "./financeDatabaseInstallService";

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
