"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { gitBlobDigest, validateCatalog, verifyDirectory, recoverDirectory } = require("./recover_instrument_catalogs.cjs");

function fixtures(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "lios-catalog-test-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const source = path.join(base, "private");
  const target = path.join(base, "public");
  const inputDir = path.join(source, "src/server/data");
  fs.mkdirSync(inputDir, { recursive: true });
  const data = {
    "tickers.json": JSON.stringify([{ symbol: "ABC", name: "A Company" }, { symbol: "XYZ", name: "X Company" }]),
    "crypto_coingecko_ids.json": JSON.stringify({ "BTC-USD": { id: "bitcoin" }, "ETH-USD": { id: "ethereum" } }),
  };
  const specs = Object.entries(data).map(([name, value]) => {
    const bytes = Buffer.from(value);
    fs.writeFileSync(path.join(inputDir, name), bytes);
    return { name, bytes: bytes.length, blob: gitBlobDigest(bytes), kind: name.startsWith("crypto") ? "map" : "array", minEntries: 2 };
  });
  return { source, target, inputDir, specs };
}

test("a complete private snapshot restores, validates and can be verified again", (t) => {
  const x = fixtures(t);
  assert.equal(recoverDirectory(x.source, x.target, x.specs).length, 2);
  assert.equal(verifyDirectory(x.target, x.specs).length, 2);
  assert.equal(recoverDirectory(x.source, x.target, x.specs).length, 2);
});

test("corrupted private source stops before any destination write", (t) => {
  const x = fixtures(t);
  fs.appendFileSync(path.join(x.inputDir, "tickers.json"), "tampered");
  assert.throws(() => recoverDirectory(x.source, x.target, x.specs), /size mismatch/);
  assert.equal(fs.existsSync(path.join(x.target, "src/server/data/tickers.json")), false);
});

test("already-existing local data is never silently overwritten", (t) => {
  const x = fixtures(t);
  const dir = path.join(x.target, "src/server/data");
  fs.mkdirSync(dir, { recursive: true });
  const local = path.join(dir, "tickers.json");
  fs.writeFileSync(local, "user-owned-change");
  assert.throws(() => recoverDirectory(x.source, x.target, x.specs), /size mismatch/);
  assert.equal(fs.readFileSync(local, "utf8"), "user-owned-change");
});

test("symlink catalog sources are refused", (t) => {
  const x = fixtures(t);
  const file = path.join(x.inputDir, "tickers.json");
  const original = path.join(x.inputDir, "original-tickers.json");
  fs.renameSync(file, original);
  fs.symlinkSync(original, file);
  assert.throws(() => validateCatalog(file, x.specs[0]), /not a regular file/);
});

test("well-formed JSON with unexpected identity rows is rejected", (t) => {
  const x = fixtures(t);
  const file = path.join(x.inputDir, "tickers.json");
  const bytes = Buffer.from(JSON.stringify([{ symbol: "ABC" }, { name: "Missing symbol" }]));
  fs.writeFileSync(file, bytes);
  const spec = { ...x.specs[0], blob: gitBlobDigest(bytes), bytes: bytes.length };
  assert.throws(() => validateCatalog(file, spec), /invalid symbol or name/);
});
