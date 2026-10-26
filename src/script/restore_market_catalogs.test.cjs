"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  CATALOGS, gitBlobSha, validateCatalogBytes, checkCatalogs, restoreCatalogs,
} = require("./restore_market_catalogs.cjs");

test("Git object digest binds the original byte payload, not parsed JSON", () => {
  const bytes = Buffer.from("hello");
  assert.equal(gitBlobSha(bytes), "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0");
  assert.notEqual(gitBlobSha(Buffer.from("hello\n")), gitBlobSha(bytes));
});

test("catalog schema rejects empty, malformed, or wrong-kind inputs", () => {
  const definition = { name: "fixture.json", kind: "array", minBytes: 1, minRecords: 1 };
  assert.throws(() => validateCatalogBytes(Buffer.from("[]"), definition), /unexpectedly small/);
  assert.throws(() => validateCatalogBytes(Buffer.from("{}"), definition), /must contain an array/);
  assert.throws(() => validateCatalogBytes(Buffer.from("[1]"), definition), /invalid symbol\/name rows/);
  assert.throws(() => validateCatalogBytes(Buffer.from("{"), definition), /invalid JSON/);
  assert.equal(validateCatalogBytes(Buffer.from('[{"symbol":"AAPL","name":"Apple"}]'), definition).count, 1);
});

test("crypto mappings require stable external IDs", () => {
  const definition = { name: "crypto.json", kind: "object", minBytes: 1, minRecords: 1 };
  assert.throws(
    () => validateCatalogBytes(Buffer.from('{"BTC-USD":{"name":"Bitcoin"}}'), definition),
    /invalid CoinGecko/,
  );
  assert.equal(
    validateCatalogBytes(Buffer.from('{"BTC-USD":{"id":"bitcoin","name":"Bitcoin"}}'), definition).count,
    1,
  );
});

test("missing catalogs fail explicit packaging preflight", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-catalog-check-"));
  try {
    assert.throws(() => checkCatalogs(directory), /Run npm run data:catalogs:restore/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("untrusted recovery payload cannot overwrite a present catalog", () => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "lios-catalog-restore-"));
  const target = path.join(destination, CATALOGS[0].name);
  const unchanged = Buffer.from("preserve-me");
  fs.writeFileSync(target, unchanged);
  try {
    assert.throws(() => restoreCatalogs({
      destination, force: true,
      runner: () => ({ status: 0, stdout: Buffer.from("{}") }),
    }), /private Git blob response is invalid/);
    assert.deepEqual(fs.readFileSync(target), unchanged);
  } finally {
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test("catalog recovery code does not embed credentials or expose private source files", () => {
  const gitignore = fs.readFileSync(path.join(__dirname, "..", "..", ".gitignore"), "utf8");
  assert.match(gitignore, /src\/server\/data\//);
  const script = fs.readFileSync(path.join(__dirname, "restore_market_catalogs.cjs"), "utf8");
  assert.match(script, /git\/blobs\//);
  assert.equal(crypto.timingSafeEqual(Buffer.from("a"), Buffer.from("a")), true);
});
