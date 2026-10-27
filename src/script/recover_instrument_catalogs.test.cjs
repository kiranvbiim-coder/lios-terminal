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
  try { fs.symlinkSync(original, file); }
  catch (error) {
    if (error && (error.code === "EPERM" || error.code === "EACCES")) {
      t.skip("Host does not permit creating symbolic links");
      return;
    }
    throw error;
  }
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

test("historical vendor timestamp row is valid snapshot metadata, not an instrument", (t) => {
  const x = fixtures(t);
  const file = path.join(x.inputDir, "tickers.json");
  const bytes = Buffer.from(JSON.stringify([
    { symbol: "ABC", name: "A Company" },
    { symbol: "FILE CREATION TIME: 0820202603:02", name: "" }
  ]));
  fs.writeFileSync(file, bytes);
  const spec = { ...x.specs[0], blob: gitBlobDigest(bytes), bytes: bytes.length };
  assert.equal(validateCatalog(file, spec).records, 2);
});

test("private recovery creates owner-only files even in an existing traversable directory", (t) => {
  if (process.platform === "win32") return t.skip("POSIX mode bits");
  const x = fixtures(t);
  fs.mkdirSync(path.join(x.target, "src/server/data"), { recursive: true, mode: 0o755 });
  recoverDirectory(x.source, x.target, x.specs);
  for (const spec of x.specs)
    assert.equal(fs.statSync(path.join(x.target, "src/server/data", spec.name)).mode & 0o777, 0o600);
});

test("a concurrent destination creator is never replaced during private recovery", (t) => {
  const x = fixtures(t);
  const link = fs.linkSync;
  let local;
  fs.linkSync = (from, to) => {
    local = to;
    fs.writeFileSync(to, "concurrent owner content", { flag: "wx" });
    return link(from, to);
  };
  try {
    assert.throws(() => recoverDirectory(x.source, x.target, x.specs), /size mismatch/);
    assert.equal(fs.readFileSync(local, "utf8"), "concurrent owner content");
  } finally {
    fs.linkSync = link;
  }
});
